/*!
 * Finestyle Speisekarten – PDF-Parser v1.1
 * Liest eine Speisekarten-PDF (über pdf.js) und baut daraus eine saubere Struktur:
 * Abschnitte → Einträge (Nr., Name, Zusatzstoffe, Beschreibung, Mengen/Preise, Symbole)
 * und Zwischenzeilen („Dazu wahlweise:“, „Mild & bekömmlich“ …).
 * Hochgestellte Zeichen im Text werden als {…} markiert, z. B. „Cola{1,2} | Cola Zero“.
 * Läuft im Browser (WP-Admin) und in Node (Tests).
 */

// ---------- Muster ----------
const NUM = '\\d{1,4}(?:[.,]\\d{1,2})?';
const PRICE_TOKEN = `(?:€\\s?)?(?:\\d{1,3}(?:\\.\\d{3})+,\\d{2}|${NUM}|\\d{1,4},-{1,2}|\\d{1,4},–)(?![\\d.,])(?!\\s?(?:l|L|cl|ml|kg|g|Ltr|Liter)\\b)(?:\\s?(?:€|EUR|Euro))?`;
const UNIT = '(?:l|L|ltr\\.?|Ltr\\.?|cl|ml|g|gr\\.?|kg|Stk\\.?|St\\.|Stück|Liter)';
const VOL_TOKEN = `\\d+(?:[.,]\\d+)?\\s?${UNIT}`;
const LABELS = '(?:Glas|Flasche|Fl\\.|Karaffe|Krug|Kanne|Tasse|Kännchen|Pot|Pitcher|Bottle|Glass|klein|groß|gross|small|large|Portion|halbe Portion|1\\/2 Portion|(?:for|für) \\d{1,2}(?: Pers(?:\\.|onen))?|(?:19|20)\\d{2}(?= \\d))';
const RE_PRICE_ONLY = new RegExp(`^${PRICE_TOKEN}$`);
const RE_DEC_PRICE = new RegExp(`^(?:€\\s?)?(?:\\d{1,3}(?:\\.\\d{3})+,\\d{2}|\\d{1,4}(?:,\\d{1,2}|,-{1,2}|,–|\\.\\d{2}))(?:\\s?(?:€|EUR|Euro))?$`);
const RE_VOL_ONLY = new RegExp(`^(?:${LABELS}\\s)?${VOL_TOKEN}(?:\\s${LABELS})?$|^${LABELS}$`, 'i');
const RE_ITEMNR = /^(\d{1,4}[a-zA-Z]?)(?:[.)]|\s)\s*(?=\S)/;
const RE_COUNT = /^\d+\s?(?:x|×)\s/i; // „1 x Suppe“ ist keine Nummer
const RE_BOLD = /bold|black|heavy|semibold|semi-bold|demibold|demi|extrabold|ultrabold|-bd\b|_bd\b|fett/i;
const RE_ITALIC = /italic|oblique|kursiv|-it\b|_it\b/i;
const RE_FOOTNOTE = /(zusatzstoff|allergen|inkl\.?\s*(?:mwst|\d+\s*%)|mehrwertsteuer|preise in|alle preise|irrtümer|änderungen vorbehalten)/i;
const VLABEL = '(?:Vorspeise|Hauptgang|Hauptspeise|Kinderportion|halbe Portion|Portion|Small|Medium|Large|Klein|Mittel|Groß|Gross|Piccolo|Grande|Glas|Flasche|Karaffe|Mittags|Abends)';
const RE_UNITWORD = /^\d+\s*(?:Monate|Monat|Stück|Stk\.?|Std\.?|Stunden|Jahre|Tage|Wochen|cm|mm|Scheiben|Kugeln?|Personen|x)\b/i;
const RE_SUPCODE = /^[\dA-Za-z*]{1,3}(?:\s*[,.]\s*[\dA-Za-z*]{1,3})*,?$/;
const isCaps = (t) => !!t && t === t.toUpperCase() && /[A-ZÄÖÜ]/.test(t);
const isDashLine = (l) => { const p = stripSup(l.head || ''); return /^[-–]\s?[A-ZÄÖÜ][A-ZÄÖÜ.]/.test(p) && p.length < 70; };
const RE_REGION = /^(deutschland|frankreich|italien|österreich|spanien|portugal|türkiye|türkei|griechenland|schweiz|südafrika|chile|argentinien|australien|neuseeland|usa|kalifornien|die neue welt|neue welt)( \| [\p{L} -]+)?$/iu;
const RE_BADGE = /\s*(?:\*{2,}\s*)?\b(NEU|NEW|HIGHLIGHT|TIPP|EMPFEHLUNG|HAUSGEMACHT)\b(?:\s*\*{2,})?\s*/;
const RE_LEGEND = /^(vegetarisch|vegan|leicht scharf|mittelscharf|mittel scharf|scharf|sehr scharf|vegetarian|mild spicy|medium spicy|spicy|hot|very hot)$/i;

const clean = (s) => s.replace(/­/g, '').replace(/[   ]/g, ' ').replace(/\s+/g, ' ').trim();
const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const stripSup = (s) => s.replace(/\{[^}]*\}/g, '');

export function normPrice(p) {
  return clean(p).replace(/€|EUR|Euro/g, '').trim().replace(/,[-–]+$/, ',00');
}

// ---------- Farben ----------
function toHex(a) {
  if (typeof a[0] === 'string') return a[0].toLowerCase();
  return '#' + [...a].slice(0, 3).map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}
function rgb(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex || '');
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [0, 0, 0];
}
function hueClass(hex) {
  const [r, g, b] = rgb(hex);
  if (g > r + 25 && g >= b) return 'green';
  if (r > g + 60 && r > b + 50 && g < 130) return 'red'; // orange (z. B. #ffb455) ist kein Chili
  return '';
}
function isNeutral(hex) {
  const [r, g, b] = rgb(hex);
  return Math.max(r, g, b) - Math.min(r, g, b) < 18;
}
function lum(hex) { const [r, g, b] = rgb(hex); return 0.299 * r + 0.587 * g + 0.114 * b; }

// ---------- 1. Text, Farben und Symbole aus der PDF holen ----------
async function scanOperators(pdfjsLib, page) {
  const OPS = pdfjsLib.OPS;
  const ol = await page.getOperatorList();
  const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
  const ap = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  let ctm = [1, 0, 0, 1, 0, 0], fill = '#000000';
  const st = [], shapes = [];
  let chars = '';
  const cols = [];
  for (let i = 0; i < ol.fnArray.length; i++) {
    const f = ol.fnArray[i], a = ol.argsArray[i];
    if (f === OPS.save) st.push([ctm, fill]);
    else if (f === OPS.restore) { const s = st.pop(); if (s) [ctm, fill] = s; }
    else if (f === OPS.transform) ctm = mul(ctm, a);
    else if (f === OPS.paintFormXObjectBegin) { st.push([ctm, fill]); if (a && a[0]) ctm = mul(ctm, a[0]); }
    else if (f === OPS.paintFormXObjectEnd) { const s = st.pop(); if (s) [ctm, fill] = s; }
    else if (f === OPS.setFillRGBColor) fill = toHex(a);
    else if (f === OPS.setFillGray) { const v = Math.round((a[0] <= 1 ? a[0] * 255 : a[0])); fill = toHex([v, v, v]); }
    else if (f === OPS.setFillCMYKColor) {
      const [c, m, y, k] = a.map((v) => (v > 1 ? v / 255 : v));
      fill = toHex([255 * (1 - c) * (1 - k), 255 * (1 - m) * (1 - k), 255 * (1 - y) * (1 - k)]);
    }
    else if (f === OPS.showText && a && a[0]) {
      for (const g of a[0]) if (g && g.unicode && g.unicode.trim()) { chars += g.unicode; cols.push(fill); }
    }
    else if (f === OPS.constructPath && a) {
      const mm = a[2];
      if (mm && isFinite(mm[0]) && hueClass(fill)) {
        const p1 = ap(ctm, mm[0], mm[1]), p2 = ap(ctm, mm[2], mm[3]);
        const s = { cls: hueClass(fill), fill, x0: Math.min(p1[0], p2[0]), x1: Math.max(p1[0], p2[0]), y0: Math.min(p1[1], p2[1]), y1: Math.max(p1[1], p2[1]) };
        if (s.x1 - s.x0 < 30 && s.y1 - s.y0 < 30) shapes.push(s);
      }
    }
  }
  return { chars, cols, shapes };
}

export async function extractPages(pdfjsLib, data) {
  const doc = await pdfjsLib.getDocument({ data, isEvalSupported: false, disableFontFace: true }).promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    let ops = { chars: '', cols: [], shapes: [] };
    try { ops = await scanOperators(pdfjsLib, page); } catch (e) { /* Farben/Symbole optional */ }
    const tc = await page.getTextContent();
    const fontCache = {};
    const fontInfo = (id) => {
      if (fontCache[id]) return fontCache[id];
      let name = '';
      try { const f = page.commonObjs.get(id); name = (f && (f.name || f.loadedName)) || ''; } catch (e) { /* ignore */ }
      const fam = (tc.styles[id] && tc.styles[id].fontFamily) || '';
      const full = name + ' ' + fam;
      return (fontCache[id] = { name: full, bold: RE_BOLD.test(full), italic: RE_ITALIC.test(full) });
    };
    const items = [];
    let ptr = 0;
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      // Farbe über die Zeichenfolge zuordnen
      let color = '#000000';
      const key = it.str.replace(/\s+/g, '');
      const k = ops.chars.indexOf(key, ptr);
      if (k >= 0 && k - ptr < 600) { color = ops.cols[k]; ptr = k + key.length; }
      const [a, b, c, d, e, f] = it.transform;
      if (Math.abs(b) > 0.01 && Math.abs(a) < 0.01) continue; // senkrechter Text
      const size = Math.hypot(c, d) || Math.hypot(a, b) || 10;
      const fi = fontInfo(it.fontName);
      let str = it.str;
      if (/^(?:\S {1,3}){3,}\S$/.test(str.trim())) str = str.trim().split(/ {2,}/).map((w) => w.replace(/ /g, '')).join(' ');
      items.push({ str, x: e, y: f, w: it.width, size, bold: fi.bold, italic: fi.italic, font: fi.name, color });
    }
    pages.push({ width: vp.width, height: vp.height, items, shapes: ops.shapes });
  }
  return pages;
}

// ---------- 2. Spalten erkennen ----------
function looksLikePriceColumn(items) {
  const txt = items.map((i) => clean(i.str)).filter(Boolean);
  if (!txt.length) return true;
  const pr = txt.filter((t) => RE_PRICE_ONLY.test(t) || RE_VOL_ONLY.test(t) || /^[|/€]$/.test(t) || new RegExp(`^(?:(?:${VOL_TOKEN}|${LABELS})\\s+)?${PRICE_TOKEN}$`, 'i').test(t)).length;
  return pr / txt.length > 0.6;
}

function splitColumns(page) {
  const items = page.items;
  if (items.length < 6) return [items];
  const W = Math.ceil(page.width) + 2;
  const cover = new Array(W).fill(0);
  let minX = W, maxX = 0;
  const medSz = median(items.map((i) => i.size));
  const narrow = items.filter((it) => it.w < page.width * 0.42 && it.size < medSz * 1.4);
  for (const it of narrow) {
    const x0 = Math.max(0, Math.floor(it.x)), x1 = Math.min(W - 1, Math.ceil(it.x + it.w));
    minX = Math.min(minX, x0); maxX = Math.max(maxX, x1);
    for (let x = x0; x <= x1; x++) cover[x]++;
  }
  const thr = Math.max(1, Math.round(narrow.length * 0.03));
  const gaps = [];
  let start = -1;
  for (let x = minX; x <= maxX; x++) {
    if (cover[x] <= thr) { if (start < 0) start = x; }
    else if (start >= 0) { if (x - start >= 8) gaps.push([start, x]); start = -1; }
  }
  const cuts = [];
  for (const [g0, g1] of gaps) {
    const mid = (g0 + g1) / 2;
    const nextCut = gaps.find(([a]) => a > g1);
    const rightPart = items.filter((i) => i.x >= mid && (!nextCut || i.x < nextCut[0]));
    const left = items.filter((i) => i.x + i.w <= mid);
    const minPart = Math.max(3, items.length * 0.12);
    if (left.length < minPart || rightPart.length < minPart) continue;
    if (looksLikePriceColumn(rightPart)) continue;
    // Spalte nur aus Nummern (01, 21, a, b, c …) links neben den Namen ist keine eigene Spalte
    const leftNear = left.filter((i) => i.x + i.w > mid - 40);
    if (leftNear.length && leftNear.filter((i) => /^(?:[A-Z]?\d{1,4}[a-z]?\.?|[a-h][.)]?)$/.test(clean(i.str)) || i.size < medSz * 0.75).length / leftNear.length > 0.8) continue;
    cuts.push(mid);
  }
  if (!cuts.length) return [items];
  // Überschrift quer über die Spalten mitten auf der Seite → Seite dort waagerecht teilen
  const midHead = items.filter((it) => it.size >= medSz * 1.2 && cuts.some((c) => it.x < c - 2 && it.x + it.w > c + 2))
    .filter((it) => items.filter((o) => o.y > it.y + it.size).length >= items.length * 0.15 && items.filter((o) => o.y < it.y - it.size * 0.5).length >= 3)
    .sort((a, b) => b.y - a.y)[0];
  if (midHead) return Object.assign([items], { splitAt: midHead.y, splitTol: midHead.size * 0.6 });
  const bounds = [-Infinity, ...cuts, Infinity];
  {
    // Überschrift in einer Spalte, darunter ein Kasten über alle Spalten (z. B. „Beilagen“ mit „Accessoires | Low-Carb“) → dort teilen
    const cOf = (it) => bounds.findIndex((b, i) => it.x >= b && it.x < bounds[i + 1]);
    const heads = items.filter((h) => h.size >= medSz * 1.2 && !cuts.some((c) => h.x < c - 2 && h.x + h.w > c + 2) &&
      items.filter((o) => o.y > h.y + h.size).length >= 3).sort((a, b) => b.y - a.y);
    for (const h of heads) {
      const hc = cOf(h);
      const cand = items.filter((o) => o.bold && o.y < h.y && o.y > h.y - h.size * 5);
      const row = cand.find((o) => cand.some((q) => q !== o && Math.abs(q.y - o.y) < 1.5 && cOf(q) !== cOf(o)));
      if (!row) continue;
      const clear = items.every((o) => cOf(o) === hc || o.y <= row.y + 1 || o.y >= h.y + h.size * 1.5);
      if (clear) return Object.assign([items], { splitAt: h.y, splitTol: h.size * 0.6 });
    }
  }
  const cols = bounds.slice(0, -1).map(() => []);
  const spanTop = [], spanBottom = [];
  const colOf = (it) => bounds.findIndex((b, i) => it.x >= b && it.x < bounds[i + 1]);
  // Überschrift, deren Wörter in mehreren Spalten landen (z. B. „ZUM STEAK ZWEI | BEILAGEN | NACH WAHL“) → als Ganzes behandeln
  const spanSet = new Set();
  const colLeft = bounds.slice(0, -1).map((b, k) => Math.min(...items.filter((i) => i.size < medSz * 1.3 && colOf(i) === k).map((i) => i.x)));
  const bigs = items.filter((i) => i.size >= medSz * 1.3);
  for (const it of bigs) {
    const row = bigs.filter((o) => Math.abs(o.y - it.y) < 2 && Math.abs(o.size - it.size) < 0.5).sort((a, b) => a.x - b.x);
    const tight = row.every((o, k) => !k || (o.x - (row[k - 1].x + row[k - 1].w) < it.size * 3 && !colLeft.some((x) => Math.abs(o.x - x) < 4)));
    if (tight && new Set(row.map(colOf)).size > 1) row.forEach((o) => spanSet.add(o));
  }
  const colTop = Math.max(...items.filter((i) => !spanSet.has(i) && !cuts.some((c) => i.x < c && i.x + i.w > c)).map((i) => i.y));
  for (const it of items) {
    const crosses = spanSet.has(it) || (cuts.some((c) => it.x < c - 2 && it.x + it.w > c + 2) && !(it.size < medSz * 0.8 && RE_SUPCODE.test(clean(it.str))));
    if (crosses) {
      // über der Mehrheit der Spaltenzeilen → oben (z. B. Überschrift unter einem Zitat-Block)
      const above = items.filter((o) => o !== it && o.y > it.y).length, below = items.filter((o) => o !== it && o.y < it.y).length;
      (it.y > colTop || above < below ? spanTop : spanBottom).push(it); continue;
    }
    const k = bounds.findIndex((b, i) => it.x >= b && it.x < bounds[i + 1]);
    cols[Math.max(0, k)].push(it);
  }
  // Preis, der über die Spaltengrenze ragt („KAISERSCHMARRN … // 16,90“), gehört zur Zeile links daneben
  for (let k = 1; k < cols.length; k++) {
    for (const it of [...cols[k]]) {
      const t = clean(it.str).replace(/^\/\/\s*/, '');
      if (!RE_PRICE_ONLY.test(t)) continue;
      const own = cols[k].some((o) => o !== it && Math.abs(o.y - it.y) < 2 && !RE_SUPCODE.test(clean(o.str)));
      const left = cols[k - 1].filter((o) => Math.abs(o.y - it.y) < 2);
      if (own || !left.length || left.some((o) => RE_PRICE_ONLY.test(clean(o.str).replace(/^\/\/\s*/, '')))) continue;
      // nur wenn der Text links direkt bis an den Preis heranreicht
      const nearL = Math.max(...cols[k - 1].filter((o) => Math.abs(o.y - it.y) < it.size).map((o) => o.x + o.w));
      if (!(it.x - nearL < 40)) continue;
      cols[k].splice(cols[k].indexOf(it), 1); cols[k - 1].push(it);
      // dazugehörige Hochzahl direkt davor mitnehmen
      for (const o of [...cols[k]]) if (o.y > it.y && o.y - it.y < it.size * 0.7 && o.size < it.size * 0.8 && RE_SUPCODE.test(clean(o.str)) && it.x - o.x < 40 && o.x < it.x) { cols[k].splice(cols[k].indexOf(o), 1); cols[k - 1].push(o); }
    }
  }
  return [spanTop, ...cols, spanBottom].filter((c) => c.length);
}

// Seite in waagerechte Bänder teilen (an großen Überschriften / großen Lücken),
// damit z. B. ein 2-spaltiges Raster und darunter ein 3-spaltiges getrennt erkannt werden.
function splitBands(page) {
  const items = [...page.items].sort((a, b) => b.y - a.y);
  const med = median(items.map((i) => i.size));
  const bands = [];
  let cur = [], lastY = null;
  for (const it of items) {
    const isHead = it.size >= med * 1.4;
    // nur trennen, wenn die neue Zeile klar unter der letzten liegt (nicht bei Preis/Hochzahl auf gleicher Höhe)
    const below = lastY !== null && lastY - it.y > it.size * 0.8;
    if (cur.length && below && (isHead && !(cur.every((c) => c.size >= med * 1.4)) || (lastY - it.y > med * 3.2))) { bands.push(cur); cur = []; }
    cur.push(it); lastY = it.y;
  }
  if (cur.length) bands.push(cur);
  return bands;
}
function pageColumns(page, depth = 0) {
  const cols = splitColumns(page);
  if (cols.splitAt !== undefined && depth < 4) {
    const up = page.items.filter((i) => i.y > cols.splitAt + cols.splitTol), low = page.items.filter((i) => i.y <= cols.splitAt + cols.splitTol);
    if (up.length && low.length) return [...pageColumns({ ...page, items: up }, depth + 1), ...pageColumns({ ...page, items: low }, depth + 1)];
  }
  if (cols.splitAt !== undefined) return [page.items];
  if (cols.length > 1) return cols;
  const bands = splitBands(page);
  if (bands.length < 2) return cols;
  return bands.flatMap((b) => splitColumns({ width: page.width, height: page.height, items: b }));
}

// ---------- 3. Zeilen bauen ----------
function buildLines(items) {
  const sorted = [...items].sort((a, b) => b.size - a.size);
  const lines = [];
  for (const it of sorted) {
    let best = null;
    for (const ln of lines) {
      const tol = Math.max(1.5, ln.size * 0.3);
      if (Math.abs(ln.y - it.y) <= tol && it.size >= ln.size * 0.8) { best = ln; break; }
      if (it.size < ln.size * 0.8 && it.size > ln.size * 0.3 && RE_SUPCODE.test(it.str.trim()) && it.y >= ln.y - 0.5 && it.y - ln.y < Math.min(ln.size * 0.65, 9) &&
          it.x >= ln.x0 - ln.size * 1.2 && it.x <= ln.x1 + ln.size * 1.5) { best = ln; it.sup = true; break; }
    }
    if (!best) { best = { y: it.y, size: it.size, items: [], x0: it.x, x1: it.x + it.w }; lines.push(best); }
    best.items.push(it);
    best.x0 = Math.min(best.x0, it.x); best.x1 = Math.max(best.x1, it.x + it.w);
  }
  lines.sort((a, b) => (Math.abs(a.y - b.y) < 2.5 && Math.abs(a.size - b.size) > 4 ? b.size - a.size : b.y - a.y || a.x0 - b.x0));
  return lines.map(finishLine);
}

// Text aus Bausteinen zusammensetzen; Hochstellungen als {…}
function joinTokens(tokens, size) {
  let out = '', prevEnd = -1e9, lastWasSup = false;
  for (const it of tokens) {
    const s = it.str;
    if (it.sup) {
      const t = clean(s);
      if (!t) continue;
      if (out.endsWith('}') && lastWasSup) out = out.slice(0, -1) + (/[,]$/.test(out.slice(0, -1)) || /^,/.test(t) ? '' : '') + t + '}';
      else out = out.replace(/\s+$/, '') + '{' + t + '}';
      lastWasSup = true; prevEnd = Math.max(prevEnd, it.x + it.w);
      continue;
    }
    const gap = it.x - prevEnd;
    if (out && !/\s$/.test(out) && !/^\s/.test(s)) {
      if (gap > size * 0.15) out += ' ';
      else if (lastWasSup && /[\p{L}\d)]$/u.test(stripSup(out)) && /^[\p{L}\d(]/u.test(s)) out += ' ';
    }
    out += s;
    prevEnd = it.x + it.w;
    lastWasSup = false;
  }
  return clean(out).replace(/\{\s*,?/g, '{').replace(/,?\s*\}/g, '}').replace(/\s*\|\s*/g, ' | ');
}

function finishLine(ln) {
  const its = ln.items.sort((a, b) => a.x - b.x);
  const main = its.filter((i) => !i.sup);
  const size = median(main.map((i) => i.size)) || ln.size;
  // Segmente: große Lücke (Tab) trennt
  const segToks = [];
  let cur = null, prevEnd = -1e9;
  for (const it of its) {
    const gap = it.x - prevEnd;
    if (!it.sup && (!cur || gap > size * 1.2)) { cur = []; segToks.push(cur); }
    if (!cur) { cur = []; segToks.push(cur); }
    cur.push(it);
    prevEnd = Math.max(prevEnd, it.x + it.w);
  }
  let segs = segToks.map((t) => ({ text: joinTokens(t, size), x0: t[0].x, bold: t.filter((i) => !i.sup).every((i) => i.bold) }));
  // Füllpunkte "......" trennen wie ein Tabulator
  segs = segs.flatMap((s) => s.text.split(/\s*(?:[.·…_]\s?){3,}\s*|\s*\/\/\s*/).filter((t) => t && t.trim()).map((t) => ({ ...s, text: t.trim() })));
  // Fetter Anfang + normaler Rest in derselben Zeile ("Sen Mie: Faden-Reisnudeln")
  let boldPrefix = '';
  if (main.length > 1 && main[0].bold) {
    let j = 0;
    while (j < its.length && (its[j].bold || its[j].sup)) j++;
    const rest = its.slice(j).filter((r) => !r.sup);
    const restTxt = clean(rest.map((r) => r.str).join(' '));
    if (rest.length && rest.some((r) => !r.bold) && !/^[|/]/.test(restTxt) &&
        rest.every((r) => !r.bold || RE_PRICE_ONLY.test(clean(r.str)))) {
      boldPrefix = joinTokens(its.slice(0, j), size).replace(/\s*(?:[.·…_]\s?){3,}.*$/, '');
    }
  }
  const chars = main.reduce((n, i) => n + i.str.length, 0) || 1;
  const share = (fn) => main.filter(fn).reduce((n, i) => n + i.str.length, 0) / chars;
  // Hauptfarbe der Zeile (nach Zeichen gewichtet, Zahlen am Zeilenanfang zählen nicht)
  const colCount = {};
  for (const i of main) if (!/^\s*[\d.,€]+\s*$/.test(i.str)) colCount[i.color] = (colCount[i.color] || 0) + i.str.length;
  const color = Object.entries(colCount).sort((a, b) => b[1] - a[1])[0]?.[0] || '#000000';
  return {
    y: ln.y, x0: ln.x0, x1: ln.x1, size, minSize: Math.min(size, ...ln.items.filter((i) => !i.sup && !(RE_SUPCODE.test(i.str.trim()) && i.size < size * 0.75)).map((i) => i.size)),
    segs: segs.filter((s) => s.text),
    boldPrefix,
    bold: share((i) => i.bold) > 0.6 || (!!boldPrefix && stripSup(boldPrefix).length >= 2),
    italic: share((i) => i.italic) > 0.6,
    color,
    font: (main[0] && main[0].font) || '',
    text: clean(segs.map((s) => s.text).join(' ')),
    icons: { green: 0, red: 0 },
  };
}

// ---------- 4. Preis/Menge am Zeilenende abtrennen ----------
const RE_TAIL = new RegExp(
  `((?:(?:${LABELS}\\s)?(?:${VOL_TOKEN})?(?:\\s${LABELS})?\\s*(?:${PRICE_TOKEN})\\s*(?:[|/·•]\\s*)?)+)$`, 'i');
const RE_PAIR = new RegExp(`(?:((?:${LABELS}\\s)?${VOL_TOKEN}(?:\\s${LABELS})?|${LABELS})\\s*)?(${PRICE_TOKEN})`, 'gi');
const RE_TAILSEG = new RegExp(`^(?:(?:${LABELS}\\s)?(?:${VOL_TOKEN})(?:\\s${LABELS})?\\s*)?${PRICE_TOKEN}(?:\\s*[|/·•]?\\s*(?:(?:${LABELS}\\s)?(?:${VOL_TOKEN})(?:\\s${LABELS})?\\s*)?${PRICE_TOKEN})*$`, 'i');

const RE_LABELPAIRS = new RegExp(`^(?:${VLABEL}(?:\\s?\\d+\\s?(?:g|cl|l))?\\s+(?:${PRICE_TOKEN})\\s*)+$`, 'i');
const RE_LABELPAIR = new RegExp(`(${VLABEL}(?:\\s?\\d+\\s?(?:g|cl|l))?)\\s+(${PRICE_TOKEN})`, 'gi');
function splitTail(line) {
  // „Vorspeise 10,90 Hauptgang 18,90“ / „Small 29,00 Large 39,00“
  const whole = stripSup(line.text).replace(/\s*\/\/\s*/g, ' ').trim();
  if (RE_LABELPAIRS.test(whole)) {
    const variants = [];
    let m;
    RE_LABELPAIR.lastIndex = 0;
    while ((m = RE_LABELPAIR.exec(whole))) variants.push({ size: m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase(), price: normPrice(m[2]) });
    return { head: '', variants, pendingSize: '' };
  }
  const segs = line.segs;
  let k = segs.length;
  while (k > 0) {
    const t = segs[k - 1].text;
    if (RE_PRICE_ONLY.test(t) || RE_VOL_ONLY.test(t) || /^[|/·•€]$/.test(t) || RE_TAILSEG.test(t)) k--;
    else break;
  }
  // eine einzelne Ganzzahl ganz links ist eine Nummer, kein Preis
  if (k === 0 && segs.length > 1 && /^\d{1,3}$/.test(segs[0].text)) k = 1;
  let head = segs.slice(0, k).map((s) => s.text).join(' ');
  let tail = segs.slice(k).map((s) => s.text).join(' ');
  if (!tail) {
    const m = stripSup(head) === head ? head.match(RE_TAIL) : head.replace(/\{[^}]*\}(?=[^{]*$)/, '').match(RE_TAIL);
    if (m && m.index > 0) {
      const t = m[1].trim();
      const lastTok = t.split(/\s+/).pop();
      const lastTwo = t.split(/\s+/).slice(-2).join(' ');
      if (RE_DEC_PRICE.test(lastTok) || RE_DEC_PRICE.test(lastTwo)) {
        const idx = head.lastIndexOf(t);
        if (idx > 0) { tail = t; head = head.slice(0, idx).trim(); }
      }
    }
  } else {
    const vm = head.match(new RegExp(`\\s((?:${LABELS}\\s)?${VOL_TOKEN}(?:\\s${LABELS})?)$`, 'i'));
    if (vm) { tail = vm[1] + ' ' + tail; head = head.slice(0, vm.index).trim(); }
  }
  if (!head && tail && !/\d/.test(tail)) { head = tail; tail = ''; }
  // Spaltenköpfe „0,3 l   0,5 l“ über einer Preisliste
  if (tail) {
    const vols = tail.match(new RegExp(`(?:${LABELS}\\s)?${VOL_TOKEN}`, 'gi'));
    if (vols && vols.length >= 2 && tail.replace(new RegExp(`(?:${LABELS}\\s)?${VOL_TOKEN}`, 'gi'), '').trim() === '') { return { head: head.trim(), variants: [], pendingSize: '', headerSizes: vols.map((v) => clean(v)) }; }
  }
  const variants = [];
  let pendingSize = '';
  if (tail) {
    const toks = tail.replace(/[|·•]/g, ' ').replace(/\s\/\s/g, ' ');
    let m;
    RE_PAIR.lastIndex = 0;
    while ((m = RE_PAIR.exec(toks))) variants.push({ size: clean(m[1] || ''), price: normPrice(m[2]) });
    if (!variants.length && RE_VOL_ONLY.test(tail.trim())) pendingSize = tail.trim();
  }
  return { head: head.trim(), variants, pendingSize, headerSizes: null };
}

// ---------- 5. Symbole (Blatt = vegetarisch/vegan, Chili = Schärfe) den Zeilen zuordnen ----------
function assignIcons(lines, pages) {
  pages.forEach((pg, pi) => {
    for (const s of pg.shapes || []) {
      const cx = (s.x0 + s.x1) / 2, cy = (s.y0 + s.y1) / 2;
      let best = null, bd = 1e9;
      for (const l of lines) {
        if (l.page !== pi) continue;
        if (cy < l.y - l.size * 0.5 || cy > l.y + l.size * 1.3) continue;
        if (cx < l.x0 - 4 || cx > l.x1 + l.size * 5) continue;
        const d = Math.abs(cy - (l.y + l.size * 0.35)) + (cx > l.x1 ? (cx - l.x1) / 10 : 0);
        if (d < bd) { bd = d; best = l; }
      }
      if (best) best.icons[s.cls]++;
    }
  });
}

// ---------- 6. Rollen bestimmen und Struktur bauen ----------

// ---------- Schreibweise ----------
const normUnitLabel = (t) => { const l = t.toLowerCase().replace(/\s+/g, ' '); return /^p\.\s?p\.$/.test(l) ? 'pro Person' : l.replace(/(person|kugel|stück|portion)$/, (m) => m.charAt(0).toUpperCase() + m.slice(1)); };
const KEEP_UP = new Set(['DOC', 'DOCG', 'IGT', 'AOC', 'VDP', 'BBQ', 'XO', 'VS', 'VSOP', 'XXO', 'IPA', 'USA', 'U.S.', 'DJ', 'TV', 'EU', 'UK', 'NY', 'BLT', 'XL', 'XXL', 'KG', 'II', 'III', 'IV', 'VI', 'VII', 'VIII', 'IX', 'XI', 'XII', 'P2', 'DOCa', 'DO', 'IGP', 'AOP', 'DOP', 'QBA', 'GG']);
const SMALL = new Set(['mit', 'und', 'oder', 'von', 'vom', 'der', 'die', 'das', 'den', 'dem', 'in', 'im', 'am', 'an', 'auf', 'aus', 'zum', 'zur', 'nach', 'für', 'ohne', 'bei', 'e', 'di', 'del', 'della', 'delle', 'dei', 'al', 'alla', 'con', 'à', 'de', 'des', 'du', 'and', 'of', 'with', 'or', 'en', 'y', 'je', 'pro', 'p.', 'ab']);
const UNIT1 = new Set(['L', 'G', 'CL', 'ML', 'KG']);
function capWord(w) {
  // „D'ASTI“ → „D'Asti“, „OMA'S“ → „Oma's“
  const m = w.match(/^(\P{L}*)(\p{L})(.*)$/u);
  if (!m) return w;
  let rest = m[3].toLowerCase();
  rest = rest.replace(/^(\p{L}{0,4})(['’])(\p{L}{3,})/u, (x, a, q, b) => a + q + b.charAt(0).toUpperCase() + b.slice(1));
  return m[1] + m[2] + rest;
}
function normCase(t, isSize = false) {
  if (!t || !/[A-ZÄÖÜ]{2}|\d\s?[A-Z]\b/.test(t)) return t;
  // Hochstellungen {…} unangetastet lassen
  const parts = t.split(/(\{[^}]*\})/);
  let first = true;
  return parts.map((p) => {
    if (/^\{/.test(p)) return p;
    return p.replace(/[^\s|/]+/g, (w, off, str) => {
      const letters = w.replace(/[^\p{L}]/gu, '');
      const isFirst = first && /\p{L}/u.test(w); if (/\p{L}/u.test(w)) first = false;
      if (/^[·–]$|[.!?:]$/.test(w)) first = true;
      if (!letters || letters !== letters.toUpperCase() || letters.length < 2 && !(isSize || /^\d/.test(w))) {
        if (letters.length === 1 && UNIT1.has(letters) && /\d\s*$/.test(str.slice(0, off))) return w.toLowerCase();
        return w;
      }
      const bare = w.replace(/^[„"“(]+|[“”",.:;!?)]+$/g, '');
      if (KEEP_UP.has(bare) || /^([A-Z]\.)+[A-Z]?$/.test(bare) || /^[A-Z]\d*$/.test(bare) && !isSize && !UNIT1.has(bare)) return w;
      if (/^\d/.test(w)) return w.toLowerCase(); // 220G → 220g, 5ÉME → 5éme
      if (UNIT1.has(letters) && /\d\s*$/.test(str.slice(0, off))) return w.toLowerCase();
      const low = w.toLowerCase();
      if (!isFirst && SMALL.has(low.replace(/[^\p{L}.]/gu, ''))) return low;
      return w.split(/([-&/])/).map((x) => (/^[-&/]$/.test(x) ? x : capWord(x))).join('');
    });
  }).join('').replace(/ À La /g, ' à la ').replace(/ À /g, ' à ');
}
// „Z U M“ → „ZUM“
const joinSpaced = (t) => (t ? t.replace(/(^|\s)((?:[A-ZÄÖÜ] ){2,}[A-ZÄÖÜ])(?=\s|$)/g, (m, a, b) => a + b.replace(/ /g, '')) : t);

export function parseMenu(pages) {
  let lines = [];
  pages.forEach((pg, pi) => {
    const medPg = median(pg.items.map((i) => i.size)) || 10;
    pageColumns(pg).forEach((col, ci) => {
      let blk = 0, prevY = null, prevBig = false;
      for (const ln of buildLines(col)) {
        // neuer Block bei großer Überschrift oder großer Lücke (z. B. Werbekasten neben der Karte)
        const big = ln.size >= medPg * 1.4;
        if (prevY !== null && ((big && !prevBig) || (!big && prevY - ln.y > medPg * 3) || (big && prevBig && prevY - ln.y > ln.size * 2.5))) blk++;
        prevY = ln.y; prevBig = big;
        ln.page = pi; ln.block = pi * 10000 + ci * 100 + blk; ln.relY = ln.y / pg.height;
        lines.push(ln);
      }
    });
  });
  lines = lines.filter((l) => l.text && !((l.relY < 0.07 || l.relY > 0.93) && /^(?:seite\s*)?\d{1,3}(?:\s*\/\s*\d{1,3})?$/i.test(l.text)));
  assignIcons(lines, pages);

  for (const l of lines) Object.assign(l, splitTail(l));

  // Legende der Symbole erkennen → Einheit (wie viele Formen ergeben ein Symbol)
  let unitG = 1, unitR = 1;
  for (const l of lines) {
    if (RE_LEGEND.test(stripSup(l.head || l.text)) && !l.variants.length) {
      l.role = 'legend';
      const t = l.text.toLowerCase();
      if (t === 'vegetarisch' && l.icons.green) unitG = l.icons.green;
      if (/^leicht scharf|^mild spicy/.test(t) && l.icons.red) unitR = l.icons.red;
    }
  }
  // Ohne Legende mit Symbolen sind farbige Formen nur Deko (Tomaten, Basilikum …)
  const legendG = lines.some((l) => l.role === 'legend' && l.icons.green), legendR = lines.some((l) => l.role === 'legend' && l.icons.red);
  for (const l of lines) { if (!legendG) l.icons.green = 0; if (!legendR) l.icons.red = 0; }

  // Statistik
  const priced = lines.filter((l) => !l.role && l.variants.length && l.head);
  const nameSize = median(priced.map((l) => l.size)) || median(lines.map((l) => l.size));
  const descSize = median(lines.filter((l) => !l.variants.length && !l.bold).map((l) => l.size)) || nameSize;
  const namesBoldRaw = priced.length ? priced.filter((l) => l.bold).length / priced.length > 0.5 : true;
  // Fett ist nur ein Merkmal, wenn Beschreibungen NICHT auch fett sind
  const smallLines = lines.filter((l) => !l.role && !l.variants.length && l.size < nameSize * 0.95);
  const namesAreBold = namesBoldRaw && (!smallLines.length || smallLines.filter((l) => l.bold).length / smallLines.length < 0.5);
  const nameColCount = {};
  priced.forEach((l) => { nameColCount[l.color] = (nameColCount[l.color] || 0) + 1; });
  const nameColor = Object.entries(nameColCount).sort((a, b) => b[1] - a[1])[0]?.[0] || '#000000';
  // farbig/grau abgesetzte Zeile – nur fett oder größer (Beschreibungen sind oft grau)
  const accent = (l) => l.color !== nameColor && (!isNeutral(l.color) || Math.abs(lum(l.color) - lum(nameColor)) > 40) &&
    (namesAreBold ? (l.bold || l.size >= nameSize * 0.98) : l.size >= nameSize * 0.98);

  // Riesige Schmuck-Überschrift neben dem Inhalt (z. B. „Pasta“ in Schreibschrift links neben der Liste) → an den Seitenanfang
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i], nx = lines[i + 1];
    if (l._moved || l.variants.length || l.size < nameSize * 4 || stripSup(l.text).length > 30 || !nx || nx.page !== l.page) continue;
    if (!(l.x1 < nx.x0 || l.x0 > nx.x1)) continue;
    if (lines.some((o) => o !== l && o.page === l.page && Math.abs(o.size - l.size) < l.size * 0.2 && Math.abs(o.y - l.y) < l.size * 1.5)) continue;
    const first = lines.findIndex((x) => x.page === l.page);
    if (first >= i) continue;
    lines.splice(i, 1); lines.splice(first, 0, l); l._moved = true;
  }
  // Seiten ohne einen einzigen Preis sind keine Speisekarte (Gutschein, Feiern, Titelseite, Sprüche)
  // Bewertet je Spalte/Seite: Preise, Gerichtsnummern, Zusatzstoffe → Speisekarte; sonst Werbung/Sprüche
  const blockScore = {};
  for (const l of lines) {
    const sc = (l.variants.length || l.headerSizes ? 2 : 0) + (RE_ITEMNR.test(stripSup(l.text)) && !RE_UNITWORD.test(stripSup(l.text)) ? 1 : 0) + (/\{[^}]+\}/.test(l.text) ? 1 : 0);
    blockScore[l.block] = (blockScore[l.block] || 0) + sc;
  }
  const pricedPage = {};
  const blockCount = {};
  for (const l of lines) blockCount[l.block] = (blockCount[l.block] || 0) + 1;
  // einzelne kurze Zeilen (z. B. „+ 1 Softdrink deiner Wahl“) nicht als Werbung werten
  for (const l of lines) if ((blockScore[l.block] || 0) >= 1 || (blockCount[l.block] === 1 && l.text.length < 60 && l.size < nameSize * 1.25)) pricedPage[l.block] = true;
  // Überschriften behalten, wenn direkt danach Speisekarte folgt
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (pricedPage[l.block] || l.size < nameSize * 1.25) continue;
    // nur wenn die Überschrift (evtl. mit Untertitel) einen eigenen kleinen Block bildet
    if (lines.filter((x) => x.block === l.block).length > 4) continue;
    // bis zur nächsten Überschrift (gleiche Seite) folgt ein Block mit Speisekarte?
    let ok = false;
    for (let j = i + 1; j < lines.length; j++) {
      const x = lines[j];
      if (x.page !== l.page) break;
      if (x.block !== l.block && x.size >= nameSize * 1.25) break;
      if (pricedPage[x.block]) { ok = true; break; }
    }
    if (ok) { for (const x of lines) if (x.block === l.block) x.keep = true; }
  }

  let inFootnote = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i], prev = lines[i - 1];
    if (l.role === 'legend') continue;
    const t = l.head;
    const plain = stripSup(t);
    // Fußnoten (Allergene/Zusatzstoffe) – auch die Folgezeilen
    if (!l.variants.length && RE_FOOTNOTE.test(plain) && l.size <= descSize * 1.05) { l.role = 'footnote'; inFootnote = l.size; continue; }
    if (inFootnote && !l.variants.length && l.size < inFootnote + 0.6 && prev && prev.page === l.page) { l.role = 'footcont'; continue; }
    inFootnote = 0;
    if (!pricedPage[l.block] && !l.keep) { l.role = 'ignored'; continue; }
    // verwaiste Hochzahl („5“ in 5-pt-Schrift) ist kein Preis
    if (l.size < nameSize * 0.7 && clean(stripSup(l.text)).split(' ').every((w) => RE_SUPCODE.test(w))) { l.role = 'ignored'; continue; }
    if (!t && l.variants.length) { l.role = 'price'; continue; }
    if (!t && l.pendingSize) { l.role = 'size'; continue; }
    if (!t && l.headerSizes) { l.role = 'sizes'; continue; }
    if (!l.variants.length && /^\*{0,3}\s*(NEU|NEW|HIGHLIGHT|TIPP|EMPFEHLUNG)\s*\*{0,3}$/i.test(plain)) { l.role = 'badge'; continue; }
    const big = l.size >= nameSize * 1.25;
    // einzelne Zier-Buchstaben (Initialen) sind Deko
    if (!l.variants.length && !/\d/.test(l.text) && stripSup(l.text).replace(/[^\p{L}]/gu, '').length <= 2 && l.size >= nameSize * 1.25) { l.role = 'ignored'; continue; }
    if (big && !l.variants.length && plain.length < 70) { l.role = 'heading'; continue; }
    if (big && l.variants.length && plain.length < 40 && /[A-ZÄÖÜ]{3}/.test(plain)) { l.role = 'heading'; l.head = l.text; continue; }
    // Zwischenzeilen: farbig abgesetzt oder „…:“ / „…!“, ohne Preis
    if (!l.variants.length && !l.icons.green && !l.icons.red &&
        ((accent(l) && l.size >= descSize * 0.95) || (/[:!]$/.test(plain) && plain.length < 60 && l.bold))) { l.role = 'sub'; continue; }
    if (l.variants.length) { l.role = 'item'; l.dash = isDashLine(l); continue; }
    const caps = plain.length > 2 && plain === plain.toUpperCase() && /[A-ZÄÖÜ]/.test(plain);
    const next = lines[i + 1];
    // Aufzählung mit Strich („-POMMES FRITES“) → je Zeile ein Eintrag
    if (isDashLine(l) && !l.variants.length) { l.role = 'item'; l.dash = true; continue; }
    if (caps && !l.variants.length && plain.length < 40 && next && next.page === l.page && isDashLine(next) && (l.bold || l.size > next.size * 1.05)) { l.role = 'sub'; continue; }
    const nameLike = (l.bold && namesAreBold && l.size >= descSize * 0.98) || (!namesAreBold && l.size >= nameSize * 0.98 && l.size > descSize * 1.05);
    if (nameLike && caps && next && (next.variants.length || next.bold) && plain.length < 50 && l.size > nameSize * 1.05) { l.role = 'heading'; continue; }
    if (nameLike && !RE_UNITWORD.test(plain)) { l.role = 'item'; continue; }
    // „6 frittierte …“ in normaler Schrift ist Beschreibung, keine Nummer
    if (RE_ITEMNR.test(plain) && !RE_COUNT.test(plain) && !RE_UNITWORD.test(plain) && l.size >= descSize && plain.length < 60 &&
        (namesAreBold ? l.bold : l.size >= nameSize * 0.98) && !/^\d+\s*(?:cl|ml|l|g)\b/i.test(plain)) { l.role = 'item'; continue; }
    l.role = 'desc';
  }

  // Mengenangabe oben neben der Überschrift („FLASCHE 0,75 L“) gilt für den ganzen Bereich
  const RE_LABEL_ONLY = new RegExp(`^${LABELS}$`, 'i');
  for (const l of lines) {
    if (l.role !== 'size') continue;
    const head = lines.filter((h) => h.role === 'heading' && h.page === l.page && Math.abs(h.y - l.y) < h.size * 2.5)
      .sort((a, b) => Math.abs(a.y - l.y) - Math.abs(b.y - l.y))[0];
    if (!head) continue;
    // „FLASCHE“ und „0,75 L“ getrennt? → zusammensetzen
    const lab = lines.find((o) => o !== l && o.page === l.page && Math.abs(o.y - l.y) < 2 && RE_LABEL_ONLY.test(stripSup(o.head || o.text)) && !o.variants.length);
    let size = l.pendingSize;
    if (lab && !new RegExp(LABELS, 'i').test(size)) { size = stripSup(lab.text) + ' ' + size; lab.role = 'ignored'; }
    if (!head.defSize) head.defSize = size;
    l.role = 'ignored';
  }
  for (const l of lines) {
    // übrig gebliebenes einzelnes „FLASCHE“ neben der Überschrift
    if (l.role === 'desc' && RE_LABEL_ONLY.test(stripSup(l.text)) && lines.some((h) => h.role === 'heading' && h.defSize && h.page === l.page && Math.abs(h.y - l.y) < h.size * 2.5)) l.role = 'ignored';
  }

  // Farben aus der PDF (für „Farben übernehmen“)
  const topColor = (arr) => { const c = {}; arr.forEach((x) => { if (x && !isNeutral(x)) c[x] = (c[x] || 0) + 1; }); return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0] || ''; };
  const shapeCol = (cls) => topColor(pages.flatMap((p) => (p.shapes || []).filter((s) => s.cls === cls).map((s) => s.fill)));
  const colors = {};
  const ct = topColor(lines.filter((l) => l.role === 'heading').map((l) => l.color));
  const ca = topColor(lines.filter((l) => l.role === 'sub').map((l) => l.color));
  if (ct) colors.title = ct;
  if (ca || ct) colors.accent = ca || ct;
  const cv = shapeCol('green'), cc = shapeCol('red');
  if (cv) colors.veg = cv;
  if (cc) colors.chili = cc;

  // Struktur
  const menu = { sections: [], notes: [], colors };
  let sec = null, item = null, lastLine = null;
  const newSection = (title) => { sec = { title, note: '', items: [] }; menu.sections.push(sec); item = null; };
  const appendText = (base, add) => {
    if (!base) return add;
    if (/[a-zäöüß]-$/.test(base) && /^[a-zäöüß]/.test(add) && !/^(und|oder|bzw|sowie)\b/.test(add)) return base.slice(0, -1) + add;
    if (/[\p{L}]-$/u.test(base) && /^[A-ZÄÖÜ]/.test(add)) return base + add; // „Thai-“ + „Basilikum“
    return base + ' ' + add;
  };
  const iconFlags = (l) => {
    const g = Math.round(l.icons.green / unitG), r = Math.round(l.icons.red / unitR);
    return { veg: g >= 2 ? 'vegan' : g === 1 ? 'vegetarisch' : '', spice: Math.min(3, r) };
  };
  let pendingSize = '', pendingBadge = '';
  for (const l of lines) {
    const gapToLast = lastLine && lastLine.page === l.page ? lastLine.y - l.y : 999;
    if (l.role === 'legend' || l.role === 'ignored') continue;
    if (l.role === 'footnote') { menu.notes.push(l.text); lastLine = l; continue; }
    if (l.role === 'footcont') { if (menu.notes.length) menu.notes[menu.notes.length - 1] = appendText(menu.notes[menu.notes.length - 1], l.text); lastLine = l; continue; }
    if (l.role === 'heading') {
      const prevLine = lastLine;
      if (sec && !sec.items.length && !sec.note && sec.title && prevLine && prevLine.role === 'heading' && prevLine.page === l.page && gapToLast < l.size * 2.2 && Math.max(prevLine.size, l.size) < Math.min(prevLine.size, l.size) * 1.5) {
        sec.title += ' ' + l.head; lastLine = l; continue; // zweizeilige Überschrift
      }
      newSection(l.head); if (l.defSize) sec._defSize = l.defSize; lastLine = l; continue;
    }
    if (!sec) newSection('');
    if (l.role === 'size') { pendingSize = l.pendingSize; lastLine = l; continue; }
    if (l.role === 'sizes') { sec._sizes = l.headerSizes; lastLine = l; continue; }
    if (l.role === 'badge') { const b = stripSup(l.head).replace(/\*/g, '').trim(); pendingBadge = b.charAt(0) + b.slice(1).toLowerCase(); continue; }
    if (l.role === 'price') {
      if (item && item.type !== 'sub') for (const v of l.variants) item.variants.push({ size: v.size || pendingSize, price: v.price });
      pendingSize = ''; lastLine = l; continue;
    }
    if (l.role === 'sub') {
      const last = sec.items[sec.items.length - 1];
      // Untertitel direkt unter dem Gerichtsnamen („Glasnudelsuppe“)
      if (item && item.type !== 'sub' && last === item && !item.desc && item.variants.length && lastLine && lastLine === item._line && gapToLast < l.size * 1.6 && !/[:!]$/.test(stripSup(l.head))) {
        item.desc = l.head + ' –'; lastLine = l; l.role = 'subtitle'; continue;
      }
      // zweizeilige Zwischenzeile
      if (last && last.type === 'sub' && lastLine && lastLine.role === 'sub' && gapToLast < l.size * 1.6 && !/[.:!]$/.test(stripSup(last.name))) {
        last.name = appendText(last.name, l.head); lastLine = l; continue;
      }
      sec.items.push({ type: 'sub', name: l.head });
      item = null; lastLine = l; continue;
    }
    // Beschreibungszeile mit weiterem Preis („(Dry Aged …) FOR 3 194,90“, „12 Std. im Ofen … FOR 2 800 G 94,00“)
    if (l.role === 'item' && item && item.type !== 'sub' && item.variants.length && l.variants.length && l.head && !RE_ITEMNR.test(stripSup(l.head)) && (!l.bold || l.minSize < item._size * 0.85) &&
        (/^[(a-zäöü]/.test(stripSup(l.head)) || RE_UNITWORD.test(stripSup(l.head)) || (l.size < item._size * 0.97 && stripSup(l.head).length > 25) || (l.minSize < item._size * 0.85 && / \| /.test(l.head))) &&
        lastLine && lastLine.page === l.page && lastLine.y - l.y < l.size * 3) {
      l.role = 'desc';
    }
    if (l.role === 'item' && item && item.type !== 'sub' && !item.variants.length && l.variants.length && !l.boldPrefix &&
        (namesAreBold ? (!l.bold && item._bold) : l.size < item._size * 0.95)) {
      l.role = 'desc'; // Preis steht in der letzten Beschreibungszeile
    }
    if (l.role === 'item') {
      // Umbrochener Name
      if (item && !item.variants.length && !item.desc && item._bold === l.bold && Math.abs(item._size - l.size) < 0.3 && !RE_ITEMNR.test(l.head) &&
          !(l.segs.length > 1 && /^[a-h]$/.test(l.segs[0].text)) && l.head && gapToLast < l.size * 1.6 &&
          (/^[a-zäöü(&]/.test(l.head) ||
           // zweizeiliger Name (z. B. Weingut / Wein, Preis in der zweiten Zeile): gleiche Schrift, ohne Nr., erste Zeile ohne Zusatzstoffe
           (!item.nr && !item.sup && !/\}$/.test(item.name) && !/^[-–•+]/.test(l.head) && !RE_REGION.test(item.name.trim()) && item._color === l.color && l.variants.length && lastLine === item._line))) {
        item.name = appendText(item.name, l.head);
        item.variants.push(...l.variants);
        Object.assign(item, mergeFlags(item, iconFlags(l)));
        lastLine = l; continue;
      }
      // Sortengruppe ohne eigenen Preis („Orangensaft | Apfelsaft 3,5“ / „Maracujanektar | KiBa“)
      if (item && !l.variants.length && item.variants.length && !item.desc && !item.nr && / \| /.test(item.name) &&
          / \| /.test(l.head) && !RE_ITEMNR.test(l.head) && gapToLast < l.size * 1.8 && sec.items[sec.items.length - 1] === item) {
        item.name += ' | ' + l.head; lastLine = l; continue;
      }
      let name = l.head, nr = '', inlineDesc = '';
      if (l.boldPrefix && !/^\*{0,3}\s*(NEU|NEW|HIGHLIGHT|TIPP|VEGAN|EMPFEHLUNG)\s*\*{0,3}$/i.test(stripSup(l.boldPrefix).trim()) && name.startsWith(l.boldPrefix) && name.length > l.boldPrefix.length + 2) {
        inlineDesc = name.slice(l.boldPrefix.length).replace(/^[\s–—\-:|,]+/, '').trim();
        name = l.boldPrefix.replace(/[\s–—\-:|,]+$/, '');
      }
      const m = name.match(RE_ITEMNR);
      if (m && name.length > m[0].length && !RE_COUNT.test(name) && !RE_UNITWORD.test(name)) { nr = m[1]; name = name.slice(m[0].length); }
      else if (l.segs.length > 1 && /^(?:\d{1,3}[a-zA-Z]?|[a-h])\.?$/.test(l.segs[0].text) && !RE_COUNT.test(name) && !RE_UNITWORD.test(name)) {
        nr = l.segs[0].text.replace(/\.$/, ''); name = name.slice(l.segs[0].text.length).trim();
      }
      name = name.replace(/[\s:]+$/, '').replace(/\s*\/\/\s*$/, '');
      // Auszeichnungen wie „NEU“ / „*** HIGHLIGHT ***“ / „VEGAN“
      let badge = '', vegFromName = '';
      const bm = name.match(RE_BADGE);
      if (bm && stripSup(name).replace(RE_BADGE, ' ').trim().length > 2) { badge = bm[1].charAt(0) + bm[1].slice(1).toLowerCase(); name = name.replace(RE_BADGE, ' ').replace(/\s+/g, ' ').trim(); }
      const vm = name.match(/\s*["„“]?\b(VEGAN|VEGETARISCH)\b["“”]?\s*/);
      if (vm && name.replace(vm[0], ' ').trim().length > 2) { vegFromName = vm[1].toLowerCase(); name = name.replace(vm[0], ' ').replace(/\s+/g, ' ').trim(); }
      // Zusatzstoffe am Namensende: hochgestellt {…} oder in Klammern
      let sup = '';
      const sm = name.match(/\{([^}]*)\}$/);
      if (sm) { sup = sm[1]; name = name.slice(0, sm.index).trim(); }
      const pm = name.match(/\s*\(([\d,\s a-zA-Z]{1,20})\)$/);
      if (!sup && pm && /^[\d,\sa-z]+$/.test(pm[1]) && /\d|^[a-n](,\s?[a-n])*$/.test(pm[1].trim())) { sup = pm[1].replace(/\s/g, ''); name = name.slice(0, pm.index); }
      item = { nr, name: name.trim(), sup: sup.replace(/\s/g, ''), desc: inlineDesc, desc2: '', variants: l.variants.map((v) => ({ size: v.size || pendingSize, price: v.price })), ...iconFlags(l), ...(badge ? { badge } : {}), _bold: l.bold, _size: l.size, _color: l.color, _descItalic: false, _line: l, _dash: !!l.dash };
      if (vegFromName && !item.veg) item.veg = vegFromName;
      if (pendingBadge && !item.badge) { item.badge = pendingBadge; } pendingBadge = '';
      if (sec._sizes && item.variants.length === sec._sizes.length && item.variants.every((v) => !v.size)) item.variants.forEach((v, i) => { v.size = sec._sizes[i]; });
      pendingSize = '';
      sec.items.push(item);
      lastLine = l; continue;
    }
    if (l.role === 'desc') {
      const txt = l.head || l.text;
      if (!item || item.type === 'sub') {
        if (!sec.items.length) sec.note = appendText(sec.note, l.text);
        else { const last = sec.items[sec.items.length - 1]; last.name = appendText(last.name, txt); }
        lastLine = l; continue;
      }
      // zweite Namenszeile unter Name+Preis („ROSENHOF 5,00“ / „GRAUBURGUNDER⁵“)
      if (!item.desc && item.variants.length && !l.variants.length && isCaps(stripSup(txt)) && Math.abs(l.size - item._size) < 0.6 && l.color === item._color &&
          lastLine === item._line && gapToLast < l.size * 1.7 && !item.sup) {
        const sm = txt.match(/\{([^}]*)\}$/);
        item.name = appendText(item.name, sm ? txt.slice(0, sm.index).trim() : txt);
        if (sm) item.sup = sm[1];
        lastLine = l; continue;
      }
      if (l.italic && item.desc && !item._descItalic) item.desc2 = appendText(item.desc2 || '', txt);
      else if (item.desc2 && l.italic) item.desc2 = appendText(item.desc2, txt);
      else { if (!item.desc) item._descItalic = l.italic; item.desc = appendText(item.desc, txt); }
      if (l.variants.length) item.variants.push(...l.variants.map((v) => ({ size: v.size || pendingSize, price: v.price })));
      Object.assign(item, mergeFlags(item, iconFlags(l)));
      lastLine = l;
    }
  }
  // aufräumen: doppelte Überschriften (gleiche Überschrift auf Folgeseite) zusammenführen
  const out = [];
  for (const s of menu.sections) {
    const prev = out[out.length - 1];
    if (prev && s.title && prev.title.toLowerCase() === s.title.toLowerCase()) {
      if (s.note && s.note.length < 70) prev.items.push({ type: 'sub', name: s.note });
      else if (s.note) prev.note = appendText(prev.note, s.note);
      prev.items.push(...s.items);
      continue;
    }
    out.push(s);
  }
  // Strich-Aufzählungen säubern: Strich weg, Fortsetzungszeile in Versalien gehört zum Namen, „NEU“ als Hinweis, „+“ = Aufpreis
  const RE_NEU = /\s+(NEU|NEW)\b/;
  for (const s of out) for (const it of s.items) {
    if (it.type === 'sub') continue;
    if (it._dash) {
      it.name = it.name.replace(/^[-–]\s*/, '');
      if (it.desc && !/^[-–]/.test(it.desc) && stripSup(it.desc).length < 40 && isCaps(stripSup(it.desc).replace(/\b(NEU|NEW)\b/, '')) && !it.desc2) { it.name += ' ' + it.desc; it.desc = ''; }
    }
    if (RE_NEU.test(it.name)) { it.name = it.name.replace(RE_NEU, ''); if (!it.badge) it.badge = 'Neu'; }
    if (/\s*\+$/.test(it.name) && it.variants.length) { it.name = it.name.replace(/\s*\+$/, ''); it.variants.forEach((v) => { if (!v.size) v.size = 'Aufpreis'; }); }
  }
  // Länder-/Regionszeilen ohne Preis sind Zwischenüberschriften
  for (const s of out) {
    s.items = s.items.map((it) => (it.type !== 'sub' && !it.variants.length && !it.desc && !it.nr && RE_REGION.test(it.name.trim()) ? { type: 'sub', name: it.name.trim() } : it));
  }
  // Zweizeilige Namen (z. B. Hersteller + Sorte bei Champagner/Wein) zusammenführen
  for (const s of out) {
    for (let i = 0; i < s.items.length - 1; i++) {
      const a = s.items[i], b = s.items[i + 1];
      if (a.type === 'sub' || b.type === 'sub' || a.variants.length || a.desc || a.nr || a.sup || b.nr || (a.badge && b.badge)) continue;
      if ((!b.variants.length && !b.sup && !/\}$/.test(b.name)) || a._color !== b._color || Math.abs((a._size || 0) - (b._size || 0)) > 0.3) continue;
      if (b._dash || /^[-–•+]/.test(b.name) || RE_REGION.test(a.name.trim()) || !isCaps(a.name) || !isCaps(b.name) || !a._line || !b._line || a._line.page !== b._line.page) continue;
      const gap = a._line.y - b._line.y;
      if (gap <= 0 || gap > a._line.size * 1.6 || Math.abs(a._line.x0 - b._line.x0) > 4) continue;
      b.name = a.name + ' ' + b.name;
      if (a.badge) b.badge = a.badge;
      if (a.veg && !b.veg) b.veg = a.veg;
      s.items.splice(i, 1); i--;
    }
  }
  // Name läuft nach dem Preis in die nächste Zeile weiter (z. B. „SESSANTANNI PRIMITIVO DI 82,00“ / „MANDURIA DOC⁵“)
  for (const s of out) {
    for (let i = 0; i < s.items.length - 1; i++) {
      const a = s.items[i], b = s.items[i + 1];
      if (a.type === 'sub' || b.type === 'sub' || !a.variants.length || a.desc || a.sup || b.variants.length || b.nr) continue;
      if (a._color !== b._color || Math.abs((a._size || 0) - (b._size || 0)) > 0.3 || !isCaps(stripSup(a.name)) || !isCaps(stripSup(b.name))) continue;
      if (!a._line || !b._line || a._line.page !== b._line.page || Math.abs(a._line.x0 - b._line.x0) > 4) continue;
      const gap = a._line.y - b._line.y;
      if (gap <= 0 || gap > a._line.size * 1.6 ) continue;
      if (!/(\b(DI|DE|DEL|DELLA|DES|DU|LA|LE|VON|AND|&|UND)|[-–])$/i.test(stripSup(a.name).trim()) && !b.sup && !/\}$/.test(b.name)) continue;
      a.name = a.name + ' ' + b.name; a.sup = b.sup; a.desc = b.desc; a.desc2 = b.desc2 || a.desc2;
      if (b.badge && !a.badge) a.badge = b.badge;
      s.items.splice(i + 1, 1);
    }
  }
  // Name über zwei Zeilen ohne eigenen Preis: an den näheren Nachbarn hängen
  // („Riesling Sekt Brut Piccolo 7,90“ + „Fürst von Metternich“, „Rosenhof“ + „Dessert Surprise“, „Rosenhof“ + „Alte Marille 7,00“)
  const sameStyle = (x, y) => x && y && x.type !== 'sub' && y.type !== 'sub' && x._line && y._line && x._line.page === y._line.page &&
    Math.abs((x._size || 0) - (y._size || 0)) < 0.6 && x._color === y._color &&
    (Math.abs(x._line.x0 - y._line.x0) <= 4 || Math.abs((x._line.x0 + x._line.x1) / 2 - (y._line.x0 + y._line.x1) / 2) < 12);
  for (const s of out) {
    for (let i = 0; i < s.items.length; i++) {
      const b = s.items[i];
      if (b.type === 'sub' || b.variants.length || b.nr || b.badge || !b._line || b._dash) continue;
      const a = s.items[i - 1], c = s.items[i + 1];
      if ((a && a._dash) || (c && c._dash && !(isCaps(stripSup(b.name)) && !b.desc))) continue;
      const gA = sameStyle(a, b) && !a.desc ? a._line.y - b._line.y : 999;
      const gC = sameStyle(b, c) && !b.desc ? b._line.y - c._line.y : 999;
      const lim = b._size * 1.5;
      const forceA = a && a.type !== 'sub' && /[/,&+–-]$/.test(stripSup(a.name).trim()) && gA < b._size * 1.7;
      if ((gA > 0 && gA <= lim && gA <= gC) || forceA) {
        if (!a.variants.length && !(c && c.variants.length)) { /* beide ohne Preis → lieber nach unten */ } else {
          a.name = a.name.trim() + ' ' + b.name.trim();
          if (b.sup && !a.sup) a.sup = b.sup;
          if (b.desc) a.desc = b.desc;
          if (b.desc2) a.desc2 = b.desc2;
          a._line = { ...a._line, y: b._line.y };
          s.items.splice(i, 1); i--; continue;
        }
      }
      if (c && c._dash && !b.desc && isCaps(stripSup(b.name))) { s.items[i] = { type: 'sub', name: b.name.trim() }; continue; }
      if (gC > 0 && gC <= lim && c.type !== 'sub' && !c.nr) {
        c.name = b.name.trim() + ' ' + c.name.trim();
        if (b.sup && !c.sup) c.sup = b.sup;
        c._line = { ...c._line, y: b._line.y, x0: Math.min(b._line.x0, c._line.x0), x1: Math.max(b._line.x1, c._line.x1) };
        s.items.splice(i, 1); i--; continue;
      }
    }
  }
  // Block ohne Preis mit kurzer Beschreibung, darunter (gleich ausgerichtet) der Preis-Teil → ein Eintrag
  // („Rosenhof Dessert Surprise / ab 2 Personen / Das Beste von Heute pro Person 14,90 / „Lassen Sie sich überraschen …“)
  for (const s of out) {
    for (let i = 0; i < s.items.length - 1; i++) {
      const a = s.items[i], c = s.items[i + 1];
      if (a.type === 'sub' || c.type === 'sub' || a.variants.length || !c.variants.length || !a.desc || a.desc.length > 40 || a.nr || c.nr || !sameStyle(a, c)) continue;
      const g = a._line.y - c._line.y;
      if (g <= 0 || g > a._size * 4.5) continue;
      a.desc = a.desc.trim() + ' · ' + c.name.trim() + (c.desc ? ' – ' + c.desc.trim() : '');
      a.variants = c.variants;
      if (c.sup && !a.sup) a.sup = c.sup;
      s.items.splice(i + 1, 1);
    }
  }
  // „… pro Person 14,90“ / „… je Kugel 3,00“: Mengenhinweis gehört zur Größe
  for (const s of out) for (const it of s.items) {
    if (it.type === 'sub' || it.variants.length !== 1 || it.variants[0].size) continue;
    for (const k of ['name', 'desc']) {
      const m = (it[k] || '').match(/\s*[·–|-]?\s*\b(pro Person|p\.\s?P\.|je Kugel|je Stück|pro Stück|je Portion)\s*$/i);
      if (m && it[k].length > m[0].length) { it.variants[0].size = normUnitLabel(m[1]); it[k] = it[k].slice(0, m.index).replace(/[\s|·–-]+$/, '').trim(); break; }
      const m2 = (it[k] || '').match(/\s(pro Person|je Kugel|je Stück|pro Stück)\b/i);
      if (m2) { it.variants[0].size = normUnitLabel(m2[1]); it[k] = (it[k].slice(0, m2.index) + it[k].slice(m2.index + m2[0].length)).replace(/\s+/g, ' ').trim(); break; }
    }
  }
  // „Flaschenpreis 0,5 l 39,00 – nur zum Mitnehmen“ ist eine weitere Größe des Eintrags davor
  for (const s of out) {
    for (let i = 1; i < s.items.length; i++) {
      const it = s.items[i], prev = s.items[i - 1];
      if (it.type === 'sub' || prev.type === 'sub' || !/^flaschen?preis\b/i.test(stripSup(it.name).trim()) || !it.variants.length || !prev.variants.length) continue;
      const extra = it.desc ? ' (' + it.desc.replace(/[!.]+$/, '').toLowerCase() + ')' : '';
      for (const v of it.variants) prev.variants.push({ size: ('Flasche ' + (v.size || '')).trim() + extra, price: v.price });
      s.items.splice(i, 1); i--;
    }
  }
  // Varianten-Zeilen in Auszeichnungsfarbe unter einem Gericht ohne Preis (z. B. Burger „MADAME | 180g // 21,90“)
  for (const s of out) {
    for (let i = 1; i < s.items.length; i++) {
      const it = s.items[i], prev = s.items[i - 1];
      if (it.type === 'sub' || prev.type === 'sub' || !it.variants.length || it.sup || it.nr || /\}/.test(it.name)) continue;
      if (it._color === prev._color || !(prev._absorbed || !prev.variants.length) || stripSup(it.name).replace(/\s*\|\s*$/, '').length > 28) continue;
      if (!prev._absorbed && prev.desc) continue;
      if (!prev._line || !it._line || prev._line.page !== it._line.page || Math.abs(prev._line.x0 - it._line.x0) > 4) continue;
      const lab = it.name.replace(/\s*\|\s*$/, '').trim();
      const pn = stripSup(prev.name).trim().toLowerCase();
      const lab2 = lab.toLowerCase().startsWith(pn + ' ') ? lab.slice(pn.length).trim() : lab;
      const word = isCaps(lab2) ? lab2.charAt(0) + lab2.slice(1).toLowerCase() : lab2;
      for (const v of it.variants) prev.variants.push({ size: v.size ? word + ' ' + v.size : word, price: v.price });
      if (it.desc && !prev.desc) prev.desc = it.desc;
      if (it.badge && !prev.badge) prev.badge = it.badge;
      prev._absorbed = true;
      s.items.splice(i, 1); i--;
    }
  }
  // Flaschengrößen-Zeilen (MAGNUM 1,5 L …) gehören als Variante zum Wein darüber
  const RE_BOTTLE = /^(magnum|doppelmagnum|jeroboam|rehoboam|methusalem|salmanazar|balthasar|nebukadnezar|piccolo|halbe flasche|demi)$/i;
  for (const s of out) {
    for (let i = 1; i < s.items.length; i++) {
      const it = s.items[i], prev = s.items[i - 1];
      if (it.type === 'sub' || prev.type === 'sub' || !RE_BOTTLE.test(it.name.trim()) || it.desc || it.nr || !it.variants.length || !prev.variants.length) continue;
      const word = it.name.trim().charAt(0) + it.name.trim().slice(1).toLowerCase();
      for (const v of it.variants) prev.variants.push({ size: v.size ? word + ' ' + v.size : word, price: v.price });
      s.items.splice(i, 1); i--;
    }
  }
  // Zeile in Versalien ohne Preis vor normal geschriebenen Einträgen = Zwischenüberschrift (z. B. „BIANCO“, „ROSÉ“)
  for (const s of out) {
    s.items = s.items.map((it, i) => {
      const nx = s.items[i + 1];
      if (it.type === 'sub' || it.nr || it.desc || it.badge || it.variants.length || !nx || nx.type === 'sub' || !nx.variants.length) return it;
      if (!isCaps(stripSup(it.name)) || isCaps(stripSup(nx.name))) return it;
      return { type: 'sub', name: it.name.trim() + (it.sup ? '{' + it.sup + '}' : '') };
    });
  }
  // Eintrag ohne Namen (nur Preis/Hochzahl) gehört zum Eintrag auf gleicher Höhe bzw. davor
  for (const s of out) {
    for (let i = 0; i < s.items.length; i++) {
      const it = s.items[i];
      // Preis oben, Inhalt darunter (z. B. Topping-Gruppen „+ 2,90 € Thunfisch, Parmesan“): Inhalt wird zum Namen
      if (it.type !== 'sub' && !stripSup(it.name || '').trim() && it.desc && !/^[A-Z0-9,\s]+$/.test(it.desc) && it.variants.length) { it.name = it.desc; it.desc = ''; continue; }
      if (it.type === 'sub' || stripSup(it.name || '').trim() || (it.desc && !/^[A-Z0-9,\s]+$/.test(it.desc)) || !it.variants.length) continue;
      const same = it._line && s.items.find((o) => o !== it && o.type !== 'sub' && !o.variants.length && o._line && o._line.page === it._line.page && Math.abs(o._line.y - it._line.y) < 4);
      const prev = same || s.items[i - 1];
      if (!prev || prev.type === 'sub') continue;
      if (!prev.variants.length) prev.variants.push(...it.variants.map((v) => ({ size: v.size, price: v.price })));
      s.items.splice(i, 1); i--;
    }
  }
  // Einzelne „Nummer“ in einem Bereich ohne Nummern gehört zum Namen („42 BELOW“)
  for (const s of out) {
    const withNr = s.items.filter((it) => it.type !== 'sub' && it.nr);
    const all = s.items.filter((it) => it.type !== 'sub').length;
    if (withNr.length && withNr.length <= Math.max(1, all * 0.15) && all >= 4) for (const it of withNr) { it.name = it.nr + ' ' + it.name; it.nr = ''; }
  }
  for (const s of out) {
    if (s._defSize) for (const it of s.items) if (it.type !== 'sub' && it.variants.length === 1 && !it.variants[0].size) it.variants[0].size = s._defSize;
    delete s._defSize;
  }
  for (const s of out) {
    delete s._sizes;
    for (const it of s.items) {
      delete it._bold; delete it._size; delete it._descItalic; delete it._line; delete it._color; delete it._absorbed; delete it._dash; delete it._descColor; delete it._d2Color;
      if (it.desc) it.desc = it.desc.replace(/ –$/, '');
      if (it.variants) for (const v of it.variants) if (v.size) v.size = v.size.replace(/(\d)\s*[-–]\s+(\d)/g, '$1–$2');
    }
  }
  const cleanSep = (t) => (t && (t.match(/ l /g) || []).length >= 2 ? t.replace(/ l /g, ' | ') : t);
  for (const s of out) {
    // Werbe-/Stimmungstexte vor dem ersten Gericht weglassen
    if (s.note && s.note.length > 160) s.note = '';
    // lange Fließtext-Zwischenzeilen sind Werbe-/Stimmungstexte
    s.items = s.items.filter((it) => !(it.type === 'sub' && stripSup(it.name).length > 90));
    s.items = s.items.filter((it, i) => !(it.type === 'sub' && s.items[i + 1] && s.items[i + 1].type === 'sub' && /^[^a-zäöü]*$/.test(it.name) && it.name.split(' ').length > 3 && !/[:!]$/.test(it.name)));
    for (const it of s.items) { if (it.desc) it.desc = cleanSep(it.desc); if (it.desc2) it.desc2 = cleanSep(it.desc2); }
  }
  // Bereiche ohne einen einzigen Preis gehören nicht zur Speisekarte
  menu.sections = out.filter((s) => s.items.some((it) => it.variants && it.variants.length) || /\d[.,]\d{2}\s*(?:€|EUR)/.test(s.title));
  // Beilagen/Extras „zum Steak“, „zum Fleisch und Fisch“, „Extra Topping“ → an die passenden Bereiche anhängen
  const RE_EXTRA = /\b(beilagen?|extras?|toppings?|zubehör|sides?|add-?ons?|saucen|soßen|dips?)\b/i;
  const SYN = { fleisch: ['fleisch', 'steak', 'grill', 'meat', 'braten', 'schnitzel'], fisch: ['fisch', 'fish', 'catch', 'meer', 'sea', 'seafood'], steak: ['steak'], pizza: ['pizza', 'pinsa'], pinsa: ['pinsa', 'pizza'], burger: ['burger'], pasta: ['pasta', 'nudel'], salat: ['salat', 'insalat', 'salad'] };
  for (let i = 0; i < menu.sections.length; i++) {
    const s = menu.sections[i];
    if (!s.title || !RE_EXTRA.test(s.title) || s.items.length > 30) continue;
    const m = joinSpaced(s.title).match(/\b(?:zum|zur|zu|für|to|for)\s+(.+)$/i);
    const words = m ? m[1].toLowerCase().split(/[\s,&/]+/).filter((w) => w.length > 3 && !/^(und|oder|nach|wahl|zwei|drei|beilagen?)$/.test(w)) : [];
    let targets = [];
    for (const w of words) {
      const keys = SYN[w] || SYN[Object.keys(SYN).find((k) => w.startsWith(k))] || [w];
      const t = menu.sections.find((o) => o !== s && !o._extra && !o._hasExtra && !RE_EXTRA.test(o.title) && keys.some((k) => o.title.toLowerCase().includes(k)));
      if (t && !targets.includes(t)) targets.push(t);
    }
    if (!targets.length && !words.length && /topping/i.test(s.title) && i > 0 && !RE_EXTRA.test(menu.sections[i - 1].title)) targets = [menu.sections[i - 1]];
    if (!targets.length) continue;
    for (const t of targets) {
      t.items.push({ type: 'sub', name: s.title, extra: true }, ...JSON.parse(JSON.stringify(s.items)));
      t._hasExtra = true;
    }
    s._extra = true;
  }
  menu.sections = menu.sections.filter((s) => !s._extra);
  menu.sections.forEach((s) => delete s._hasExtra);
  // Normale Schreibweise: Versalien werden zu Groß-/Kleinschreibung (Versalien lassen sich im Stil wieder einschalten)
  let capsHead = 0, capsName = 0, nHead = 0, nName = 0;
  for (const s of menu.sections) {
    if (s.title) { nHead++; if (isCaps(stripSup(s.title))) capsHead++; s.title = normCase(joinSpaced(s.title)); }
    if (s.note) s.note = normCase(s.note);
    for (const it of s.items) {
      if (it.type !== 'sub') { nName++; if (isCaps(stripSup(it.name))) capsName++; }
      it.name = normCase(joinSpaced(it.name));
      if (it.type === 'sub') continue;
      if (it.desc) it.desc = normCase(it.desc);
      if (it.desc2) it.desc2 = normCase(it.desc2);
      for (const v of it.variants || []) if (v.size) v.size = normCase(v.size, true).replace(/^(?:for|für) (\d{1,2})(?: Pers(?:\.|onen))?/i, (m, n) => 'für ' + n + (n === '1' ? ' Person' : ' Personen'));
      // „For 2 4 Beilagen inklusive For 3 6 …“ → „für 2 Personen: 4 Beilagen inklusive · für 3 Personen: 6 …“
      for (const k of ['desc', 'desc2']) {
        if (!it[k] || !/\b(?:for|für) \d/i.test(it[k])) continue;
        let first = true;
        it[k] = it[k].replace(/\s*\b(?:for|für) (\d{1,2})(?: Pers(?:\.|onen))?(?=\s+\d)/gi, (m, n, off, str) => { const before = str.slice(0, off).trim(); const r = first ? (before ? (/[.!?:]$/.test(before) ? ' Für ' : '. Für ') : 'Für ') : ' · für '; first = false; return r + n + ' Personen:'; }).trim();
      }
    }
  }
  menu.caps = capsName > nName / 2 ? 'all' : capsHead > nHead / 2 ? 'head' : '';
  return menu;
}

function mergeFlags(item, f) {
  return {
    veg: item.veg === 'vegan' || f.veg === 'vegan' ? 'vegan' : (item.veg || f.veg || ''),
    spice: Math.max(item.spice || 0, f.spice || 0),
  };
}

export async function pdfToMenu(pdfjsLib, data) {
  return parseMenu(await extractPages(pdfjsLib, data));
}
