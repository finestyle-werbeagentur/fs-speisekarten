// Liest alle Karten der Websites aus tests/sites.txt mit einer Plugin-Version aus
// und schreibt pro Karte eine Textdatei (eine Zeile pro Eintrag).
//   node tests/karten.mjs <plugin-ordner> <ausgabe-ordner> [pdf-cache-ordner]
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';

const [, , pluginDir, outDir, cacheDir = '/tmp/fs-sk-pdfs'] = process.argv;
const here = new URL('.', import.meta.url).pathname;
const pdfjs = await import(process.env.PDFJS || 'pdfjs-dist/legacy/build/pdf.mjs');
const P = await import(pathToFileURL(resolve(pluginDir, 'assets/parser.js')).href);
mkdirSync(outDir, { recursive: true }); mkdirSync(cacheDir, { recursive: true });

const sites = readFileSync(join(here, 'sites.txt'), 'utf8').split('\n').map(s => s.trim()).filter(s => s && !s.startsWith('#'));

async function cardsOf(site) {
  // ab Plugin 1.9.2: Liste aller Karten mit PDF
  let r = await fetch(`https://${site}/wp-json/fs-speisekarten/v1/cards`).catch(() => null);
  if (r && r.ok) return (await r.json()).cards.filter(c => c.pdf);
  r = await fetch(`https://${site}/wp-json/fs-speisekarten/v1/google`).catch(() => null);
  if (!r || !r.ok) { console.log(`! ${site}: keine Karten-Liste`); return []; }
  const j = await r.json();
  return j.cards.map((c, i) => ({ id: c.id, title: c.title, pdf: j.foodMenus.menus[i]?.sourceUrl })).filter(c => c.pdf);
}

const line = it => it.type === 'sub' ? `  SUB ${it.name}`
  : `  ${it.nr || '-'} | ${it.name}${it.name2 ? ' / ' + it.name2 : ''} | ${(it.variants || []).map(v => (v.size ? v.size + ' ' : '') + v.price).join('; ')}`
    + (it.desc ? `\n      ${it.desc}` : '') + (it.desc2 ? `\n      EN ${it.desc2}` : '')
    + (it.veg ? ` [${it.veg}]` : '') + (it.spice ? ` [scharf ${it.spice}]` : '') + (it.extra ? ' [extra]' : '');

let n = 0;
for (const site of sites) {
  for (const c of await cardsOf(site)) {
    const file = join(cacheDir, `${site}-${c.id}.pdf`);
    if (!existsSync(file)) {
      const r = await fetch(c.pdf);
      if (!r.ok) { console.log(`! ${site} ${c.title}: PDF nicht ladbar (${r.status})`); continue; }
      writeFileSync(file, Buffer.from(await r.arrayBuffer()));
    }
    const m = await P.pdfToMenu(pdfjs, new Uint8Array(readFileSync(file)));
    const out = [];
    for (const s of m.sections) {
      out.push(`## ${s.title}${s.title2 ? ' / ' + s.title2 : ''}${s.note ? '  (' + s.note + ')' : ''}`);
      for (const it of s.items) out.push(line(it));
    }
    writeFileSync(join(outDir, `${site}-${c.id}.txt`), `# ${c.title} (${c.pdf})\n` + out.join('\n') + '\n');
    n++;
  }
}
console.log(`${n} Karten ausgelesen`);
if (!n) process.exit(1);
