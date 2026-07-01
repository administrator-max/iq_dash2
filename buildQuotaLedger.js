#!/usr/bin/env node
/*
 * buildQuotaLedger.js — regenerate lib/quotaLedger.json from a master xlsx.
 *
 * The quota ledger is the single source of truth for Obtained / Utilized /
 * Available (see migration_work/ARCHITECTURE_LEDGER.md). When a new master
 * arrives (e.g. "00 IQ Dash - Quota Data … (7).xlsx"), run:
 *
 *     node buildQuotaLedger.js "C:/path/to/master (7).xlsx"
 *     git add lib/quotaLedger.json && git commit && git push heroku main
 *
 * Product identity is HS code; the canonical HS↔name registry lives in
 * migration_work/ledger_seed/products.json (from Neon quota_monitoring
 * tbl_product). Obtained = effective (Obtained #N + Revision #N, revisions
 * reassign quota between HS). Utilized = the "Utilization (MT)" rows.
 */
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const masterPath = process.argv[2];
if (!masterPath) { console.error('usage: node buildQuotaLedger.js <master.xlsx>'); process.exit(1); }

const products = JSON.parse(fs.readFileSync(path.join(__dirname, 'migration_work/ledger_seed/products.json'), 'utf8'));
const productsMap = {}; products.forEach(p => { productsMap[p.hs_code] = p.name; });

const wb = XLSX.readFile(masterPath);
const sheet = wb.Sheets[wb.SheetNames.find(n => /submiss|status/i.test(n)) || wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
// HS codes are in row index 2 (0-based), product columns span 4..28
const hsRow = rows[2];
const cols = [];
for (let c = 4; c <= 28; c++) { const hs = String(hsRow[c] || '').trim(); if (hs) cols.push({ c, hs }); }
const num = v => { const n = parseFloat(String(v).replace(/,/g, '')); return isNaN(n) ? 0 : n; };

let curCo = '';
const companies = {};
const ensure = (co, hs) => { companies[co] = companies[co] || {}; companies[co][hs] = companies[co][hs] || { obtained: 0, util: 0 }; return companies[co][hs]; };
for (let i = 3; i < rows.length; i++) {
  const r = rows[i];
  const co = String(r[1] || '').trim(); if (co) curCo = co;
  const st = String(r[2] || '').trim();
  if (/^Total /i.test(st)) continue;
  const isObt = /^Obtained #\d/i.test(st), isRev = /^Revision #\d/i.test(st), isUtil = /^Utilization \(MT\)/i.test(st);
  if (!isObt && !isRev && !isUtil) continue;
  for (const p of cols) {
    const v = num(r[p.c]); if (!v) continue;
    const e = ensure(curCo, p.hs);
    if (isObt || isRev) e.obtained += v;   // effective obtained incl. revisions
    if (isUtil) e.util += v;
  }
}
// snap to whole MT + drop empty companies.
// Import quota is always allocated in whole MT. Any fractional value is a
// data-entry artifact in the master — e.g. an unbalanced Revision reallocation
// like -353 / +353.3 that nets a phantom +0.3 MT (MIN / 7225.92.90, master
// 120526). Snapping to the nearest whole MT kills the phantom; we warn on each
// snap so the underlying master typo surfaces in build output instead of
// silently inflating the Obtained total (which fmtMt's ceil then exposes).
Object.keys(companies).forEach(co => {
  Object.keys(companies[co]).forEach(hs => {
    const v = companies[co][hs];
    if (v.obtained % 1 !== 0 || v.util % 1 !== 0) {
      console.warn(`  ⚠ fractional MT snapped ${co}/${hs}: obtained ${v.obtained}→${Math.round(v.obtained)}, util ${v.util}→${Math.round(v.util)} (check master for unbalanced revision)`);
    }
    v.obtained = Math.round(v.obtained);
    v.util = Math.round(v.util);
    if (v.obtained === 0 && v.util === 0) delete companies[co][hs];
  });
  if (!Object.keys(companies[co]).length) delete companies[co];
});

let O = 0, U = 0;
Object.values(companies).forEach(hh => Object.values(hh).forEach(v => { O += v.obtained; U += v.util; }));
const out = {
  _meta: { source: path.basename(masterPath), generated: new Date().toISOString().slice(0, 10), view: 'effective (obtained incl. revisions)' },
  products: productsMap,
  companies,
};
const outPath = path.join(__dirname, 'lib/quotaLedger.json');
fs.writeFileSync(outPath, JSON.stringify(out, null, 1));
console.log(`✓ ${outPath}`);
console.log(`  companies: ${Object.keys(companies).length} | Obtained: ${O.toFixed(0)} | Utilized: ${U.toFixed(0)} | Available: ${(O - U).toFixed(0)}`);
