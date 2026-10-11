#!/usr/bin/env node
// Reads the shop export (elementi.json) and writes the normalized catalog:
//   katalog.json     – elements in the planner format
//   katalog.csv      – the same as a table, for checking the classification in Excel
//   demo/katalog.js  – window.KP_ELEMENTS, so the demo opens without a server
// Usage: node scripts/build-catalog.js [path/to/elementi.json]

const fs = require('fs');
const path = require('path');
const KitchenPlanner = require('../src/kitchen-planner.js');

const root = path.join(__dirname, '..');
const input = path.resolve(process.argv[2] || path.join(root, 'elementi.json'));
const raw = JSON.parse(fs.readFileSync(input, 'utf8'));
const { elements, warnings } = KitchenPlanner.normalizeAll(raw);

fs.writeFileSync(path.join(root, 'katalog.json'), JSON.stringify(elements, null, 2) + '\n');

const columns = [
  ['id', e => e.id],
  ['sifra', e => e.sku],
  ['linija', e => e.series],
  ['tip', e => e.type],
  ['zona', e => e.zone],
  ['sirina', e => e.width],
  ['visina', e => e.height],
  ['dubina', e => e.depth],
  ['boja', e => e.color],
  ['vrata', e => e.fronts.doors],
  ['ladice', e => e.fronts.drawers],
  ['sa_radnom_plocom', e => (e.withWorktop ? 'da' : 'ne')],
  ['slika', e => e.images.length],
  ['naziv', e => e.name],
];
const cell = v => '"' + String(v).replace(/"/g, '""') + '"';
const csv = [columns.map(c => c[0]).join(';')]
  .concat(elements.map(e => columns.map(([, f]) => cell(f(e))).join(';')))
  .join('\r\n');
fs.writeFileSync(path.join(root, 'katalog.csv'), '\ufeff' + csv + '\r\n');

fs.mkdirSync(path.join(root, 'demo'), { recursive: true });
fs.writeFileSync(path.join(root, 'demo', 'katalog.js'), 'window.KP_ELEMENTS = ' + JSON.stringify(elements) + ';\n');

// ----- report --------------------------------------------------------------

const count = (list, key) => list.reduce((m, e) => ((m[key(e)] = (m[key(e)] || 0) + 1), m), {});
console.log(`Elemenata: ${elements.length} (${input})\n`);

console.log('Po liniji:');
Object.entries(count(elements, e => e.series)).sort().forEach(([k, v]) => console.log(`  ${k.padEnd(10)} ${v}`));

console.log('\nPo tipu:');
Object.entries(count(elements, e => `${e.zone} / ${e.type}`)).sort().forEach(([k, v]) => console.log(`  ${k.padEnd(26)} ${v}`));

const byCode = {};
warnings.forEach(w => w.issues.forEach(i => (byCode[i.code] = byCode[i.code] || []).push({ name: w.name, id: w.id, message: i.message })));
const noPrice = byCode['no-price'] || [];
delete byCode['no-price'];

console.log('\nUpozorenja za podatke:');
if (noPrice.length) console.log(`  - ${noPrice.length} od ${elements.length} elemenata nema cijenu (vpCijena = 0)`);
Object.entries(byCode).forEach(([code, list]) => {
  console.log(`\n  [${code}] ${list.length}×`);
  list.forEach(i => console.log(`    ${String(i.id).padStart(5)}  ${i.name}: ${i.message}`));
});
console.log('\nZapisano: katalog.json, katalog.csv, demo/katalog.js');
