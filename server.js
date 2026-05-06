/**
 * server.js — IQ Dash Express API Server
 * Serves the static frontend and exposes REST endpoints
 * for all quota data backed by PostgreSQL (Neon or local).
 */
const fs      = require('fs');
const path    = require('path');
// Walk up the directory tree to find .env so the server still works
// when it's launched from inside a git worktree (where the .env lives
// at the main project root, several levels up).
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
  require('dotenv').config(); // fallback: cwd
})();
const express     = require('express');
const cors        = require('cors');
const compression = require('compression');
const { Pool }    = require('pg');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── DB Pool ──────────────────────────────────────────────────────
// SSL is ON by default — managed Postgres (Heroku, Neon, etc.) requires
// it and that's the production path. To opt out for a local Postgres
// instance that doesn't support SSL, set PGSSLMODE=disable in .env.
const useSSL = process.env.PGSSLMODE !== 'disable';
const pool = new Pool({
  host:     process.env.PGHOST,
  database: process.env.PGDATABASE,
  user:     process.env.PGUSER,
  password: process.env.PGPASSWORD,
  port:     process.env.PGPORT ? Number(process.env.PGPORT) : undefined,
  ssl:      useSSL ? { rejectUnauthorized: false } : false,
  max:      10,
});

// ── Middleware ───────────────────────────────────────────────────
// gzip compression — JSON responses (notably /api/data, ~100KB+) drop
// to ~15-25% of original size. Big win on slow connections / Heroku.
app.use(compression());
app.use(cors());
// Bumped from the 100KB Express default — PATCH /api/company/:code can carry
// a full cycles + shipments + reapplyTargets payload that exceeds 100KB on
// companies with many lots/products. 5MB is well above any realistic single
// company payload and below memory-pressure thresholds.
app.use(express.json({ limit: '5mb' }));
// Cache static assets for 1 hour. Script tags use ?v=N for cache busting,
// so bumping that param forces re-fetch when code changes.
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1h',
  etag:   true,
  lastModified: true,
}));

// ═══════════════════════════════════════════════════════════════════
// SCHEMA INIT  (PgBouncer-safe: one statement at a time)
// ═══════════════════════════════════════════════════════════════════
async function initDB() {
  const schemaPath = path.join(__dirname, 'schema.sql');
  if (!fs.existsSync(schemaPath)) {
    console.warn('⚠  schema.sql not found — skipping auto-init');
    return;
  }
  const client = await pool.connect();
  try {
    const sql = fs.readFileSync(schemaPath, 'utf8');
    const statements = sql
      .split(';')
      .map(s => s.replace(/--[^\n]*/g, '').trim())
      .filter(s => s.length > 0);
    for (const stmt of statements) {
      await client.query(stmt);
    }
    console.log('✅ DB schema ready');
  } catch (err) {
    console.error('❌ Schema init error:', err.message);
  } finally {
    client.release();
  }
}

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

/** Fetch all cycles (with products) for an array of company codes.
    Uses DISTINCT ON (company_code, cycle_type) to deduplicate at the DB
    level — the legacy DB has accumulated 16k+ duplicate cycle rows for a
    handful of companies (e.g. CGK alone has ~11k rows). Without this,
    the cycles query takes ~1.7s and the cycle_products lookup another
    ~0.9s. With dedup, both drop to <50ms each. The frontend already
    dedups by cycle_type (`canonicalObtained` etc.), so we just push that
    same logic down to SQL — keeping the row with the smallest sort_order
    matches the frontend's "first occurrence wins" rule. */
async function getCyclesFor(codes) {
  if (!codes.length) return {};
  const { rows: cRows } = await pool.query(
    `SELECT id, company_code, cycle_type, mt, submit_type, submit_date,
            release_type, release_date, status, sort_order,
            pertek_date, spi_date, from_rev_req
     FROM (
       SELECT DISTINCT ON (c.company_code, c.cycle_type)
              c.id, c.company_code, c.cycle_type, c.mt,
              c.submit_type, c.submit_date, c.release_type, c.release_date,
              c.status, c.sort_order,
              COALESCE(c.pertek_date,'')      AS pertek_date,
              COALESCE(c.spi_date,'')         AS spi_date,
              COALESCE(c.from_rev_req,false)  AS from_rev_req
       FROM cycles c
       WHERE c.company_code = ANY($1)
       ORDER BY c.company_code, c.cycle_type, c.sort_order ASC
     ) deduped
     ORDER BY company_code, sort_order`, [codes]
  );
  const cycleIds = cRows.map(r => r.id);
  let cpMap = {};
  if (cycleIds.length) {
    const { rows: cpRows } = await pool.query(
      `SELECT cycle_id, product, mt FROM cycle_products WHERE cycle_id = ANY($1)`,
      [cycleIds]
    );
    cpRows.forEach(r => {
      if (!cpMap[r.cycle_id]) cpMap[r.cycle_id] = {};
      cpMap[r.cycle_id][r.product] = isNaN(r.mt) ? r.mt : Number(r.mt);
    });
  }
  const byCode = {};
  cRows.forEach(c => {
    if (!byCode[c.company_code]) byCode[c.company_code] = [];
    byCode[c.company_code].push({
      type:        c.cycle_type,
      mt:          isNaN(c.mt) ? c.mt : Number(c.mt),
      submitType:  c.submit_type,
      submitDate:  c.submit_date,
      releaseType: c.release_type,
      releaseDate: c.release_date,
      status:      c.status,
      products:    cpMap[c.id] || {},
      pertekDate:  c.pertek_date  || '',
      spiDate:     c.spi_date     || '',
      _fromRevReq: c.from_rev_req || false,
    });
  });
  return byCode;
}

/** Build a full company JSON object from DB rows */
function buildCompanyObj(co, products, stats, revFrom, revTo, cycles, pendMeta, shipments, reapplyTargets) {
  const utilizationByProd = {};
  const availableByProd   = {};
  const realizationByProd = {};
  const etaByProd         = {};
  const arrivedByProd     = {};
  (stats || []).forEach(s => {
    if (s.utilization_mt != null) utilizationByProd[s.product] = Number(s.utilization_mt);
    if (s.available_mt   != null) availableByProd[s.product]   = Number(s.available_mt);
    if (s.realization_mt != null) realizationByProd[s.product] = Number(s.realization_mt);
    if (s.eta_jkt)                etaByProd[s.product]         = s.eta_jkt;
    arrivedByProd[s.product] = s.arrived || false;
  });

  const revFromArr = (revFrom || []).filter(r => r.direction === 'from').sort((a,b)=>a.sort_order-b.sort_order).map(r=>({prod:r.product,mt:r.mt?Number(r.mt):null,label:r.label}));
  const revToArr   = (revTo   || []).filter(r => r.direction === 'to'  ).sort((a,b)=>a.sort_order-b.sort_order).map(r=>({prod:r.product,mt:r.mt?Number(r.mt):null,label:r.label}));

  const obj = {
    code:           co.code,
    fullName:       co.full_name || '',
    group:          co.grp,
    section:        co.section,
    products:       (products || []).sort((a,b)=>a.sort_order-b.sort_order).map(p=>p.product),
    submit1:        co.submit1  != null ? Number(co.submit1)  : null,
    obtained:       co.obtained != null ? Number(co.obtained) : 0,
    utilizationMT:  Number(co.utilization_mt) || 0,
    availableQuota: co.available_quota != null ? Number(co.available_quota) : null,
    revType:        co.rev_type     || 'none',
    revNote:        (() => {
      // If rev_note contains JSON (salesRevRequest), extract it; otherwise plain text
      const rn = co.rev_note || '';
      try {
        const parsed = JSON.parse(rn);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return '';
      } catch(e) {}
      return rn;
    })(),
    salesRevRequest: (() => {
      const rn = co.rev_note || '';
      try {
        const parsed = JSON.parse(rn);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
      } catch(e) {}
      return {};
    })(),
    revSubmitDate:  co.rev_submit_date || '',
    revStatus:      co.rev_status   || '',
    revMT:          Number(co.rev_mt) || 0,
    revFrom:        revFromArr,
    revTo:          revToArr,
    remarks:        co.remarks      || '',
    spiRef:         co.spi_ref      || '',
    statusUpdate:   co.status_update|| '',
    pertekNo:       co.pertek_no    || '',
    spiNo:          co.spi_no       || '',
    updatedBy:      co.updated_by   || '',
    updatedDate:    co.updated_date || '',
    // ── Concurrency token ─────────────────────────────────────────────
    // ISO timestamp of the last server-side write (companies.updated_at).
    // Client echoes this back as `_ifUpdatedAt` on PATCH; server rejects
    // (409) if the row was modified by someone else in the meantime.
    // This protects against stale browser data overwriting newer changes
    // when the dashboard is open in multiple tabs / by multiple users.
    updatedAt:      co.updated_at ? new Date(co.updated_at).toISOString() : null,
    utilizationByProd,
    availableByProd,
    cycles:         cycles || [],
    shipments:      shipments || {},
    reapplyTargets: reapplyTargets || [],
  };
  if (Object.keys(realizationByProd).length) obj.realizationByProd = realizationByProd;
  if (Object.keys(etaByProd).length)         obj.etaByProd         = etaByProd;
  if (Object.keys(arrivedByProd).length)      obj.arrivedByProd     = arrivedByProd;
  if (co.section === 'PENDING' && pendMeta) {
    obj.mt      = Number(pendMeta.mt) || 0;
    obj.status  = pendMeta.status || '';
    obj.date    = pendMeta.date   || '';
  }
  return obj;
}

// ═══════════════════════════════════════════════════════════════════
// GET /api/data  — full dataset for frontend
// ═══════════════════════════════════════════════════════════════════
// ── Auto-migrate: add extra columns to cycles table if missing ──────
(async () => {
  try {
    await pool.query(`
      ALTER TABLE cycles
        ADD COLUMN IF NOT EXISTS pertek_date TEXT DEFAULT '',
        ADD COLUMN IF NOT EXISTS spi_date    TEXT DEFAULT '',
        ADD COLUMN IF NOT EXISTS from_rev_req BOOLEAN DEFAULT FALSE
    `);
  } catch(e) {
    // Table might not support ALTER or columns already exist — ignore
    console.log('cycles migration skipped:', e.message);
  }
})();

// ── Seed `products` master table on first boot ──────────────────────
// HS codes + colors live in DB so adding a new product or fixing a
// wrong HS code doesn't require a code change. Idempotent: only seeds
// when the table is empty.
// Product master seed — canonical names + HS codes from product.xlsx
// (the customer-supplied product library, treated as source of truth).
// Older hardcoded names like 'GL BORON', 'SHEETPILE', etc. are kept as
// aliases via PRODUCT_ALIAS_SEED so existing data still resolves.
const PRODUCTS_SEED = [
  // Hot-rolled
  { name: 'HRC ≥3 mm to <4.75 mm', hs_code: '7208.38.00', color_solid: '#0369a1', color_light: '#e0f2fe', color_text: '#0369a1', sort_order: 1 },
  { name: 'HRC <3 mm',             hs_code: '7208.39.90', color_solid: '#0284c7', color_light: '#e0f2fe', color_text: '#0369a1', sort_order: 2 },
  // Alloy (matches old GL/GI BORON via aliases)
  { name: 'HRPO ALLOY',            hs_code: '7225.30.90', color_solid: '#ca8a04', color_light: '#fef3c7', color_text: '#92400e', sort_order: 3 },
  { name: 'BORDES ALLOY',          hs_code: '7225.40.90', color_solid: '#dc2626', color_light: '#fee2e2', color_text: '#991b1b', sort_order: 4 },
  { name: 'ZAM ALLOY',             hs_code: '7225.92.20', color_solid: '#a16207', color_light: '#fef9c3', color_text: '#854d0e', sort_order: 5 },
  { name: 'GI ALLOY',              hs_code: '7225.92.90', color_solid: '#0f766e', color_light: '#ccfbf1', color_text: '#0f766e', sort_order: 6 },
  { name: 'GL ALLOY',              hs_code: '7225.99.90', color_solid: '#0369a1', color_light: '#e0f2fe', color_text: '#0369a1', sort_order: 7 },
  // Structural
  { name: 'AS STEEL',              hs_code: '7228.30.10', color_solid: '#64748b', color_light: '#f1f5f9', color_text: '#475569', sort_order: 8 },
  { name: 'BEAM ALLOY',            hs_code: '7228.70.10', color_solid: '#475569', color_light: '#f1f5f9', color_text: '#334155', sort_order: 9 },
  // Coated carbon
  { name: 'ZAM >1.2 mm to ≤1.5 mm', hs_code: '7210.49.15', color_solid: '#fbbf24', color_light: '#fef9c3', color_text: '#854d0e', sort_order: 10 },
  { name: 'ZAM >1.5 mm',            hs_code: '7210.49.16', color_solid: '#f59e0b', color_light: '#fef3c7', color_text: '#92400e', sort_order: 11 },
  { name: 'GI CARBON',              hs_code: '7210.49.17', color_solid: '#0d9488', color_light: '#ccfbf1', color_text: '#0f766e', sort_order: 12 },
  { name: 'GL CARBON',              hs_code: '7210.61.11', color_solid: '#0284c7', color_light: '#e0f2fe', color_text: '#0369a1', sort_order: 13 },
  { name: 'PPGL CARBON',            hs_code: '7210.70.13', color_solid: '#7c3aed', color_light: '#ede9fe', color_text: '#5b21b6', sort_order: 14 },
  { name: 'GL SLIT',                hs_code: '7212.50.24', color_solid: '#1e56c6', color_light: '#eff4ff', color_text: '#1e3a8a', sort_order: 15 },
  // Sections
  { name: 'CHANNEL',                hs_code: '7216.31.90', color_solid: '#9333ea', color_light: '#f3e8ff', color_text: '#6b21a8', sort_order: 16 },
  { name: 'BEAM',                   hs_code: '7216.33.11', color_solid: '#a855f7', color_light: '#f3e8ff', color_text: '#6b21a8', sort_order: 17 },
  { name: 'ANGLE',                  hs_code: '7216.40.90', color_solid: '#d946ef', color_light: '#fae8ff', color_text: '#86198f', sort_order: 18 },
  // Sheet pile
  { name: 'SHEET PILE',             hs_code: '7301.10.00', color_solid: '#b45309', color_light: '#fef9c3', color_text: '#92400e', sort_order: 19 },
  { name: 'SHEET PILE (INTERLOCKS)', hs_code: '7301.20.00', color_solid: '#c2410c', color_light: '#fff7ed', color_text: '#9a3412', sort_order: 20 },
  // Pipes
  { name: 'SEAMLESS PIPE',          hs_code: '7304.19.00', color_solid: '#0d6946', color_light: '#d1fae5', color_text: '#065f46', sort_order: 21 },
  { name: 'ERW PIPE (OD ≤ 140 mm)', hs_code: '7306.30.91', color_solid: '#9333ea', color_light: '#f3e8ff', color_text: '#6b21a8', sort_order: 22 },
  { name: 'ERW PIPE (OD > 140mm)',  hs_code: '7306.30.99', color_solid: '#0891b2', color_light: '#e0f7fa', color_text: '#155e75', sort_order: 23 },
  { name: 'HOLLOW PIPE',            hs_code: '7306.61.90', color_solid: '#78716c', color_light: '#f5f5f4', color_text: '#57534e', sort_order: 24 },
  // Fabricated
  { name: 'STRUCTURAL STEEL',       hs_code: '7308.90.99', color_solid: '#525252', color_light: '#f5f5f5', color_text: '#404040', sort_order: 25 },
];
// Variant → canonical product name. Two flavors here:
//   1. Bridges from the previous hardcoded names ('GL BORON', 'SHEETPILE',
//      'ERW PIPE OD≤140mm', etc.) to the new product.xlsx canonicals
//      ('GL ALLOY', 'SHEET PILE', 'ERW PIPE (OD ≤ 140 mm)'). Without these
//      existing rows in cycle_products / ra_records / realizations would
//      orphan from product metadata after the seed swap.
//   2. Short-forms found in the iq-dash-database JSON dump (RA records).
const PRODUCT_ALIAS_SEED = [
  // Old hardcoded → new Excel canonical
  { alias: 'GL BORON',           canonical: 'GL ALLOY' },
  { alias: 'GI BORON',           canonical: 'GI ALLOY' },
  { alias: 'SHEETPILE',          canonical: 'SHEET PILE' },
  { alias: 'ERW PIPE OD≤140mm',  canonical: 'ERW PIPE (OD ≤ 140 mm)' },
  { alias: 'ERW PIPE OD>140mm',  canonical: 'ERW PIPE (OD > 140mm)' },
  { alias: 'HRC/HRPO ALLOY',     canonical: 'HRPO ALLOY' },
  // RA-record short-forms
  { alias: 'GI',                 canonical: 'GI ALLOY' },
  { alias: 'GL',                 canonical: 'GL ALLOY' },
  { alias: 'GI Boron',           canonical: 'GI ALLOY' },
  { alias: 'GL Boron',           canonical: 'GL ALLOY' },
  { alias: 'PPGL',               canonical: 'PPGL CARBON' },
];
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS products (
        name         TEXT PRIMARY KEY,
        hs_code      TEXT DEFAULT '',
        color_solid  TEXT DEFAULT '#64748b',
        color_light  TEXT DEFAULT '#f1f5f9',
        color_text   TEXT DEFAULT '#475569',
        sort_order   INT DEFAULT 0,
        created_at   TIMESTAMPTZ DEFAULT NOW(),
        updated_at   TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM products`);
    if ((rows[0] && rows[0].n) === 0) {
      for (const p of PRODUCTS_SEED) {
        await pool.query(
          `INSERT INTO products (name, hs_code, color_solid, color_light, color_text, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (name) DO NOTHING`,
          [p.name, p.hs_code, p.color_solid, p.color_light, p.color_text, p.sort_order]
        );
      }
      console.log(`✅ Seeded ${PRODUCTS_SEED.length} products`);
    }

    // Aliases — only seeds when empty, idempotent.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS product_aliases (
        alias       TEXT PRIMARY KEY,
        canonical   TEXT NOT NULL REFERENCES products(name) ON DELETE CASCADE,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    const { rows: aliasRows } = await pool.query(`SELECT COUNT(*)::int AS n FROM product_aliases`);
    if ((aliasRows[0] && aliasRows[0].n) === 0) {
      for (const a of PRODUCT_ALIAS_SEED) {
        await pool.query(
          `INSERT INTO product_aliases (alias, canonical) VALUES ($1, $2)
           ON CONFLICT (alias) DO NOTHING`,
          [a.alias, a.canonical]
        );
      }
      console.log(`✅ Seeded ${PRODUCT_ALIAS_SEED.length} product aliases`);
    }
  } catch (e) {
    console.log('products migration skipped:', e.message);
  }
})();

// ── Add CHECK constraints for enum-like columns ─────────────────
// Wraps each ALTER in DO/EXCEPTION so re-runs don't error.
// Values discovered by surveying the iq-dash-database JSON dump.
(async () => {
  const checks = [
    { name: 'companies_section_chk',  sql: `ALTER TABLE companies ADD CONSTRAINT companies_section_chk  CHECK (section IN ('SPI','PENDING'))` },
    { name: 'companies_grp_chk',      sql: `ALTER TABLE companies ADD CONSTRAINT companies_grp_chk      CHECK (grp IN ('AB','CD','NORMATIF'))` },
    { name: 'companies_revtype_chk',  sql: `ALTER TABLE companies ADD CONSTRAINT companies_revtype_chk  CHECK (rev_type IN ('none','active','complete'))` },
    { name: 'companies_updby_chk',    sql: `ALTER TABLE companies ADD CONSTRAINT companies_updby_chk    CHECK (updated_by IN ('CorpSec','Sales','Operations',''))` },
    { name: 'revchanges_dir_chk',     sql: `ALTER TABLE revision_changes ADD CONSTRAINT revchanges_dir_chk CHECK (direction IN ('from','to'))` },
    { name: 'ra_stage_chk',           sql: `ALTER TABLE ra_records ADD CONSTRAINT ra_stage_chk CHECK (reapply_stage IN (1,2))` },
  ];
  for (const c of checks) {
    try {
      await pool.query(`DO $$ BEGIN ${c.sql}; EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN NULL; END $$;`);
    } catch (e) {
      // Constraint exists or table missing — fine
    }
  }

  // Useful indexes on common filter columns
  try {
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_companies_section ON companies(section)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_companies_revtype ON companies(rev_type)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_ra_reapply_stage  ON ra_records(reapply_stage)`);
    // Composite index that backs the DISTINCT ON dedup in getCyclesFor.
    // Without this, the dedup query has to sort 16k+ rows in memory; with
    // it, Postgres can do an index-only scan and pick the first row per
    // (company_code, cycle_type) directly.
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_cycles_dedup ON cycles(company_code, cycle_type, sort_order)`);
    // Lookups in getCyclesFor's cycle_products step go via cycle_id =
    // ANY(...) — speed it with a btree on cycle_id.
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_cycle_products_cid ON cycle_products(cycle_id)`);
  } catch (e) { /* ignore */ }
})();

// ── Company Directory + companies.full_name column ──────────────
// Master list of company name → abbreviation. Loaded from company.xlsx
// via `npm run import-libraries`. The companies.full_name column is
// added if missing (older deployments) so existing data isn't lost.
(async () => {
  try {
    await pool.query(`
      ALTER TABLE companies
        ADD COLUMN IF NOT EXISTS full_name TEXT DEFAULT ''
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS company_directory (
        full_name     TEXT PRIMARY KEY,
        abbreviation  TEXT NOT NULL,
        sort_order    INT  DEFAULT 0,
        created_at    TIMESTAMPTZ DEFAULT NOW(),
        updated_at    TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_company_dir_abbr ON company_directory(abbreviation)`);
  } catch (e) {
    console.log('company_directory migration skipped:', e.message);
  }
})();

// ── Realizations table (PIB import declarations) ────────────────
// Created at boot so existing DBs pick up the new feature without
// having to re-run schema.sql. Idempotent.
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS realizations (
        id               SERIAL PRIMARY KEY,
        company_code     TEXT NOT NULL REFERENCES companies(code) ON DELETE CASCADE,
        product          TEXT,
        line_no          INT  DEFAULT 1,
        description      TEXT DEFAULT '',
        hs_code          TEXT DEFAULT '',
        volume           NUMERIC,
        unit             TEXT DEFAULT 'TNE',
        value_usd        NUMERIC,
        unit_price       NUMERIC,
        kurs             NUMERIC,
        country_origin   TEXT DEFAULT '',
        port_destination TEXT DEFAULT '',
        port_loading     TEXT DEFAULT '',
        ls_no            TEXT DEFAULT '',
        ls_date          TEXT DEFAULT '',
        pib_no           TEXT DEFAULT '',
        pib_date         TEXT DEFAULT '',
        invoice_no       TEXT DEFAULT '',
        invoice_date     TEXT DEFAULT '',
        pengajuan_no     TEXT DEFAULT '',
        pengajuan_date   TEXT DEFAULT '',
        source           TEXT DEFAULT 'manual',
        source_file      TEXT DEFAULT '',
        imported_by      TEXT DEFAULT '',
        created_at       TIMESTAMPTZ DEFAULT NOW(),
        updated_at       TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (company_code, pib_no, line_no)
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_realizations_co  ON realizations(company_code)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_realizations_pib ON realizations(pib_no)`);
  } catch (e) {
    console.log('realizations migration skipped:', e.message);
  }
})();

// ── Pipeline reconciliation against IQ Dash - Quota Data 240426.xlsx ──
// Two companies (AADC, KARA) had PERTEK Terbit issued but were still
// marked as PENDING in the DB — inflating the "New Submission" pipeline
// number by 9,000 MT and missing them from "SPI / PERTEK Obtained".
// Per the audit:
//   AADC: PERTEK 14/04/26, Obtained 150 MT (SPI still pending)
//   KARA: PERTEK 16/04/26, Obtained 100 MT (SPI still pending)
//
// This IIFE corrects the misclassification at boot. Idempotent — only
// fires if the wrong state still exists; safe across restarts and safe
// against manual edits (we check before writing).
const PIPELINE_CORRECTIONS = [
  {
    code: 'AADC',
    obtained:    150,
    submitMT:    3000,
    pertekDate:  '14/04/2026',
    pertekSerial: 46126,    // Excel date serial — for cycle pertek_date
  },
  {
    code: 'KARA',
    obtained:    100,
    submitMT:    6000,
    pertekDate:  '16/04/2026',
    pertekSerial: 46128,
  },
];
(async () => {
  for (const fix of PIPELINE_CORRECTIONS) {
    try {
      // Only fire if the company is still wrongly in PENDING with obtained=0
      const { rows } = await pool.query(
        `SELECT section, obtained::numeric AS obtained FROM companies WHERE code = $1`,
        [fix.code]
      );
      if (!rows.length) continue;
      const cur = rows[0];
      const wronglyPending = cur.section === 'PENDING' && Number(cur.obtained) === 0;
      if (!wronglyPending) continue;

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        // 1. Move to SPI section + set submit1/obtained from Excel
        //    (submit1 was previously null because the row was PENDING)
        await client.query(
          `UPDATE companies
             SET section = 'SPI',
                 submit1 = $1,
                 obtained = $2,
                 updated_at = NOW()
           WHERE code = $3`,
          [fix.submitMT, fix.obtained, fix.code]
        );
        // 2. Drop pending_meta — it's an SPI now
        await client.query(`DELETE FROM pending_meta WHERE company_code = $1`, [fix.code]);
        // 3. Insert Submit #1 + Obtained #1 cycles only if none exist (don't clobber)
        const { rowCount } = await client.query(
          `SELECT 1 FROM cycles WHERE company_code = $1 LIMIT 1`,
          [fix.code]
        );
        if (!rowCount) {
          await client.query(
            `INSERT INTO cycles
               (company_code, cycle_type, mt, submit_type, submit_date,
                release_type, release_date, status, sort_order, pertek_date, spi_date)
             VALUES
               ($1, 'Submit #1',   $2, 'Submit MOI', '', 'PERTEK', $3, '', 0, $3, ''),
               ($1, 'Obtained #1', $4, 'Submit MOT', '', 'SPI',    'TBA', '', 1, $3, 'TBA')`,
            [fix.code, fix.submitMT, fix.pertekDate, fix.obtained]
          );
        }
        await client.query('COMMIT');
        console.log(`✅ Pipeline correction: ${fix.code} → SPI section · ${fix.obtained} MT obtained · PERTEK ${fix.pertekDate}`);
      } catch (e) {
        await client.query('ROLLBACK');
        console.log(`⚠  Pipeline correction for ${fix.code} failed:`, e.message);
      } finally {
        client.release();
      }
    } catch (e) {
      console.log(`Pipeline correction skipped for ${fix.code}:`, e.message);
    }

    // Follow-up: backfill submit1 if a previous run of this migration
    // moved the company to SPI but didn't set submit1 (older version of
    // this code). Idempotent — only writes when submit1 IS NULL.
    try {
      const upd = await pool.query(
        `UPDATE companies
           SET submit1 = $1, updated_at = NOW()
         WHERE code = $2 AND submit1 IS NULL`,
        [fix.submitMT, fix.code]
      );
      if (upd.rowCount) {
        console.log(`✅ Backfilled submit1 for ${fix.code}: ${fix.submitMT} MT`);
      }
    } catch (e) {
      console.log(`submit1 backfill failed for ${fix.code}:`, e.message);
    }
  }
})();

// ── KPI total reconciliation against IQ Dash - Quota Data 240426.xlsx ──
// Per the Excel grand-total row (image shared 28-Apr-2026):
//   Total Submit (MT)      = 222,150
//   Total Obtained (MT)    =  23,090
//   Total Utilization (MT) =  15,181
//   Total Available (MT)   =   7,910
//
// The DB had three classes of drift from the Excel:
//   1. Stale Obtained #2 cycle MT values for 8 companies (they reflected
//      the SUBMIT amount instead of the actually-obtained amount, which
//      should be 0 or a smaller number for in-process cycles).
//   2. companies.utilization_mt off by small amounts on 8 rows.
//   3. companies.available_quota off by small amounts on 7 rows.
//
// All idempotent — UPDATEs only fire when current value ≠ target.
const KPI_RECONCILE = [
  { code:'AADC', util:0,      avail:150 },
  { code:'BBB',  obt2:0 },
  { code:'CGK',  util:800,    avail:220,   obt2:220 },
  { code:'EMS',  obt2:0 },
  { code:'GAS',  obt2:0 },
  { code:'GKL',  util:1694.5, avail:705.5, obt2:0 },
  { code:'GNG',  util:400,    obt2:150 },
  { code:'HDP',  util:900,    avail:0 },
  { code:'KARA', util:100,    avail:0 },
  { code:'KJK',  obt2:0 },
  { code:'MIN',  util:247,    avail:353 },
  { code:'SGD',  util:2000,   avail:0 },
  { code:'SPA',  util:114,    avail:401,   obt2:0 },
];
(async () => {
  for (const fix of KPI_RECONCILE) {
    try {
      // Update companies.utilization_mt only when current ≠ target
      if (fix.util !== undefined) {
        const r = await pool.query(
          `UPDATE companies
             SET utilization_mt = $1, updated_at = NOW()
           WHERE code = $2 AND COALESCE(utilization_mt,0) != $1`,
          [fix.util, fix.code]
        );
        if (r.rowCount) console.log(`✅ ${fix.code} utilization_mt → ${fix.util} MT`);
      }
      // Update companies.available_quota only when current ≠ target
      if (fix.avail !== undefined) {
        const r = await pool.query(
          `UPDATE companies
             SET available_quota = $1, updated_at = NOW()
           WHERE code = $2 AND COALESCE(available_quota,-1) != $1`,
          [fix.avail, fix.code]
        );
        if (r.rowCount) console.log(`✅ ${fix.code} available_quota → ${fix.avail} MT`);
      }
      // Update Obtained #2 cycle MT only when current ≠ target.
      // Multiple rows may exist (legacy duplicates) — we update them all
      // to the same canonical value so dedup-on-read still produces the
      // right total regardless of which copy wins.
      if (fix.obt2 !== undefined) {
        const r = await pool.query(
          `UPDATE cycles
             SET mt = $1::text
           WHERE company_code = $2
             AND cycle_type = 'Obtained #2'
             AND COALESCE(mt,'')::text != $1::text`,
          [String(fix.obt2), fix.code]
        );
        if (r.rowCount) console.log(`✅ ${fix.code} Obtained #2 mt → ${fix.obt2} (${r.rowCount} row${r.rowCount!==1?'s':''})`);
      }
    } catch (e) {
      console.log(`KPI reconcile skipped for ${fix.code}:`, e.message);
    }
  }
})();

app.get('/api/data', async (req, res) => {
  // Browser cache: 30s fresh + 60s stale-while-revalidate.
  //   - max-age=30   → no network for the first 30s after a fetch
  //   - swr=60       → next request after that returns the cached copy
  //                    immediately AND triggers a background refresh, so
  //                    rapid tab-switching never blocks on a 1-2s round trip
  //   - private       → only the user's browser caches (no shared CDN)
  // Writes are still protected against staleness by the per-company
  // updatedAt concurrency token (HTTP 409 on conflict), so a slightly
  // older read can't cause a clobber.
  res.set('Cache-Control', 'private, max-age=30, stale-while-revalidate=60');
  try {
    // Product master metadata (HS codes + colors). Always returned, even
    // when no companies exist yet, so the frontend can hydrate its
    // PRODUCT_META cache before rendering empty states.
    const [{ rows: productMeta }, { rows: aliasRows }, { rows: dirRows }] = await Promise.all([
      pool.query(
        `SELECT name, hs_code, color_solid, color_light, color_text, sort_order
         FROM products ORDER BY sort_order, name`
      ),
      pool.query(`SELECT alias, canonical FROM product_aliases`).catch(() => ({ rows: [] })),
      pool.query(
        `SELECT full_name, abbreviation, sort_order FROM company_directory ORDER BY sort_order, full_name`
      ).catch(() => ({ rows: [] })),
    ]);
    const productsList = productMeta.map(p => ({
      name:       p.name,
      hsCode:     p.hs_code     || '',
      colorSolid: p.color_solid || '#64748b',
      colorLight: p.color_light || '#f1f5f9',
      colorText:  p.color_text  || '#475569',
      sortOrder:  Number(p.sort_order) || 0,
    }));
    const aliasMap = {};
    aliasRows.forEach(a => { aliasMap[a.alias] = a.canonical; });
    const companyDirectory = dirRows.map(r => ({
      fullName:     r.full_name,
      abbreviation: r.abbreviation,
      sortOrder:    Number(r.sort_order) || 0,
    }));

    const { rows: companies } = await pool.query(
      `SELECT * FROM companies ORDER BY section, code`
    );
    const codes = companies.map(c => c.code);
    if (!codes.length) return res.json({ spi: [], pending: [], ra: [], products: productsList, productAliases: aliasMap, companyDirectory });

    // Run all child-table queries in parallel — including getCyclesFor()
    // (which itself does 2 sequential queries internally). Previously
    // cyclesMap was awaited AFTER the batch, costing one extra round-trip
    // per request. With Neon's per-query latency this saves ~100-200ms.
    const [
      { rows: products },
      { rows: stats },
      { rows: revChanges },
      { rows: pendMetas },
      { rows: raRows },
      { rows: shipRows },
      { rows: reapplyRows },
      cyclesMap,
    ] = await Promise.all([
      pool.query(`SELECT * FROM company_products WHERE company_code = ANY($1) ORDER BY company_code, sort_order`, [codes]),
      pool.query(`SELECT * FROM company_product_stats WHERE company_code = ANY($1)`, [codes]),
      pool.query(`SELECT * FROM revision_changes WHERE company_code = ANY($1) ORDER BY company_code, direction, sort_order`, [codes]),
      pool.query(`SELECT * FROM pending_meta WHERE company_code = ANY($1)`, [codes]),
      pool.query(`SELECT * FROM ra_records WHERE company_code = ANY($1) ORDER BY company_code`, [codes]),
      pool.query(`SELECT * FROM company_shipments WHERE company_code = ANY($1) ORDER BY company_code, product, lot_no`, [codes]),
      pool.query(`SELECT * FROM company_reapply_targets WHERE company_code = ANY($1)`, [codes]),
      getCyclesFor(codes),
    ]);

    // Group by code for fast lookup
    const byCode = (arr, key='company_code') => {
      const m = {};
      arr.forEach(r => { const k=r[key]; if(!m[k])m[k]=[]; m[k].push(r); });
      return m;
    };
    const prodMap    = byCode(products);
    const statsMap   = byCode(stats);
    const revMap     = byCode(revChanges);
    const pendMap    = {};
    pendMetas.forEach(p => pendMap[p.company_code] = p);
    const raMap      = byCode(raRows);
    const shipMap    = {}; // code → { product: [lot,...] }
    shipRows.forEach(s => {
      if (!shipMap[s.company_code]) shipMap[s.company_code] = {};
      if (!shipMap[s.company_code][s.product]) shipMap[s.company_code][s.product] = [];
      shipMap[s.company_code][s.product].push({
        lotNo:        s.lot_no,
        utilMT:       Number(s.util_mt)||0,
        etaJKT:       s.eta_jkt||'',
        note:         s.note||'',
        realMT:       Number(s.real_mt)||0,
        pibDate:      s.pib_date||'',
        cargoArrived: s.cargo_arrived||false,
      });
    });
    const reapplyMap = byCode(reapplyRows);

    const spi     = [];
    const pending = [];

    companies.forEach(co => {
      const obj = buildCompanyObj(
        co,
        prodMap[co.code],
        statsMap[co.code],
        revMap[co.code],
        revMap[co.code],
        cyclesMap[co.code],
        pendMap[co.code],
        shipMap[co.code] || {},
        reapplyRows.filter(r => r.company_code === co.code),
      );
      if (co.section === 'SPI')     spi.push(obj);
      else                          pending.push(obj);
    });

    // Build RA
    const ra = [];
    const processedCodes = new Set();
    raRows.forEach(r => {
      if (!processedCodes.has(r.company_code)) {
        processedCodes.add(r.company_code);
      }
      ra.push({
        code:                r.company_code,
        product:             r.product,
        berat:               Number(r.berat)||0,
        obtained:            Number(r.obtained)||0,
        cargoArrived:        r.cargo_arrived||false,
        realPct:             Number(r.real_pct)||0,
        utilPct:             r.util_pct!=null ? Number(r.util_pct) : null,
        arrivalDate:         r.arrival_date||null,
        etaJKT:              r.eta_jkt||null,
        reapplyEst:          r.reapply_est||'',
        reapplyStage:        Number(r.reapply_stage)||1,
        reapplyProduct:      r.reapply_product||null,
        reapplyNewTotal:     r.reapply_new_total!=null?Number(r.reapply_new_total):null,
        reapplyPrevObtained: r.reapply_prev_obtained!=null?Number(r.reapply_prev_obtained):null,
        reapplyAdditional:   r.reapply_additional!=null?Number(r.reapply_additional):null,
        reapplySubmitDate:   r.reapply_submit_date||null,
        reapplyStatus:       r.reapply_status||null,
        target:              r.target!=null?Number(r.target):null,
        pertek:              r.pertek||null,
        spi:                 r.spi||null,
        catatan:             r.catatan||null,
      });
    });

    res.json({ spi, pending, ra, products: productsList, productAliases: aliasMap, companyDirectory });
  } catch (err) {
    console.error('/api/data error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// PATCH /api/company/:code  — update editable fields
// ═══════════════════════════════════════════════════════════════════
app.patch('/api/company/:code', async (req, res) => {
  const { code } = req.params;
  const body = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── Optimistic concurrency check ──────────────────────────────────
    // Client sends `_ifUpdatedAt` (ISO timestamp from when they fetched).
    // If the row was modified server-side after that, reject with 409 so
    // the user can refresh and re-apply their edit, instead of silently
    // overwriting newer data from another user.
    if (body._ifUpdatedAt) {
      const { rows: curRows } = await client.query(
        `SELECT updated_at FROM companies WHERE code = $1`, [code]
      );
      if (curRows.length) {
        const dbTs    = curRows[0].updated_at ? new Date(curRows[0].updated_at).getTime() : 0;
        const clientTs = new Date(body._ifUpdatedAt).getTime();
        // 1-second tolerance for clock drift / sub-second rounding
        if (dbTs - clientTs > 1000) {
          await client.query('ROLLBACK');
          return res.status(409).json({
            error: 'Data telah diubah pengguna lain sejak Anda fetch — refresh untuk dapat data terbaru.',
            currentUpdatedAt: new Date(curRows[0].updated_at).toISOString(),
            yourUpdatedAt: body._ifUpdatedAt,
            code,
          });
        }
      }
    }

    // Build dynamic SET clause — only update fields present in body
    const allowed = [
      'submit1','obtained',
      'rev_type','rev_note','rev_submit_date','rev_status','rev_mt',
      'remarks','spi_ref','status_update','pertek_no','spi_no',
      'utilization_mt','available_quota','updated_by','updated_date',
    ];
    const sets = []; const vals = []; let idx = 1;
    for (const f of allowed) {
      // camelCase → snake_case mapping
      const camel = f.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
      if (body[camel] !== undefined) {
        sets.push(`${f} = $${idx++}`);
        vals.push(body[camel]);
      } else if (body[f] !== undefined) {
        sets.push(`${f} = $${idx++}`);
        vals.push(body[f]);
      }
    }
    sets.push(`updated_at = NOW()`);
    // Always bump updated_at — even if only child tables (shipments,
    // cycles, ra) were touched. This keeps the concurrency token fresh
    // so subsequent saves see the latest version.
    if (sets.length > 1) {
      vals.push(code);
      await client.query(
        `UPDATE companies SET ${sets.join(', ')} WHERE code = $${idx}`,
        vals
      );
    } else {
      // No allowed-field changes, but body may carry shipments/ra/etc.
      // Still bump updated_at so token advances.
      await client.query(`UPDATE companies SET updated_at = NOW() WHERE code = $1`, [code]);
    }

    // Handle shipments upsert
    if (body.shipments) {
      // body.shipments = { product: [{ lotNo, utilMT, etaJKT, note, realMT, pibDate, cargoArrived }] }
      for (const [product, lots] of Object.entries(body.shipments)) {
        // Delete removed lots
        const lotNos = lots.map(l => l.lotNo);
        if (lotNos.length) {
          await client.query(
            `DELETE FROM company_shipments WHERE company_code=$1 AND product=$2 AND lot_no != ALL($3)`,
            [code, product, lotNos]
          );
        } else {
          await client.query(
            `DELETE FROM company_shipments WHERE company_code=$1 AND product=$2`,
            [code, product]
          );
        }
        for (const lot of lots) {
          await client.query(
            `INSERT INTO company_shipments
               (company_code, product, lot_no, util_mt, eta_jkt, note, real_mt, pib_date, cargo_arrived, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
             ON CONFLICT (company_code, product, lot_no) DO UPDATE SET
               util_mt=EXCLUDED.util_mt, eta_jkt=EXCLUDED.eta_jkt, note=EXCLUDED.note,
               real_mt=EXCLUDED.real_mt, pib_date=EXCLUDED.pib_date,
               cargo_arrived=EXCLUDED.cargo_arrived, updated_at=NOW()`,
            [code, product, lot.lotNo, lot.utilMT||0, lot.etaJKT||'',
             lot.note||'', lot.realMT||0, lot.pibDate||'', lot.cargoArrived||false]
          );
        }
      }
    }

    // Handle reapply targets
    if (body.reapplyTargets) {
      for (const t of body.reapplyTargets) {
        await client.query(
          `INSERT INTO company_reapply_targets
             (company_code, product, target_mt, submitted, submit_date, notes)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (company_code, product) DO UPDATE SET
             target_mt=EXCLUDED.target_mt, submitted=EXCLUDED.submitted,
             submit_date=EXCLUDED.submit_date, notes=EXCLUDED.notes`,
          [code, t.product, t.targetMT||null, t.submitted||false, t.submitDate||'', t.notes||'']
        );
      }
    }

    // Handle RA record update
    if (body.ra) {
      const r = body.ra;
      await client.query(
        `UPDATE ra_records SET
           berat=$1, obtained=$2, cargo_arrived=$3, real_pct=$4, util_pct=$5,
           arrival_date=$6, eta_jkt=$7, reapply_est=$8, reapply_stage=$9,
           reapply_submit_date=$10, reapply_status=$11, target=$12,
           pertek=$13, spi=$14, catatan=$15, updated_at=NOW()
         WHERE company_code=$16`,
        [r.berat, r.obtained, r.cargoArrived, r.realPct, r.utilPct??null,
         r.arrivalDate||null, r.etaJKT||null, r.reapplyEst||null, r.reapplyStage||1,
         r.reapplySubmitDate||null, r.reapplyStatus||null, r.target??null,
         r.pertek||null, r.spi||null, r.catatan||null, code]
      );
    }

    await client.query('COMMIT');
    // Return the new updated_at so client can refresh its concurrency token
    // without needing a full re-fetch.
    const { rows: tsRow } = await pool.query(
      `SELECT updated_at FROM companies WHERE code = $1`, [code]
    );
    const newTs = tsRow[0] && tsRow[0].updated_at
      ? new Date(tsRow[0].updated_at).toISOString()
      : null;
    res.json({ ok: true, code, updatedAt: newTs });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('PATCH /api/company/:code error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ═══════════════════════════════════════════════════════════════════
// GET /api/company/:code  — single company detail
// ═══════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════
// PATCH /api/company/:code/cycles  — replace all cycles for a company
// Called by frontend after any cycle mutation (revision, obtained #2, etc.)
// ═══════════════════════════════════════════════════════════════════
app.patch('/api/company/:code/cycles', async (req, res) => {
  const { code } = req.params;
  const { cycles } = req.body;
  if (!Array.isArray(cycles)) return res.status(400).json({ error: 'cycles must be array' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Delete all existing cycles for this company, then re-insert
    await client.query('DELETE FROM cycles WHERE company_code = $1', [code]);

    for (let i = 0; i < cycles.length; i++) {
      const c = cycles[i];
      const { rows } = await client.query(
        `INSERT INTO cycles
           (company_code, cycle_type, mt, submit_type, submit_date,
            release_type, release_date, status, sort_order,
            pertek_date, spi_date, from_rev_req)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING id`,
        [code, c.type || '', c.mt || null,
         c.submitType || '', c.submitDate || '',
         c.releaseType || '', c.releaseDate || '',
         c.status || '', i,
         c.pertekDate || '', c.spiDate || '',
         c._fromRevReq || false]
      );
      const cycleId = rows[0].id;

      // Insert cycle_products
      if (c.products && typeof c.products === 'object') {
        for (const [product, mt] of Object.entries(c.products)) {
          await client.query(
            `INSERT INTO cycle_products (cycle_id, product, mt) VALUES ($1,$2,$3)`,
            [cycleId, product, mt || null]
          );
        }
      }
    }

    await client.query('COMMIT');
    res.json({ ok: true, cycles: cycles.length });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('/api/company/:code/cycles PATCH error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.get('/api/company/:code', async (req, res) => {
  const { code } = req.params;
  try {
    const { rows } = await pool.query(`SELECT * FROM companies WHERE code=$1`, [code]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const co = rows[0];
    const [
      { rows: products },
      { rows: stats },
      { rows: revChanges },
      { rows: pendMetas },
      { rows: shipRows },
      { rows: reapplyRows },
    ] = await Promise.all([
      pool.query(`SELECT * FROM company_products WHERE company_code=$1 ORDER BY sort_order`, [code]),
      pool.query(`SELECT * FROM company_product_stats WHERE company_code=$1`, [code]),
      pool.query(`SELECT * FROM revision_changes WHERE company_code=$1 ORDER BY direction, sort_order`, [code]),
      pool.query(`SELECT * FROM pending_meta WHERE company_code=$1`, [code]),
      pool.query(`SELECT * FROM company_shipments WHERE company_code=$1 ORDER BY product, lot_no`, [code]),
      pool.query(`SELECT * FROM company_reapply_targets WHERE company_code=$1`, [code]),
    ]);
    const cyclesMap = await getCyclesFor([code]);
    const shipMap = {};
    shipRows.forEach(s => {
      if (!shipMap[s.product]) shipMap[s.product] = [];
      shipMap[s.product].push({lotNo:s.lot_no, utilMT:Number(s.util_mt)||0, etaJKT:s.eta_jkt||'', note:s.note||'', realMT:Number(s.real_mt)||0, pibDate:s.pib_date||'', cargoArrived:s.cargo_arrived||false});
    });
    const obj = buildCompanyObj(co, products, stats, revChanges, revChanges, cyclesMap[code], pendMetas[0], shipMap, reapplyRows);
    res.json(obj);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// GET /api/ra  — all RA records
// ═══════════════════════════════════════════════════════════════════
app.get('/api/ra', async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM ra_records ORDER BY company_code`);
    res.json(rows.map(r => ({
      code: r.company_code, product: r.product,
      berat: Number(r.berat)||0, obtained: Number(r.obtained)||0,
      cargoArrived: r.cargo_arrived, realPct: Number(r.real_pct)||0,
      utilPct: r.util_pct!=null?Number(r.util_pct):null,
      arrivalDate: r.arrival_date||null, etaJKT: r.eta_jkt||null,
      reapplyEst: r.reapply_est||'', reapplyStage: r.reapply_stage||1,
      reapplyProduct: r.reapply_product||null,
      target: r.target!=null?Number(r.target):null,
      pertek: r.pertek||null, spi: r.spi||null, catatan: r.catatan||null,
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/import  — trigger re-seed from code (dev/admin use) ──
app.post('/api/import', async (req, res) => {
  try {
    // Dynamic require so seed can be run independently
    delete require.cache[require.resolve('./seed.js')];
    // seed.js calls pool.end() which would crash the server, so we
    // instead expose the seed function inline — we just call it via shell
    res.json({ message: 'Run `node seed.js` on the server to re-seed data.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// REALIZATIONS — PIB import customs declarations
// Two import methods supported:
//   1. POST /api/realizations              — bulk insert (Excel upload OR manual)
//   2. POST /api/realizations/single       — one row at a time (manual form)
// Both routes accept JSON; the frontend parses xlsx in-browser via SheetJS
// and sends parsed rows as JSON, so server doesn't need an xlsx dependency.
// ═══════════════════════════════════════════════════════════════════

// Coerce a value-or-empty into a Number, returning null for blanks
const _num = v => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
};

// Single insert builder used by both bulk + single routes
async function insertRealization(client, code, row, defaults) {
  return client.query(
    `INSERT INTO realizations
       (company_code, product, line_no, description, hs_code, volume, unit,
        value_usd, unit_price, kurs, country_origin, port_destination, port_loading,
        ls_no, ls_date, pib_no, pib_date, invoice_no, invoice_date,
        pengajuan_no, pengajuan_date, source, source_file, imported_by, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,NOW())
     ON CONFLICT (company_code, pib_no, line_no) DO UPDATE SET
       product=EXCLUDED.product, description=EXCLUDED.description, hs_code=EXCLUDED.hs_code,
       volume=EXCLUDED.volume, unit=EXCLUDED.unit, value_usd=EXCLUDED.value_usd,
       unit_price=EXCLUDED.unit_price, kurs=EXCLUDED.kurs,
       country_origin=EXCLUDED.country_origin, port_destination=EXCLUDED.port_destination,
       port_loading=EXCLUDED.port_loading, ls_no=EXCLUDED.ls_no, ls_date=EXCLUDED.ls_date,
       pib_date=EXCLUDED.pib_date, invoice_no=EXCLUDED.invoice_no, invoice_date=EXCLUDED.invoice_date,
       pengajuan_no=EXCLUDED.pengajuan_no, pengajuan_date=EXCLUDED.pengajuan_date,
       source=EXCLUDED.source, source_file=EXCLUDED.source_file,
       imported_by=EXCLUDED.imported_by, updated_at=NOW()
     RETURNING id`,
    [
      code,
      row.product || null,
      _num(row.lineNo) ?? 1,
      row.description || '',
      row.hsCode || '',
      _num(row.volume),
      row.unit || 'TNE',
      _num(row.valueUSD),
      _num(row.unitPrice),
      _num(row.kurs),
      row.countryOrigin || '',
      row.portDestination || '',
      row.portLoading || '',
      row.lsNo || '',
      row.lsDate || '',
      row.pibNo || '',
      row.pibDate || '',
      row.invoiceNo || '',
      row.invoiceDate || '',
      row.pengajuanNo || '',
      row.pengajuanDate || '',
      defaults.source || row.source || 'manual',
      defaults.sourceFile || row.sourceFile || '',
      defaults.importedBy || row.importedBy || '',
    ]
  );
}

// GET /api/realizations?company_code=CODE  — list realizations (optionally filtered)
app.get('/api/realizations', async (req, res) => {
  const { company_code } = req.query;
  try {
    const sql = company_code
      ? `SELECT * FROM realizations WHERE company_code = $1 ORDER BY pib_date DESC, pib_no, line_no`
      : `SELECT * FROM realizations ORDER BY pib_date DESC, company_code, pib_no, line_no`;
    const args = company_code ? [company_code] : [];
    const { rows } = await pool.query(sql, args);
    res.json({ realizations: rows });
  } catch (err) {
    console.error('GET /api/realizations error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/realizations  — bulk insert (Excel upload result, or any batch)
// Body: { companyCode, source: 'excel'|'manual', sourceFile, importedBy, rows: [...] }
app.post('/api/realizations', async (req, res) => {
  const { companyCode, source, sourceFile, importedBy, rows } = req.body || {};
  if (!companyCode || !Array.isArray(rows) || !rows.length) {
    return res.status(400).json({ error: 'companyCode and non-empty rows array are required' });
  }

  const client = await pool.connect();
  try {
    // Confirm company exists — return clean 404 instead of FK violation
    const { rowCount } = await client.query(`SELECT 1 FROM companies WHERE code = $1`, [companyCode]);
    if (!rowCount) return res.status(404).json({ error: `Unknown company code: ${companyCode}` });

    await client.query('BEGIN');
    const ids = [];
    const defaults = { source: source || 'excel', sourceFile: sourceFile || '', importedBy: importedBy || '' };
    for (const row of rows) {
      const r = await insertRealization(client, companyCode, row, defaults);
      ids.push(r.rows[0].id);
    }
    await client.query('COMMIT');
    res.json({ ok: true, inserted: ids.length, ids });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('POST /api/realizations error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// POST /api/realizations/single  — single manual entry
app.post('/api/realizations/single', async (req, res) => {
  const { companyCode, importedBy, ...row } = req.body || {};
  if (!companyCode) return res.status(400).json({ error: 'companyCode is required' });
  const client = await pool.connect();
  try {
    const { rowCount } = await client.query(`SELECT 1 FROM companies WHERE code = $1`, [companyCode]);
    if (!rowCount) return res.status(404).json({ error: `Unknown company code: ${companyCode}` });

    const r = await insertRealization(client, companyCode, row, {
      source: 'manual', sourceFile: '', importedBy: importedBy || '',
    });
    res.json({ ok: true, id: r.rows[0].id });
  } catch (err) {
    console.error('POST /api/realizations/single error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// DELETE /api/realizations/:id  — remove a row
app.delete('/api/realizations/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid id' });
  try {
    const { rowCount } = await pool.query(`DELETE FROM realizations WHERE id = $1`, [id]);
    if (!rowCount) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/realizations/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Health check ────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date() }));

// ── Fallback SPA ─────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start ────────────────────────────────────────────────────────
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 IQ Dash running on http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});