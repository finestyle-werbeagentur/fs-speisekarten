/* Finestyle Speisekarten – Bearbeiten-Seite */
import * as pdfjsLib from './pdfjs/pdf.min.js';
import { pdfToMenu } from './parser.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('./pdfjs/pdf.worker.min.js', import.meta.url).href;

const $ = (s, el = document) => el.querySelector(s);
const init = JSON.parse($('#fs-sk-initial').textContent);
let menu = init.data && init.data.sections ? init.data : { sections: [], notes: [] };

const hidden = $('#fs-sk-data');
const editor = $('#fs-sk-editor');
const preview = $('#fs-sk-preview');
const statusEl = $('#fs-sk-status');
const fileInput = $('#fs-sk-file');
const drop = $('#fs-sk-drop');

// ---------- Hilfen ----------
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) n.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null) n.append(k.nodeType ? k : document.createTextNode(k));
  return n;
};
const sync = () => { hidden.value = JSON.stringify(menu); };
const showStatus = (html, type = 'info') => { statusEl.hidden = false; statusEl.className = 'fs-status is-' + type; statusEl.innerHTML = html; };
const move = (arr, i, d) => { const j = i + d; if (j < 0 || j >= arr.length) return; [arr[i], arr[j]] = [arr[j], arr[i]]; };
const newItem = () => ({ nr: '', name: '', sup: '', desc: '', desc2: '', veg: '', spice: 0, variants: [{ size: '', price: '' }] });
const isSub = (it) => it.type === 'sub';
const key = (it) => (it.nr || '') + '|' + String(it.name || '').replace(/\{[^}]*\}/g, '').trim().toLowerCase();

// Symbole/Schärfe, die du von Hand gesetzt hast, beim nächsten PDF-Upload übernehmen
function carryFlags(oldMenu, newMenu) {
  const map = {};
  for (const s of oldMenu.sections || []) for (const it of s.items || []) if (!isSub(it) && (it.veg || it.spice)) map[key(it)] = it;
  for (const s of newMenu.sections) for (const it of s.items) {
    const o = map[key(it)];
    if (!isSub(it) && o && !it.veg && !it.spice) { it.veg = o.veg || ''; it.spice = o.spice || 0; }
  }
}

// ---------- Aktueller Stand ----------
const current = $('#fs-sk-current');
if (init.pdfUrl) {
  current.innerHTML = `Aktuelle PDF: <a href="${esc(init.pdfUrl)}" target="_blank" rel="noopener">${esc(init.pdfUrl.split('/').pop())}</a>` +
    (init.updated ? ` · Stand ${esc(init.updated)}` : '');
} else {
  current.textContent = 'Noch keine PDF hochgeladen.';
}

// ---------- PDF einlesen ----------
async function handleFile(file, reread = false) {
  if (!file) return;
  if (!reread && !/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
    showStatus('Das ist keine PDF-Datei. Bitte wähle eine <strong>.pdf</strong> aus.', 'stop');
    fileInput.value = '';
    return;
  }
  drop.classList.add('is-busy');
  showStatus('Einen Moment – die PDF wird gelesen …', 'info');
  try {
    const buf = new Uint8Array(reread ? file : await file.arrayBuffer());
    const result = await pdfToMenu(pdfjsLib, buf);
    const nItems = result.sections.reduce((n, s) => n + s.items.filter((i) => !isSub(i)).length, 0);
    if (!nItems) {
      showStatus('In dieser PDF wurde kein Text gefunden. Vermutlich ist sie nur ein Bild (z. B. gescannt). ' +
        'Bitte exportiere die Karte direkt aus InDesign als PDF. Die Datei wird trotzdem zum Download ausgetauscht.', 'warn');
      return;
    }
    if (!reread) {
      const keepOld = menu.sections.length && !confirm('Die neue PDF ersetzt die bisherige Karte im Editor. Fortfahren?');
      if (keepOld) { showStatus('Abgebrochen – der bisherige Inhalt bleibt. Die neue PDF wird beim Speichern trotzdem zum Download ausgetauscht.', 'warn'); return; }
    }
    carryFlags(menu, result);
    menu = result;
    const missing = result.sections.reduce((n, s) => n + s.items.filter((i) => !isSub(i) && !i.variants.length).length, 0);
    updatePdfColorsBtn();
    showStatus(`<strong>Fertig!</strong> ${nItems} Einträge in ${result.sections.length} Bereichen erkannt` +
      (missing ? ` – bei <strong>${missing}</strong> fehlt ein Preis (gelb markiert).` : '.') +
      (result.colors && Object.keys(result.colors).length ? ' Unter „Aussehen“ kannst du den <strong>Stil aus der PDF übernehmen</strong>.' : '') +
      ' Prüf die Karte unten kurz und klick dann auf <strong>„Aktualisieren“</strong>.', missing ? 'warn' : 'ok');
    render();
  } catch (e) {
    console.error(e);
    showStatus('Die PDF konnte nicht gelesen werden. Ist sie passwortgeschützt? (' + esc(e.message || e) + ')', 'stop');
  } finally {
    drop.classList.remove('is-busy');
  }
}
fileInput.addEventListener('change', () => handleFile(fileInput.files[0]));

// Gespeicherte PDF nach aktuellem Stand neu auslesen (ohne erneuten Upload)
const rereadBtn = $('#fs-sk-reread');
if (rereadBtn) {
  rereadBtn.hidden = !init.pdfUrl;
  rereadBtn.addEventListener('click', async () => {
    if (!init.pdfUrl) return;
    if (menu.sections.length && !confirm('Die PDF wird neu ausgelesen und ersetzt die Karte im Editor.\n\nKorrekturen, die du von Hand gemacht hast, gehen dabei verloren (Symbole und Schärfe bleiben erhalten).\n\nFortfahren?')) return;
    rereadBtn.disabled = true;
    try {
      const res = await fetch(init.pdfUrl + (init.pdfUrl.includes('?') ? '&' : '?') + 'nocache=' + Date.now(), { credentials: 'same-origin' });
      if (!res.ok) throw new Error('PDF nicht gefunden (' + res.status + ')');
      await handleFile(await res.arrayBuffer(), true);
    } catch (e) {
      showStatus('Die gespeicherte PDF konnte nicht geladen werden: ' + esc(e.message || e), 'stop');
    } finally {
      rereadBtn.disabled = false;
    }
  });
}
['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('is-over'); }));
['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove('is-over')));
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  const f = e.dataTransfer.files[0];
  if (!f) return;
  const dt = new DataTransfer(); dt.items.add(f); fileInput.files = dt.files;
  handleFile(f);
});

// ---------- Editor ----------
function field(label, value, onInput, opts = {}) {
  const input = opts.multi
    ? el('textarea', { rows: 1, placeholder: opts.ph || '', class: 'fs-in' })
    : el('input', { type: 'text', placeholder: opts.ph || '', class: 'fs-in' });
  input.value = value || '';
  input.addEventListener('input', () => { onInput(input.value); sync(); if (opts.multi) autoGrow(input); if (opts.rerender) markRow(); });
  if (opts.multi) requestAnimationFrame(() => autoGrow(input));
  return el('label', { class: 'fs-f ' + (opts.cls || '') }, el('span', { class: 'fs-f__l' }, label), input);
}
function autoGrow(t) { t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; }
function markRow() { /* Markierung "kein Preis" bei nächster Darstellung */ }
function iconBtn(txt, title, fn, cls = '') { return el('button', { type: 'button', class: 'fs-ib ' + cls, title, 'aria-label': title, onclick: fn }, txt); }

function render() {
  sync();
  editor.innerHTML = '';
  const showLang2 = menu.sections.some((s) => s.items.some((i) => !isSub(i) && i.desc2));

  if (!menu.sections.length) {
    editor.append(el('p', { class: 'fs-empty' }, 'Noch kein Inhalt. Lade oben eine PDF hoch – oder leg von Hand einen Bereich an.'));
  }

  menu.sections.forEach((sec, si) => {
    const card = el('div', { class: 'fs-sec' });
    const head = el('div', { class: 'fs-sec__head' },
      field('Überschrift', sec.title, (v) => { sec.title = v; }, { ph: 'z. B. Vorspeisen', cls: 'fs-f--title' }),
      el('div', { class: 'fs-actions' },
        iconBtn('↑', 'Bereich nach oben', () => { move(menu.sections, si, -1); render(); }),
        iconBtn('↓', 'Bereich nach unten', () => { move(menu.sections, si, 1); render(); }),
        iconBtn('✕', 'Bereich löschen', () => { if (confirm(`Bereich „${sec.title || 'ohne Titel'}“ mit ${sec.items.length} Einträgen löschen?`)) { menu.sections.splice(si, 1); render(); } }, 'fs-ib--del'),
      ));
    card.append(head);
    card.append(field('Hinweis zum Bereich (optional)', sec.note, (v) => { sec.note = v; }, { multi: true, ph: 'z. B. Alle Gerichte mit Reis', cls: 'fs-f--note' }));

    const list = el('div', { class: 'fs-items' });
    sec.items.forEach((it, ii) => {
      const upBtn = iconBtn('↑', 'nach oben', () => { if (ii > 0) move(sec.items, ii, -1); else if (si > 0) { menu.sections[si - 1].items.push(sec.items.shift()); } render(); });
      const downBtn = iconBtn('↓', 'nach unten', () => { if (ii < sec.items.length - 1) move(sec.items, ii, 1); else if (si < menu.sections.length - 1) { menu.sections[si + 1].items.unshift(sec.items.pop()); } render(); });
      if (isSub(it)) {
        list.append(el('div', { class: 'fs-item fs-item--sub' }, el('div', { class: 'fs-item__top' },
          field('Zwischenzeile (z. B. „Dazu wahlweise:“)', it.name, (v) => { it.name = v; }, { cls: 'fs-f--name' }),
          el('label', { class: 'fs-extra-check', title: 'Beilagen oder Extras: wird abgesetzt dargestellt und nicht als Gericht gezählt' }, el('input', { type: 'checkbox', ...(it.extra ? { checked: '' } : {}), onchange: (e) => { if (e.target.checked) it.extra = true; else delete it.extra; refreshPreview(); } }), ' Beilagen-Block'),
          el('div', { class: 'fs-actions' }, upBtn, downBtn,
            iconBtn('G', 'Doch ein Gericht daraus machen', () => { const nm = it.name; delete it.type; Object.assign(it, newItem(), { name: nm }); render(); }, 'fs-ib--h'),
            iconBtn('✕', 'Zeile löschen', () => { sec.items.splice(ii, 1); render(); }, 'fs-ib--del')))));
        return;
      }
      const row = el('div', { class: 'fs-item' + (it.variants.some((v) => v.price) ? '' : ' is-noprice') });
      const top = el('div', { class: 'fs-item__top' },
        field('Nr.', it.nr, (v) => { it.nr = v; }, { cls: 'fs-f--nr' }),
        field('Name', it.name, (v) => { it.name = v; }, { cls: 'fs-f--name' }),
        field('Zusatzstoffe', it.sup, (v) => { it.sup = v; }, { cls: 'fs-f--sup', ph: '1,3,a' }),
        field('Hinweis', it.badge || '', (v) => { it.badge = v; }, { cls: 'fs-f--badge', ph: 'z. B. Neu' }),
        el('div', { class: 'fs-actions' },
          upBtn, downBtn,
          iconBtn('Z', 'Das ist eine Zwischenzeile (z. B. „Dazu wahlweise:“)', () => { const nm = [it.nr, it.name].filter(Boolean).join(' '); for (const k of Object.keys(it)) delete it[k]; it.type = 'sub'; it.name = nm; render(); }, 'fs-ib--h'),
          iconBtn('H', 'Das ist eine Überschrift – ab hier neuen Bereich beginnen', () => {
            const rest = sec.items.splice(ii);
            const first = rest.shift();
            menu.sections.splice(si + 1, 0, { title: [first.nr, first.name].filter(Boolean).join(' '), note: first.desc || '', items: rest });
            render();
          }, 'fs-ib--h'),
          iconBtn('✕', 'Eintrag löschen', () => { sec.items.splice(ii, 1); render(); }, 'fs-ib--del'),
        ));
      row.append(top);
      row.append(field('Beschreibung', it.desc, (v) => { it.desc = v; }, { multi: true, cls: 'fs-f--desc' }));
      if (showLang2 || it.desc2) row.append(field('Zweite Sprache (z. B. Englisch)', it.desc2, (v) => { it.desc2 = v; }, { multi: true, cls: 'fs-f--desc' }));

      const vars = el('div', { class: 'fs-vars' });
      it.variants.forEach((v, vi) => {
        vars.append(el('div', { class: 'fs-var' },
          field('Menge', v.size, (x) => { v.size = x; }, { ph: 'z. B. 0,2 l', cls: 'fs-f--size' }),
          field('Preis', v.price, (x) => { v.price = x; row.classList.toggle('is-noprice', !it.variants.some((q) => q.price)); }, { ph: '0,00', cls: 'fs-f--price' }),
          iconBtn('✕', 'Preis entfernen', () => { it.variants.splice(vi, 1); render(); }, 'fs-ib--del fs-ib--sm'),
        ));
      });
      vars.append(el('button', { type: 'button', class: 'fs-link', onclick: () => { it.variants.push({ size: '', price: '' }); render(); } }, '+ Menge/Preis'));
      const sel = (label, opts, val, on) => {
        const s = el('select', { class: 'fs-in' }, ...opts.map(([v, t]) => { const o = el('option', { value: v }, t); if (String(v) === String(val)) o.selected = true; return o; }));
        s.addEventListener('change', () => { on(s.value); sync(); });
        return el('label', { class: 'fs-f fs-f--sel' }, el('span', { class: 'fs-f__l' }, label), s);
      };
      vars.append(el('div', { class: 'fs-flags' },
        sel('Symbol', [['', '–'], ['vegetarisch', 'vegetarisch'], ['vegan', 'vegan']], it.veg || '', (v) => { it.veg = v; }),
        sel('Schärfe', [[0, '–'], [1, 'leicht scharf'], [2, 'mittelscharf'], [3, 'scharf']], it.spice || 0, (v) => { it.spice = +v; })));
      row.append(vars);
      list.append(row);
    });
    card.append(list);
    card.append(el('button', { type: 'button', class: 'button', onclick: () => { sec.items.push(newItem()); render(); } }, '+ Eintrag hinzufügen'), ' ',
      el('button', { type: 'button', class: 'button', onclick: () => { sec.items.push({ type: 'sub', name: '' }); render(); } }, '+ Zwischenzeile'));
    editor.append(card);
  });

  editor.append(el('p', {}, el('button', { type: 'button', class: 'button', onclick: () => { menu.sections.push({ title: '', note: '', items: [newItem()] }); render(); } }, '+ Neuen Bereich hinzufügen')));

  const notes = el('div', { class: 'fs-sec fs-sec--notes' },
    el('h4', {}, 'Hinweise unter der Karte'),
    field('Ein Hinweis pro Zeile (z. B. Zusatzstoffe, „Alle Preise inkl. MwSt.“)', (menu.notes || []).join('\n'), (v) => { menu.notes = v.split('\n').map((x) => x.trim()).filter(Boolean); }, { multi: true }));
  editor.append(notes);

  if (!preview.hidden) renderPreview();
}

// ---------- Vorschau (gleicher Aufbau wie auf der Webseite) ----------
function price(p) {
  p = String(p || '').trim();
  const m = p.match(/^(\d{1,4})(?:[.,](\d{1,2}))?$/);
  if (m) p = m[1] + ',' + (m[2] || '').padEnd(2, '0');
  return p && /\d/.test(p) && !p.includes('€') ? p + '\u00a0€' : p;
}
const inl = (s) => esc(s).replace(/\{([^{}]{1,40})\}/g, '<sup class="fs-sk__sup">$1</sup>');
const SPICE = { 1: 'leicht scharf', 2: 'mittelscharf', 3: 'scharf' };
function icons(it) {
  let h = '';
  if (it.veg) h += `<span class="fs-sk__ic-group" title="${it.veg}">` + '<span class="fs-sk__ic fs-sk__ic--leaf"></span>'.repeat(it.veg === 'vegan' ? 2 : 1) + '</span>';
  if (it.spice) h += `<span class="fs-sk__ic-group" title="${SPICE[it.spice]}">` + '<span class="fs-sk__ic fs-sk__ic--chili"></span>'.repeat(it.spice) + '</span>';
  return h ? `<span class="fs-sk__icons">${h}</span>` : '';
}
// ---------- Aussehen ----------
const styleVars = () => {
  const v = [];
  const map = { title: '--fs-sk-title', accent: '--fs-sk-accent', btn_bg: '--fs-sk-btn-bg', btn_text: '--fs-sk-btn-color', veg: '--fs-sk-veg', chili: '--fs-sk-chili' };
  document.querySelectorAll('.fs-color').forEach((c) => { const val = c.querySelector('input[type=hidden]').value; if (val) v.push(map[c.dataset.key] + ':' + val); });
  for (const k of ['font_head', 'font_text']) {
    const sel = $('#fs-st-' + k);
    const cus = sel && sel.parentNode.querySelector('.fs-font-custom');
    if (sel && sel.value === 'custom' && cus.value) v.push((k === 'font_head' ? '--fs-sk-font-head:' : '--fs-sk-font-text:') + cus.value);
  }
  const size = $('#fs-st-size');
  if (size && size.value !== 'normal') v.push('--fs-sk-scale:' + (size.value === 'klein' ? '.94' : '1.08'));
  return v.join(';');
};
function setColor(box, val) {
  box.querySelector('input[type=hidden]').value = val || '';
  if (val) box.querySelector('input[type=color]').value = val;
  box.querySelector('.fs-color__state').textContent = val || 'Standard';
  box.querySelector('.fs-color__reset').hidden = !val;
}
document.querySelectorAll('.fs-color').forEach((box) => {
  box.querySelector('input[type=color]').addEventListener('input', (e) => { setColor(box, e.target.value); refreshPreview(); });
  box.querySelector('.fs-color__reset').addEventListener('click', () => { setColor(box, ''); refreshPreview(); });
});
document.querySelectorAll('.fs-font-select').forEach((sel) => sel.addEventListener('change', () => {
  sel.parentNode.querySelector('.fs-font-custom').hidden = sel.value !== 'custom'; refreshPreview();
}));
document.querySelectorAll('#fs-st-layout, #fs-st-size, #fs-st-caps, .fs-font-custom').forEach((x) => x.addEventListener('input', refreshPreview));
const pdfColorsBtn = $('#fs-sk-pdfcolors');
function updatePdfColorsBtn() { if (pdfColorsBtn) pdfColorsBtn.hidden = !((menu.colors && Object.keys(menu.colors).length) || menu.caps); }
if (pdfColorsBtn) pdfColorsBtn.addEventListener('click', () => {
  const c = menu.colors || {};
  const pick = { title: c.title, accent: c.accent, btn_bg: c.title || c.accent, btn_text: (c.title || c.accent) ? '#ffffff' : '', veg: c.veg, chili: c.chili };
  document.querySelectorAll('.fs-color').forEach((box) => { if (pick[box.dataset.key]) setColor(box, pick[box.dataset.key]); });
  const capsSel = $('#fs-st-caps');
  if (capsSel) capsSel.value = menu.caps || '';
  pdfColorsBtn.textContent = 'Stil übernommen ✓';
  setTimeout(() => { pdfColorsBtn.textContent = 'Stil aus der PDF übernehmen'; }, 1800);
  refreshPreview();
});
function refreshPreview() { if (!preview.hidden) renderPreview(); }

function renderPreview() {
  const acc = ($('#fs-st-layout') || {}).value !== 'offen';
  const caps = ($('#fs-st-caps') || {}).value || '';
  let h = `<div class="fs-sk fs-sk--${acc ? 'aufklappbar' : 'offen'}${caps ? ' fs-sk--caps-' + caps : ''}" style="${esc(styleVars())}"><div class="fs-sk__top">`;
  if (init.pdfUrl || fileInput.files.length) h += '<a class="fs-sk__btn" href="#" onclick="return false"><span class="fs-sk__btn-icon"></span>Speisekarte als PDF</a>';
  const used = new Set();
  menu.sections.forEach((s) => s.items.forEach((i) => { if (i.veg) used.add(i.veg); if (i.spice) used.add('s' + i.spice); }));
  if (used.size) {
    h += '<ul class="fs-sk__legend">';
    if (used.has('vegetarisch')) h += `<li>${icons({ veg: 'vegetarisch' })} vegetarisch</li>`;
    if (used.has('vegan')) h += `<li>${icons({ veg: 'vegan' })} vegan</li>`;
    [1, 2, 3].forEach((n) => { if (used.has('s' + n)) h += `<li>${icons({ spice: n })} ${SPICE[n]}</li>`; });
    h += '</ul>';
  }
  h += '</div>';
  menu.sections.forEach((s, si) => {
    const title = esc(s.title).replace(/^(.*?\S)\s+((?:ab\s+)?\d{1,3}[.,]\d{1,2}\s*(?:€|EUR|Euro).*)$/i, '$1 <span class="fs-sk__title-price">$2</span>');
    if (acc && s.title) h += `<details class="fs-sk__section"${si === 0 ? ' open' : ''}><summary class="fs-sk__summary"><h2 class="fs-sk__title">${title}</h2><span class="fs-sk__chev"></span></summary>`;
    else { h += '<section class="fs-sk__section">'; if (s.title) h += `<h2 class="fs-sk__title">${title}</h2>`; }
    h += '<div class="fs-sk__body">';
    if (s.note) h += `<p class="fs-sk__note">${inl(s.note)}</p>`;
    if (s.items.length) {
      h += '<ul class="fs-sk__items">';
      for (const it of s.items) {
        if (isSub(it)) { h += `<li class="fs-sk__sub${it.extra ? ' fs-sk__sub--extra' : ''}">${inl(it.name)}</li>`; continue; }
        const v = it.variants.filter((x) => x.size || x.price);
        h += `<li class="fs-sk__item${/^[a-h]$/.test(it.nr || '') ? ' fs-sk__item--option' : ''}"><div class="fs-sk__head">`;
        if (it.nr) h += `<span class="fs-sk__nr">${esc(it.nr)}</span>`;
        h += `<h3 class="fs-sk__name">${inl(it.name)}${it.sup ? `<sup class="fs-sk__sup">${esc(it.sup)}</sup>` : ''}${icons(it)}${it.badge ? ` <span class="fs-sk__badge">${esc(it.badge)}</span>` : ''}</h3>`;
        const hasSize = v.some((x) => x.size);
        if (v.length) { if (hasSize) h += `<span class="fs-sk__size">${esc(v[0].size)}</span>`; h += `<span class="fs-sk__price">${esc(price(v[0].price))}</span>`; }
        h += '</div>';
        if (v.length > 1) h += '<ul class="fs-sk__variants">' + v.slice(1).map((x) => `<li><span class="fs-sk__size">${esc(x.size)}</span><span class="fs-sk__price">${esc(price(x.price))}</span></li>`).join('') + '</ul>';
        if (it.desc) h += `<p class="fs-sk__desc">${inl(it.desc)}</p>`;
        if (it.desc2) h += `<p class="fs-sk__desc2">${inl(it.desc2)}</p>`;
        h += '</li>';
      }
      h += '</ul>';
    }
    h += '</div>' + (acc && s.title ? '</details>' : '</section>');
  });
  if (menu.notes && menu.notes.length) h += '<div class="fs-sk__notes">' + menu.notes.map((n) => `<p>${inl(n)}</p>`).join('') + '</div>';
  preview.innerHTML = h + '</div>';
}

document.querySelectorAll('.fs-tab').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.fs-tab').forEach((x) => x.classList.toggle('is-on', x === b));
  const pv = b.dataset.tab === 'preview';
  preview.hidden = !pv; editor.hidden = pv;
  if (pv) renderPreview();
}));

// ---------- Kopieren ----------
document.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(b.dataset.copy); } catch (e) {
    const t = el('textarea'); t.value = b.dataset.copy; document.body.append(t); t.select(); document.execCommand('copy'); t.remove();
  }
  const old = b.textContent; b.textContent = 'Kopiert ✓'; setTimeout(() => { b.textContent = old; }, 1500);
}));

// Beim Absenden sicher den neuesten Stand mitschicken
$('#post').addEventListener('submit', sync);

render();
updatePdfColorsBtn();
