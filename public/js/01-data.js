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

async function loadData() {
  try {
    const res  = await fetch('/api/data');
    const data = await res.json();
    SPI     = data.spi     || [];
    PENDING = data.pending || [];
    RA      = data.ra      || [];
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

/* ── PRODUCT COLORS: solid, high-contrast, clearly distinguishable ── */
const PROD_COLORS = {
  'GL BORON':     {solid:'#0369a1', light:'#e0f2fe', text:'#0369a1'},
  'GI BORON':     {solid:'#0f766e', light:'#ccfbf1', text:'#0f766e'},
  'SHEETPILE':    {solid:'#b45309', light:'#fef9c3', text:'#92400e'},
  'BORDES ALLOY': {solid:'#dc2626', light:'#fee2e2', text:'#991b1b'},
  'PPGL CARBON':  {solid:'#7c3aed', light:'#ede9fe', text:'#5b21b6'},
  'ERW PIPE OD≤140mm': {solid:'#9333ea', light:'#f3e8ff', text:'#6b21a8'},
  'ERW PIPE OD>140mm': {solid:'#0891b2', light:'#e0f7fa', text:'#155e75'},
  'AS STEEL':     {solid:'#64748b', light:'#f1f5f9', text:'#475569'},
  'HOLLOW PIPE':  {solid:'#78716c', light:'#f5f5f4', text:'#57534e'},
  'SEAMLESS PIPE':     {solid:'#0d6946', light:'#d1fae5', text:'#065f46'},
  'HRC/HRPO ALLOY':     {solid:'#ca8a04', light:'#fef3c7', text:'#92400e'},
};
const pc = p => PROD_COLORS[p] || {solid:'#64748b',light:'#f1f5f9',text:'#475569'};

/* ── HELPERS ── */
const getRA  = c => RA.find(r => r.code === c);
const getSPI = c => SPI.find(s => s.code === c);
/* Stage 2: Re-Apply already submitted — PERTEK Pending / On Process */
const isReapplySubmitted = r => r && r.reapplyStage === 2;
/* Eligibility: Realization ≥ 60% AND cargo arrived AND NOT yet submitted re-apply */
const isEligible = r => r && r.realPct >= 0.6 && r.cargoArrived === true && !isReapplySubmitted(r);