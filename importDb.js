/**
 * importDb.js — Load IQ Dash data from JSON dumps into PostgreSQL.
 *
 * Default source: ./iq-dash-database.json/  (10 JSON files, one per table)
 * Override:       set IMPORT_DIR env var, or pass a path as first arg.
 *
 * Run:  node importDb.js
 *       node importDb.js /path/to/iq-dash-database.json
 *       IMPORT_DIR=./snapshot node importDb.js
 *
 * Idempotent: truncates target tables (in dependency order) and re-inserts.
 * One transaction — partial failures roll back.
 *
 * What it does NOT do:
 *   - Run schema DDL (server.js handles schema migrations on boot)
 *   - Touch the products / product_aliases tables (those are seeded by server.js)
 */
const fs = require('fs');
const path = require('path');
(function loadEnvUpwards() {
  let dir = __dirname;
  while (dir !== path.dirname(dir)) {
    const envPath = path.join(dir, '.env');
    if (fs.existsSync(envPath)) {
      require('dotenv').config({ path: envPath });
      return;
    }
    dir = path.dirname(dir);
  }
  require('dotenv').config();
})();
const { Pool } = require('pg');

const SRC_DIR = process.argv[2] || process.env.IMPORT_DIR || path.join(__dirname, 'iq-dash-database.json');

// Respect the standard Postgres PGSSLMODE env var so this script works
// against both local servers (no SSL) and managed Postgres (Neon, etc.).
const useSSL = process.env.PGSSLMODE && process.env.PGSSLMODE !== 'disable';
const pool = new Pool({
  host:     process.env.PGHOST,
  database: process.env.PGDATABASE,
  user:     process.env.PGUSER,
  password: process.env.PGPASSWORD,
  port:     process.env.PGPORT ? Number(process.env.PGPORT) : undefined,
  ssl:      useSSL ? { rejectUnauthorized: false } : false,
});

function loadJSON(name) {
  const p = path.join(SRC_DIR, name);
  if (!fs.existsSync(p)) throw new Error(`Missing: ${p}`);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// Numeric coercion: PG dump has numbers stored as TEXT — convert to Number,
// preserve null. Empty strings become null too.
const num = v => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
};
const bool = v => v === true || v === 'true' || v === 't' || v === 1 || v === '1';
const txt  = v => (v == null ? '' : String(v));

async function importAll() {
  console.log(`📂 Reading from: ${SRC_DIR}`);

  // Load all tables up-front so we can fail before truncating
  const data = {
    companies:               loadJSON('companies.json'),
    company_products:        loadJSON('company_products.json'),
    company_product_stats:   loadJSON('company_product_stats.json'),
    company_reapply_targets: loadJSON('company_reapply_targets.json'),
    company_shipments:       loadJSON('company_shipments.json'),
    cycles:                  loadJSON('cycles.json'),
    cycle_products:          loadJSON('cycle_products.json'),
    pending_meta:            loadJSON('pending_meta.json'),
    ra_records:              loadJSON('ra_records.json'),
    revision_changes:        loadJSON('revision_changes.json'),
  };

  console.log('📊 Row counts:');
  Object.entries(data).forEach(([k, v]) => console.log(`   ${k.padEnd(28)} ${v.length}`));

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Truncate in reverse dependency order so FKs don't block
    console.log('\n🧹 Truncating destination tables…');
    const truncOrder = [
      'company_reapply_targets', 'company_shipments', 'ra_records',
      'pending_meta', 'revision_changes', 'cycle_products', 'cycles',
      'company_product_stats', 'company_products', 'companies',
    ];
    for (const t of truncOrder) {
      await client.query(`DELETE FROM ${t}`);
    }

    // 1. companies (must be first — many FKs point here)
    console.log(`\n📥 Importing ${data.companies.length} companies…`);
    for (const c of data.companies) {
      await client.query(
        `INSERT INTO companies
           (code, grp, section, submit1, obtained, utilization_mt, available_quota,
            rev_type, rev_note, rev_submit_date, rev_status, rev_mt,
            remarks, spi_ref, status_update, pertek_no, spi_no,
            updated_by, updated_date, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
                 COALESCE($20::timestamptz, NOW()),
                 COALESCE($21::timestamptz, NOW()))`,
        [
          c.code, c.grp, c.section, num(c.submit1), num(c.obtained) ?? 0,
          num(c.utilization_mt) ?? 0, num(c.available_quota),
          c.rev_type || 'none', txt(c.rev_note), txt(c.rev_submit_date),
          txt(c.rev_status), num(c.rev_mt) ?? 0,
          txt(c.remarks), txt(c.spi_ref), txt(c.status_update),
          txt(c.pertek_no), txt(c.spi_no),
          txt(c.updated_by), txt(c.updated_date),
          c.created_at || null, c.updated_at || null,
        ]
      );
    }

    // 2. company_products
    console.log(`📥 Importing ${data.company_products.length} company-products…`);
    for (const r of data.company_products) {
      await client.query(
        `INSERT INTO company_products (company_code, product, sort_order)
         VALUES ($1,$2,$3)`,
        [r.company_code, r.product, num(r.sort_order) ?? 0]
      );
    }

    // 3. company_product_stats
    console.log(`📥 Importing ${data.company_product_stats.length} product stats…`);
    for (const r of data.company_product_stats) {
      await client.query(
        `INSERT INTO company_product_stats
           (company_code, product, utilization_mt, available_mt, realization_mt, eta_jkt, arrived)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (company_code, product) DO UPDATE SET
           utilization_mt = EXCLUDED.utilization_mt,
           available_mt   = EXCLUDED.available_mt,
           realization_mt = EXCLUDED.realization_mt,
           eta_jkt        = EXCLUDED.eta_jkt,
           arrived        = EXCLUDED.arrived`,
        [r.company_code, r.product,
         num(r.utilization_mt) ?? 0, num(r.available_mt),
         num(r.realization_mt), txt(r.eta_jkt), bool(r.arrived)]
      );
    }

    // 4. revision_changes
    console.log(`📥 Importing ${data.revision_changes.length} revision changes…`);
    for (const r of data.revision_changes) {
      await client.query(
        `INSERT INTO revision_changes
           (company_code, direction, product, mt, label, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [r.company_code, r.direction, r.product, num(r.mt),
         txt(r.label), num(r.sort_order) ?? 0]
      );
    }

    // 5. cycles + cycle_products
    // Old IDs from the dump don't survive the re-insert, so we map dumped
    // cycle id → new SERIAL id and rewrite cycle_products.cycle_id references.
    console.log(`📥 Importing ${data.cycles.length} cycles…`);
    const cycleIdMap = new Map();
    // Sort cycles so the same insertion order is preserved per company
    const sortedCycles = [...data.cycles].sort((a, b) => {
      if (a.company_code !== b.company_code) return a.company_code.localeCompare(b.company_code);
      return (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0);
    });
    for (const c of sortedCycles) {
      const { rows } = await client.query(
        `INSERT INTO cycles
           (company_code, cycle_type, mt, submit_type, submit_date,
            release_type, release_date, status, sort_order,
            pertek_date, spi_date, from_rev_req)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING id`,
        [
          c.company_code, c.cycle_type, txt(c.mt),
          txt(c.submit_type), txt(c.submit_date),
          txt(c.release_type), txt(c.release_date),
          txt(c.status), num(c.sort_order) ?? 0,
          txt(c.pertek_date), txt(c.spi_date), bool(c.from_rev_req),
        ]
      );
      cycleIdMap.set(c.id, rows[0].id);
    }

    console.log(`📥 Importing ${data.cycle_products.length} cycle-products…`);
    let cycleProdSkipped = 0;
    for (const r of data.cycle_products) {
      const newCycleId = cycleIdMap.get(r.cycle_id);
      if (!newCycleId) { cycleProdSkipped++; continue; }
      await client.query(
        `INSERT INTO cycle_products (cycle_id, product, mt) VALUES ($1,$2,$3)`,
        [newCycleId, r.product, txt(r.mt)]
      );
    }
    if (cycleProdSkipped) console.log(`   ⚠  Skipped ${cycleProdSkipped} cycle_products with unknown cycle_id`);

    // 6. pending_meta
    console.log(`📥 Importing ${data.pending_meta.length} pending meta…`);
    for (const r of data.pending_meta) {
      await client.query(
        `INSERT INTO pending_meta (company_code, mt, status, date)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (company_code) DO UPDATE SET
           mt=EXCLUDED.mt, status=EXCLUDED.status, date=EXCLUDED.date`,
        [r.company_code, num(r.mt) ?? 0, txt(r.status), txt(r.date)]
      );
    }

    // 7. ra_records
    console.log(`📥 Importing ${data.ra_records.length} RA records…`);
    for (const r of data.ra_records) {
      await client.query(
        `INSERT INTO ra_records
           (company_code, product, berat, obtained, cargo_arrived, real_pct, util_pct,
            arrival_date, eta_jkt, reapply_est, reapply_stage, reapply_product,
            reapply_new_total, reapply_prev_obtained, reapply_additional,
            reapply_submit_date, reapply_status, target, pertek, spi, catatan,
            created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,
                 COALESCE($22::timestamptz, NOW()),
                 COALESCE($23::timestamptz, NOW()))`,
        [
          r.company_code, r.product, num(r.berat) ?? 0, num(r.obtained) ?? 0,
          bool(r.cargo_arrived), num(r.real_pct) ?? 0, num(r.util_pct),
          r.arrival_date || null, r.eta_jkt || null, r.reapply_est || null,
          num(r.reapply_stage) ?? 1, r.reapply_product || null,
          num(r.reapply_new_total), num(r.reapply_prev_obtained), num(r.reapply_additional),
          r.reapply_submit_date || null, r.reapply_status || null,
          num(r.target), r.pertek || null, r.spi || null, r.catatan || null,
          r.created_at || null, r.updated_at || null,
        ]
      );
    }

    // 8. company_shipments
    console.log(`📥 Importing ${data.company_shipments.length} shipments…`);
    for (const r of data.company_shipments) {
      await client.query(
        `INSERT INTO company_shipments
           (company_code, product, lot_no, util_mt, eta_jkt, note, real_mt, pib_date, cargo_arrived,
            created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,
                 COALESCE($10::timestamptz, NOW()),
                 COALESCE($11::timestamptz, NOW()))
         ON CONFLICT (company_code, product, lot_no) DO UPDATE SET
           util_mt=EXCLUDED.util_mt, eta_jkt=EXCLUDED.eta_jkt, note=EXCLUDED.note,
           real_mt=EXCLUDED.real_mt, pib_date=EXCLUDED.pib_date,
           cargo_arrived=EXCLUDED.cargo_arrived, updated_at=NOW()`,
        [
          r.company_code, r.product, num(r.lot_no) ?? 1,
          num(r.util_mt) ?? 0, txt(r.eta_jkt), txt(r.note),
          num(r.real_mt) ?? 0, txt(r.pib_date), bool(r.cargo_arrived),
          r.created_at || null, r.updated_at || null,
        ]
      );
    }

    // 9. company_reapply_targets
    console.log(`📥 Importing ${data.company_reapply_targets.length} reapply targets…`);
    for (const r of data.company_reapply_targets) {
      await client.query(
        `INSERT INTO company_reapply_targets
           (company_code, product, target_mt, submitted, submit_date, notes, created_at)
         VALUES ($1,$2,$3,$4,$5,$6, COALESCE($7::timestamptz, NOW()))
         ON CONFLICT (company_code, product) DO UPDATE SET
           target_mt=EXCLUDED.target_mt, submitted=EXCLUDED.submitted,
           submit_date=EXCLUDED.submit_date, notes=EXCLUDED.notes`,
        [
          r.company_code, r.product, num(r.target_mt),
          bool(r.submitted), txt(r.submit_date), txt(r.notes),
          r.created_at || null,
        ]
      );
    }

    await client.query('COMMIT');
    console.log('\n✅ Import complete — all tables loaded in one transaction.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n❌ Import failed — transaction rolled back:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

importAll().catch(err => {
  console.error(err);
  process.exit(1);
});
