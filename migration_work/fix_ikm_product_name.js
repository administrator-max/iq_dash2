// One-off data correction: IKM product label "GL BORON" -> "GI ALLOY" (HS 7225.92.90).
// Ledger (source of truth) has IKM under 7225.92.90 = GI ALLOY; the cycle/company_products
// label "GL BORON" (which globally aliases to GL ALLOY 7225.99.90) is a GI/GL typo for IKM only.
// KJK/PPGL correctly use GL BORON=GL ALLOY and are NOT touched (scope: company IKM only).
//
//   Dry-run (default): node migration_work/fix_ikm_product_name.js
//   Apply:             node migration_work/fix_ikm_product_name.js apply
const store = require('../lib/sheetsStore');
const CODE = 'IKM', FROM = 'GL BORON', TO = 'GI ALLOY';
const APPLY = process.argv[2] === 'apply';

(async () => {
  const [cps, cycles, cyps, stats] = await Promise.all([
    store.table('company_products'),
    store.table('cycles'),
    store.table('cycle_products'),
    store.table('company_product_stats'),
  ]);
  const ikmCycleIds = new Set(cycles.filter(c => c.company_code === CODE).map(c => String(c.id)));

  const cpsHit  = cps.filter(r => r.company_code === CODE && r.product === FROM);
  const cypsHit = cyps.filter(r => ikmCycleIds.has(String(r.cycle_id)) && r.product === FROM);
  const stHit   = stats.filter(r => r.company_code === CODE && r.product === FROM);
  const stTo    = stats.filter(r => r.company_code === CODE && r.product === TO);

  console.log(`IKM cycle ids: ${[...ikmCycleIds].join(',') || '(none)'}`);
  console.log(`company_products rows "${FROM}": ${cpsHit.length}`, cpsHit.map(r => r.product));
  console.log(`cycle_products rows "${FROM}" (IKM cycles): ${cypsHit.length}`, cypsHit.map(r => `cyc${r.cycle_id}:${r.product}=${r.mt}`));
  console.log(`company_product_stats rows "${FROM}": ${stHit.length}`, stHit.map(r => `${r.product} util=${r.utilization_mt} avail=${r.available_mt}`));
  console.log(`company_product_stats already-"${TO}" rows: ${stTo.length}`, stTo.map(r => `${r.product} util=${r.utilization_mt} avail=${r.available_mt}`));

  if (!APPLY) { console.log('\n[DRY-RUN] no changes written. Re-run with "apply" to correct.'); return; }

  // Guard: refuse if a merge collision would occur in stats (both GL BORON and GI ALLOY rows exist).
  if (stHit.length && stTo.length) {
    console.error(`ABORT: IKM has BOTH "${FROM}" and "${TO}" stats rows — merge needed, not a plain rename. Fix manually.`);
    process.exit(1);
  }

  const writes = {};
  if (cpsHit.length) { cps.forEach(r => { if (r.company_code === CODE && r.product === FROM) r.product = TO; }); writes.company_products = cps; }
  if (cypsHit.length) { cyps.forEach(r => { if (ikmCycleIds.has(String(r.cycle_id)) && r.product === FROM) r.product = TO; }); writes.cycle_products = cyps; }
  if (stHit.length) { stats.forEach(r => { if (r.company_code === CODE && r.product === FROM) r.product = TO; }); writes.company_product_stats = stats; }

  if (!Object.keys(writes).length) { console.log('Nothing to change.'); return; }
  await store.batchRewrite(writes);
  await store.logChange({ sheet: Object.keys(writes).join('+'), record_id: CODE, field: 'product',
    old_value: FROM, new_value: TO, changed_by: 'data-fix',
    note: `IKM label GL BORON->GI ALLOY (typo GI/GL; ledger HS 7225.92.90). cps=${cpsHit.length} cyps=${cypsHit.length} stats=${stHit.length}` });
  console.log(`\n[APPLIED] renamed "${FROM}"->"${TO}" for IKM: company_products=${cpsHit.length}, cycle_products=${cypsHit.length}, stats=${stHit.length}. Logged to Change_Log.`);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
