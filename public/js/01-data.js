/* ═══════════════════════════════════════
   DATA & SHARED STATE
   Global arrays SPI/PENDING/RA + base helpers
═══════════════════════════════════════ */


/* ══════════════════════════════════════════════════
   DATA — MASTER RECORDS
══════════════════════════════════════════════════ */

/* SPI Companies */
// ── CYCLE HELPERS ──────────────────────────────────────────
// Each SPI company now carries a `cycles` array that mirrors the Excel
// structure exactly:  Submit #1 → Obtained #1 → [Submit #2 → Obtained #2]
//                     [Revision #1 → Obtained (Revision #1)]
// Every cycle entry has: type, mt, products (object), submitDate, submitType,
//                        releaseDate, releaseType, status
// Date strings are 'DD/MM/YYYY' or 'TBA' or null.
// ───────────────────────────────────────────────────────────


/* ══════════════════════════════════════════════════
   DATA — Loaded from PostgreSQL via API
   (replaces hardcoded SPI / PENDING / RA arrays)
══════════════════════════════════════════════════ */
let SPI     = [];
let PENDING = [];
let RA      = [];
let _dataLoaded = false;

/* PRODUCT_META — populated by loadData() from /api/data .products
   Shape: { 'GL BORON': { hsCode, colorSolid, colorLight, colorText, sortOrder }, ... }
   Read by pc() and prodHS() helpers below. Falls back to PROD_COLORS
   constant if the API didn't return product metadata (e.g. older server). */
let PRODUCT_META = {};
/* PRODUCT_ALIASES — variant → canonical name. Sourced from DB
   `product_aliases` table; lets us render 'GI Boron' or 'GL' from RA records
   as the canonical 'GI BORON'/'GL BORON' for color lookup, etc. */
let PRODUCT_ALIASES = {};
const canonicalProduct = p => (p && PRODUCT_ALIASES[p]) || p;

/* COMPANY_DIRECTORY — master list of companies from company.xlsx (DB-backed).
   Two derived maps for O(1) lookup:
     COMPANY_NAME_TO_CODE: lowercased fullName → 3-letter code
     COMPANY_CODE_TO_NAME: code → fullName
   Used by realization import (filename → code) and by manual entry forms. */
let COMPANY_DIRECTORY    = [];
let COMPANY_NAME_TO_CODE = {};
let COMPANY_CODE_TO_NAME = {};
const lookupCompanyCodeByName = nm => nm ? COMPANY_NAME_TO_CODE[String(nm).trim().toLowerCase()] || null : null;
const lookupCompanyNameByCode = code => code ? COMPANY_CODE_TO_NAME[String(code).toUpperCase()] || '' : '';

/* REALIZATION_SUMMARY — { CODE: { pibs, lines } } map indicating which
   companies have realization data in DB. Used by the drawer to decide
   whether to show the "Detail Realization" button (and what badge to
   render). Loaded once at boot via /api/realizations/summary; cached
   30s on the server side. */
let REALIZATION_SUMMARY = {};
async function loadRealizationSummary() {
  try {
    const res = await fetch('/api/realizations/summary');
    if (!res.ok) return;
    const data = await res.json();
    REALIZATION_SUMMARY = (data && data.counts) || {};
  } catch (err) {
    console.warn('loadRealizationSummary failed:', err);
  }
}
const hasRealizationData = code => !!(REALIZATION_SUMMARY && REALIZATION_SUMMARY[code]);

async function loadData() {
  try {
    const res  = await fetch('/api/data');
    const data = await res.json();
    const _dedup = (arr) => {
      const seen = new Set();
      return arr.filter(c => { if (seen.has(c.code)) return false; seen.add(c.code); return true; });
    };
    SPI     = _dedup(data.spi     || []);
    PENDING = _dedup(data.pending || []);
    RA      = data.ra      || [];
    // Capture concurrency token (server's updated_at). Used by patchToServer
    // as `_ifUpdatedAt` so server can reject stale writes (HTTP 409) when
    // another user has modified the row since this fetch.
    [SPI, PENDING].forEach(arr => arr.forEach(co => {
      if (co && co.updatedAt) co._updatedAt = co.updatedAt;
    }));
    // Product master metadata — index by name for O(1) lookup
    PRODUCT_META = {};
    (data.products || []).forEach(p => { if (p && p.name) PRODUCT_META[p.name] = p; });
    // Variant → canonical map (e.g. 'GI Boron' → 'GI BORON')
    PRODUCT_ALIASES = data.productAliases || {};
    // Company directory from DB (fed by company.xlsx)
    COMPANY_DIRECTORY    = data.companyDirectory || [];
    COMPANY_NAME_TO_CODE = {};
    COMPANY_CODE_TO_NAME = {};
    COMPANY_DIRECTORY.forEach(d => {
      if (d.fullName)     COMPANY_NAME_TO_CODE[d.fullName.toLowerCase()] = d.abbreviation;
      if (d.abbreviation) COMPANY_CODE_TO_NAME[d.abbreviation.toUpperCase()] = d.fullName;
    });
    // β-1: utilizationByProd AND availableByProd come straight from the server
    // payload (company_product_stats), refreshed from the master file via
    // importMasterStats.js. The master already encodes post-revision NET per
    // product in its Utilization + Available rows, so the client does NOT
    // recompute or re-derive them. Per-product net obtained = util + avail
    // (see getObtainedByProdAgg). company-level utilizationMT / availableQuota
    // stay SERVER-RECONCILED via KPI_RECONCILE. revision_changes is UI-only now
    // (drawer + revision management) — the aggregator no longer reads it.
    //
    // Previous bug: this block iterated getObtainedByProd(co) keys and looked
    // up co.shipments[prod] — but cycle product names and shipment lot product
    // names can diverge (legacy alias vs canonical). Mismatched lots returned
    // undefined → 0 MT, silently dropping 2,037.5 MT system-wide. The local
    // recompute then OVERWROTE the correct API values with the undercount.
    // Trust the server payload — it already reflects XLSX truth.
    // Also override raw co.obtained / co.submit1 with the aggregated canonical
    // totals (Obtained #1 + Obtained #2 + …, Submit #1 + Submit #2 + Revision #N).
    // Per request 30-Apr-2026: every dashboard section should reflect the
    // aggregate, not just the legacy single-cycle DB column.
    [SPI, PENDING].forEach(arr => arr.forEach(co => {
      const canonObt = canonicalObtained(co);
      if (canonObt > 0) {
        co._canonicalObtained = canonObt;
        co.obtained = canonObt;
      }
      const canonSub = canonicalSubmitted(co);
      if (canonSub > 0) {
        co._canonicalSubmitted = canonSub;
        co.submit1 = canonSub;
      }
    }));

    _dataLoaded = true;
  } catch(err) {
    console.error('Failed to load data from API:', err);
    showDataError();
  }
}

function showDataError() {
  document.body.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;background:#f0f2f5">
    <div style="text-align:center;padding:40px;background:#fff;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,.1)">
      <div style="font-size:40px;margin-bottom:12px">⚠️</div>
      <h2 style="color:#182644;margin:0 0 8px">Unable to connect to server</h2>
      <p style="color:#64748b;margin:0 0 20px">Could not load quota data. Please check your connection.</p>
      <button onclick="location.reload()" style="background:#182644;color:#fff;border:none;padding:10px 24px;border-radius:6px;cursor:pointer;font-size:14px">Retry</button>
    </div>
  </div>`;
}

/* ════════════════════════════════════════════════════════════════════
   fmtDateStd — Normalize ANY date string to a single display format.
   ─────────────────────────────────────────────────────────────────────
   Output: 'DD-MMM-YY' (e.g. '29-Apr-26'). Always 2-digit day, English
   3-letter month with capital initial, 2-digit year. Easy to scan,
   sort-friendly when paired with year context, and unambiguous (vs.
   '02/03/26' which can read as March 2 or Feb 3).
   ─────────────────────────────────────────────────────────────────────
   Accepts every quirky format already in the DB:
     • ISO  'YYYY-MM-DD'             → 2026-05-13
     • Slash 'DD/MM/YYYY' / 'D/M/YY' → 12/05/2026, 7/5/26
     • Dash  'DD-MM-YYYY'            → 12-05-2026
     • English long  'DD Mmm YYYY'   → 29 Apr 2026, 29 April 2026
     • Indonesian long 'DD Mmm YYYY' → 07 Mei 2026, 07 Agustus 2026
     • Already normalized            → 29-Apr-26 (pass-through)
     • Mixed case / extra whitespace → handled
   Returns the original string unchanged if it can't parse, or '' for
   empty input / TBA. NEVER throws. Safe to call on null/undefined.
   ═══════════════════════════════════════════════════════════════════ */
const _MONTHS_EN_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const _MONTH_NAME_MAP = {
  // English short + long
  jan:1, january:1, feb:2, february:2, mar:3, march:3,
  apr:4, april:4, may:5, jun:6, june:6, jul:7, july:7,
  aug:8, august:8, sep:9, sept:9, september:9,
  oct:10, october:10, nov:11, november:11, dec:12, december:12,
  // Indonesian short + long
  mei:5, agu:8, agust:8, agustus:8, okt:10, oktober:10,
  des:12, desember:12,
  // Indonesian variants of others
  januari:1, februari:2, maret:3, juni:6, juli:7, november_id:11
};

function fmtDateStd(input) {
  if (input == null) return '';
  let s = String(input).trim();
  if (!s || /^(TBA|null|undefined|—|-)$/i.test(s)) return s === 'TBA' ? 'TBA' : '';

  let d = null, m = null, y = null;

  // Pass 1: ISO  YYYY-MM-DD
  let mm = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (mm) { y = +mm[1]; m = +mm[2]; d = +mm[3]; }

  // Pass 2: slash/dash  DD[/-]MM[/-]YYYY  or  DD[/-]MM[/-]YY
  if (d == null) {
    mm = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (mm) {
      d = +mm[1]; m = +mm[2]; y = +mm[3];
      if (y < 100) y += 2000;
    }
  }

  // Pass 3: word month  DD Mmm YYYY  or  DD-Mmm-YY (also already normalized)
  if (d == null) {
    mm = s.match(/^(\d{1,2})[\s\-\/]+([A-Za-z]+)[\s\-\/]+(\d{2,4})$/);
    if (mm) {
      d = +mm[1];
      const monKey = mm[2].toLowerCase();
      m = _MONTH_NAME_MAP[monKey] || null;
      y = +mm[3];
      if (y < 100) y += 2000;
    }
  }

  // Validate
  if (d == null || m == null || y == null || isNaN(d) || isNaN(m) || isNaN(y) ||
      d < 1 || d > 31 || m < 1 || m > 12 || y < 1900 || y > 2999) {
    return s; // give up — return original so user still sees something
  }

  const dd  = String(d).padStart(2, '0');
  const mon = _MONTHS_EN_SHORT[m - 1];
  const yy  = String(y).slice(-2);
  return `${dd}-${mon}-${yy}`;
}

/* todayStd — current date in the canonical 'DD-MMM-YY' format. Use this
   whenever new dates are stamped onto records (revision confirmations,
   updates) so the data uniformly matches the display format. */
function todayStd() {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const mon = _MONTHS_EN_SHORT[d.getMonth()];
  const yy = String(d.getFullYear()).slice(-2);
  return `${dd}-${mon}-${yy}`;
}

/* ── _fmtMT: format float MT values with up to 2 decimal places, no trailing zeros ── */
function _fmtMT(val) {
  if (val == null || isNaN(val)) return '0';
  const n = Number(val);
  const dec = n % 1 === 0 ? '' : ('.' + n.toFixed(2).split('.')[1].replace(/0+$/, ''));
  return Math.floor(n).toLocaleString() + dec;
}

/* ── PRODUCT COLORS — final source of truth for chart/badge colors.
   Includes both the older names (GL BORON, SHEETPILE, …) and the new
   Excel-canonical names (GL ALLOY, SHEET PILE, …) so the dashboard
   renders correctly whichever name a row uses. PRODUCT_META from the
   DB is consulted first, but only when its colorSolid is NOT the
   gray placeholder default — products inserted via import-libraries
   without explicit colors take this column default and we want the
   palette below to win in that case. ── */
const PROD_COLORS = {
  // Legacy names (kept for existing cycle_products / ra_records data)
  'GL BORON':           {solid:'#0369a1', light:'#e0f2fe', text:'#0369a1'},
  'GI BORON':           {solid:'#0f766e', light:'#ccfbf1', text:'#0f766e'},
  'SHEETPILE':          {solid:'#b45309', light:'#fef9c3', text:'#92400e'},
  'ERW PIPE OD≤140mm':  {solid:'#9333ea', light:'#f3e8ff', text:'#6b21a8'},
  'ERW PIPE OD>140mm':  {solid:'#0891b2', light:'#e0f7fa', text:'#155e75'},
  'HRC/HRPO ALLOY':     {solid:'#ca8a04', light:'#fef3c7', text:'#92400e'},
  // Excel canonical names (matches product.xlsx — preferred going forward)
  'GL ALLOY':           {solid:'#0369a1', light:'#e0f2fe', text:'#0369a1'},
  'GI ALLOY':           {solid:'#0f766e', light:'#ccfbf1', text:'#0f766e'},
  'SHEET PILE':         {solid:'#b45309', light:'#fef9c3', text:'#92400e'},
  'SHEET PILE (INTERLOCKS)': {solid:'#c2410c', light:'#fff7ed', text:'#9a3412'},
  'ERW PIPE (OD ≤ 140 mm)':  {solid:'#9333ea', light:'#f3e8ff', text:'#6b21a8'},
  'ERW PIPE (OD > 140mm)':   {solid:'#0891b2', light:'#e0f7fa', text:'#155e75'},
  'HRPO ALLOY':         {solid:'#ca8a04', light:'#fef3c7', text:'#92400e'},
  'HRC ≥3 mm to <4.75 mm':  {solid:'#0369a1', light:'#e0f2fe', text:'#0369a1'},
  'HRC <3 mm':          {solid:'#0284c7', light:'#e0f2fe', text:'#0369a1'},
  'ZAM ALLOY':          {solid:'#a16207', light:'#fef9c3', text:'#854d0e'},
  'ZAM >1.2 mm to ≤1.5 mm': {solid:'#fbbf24', light:'#fef9c3', text:'#854d0e'},
  'ZAM >1.5 mm':        {solid:'#f59e0b', light:'#fef3c7', text:'#92400e'},
  'GI CARBON':          {solid:'#0d9488', light:'#ccfbf1', text:'#0f766e'},
  'GL CARBON':          {solid:'#0284c7', light:'#e0f2fe', text:'#0369a1'},
  'GL SLIT':            {solid:'#1e56c6', light:'#eff4ff', text:'#1e3a8a'},
  'BEAM ALLOY':         {solid:'#475569', light:'#f1f5f9', text:'#334155'},
  'CHANNEL':            {solid:'#9333ea', light:'#f3e8ff', text:'#6b21a8'},
  'BEAM':               {solid:'#a855f7', light:'#f3e8ff', text:'#6b21a8'},
  'ANGLE':              {solid:'#d946ef', light:'#fae8ff', text:'#86198f'},
  'STRUCTURAL STEEL':   {solid:'#525252', light:'#f5f5f5', text:'#404040'},
  // Names shared between legacy and Excel
  'BORDES ALLOY':       {solid:'#dc2626', light:'#fee2e2', text:'#991b1b'},
  'AS STEEL':           {solid:'#64748b', light:'#f1f5f9', text:'#475569'},
  'PPGL CARBON':        {solid:'#7c3aed', light:'#ede9fe', text:'#5b21b6'},
  'HOLLOW PIPE':        {solid:'#78716c', light:'#f5f5f4', text:'#57534e'},
  'SEAMLESS PIPE':      {solid:'#0d6946', light:'#d1fae5', text:'#065f46'},
};
const _PC_DEFAULT_GRAY = '#64748b';
/* Single source of truth for product colors. Resolves aliases first
   ('GI Boron' → 'GI ALLOY'), then prefers a non-default DB color, then
   falls back to PROD_COLORS by canonical or original name. */
const pc = p => {
  const cp = canonicalProduct(p);
  const m  = PRODUCT_META[cp];
  // Trust DB color only when it's been customized — products inserted
  // via import-libraries without explicit colors take the gray default.
  if (m && m.colorSolid && m.colorSolid !== _PC_DEFAULT_GRAY) {
    return { solid: m.colorSolid, light: m.colorLight, text: m.colorText };
  }
  return PROD_COLORS[cp] || PROD_COLORS[p] || { solid: _PC_DEFAULT_GRAY, light:'#f1f5f9', text:'#475569' };
};
/* HS code lookup — prefers DB, resolves aliases, falls back to hardcoded. */
const prodHS = p => {
  const cp = canonicalProduct(p);
  const m = PRODUCT_META[cp];
  if (m && m.hsCode) return m.hsCode;
  if (typeof PROD_HS_CODES !== 'undefined') return PROD_HS_CODES[cp] || PROD_HS_CODES[p] || '—';
  return '—';
};

/* ── HELPERS ── */
const getRA  = c => RA.find(r => r.code === c);
const getSPI = c => SPI.find(s => s.code === c);
/* Stage 2: Re-Apply already submitted — PERTEK Pending / On Process */
const isReapplySubmitted = r => r && r.reapplyStage === 2;
/* Eligibility: Realization ≥ 60% AND cargo arrived AND NOT yet submitted re-apply */
const isEligible = r => r && r.realPct >= 0.6 && r.cargoArrived === true && !isReapplySubmitted(r);

/* ════════════════════════════════════════════════════════════════════
   _isObtainedTerbit — predicate: cycle is countable as "obtained".
   Rules align with XLSX master semantics (12-May-2026 sheet):
     • Obtained #1: ALWAYS counted when mt > 0 (PERTEK approval ≈ implicit;
       absence of date in DB usually = data-entry catch-up, not "not yet
       obtained"). XLSX includes AADC/KARA Obt1 even with release=TBA.
     • Obtained #2+: counted only if release_date is NOT explicitly "TBA".
       Excludes BHG/HKG/MIN/SGD/SJH (PERTEK Perubahan still pending).
       Accepts release_date holding an SPI number (e.g. "04.PI-…") when
       paired with spi_date — that's the user convention for "terbit".
   This eliminates the GKL/BHG/etc. double-counting bug (was inflating
   canonical obtained by ~12,350 MT vs XLSX truth).
   ═══════════════════════════════════════════════════════════════════ */
function _isObtainedTerbit(c) {
  if (!c) return false;
  // Obtained #1 → trust mt > 0 (no extra date gate). Matches XLSX.
  if (/^obtained\s*#?1\b/i.test(c.type || '')) return true;
  // Obtained #2+ → skip when release_date is explicitly TBA / empty AND
  // no fallback spi_date / pertek_date is populated.
  const rd = String(c.releaseDate || '').trim();
  const isTBA = !rd || /^(TBA|null|undefined|—)$/i.test(rd);
  if (!isTBA) return true; // any non-TBA release_date counts as terbit
  // release_date is TBA — accept if spi_date or pertek_date is filled
  const sd = String(c.spiDate || '').trim();
  const pd = String(c.pertekDate || '').trim();
  return (sd && !/^TBA$/i.test(sd)) || (pd && !/^TBA$/i.test(pd));
}

/* snapZero — display helper to suppress tiny negative MT values caused by
   rounding in XLSX manual re-allocation (e.g. GKL ERW PIPE −0.49 / −0.08).
   Only clamps the (-1, 0) range; real negatives (≤ -1) still surface as bugs. */
function snapZero(v) {
  if (typeof v !== 'number' || isNaN(v)) return v;
  return (v > -1 && v < 0) ? 0 : v;
}

/* ceilMt — display helper: round UP any MT value to integer (per business
   rule 21-May-2026). Apply to obtained/util/avail/submit displays — NOT to
   realization (realMT, totalRealizedMT, realPct etc), per user preference.
   Negative values handled gracefully: snapZero first, then ceil. */
function ceilMt(v) {
  if (typeof v !== 'number' || isNaN(v)) return v;
  const snapped = snapZero(v);
  return Math.ceil(snapped);
}
/* fmtMt — shorthand: ceilMt → toLocaleString. Use everywhere MT is shown
   (cards, tables, totals, charts) for util/avail/obtained/submit. */
function fmtMt(v) {
  const c = ceilMt(v);
  return typeof c === 'number' ? c.toLocaleString() : c;
}

/* ════════════════════════════════════════════════════════════════════
   CANONICAL OBTAINED — Single source of truth for company total obtained.
   Rules (aligned with XLSX master 12-May-2026):
     Total Obtained = Σ Obtained #N where PERTEK/SPI Perubahan terbit
     1. Sum every Obtained #N cycle MT
     2. Dedup by cycleType — first occurrence per company wins
     3. Skip mt ≤ 0  (empty/zero cycles)
     4. Skip cycles where release_date is TBA / unparseable
        (PERTEK Perubahan not yet issued — pending revision)
   ═══════════════════════════════════════════════════════════════════ */
function canonicalObtained(co) {
  if (!co) return 0;
  const allCycles = co.cycles || [];
  const seen      = new Set();
  let   total     = 0;
  allCycles.forEach(c => {
    if (!/^obtained #/i.test(c.type)) return;          // only "Obtained #N" cycles
    const mt = typeof c.mt === 'number' ? c.mt : 0;
    if (mt <= 0) return;                              // skip empty/zero cycles
    const key = c.type.toLowerCase().trim();
    if (seen.has(key)) return;                         // dedup cycleType
    seen.add(key);
    if (!_isObtainedTerbit(c)) return;                // SKIP TBA / not-yet-terbit
    total += mt;
  });
  return total;
}

/* ── canonicalObtainedFiltered: period-aware version of canonicalObtained ── */
function canonicalObtainedFiltered(co) {
  if (!co) return 0;
  const allCycles = co.cycles || [];
  const seen      = new Set();
  let   total     = 0;
  allCycles.forEach(c => {
    if (!/^obtained #/i.test(c.type)) return;
    const mt = typeof c.mt === 'number' ? c.mt : 0;
    if (mt <= 0) return;
    const key = c.type.toLowerCase().trim();
    if (seen.has(key)) return;
    seen.add(key);
    if (!_isObtainedTerbit(c)) return; // also gate by terbit status
    if (PERIOD.active) {
      let pertekDate = null;
      if (typeof getPertekTerbitForObtained === 'function') {
        pertekDate = getPertekTerbitForObtained(c, allCycles);
      }
      if (!pertekDate && c.pertekDate) pertekDate = pDate(c.pertekDate);
      if (!inPd(pertekDate)) return;
    }
    total += mt;
  });
  return total;
}

/* ════════════════════════════════════════════════════════════════════
   CANONICAL SUBMITTED — Single source of truth for total submitted.
   Per user spec 30-Apr-2026: Total Submitted = Submit #1 + Submit #2 + …
   ─────────────────────────────────────────────────────
   Revision cycles are EXCLUDED — a Revision is a CHANGE to an existing
   submission, not a new one. Including it would double-count quota.
   Only Submit #N cycles count. Same dedup + _fromRevReq skip as canonicalObtained.
   ═══════════════════════════════════════════════════════════════════ */
function canonicalSubmitted(co) {
  if (!co) return 0;
  const allCycles = co.cycles || [];
  const seen      = new Set();
  let   total     = 0;
  allCycles.forEach(c => {
    if (!/^submit\s*#\d/i.test(c.type)) return;     // Submit #N only — NOT Revision
    const mt = typeof c.mt === 'number' ? c.mt : 0;
    if (mt <= 0) return;
    const key = c.type.toLowerCase().trim();
    if (seen.has(key)) return;
    seen.add(key);
    if (c._fromRevReq) return;
    total += mt;
  });
  return total;
}

/* ════════════════════════════════════════════════════════════════════
   getSubmittedByProd / getObtainedByProdAgg — per-product aggregation.
   Sums each product's MT across all Submit / Obtained cycles (deduped
   by cycleType so legacy duplicate rows don't double-count). Revision
   cycles are EXCLUDED (a revision changes an existing submission, not
   a new one). Used by the obtained drill-down and any view that wants
   per-product totals reflecting Submit #1 + Submit #2, Obtained #1 +
   Obtained #2, etc.
   ═══════════════════════════════════════════════════════════════════ */
function getSubmittedByProd(co) {
  const result = {};
  if (!co) return result;
  const seen = new Set();
  (co.cycles || []).forEach(c => {
    if (!/^submit\s*#\d/i.test(c.type)) return;     // Submit #N only — NOT Revision
    const key = c.type.toLowerCase().trim();
    if (seen.has(key)) return;
    seen.add(key);
    if (c._fromRevReq) return;
    // Require cycle.mt > 0 — same gate as canonicalSubmitted. Without this,
    // a Submit #N draft (cycle.mt empty but cycle_products populated)
    // would inflate the per-product total even though the submission
    // hasn't actually been submitted yet.
    const cycMt = typeof c.mt === 'number' ? c.mt : 0;
    if (cycMt <= 0) return;
    Object.entries(c.products || {}).forEach(([p, v]) => {
      if (typeof v === 'number' && v > 0) result[p] = (result[p] || 0) + v;
    });
  });
  return result;
}

// β-1: per-product NET obtained = utilization + available, read straight from
// company_product_stats (co.utilizationByProd / co.availableByProd in the
// payload), which importMasterStats.js refreshes from the master file. The
// master's Utilization + Available rows already encode post-revision net per
// product (BDG/GAS/MIN/MJU reallocations applied per SPI-Perubahan lifecycle),
// so the aggregator no longer reads cycles or revision_changes and never has to
// guess whether a revision is live. revision_changes stays a UI dependency only
// — 08-drawer.js and 13-rev-mgmt.js still render revFrom/revTo for the
// product-change history; the aggregator simply ignores it.
function getObtainedByProdAgg(co) {
  const result = {};
  if (!co) return result;
  const util  = co.utilizationByProd || {};
  const avail = co.availableByProd   || {};
  new Set([...Object.keys(util), ...Object.keys(avail)]).forEach(p => {
    const v = (Number(util[p]) || 0) + (Number(avail[p]) || 0);
    if (v > 0) result[p] = v;
  });
  return result;
}

/* ════════════════════════════════════════════════════════════════════
   getCycleBreakdown — returns per-cycle breakdown for hover tooltip.
   mode: 'submit' | 'obtained'
   prod (optional): if provided, only returns cycles touching that product
   Returns: [{ type, label, mt, date, products }]
   ═══════════════════════════════════════════════════════════════════ */
function getCycleBreakdown(co, mode, prod) {
  if (!co) return [];
  // Submit-mode breakdown excludes Revision cycles (revisions change an
  // existing submission, not add new ones — including them would double-count).
  const re = mode === 'submit'
    ? /^submit\s*#\d/i
    : /^obtained\s*#\d/i;
  const seen = new Set();
  const out  = [];
  (co.cycles || []).forEach(c => {
    if (!re.test(c.type)) return;
    const key = c.type.toLowerCase().trim();
    if (seen.has(key)) return;
    seen.add(key);
    if (c._fromRevReq) return;
    // Same gates as canonicalObtained/Submitted: skip empty (mt=0) and
    // — for obtained mode — skip not-yet-terbit (release TBA / invalid).
    const cycMt = typeof c.mt === 'number' ? c.mt : 0;
    if (cycMt <= 0) return;
    if (mode === 'obtained' && typeof _isObtainedTerbit === 'function' && !_isObtainedTerbit(c)) return;
    let mt;
    if (prod) {
      const v = (c.products || {})[prod];
      if (typeof v !== 'number' || v <= 0) return;
      mt = v;
    } else {
      mt = cycMt;
    }
    // Friendly label: "Submit #1" | "Submit #2 (Re-Apply)" | "Obtained #2 (Re-Apply)" | "Revision #1"
    let label = c.type;
    if (/^submit\s*#[2-9]/i.test(c.type))   label = c.type + ' (Re-Apply)';
    if (/^obtained\s*#[2-9]/i.test(c.type)) label = c.type + ' (Re-Apply)';
    const date = mode === 'submit'
      ? (c.submitDate || c.pertekDate || '')
      : (c.releaseDate || c.spiDate || c.pertekDate || c.submitDate || '');
    out.push({ type: c.type, label, mt, date, products: c.products || {} });
  });
  return out;
}