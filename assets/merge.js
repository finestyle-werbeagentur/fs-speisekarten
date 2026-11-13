/* Finestyle Speisekarten – Handkorrekturen beim Neu-Auslesen behalten
 *
 * Jeder Bereich und jeder Eintrag bekommt beim Auslesen einen Schlüssel „k“ (aus Bereich + Nummer + Name der PDF).
 * Zusätzlich wird das reine Auslese-Ergebnis („auto“) gespeichert. Beim nächsten Auslesen gilt:
 *   gespeichert ≠ auto  → das hast du von Hand geändert → wird in das neue Ergebnis übernommen
 *   gespeichert = auto  → das neue Ergebnis aus der PDF gewinnt (z. B. neuer Preis)
 */

const norm = (s) => String(s ?? '').replace(/\{[^}]*\}/g, '').toLowerCase().replace(/ß/g, 'ss').replace(/[^a-z0-9äöüéèàâêîôûç]+/g, ' ').trim();
const hash = (s) => { let h = 5381; for (const c of s) h = ((h * 33) ^ c.codePointAt(0)) >>> 0; return h.toString(36); };
const isSub = (it) => it && it.type === 'sub';
const clone = (o) => JSON.parse(JSON.stringify(o));
const FIELDS = ['type', 'name', 'nr', 'sup', 'desc', 'desc2', 'veg', 'spice', 'badge', 'extra', 'variants'];
const same = (a, b) => JSON.stringify(a ?? '') === JSON.stringify(b ?? '');
const val = (it, f) => { const v = it[f]; if (f === 'spice') return v || 0; if (f === 'variants') return (v || []).map((x) => ({ size: x.size || '', price: x.price || '' })); return v || ''; };

/** Schlüssel vergeben (Auslese-Ergebnis). Doppelte Namen bekommen eine laufende Nummer. */
export function withKeys(menu) {
  const seenS = {};
  for (const s of menu.sections || []) {
    const sb = 's' + hash(norm(s.title));
    seenS[sb] = (seenS[sb] || 0) + 1;
    s.k = sb + (seenS[sb] > 1 ? '_' + seenS[sb] : '');
    const seen = {};
    for (const it of s.items || []) {
      const b = (isSub(it) ? 'z' : 'i') + hash(norm(s.title) + '|' + (it.nr || '') + '|' + norm(it.name));
      seen[b] = (seen[b] || 0) + 1;
      it.k = b + (seen[b] > 1 ? '_' + seen[b] : '');
    }
  }
  return menu;
}

/**
 * auto  = Auslese-Ergebnis vom letzten Mal (mit Schlüsseln)
 * saved = gespeicherte Karte (mit deinen Korrekturen)
 * fresh = neues Auslese-Ergebnis (mit Schlüsseln)
 * → { menu, kept, lost } – lost = Korrekturen, die keinem neuen Eintrag mehr zugeordnet werden konnten
 */
export function mergeEdits(auto, saved, fresh) {
  const out = clone(fresh);
  const report = { kept: 0, lost: [] };
  if (!auto || !auto.sections || !saved || !saved.sections) return { menu: out, ...report };

  const aSec = {}, aItem = {};
  for (const s of auto.sections) { if (s.k) aSec[s.k] = s; for (const it of s.items || []) if (it.k) aItem[it.k] = it; }
  const oSec = {}, oItem = {}, oItemSec = {};
  for (const s of out.sections) { oSec[s.k] = s; for (const it of s.items) { oItem[it.k] = it; oItemSec[it.k] = s; } }
  const savedKeys = new Set();
  for (const s of saved.sections) { if (s.k) savedKeys.add(s.k); for (const it of s.items || []) if (it.k) savedKeys.add(it.k); }

  // 1. Bereiche: Titel/Hinweis geändert, Bereich gelöscht
  for (const s of saved.sections) {
    const a = s.k && aSec[s.k], o = s.k && oSec[s.k];
    if (!a) continue;
    if (!o) { if (!same(s.title, a.title) || !same(s.note, a.note)) report.lost.push('Bereich „' + (s.title || a.title) + '“'); continue; }
    if (!same(s.title, a.title)) { o.title = s.title; report.kept++; }
    if (!same(s.note || '', a.note || '')) { o.note = s.note || ''; report.kept++; }
  }
  for (const k in aSec) if (!savedKeys.has(k) && oSec[k]) { out.sections.splice(out.sections.indexOf(oSec[k]), 1); delete oSec[k]; report.kept++; }

  // 2. Einträge: Felder geändert
  for (const s of saved.sections) for (const it of s.items || []) {
    const a = it.k && aItem[it.k];
    if (!a) continue;
    const o = oItem[it.k];
    const changed = FIELDS.filter((f) => !same(val(it, f), val(a, f)));
    if (!changed.length) continue;
    if (!o) { report.lost.push('„' + String(it.name || a.name).replace(/\{[^}]*\}/g, '') + '“'); continue; }
    for (const f of changed) { if (f === 'variants') o.variants = clone(it.variants || []); else if (it[f] === undefined || it[f] === '' || it[f] === 0 || it[f] === false) delete o[f]; else o[f] = it[f]; }
    if (o.type === 'sub') { for (const f of ['nr', 'sup', 'desc', 'desc2', 'veg', 'spice', 'badge', 'variants']) delete o[f]; } else if (!o.variants) o.variants = [];
    report.kept++;
  }

  // 3. Einträge gelöscht
  for (const k in aItem) {
    if (savedKeys.has(k) || !oItem[k]) continue;
    const s = oItemSec[k];
    s.items.splice(s.items.indexOf(oItem[k]), 1);
    delete oItem[k];
    report.kept++;
  }

  // 4. Was du selbst hinzugefügt hast (ohne Schlüssel)
  saved.sections.forEach((s, idx) => {
    if (!s.k || !aSec[s.k]) {
      // ganzer Bereich neu angelegt → hinter den Bereich davor setzen
      const before = saved.sections.slice(0, idx).reverse().find((x) => x.k && oSec[x.k]);
      const copy = clone(s);
      out.sections.splice(before ? out.sections.indexOf(oSec[before.k]) + 1 : 0, 0, copy);
      report.kept++;
      return;
    }
    const target = oSec[s.k] || null;
    let prevK = null;
    for (const it of s.items || []) {
      if (it.k && aItem[it.k]) { prevK = it.k; continue; }
      const copy = clone(it);
      copy.k = 'u' + hash(JSON.stringify(copy) + idx + Math.random());
      if (prevK && oItem[prevK]) {
        const ps = oItemSec[prevK];
        ps.items.splice(ps.items.indexOf(oItem[prevK]) + 1, 0, copy);
        oItemSec[copy.k] = ps;
      } else if (target) {
        target.items.unshift(copy);
        oItemSec[copy.k] = target;
      } else { report.lost.push('„' + String(it.name || '').replace(/\{[^}]*\}/g, '') + '“'); continue; }
      oItem[copy.k] = copy;
      prevK = copy.k;
      report.kept++;
    }
  });

  // 5. Hinweise unten (Zusatzstoffe usw.) und Stil-Angaben von Hand geändert
  if (!same(saved.notes || [], auto.notes || [])) { out.notes = clone(saved.notes || []); report.kept++; }
  return { menu: out, ...report };
}
