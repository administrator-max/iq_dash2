/**
 * lib/sheetsStore.js — Google Sheets backing store for IQ Dash.
 *
 * Full-swap data source: when DATA_SOURCE=sheets, the app reads (and writes)
 * all quota data from a Google Spreadsheet instead of Neon PostgreSQL.
 *
 * Each tab mirrors a former Postgres table; the header row holds the exact
 * column names, so a row → object map is 1:1 with what `pool.query` returned.
 * Values are coerced: '' → null, 'TRUE'/'FALSE' → boolean, numerics stay as
 * strings (matching pg's NUMERIC-as-string behaviour, which the app already
 * handles via Number()).
 *
 * The whole sheet is loaded once and cached in memory (TTL); writes mutate the
 * sheet via the Sheets API and bust the cache so the next read reflects them.
 */
const fs   = require('fs');
const path = require('path');
const { google } = require('googleapis');

const SHEET_ID = process.env.SHEETS_DB_ID || '13CQrRUXhfB2Ceq8p7HXPhx2Fj31DSN3AwvtuNKpg08o';
const TTL_MS   = (Number(process.env.SHEETS_TTL_SEC) || 30) * 1000;

// Tabs that mirror DB tables (header = column names).
const TABLES = [
  'companies','company_directory','products','product_aliases','company_products',
  'company_product_stats','cycles','cycle_products','revision_changes',
  'company_shipments','company_reapply_targets','ra_records','pending_meta',
  'realizations','status_history','utilization_lots',
];

// ── service-account key resolution (walk up like server.js does for .env) ──
function resolveKeyFile() {
  if (process.env.GOOGLE_SA_KEYFILE && fs.existsSync(process.env.GOOGLE_SA_KEYFILE)) {
    return process.env.GOOGLE_SA_KEYFILE;
  }
  let dir = __dirname;
  while (dir !== path.dirname(dir)) {
    const p = path.join(dir, 'service-account.json');
    if (fs.existsSync(p)) return p;
    dir = path.dirname(dir);
  }
  throw new Error('sheetsStore: service-account.json not found (set GOOGLE_SA_KEYFILE)');
}

// Credential resolution order (Heroku-friendly):
//   1. GOOGLE_SERVICE_ACCOUNT_JSON / GOOGLE_SA_JSON env  → raw JSON (no file)
//   2. GOOGLE_SA_KEYFILE path, then service-account.json walked up the tree
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
// Accept the SA credential in any common config-var format:
// raw JSON, base64-encoded JSON, or a double-quoted/double-encoded JSON string.
function parseCreds(raw) {
  raw = raw.trim();
  const tries = [
    () => JSON.parse(raw),                                            // raw JSON
    () => JSON.parse(Buffer.from(raw, 'base64').toString('utf8')),    // base64 JSON
  ];
  for (const t of tries) {
    try {
      let v = t();
      if (typeof v === 'string') v = JSON.parse(v); // double-encoded ("{...}")
      if (v && typeof v === 'object' && (v.private_key || v.client_email)) return v;
    } catch (_) { /* try next */ }
  }
  throw new Error('sheetsStore: GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON or base64-encoded JSON');
}
function buildAuth() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_SA_JSON;
  if (raw && raw.trim()) {
    const creds = parseCreds(raw);
    // Heroku config vars often escape newlines in the private key.
    if (creds.private_key) creds.private_key = creds.private_key.replace(/\\n/g, '\n');
    return new google.auth.GoogleAuth({ credentials: creds, scopes: SCOPES });
  }
  return new google.auth.GoogleAuth({ keyFile: resolveKeyFile(), scopes: SCOPES });
}

let _sheets = null;
async function api() {
  if (_sheets) return _sheets;
  _sheets = google.sheets({ version: 'v4', auth: buildAuth() });
  return _sheets;
}

function coerce(v) {
  if (v === '' || v == null) return null;
  if (v === 'TRUE')  return true;
  if (v === 'FALSE') return false;
  return v;
}

let _cache = null;
let _loadedAt = 0;

async function load(force = false) {
  if (!force && _cache && (Date.now() - _loadedAt) < TTL_MS) return _cache;
  const sheets = await api();
  const ranges = TABLES.map(t => `'${t}'!A1:BZ100000`);
  const res = await sheets.spreadsheets.values.batchGet({ spreadsheetId: SHEET_ID, ranges });
  const out = {};
  (res.data.valueRanges || []).forEach((vr, i) => {
    const tab = TABLES[i];
    const rows = vr.values || [];
    const header = rows[0] || [];
    out[tab] = rows.slice(1).map(r => {
      const o = {};
      header.forEach((h, c) => { o[h] = coerce(r[c]); });
      return o;
    });
  });
  _cache = out;
  _loadedAt = Date.now();
  return _cache;
}

function bust() { _cache = null; _loadedAt = 0; }

// ── Read helpers ───────────────────────────────────────────────────────────
async function table(name) { return (await load())[name] || []; }
async function where(name, pred) { return (await table(name)).filter(pred); }
async function whereIn(name, col, vals) {
  const set = new Set(vals);
  return (await table(name)).filter(r => set.has(r[col]));
}

// ── Write helpers ──────────────────────────────────────────────────────────
async function _header(tab) {
  const sheets = await api();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `'${tab}'!A1:BZ1` });
  return (res.data.values && res.data.values[0]) || [];
}
function _toCell(v) {
  if (v == null) return '';
  if (v === true) return 'TRUE';
  if (v === false) return 'FALSE';
  if (v instanceof Date) return v.toISOString();
  return v;
}
async function appendRows(tab, objs) {
  if (!objs || !objs.length) return;
  const header = await _header(tab);
  const sheets = await api();
  const values = objs.map(o => header.map(h => _toCell(o[h])));
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID, range: `'${tab}'!A1`,
    valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS',
    requestBody: { values },
  });
  bust();
}
/** Rewrite the entire data region of a tab from an array of row-objects. */
async function rewriteTable(tab, objs) {
  const header = await _header(tab);
  const sheets = await api();
  await sheets.spreadsheets.values.batchClear({ spreadsheetId: SHEET_ID, ranges: [`'${tab}'!A2:BZ100000`] });
  if (objs.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID, range: `'${tab}'!A2`,
      valueInputOption: 'RAW',
      requestBody: { values: objs.map(o => header.map(h => _toCell(o[h]))) },
    });
  }
  bust();
}
/** Append an audit entry to Change_Log. */
async function logChange(entry) {
  const sheets = await api();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID, range: `'Change_Log'!A1`,
    valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [[
      new Date().toISOString(), entry.sheet || '', entry.record_id || '',
      entry.field || '', _toCell(entry.old_value), _toCell(entry.new_value),
      entry.changed_by || 'api', entry.note || '',
    ]] },
  });
}

module.exports = {
  SHEET_ID, TABLES, load, bust, table, where, whereIn,
  appendRows, rewriteTable, logChange,
};
