/**
 * importLibraries.js — Load product.xlsx + company.xlsx into the DB.
 *
 * Treats the two Excel files as the canonical libraries:
 *   - product.xlsx   → upserts into `products` table (HS code, sort order)
 *   - company.xlsx   → upserts into `company_directory` table (full name → code)
 *                       + back-fills `companies.full_name` for any matching code
 *
 * Run:
 *   node importLibraries.js                                  # default paths
 *   node importLibraries.js ./product.xlsx ./company.xlsx    # custom paths
 *   PRODUCT_XLSX=/p/product.xlsx COMPANY_XLSX=/p/company.xlsx \
 *     npm run import-libraries
 *
 * Idempotent: ON CONFLICT updates instead of duplicating. Safe to re-run
 * after editing either file.
 */
const fs   = require('fs');
const path = require('path');
// Walk up from this file's directory looking for .env so the script
// works correctly when run from inside a git worktree (where the .env
// lives at the main project root, several levels up).
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
const XLSX = require('xlsx');
const { Pool } = require('pg');

const PRODUCT_XLSX = process.argv[2] || process.env.PRODUCT_XLSX || path.join(__dirname, 'product.xlsx');
const COMPANY_XLSX = process.argv[3] || process.env.COMPANY_XLSX || path.join(__dirname, 'company.xlsx');

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

function readSheet(filepath) {
  if (!fs.existsSync(filepath)) {
    throw new Error(`File not found: ${filepath}`);
  }
  const wb = XLSX.readFile(filepath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { defval: '' });
}

async function importProducts(client) {
  console.log(`📦 Loading products from ${PRODUCT_XLSX}`);
  const rows = readSheet(PRODUCT_XLSX);
  // Expected columns: "Product ID", "HS Code", "Product Name"
  let upserted = 0;
  for (const r of rows) {
    const id   = Number(r['Product ID'] || r['ID'] || 0) || null;
    const hs   = String(r['HS Code'] || '').trim();
    const name = String(r['Product Name'] || '').trim();
    if (!name) continue;
    await client.query(
      `INSERT INTO products (name, hs_code, sort_order, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (name) DO UPDATE SET
         hs_code    = EXCLUDED.hs_code,
         sort_order = COALESCE(NULLIF(EXCLUDED.sort_order,0), products.sort_order),
         updated_at = NOW()`,
      [name, hs, id]
    );
    upserted++;
  }
  console.log(`   ✓ Upserted ${upserted} product rows`);
  return upserted;
}

async function importCompanyDirectory(client) {
  console.log(`🏢 Loading companies from ${COMPANY_XLSX}`);
  const rows = readSheet(COMPANY_XLSX);
  // Expected columns: "Company ID", "Company Name", "Abbreviation"
  let upserted = 0, backfilled = 0, missing = [];
  for (const r of rows) {
    const id   = Number(r['Company ID'] || r['ID'] || 0) || null;
    const name = String(r['Company Name'] || '').trim();
    const abbr = String(r['Abbreviation'] || '').trim().toUpperCase();
    if (!name || !abbr) continue;
    await client.query(
      `INSERT INTO company_directory (full_name, abbreviation, sort_order, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (full_name) DO UPDATE SET
         abbreviation = EXCLUDED.abbreviation,
         sort_order   = COALESCE(NULLIF(EXCLUDED.sort_order,0), company_directory.sort_order),
         updated_at   = NOW()`,
      [name, abbr, id]
    );
    upserted++;

    // Back-fill companies.full_name for the matching code, if it exists.
    const upd = await client.query(
      `UPDATE companies SET full_name = $1
       WHERE code = $2 AND (full_name IS NULL OR full_name = '')`,
      [name, abbr]
    );
    if (upd.rowCount) backfilled += upd.rowCount;
    else {
      // Track which abbreviations from the directory don't have a company row yet
      const { rowCount } = await client.query(`SELECT 1 FROM companies WHERE code = $1`, [abbr]);
      if (!rowCount) missing.push(abbr);
    }
  }
  console.log(`   ✓ Upserted ${upserted} directory rows`);
  if (backfilled) console.log(`   ✓ Back-filled full_name on ${backfilled} existing companies`);
  if (missing.length) {
    console.log(`   ℹ  Directory entries without a corresponding companies row (${missing.length}): ${missing.join(', ')}`);
    console.log(`     These are valid library entries; they'll get a companies row once an SPI/PENDING is added for them.`);
  }
  return upserted;
}

// Idempotently ensure the tables exist before we touch them. Mirrors
// the schema in schema.sql + the auto-migration in server.js — kept in
// sync deliberately so this script works even when run before the
// server has booted for the first time.
async function ensureSchema(client) {
  await client.query(`
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
  await client.query(`
    CREATE TABLE IF NOT EXISTS company_directory (
      full_name     TEXT PRIMARY KEY,
      abbreviation  TEXT NOT NULL,
      sort_order    INT  DEFAULT 0,
      created_at    TIMESTAMPTZ DEFAULT NOW(),
      updated_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  // Add full_name column to companies if missing (older deployments)
  await client.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS full_name TEXT DEFAULT ''`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_company_dir_abbr ON company_directory(abbreviation)`);
}

async function main() {
  const client = await pool.connect();
  try {
    await ensureSchema(client);
    await client.query('BEGIN');
    await importProducts(client);
    await importCompanyDirectory(client);
    await client.query('COMMIT');
    console.log('\n✅ Library import complete.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n❌ Library import failed — rolled back:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
