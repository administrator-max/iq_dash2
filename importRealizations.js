/**
 * importRealizations.js — Bulk-load PIB realization Excel files into the
 * `realizations` table. Treats the Excel files as the source of truth.
 *
 * Run:
 *   node importRealizations.js                   # uses ./Realization_Exports/
 *   node importRealizations.js /path/to/dir      # custom directory of .xlsx
 *   REALIZ_DIR=./snapshot npm run import-realizations
 *
 * The directory must contain extracted .xlsx files. ZIPs are not unpacked
 * by this script — extract the ZIP first.
 *
 * Idempotent: the realizations table has a UNIQUE(company_code, pib_no, line_no)
 * constraint, so re-running updates existing rows rather than duplicating.
 *
 * Dependency: `npm install` (adds the `xlsx` package — already in package.json).
 */
const fs   = require('fs');
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
const XLSX = require('xlsx');
const { Pool } = require('pg');

const DEFAULT_DIR = path.join(__dirname, 'Realization_Exports');
const SRC_DIR = process.argv[2] || process.env.REALIZ_DIR || DEFAULT_DIR;

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

// Loaded from the company_directory table at runtime (sourced from
// company.xlsx via importLibraries.js). No hardcoded fallback — if the
// directory is empty, run `npm run import-libraries` first.
let NAME_TO_CODE = {};

// PIB Excel header → DB column. Headers are Indonesian customs format.
const HEADER_MAP = {
  'No':                  'line_no',
  'Uraian Barang':       'description',
  'Pos Tarif/HS 10 Digit': 'hs_code',
  'Volume':              'volume',
  'Satuan':              'unit',
  'Nilai':               'value_usd',
  'Hrg. Satuan':         'unit_price',
  'Kurs':                'kurs',
  'Negara Asal':         'country_origin',
  'Pelabuhan Tujuan':    'port_destination',
  'No. L/S':             'ls_no',
  'Tgl. L/S':            'ls_date',
  'No. PIB':             'pib_no',
  'Tgl. PIB':            'pib_date',
  'No. Invoice':         'invoice_no',
  'Tgl. Invoice':        'invoice_date',
  'Pelabuhan Muat':      'port_loading',
  'No Pengajuan':        'pengajuan_no',
  'Tanggal Pengajuan':   'pengajuan_date',
};
const NUMERIC_FIELDS = new Set(['line_no','volume','value_usd','unit_price','kurs']);

function num(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

function codeFromFilename(filename) {
  // "Cakra Garuda Kontan-103908.xlsx" → "Cakra Garuda Kontan"
  const base = filename.replace(/\.xlsx?$/i, '').replace(/-\d+$/, '').trim().toLowerCase();
  return NAME_TO_CODE[base] || null;
}

function dateFromExcel(v) {
  // SheetJS dates may come in as Date objects, ISO strings, or serial numbers
  if (v == null || v === '') return '';
  if (v instanceof Date) {
    const y = v.getUTCFullYear();
    const m = String(v.getUTCMonth() + 1).padStart(2, '0');
    const d = String(v.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(v);
}

function parseSheet(filepath) {
  const wb = XLSX.readFile(filepath, { cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true });
  if (!aoa.length) return [];
  const headers = aoa[0].map(h => String(h).trim());
  const rows = [];
  for (let i = 1; i < aoa.length; i++) {
    const r = aoa[i];
    if (!r || r.every(v => v === '' || v == null)) continue;
    const obj = {};
    headers.forEach((h, idx) => {
      const dbCol = HEADER_MAP[h];
      if (!dbCol) return;
      let val = r[idx];
      if (NUMERIC_FIELDS.has(dbCol)) val = num(val);
      else if (val instanceof Date) val = dateFromExcel(val);
      else val = val == null ? '' : String(val);
      obj[dbCol] = val;
    });
    rows.push(obj);
  }
  return rows;
}

async function loadHsToProduct(client) {
  const { rows } = await client.query(`SELECT name, hs_code FROM products WHERE hs_code <> ''`);
  const map = {};
  rows.forEach(r => { map[r.hs_code] = r.name; });
  return map;
}

async function loadNameToCode(client) {
  const { rows } = await client.query(`SELECT full_name, abbreviation FROM company_directory`);
  const map = {};
  rows.forEach(r => { if (r.full_name && r.abbreviation) map[r.full_name.toLowerCase()] = r.abbreviation; });
  return map;
}

async function importAll() {
  if (!fs.existsSync(SRC_DIR)) {
    throw new Error(`Source directory not found: ${SRC_DIR}\n\nExtract the ZIP first, then point this script at the extracted folder:\n  unzip "Realization_Exports_2026-04-27.zip" -d ./Realization_Exports\n  npm run import-realizations`);
  }
  const files = fs.readdirSync(SRC_DIR).filter(f => /\.xlsx?$/i.test(f));
  if (!files.length) {
    throw new Error(`No .xlsx files in ${SRC_DIR}`);
  }

  console.log(`📂 Source: ${SRC_DIR}`);
  console.log(`📄 Found ${files.length} Excel files\n`);

  const client = await pool.connect();
  try {
    const hsToProd = await loadHsToProduct(client);
    if (!Object.keys(hsToProd).length) {
      console.warn('⚠  products table is empty — products will be left NULL on imported rows.');
      console.warn('   Restart the server first to seed products, then re-run this import.\n');
    }
    NAME_TO_CODE = await loadNameToCode(client);
    if (!Object.keys(NAME_TO_CODE).length) {
      console.warn('⚠  company_directory is empty — filenames cannot be mapped to codes.');
      console.warn('   Run `npm run import-libraries` first to load company.xlsx, then re-run this script.\n');
    }

    await client.query('BEGIN');

    const summary = { files: 0, rows: 0, skippedFiles: 0, unknownCompanies: [] };
    for (const f of files) {
      const code = codeFromFilename(f);
      if (!code) {
        console.warn(`⏭  SKIP ${f} — cannot map filename to a company code`);
        summary.skippedFiles++;
        summary.unknownCompanies.push(f);
        continue;
      }
      // Verify the company exists
      const { rowCount } = await client.query(`SELECT 1 FROM companies WHERE code = $1`, [code]);
      if (!rowCount) {
        console.warn(`⏭  SKIP ${f} — company code ${code} not in companies table`);
        summary.skippedFiles++;
        continue;
      }

      const rows = parseSheet(path.join(SRC_DIR, f));
      if (!rows.length) {
        console.warn(`⏭  SKIP ${f} — no data rows`);
        summary.skippedFiles++;
        continue;
      }

      let inserted = 0;
      for (const r of rows) {
        // Resolve product from HS code if available
        const product = r.hs_code ? (hsToProd[r.hs_code] || null) : null;
        await client.query(
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
             imported_by=EXCLUDED.imported_by, updated_at=NOW()`,
          [
            code, product, r.line_no || 1, r.description || '', r.hs_code || '',
            r.volume, r.unit || 'TNE', r.value_usd, r.unit_price, r.kurs,
            r.country_origin || '', r.port_destination || '', r.port_loading || '',
            r.ls_no || '', r.ls_date || '', r.pib_no || '', r.pib_date || '',
            r.invoice_no || '', r.invoice_date || '', r.pengajuan_no || '',
            r.pengajuan_date || '', 'excel', f, 'BulkImport',
          ]
        );
        inserted++;
      }
      console.log(`✅ ${f.padEnd(46)} → ${code}: ${inserted} rows`);
      summary.files++;
      summary.rows += inserted;
    }

    await client.query('COMMIT');

    console.log(`\n📊 Summary`);
    console.log(`   Files imported:     ${summary.files}`);
    console.log(`   Rows inserted:      ${summary.rows}`);
    if (summary.skippedFiles) console.log(`   Files skipped:      ${summary.skippedFiles}`);
    if (summary.unknownCompanies.length) {
      console.log(`\n   Unmapped filenames (add to NAME_TO_CODE if these are real companies):`);
      summary.unknownCompanies.forEach(f => console.log(`     - ${f}`));
    }
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
