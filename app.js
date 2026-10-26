/* PDF Split — thumbnails by pdf.js (Mozilla, Apache-2.0), new PDFs by pdf-lib (MIT). Everything runs in this tab. */
import * as pdfjsLib from "./lib/pdf.min.mjs";
pdfjsLib.GlobalWorkerOptions.workerSrc = "lib/pdf.worker.min.mjs";

const { $, $$, h } = S3;
const { PDFDocument } = PDFLib;
const st = { name: "", base: "", bytes: null, doc: null, js: null, n: 0, sel: [], mode: S3.store("split.mode") || "extract", last: -1 };

// ---------- pure logic ----------
function parseRange(str, n, keepEmpty) { // "1-3, 5, 8-" -> groups of 0-based indexes
  const groups = [];
  for (let part of String(str || "").split(/[,;]+/)) {
    part = part.trim(); if (!part) continue;
    const m = /^(\d*)\s*[-–]\s*(\d*)$/.exec(part); let a, b;
    if (m) { a = m[1] ? +m[1] : 1; b = m[2] ? +m[2] : n; }
    else if (/^\d+$/.test(part)) a = b = +part;
    else throw new Error("“" + part + "” isn't a page or range");
    if (a < 1 || b < 1 || a > n || b > n) throw new Error("Page " + (a > n || a < 1 ? a : b) + " doesn't exist (the file has " + n + ")");
    const g = []; for (let p = a; a <= b ? p <= b : p >= b; p += a <= b ? 1 : -1) g.push(p - 1);
    groups.push({ label: part.replace(/\s+/g, ""), pages: g });
  }
  if (!groups.length && !keepEmpty) throw new Error("Choose at least one page");
  return groups;
}
function toRangeText(pages) { // sorted unique 0-based -> "1-3, 5"
  const s = [...new Set(pages)].sort((a, b) => a - b), out = [];
  for (let i = 0; i < s.length; i++) {
    let j = i; while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
    out.push(j > i ? (s[i] + 1) + "-" + (s[j] + 1) : String(s[i] + 1)); i = j;
  }
  return out.join(", ");
}
function plan(mode, n, opt) { // -> [{name, pages}]
  if (mode === "extract") {
    const pages = []; parseRange(opt.sel, n).forEach(g => g.pages.forEach(p => { if (!pages.includes(p)) pages.push(p); }));
    return [{ name: "pages-" + toRangeText(pages).replace(/\s+/g, "").replace(/,/g, "_"), pages }];
  }
  if (mode === "ranges") return parseRange(opt.ranges, n).map(g => ({ name: "pages-" + g.label, pages: g.pages }));
  if (mode === "every") {
    const k = Math.max(1, Math.floor(+opt.every) || 1), out = [], w = String(Math.ceil(n / k)).length;
    for (let i = 0; i < n; i += k) out.push({ name: "part-" + String(out.length + 1).padStart(Math.max(2, w), "0"), pages: Array.from({ length: Math.min(k, n - i) }, (_, x) => i + x) });
    return out;
  }
  const w = Math.max(3, String(n).length);
  return Array.from({ length: n }, (_, i) => ({ name: "page-" + String(i + 1).padStart(w, "0"), pages: [i] }));
}
async function build(src, pages) {
  const out = await PDFDocument.create();
  (await out.copyPages(src, pages)).forEach(p => out.addPage(p));
  out.setProducer("S3eidat Tools PDF Split");
  return out.save();
}
async function loadLib(bytes) {
  try { return await PDFDocument.load(bytes, { updateMetadata: false }); }
  catch (e) { throw new Error(/encrypted/i.test(e && e.message) ? "This PDF is password-protected or encrypted. Remove the protection first." : "This file couldn't be read as a PDF."); }
}
function openJs(bytes) { return pdfjsLib.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise; }

// ---------- thumbnails (lazy, one at a time) ----------
let queue = [], rendering = false, observer = null, gen = 0;
function pump() {
  if (rendering || !queue.length) return;
  rendering = true;
  const { i, canvas, g } = queue.shift();
  st.js.getPage(i + 1).then(page => {
    const vp1 = page.getViewport({ scale: 1 }), scale = (150 * Math.min(2, devicePixelRatio || 1)) / vp1.width, vp = page.getViewport({ scale });
    canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
    return page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
  }).catch(() => { if (g === gen) canvas.classList.add("broken"); })
    .finally(() => { rendering = false; if (g === gen) pump(); });
}
function drawGrid() {
  const grid = $("#grid"); grid.innerHTML = "";
  if (observer) observer.disconnect();
  queue = []; gen++;
  const g = gen;
  observer = new IntersectionObserver(entries => entries.forEach(en => {
    if (!en.isIntersecting) return;
    observer.unobserve(en.target);
    queue.push({ i: +en.target.dataset.i, canvas: en.target.querySelector("canvas"), g }); pump();
  }), { rootMargin: "400px" });
  for (let i = 0; i < st.n; i++) {
    const tile = h("button", { "class": "ps-tile", "data-i": i, type: "button", "aria-label": "Page " + (i + 1) }, [
      h("span", { "class": "ps-thumb" }, [h("canvas", { width: 120, height: 160 })]),
      h("span", { "class": "ps-cap" }, [h("span", { text: String(i + 1) }), h("span", { "class": "ps-badge" })])
    ]);
    grid.appendChild(tile); observer.observe(tile);
  }
  paint();
}

// ---------- UI ----------
function opts() { return { sel: $("#sel").value, ranges: $("#ranges").value, every: $("#every").value }; }
function paint() {
  let parts = null, err = "";
  try { parts = plan(st.mode, st.n, opts()); } catch (e) { err = e.message; }
  const owner = new Map();
  (parts || []).forEach((p, k) => p.pages.forEach(i => { if (!owner.has(i)) owner.set(i, k); }));
  $$(".ps-tile").forEach(t => {
    const i = +t.dataset.i, k = owner.get(i), on = k !== undefined;
    t.setAttribute("aria-pressed", String(on));
    t.style.setProperty("--hue", on ? String((k * 67) % 360) : "0");
    t.querySelector(".ps-badge").textContent = on ? (st.mode === "extract" ? "✓" : "File " + (k + 1)) : "";
    t.classList.toggle("multi", st.mode !== "extract" && on);
  });
  const sum = $("#summary"), go = $("#go");
  if (err) { sum.className = "chip bad"; sum.textContent = err; go.disabled = true; $("#goLabel").textContent = "Download"; return; }
  const pages = parts.reduce((s, p) => s + p.pages.length, 0);
  sum.className = "chip accent";
  sum.textContent = parts.length === 1 ? pages + " page" + (pages > 1 ? "s" : "") + " → 1 PDF" : pages + " pages → " + parts.length + " PDFs";
  $("#goLabel").textContent = parts.length === 1 ? "Download PDF" : "Download zip (" + parts.length + " files)";
  go.disabled = false;
}
function setMode(m) {
  st.mode = m; S3.store("split.mode", m);
  $$("#mode button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.v === m)));
  $$(".ps-opts > div").forEach(d => { d.hidden = d.dataset.for !== m; });
  paint();
}
$$("#mode button").forEach(b => b.addEventListener("click", () => setMode(b.dataset.v)));
["#sel", "#ranges", "#every"].forEach(s => $(s).addEventListener("input", S3.debounce(paint, 120)));

function currentSel() { try { return plan("extract", st.n, opts())[0].pages; } catch (e) { return []; } }
$("#grid").addEventListener("click", e => {
  const t = e.target.closest(".ps-tile"); if (!t) return;
  const i = +t.dataset.i;
  if (st.mode !== "extract") { setMode("extract"); $("#sel").value = String(i + 1); st.last = i; paint(); return; }
  let sel = currentSel();
  if (e.shiftKey && st.last >= 0) {
    const on = !sel.includes(i) || sel.includes(st.last);
    for (let p = Math.min(st.last, i); p <= Math.max(st.last, i); p++) { if (on && !sel.includes(p)) sel.push(p); if (!on) sel = sel.filter(x => x !== p); }
  } else sel = sel.includes(i) ? sel.filter(x => x !== i) : sel.concat(i);
  st.last = i;
  $("#sel").value = toRangeText(sel); paint();
});
$$("[data-pick]").forEach(b => b.addEventListener("click", () => {
  const all = Array.from({ length: st.n }, (_, i) => i), cur = currentSel();
  const pick = { all, none: [], odd: all.filter(i => i % 2 === 0), even: all.filter(i => i % 2 === 1), invert: all.filter(i => !cur.includes(i)) }[b.dataset.pick];
  $("#sel").value = toRangeText(pick); paint();
}));

async function openFile(file) {
  try {
    const bytes = new Uint8Array(await S3.readFile(file));
    const doc = await loadLib(bytes);
    let js;
    try { js = await openJs(bytes); } catch (e) { js = null; }
    if (st.js) st.js.destroy();
    Object.assign(st, { name: file.name, base: file.name.replace(/\.pdf$/i, "") || "document", bytes, doc, js, n: doc.getPageCount(), last: -1 });
    $("#fname").textContent = st.name;
    $("#fmeta").textContent = st.n + " page" + (st.n > 1 ? "s" : "") + " · " + S3.fmtBytes(file.size);
    $("#drop").hidden = true; $("#work").hidden = false;
    $("#sel").value = ""; $("#ranges").value = ""; $("#every").max = st.n;
    if (js) drawGrid(); else { $("#grid").innerHTML = ""; $("#grid").appendChild(h("p", { "class": "faint", text: "Previews aren't available for this file, but splitting works." })); }
    setMode(st.mode);
  } catch (e) { S3.toast(e.message, "error"); }
}
const fileInput = S3.drop($("#drop"), files => openFile(files[0]), { accept: ".pdf,application/pdf", multiple: false });
$("#change").addEventListener("click", () => fileInput.click());

$("#go").addEventListener("click", async () => {
  let parts;
  try { parts = plan(st.mode, st.n, opts()); } catch (e) { S3.toast(e.message, "error"); return; }
  const go = $("#go"), label = $("#goLabel").textContent; go.disabled = true;
  try {
    const files = [];
    for (let k = 0; k < parts.length; k++) {
      $("#goLabel").textContent = "Building " + (k + 1) + " / " + parts.length + "…";
      files.push({ name: st.base + "-" + parts[k].name.slice(0, 80) + ".pdf", data: await build(st.doc, parts[k].pages) });
    }
    if (files.length === 1) S3.download(new Blob([files[0].data], { type: "application/pdf" }), files[0].name);
    else S3.download(S3.zip(files), st.base + "-split.zip");
    S3.toast(files.length === 1 ? "PDF ready" : files.length + " PDFs zipped"); S3.done();
  } catch (e) { S3.toast("Split failed: " + (e && e.message || e), "error"); }
  go.disabled = false; $("#goLabel").textContent = label;
});

// ---------- sample + self-test ----------
async function samplePdf(pages) {
  const d = await PDFDocument.create(), font = await d.embedFont(PDFLib.StandardFonts.HelveticaBold), { rgb } = PDFLib;
  const colors = [rgb(0.05, 0.62, 0.6), rgb(0.4, 0.31, 0.78), rgb(0.89, 0.38, 0.29), rgb(0.95, 0.66, 0.2)];
  for (let i = 1; i <= pages; i++) {
    const p = d.addPage([595.28, 841.89]), c = colors[Math.floor((i - 1) / 3) % colors.length];
    p.drawRectangle({ x: 0, y: 0, width: 595.28, height: 841.89, color: rgb(1, 1, 1) });
    p.drawRectangle({ x: 0, y: 700, width: 595.28, height: 141.89, color: c });
    p.drawText("Chapter " + Math.ceil(i / 3), { x: 48, y: 750, size: 40, font, color: rgb(1, 1, 1) });
    for (let l = 0; l < 14; l++) p.drawRectangle({ x: 48, y: 640 - l * 38, width: 420 + ((l * 53 + i * 31) % 80), height: 12, color: rgb(0.85, 0.87, 0.9) });
    p.drawText(String(i), { x: 280, y: 40, size: 28, font, color: rgb(0.3, 0.3, 0.35) });
  }
  return d.save();
}
window.S3_DEMO = async () => {
  await openFile(new File([await samplePdf(12)], "Handbook.pdf", { type: "application/pdf" }));
  $("#sel").value = "1-3, 7, 10-12"; paint();
  await new Promise(r => setTimeout(r, 900));
};
window.S3_SELFTEST = async () => {
  const d = await PDFDocument.create(); [100, 200, 300].forEach(w => d.addPage([w, 400]));
  const bytes = await d.save(), src = await loadLib(bytes);
  const widths = async b => (await PDFDocument.load(b)).getPages().map(p => Math.round(p.getWidth())).join();
  const ex = plan("extract", 3, { sel: "3,1" }), ev = plan("every", 3, { every: 2 }), sg = plan("single", 3, {}), rg = plan("ranges", 3, { ranges: "1-2, 3" });
  const a = await widths(await build(src, ex[0].pages));
  const b = await Promise.all(ev.map(p => build(src, p.pages).then(widths)));
  const js = await openJs(bytes), pg = await js.getPage(2), vp = pg.getViewport({ scale: 0.5 }); // proves pdf.js + worker load under the CSP
  const c = document.createElement("canvas"); c.width = vp.width; c.height = vp.height;
  await pg.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
  let bad = false; try { plan("extract", 3, { sel: "4" }); } catch (e) { bad = true; }
  return a === "300,100" && b.join("|") === "100,200|300" && sg.length === 3 && rg.length === 2 && rg[1].pages.join() === "2" &&
    js.numPages === 3 && c.width === 100 && toRangeText([4, 0, 1, 2, 9]) === "1-3, 5, 10" && bad;
};
