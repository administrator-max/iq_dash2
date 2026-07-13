# PERTEK Perubahan Release-Date Gate — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep a company's revised PERTEK product-split hidden from the dashboard until its PERTEK Perubahan release date is entered — showing the original PERTEK instead — starting with PT MIN (Wear Plate 600 MT, not GI Alloy 353 MT).

**Architecture:** A committed gate list (`lib/pendingRevisions.json`) declares each in-progress split (from-product, to-product, MT). A pure function (`lib/pendingRevisionGate.js`) reverses that split in the ledger-derived per-product maps inside `server.js` `applyLedger()`, restoring the original PERTEK. The reversal stops once a release date is recorded via a new Sheets-only endpoint into a new `pertek_perubahan_release` tab. No client math changes — the drill/charts read the already-adjusted maps.

**Tech Stack:** Node.js ≥18 (Express, `pg`, `googleapis`), Google Sheets store (`lib/sheetsStore.js`), built-in `node:test` for unit tests (no new dependency), vanilla-JS frontend (`public/js/*.js`).

## Global Constraints

- **Google Sheets = sole source of truth** (id `13CQrR…g08o`); never overwrite Sheets from xlsx. (`iq_dash/CLAUDE.md`)
- **Ledger (`lib/quotaLedger.json`) is the single source** for Obtained/Utilized/Available; the gate sits on top, it does not replace it. (`MEMORY.md` → `project_quota_ledger`)
- **Changelog mandatory:** every change → append to `logs/2026-07-13_log.md` (time, what, files/tabs, commit + Heroku version, reason, verification). (`iq_dash/CLAUDE.md`)
- **Sheets-only write endpoints:** follow the `record-obtained` precedent — return HTTP 501 when `!inSheets()`.
- **Ledger product names are canonical:** `"BORDES ALLOY"` (Wear Plate, HS 7225.40.90), `"GI ALLOY"` (HS 7225.92.90) — must match `quotaLedger.json.products` values exactly.
- **Deploy:** `git push heroku main` (remote `heroku` → iq-dash); GitHub remote is `origin`. Commit locally per task; push only when the user asks.
- **Tab-name rule:** a runtime-readable Sheets tab title must exactly equal its entry in `TABLES` (`lib/sheetsStore.js:24`). Use lowercase `pertek_perubahan_release`.

---

### Task 1: Pure reversal function `lib/pendingRevisionGate.js`

Self-contained, dependency-free, fully unit-tested. This is the core logic; everything else wires it in.

**Files:**
- Create: `lib/pendingRevisionGate.js`
- Test: `test/pendingRevisionGate.test.js`

**Interfaces:**
- Produces: `applyPendingRevision(maps, def, releaseDate) -> { reversed: boolean, reason?: string }` and `isReleased(releaseDate) -> boolean`.
  - `maps`: `{ obtByProd: {[name]:number}, utilByProd: {[name]:number}, availByProd: {[name]:number} }` — **mutated in place**.
  - `def`: `{ from: string, to: string, mt: number }` or `undefined`.
  - `releaseDate`: string. Empty / `'TBA'` (any case) ⇒ pending ⇒ reverse. A real date ⇒ released ⇒ no-op.

- [ ] **Step 1: Write the failing tests**

Create `test/pendingRevisionGate.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const { applyPendingRevision, isReleased } = require('../lib/pendingRevisionGate');

const MIN_DEF = { from: 'BORDES ALLOY', to: 'GI ALLOY', mt: 353 };
// MIN as it appears in the ledger: BORDES 247/247, GI ALLOY 353/0.
function minMaps() {
  return {
    obtByProd:   { 'BORDES ALLOY': 247, 'GI ALLOY': 353 },
    utilByProd:  { 'BORDES ALLOY': 247, 'GI ALLOY': 0 },
    availByProd: { 'BORDES ALLOY': 0,   'GI ALLOY': 353 },
  };
}

test('isReleased: empty / TBA is pending, a date is released', () => {
  assert.equal(isReleased(''), false);
  assert.equal(isReleased('   '), false);
  assert.equal(isReleased('TBA'), false);
  assert.equal(isReleased('tba'), false);
  assert.equal(isReleased('2026-07-13'), true);
  assert.equal(isReleased('13/07/2026'), true);
});

test('pending MIN: reverses GI ALLOY back into BORDES, restoring 600', () => {
  const m = minMaps();
  const res = applyPendingRevision(m, MIN_DEF, '');
  assert.equal(res.reversed, true);
  assert.deepEqual(m.obtByProd,   { 'BORDES ALLOY': 600 });
  assert.deepEqual(m.utilByProd,  { 'BORDES ALLOY': 247 });
  assert.deepEqual(m.availByProd, { 'BORDES ALLOY': 353 });
  assert.equal('GI ALLOY' in m.obtByProd, false);
});

test('released MIN: no reversal, split preserved', () => {
  const m = minMaps();
  const res = applyPendingRevision(m, MIN_DEF, '01/07/2026');
  assert.equal(res.reversed, false);
  assert.deepEqual(m.obtByProd, { 'BORDES ALLOY': 247, 'GI ALLOY': 353 });
});

test('no definition: no-op', () => {
  const m = minMaps();
  const res = applyPendingRevision(m, undefined, '');
  assert.equal(res.reversed, false);
  assert.deepEqual(m.obtByProd, { 'BORDES ALLOY': 247, 'GI ALLOY': 353 });
});

test('guard: "to" product missing from maps → skip', () => {
  const m = { obtByProd: { 'BORDES ALLOY': 247 }, utilByProd: { 'BORDES ALLOY': 247 }, availByProd: { 'BORDES ALLOY': 0 } };
  const res = applyPendingRevision(m, MIN_DEF, '');
  assert.equal(res.reversed, false);
  assert.equal(res.reason, 'to-missing');
});

test('guard: "to" already partly utilized → skip (data inconsistent)', () => {
  const m = minMaps();
  m.utilByProd['GI ALLOY'] = 10;
  const res = applyPendingRevision(m, MIN_DEF, '');
  assert.equal(res.reversed, false);
  assert.equal(res.reason, 'to-utilized');
});

test('guard: mt larger than "to" obtained → clamp to obtained', () => {
  const m = minMaps();
  const res = applyPendingRevision(m, { from: 'BORDES ALLOY', to: 'GI ALLOY', mt: 999 }, '');
  assert.equal(res.reversed, true);
  assert.deepEqual(m.obtByProd,   { 'BORDES ALLOY': 600 });
  assert.deepEqual(m.availByProd, { 'BORDES ALLOY': 353 });
  assert.equal('GI ALLOY' in m.obtByProd, false);
});

test('creates "from" bucket if it did not exist', () => {
  const m = { obtByProd: { 'GI ALLOY': 353 }, utilByProd: { 'GI ALLOY': 0 }, availByProd: { 'GI ALLOY': 353 } };
  const res = applyPendingRevision(m, MIN_DEF, '');
  assert.equal(res.reversed, true);
  assert.deepEqual(m.obtByProd,   { 'BORDES ALLOY': 353 });
  assert.deepEqual(m.availByProd, { 'BORDES ALLOY': 353 });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/pendingRevisionGate.test.js`
Expected: FAIL — `Cannot find module '../lib/pendingRevisionGate'`.

- [ ] **Step 3: Write the implementation**

Create `lib/pendingRevisionGate.js`:

```js
/**
 * lib/pendingRevisionGate.js
 *
 * PERTEK Perubahan gate. A company's PERTEK can be revised into a product
 * split (e.g. Wear Plate 600 → Wear Plate 247 + GI Alloy 353). The split is
 * only official once its PERTEK Perubahan release (terbit) date is entered.
 * Until then the dashboard must show the ORIGINAL PERTEK.
 *
 * The ledger (lib/quotaLedger.json) already bakes the split in as "effective".
 * This module REVERSES a not-yet-released split in the per-product maps that
 * server.js applyLedger() derives — moving `mt` from `to` back into `from` —
 * so the original product/quantity is shown. Pure + in-place; no I/O.
 */

// Empty string or "TBA" (any case) means the release date has NOT been entered.
function isReleased(releaseDate) {
  const d = String(releaseDate == null ? '' : releaseDate).trim();
  return d !== '' && !/^tba$/i.test(d);
}

/**
 * @param {{obtByProd:Object,utilByProd:Object,availByProd:Object}} maps mutated in place
 * @param {{from:string,to:string,mt:number}|undefined} def
 * @param {string} releaseDate
 * @returns {{reversed:boolean, reason?:string}}
 */
function applyPendingRevision(maps, def, releaseDate) {
  if (!def) return { reversed: false, reason: 'no-def' };
  if (isReleased(releaseDate)) return { reversed: false, reason: 'released' };

  const { obtByProd, utilByProd, availByProd } = maps;
  const from = def.from, to = def.to;

  // The "to" product must exist and be untouched (fully available) while pending.
  if (!(to in obtByProd)) return { reversed: false, reason: 'to-missing' };
  if ((Number(utilByProd[to]) || 0) > 0) return { reversed: false, reason: 'to-utilized' };

  const toObt = Number(obtByProd[to]) || 0;
  const mt = Math.min(Number(def.mt) || 0, toObt); // clamp: can't move more than exists
  if (mt <= 0) return { reversed: false, reason: 'zero-mt' };

  // Move `mt` from `to` back into `from` (obtained + available; util on `to` is 0).
  obtByProd[from]   = (Number(obtByProd[from])   || 0) + mt;
  availByProd[from] = (Number(availByProd[from]) || 0) + mt;
  if (!(from in utilByProd)) utilByProd[from] = 0;

  obtByProd[to]   = toObt - mt;
  availByProd[to] = (Number(availByProd[to]) || 0) - mt;
  if (obtByProd[to] <= 0) { delete obtByProd[to]; delete utilByProd[to]; delete availByProd[to]; }

  return { reversed: true };
}

module.exports = { applyPendingRevision, isReleased };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/pendingRevisionGate.test.js`
Expected: PASS — all 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/pendingRevisionGate.js test/pendingRevisionGate.test.js
git commit -m "feat(gate): pure PERTEK Perubahan split-reversal function + tests"
```

---

### Task 2: New Sheets tab `pertek_perubahan_release`

Creates the durable store for release dates and makes the runtime read it. The tab must physically exist and be registered in `TABLES` before any read/write produces columns.

**Files:**
- Modify: `lib/sheetsStore.js:24-29` (add the tab to `TABLES`)
- Create: `migration_work/add_pertek_perubahan_release_tab.js` (one-off tab creator)

**Interfaces:**
- Produces: a Sheets tab titled `pertek_perubahan_release` with header row `code | release_date | updated_at`, readable via `store.table('pertek_perubahan_release')` returning rows `{ code, release_date, updated_at }`.

- [ ] **Step 1: Register the tab in `TABLES`**

In `lib/sheetsStore.js`, add the tab name to the `TABLES` array (line 24-29). After edit it reads:

```js
const TABLES = [
  'companies','company_directory','products','product_aliases','company_products',
  'company_product_stats','cycles','cycle_products','revision_changes',
  'company_shipments','company_reapply_targets','ra_records','pending_meta',
  'realizations','status_history','utilization_lots',
  'pertek_perubahan_release',
];
```

- [ ] **Step 2: Write the migration script**

Create `migration_work/add_pertek_perubahan_release_tab.js` (modeled on `migration_work/addtabs.js`; run from the repo root, requires `service-account.json`):

```js
// One-off: create the `pertek_perubahan_release` tab (idempotent).
// Run: node migration_work/add_pertek_perubahan_release_tab.js
const { google } = require('googleapis');
const SID = '13CQrRUXhfB2Ceq8p7HXPhx2Fj31DSN3AwvtuNKpg08o';
const TAB = 'pertek_perubahan_release';
const HEAD = ['code', 'release_date', 'updated_at'];

(async () => {
  const auth = new google.auth.GoogleAuth({ keyFile: 'service-account.json', scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  const sheets = google.sheets({ version: 'v4', auth });

  let meta = await sheets.spreadsheets.get({ spreadsheetId: SID });
  const has = t => meta.data.sheets.some(s => s.properties.title === t);
  if (!has(TAB)) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: SID, requestBody: { requests: [{ addSheet: { properties: { title: TAB } } }] } });
    meta = await sheets.spreadsheets.get({ spreadsheetId: SID });
    console.log('created tab', TAB);
  } else {
    console.log('tab already exists', TAB);
  }
  const id = {}; meta.data.sheets.forEach(s => id[s.properties.title] = s.properties.sheetId);

  // Header row (RAW; overwrites row 1 only).
  await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: SID, requestBody: { valueInputOption: 'RAW', data: [{ range: TAB + '!A1', values: [HEAD] }] } });

  // Freeze + bold header + company-code FK validation, matching addtabs.js style.
  await sheets.spreadsheets.batchUpdate({ spreadsheetId: SID, requestBody: { requests: [
    { updateSheetProperties: { properties: { sheetId: id[TAB], gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' } },
    { repeatCell: { range: { sheetId: id[TAB], startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { backgroundColor: { red: 0.12, green: 0.29, blue: 0.49 }, textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } } } }, fields: 'userEnteredFormat(backgroundColor,textFormat)' } },
    { setDataValidation: { range: { sheetId: id[TAB], startRowIndex: 1, endRowIndex: 2000, startColumnIndex: 0, endColumnIndex: 1 }, rule: { condition: { type: 'ONE_OF_RANGE', values: [{ userEnteredValue: '=Companies!$B$2:$B$1000' }] }, showCustomUi: true, strict: false } } },
  ] } });

  console.log('header + formatting applied. DONE.');
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
```

- [ ] **Step 3: Run the migration against the live Sheet**

Run: `node migration_work/add_pertek_perubahan_release_tab.js`
Expected: prints `created tab pertek_perubahan_release` (or `tab already exists …`) then `header + formatting applied. DONE.` Verify in the browser that the tab exists with header `code | release_date | updated_at`.

> If `service-account.json` is not present locally, this step is run wherever the SA key lives (same place `addtabs.js` was run). The tab must exist before Task 4's endpoint can write to it.

- [ ] **Step 4: Commit**

```bash
git add lib/sheetsStore.js migration_work/add_pertek_perubahan_release_tab.js
git commit -m "feat(store): register pertek_perubahan_release tab + creation script"
```

---

### Task 3: Wire the gate into `server.js` `applyLedger()` + seed list + released map

Loads the committed gate list, reads recorded release dates, and reverses pending splits during the data build. After this task the dashboard shows MIN as Wear Plate 600 (no GI Alloy) locally.

**Files:**
- Create: `lib/pendingRevisions.json`
- Modify: `server.js` — requires near line 89; `releasedMap` build + `applyLedger` body in the ledger block (lines ~1188-1232)

**Interfaces:**
- Consumes: `applyPendingRevision` from Task 1; `store.table('pertek_perubahan_release')` from Task 2.
- Produces: on each company object, adjusted `utilizationByProd` / `availableByProd` / `_ledgerObtainedByProd` / `_ledgerObtained` / `obtained` / `availableQuota`, plus `co._pendingRevision = { from, to, mt, origMT }` when a split is currently reversed (used by Task 5's UI).

- [ ] **Step 1: Create the seed gate list**

Create `lib/pendingRevisions.json`:

```json
{
  "MIN": { "from": "BORDES ALLOY", "to": "GI ALLOY", "mt": 353 }
}
```

- [ ] **Step 2: Require the gate + seed list in server.js**

In `server.js`, next to the existing `QUOTA_LEDGER` require (~line 89-92), add:

```js
const { applyPendingRevision } = require('./lib/pendingRevisionGate');
let PENDING_REVISIONS = {};
try { PENDING_REVISIONS = require('./lib/pendingRevisions.json'); } catch (_) { PENDING_REVISIONS = {}; }
```

- [ ] **Step 3: Build the released-date map before the ledger block**

In `server.js` `_buildDataPayload`, immediately BEFORE the line `if (QUOTA_LEDGER && QUOTA_LEDGER.companies) {` (~line 1196), insert:

```js
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
```

- [ ] **Step 4: Apply the gate inside `applyLedger`**

Replace the `applyLedger` function body (`server.js` ~1199-1232) with the version below. The change: build the per-product maps first, run the gate, THEN compute company totals from the (possibly adjusted) maps.

```js
    const applyLedger = (co, ent) => {
      const utilByProd = {}, availByProd = {}, obtByProd = {};
      const ships = co.shipments || {};
      for (const [hs, v] of Object.entries(ent)) {
        const name = hsName[hs] || hs;
        const o = Number(v.obtained) || 0;
        const ledgerU = Number(v.util) || 0;
        // effective util = ledgerUtil + Σlot.utilMT, capped at obtained (see 2026-07-01 note).
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
```

- [ ] **Step 5: Start the server and verify MIN is reversed locally**

Run (local dev uses Postgres seed; `releasedMap` is empty so MIN stays gated):

```bash
npm run seed   # if the local DB isn't already seeded
npm start
```

Then in a second shell:

```bash
curl -s http://localhost:3000/api/data | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);const m=(j.spi||[]).find(c=>c.code==='MIN');console.log('MIN obtainedByProd:',m&&m._ledgerObtainedByProd);console.log('MIN pendingRevision:',m&&m._pendingRevision);})"
```

Expected output:
```
MIN obtainedByProd: { 'BORDES ALLOY': 600 }
MIN pendingRevision: { from: 'BORDES ALLOY', to: 'GI ALLOY', mt: 353, origMT: 600 }
```
(No `GI ALLOY` key for MIN.) If the server runs on a port other than 3000, use `$PORT`.

- [ ] **Step 6: Commit**

```bash
git add lib/pendingRevisions.json server.js
git commit -m "feat(ledger): gate pending PERTEK Perubahan splits; MIN shows original Wear Plate"
```

---

### Task 4: POST endpoint to record the release date

Lets the dashboard record a PERTEK Perubahan release date, which un-gates that company's split on the next data build.

**Files:**
- Modify: `server.js` — add the route next to `record-obtained` (~after line 2017)

**Interfaces:**
- Consumes: `store.table('pertek_perubahan_release')` (Task 2), `store.batchRewrite`, `store.logChange`, `dcache.invalidate`, `CACHE_KEY_DATA`, `inSheets`.
- Produces: `POST /api/company/:code/pertek-perubahan-release` accepting `{ releaseDate: string, updatedBy?: string }`, upserting one row per `code`; returns `{ ok:true, code, releaseDate }`.

- [ ] **Step 1: Write the endpoint**

In `server.js`, immediately after the `record-obtained` handler ends (`});` at ~line 2017), add:

```js
// ═══════════════════════════════════════════════════════════════════
// POST /api/company/:code/pertek-perubahan-release
// Record the PERTEK Perubahan release (terbit) date for a company whose
// product split is currently gated (see lib/pendingRevisions.json). Once a
// date is stored, applyLedger stops reversing the split and the revised
// products show. Upsert (one row per code). Sheets-only. Body: { releaseDate }.
// ═══════════════════════════════════════════════════════════════════
app.post('/api/company/:code/pertek-perubahan-release', async (req, res) => {
  const { code } = req.params;
  const releaseDate = String((req.body || {}).releaseDate || '').trim();
  if (!releaseDate) return res.status(400).json({ error: 'releaseDate required' });
  if (!inSheets()) return res.status(501).json({ error: 'pertek-perubahan-release is Sheets-only' });
  try {
    const nowISO = new Date().toISOString();
    const rows = (await store.table('pertek_perubahan_release')).slice();
    let row = rows.find(r => String(r.code || '').trim() === code);
    const old = row ? String(row.release_date || '') : '';
    if (row) { row.release_date = releaseDate; row.updated_at = nowISO; }
    else { row = { code, release_date: releaseDate, updated_at: nowISO }; rows.push(row); }
    await store.batchRewrite({ pertek_perubahan_release: rows });
    await store.logChange({ sheet: 'pertek_perubahan_release', record_id: code, field: 'release_date',
      old_value: old, new_value: releaseDate, changed_by: (req.body || {}).updatedBy || 'api',
      note: 'PERTEK Perubahan terbit → un-gate split' });
    await dcache.invalidate(CACHE_KEY_DATA);
    return res.json({ ok: true, code, releaseDate });
  } catch (err) {
    console.error('pertek-perubahan-release error:', err);
    return res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 2: Verify the route is wired (non-Sheets guard)**

Local dev (Postgres) should return 501, proving the route exists and the guard works:

```bash
curl -s -X POST http://localhost:3000/api/company/MIN/pertek-perubahan-release \
  -H 'Content-Type: application/json' -d '{"releaseDate":"01/07/2026"}'
```
Expected: `{"error":"pertek-perubahan-release is Sheets-only"}` with HTTP 501.

> The Sheets round-trip (persist → un-gate) is validated in Task 6's manual verification against the deployed Sheets-backed app.

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "feat(api): POST pertek-perubahan-release to un-gate a split (Sheets-only)"
```

---

### Task 5: Dashboard UI to enter the release date

Surfaces a banner + date input for a gated company in the revision panel, calling Task 4's endpoint.

**Files:**
- Modify: `public/js/13-rev-mgmt.js` (revision panel render + a save handler)

**Interfaces:**
- Consumes: `co._pendingRevision = { from, to, mt, origMT }` from Task 3; `POST /api/company/:code/pertek-perubahan-release` from Task 4.
- Produces: a "Tanggal Terbit PERTEK Perubahan" control that persists a date then refreshes data.

- [ ] **Step 1: Locate the revision-panel render**

Open `public/js/13-rev-mgmt.js` and find where a single company's revision detail is rendered (the block that already shows revision status text such as `revStatus` / "Menunggu PERTEK Perubahan"). Identify the container variable used to build that panel's HTML (e.g. an `html`/`parts` string that is later injected into a panel element). Note the existing helper used to POST/patch and the existing data-refresh call (e.g. `loadData()` / `refresh()` used elsewhere in the file).

- [ ] **Step 2: Add the gated-company banner + input to the panel HTML**

Where the panel HTML for a company `co` is assembled, add this block (adjust the container variable name to match the file):

```js
// PERTEK Perubahan gate — show original PERTEK + let operator enter terbit date.
if (co._pendingRevision) {
  const pr = co._pendingRevision;
  html += `
    <div class="pp-gate" style="margin-top:10px;padding:10px;border:1px solid #d9a441;background:#fff8e6;border-radius:6px">
      <div style="font-weight:600;color:#8a5a00">PERTEK Perubahan belum terbit</div>
      <div style="font-size:12px;color:#555;margin:4px 0">
        Menampilkan PERTEK asal: <b>${pr.from} ${pr.origMT} MT</b>.
        Split ke <b>${pr.to} ${pr.mt} MT</b> akan tampil setelah tanggal terbit diisi.
      </div>
      <label style="font-size:12px">Tanggal Terbit PERTEK Perubahan
        <input type="text" id="ppReleaseDate_${co.code}" placeholder="DD/MM/YYYY" style="margin-left:6px">
      </label>
      <button id="ppReleaseSave_${co.code}" style="margin-left:6px">Simpan</button>
    </div>`;
}
```

- [ ] **Step 3: Wire the save button after the panel is inserted into the DOM**

In the same function, after the panel HTML is injected (where other buttons in this panel get their listeners), add:

```js
if (co._pendingRevision) {
  const btn = document.getElementById('ppReleaseSave_' + co.code);
  if (btn) btn.addEventListener('click', async () => {
    const input = document.getElementById('ppReleaseDate_' + co.code);
    const releaseDate = (input && input.value || '').trim();
    if (!releaseDate) { alert('Isi Tanggal Terbit PERTEK Perubahan dulu.'); return; }
    btn.disabled = true; btn.textContent = 'Menyimpan…';
    try {
      const r = await fetch('/api/company/' + encodeURIComponent(co.code) + '/pertek-perubahan-release', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ releaseDate }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
      alert('Tersimpan. Split ' + co._pendingRevision.to + ' akan tampil setelah data refresh.');
      location.reload();
    } catch (e) {
      alert('Gagal menyimpan: ' + e.message);
      btn.disabled = false; btn.textContent = 'Simpan';
    }
  });
}
```

> `location.reload()` is the simplest correct refresh (the server already invalidated the cache). If the file has an in-place `loadData()`/`refresh()` used by sibling handlers, prefer calling that instead of reloading.

- [ ] **Step 4: Manual smoke check (rendering only, local)**

Run `npm start`, open the dashboard, navigate to MIN's revision panel. Expected: the amber "PERTEK Perubahan belum terbit" banner appears with "PERTEK asal: BORDES ALLOY 600 MT". (Saving is exercised against the Sheets-backed deploy in Task 6, since local dev returns 501.)

- [ ] **Step 5: Commit**

```bash
git add public/js/13-rev-mgmt.js
git commit -m "feat(ui): gated-company banner + PERTEK Perubahan terbit-date input"
```

---

### Task 6: Deploy, verify end-to-end, changelog + memory

Ships the change and confirms the real behavior on the Sheets-backed production app.

**Files:**
- Create: `migration_work/add_pertek_perubahan_release_tab.js` already run (Task 2, Step 3 — confirm the tab exists in production Sheet)
- Create/append: `logs/2026-07-13_log.md`
- Modify: `MEMORY.md` and add a memory file (see below)

- [ ] **Step 1: Confirm the production Sheet has the tab**

Verify (browser or a quick `store.table` read on prod) that `pertek_perubahan_release` exists with header `code | release_date | updated_at`. If not, run `node migration_work/add_pertek_perubahan_release_tab.js` in the environment holding `service-account.json`.

- [ ] **Step 2: Deploy to Heroku**

```bash
git push heroku main
```
Note the released version (e.g. `heroku releases -n 1`).

- [ ] **Step 3: Verify GI Alloy no longer counts MIN (production)**

Open the deployed dashboard → Available Quota → GI Alloy. Expected:
- MIN is **absent** from the GI Alloy breakdown.
- GI Alloy header totals are **353 MT lower** than before (Obtained 9,904 → 9,551; Available 5,052 → 4,699).
- MIN now appears under **Wear Plate / BORDES ALLOY at 600 MT** (Obt 600, Used 247, Avail 353).

- [ ] **Step 4: Verify entering the release date un-gates the split (production)**

On MIN's revision panel, enter a Tanggal Terbit (e.g. today) and Simpan. After reload, expected:
- MIN reappears under GI Alloy at 353 MT (Obt 353, Used 0).
- MIN's BORDES ALLOY returns to 247 MT.
- GI Alloy totals return to their prior values.

Then, to leave production in the intended "still pending" state for MIN (unless it is genuinely terbit), **remove the test date**: clear MIN's row in the `pertek_perubahan_release` tab (or POST is not reversible via UI — delete the cell in the Sheet) and reload; confirm MIN is gated again.

- [ ] **Step 5: Write the changelog entry**

Append to `logs/2026-07-13_log.md` (create if absent) an entry per `CLAUDE.md`:

```markdown
## HH:MM WIB — PERTEK Perubahan release-date gate (MIN → Wear Plate, not GI Alloy)
- **Ubah:** Menambahkan gate: split PERTEK Perubahan yang belum terbit di-reverse
  ke PERTEK asal sampai tanggal terbit diisi. Seed: MIN (BORDES ALLOY ← GI ALLOY 353).
- **File/Tab:** lib/pendingRevisionGate.js (baru), lib/pendingRevisions.json (baru),
  server.js (applyLedger + releasedMap + endpoint), lib/sheetsStore.js (TABLES),
  public/js/13-rev-mgmt.js (UI), tab Sheets baru: pertek_perubahan_release.
- **Commit/Deploy:** <hash> · Heroku vNN
- **Alasan:** MIN masih proses perubahan PERTEK (Wear Plate 600 → 246.8 + GI Alloy 353.2);
  dashboard tidak boleh menghitung GI Alloy sebelum PERTEK Perubahan terbit. Berlaku umum.
- **Verifikasi:** node --test hijau; /api/data MIN _ledgerObtainedByProd = {BORDES ALLOY:600};
  drill GI Alloy tanpa MIN, total −353; setelah isi tanggal terbit split muncul lagi.
```

- [ ] **Step 6: Update memory**

Create `memory/project_pertek_perubahan_gate.md` (frontmatter: `type: project`) describing: the gate reverses not-yet-released PERTEK Perubahan splits to the original PERTEK; source of truth `lib/pendingRevisions.json` (currently MIN only) + `lib/pendingRevisionGate.js`; release dates stored in Sheets tab `pertek_perubahan_release` via `POST /api/company/:code/pertek-perubahan-release`; links `[[project_quota_ledger]]`. Add a one-line pointer to `MEMORY.md`.

- [ ] **Step 7: Commit docs**

```bash
git add logs/2026-07-13_log.md memory/project_pertek_perubahan_gate.md memory/MEMORY.md docs/superpowers
git commit -m "docs: changelog + memory for PERTEK Perubahan release-date gate"
```

---

## Self-Review

**Spec coverage:**
- Reverse not-yet-released split → original PERTEK → Task 1 (function) + Task 3 (wiring). ✓
- Gate list `lib/pendingRevisions.json`, MIN-only seed → Task 3 Step 1. ✓
- Durable release-date store (Sheets tab) → Task 2 + Task 4. ✓
- Dashboard UI to enter release date → Task 5. ✓
- Apply to all companies (general mechanism) → gate is data-driven off `PENDING_REVISIONS`; add rows anytime. ✓
- Error handling (to-missing, to-utilized, mt>obtained, no def, TBA) → Task 1 tests + implementation. ✓
- Testing (unit + integration/manual) → Task 1 (unit), Task 3 Step 5 (local integration), Task 6 (prod E2E). ✓
- Governance (changelog + memory) → Task 6. ✓

**Placeholder scan:** No TBD/TODO; all code blocks are complete. Task 5 Steps 1-3 require matching one existing variable/refresh name in `13-rev-mgmt.js` — this is a deliberate "follow the existing pattern" instruction, not a placeholder, because that file's panel-render structure must be read at implementation time; the injected HTML/handler code is fully specified.

**Type consistency:** `applyPendingRevision(maps, def, releaseDate)` and `isReleased` signatures match between Task 1 (definition), its tests, and Task 3 (call site). `co._pendingRevision` shape `{from,to,mt,origMT}` is produced in Task 3 and consumed identically in Task 5. Tab name `pertek_perubahan_release` is identical across Task 2 (`TABLES` + creation), Task 3 (read), Task 4 (read/write). Endpoint path `POST /api/company/:code/pertek-perubahan-release` matches between Task 4 and Task 5.
