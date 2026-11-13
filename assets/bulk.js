/* Finestyle Speisekarten – alle Karten neu auslesen */
import * as pdfjsLib from './pdfjs/pdf.min.js';
const VER = new URL(import.meta.url).search;
const { pdfToMenu } = await import('./parser.js' + VER);
const { withKeys, mergeEdits } = await import('./merge.js' + VER);

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('./pdfjs/pdf.worker.min.js', import.meta.url).href;

const $ = (s) => document.querySelector(s);
const init = JSON.parse($('#fs-bulk-init').textContent);
const list = $('#fs-bulk-list');
const runBtn = $('#fs-bulk-run');
const allBox = $('#fs-bulk-all');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const isSub = (it) => it.type === 'sub';

function row(card) {
  const li = document.createElement('li');
  li.className = 'fs-bulk__row';
  li.innerHTML = `<span class="fs-bulk__dot"></span><a href="${esc(card.edit)}">${esc(card.title || '(ohne Titel)')}</a> <span class="fs-bulk__msg">${card.outdated ? 'wartet' : 'aktuell'}</span>`;
  list.append(li);
  card.li = li;
  return li;
}
const setRow = (card, state, msg) => { card.li.dataset.state = state; card.li.querySelector('.fs-bulk__msg').innerHTML = msg; };

async function post(action, params) {
  const body = new URLSearchParams({ action, nonce: init.nonce, ...params });
  const res = await fetch(init.ajax, { method: 'POST', body, credentials: 'same-origin' });
  const j = await res.json();
  if (!j.success) throw new Error(j.data || 'Fehler beim Speichern');
  return j.data;
}

// Symbole/Schärfe bei Karten ohne gespeicherte Korrekturen trotzdem behalten
function carryFlags(oldMenu, newMenu) {
  const key = (it) => (it.nr || '') + '|' + String(it.name || '').replace(/\{[^}]*\}/g, '').trim().toLowerCase();
  const map = {};
  for (const s of oldMenu.sections || []) for (const it of s.items || []) if (!isSub(it) && (it.veg || it.spice)) map[key(it)] = it;
  for (const s of newMenu.sections) for (const it of s.items) {
    const o = map[key(it)];
    if (!isSub(it) && o && !it.veg && !it.spice) { it.veg = o.veg || ''; it.spice = o.spice || 0; }
  }
}

async function process(card) {
  setRow(card, 'busy', 'wird gelesen …');
  const { data, auto } = await post('fs_sk_bulk_get', { id: card.id });
  const res = await fetch(card.pdfUrl + (card.pdfUrl.includes('?') ? '&' : '?') + 'nocache=' + Date.now(), { credentials: 'same-origin' });
  if (!res.ok) throw new Error('PDF nicht gefunden');
  const fresh = withKeys(await pdfToMenu(pdfjsLib, new Uint8Array(await res.arrayBuffer())));
  const n = fresh.sections.reduce((a, s) => a + s.items.filter((i) => !isSub(i)).length, 0);
  if (!n) throw new Error('kein Text in der PDF gefunden');
  let menu, info = '';
  if (auto && auto.sections && (data.sections || []).some((s) => s.k)) {
    const m = mergeEdits(auto, data, fresh);
    menu = m.menu;
    if (m.kept) info += ` · ${m.kept} Korrektur${m.kept === 1 ? '' : 'en'} übernommen`;
    if (m.lost.length) info += ` · <strong>bitte prüfen:</strong> ${m.lost.map(esc).join(', ')}`;
  } else {
    menu = JSON.parse(JSON.stringify(fresh));
    carryFlags(data, menu);
    info = ' · erstes Auslesen mit Korrektur-Speicher';
  }
  await post('fs_sk_bulk_save', { id: card.id, data: JSON.stringify(menu), auto: JSON.stringify(fresh) });
  setRow(card, (/bitte prüfen/.test(info) ? 'warn' : 'ok'), `fertig – ${n} Einträge${info}`);
}

async function runAll() {
  runBtn.disabled = true;
  allBox.disabled = true;
  const todo = init.cards.filter((c) => allBox.checked || c.outdated);
  if (!todo.length) { runBtn.textContent = 'Alle Karten sind schon aktuell'; return; }
  let ok = 0;
  for (const c of todo) {
    try { await process(c); ok++; } catch (e) { console.error(e); setRow(c, 'stop', 'Fehler: ' + esc(e.message || e)); }
  }
  runBtn.textContent = ok === todo.length ? `Fertig – ${ok} von ${todo.length} Karten neu ausgelesen` : `${ok} von ${todo.length} Karten neu ausgelesen – bitte die rot markierten prüfen`;
}

if (!init.cards.length) {
  list.innerHTML = '<li>Es gibt noch keine Speisekarte mit PDF.</li>';
  runBtn.hidden = true;
} else {
  init.cards.forEach(row);
  runBtn.addEventListener('click', runAll);
  if (init.start && init.cards.some((c) => c.outdated)) runAll();
}
