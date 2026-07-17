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

const SHEET_ID = process.env.SHEETS_DB_ID || '1t4MbpWLaQIe_NfMjb38gMtNTm27WPXLwpUq0THGMYd0';
const TTL_MS   = (Number(process.env.SHEETS_TTL_SEC) || 30) * 1000;

// Tabs that mirror DB tables (header = column names).
const TABLES = [
  'companies','company_directory','products','product_aliases','company_products',
  'company_product_stats','cycles','cycle_products','revision_changes',
  'company_shipments','company_reapply_targets','ra_records','pending_meta',
  'realizations','status_history','utilization_lots',
  'pertek_perubahan_release',
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
// Repair JSON whose string values (typically private_key) contain RAW newlines
// — escape control chars only inside double-quoted regions, leaving structural
// whitespace intact. Common when a multi-line PEM is pasted into a config var.
function repairJsonNewlines(s) {
  let inStr = false, esc = false, out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (esc) { out += ch; esc = false; continue; }
    if (ch === '\\') { out += ch; esc = true; continue; }
    if (ch === '"') { inStr = !inStr; out += ch; continue; }
    if (inStr && ch === '\n') { out += '\\n'; continue; }
    if (inStr && ch === '\r') { out += '\\r'; continue; }
    if (inStr && ch === '\t') { out += '\\t'; continue; }
    out += ch;
  }
  return out;
}
function parseCreds(raw) {
  raw = raw.trim().replace(/^['"]|['"]$/g, ''); // strip stray wrapping quotes
  const tries = [
    () => JSON.parse(raw),                                            // raw JSON
    () => JSON.parse(Buffer.from(raw, 'base64').toString('utf8')),    // base64 JSON
    () => JSON.parse(repairJsonNewlines(raw)),                        // JSON w/ raw newlines
    () => JSON.parse(repairJsonNewlines(Buffer.from(raw, 'base64').toString('utf8'))), // base64 → repair
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
  // Precedence: SHEETS_SA_B64 (base64 — most robust on Heroku) → SHEETS_SA_JSON
  // → GOOGLE_SERVICE_ACCOUNT_JSON / GOOGLE_SA_JSON → committed key file.
  const b64 = (process.env.SHEETS_SA_B64 || '').trim();
  const raw = b64
    ? Buffer.from(b64, 'base64').toString('utf8')
    : (process.env.SHEETS_SA_JSON || process.env.GOOGLE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_SA_JSON);
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
const _headerCache = {}; // tab -> header[] (headers never change; cached to avoid extra reads)

// Retry on Google Sheets rate-limit (429) / transient errors with exponential
// backoff + jitter. The "Write requests per minute per user" limit is 60; a
// burst of saves can trip it, so we wait it out instead of failing the user.
async function withRetry(fn, label = 'sheets') {
  const max = 6;
  let delay = 1100;
  for (let attempt = 1; ; attempt++) {
    try { return await fn(); }
    catch (e) {
      const code = e && (e.code || (e.response && e.response.status));
      const retriable = code === 429 || code === 503 || code === 500 ||
        /quota|rate limit|RESOURCE_EXHAUSTED/i.test(e && e.message || '');
      if (!retriable || attempt >= max) throw e;
      const wait = delay + Math.floor(Math.random() * 400);
      console.warn(`[sheets] ${label} ${code || ''} retry ${attempt}/${max - 1} in ${wait}ms`);
      await new Promise(r => setTimeout(r, wait));
      delay = Math.min(delay * 2, 16000);
    }
  }
}

async function load(force = false) {
  if (!force && _cache && (Date.now() - _loadedAt) < TTL_MS) return _cache;
  const sheets = await api();
  let tabs = TABLES;
  let res;
  try {
    res = await withRetry(() => sheets.spreadsheets.values.batchGet({
      spreadsheetId: SHEET_ID, ranges: tabs.map(t => `'${t}'!A1:BZ100000`),
    }), 'load');
  } catch (e) {
    // A registered tab may not physically exist yet (e.g. a newly-added tab
    // whose creation migration hasn't run). batchGet is all-or-nothing and
    // 400s on an unknown range, which would otherwise 500 the whole app.
    // Recover by reading only the tabs that actually exist; missing ones
    // resolve to [] below. Non-missing errors still propagate.
    // A missing/unparseable range returns HTTP 400. Any other status (403/404/etc.)
    // is a genuine error and must propagate — don't mask it behind tab-recovery.
    const status = e && (e.code || (e.response && e.response.status));
    if (status !== 400) throw e;
    const meta = await withRetry(() => sheets.spreadsheets.get({ spreadsheetId: SHEET_ID, fields: 'sheets.properties.title' }), 'load-meta');
    const existing = new Set((meta.data.sheets || []).map(s => s.properties.title));
    const missing = TABLES.filter(t => !existing.has(t));
    if (missing.length) console.warn(`[sheets] load: skipping missing tab(s): ${missing.join(', ')}`);
    tabs = TABLES.filter(t => existing.has(t));
    res = await withRetry(() => sheets.spreadsheets.values.batchGet({
      spreadsheetId: SHEET_ID, ranges: tabs.map(t => `'${t}'!A1:BZ100000`),
    }), 'load-retry');
  }
  const out = {};
  TABLES.forEach(t => { out[t] = []; }); // every registered tab defaults to []
  (res.data.valueRanges || []).forEach((vr, i) => {
    const tab = tabs[i];
    const rows = vr.values || [];
    const header = rows[0] || [];
    if (header.length) _headerCache[tab] = header;
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
  if (_headerCache[tab]) return _headerCache[tab];
  const sheets = await api();
  const res = await withRetry(() => sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `'${tab}'!A1:BZ1` }), 'header');
  const h = (res.data.values && res.data.values[0]) || [];
  if (h.length) _headerCache[tab] = h;
  return h;
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
  await withRetry(() => sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID, range: `'${tab}'!A1`,
    valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS',
    requestBody: { values },
  }), `append ${tab}`);
  bust();
}
/** Rewrite the entire data region of a tab from an array of row-objects. */
async function rewriteTable(tab, objs) {
  return batchRewrite({ [tab]: objs });
}
/**
 * Rewrite many tabs at once using the FEWEST API calls. WRITE-FIRST ordering:
 * we batchUpdate the new rows in place starting at A2, THEN batchClear only the
 * trailing region below them. This is the safety fix for the 2026-06-12
 * incident where the `companies` tab was emptied: the old order (clear → write)
 * left a tab blank whenever the write step failed (e.g. hit the 60/min write
 * quota) after the clear had already run. With write-first:
 *   - write fails  → withRetry throws BEFORE any clear → old data stays intact.
 *   - write ok     → trailing rows below the new data are cleared. A failed
 *                    trailing clear leaves recoverable stale rows, never an
 *                    empty tab.
 * An explicitly-empty array (e.g. delete-all) still clears the whole region —
 * but with no write step there is no clear-then-failed-write window to lose.
 * @param {Object<string, Array<Object>>} tablesObj  tab name -> row objects
 */
async function batchRewrite(tablesObj) {
  const names = Object.keys(tablesObj || {});
  if (!names.length) return;
  const sheets = await api();
  // Ensure headers are known (uses cache; at most one batchGet via load()).
  const missing = names.filter(n => !_headerCache[n]);
  if (missing.length) await load();
  const data = [];
  const clearRanges = [];
  for (const n of names) {
    const rows = tablesObj[n] || [];
    if (rows.length) {
      data.push({
        range: `'${n}'!A2`,
        values: rows.map(o => (_headerCache[n] || []).map(h => _toCell(o[h]))),
      });
    }
    // Clear only what sits BELOW the freshly written rows (whole region when empty).
    clearRanges.push(`'${n}'!A${rows.length + 2}:BZ100000`);
  }
  // 1) Write new rows first — if this throws, nothing has been cleared yet.
  if (data.length) {
    await withRetry(() => sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SHEET_ID, requestBody: { valueInputOption: 'RAW', data },
    }), 'batchUpdate');
  }
  // 2) Then drop any trailing leftover rows below the new data.
  await withRetry(() => sheets.spreadsheets.values.batchClear({ spreadsheetId: SHEET_ID, requestBody: { ranges: clearRanges } }), 'batchClear');
  bust();
}
/** Append an audit entry to Change_Log. Best-effort — never fails the caller. */
async function logChange(entry) {
  try {
    const sheets = await api();
    await withRetry(() => sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID, range: `'Change_Log'!A1`,
      valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [[
        new Date().toISOString(), entry.sheet || '', entry.record_id || '',
        entry.field || '', _toCell(entry.old_value), _toCell(entry.new_value),
        entry.changed_by || 'api', entry.note || '',
      ]] },
    }), 'logChange');
  } catch (e) {
    console.warn('[sheets] logChange skipped:', e.message);
  }
}

/** Append a request/access entry to Access_Log. Best-effort. */
async function logAccess(e) {
  try {
    const sheets = await api();
    await withRetry(() => sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID, range: `'Access_Log'!A1`,
      valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [[
        new Date().toISOString(), e.ip || '', e.actor || '',
        e.method || '', e.path || '', String(e.status || ''), String(e.ms || ''),
      ]] },
    }), 'logAccess');
  } catch (err) {
    console.warn('[sheets] logAccess skipped:', err.message);
  }
}

module.exports = {
  SHEET_ID, TABLES, load, bust, table, where, whereIn,
  appendRows, rewriteTable, batchRewrite, logChange, logAccess,
};
