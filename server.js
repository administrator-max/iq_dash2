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
const cache       = require('./lib/cache');

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
  // Pool tuning (board-approved 2026):
  //   max — small dyno = small pool; oversizing causes "too many clients"
  //         errors against Neon's free-tier 100-connection ceiling.
  //   idleTimeoutMillis — return idle clients to free Neon compute faster
  //   connectionTimeoutMillis — fail fast if pool is exhausted (better than
  //         hanging forever; user gets a clear error and can retry)
  //   maxUses — recycle each client after 7500 queries to prevent slow
  //         backend memory leak common in long-lived PG connections
  //   keepAlive — keep TCP socket alive so the pooler doesn't time out
  //         this connection during quiet periods (matters for serverless)
  max:                     Number(process.env.PG_POOL_MAX) || 10,
  idleTimeoutMillis:       30_000,
  connectionTimeoutMillis: 8_000,
  maxUses:                 7_500,
  keepAlive:               true,
});

// Surface pool errors instead of crashing the process. A single bad
// client (e.g. Neon revoked the conn during scale-to-zero) shouldn't
// take down the whole server.
pool.on('error', err => console.error('[pg pool] idle client error:', err.message));

// ── Data source dispatch ─────────────────────────────────────────────
// DATA_SOURCE=sheets routes all reads/writes through the Google Sheets
// backing store (lib/sheetsStore.js) instead of Neon PostgreSQL. The Neon
// path is the default and remains fully intact as a fallback.
// A single dyno can serve BOTH production (Neon) and a staging subdomain
// (Google Sheets) with NO extra dyno. The data source is chosen PER REQUEST
// from the hostname:
//   host starts with STAGING_HOST_PREFIX (default "staging.") → STAGING_DATA_SOURCE
//   otherwise                                                 → DATA_SOURCE
// Env on the single Heroku app:
//   DATA_SOURCE=neon · STAGING_DATA_SOURCE=sheets · STAGING_HOST_PREFIX=staging.
//   STAGING_HOSTS=host1,host2  (optional exact hostnames instead of a prefix)
const { AsyncLocalStorage } = require('async_hooks');
// Default data source is Google Sheets — Neon has been fully detached. Set
// DATA_SOURCE=neon explicitly only if you ever need the legacy Postgres path.
const DATA_SOURCE         = (process.env.DATA_SOURCE || 'sheets').toLowerCase();
const STAGING_ENABLED     = !!(process.env.STAGING_HOST_PREFIX || process.env.STAGING_HOSTS || process.env.STAGING_DATA_SOURCE);
const STAGING_DATA_SOURCE = (process.env.STAGING_DATA_SOURCE || 'sheets').toLowerCase();
const STAGING_HOST_PREFIX = (process.env.STAGING_HOST_PREFIX || 'staging.').toLowerCase();
const STAGING_HOSTS       = (process.env.STAGING_HOSTS || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);

const store    = require('./lib/sheetsStore');
const insights = require('./lib/insights');
// Quota ledger (single source of truth for Obtained/Utilized/Available, keyed by
// HS, seeded from the authoritative master). See migration_work/ARCHITECTURE_LEDGER.md.
let QUOTA_LEDGER = null;
try { QUOTA_LEDGER = require('./lib/quotaLedger.json'); } catch (e) { console.warn('quotaLedger.json not loaded:', e.message); }
const { applyPendingRevision } = require('./lib/pendingRevisionGate');
let PENDING_REVISIONS = {};
try { PENDING_REVISIONS = require('./lib/pendingRevisions.json'); } catch (_) { PENDING_REVISIONS = {}; }

// Boot-time aggregate flags: which backends might be touched by SOME request.
const BOOT_DEFAULT_SHEETS = DATA_SOURCE === 'sheets';
const ANY_SHEETS = DATA_SOURCE === 'sheets' || (STAGING_ENABLED && STAGING_DATA_SOURCE === 'sheets');
const ANY_NEON   = DATA_SOURCE !== 'sheets' || (STAGING_ENABLED && STAGING_DATA_SOURCE !== 'sheets');

const _srcCtx = new AsyncLocalStorage();
function hostUsesSheets(req) {
  if (!STAGING_ENABLED) return DATA_SOURCE === 'sheets';
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || req.hostname || '')
    .toLowerCase().split(',')[0].trim().split(':')[0];
  const isStaging = STAGING_HOSTS.length
    ? STAGING_HOSTS.includes(host)
    : (STAGING_HOST_PREFIX && host.startsWith(STAGING_HOST_PREFIX));
  return (isStaging ? STAGING_DATA_SOURCE : DATA_SOURCE) === 'sheets';
}
// Per-request source flag (set by middleware); falls back to process default
// for non-request contexts (boot reconciles, prewarm).
function inSheets() { const c = _srcCtx.getStore(); return c ? c.sheets : BOOT_DEFAULT_SHEETS; }

console.log(`[data] default=${DATA_SOURCE}` + (STAGING_ENABLED ? ` · staging "${STAGING_HOST_PREFIX}*"=${STAGING_DATA_SOURCE}` : '') + ` (sheet ${store.SHEET_ID})`);

// Neon fully detached when no request path uses it: stub the pool so the
// boot reconcile IIFEs and any stray query can NEVER open a Postgres
// connection. The legacy Neon code stays in place but is inert.
if (!ANY_NEON) {
  pool.query   = async () => ({ rows: [], rowCount: 0 });
  pool.connect = async () => { throw new Error('Neon disabled (DATA_SOURCE=sheets)'); };
  console.log('[data] Neon detached — Postgres pool is inert');
}

// Load the raw row-arrays the analytics engine needs, from whichever source
// is active. Shapes are normalised so lib/insights stays source-agnostic.
async function loadAnalyticsTables() {
  if (inSheets()) {
    const [companies, cycles, cycleProducts, stats, revisions, lots, realizations, aliases, products] = await Promise.all([
      store.table('companies'), store.table('cycles'), store.table('cycle_products'),
      store.table('company_product_stats'), store.table('revision_changes'),
      store.table('utilization_lots'), store.table('realizations'),
      store.table('product_aliases'), store.table('products'),
    ]);
    return { companies, cycles, cycleProducts, stats, revisions, lots, realizations, aliases, products };
  }
  const q = s => pool.query(s).then(r => r.rows);
  const [companies, cycles, cycleProducts, stats, revisions, ship, realizations, aliases, products] = await Promise.all([
    q('SELECT * FROM companies'), q('SELECT * FROM cycles'), q('SELECT * FROM cycle_products'),
    q('SELECT * FROM company_product_stats'), q('SELECT * FROM revision_changes'),
    q('SELECT company_code, product, util_mt, pib_date FROM company_shipments'),
    q('SELECT * FROM realizations'), q('SELECT alias, canonical FROM product_aliases').catch(() => []),
    q('SELECT * FROM products'),
  ]);
  const lots = ship.map(s => ({ company_code: s.company_code, product: s.product, util_mt: s.util_mt, util_date: s.pib_date }));
  return { companies, cycles, cycleProducts, stats, revisions, lots, realizations, aliases, products };
}

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

// Per-request data-source context: pick Neon vs Sheets from the hostname
// (subdomain-based staging on a single dyno) and expose it to all handlers
// via inSheets(). Must run before any route so the whole async chain sees it.
app.use((req, res, next) => {
  const sheets = hostUsesSheets(req);
  res.set('X-Data-Source', sheets ? 'sheets' : 'neon');

  // ── Traffic / access logging ──────────────────────────────────────
  // Console line for EVERY request (visible in heroku logs / any drain),
  // plus a permanent Access_Log Sheet row for WRITES (best-effort, so it
  // never blocks or fails a save). Identity = client IP + the role/actor
  // the client supplied (the app has no login, so that's the best signal).
  const t0 = Date.now();
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || (req.socket && req.socket.remoteAddress) || '';
  res.on('finish', () => {
    if (req.path === '/healthz' || req.path === '/health') return;
    const actor = (req.body && (req.body.updatedBy || req.body.importedBy)) || req.query.role || '';
    const ms = Date.now() - t0;
    console.log(`[req] ${ip} ${req.method} ${req.path} ${res.statusCode} ${ms}ms${actor ? ' actor=' + actor : ''}`);
    if (sheets && req.path.startsWith('/api/') && ['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) {
      store.logAccess({ ip, actor, method: req.method, path: req.path, status: res.statusCode, ms }).catch(() => {});
    }
  });

  _srcCtx.run({ sheets }, next);
});

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
// Sheets-backed equivalent of getCyclesFor: same dedup ("first occurrence
// wins" per company_code+cycle_type, smallest sort_order) + cycle_products join.
async function getCyclesForSheets(codes) {
  if (!codes.length) return {};
  const codeSet = new Set(codes);
  const all = (await store.table('cycles')).filter(c => codeSet.has(c.company_code));
  const seen = new Map();
  all.slice()
     .sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0))
     .forEach(c => { const k = c.company_code + '|' + c.cycle_type; if (!seen.has(k)) seen.set(k, c); });
  const cRows = [...seen.values()].sort((a, b) =>
    a.company_code !== b.company_code
      ? (a.company_code < b.company_code ? -1 : 1)
      : (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0));
  const idSet = new Set(cRows.map(r => String(r.id)));
  const cpMap = {};
  (await store.table('cycle_products')).forEach(r => {
    if (!idSet.has(String(r.cycle_id))) return;
    if (!cpMap[r.cycle_id]) cpMap[r.cycle_id] = {};
    cpMap[r.cycle_id][r.product] = isNaN(r.mt) ? r.mt : Number(r.mt);
  });
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
      pertekDate:  c.pertek_date || '',
      spiDate:     c.spi_date    || '',
      _fromRevReq: c.from_rev_req || false,
    });
  });
  return byCode;
}

async function getCyclesFor(codes) {
  if (inSheets()) return getCyclesForSheets(codes);
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
// β-2  LOT-DRIVEN UTILIZATION
// ═══════════════════════════════════════════════════════════════════
/** Recompute utilization from shipment lots for ONE company, in-transaction.
 *  This makes the Sales "Simpan" path actually drive the dashboard's
 *  utilization (reverses the β-1 "util is XLSX-only, never client-writable"
 *  rule — but only for companies that HAVE shipment lots).
 *
 *  Per product:
 *    utilization_mt = Σ company_shipments.util_mt
 *    available_mt   = max(0, OBTAINED − utilization), where per-product
 *                     OBTAINED is PRESERVED from the existing stats row
 *                     (β-1 invariant obtained = util + avail). So the
 *                     dashboard's per-product "Obtained" never jumps; only the
 *                     util/avail split follows the lots. A product with lots
 *                     but no prior stats row falls back to obtained = Σlots.
 *  Products WITHOUT lots are left untouched (stay XLSX/KPI_RECONCILE-driven).
 *  Company level: utilization_mt = Σ stats.util; available_quota =
 *                 max(0, companies.obtained − util).
 *  Idempotent — Σlots is stable, so re-running yields the same result.
 */
async function recomputeUtilizationFromLots(client, code) {
  const { rows: lotSums } = await client.query(
    `SELECT product, COALESCE(SUM(util_mt),0)::numeric AS util
       FROM company_shipments WHERE company_code = $1 GROUP BY product`, [code]);
  if (!lotSums.length) return; // no lots → leave XLSX-reconciled values intact

  const { rows: statRows } = await client.query(
    `SELECT product, utilization_mt, available_mt
       FROM company_product_stats WHERE company_code = $1`, [code]);
  const statBy = {};
  statRows.forEach(s => { statBy[s.product] = {
    util:  Number(s.utilization_mt) || 0,
    avail: s.available_mt != null ? Number(s.available_mt) : 0,
  }; });

  for (const r of lotSums) {
    const newUtil  = Number(r.util) || 0;
    // A lot-set carrying no utilization (e.g. a realization-only lot with
    // util_mt=0) gives no utilization signal — never let it CLEAR the
    // authoritative company_product_stats.utilization. Only (re)compute util
    // when the lots actually carry it. (Fixes the 2026-06-12 util-zeroing bug.)
    if (newUtil <= 0) continue;
    const prev     = statBy[r.product];
    const obtained = prev ? (prev.util + prev.avail) : newUtil; // preserve obtained
    const newAvail = Math.max(0, obtained - newUtil);
    await client.query(
      `INSERT INTO company_product_stats (company_code, product, utilization_mt, available_mt)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (company_code, product) DO UPDATE SET
         utilization_mt = EXCLUDED.utilization_mt,
         available_mt   = EXCLUDED.available_mt`,
      [code, r.product, newUtil, newAvail]);
  }

  const { rows: tot } = await client.query(
    `SELECT COALESCE(SUM(utilization_mt),0)::numeric AS util
       FROM company_product_stats WHERE company_code = $1`, [code]);
  const coUtil = Number(tot[0].util) || 0;
  const { rows: coRow } = await client.query(
    `SELECT obtained FROM companies WHERE code = $1`, [code]);
  const coObt   = coRow[0] && coRow[0].obtained != null ? Number(coRow[0].obtained) : coUtil;
  const coAvail = Math.max(0, coObt - coUtil);
  await client.query(
    `UPDATE companies SET utilization_mt = $1, available_quota = $2, updated_at = NOW()
       WHERE code = $3`, [coUtil, coAvail, code]);
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

// ── KPI total reconciliation against IQ Dash - Quota Data 120526.xlsx ──
// Per the Excel grand-total row (master shared 20-May-2026):
//   Total Submit (MT)      = 252,000 (incl LCP Submit #2 added 20-May)
//   Total Obtained (MT)    =  23,590
//   Total Utilization (MT) =  17,806   (master 16,350.5 + lots-based overrides:
//                                        BTS +200, GIS +400, GKL +705.5, SMS +150)
//   Total Available (MT)   =   5,784   (master 7,239.5 − 1,455.5 of overrides)
//
// MANUAL OVERRIDES (beyond the 12-May master) — over-entered companies treated as
// fully utilized per their shipment lots (operator allocations meet/exceed master
// util), so per-product available = 0:
//   BTS Seamless 1000/0 · GKL ERW≤140 800/0 + ERW>140 500/0.
// 2026-05-29 REVERSAL: GIS Sheetpile & SMS Sheetpile flipped back to AVAILABLE
//   (GIS 0/400, SMS 0/150) — lots freed (not shipped). Their sheetpile shipment
//   lots were deleted so β-2 lot-driven won't re-utilize them.
// ⚠ Re-running importMasterStats.js with the 12-May master reverts these to the
// master split — update the master file to keep them. company_product_stats for
// these (company,product) pairs were set to util=Σlots / avail=0.
//
// Idempotent — UPDATEs only fire when current value ≠ target. Acts as a
// drift guard: if anyone edits via UI to an inconsistent value, this
// resets on next server restart.
const KPI_RECONCILE = [
  { code:'AADC', util:150,    avail:0 },
  { code:'ADP',  util:250,    avail:0 },
  { code:'AMP',  util:800,    avail:0 },
  { code:'BBB',  util:400,    avail:0,     obt2:0 },
  { code:'BDG',  util:650,    avail:350 },
  { code:'BHG',  util:200,    avail:0 },
  { code:'BTS',  util:1620,   avail:4380 },
  { code:'CGK',  util:1020,   avail:0,     obt2:220 },
  { code:'DIOR', util:0,      avail:100 },
  { code:'EMS',  util:2100,   avail:0,     obt2:500 },
  { code:'GAS',  util:200,    avail:0,     obt2:0 },
  { code:'GIS',  util:0,      avail:400 },
  { code:'GKL',  util:2400,   avail:0,     obt2:0 },
  { code:'GNG',  util:400,    avail:0,     obt2:150 },
  { code:'HDP',  util:900,    avail:0 },
  { code:'HKG',  util:750,    avail:0 },
  { code:'JKT',  util:300,    avail:0 },
  { code:'KAN',  util:80,     avail:0 },
  { code:'KARA', util:100,    avail:0 },
  { code:'KJK',  util:950,    avail:450,   obt2:450 }, // re-apply Obtained #2 GL Boron 450, PERTEK Perubahan terbit 04/06/2026
  { code:'PPGL', util:0,      avail:50 },              // new apply Obtained #1 GL Boron 50, PERTEK terbit 30/05/2026 (moved PENDING→SPI)
  { code:'LCP',  util:275,    avail:0 },
  { code:'LSJ',  util:500,    avail:0 },
  { code:'MIN',  util:247,    avail:353 },
  { code:'MJU',  util:0,      avail:200 },
  { code:'MSN',  util:150,    avail:0 },
  { code:'NCT',  util:150,    avail:0 },
  { code:'SGD',  util:2000,   avail:0 },
  { code:'SJH',  util:300,    avail:0 },
  { code:'SMS',  util:0,      avail:150 },
  { code:'SPA',  util:114,    avail:401,   obt2:0 },
  { code:'SPP',  util:250,    avail:0 },
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

  // ── β-2 LOT-DRIVEN override (runs AFTER KPI_RECONCILE so lots win) ──────
  // For every company that has shipment lots, recompute util/avail from
  // Σlots so the boot state matches what the Sales "Simpan" path persists.
  // Companies WITHOUT lots keep the XLSX/KPI_RECONCILE values set above.
  // Idempotent. ⚠ This means lots — not the 12-May master split — are now the
  // source of truth for any company with lots (see DESIGN/​memory).
  try {
    const { rows: lotCos } = await pool.query(
      `SELECT DISTINCT company_code FROM company_shipments`);
    if (lotCos.length) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const { company_code } of lotCos) {
          await recomputeUtilizationFromLots(client, company_code);
        }
        await client.query('COMMIT');
        console.log(`✅ Lot-driven utilization reconciled for ${lotCos.length} companies`);
      } catch (e) {
        await client.query('ROLLBACK');
        console.log('lot-driven reconcile failed:', e.message);
      } finally {
        client.release();
      }
    }
  } catch (e) {
    console.log('lot-driven reconcile skipped:', e.message);
  }
})();

// ── Server-side cache for GET endpoints (board-approved 2026) ───
// Two-tier cache (in-memory L1 + Redis L2, see lib/cache.js):
//   - L1 (per-process Map, 30s TTL) absorbs same-instance request bursts
//     in <5ms with no network hop.
//   - L2 (Redis, 60s TTL) survives restarts and is shared between every
//     dyno, so multi-instance deploys don't each pay the ~500ms-2s
//     payload build cost independently.
//   - Singleflight de-dup prevents stampedes when several concurrent
//     requests arrive during a cold cache.
//   - PATCH endpoints call dcache.invalidate() which clears both tiers
//     AND publishes on iq_dash:invalidate so other instances flush their
//     L1 — writes become visible immediately on next read everywhere.
// If REDIS_URL is unset, cache.js silently degrades to pure in-memory
// (same behavior as the old _dataCache).
const CACHE_KEY_DATA               = 'iq:data:v1';
const CACHE_KEY_REALIZATIONS_SUM   = 'iq:realizations:summary:v1';
const CACHE_KEY_REALIZATIONS_PFX   = 'iq:realizations:list:v1:';
const CACHE_KEY_RA_ALL             = 'iq:ra:v1';
const CACHE_TTL_DATA_SEC           = 60;
const CACHE_TTL_REALIZATIONS_SEC   = 60;
const CACHE_TTL_RA_SEC             = 60;

// Source-namespaced cache. When staging routing is on, prod (Neon) and the
// staging subdomain (Sheets) serve different data through the SAME process,
// so their cache entries MUST be separated by source or one would serve the
// other's payload. No suffix when staging is disabled (backward compatible).
const _rawCache = cache;
// Namespace is a PREFIX so prefix-based invalidation (realization list) still
// matches the per-company keys built as PFX + code.
const _ns = () => STAGING_ENABLED ? (inSheets() ? 's::' : 'n::') : '';
const dcache = {
  getOrBuild:       (k, ttl, fn) => _rawCache.getOrBuild(_ns() + k, ttl, fn),
  invalidate:       (k)          => _rawCache.invalidate(_ns() + k),
  invalidatePrefix: (k)          => _rawCache.invalidatePrefix(_ns() + k),
};

// Kick off Redis connection in the background — server keeps booting
// even if Redis is slow/unreachable. Reads return false → in-memory
// path is used until connection succeeds.
cache.initRedis().catch(e => console.warn('[cache] init error:', e.message));

async function _buildDataPayload() {
  // Product master metadata (HS codes + colors). Always returned, even
  // when no companies exist yet, so the frontend can hydrate its
  // PRODUCT_META cache before rendering empty states.
  const numSort = (arr, key) => arr.slice().sort((a, b) => (Number(a[key]) || 0) - (Number(b[key]) || 0));
  let productMeta, aliasRows, dirRows, companies;
  if (inSheets()) {
    [productMeta, aliasRows, dirRows] = await Promise.all([
      store.table('products'), store.table('product_aliases'), store.table('company_directory'),
    ]);
    productMeta = numSort(productMeta, 'sort_order');
    dirRows     = numSort(dirRows, 'sort_order');
    companies   = (await store.table('companies')).slice().sort((a, b) =>
      a.section !== b.section ? (String(a.section) < String(b.section) ? -1 : 1)
                              : (String(a.code) < String(b.code) ? -1 : 1));
  } else {
    [{ rows: productMeta }, { rows: aliasRows }, { rows: dirRows }] = await Promise.all([
      pool.query(
        `SELECT name, hs_code, color_solid, color_light, color_text, sort_order
         FROM products ORDER BY sort_order, name`
      ),
      pool.query(`SELECT alias, canonical FROM product_aliases`).catch(() => ({ rows: [] })),
      pool.query(
        `SELECT full_name, abbreviation, sort_order FROM company_directory ORDER BY sort_order, full_name`
      ).catch(() => ({ rows: [] })),
    ]);
    ({ rows: companies } = await pool.query(`SELECT * FROM companies ORDER BY section, code`));
  }
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

  const codes = companies.map(c => c.code);
  if (!codes.length) return { spi: [], pending: [], ra: [], products: productsList, productAliases: aliasMap, companyDirectory, lastUpdate: null };

  let products, stats, revChanges, pendMetas, raRows, shipRows, reapplyRows, cyclesMap, realzRows;
  if (inSheets()) {
    const inCodes = new Set(codes);
    const f = name => store.where(name, r => inCodes.has(r.company_code));
    [products, stats, revChanges, pendMetas, raRows, shipRows, reapplyRows, cyclesMap, realzRows] = await Promise.all([
      f('company_products').then(a => a.sort((x, y) => x.company_code !== y.company_code ? (x.company_code < y.company_code ? -1 : 1) : (Number(x.sort_order) || 0) - (Number(y.sort_order) || 0))),
      f('company_product_stats'),
      f('revision_changes'),
      f('pending_meta'),
      f('ra_records'),
      f('company_shipments').then(a => a.sort((x, y) => x.company_code !== y.company_code ? (x.company_code < y.company_code ? -1 : 1) : x.product !== y.product ? (String(x.product) < String(y.product) ? -1 : 1) : (Number(x.lot_no) || 0) - (Number(y.lot_no) || 0))),
      f('company_reapply_targets'),
      getCyclesFor(codes),
      f('realizations'),
    ]);
  } else {
    [
      { rows: products },
      { rows: stats },
      { rows: revChanges },
      { rows: pendMetas },
      { rows: raRows },
      { rows: shipRows },
      { rows: reapplyRows },
      cyclesMap,
      { rows: realzRows },
    ] = await Promise.all([
      pool.query(`SELECT * FROM company_products WHERE company_code = ANY($1) ORDER BY company_code, sort_order`, [codes]),
      pool.query(`SELECT * FROM company_product_stats WHERE company_code = ANY($1)`, [codes]),
      pool.query(`SELECT * FROM revision_changes WHERE company_code = ANY($1) ORDER BY company_code, direction, sort_order`, [codes]),
      pool.query(`SELECT * FROM pending_meta WHERE company_code = ANY($1)`, [codes]),
      pool.query(`SELECT * FROM ra_records WHERE company_code = ANY($1) ORDER BY company_code`, [codes]),
      pool.query(`SELECT * FROM company_shipments WHERE company_code = ANY($1) ORDER BY company_code, product, lot_no`, [codes]),
      pool.query(`SELECT * FROM company_reapply_targets WHERE company_code = ANY($1)`, [codes]),
      getCyclesFor(codes),
      pool.query(`SELECT * FROM realizations WHERE company_code = ANY($1)`, [codes]),
    ]);
  }

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
  const shipMap    = {};
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

  const ra = [];
  raRows.forEach(r => {
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

  // ── Realized = single source of truth: PIB realizations (deduped) ─────────
  // Override each RA record's realized (berat/cargoArrived/realPct) with the
  // company's total realized volume from the `realizations` table, deduped by
  // (pib_no, line_no) so a duplicate import never inflates the total. Synthesize
  // an RA entry for companies that have PIB realizations but no ra_records row.
  // This keeps every realized display (KPI, Util&Realization, drawer) in sync
  // with the authoritative customs (PIB) data. (2026-06-29 Option A.)
  {
    const pibRealized = {};   // code -> mt (deduped)
    const seen = new Set();
    for (const r of (realzRows || [])) {
      const code = r.company_code; if (!code) continue;
      const key = code + '|' + (r.pib_no || '') + '|' + (r.line_no || '');
      if (seen.has(key)) continue; seen.add(key);
      pibRealized[code] = (pibRealized[code] || 0) + (Number(r.volume) || 0);
    }
    const spiObtained = {};
    spi.forEach(c => { spiObtained[c.code] = Number(c.obtained) || 0; });
    const raIdx = {};
    ra.forEach(r => { raIdx[r.code] = r; });
    for (const [code, mtRaw] of Object.entries(pibRealized)) {
      const mt = Math.round(mtRaw * 1000) / 1000;
      if (!(mt > 0)) continue;
      const ex = raIdx[code];
      if (ex) {
        ex.berat = mt;
        ex.cargoArrived = true;
        const obt = ex.obtained || spiObtained[code] || 0;
        ex.realPct = obt > 0 ? mt / obt : 0;
      } else {
        const obt = spiObtained[code] || 0;
        ra.push({
          code, product: '', berat: mt, obtained: obt, cargoArrived: true,
          realPct: obt > 0 ? mt / obt : 0, utilPct: null, arrivalDate: null, etaJKT: null,
          reapplyEst: '', reapplyStage: 1, reapplyProduct: null, reapplyNewTotal: null,
          reapplyPrevObtained: null, reapplyAdditional: null, reapplySubmitDate: null,
          reapplyStatus: null, target: null, pertek: null, spi: null, catatan: null,
        });
      }
    }
  }

  // ── Quota ledger: single source for Obtained / Utilized / Available ──────
  // Derive obtained (effective, incl. revisions), utilization, and available
  // (= obtained − util) per company from the HS-keyed ledger seeded from the
  // authoritative master. Overrides the divergent cycles/stats so every KPI is
  // consistent and matches the master (Obtained 33.730 / Util 18.346 / Avail
  // 15.384). Synthesizes ledger companies missing from SPI (e.g. IKM). Frontend
  // reads _ledgerObtained for the Obtained KPI; util/avail flow from the
  // per-product maps. (2026-07-01 — see migration_work/ARCHITECTURE_LEDGER.md)
  // Recorded PERTEK Perubahan release dates (durable). A pending split whose
  // company has a date here is "released" → not reversed. Sheets-only store;
  // in Postgres/local dev this stays empty (splits stay gated until seeded
  // pending entries are removed or the app runs on Sheets). Tab may not exist
  // yet on a fresh env → treat a read failure as "no releases".
  const releasedMap = {};
  if (inSheets()) {
    try {
      (await store.table('pertek_perubahan_release')).forEach(r => {
        const d = String(r.release_date || '').trim();
        const code = String(r.code || '').trim();
        if (code && d) releasedMap[code] = d;
      });
    } catch (_) { /* no tab yet → no releases */ }
  }

  if (QUOTA_LEDGER && QUOTA_LEDGER.companies) {
    const hsName = QUOTA_LEDGER.products || {};
    const dirName = {}; companyDirectory.forEach(d => { dirName[d.abbreviation] = d.fullName; });
    const applyLedger = (co, ent) => {
      const utilByProd = {}, availByProd = {}, obtByProd = {};
      const ships = co.shipments || {};
      for (const [hs, v] of Object.entries(ent)) {
        const name = hsName[hs] || hs;
        const o = Number(v.obtained) || 0;
        const ledgerU = Number(v.util) || 0;
        // Reconcile the master-snapshot util (ledger, built from the master xlsx
        // which contains NO lots) with LIVE utilization the user records via
        // shipment lots. A lot is NEW utilization on top of the master baseline,
        // so effective util = ledgerUtil + Σlot.utilMT, CAPPED at obtained (you
        // can't utilize more than you were granted; the cap also prevents a lot
        // that merely re-itemizes the master snapshot from double-counting —
        // e.g. MIN BORDES obtained 247 / ledgerU 247 / lot 250 → 247, not 497).
        // The old max(ledgerU, Σlot) swallowed any lot smaller than the master
        // util, so consuming a company's remaining Available (e.g. HKG GL ALLOY
        // 750 util + 250 lot) never dropped Available. Zero-util products
        // (SPA GI ALLOY etc.) are unaffected: min(o, 0 + Σlot) == Σlot.
        const lotU = (ships[name] || []).reduce((s, l) => s + (Number(l.utilMT) || 0), 0);
        const u = Math.min(o, ledgerU + lotU);
        obtByProd[name] = o; utilByProd[name] = u; availByProd[name] = Math.max(0, o - u);
      }
      // PERTEK Perubahan gate: reverse a not-yet-released product split so the
      // dashboard shows the ORIGINAL PERTEK until the release date is entered.
      const revDef = PENDING_REVISIONS[co.code];
      if (revDef) {
        const res = applyPendingRevision({ obtByProd, utilByProd, availByProd }, revDef, releasedMap[co.code] || '');
        if (res.reversed) {
          co._pendingRevision = { from: revDef.from, to: revDef.to, mt: revDef.mt, origMT: obtByProd[revDef.from] || 0 };
        } else {
          delete co._pendingRevision;
        }
      }
      let obt = 0, util = 0;
      for (const name of Object.keys(obtByProd)) { obt += Number(obtByProd[name]) || 0; util += Number(utilByProd[name]) || 0; }
      obt = Math.round(obt * 1000) / 1000; util = Math.round(util * 1000) / 1000;
      co.obtained = obt;
      co.utilizationMT = util;
      co.availableQuota = Math.max(0, Math.round((obt - util) * 1000) / 1000);
      co.utilizationByProd = utilByProd;
      co.availableByProd = availByProd;
      co._ledgerObtained = obt;
      co._ledgerObtainedByProd = obtByProd;
      co.products = Object.keys(obtByProd);
    };
    const spiByCode = {}; spi.forEach(c => { spiByCode[c.code] = c; });
    for (const co of spi) {
      const ent = QUOTA_LEDGER.companies[co.code];
      if (ent) applyLedger(co, ent);
      else co._ledgerObtained = 0;   // not in current master → contributes 0
    }
    // Synthesize ledger companies absent from SPI (e.g. IKM sitting in pending).
    for (const [code, ent] of Object.entries(QUOTA_LEDGER.companies)) {
      if (spiByCode[code]) continue;
      // Attach the company's REAL shipment lots so utilization the user records
      // for a pending-but-ledgered company (e.g. IKM) is reflected in /api/data.
      // The old hardcoded `shipments: {}` silently dropped every saved lot, so
      // applyLedger saw lotU=0 and utilization stayed 0 no matter what was saved
      // (the "utilization tidak ke-save" bug — the write persisted, but this bulk
      // read discarded it). Uses the same shipRows the SPI/PENDING rows use.
      const shipMapFor = {};
      shipRows.filter(s => s.company_code === code).forEach(s => {
        (shipMapFor[s.product] = shipMapFor[s.product] || []).push({
          lotNo: s.lot_no, utilMT: Number(s.util_mt) || 0, etaJKT: s.eta_jkt || '',
          note: s.note || '', realMT: Number(s.real_mt) || 0, pibDate: s.pib_date || '',
          cargoArrived: s.cargo_arrived || false });
      });
      const co = { code, fullName: dirName[code] || code, group: '', section: 'SPI',
        products: [], submit1: 0, obtained: 0, utilizationMT: 0, availableQuota: 0,
        cycles: [], shipments: shipMapFor, utilizationByProd: {}, availableByProd: {}, arrivedByProd: {},
        revType: 'none', revNote: '', revSubmitDate: '', revStatus: '', revMT: 0,
        revFrom: [], revTo: [], salesRevRequest: {}, reapplyTargets: [],
        remarks: '', spiRef: '', statusUpdate: '', pertekNo: '', spiNo: '',
        updatedBy: '', updatedDate: '', updatedAt: null, cycleProducts: {} };
      applyLedger(co, ent);
      spi.push(co);
      const pi = pending.findIndex(p => p.code === code);
      if (pi >= 0) pending.splice(pi, 1);
    }
  }

  // ── lastUpdate: when the DATA was last edited (server-side, same for every
  // device) — replaces the old client-side wall clock. Max updated_at across
  // the tables that company/lot/RA edits touch. ──
  const _maxTs = arr => arr.reduce((m, r) => { const t = Date.parse(r && r.updated_at); return (!isNaN(t) && t > m) ? t : m; }, 0);
  const _lastMs = Math.max(_maxTs(companies), _maxTs(shipRows), _maxTs(raRows));
  const lastUpdate = _lastMs > 0 ? new Date(_lastMs).toISOString() : null;

  return { spi, pending, ra, products: productsList, productAliases: aliasMap, companyDirectory, lastUpdate };
}

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
    const t0 = Date.now();
    const { value, source } = await dcache.getOrBuild(
      CACHE_KEY_DATA, CACHE_TTL_DATA_SEC, _buildDataPayload
    );
    res.set('X-Cache', source);
    if (source === 'BUILD') {
      console.log(`/api/data built in ${Date.now() - t0}ms (cached ${CACHE_TTL_DATA_SEC}s, redis=${cache.isRedisReady()})`);
    }
    res.json(value);
  } catch (err) {
    console.error('/api/data error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Sheets-backed equivalent of the PATCH /api/company transaction. Persists
// scalar fields + products + pending_meta + shipments (with util recompute)
// + reapplyTargets + ra into the store. Mirrors the Neon handler's semantics.
async function patchCompanySheets(code, body) {
  const nowISO = () => new Date().toISOString();
  const companies = (await store.table('companies')).slice();
  const idx = companies.findIndex(c => c.code === code);
  if (idx < 0) return { error: 'company not found', status: 404 };
  const co = { ...companies[idx] };
  const cols = Object.keys(co);

  // ── scalar fields (same allow-list as Neon; util/avail excluded) ──
  const allowed = ['submit1','obtained','rev_type','rev_note','rev_submit_date','rev_status','rev_mt','remarks','spi_ref','status_update','pertek_no','spi_no','updated_by','updated_date'];
  for (const f of allowed) {
    const camel = f.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    if (body[camel] !== undefined) co[f] = body[camel];
    else if (body[f] !== undefined) co[f] = body[f];
  }
  co.updated_at = nowISO();
  const changed = {};

  // ── products: full replace company_products ──
  if (Array.isArray(body.products)) {
    let cp = (await store.table('company_products')).filter(r => r.company_code !== code);
    let maxId = cp.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0);
    [...new Set(body.products.filter(Boolean))].forEach((p, i) => cp.push({ id: ++maxId, company_code: code, product: p, sort_order: i, source_program: 'B' }));
    changed.company_products = cp;
  }

  // ── pending_meta (PENDING companies only) ──
  if ((body.pendingMt !== undefined || body.pendingStatus !== undefined || body.pendingDate !== undefined) && co.section === 'PENDING') {
    const pm = (await store.table('pending_meta')).slice();
    const pi = pm.findIndex(r => r.company_code === code);
    const cur = pi >= 0 ? pm[pi] : { company_code: code, mt: 0, status: '', date: '', source_program: 'B' };
    const upd = { ...cur, mt: body.pendingMt ?? cur.mt, status: body.pendingStatus ?? cur.status, date: body.pendingDate ?? cur.date };
    if (pi >= 0) pm[pi] = upd; else pm.push(upd);
    changed.pending_meta = pm;
  }

  // ── shipments (lots) upsert per product ──
  let shipmentsTouched = false;
  const oldLotSums = {};   // pre-patch Σ util_mt per product (baseline preservation)
  if (body.shipments && typeof body.shipments === 'object') {
    shipmentsTouched = true;
    let ship = (await store.table('company_shipments')).slice();
    // Snapshot existing lot utilization BEFORE mutating (numbers copied now, so
    // later in-place edits don't affect these sums). Used to derive the non-lot
    // baseline so a new lot ADDS to stats utilization instead of replacing it.
    ship.filter(r => r.company_code === code).forEach(r => {
      oldLotSums[r.product] = (oldLotSums[r.product] || 0) + (Number(r.util_mt) || 0);
    });
    let maxId = ship.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0);
    for (const [product, lots] of Object.entries(body.shipments)) {
      const keep = new Set(lots.map(l => String(l.lotNo)));
      ship = ship.filter(r => !(r.company_code === code && r.product === product && !keep.has(String(r.lot_no))));
      for (const lot of lots) {
        const ex = ship.find(r => r.company_code === code && r.product === product && String(r.lot_no) === String(lot.lotNo));
        const row = { company_code: code, product, lot_no: lot.lotNo, util_mt: lot.utilMT || 0, eta_jkt: lot.etaJKT || '', note: lot.note || '', real_mt: lot.realMT || 0, pib_date: lot.pibDate || '', cargo_arrived: !!lot.cargoArrived, updated_at: nowISO() };
        if (ex) Object.assign(ex, row); else ship.push({ id: ++maxId, created_at: nowISO(), source_program: 'B', ...row });
      }
    }
    changed.company_shipments = ship;
  }

  // ── recompute utilization from lots (mirror recomputeUtilizationFromLots) ──
  if (shipmentsTouched) {
    const lotSums = {};
    changed.company_shipments.filter(r => r.company_code === code).forEach(r => { lotSums[r.product] = (lotSums[r.product] || 0) + (Number(r.util_mt) || 0); });
    if (Object.keys(lotSums).length) {
      let stats = (await store.table('company_product_stats')).slice();
      let maxSid = stats.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0);
      for (const [product, util] of Object.entries(lotSums)) {
        // A lot-set carrying no utilization (e.g. a realization-only lot with
        // util_mt=0) gives no utilization signal — never let it CLEAR the
        // authoritative company_product_stats.utilization. Only (re)compute
        // util when the lots actually carry it. (Fixes 2026-06-12 util-zeroing.)
        if (!(util > 0)) continue;
        const ex = stats.find(s => s.company_code === code && s.product === product);
        const prevUtil = ex ? Number(ex.utilization_mt) || 0 : 0;
        const prevAvail = ex && ex.available_mt != null ? Number(ex.available_mt) : 0;
        const obtained = ex ? prevUtil + prevAvail : util;
        // Baseline = utilization recorded in stats but NOT represented by lots
        // (lots were historically empty while util lived in stats). A new lot must
        // ADD to it, not replace it. effUtil = baseline + Σ(new lots). Without this,
        // saving one lot wiped the existing utilization (2026-06-26 "record terhapus").
        const baseline = Math.max(0, prevUtil - (oldLotSums[product] || 0));
        const effUtil  = baseline + util;
        const newAvail = Math.max(0, obtained - effUtil);
        if (ex) { ex.utilization_mt = effUtil; ex.available_mt = newAvail; }
        else stats.push({ id: ++maxSid, company_code: code, product, utilization_mt: effUtil, available_mt: newAvail, realization_mt: '', eta_jkt: '', arrived: false, source_program: 'B' });
      }
      changed.company_product_stats = stats;
      const coUtil = stats.filter(s => s.company_code === code).reduce((a, s) => a + (Number(s.utilization_mt) || 0), 0);
      const coObt = co.obtained != null && co.obtained !== '' ? Number(co.obtained) : coUtil;
      co.utilization_mt = coUtil;
      co.available_quota = Math.max(0, coObt - coUtil);
    }
  }

  // ── reapply targets upsert ──
  if (Array.isArray(body.reapplyTargets)) {
    let rt = (await store.table('company_reapply_targets')).slice();
    let maxId = rt.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0);
    for (const t of body.reapplyTargets) {
      const ex = rt.find(r => r.company_code === code && r.product === t.product);
      const row = { company_code: code, product: t.product, target_mt: t.targetMT ?? '', submitted: !!t.submitted, submit_date: t.submitDate || '', notes: t.notes || '', source_program: 'B' };
      if (ex) Object.assign(ex, row); else rt.push({ id: ++maxId, created_at: nowISO(), ...row });
    }
    changed.company_reapply_targets = rt;
  }

  // ── ra record update (UPDATE-only, like Neon) ──
  let raTouched = false;
  if (body.ra) {
    const r = body.ra;
    const ra = (await store.table('ra_records')).slice();
    const ex = ra.find(x => x.company_code === code);
    if (ex) {
      Object.assign(ex, { berat: r.berat, obtained: r.obtained, cargo_arrived: !!r.cargoArrived, real_pct: r.realPct, util_pct: r.utilPct ?? '', arrival_date: r.arrivalDate || '', eta_jkt: r.etaJKT || '', reapply_est: r.reapplyEst || '', reapply_stage: r.reapplyStage || 1, reapply_submit_date: r.reapplySubmitDate || '', reapply_status: r.reapplyStatus || '', target: r.target ?? '', pertek: r.pertek || '', spi: r.spi || '', catatan: r.catatan || '', updated_at: nowISO() });
      changed.ra_records = ra;
      raTouched = true;
    }
  }

  // ── Obtained stats reconcile (Manual Update "Obtained MT per product") ──
  // The obtained-per-product table edits obtained but the cycle path never
  // touched company_product_stats → KPI (cycles) and the per-product breakdown
  // (stats) drifted (the SJH/LCP/BBB class). Caller sends the per-product
  // obtained totals it set; we PRESERVE each product's utilization and set
  // available = max(0, obtained − util) — declarative + idempotent, no cycle
  // derivation, no revision logic (Obtained #2 / revisions route through
  // record-obtained instead). Then recompute company totals so KPI = breakdown.
  if (Array.isArray(body.obtainedStats) && body.obtainedStats.length) {
    let stats = changed.company_product_stats || (await store.table('company_product_stats')).slice();
    let maxSid = stats.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0);
    for (const it of body.obtainedStats) {
      const product  = String((it && it.product) || '').trim();
      const obtained = Number(it && it.obtained);
      if (!product || !Number.isFinite(obtained) || obtained < 0) continue;
      const ex = stats.find(s => s.company_code === code && s.product === product);
      const util = ex ? Number(ex.utilization_mt) || 0 : 0;
      const avail = Math.max(0, obtained - util);
      if (ex) { ex.available_mt = avail; /* utilization preserved */ }
      else stats.push({ id: ++maxSid, company_code: code, product, utilization_mt: 0, available_mt: avail, realization_mt: '', eta_jkt: '', arrived: false, source_program: 'B' });
    }
    changed.company_product_stats = stats;
    const coStats = stats.filter(s => s.company_code === code);
    const coUtil  = coStats.reduce((a, s) => a + (Number(s.utilization_mt) || 0), 0);
    const coAvail = coStats.reduce((a, s) => a + (Number(s.available_mt) || 0), 0);
    co.utilization_mt  = coUtil;
    co.available_quota = coAvail;
    co.obtained        = coUtil + coAvail;
  }

  companies[idx] = co;
  changed.companies = companies;
  // Anti-wipe guard: a single-company patch must never shrink the master list.
  // (idx>=0 already implies >=1 row; this catches any future regression that
  // would otherwise blank the companies tab — see the 2026-06-12 incident.)
  if (!Array.isArray(changed.companies) || changed.companies.length === 0) {
    return { error: 'refusing to write empty companies tab', status: 500 };
  }
  // One batched write for ALL touched tabs (2 API calls total) — avoids the
  // 60-writes/min Sheets quota a per-tab rewrite would burn through.
  await store.batchRewrite(changed);
  await store.logChange({ sheet: 'companies', record_id: code, field: Object.keys(body).filter(k => k !== '_ifUpdatedAt').join(','), new_value: '(patch)', changed_by: body.updatedBy || 'api', note: 'company patch' });
  return { ok: true, updatedAt: co.updated_at, ra: raTouched };
}

// ═══════════════════════════════════════════════════════════════════
// PATCH /api/company/:code  — update editable fields
// ═══════════════════════════════════════════════════════════════════
app.patch('/api/company/:code', async (req, res) => {
  const { code } = req.params;
  const body = req.body;

  // Sheets mode: full company patch (scalars + products + pending_meta +
  // shipments/util recompute + reapplyTargets + ra) persisted to the store.
  if (inSheets()) {
    try {
      const result = await patchCompanySheets(code, body);
      if (result.error) return res.status(result.status || 500).json({ error: result.error });
      if (result.ra) await dcache.invalidate(CACHE_KEY_RA_ALL);
      await dcache.invalidate(CACHE_KEY_DATA);
      return res.json({ ok: true, code, updatedAt: result.updatedAt });
    } catch (err) {
      console.error('PATCH /api/company (sheets) error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

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

    // Build dynamic SET clause — only update fields present in body.
    //
    // utilization_mt & available_quota intentionally REMOVED from allowed list:
    // they are XLSX-reconciled via KPI_RECONCILE (server.js boot IIFE) and
    // must not be writable from any client path. Allowing them here meant
    // patchShipmentsToServer (and any future client code) could silently
    // overwrite the reconciled aggregate on every save.
    const allowed = [
      'submit1','obtained',
      'rev_type','rev_note','rev_submit_date','rev_status','rev_mt',
      'remarks','spi_ref','status_update','pertek_no','spi_no',
      'updated_by','updated_date',
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

    // Replace company_products list when client sends it. The frontend's
    // "+Add Product" / rename flows mutate co.products[]; without this
    // upsert the master table stays at the original product set so any
    // query that joins on company_products misses the new entries.
    // Semantics: full replace (DELETE then INSERT) keyed by company_code.
    // Frontend always sends the complete current list.
    if (Array.isArray(body.products)) {
      await client.query(
        `DELETE FROM company_products WHERE company_code = $1`, [code]
      );
      const dedup = Array.from(new Set(body.products.filter(Boolean)));
      for (let i = 0; i < dedup.length; i++) {
        await client.query(
          `INSERT INTO company_products (company_code, product, sort_order)
           VALUES ($1, $2, $3)`,
          [code, dedup[i], i]
        );
      }
    }

    // Keep pending_meta in sync for PENDING companies. The frontend stores
    // user edits in co.statusUpdate / co.status / co.date / co.mt; without
    // this upsert the NewSubmission cells re-load with stale data because
    // /api/data reads mt/status/date from pending_meta.
    if (body.pendingMt !== undefined || body.pendingStatus !== undefined ||
        body.pendingDate !== undefined) {
      const { rows: secRows } = await client.query(
        `SELECT section FROM companies WHERE code = $1`, [code]
      );
      if (secRows.length && secRows[0].section === 'PENDING') {
        await client.query(
          `INSERT INTO pending_meta (company_code, mt, status, date)
           VALUES ($1, COALESCE($2,0), COALESCE($3,''), COALESCE($4,''))
           ON CONFLICT (company_code) DO UPDATE SET
             mt     = COALESCE(EXCLUDED.mt,     pending_meta.mt),
             status = COALESCE(EXCLUDED.status, pending_meta.status),
             date   = COALESCE(EXCLUDED.date,   pending_meta.date)`,
          [code, body.pendingMt ?? null, body.pendingStatus ?? null, body.pendingDate ?? null]
        );
      }
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

    // β-2: lots are now the source of truth for utilization. Recompute
    // company_product_stats + companies util/avail from the lots we just
    // upserted, so the Sales "Simpan" path actually moves the dashboard's
    // utilization (per-product cards, KPIs). No-op when the company has no
    // lots. utilization_mt / available_quota are still NOT taken from the
    // client body — they're derived server-side from the lot rows.
    if (body.shipments) {
      await recomputeUtilizationFromLots(client, code);
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
    // write happened — next GET /api/data must re-read DB. If body.ra was
    // touched, the dedicated /api/ra cache is also stale.
    await Promise.all([
      dcache.invalidate(CACHE_KEY_DATA),
      body.ra ? dcache.invalidate(CACHE_KEY_RA_ALL) : Promise.resolve(),
    ]);
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
// POST /api/company  — create a new PENDING company (New Submission)
// Used when CorpSec adds a company that exists in company_directory but
// hasn't been entered as PENDING/SPI yet (e.g. PT IKM submitting its
// first MOI). Idempotent: returns 409 if the code is already taken.
// ═══════════════════════════════════════════════════════════════════
app.post('/api/company', async (req, res) => {
  const { code, grp, products, mt, status, date, remarks, statusUpdate,
          submitDate, updatedBy } = req.body || {};
  if (!code) return res.status(400).json({ error: 'code is required' });

  if (inSheets()) {
    try {
      const companies = await store.table('companies');
      if (companies.some(c => c.code === code)) return res.status(409).json({ error: `Company ${code} already exists` });
      const dir = (await store.table('company_directory')).find(d => d.abbreviation === code);
      const fullName = req.body.fullName || (dir && dir.full_name) || '';
      const now = new Date().toISOString();
      const updatedDate = new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
      await store.appendRows('companies', [{
        code, full_name: fullName, grp: grp || 'CD', section: 'PENDING',
        submit1: mt || 0, obtained: 0, utilization_mt: 0, available_quota: '',
        rev_type: 'none', rev_note: '', rev_submit_date: '', rev_status: '', rev_mt: 0,
        remarks: remarks || '', spi_ref: '', status_update: statusUpdate || '',
        pertek_no: '', spi_no: '', updated_by: updatedBy || '', updated_date: updatedDate,
        created_at: now, updated_at: now, source_program: 'B',
      }]);
      const prodList = Array.isArray(products) ? products.filter(Boolean) : [];
      if (prodList.length) {
        let cpId = (await store.table('company_products')).reduce((m, r) => Math.max(m, Number(r.id) || 0), 0);
        await store.appendRows('company_products', prodList.map((p, i) => ({ id: ++cpId, company_code: code, product: p, sort_order: i, source_program: 'B' })));
      }
      await store.appendRows('pending_meta', [{ company_code: code, mt: mt || 0, status: status || '', date: date || '', source_program: 'B' }]);
      // Seed Submit #1 cycle. release_date left BLANK (not 'TBA') = pending.
      const cyId = (await store.table('cycles')).reduce((m, r) => Math.max(m, Number(r.id) || 0), 0) + 1;
      await store.appendRows('cycles', [{ id: cyId, company_code: code, cycle_type: 'Submit #1', mt: String(mt || 0), submit_type: 'Submit MOI', submit_date: submitDate || '', release_type: 'PERTEK', release_date: '', status: statusUpdate || '', sort_order: 0, pertek_date: '', spi_date: '', from_rev_req: false, source_program: 'B' }]);
      if (prodList.length) {
        let cpiId = (await store.table('cycle_products')).reduce((m, r) => Math.max(m, Number(r.id) || 0), 0);
        await store.appendRows('cycle_products', prodList.map(p => ({ id: ++cpiId, cycle_id: cyId, product: p, mt: String(mt || 0), source_program: 'B' })));
      }
      await store.logChange({ sheet: 'companies', record_id: code, field: '(create)', new_value: fullName, changed_by: updatedBy || 'api', note: 'company create' });
      await dcache.invalidate(CACHE_KEY_DATA);
      return res.json({ ok: true, code, fullName });
    } catch (err) {
      console.error('POST /api/company (sheets) error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Reject duplicates so we don't silently clobber existing data.
    const { rows: existing } = await client.query(
      `SELECT code FROM companies WHERE code = $1`, [code]
    );
    if (existing.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `Company ${code} already exists` });
    }

    // Resolve full_name from directory if the client didn't supply one.
    const { rows: dirRows } = await client.query(
      `SELECT full_name FROM company_directory WHERE abbreviation = $1 LIMIT 1`, [code]
    );
    const fullName = (req.body.fullName) || (dirRows[0] && dirRows[0].full_name) || '';

    await client.query(
      `INSERT INTO companies
         (code, full_name, grp, section, submit1, obtained, utilization_mt,
          rev_type, remarks, status_update, updated_by, updated_date,
          created_at, updated_at)
       VALUES ($1,$2,$3,'PENDING',$4,0,0,'none',$5,$6,$7,$8,NOW(),NOW())`,
      [code, fullName, grp || 'CD', mt || 0,
       remarks || '', statusUpdate || '', updatedBy || '',
       new Date().toLocaleDateString('id-ID',{day:'2-digit',month:'short',year:'numeric'})]
    );

    // Products: one row per product (sort_order = position)
    const prodList = Array.isArray(products) ? products.filter(Boolean) : [];
    for (let i = 0; i < prodList.length; i++) {
      await client.query(
        `INSERT INTO company_products (company_code, product, sort_order)
         VALUES ($1,$2,$3)`,
        [code, prodList[i], i]
      );
    }

    // Pending meta row holds mt/status/date for the New Submission table.
    await client.query(
      `INSERT INTO pending_meta (company_code, mt, status, date)
       VALUES ($1,$2,$3,$4)`,
      [code, mt || 0, status || '', date || '']
    );

    // Seed a Submit #1 cycle so the company shows up on the lead-time /
    // pipeline analytics with the correct MOI date.
    const cycleProducts = {};
    prodList.forEach(p => { cycleProducts[p] = mt || 0; });
    const { rows: cyRows } = await client.query(
      `INSERT INTO cycles
         (company_code, cycle_type, mt, submit_type, submit_date,
          release_type, release_date, status, sort_order)
       VALUES ($1,'Submit #1',$2,'Submit MOI',$3,'PERTEK','TBA',$4,0)
       RETURNING id`,
      [code, String(mt || 0), submitDate || '', statusUpdate || '']
    );
    for (const [prod, pmt] of Object.entries(cycleProducts)) {
      await client.query(
        `INSERT INTO cycle_products (cycle_id, product, mt) VALUES ($1,$2,$3)`,
        [cyRows[0].id, prod, String(pmt)]
      );
    }

    await client.query('COMMIT');
    await dcache.invalidate(CACHE_KEY_DATA); // new company created — refresh cache
    res.json({ ok: true, code, fullName });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('POST /api/company error:', err);
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

  if (inSheets()) {
    try {
      // TBA dates are stored BLANK (= pending) per business rule.
      const norm = d => /^tba$/i.test(String(d || '').trim()) ? '' : (d || '');
      const allCycles = await store.table('cycles');
      const allCp = await store.table('cycle_products');
      const removedIds = new Set(allCycles.filter(c => c.company_code === code).map(c => String(c.id)));
      const keepCycles = allCycles.filter(c => c.company_code !== code);
      const keepCp = allCp.filter(cp => !removedIds.has(String(cp.cycle_id)));
      let cyId = allCycles.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0);
      let cpId = allCp.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0);
      const newCycles = [], newCp = [];
      cycles.forEach((c, i) => {
        const id = ++cyId;
        newCycles.push({ id, company_code: code, cycle_type: c.type || '', mt: c.mt == null ? '' : c.mt, submit_type: c.submitType || '', submit_date: norm(c.submitDate), release_type: c.releaseType || '', release_date: norm(c.releaseDate), status: c.status || '', sort_order: i, pertek_date: c.pertekDate || '', spi_date: c.spiDate || '', from_rev_req: c._fromRevReq || false, source_program: 'B' });
        if (c.products && typeof c.products === 'object') {
          for (const [product, mt] of Object.entries(c.products)) newCp.push({ id: ++cpId, cycle_id: id, product, mt: mt == null ? '' : String(mt), source_program: 'B' });
        }
      });
      await store.batchRewrite({ cycles: keepCycles.concat(newCycles), cycle_products: keepCp.concat(newCp) });
      await store.logChange({ sheet: 'cycles', record_id: code, field: '(replace)', new_value: `${cycles.length} cycles`, changed_by: 'api', note: 'cycle editor' });
      await dcache.invalidate(CACHE_KEY_DATA);
      return res.json({ ok: true, cycles: cycles.length });
    } catch (err) {
      console.error('PATCH /api/company/:code/cycles (sheets) error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

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
    await dcache.invalidate(CACHE_KEY_DATA); // cycles changed — refresh cache
    res.json({ ok: true, cycles: cycles.length });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('/api/company/:code/cycles PATCH error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ═══════════════════════════════════════════════════════════════════
// POST /api/company/:code/record-obtained
// Atomically record a "new quota" obtained (e.g. Obtained #2 from a
// re-apply) so it shows EVERYWHERE without the manual fix-ups we kept
// doing (SJH/LCP/BBB). It:
//   1. marks the cycle terbit (release_date/spi_date) + clears from_rev_req
//      → the cycles-based KPI counts it as new MT,
//   2. adds the MT to the product's company_product_stats AVAILABLE
//      → the breakdown + Available card update,
//   3. recomputes the company's obtained/util/avail from its stats.
// Declarative & idempotent: re-recording the same cycle replaces (not
// double-adds) by netting out the cycle's prior counted contribution.
// Sheets-only (production). Body: { cycleType?, product, mt, terbitDate }.
// ═══════════════════════════════════════════════════════════════════
app.post('/api/company/:code/record-obtained', async (req, res) => {
  const { code } = req.params;
  const b = req.body || {};
  const cycleType  = String(b.cycleType || 'Obtained #2').trim();
  const product    = String(b.product || '').trim();
  const terbitDate = String(b.terbitDate || '').trim();
  const mt         = Number(b.mt);
  if (!product)    return res.status(400).json({ error: 'product required' });
  if (!terbitDate) return res.status(400).json({ error: 'terbitDate required' });
  if (!Number.isFinite(mt) || mt <= 0) return res.status(400).json({ error: 'mt must be a positive number' });
  if (!inSheets()) return res.status(501).json({ error: 'record-obtained is Sheets-only' });
  try {
    const nowISO = new Date().toISOString();
    const companies = (await store.table('companies')).slice();
    const co = companies.find(c => c.code === code);
    if (!co) return res.status(404).json({ error: 'company not found' });

    // Find (or create) the obtained cycle for this company + type.
    const cycles = (await store.table('cycles')).slice();
    let cyc = cycles.find(c => c.company_code === code && c.cycle_type === cycleType);
    if (!cyc) {
      const maxCyId = cycles.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0);
      cyc = { id: String(maxCyId + 1), company_code: code, cycle_type: cycleType, mt,
        submit_type: 'Submit MOT (Submit #2) Perubahan', submit_date: '', release_type: 'SPI Perubahan',
        release_date: '', status: '', sort_order: cycles.filter(c => c.company_code === code).length,
        pertek_date: '', spi_date: '', from_rev_req: false, source_program: 'B' };
      cycles.push(cyc);
    }
    // Was this obtained already counted (terbit AND not a rev-req artifact)?
    // If so, net out its prior MT so re-recording is idempotent.
    const rd = String(cyc.release_date || '').trim();
    const wasCounted = cyc.from_rev_req === false && rd && !/^tba$/i.test(rd);
    const prevContribution = wasCounted ? (Number(cyc.mt) || 0) : 0;

    cyc.release_date = terbitDate;
    cyc.spi_date     = terbitDate;
    cyc.status       = `SPI TERBIT ${terbitDate}`;
    cyc.from_rev_req = false;
    cyc.mt           = mt;

    // cycle_products: set this cycle's breakdown to the single product.
    let cp = (await store.table('cycle_products')).slice();
    let maxCpId = cp.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0);
    cp = cp.filter(r => String(r.cycle_id) !== String(cyc.id));
    cp.push({ id: ++maxCpId, cycle_id: cyc.id, product, mt: String(mt), source_program: 'B' });

    // stats: add the new MT to AVAILABLE (new obtained, not yet utilized),
    // netting out any prior counted contribution. Utilization untouched.
    let stats = (await store.table('company_product_stats')).slice();
    let maxSid = stats.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0);
    const st = stats.find(s => s.company_code === code && s.product === product);
    if (st) {
      st.available_mt = Math.max(0, (Number(st.available_mt) || 0) - prevContribution + mt);
    } else {
      stats.push({ id: ++maxSid, company_code: code, product, utilization_mt: 0,
        available_mt: mt, realization_mt: '', eta_jkt: '', arrived: false, source_program: 'B' });
    }

    // Recompute company-level from its stats (keeps it consistent with breakdown).
    const coStats = stats.filter(s => s.company_code === code);
    const coUtil  = coStats.reduce((a, s) => a + (Number(s.utilization_mt) || 0), 0);
    const coAvail = coStats.reduce((a, s) => a + (Number(s.available_mt) || 0), 0);
    co.utilization_mt  = coUtil;
    co.available_quota = coAvail;
    co.obtained        = coUtil + coAvail;
    co.updated_at      = nowISO;

    await store.batchRewrite({ cycles, cycle_products: cp, company_product_stats: stats, companies });
    await store.logChange({ sheet: 'cycles', record_id: code, field: 'record-obtained',
      old_value: `${cycleType} prevCounted=${prevContribution}`, new_value: `${product} +${mt}→avail terbit ${terbitDate}`,
      changed_by: b.updatedBy || 'api', note: 'record new obtained (auto)' });
    await dcache.invalidate(CACHE_KEY_DATA);
    return res.json({ ok: true, code, product, obtained: co.obtained, utilization: coUtil, available: coAvail });
  } catch (err) {
    console.error('record-obtained error:', err);
    return res.status(500).json({ error: err.message });
  }
});

app.get('/api/company/:code', async (req, res) => {
  const { code } = req.params;
  try {
    let rows, products, stats, revChanges, pendMetas, shipRows, reapplyRows;
    if (inSheets()) {
      const byCode = name => store.where(name, r => r.company_code === code);
      [rows, products, stats, revChanges, pendMetas, shipRows, reapplyRows] = await Promise.all([
        store.where('companies', r => r.code === code),
        byCode('company_products'), byCode('company_product_stats'),
        byCode('revision_changes'), byCode('pending_meta'),
        byCode('company_shipments'), byCode('company_reapply_targets'),
      ]);
    } else {
      ({ rows } = await pool.query(`SELECT * FROM companies WHERE code=$1`, [code]));
    }
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const co = rows[0];
    if (!inSheets()) {
      [
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
    }
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
  res.set('Cache-Control', 'private, max-age=30, stale-while-revalidate=60');
  try {
    const { value, source } = await dcache.getOrBuild(
      CACHE_KEY_RA_ALL, CACHE_TTL_RA_SEC,
      async () => {
        const rows = inSheets()
          ? (await store.table('ra_records')).slice().sort((a, b) => String(a.company_code).localeCompare(String(b.company_code)))
          : (await pool.query(`SELECT * FROM ra_records ORDER BY company_code`)).rows;
        return rows.map(r => ({
          code: r.company_code, product: r.product,
          berat: Number(r.berat)||0, obtained: Number(r.obtained)||0,
          cargoArrived: r.cargo_arrived, realPct: Number(r.real_pct)||0,
          utilPct: r.util_pct!=null?Number(r.util_pct):null,
          arrivalDate: r.arrival_date||null, etaJKT: r.eta_jkt||null,
          reapplyEst: r.reapply_est||'', reapplyStage: r.reapply_stage||1,
          reapplyProduct: r.reapply_product||null,
          target: r.target!=null?Number(r.target):null,
          pertek: r.pertek||null, spi: r.spi||null, catatan: r.catatan||null,
        }));
      }
    );
    res.set('X-Cache', source);
    res.json(value);
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

// ── Sheets-backed realization writes (mirror of insertRealization) ──────────
function buildRealizationObj(code, row, defaults, id) {
  const now = new Date().toISOString();
  return {
    id, company_code: code,
    product: row.product || '', line_no: _num(row.lineNo) ?? 1,
    description: row.description || '', hs_code: row.hsCode || '',
    volume: _num(row.volume), unit: row.unit || 'TNE', value_usd: _num(row.valueUSD),
    unit_price: _num(row.unitPrice), kurs: _num(row.kurs),
    country_origin: row.countryOrigin || '', port_destination: row.portDestination || '',
    port_loading: row.portLoading || '', ls_no: row.lsNo || '', ls_date: row.lsDate || '',
    pib_no: row.pibNo || '', pib_date: row.pibDate || '', invoice_no: row.invoiceNo || '',
    invoice_date: row.invoiceDate || '', pengajuan_no: row.pengajuanNo || '', pengajuan_date: row.pengajuanDate || '',
    source: defaults.source || row.source || 'manual', source_file: defaults.sourceFile || '',
    imported_by: defaults.importedBy || '', created_at: now, updated_at: now, source_program: 'B',
  };
}
// Collapse duplicate PIB lines (same company+pib_no+line_no) that an earlier
// double-import created. Prefer the non-'migrationA' copy. Read-side dedup so
// the modal/export never show doubled lines without deleting Sheet rows.
function dedupeRealizations(rows) {
  const byKey = new Map();
  for (const r of rows) {
    const k = (r.company_code || '') + '|' + (r.pib_no || '') + '|' + (r.line_no || '');
    const cur = byKey.get(k);
    if (!cur) { byKey.set(k, r); continue; }
    if (cur.imported_by === 'migrationA' && r.imported_by !== 'migrationA') byKey.set(k, r);
  }
  return Array.from(byKey.values());
}
async function insertRealizationsSheets(code, rows, defaults) {
  const all = await store.table('realizations');
  let maxId = all.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0);
  const objs = rows.map(row => buildRealizationObj(code, row, defaults, ++maxId));
  await store.appendRows('realizations', objs);
  await store.logChange({ sheet: 'realizations', record_id: objs.map(o => o.id).join(','), field: '(insert)', new_value: `${code} × ${objs.length}`, changed_by: defaults.importedBy || 'api', note: 'realization insert' });
  return objs.map(o => o.id);
}

// GET /api/realizations?company_code=CODE  — list realizations (optionally filtered)
// GET /api/realizations/summary  — lightweight count per company
// Used by the dashboard drawer to decide whether to show the "Detail
// Realization" button (and a PIB count badge) WITHOUT pulling all the
// row data into the initial /api/data payload.
// Response: { counts: { 'BTS': { pibs: 2, lines: 9 }, ... }, totalPibs, totalLines }
app.get('/api/realizations/summary', async (req, res) => {
  res.set('Cache-Control', 'private, max-age=30, stale-while-revalidate=60');
  try {
    const { value, source } = await dcache.getOrBuild(
      CACHE_KEY_REALIZATIONS_SUM, CACHE_TTL_REALIZATIONS_SEC,
      async () => {
        const counts = {};
        let totalPibs = 0, totalLines = 0;
        if (inSheets()) {
          const byCo = {};
          dedupeRealizations(await store.table('realizations'))
            .filter(r => r.company_code)
            .forEach(r => {
              const c = (byCo[r.company_code] = byCo[r.company_code] || { pibs: new Set(), lines: 0 });
              if (r.pib_no) c.pibs.add(r.pib_no);
              c.lines += 1;
            });
          Object.entries(byCo).forEach(([code, c]) => {
            counts[code] = { pibs: c.pibs.size, lines: c.lines };
            totalPibs += c.pibs.size; totalLines += c.lines;
          });
        } else {
          const { rows } = await pool.query(
            `SELECT company_code,
                    COUNT(DISTINCT pib_no)::int                AS pibs,
                    COUNT(DISTINCT (pib_no, line_no))::int     AS lines
             FROM realizations
             WHERE company_code IS NOT NULL
             GROUP BY company_code`
          );
          rows.forEach(r => {
            counts[r.company_code] = { pibs: r.pibs, lines: r.lines };
            totalPibs  += r.pibs;
            totalLines += r.lines;
          });
        }
        return { counts, totalPibs, totalLines };
      }
    );
    res.set('X-Cache', source);
    res.json(value);
  } catch (err) {
    console.error('GET /api/realizations/summary error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/realizations', async (req, res) => {
  const { company_code } = req.query;
  // Per-company-code key (or "_all" for the unfiltered variant) so each
  // dashboard drawer caches independently and we can invalidate just the
  // affected company on POST/DELETE without flushing the whole list.
  const cacheKey = CACHE_KEY_REALIZATIONS_PFX + (company_code || '_all');
  res.set('Cache-Control', 'private, max-age=30, stale-while-revalidate=60');
  try {
    const { value, source } = await dcache.getOrBuild(
      cacheKey, CACHE_TTL_REALIZATIONS_SEC,
      async () => {
        if (inSheets()) {
          let rows = await store.table('realizations');
          if (company_code) rows = rows.filter(r => r.company_code === company_code);
          rows = dedupeRealizations(rows);   // collapse double-import duplicates
          // pib_date is DD/MM/YYYY (or ''); sort DESC by parsed date
          const ts = s => { const m = String(s || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); return m ? Date.UTC(+m[3], +m[2] - 1, +m[1]) : 0; };
          rows = rows.slice().sort((a, b) =>
            ts(b.pib_date) - ts(a.pib_date)
            || String(a.company_code).localeCompare(String(b.company_code))
            || String(a.pib_no).localeCompare(String(b.pib_no))
            || (Number(a.line_no) || 0) - (Number(b.line_no) || 0));
          return { realizations: rows };
        }
        const sql = company_code
          ? `SELECT * FROM realizations WHERE company_code = $1 ORDER BY pib_date DESC, pib_no, line_no`
          : `SELECT * FROM realizations ORDER BY pib_date DESC, company_code, pib_no, line_no`;
        const args = company_code ? [company_code] : [];
        const { rows } = await pool.query(sql, args);
        return { realizations: dedupeRealizations(rows) };
      }
    );
    res.set('X-Cache', source);
    res.json(value);
  } catch (err) {
    console.error('GET /api/realizations error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// GET /api/insights — analytics answering the business questions
//   /api/insights                → all answers (item/company via ?item= ?company=)
//   /api/insights/:q             → single answer (q1..q8 | realization)
// Reads from the active data source (Google Sheets when DATA_SOURCE=sheets).
// ═══════════════════════════════════════════════════════════════════
const _insightFns = {
  q1: (t, o) => insights.obtainedByPeriod(t, o.today),
  q2: (t, o) => insights.latestProgress(t, o.company),
  q3: (t)    => insights.topQuotaItems(t),
  q4: (t)    => insights.leadTime(t),
  q5: (t, o) => insights.remainingForItem(t, o.item),
  q6: (t, o) => insights.companiesWithItem(t, o.item),
  q7: (t, o) => insights.utilizationTiming(t, o.company),
  q8: (t, o) => insights.reallocations(t, o.item),
  realization: (t, o) => insights.realizationMetrics(t, o.today),
};
async function _insightOpts(req, t) {
  return {
    today: new Date(),
    item: req.query.item || 'GI ALLOY',
    company: req.query.company || (t.companies[0] && t.companies[0].code),
  };
}
app.get('/api/insights', async (req, res) => {
  try {
    const t = await loadAnalyticsTables();
    res.set('X-Data-Source', inSheets() ? 'sheets' : 'neon');
    res.json({ source: inSheets() ? 'sheets' : 'neon', ...insights.all(t, await _insightOpts(req, t)) });
  } catch (err) {
    console.error('GET /api/insights error:', err);
    res.status(500).json({ error: err.message });
  }
});
app.get('/api/insights/:q', async (req, res) => {
  const fn = _insightFns[req.params.q];
  if (!fn) return res.status(404).json({ error: `unknown insight '${req.params.q}'` });
  try {
    const t = await loadAnalyticsTables();
    res.set('X-Data-Source', inSheets() ? 'sheets' : 'neon');
    res.json(fn(t, await _insightOpts(req, t)));
  } catch (err) {
    console.error(`GET /api/insights/${req.params.q} error:`, err);
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

  if (inSheets()) {
    try {
      const exists = (await store.table('companies')).some(c => c.code === companyCode);
      if (!exists) return res.status(404).json({ error: `Unknown company code: ${companyCode}` });
      const ids = await insertRealizationsSheets(companyCode, rows, { source: source || 'excel', sourceFile: sourceFile || '', importedBy: importedBy || '' });
      await Promise.all([
        dcache.invalidate(CACHE_KEY_REALIZATIONS_SUM),
        dcache.invalidatePrefix(CACHE_KEY_REALIZATIONS_PFX),
        dcache.invalidate(CACHE_KEY_DATA),
      ]);
      return res.json({ ok: true, inserted: ids.length, ids });
    } catch (err) {
      console.error('POST /api/realizations (sheets) error:', err);
      return res.status(500).json({ error: err.message });
    }
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
    // Bust both the summary aggregate and any list slice (per-company
    // and `_all`). PATCH /api/company also depends on /api/data
    // (utilization vs realization is shown side-by-side), so invalidate
    // that too — cheap because the prewarm refills it within seconds.
    await Promise.all([
      dcache.invalidate(CACHE_KEY_REALIZATIONS_SUM),
      dcache.invalidatePrefix(CACHE_KEY_REALIZATIONS_PFX),
      dcache.invalidate(CACHE_KEY_DATA),
    ]);
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

  if (inSheets()) {
    try {
      const exists = (await store.table('companies')).some(c => c.code === companyCode);
      if (!exists) return res.status(404).json({ error: `Unknown company code: ${companyCode}` });
      const [id] = await insertRealizationsSheets(companyCode, [row], { source: 'manual', sourceFile: '', importedBy: importedBy || '' });
      await Promise.all([
        dcache.invalidate(CACHE_KEY_REALIZATIONS_SUM),
        dcache.invalidatePrefix(CACHE_KEY_REALIZATIONS_PFX),
        dcache.invalidate(CACHE_KEY_DATA),
      ]);
      return res.json({ ok: true, id });
    } catch (err) {
      console.error('POST /api/realizations/single (sheets) error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  const client = await pool.connect();
  try {
    const { rowCount } = await client.query(`SELECT 1 FROM companies WHERE code = $1`, [companyCode]);
    if (!rowCount) return res.status(404).json({ error: `Unknown company code: ${companyCode}` });

    const r = await insertRealization(client, companyCode, row, {
      source: 'manual', sourceFile: '', importedBy: importedBy || '',
    });
    await Promise.all([
      dcache.invalidate(CACHE_KEY_REALIZATIONS_SUM),
      dcache.invalidatePrefix(CACHE_KEY_REALIZATIONS_PFX),
      dcache.invalidate(CACHE_KEY_DATA),
    ]);
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
    if (inSheets()) {
      const all = await store.table('realizations');
      const kept = all.filter(r => String(r.id) !== String(id));
      if (kept.length === all.length) return res.status(404).json({ error: 'not found' });
      await store.rewriteTable('realizations', kept);
      await store.logChange({ sheet: 'realizations', record_id: String(id), field: '(delete)', old_value: id, changed_by: 'api', note: 'realization delete' });
      await Promise.all([
        dcache.invalidate(CACHE_KEY_REALIZATIONS_SUM),
        dcache.invalidatePrefix(CACHE_KEY_REALIZATIONS_PFX),
        dcache.invalidate(CACHE_KEY_DATA),
      ]);
      return res.json({ ok: true });
    }
    const { rowCount } = await pool.query(`DELETE FROM realizations WHERE id = $1`, [id]);
    if (!rowCount) return res.status(404).json({ error: 'not found' });
    await Promise.all([
      dcache.invalidate(CACHE_KEY_REALIZATIONS_SUM),
      dcache.invalidatePrefix(CACHE_KEY_REALIZATIONS_PFX),
      dcache.invalidate(CACHE_KEY_DATA),
    ]);
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/realizations/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Health check ────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date() }));
// Ultra-lightweight liveness probe for UptimeRobot / cron pings.
// Does NOT touch the DB so even a cold pool doesn't queue these requests.
// Set up an external pinger (UptimeRobot, cron-job.org) to hit /healthz
// every 5 minutes to prevent Render/Heroku free-tier sleep (15min idle).
app.get('/healthz', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.status(200).type('text/plain').send('ok');
});

// ── Fallback SPA ─────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start ────────────────────────────────────────────────────────
// COLD-START OPTIMIZATION (board-approved 2026):
//   1. Listen IMMEDIATELY — every second the listener is delayed is a
//      second the user waits behind the Render/Heroku spin-up.
//   2. initDB() and pool warmup run in the BACKGROUND. By the time the
//      first /api/data request lands, the pool has likely warmed and
//      the schema check is done. If it isn't, the query queues briefly
//      instead of blocking the whole server boot (5-15s saved).
//   3. Set `SKIP_INIT_DB=1` in production envs after first deploy so
//      we don't waste ~20 sequential CREATE TABLE round-trips on every
//      dyno restart. The schema is already there.
app.listen(PORT, async () => {
  console.log(`🚀 IQ Dash listening on http://localhost:${PORT}`);
  // Warm the Google Sheets store if ANY request path may use it.
  if (ANY_SHEETS) {
    store.load(true).then(() => console.log('[data] Google Sheets store warmed'))
                    .catch(err => console.error('[data] sheets warm error:', err.message));
  }
  // Background schema check — only when Neon is a live backend.
  if (!ANY_NEON) {
    console.log('⏩ Skipping initDB (no Neon backend active)');
  } else if (process.env.SKIP_INIT_DB === '1') {
    console.log('⏩ Skipping initDB (SKIP_INIT_DB=1)');
  } else {
    initDB().catch(err => console.error('initDB background error:', err));
  }
  // Pre-warm pool only when Neon is a live backend (skipped for pure-sheets
  // deploys so the app never touches Neon).
  if (ANY_NEON) {
    try {
      const t0 = Date.now();
      await pool.query('SELECT 1');
      console.log(`🔥 Pool warmed in ${Date.now() - t0}ms`);
    } catch (e) {
      console.warn('Pool warmup failed (will retry on first request):', e.message);
    }
  }

  // ── Background cache pre-warm (Plan A bonus) ─────────────────────
  // Refresh /api/data payload BEFORE its TTL expires so every user
  // request always hits a warm cache. Without this, the very first
  // user after each cache window pays the full ~500ms-2s "build payload"
  // cost. With this, the cache is continuously kept fresh.
  //
  // Set CACHE_PREWARM=0 to disable. Pre-warm runs every 25s (well
  // inside the 60s TTL); dcache.getOrBuild's own singleflight prevents
  // duplicate builds when the prewarm tick and a real request collide.
  if (process.env.CACHE_PREWARM !== '0') {
    const PREWARM_MS = 25_000;
    setInterval(async () => {
      try {
        const t0 = Date.now();
        // Force a fresh build by invalidating first, then re-populating.
        // This keeps Redis (L2) warm for other instances too — every dyno
        // benefits from any one prewarm tick. With Redis active and N
        // dynos prewarming, in steady state only ONE rebuild per ~25s
        // hits Postgres; the rest serve from L2.
        await dcache.invalidate(CACHE_KEY_DATA);
        await dcache.getOrBuild(CACHE_KEY_DATA, CACHE_TTL_DATA_SEC, _buildDataPayload);
        // Quiet log — only print every ~5 minutes
        if (Math.random() < 0.08) {
          console.log(`🔄 Cache prewarm: ${Date.now()-t0}ms (redis=${cache.isRedisReady()})`);
        }
      } catch (e) {
        console.warn('Cache prewarm failed:', e.message);
      }
    }, PREWARM_MS).unref(); // unref → don't keep process alive just for this
    console.log(`🔄 Cache prewarm scheduled every ${PREWARM_MS/1000}s`);
  }
});

// ── Graceful shutdown: close Redis + pg pool cleanly on SIGTERM ──
// Without this, Redis may leave dangling subscriptions and the next
// deploy of the same dyno can race the old connections.
async function shutdown(signal) {
  console.log(`\n${signal} received — shutting down`);
  try { await cache.closeRedis(); } catch (_) {}
  try { await pool.end();        } catch (_) {}
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));