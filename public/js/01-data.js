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
    // Recompute utilizationByProd / availableByProd from shipment lots —
    // overrides stale stats table values so chart always matches the shipment table.
    SPI.forEach(co => {
      if (!co.shipments || !Object.keys(co.shipments).length) return;
      const obtByProd = getObtainedByProd(co);
      co.utilizationByProd = {};
      co.availableByProd   = {};
      let totalUtil = 0;
      Object.entries(obtByProd).forEach(([prod, obtMT]) => {
        const used = (co.shipments[prod] || []).reduce((s, lot) => s + (lot.utilMT || 0), 0);
        co.utilizationByProd[prod] = used;
        co.availableByProd[prod]   = Math.max(0, obtMT - used);
        totalUtil += used;
      });
      co.utilizationMT = totalUtil;
      // CRITICAL FIX: use cycle-based canonical obtained (not raw DB co.obtained)
      // co.obtained from DB may include in-process cycles not yet PERTEK-issued
      // canonicalObtained() only counts cycles with valid PERTEK Terbit
      const coObtCanon = canonicalObtained(co);
      co.availableQuota = Math.max(0, (coObtCanon || co.obtained || 0) - totalUtil);
    });
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
   CANONICAL OBTAINED — Single source of truth for company total obtained.
   Rules (per user request 30-Apr-2026: aggregate ALL obtained cycles):
     Total Obtained = Obtained #1 + Obtained #2 + (next cycles if any)
     1. Sum every Obtained #N cycle MT
     2. Dedup by cycleType — first occurrence per company wins
        (legacy DB sometimes has duplicate rows for same cycle_type)
     3. Skip _fromRevReq cycles (revision re-allocation ≠ new MT)
     4. Skip mt ≤ 0
   Note: previously required PERTEK Terbit date from paired Submit cycle —
   that filter dropped HDP's Obtained #2 (100 MT) when the revision PERTEK
   wasn't paired through a "Submit #2" naming. Now trusts the cycle data.
   ═══════════════════════════════════════════════════════════════════ */
function canonicalObtained(co) {
  if (!co) return 0;
  const allCycles = co.cycles || [];
  const seen      = new Set();
  let   total     = 0;
  allCycles.forEach(c => {
    if (!/^obtained #/i.test(c.type)) return;          // only "Obtained #N" cycles
    const mt = typeof c.mt === 'number' ? c.mt : 0;
    if (mt <= 0) return;
    const key = c.type.toLowerCase().trim();
    if (seen.has(key)) return;                         // dedup cycleType
    seen.add(key);
    if (c._fromRevReq) return;                        // skip revision re-allocation
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
    if (c._fromRevReq) return;
    // Period filter: use PERTEK Terbit from paired Submit cycle when present;
    // when absent, fall back to the cycle's own pertekDate field. If neither
    // exists we still count it (matches the "trust cycle data" rule above)
    // but it won't pass an active period filter.
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
    Object.entries(c.products || {}).forEach(([p, v]) => {
      if (typeof v === 'number' && v > 0) result[p] = (result[p] || 0) + v;
    });
  });
  return result;
}

function getObtainedByProdAgg(co) {
  const result = {};
  if (!co) return result;
  const seen = new Set();
  (co.cycles || []).forEach(c => {
    if (!/^obtained\s*#\d/i.test(c.type)) return;
    const key = c.type.toLowerCase().trim();
    if (seen.has(key)) return;
    seen.add(key);
    if (c._fromRevReq) return;
    Object.entries(c.products || {}).forEach(([p, v]) => {
      if (typeof v === 'number' && v > 0) result[p] = (result[p] || 0) + v;
    });
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
    let mt;
    if (prod) {
      const v = (c.products || {})[prod];
      if (typeof v !== 'number' || v <= 0) return;
      mt = v;
    } else {
      mt = typeof c.mt === 'number' && c.mt > 0
        ? c.mt
        : Object.values(c.products || {}).reduce((s,v) => s + (typeof v === 'number' ? v : 0), 0);
      if (!mt) return;
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