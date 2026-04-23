/* ═══════════════════════════════════════
   PERIOD FILTER — State & Engine
═══════════════════════════════════════ */

/* ══════════════════════════════════════════════════
   PERIOD FILTER — Global State & Engine
══════════════════════════════════════════════════ */
let PERIOD = { from: null, to: null, label: 'All Time', active: false };
let FILTER_MODE = 'both'; // 'submit' | 'release' | 'both'

const MODE_DESC = {
  both:    "Shows records where <strong>any cycle's</strong> submit or release date falls in range.",
  submit:  "Shows records where <strong>any cycle's submit date</strong> (MOI/MOT) falls in range.",
  release: "Shows records where <strong>any cycle's release date</strong> (PERTEK/SPI) falls in range."
};

const PRESETS = {
  all:   { label:'All Time',  from:null,                        to:null },
  oct25: { label:'Oct 2025',  from:new Date(2025,9,1),          to:new Date(2025,9,31) },
  nov25: { label:'Nov 2025',  from:new Date(2025,10,1),         to:new Date(2025,10,30) },
  dec25: { label:'Dec 2025',  from:new Date(2025,11,1),         to:new Date(2025,11,31) },
  jan26: { label:'Jan 2026',  from:new Date(2026,0,1),          to:new Date(2026,0,31) },
  feb26: { label:'Feb 2026',  from:new Date(2026,1,1),          to:new Date(2026,1,28) },
  q425:  { label:'Q4 2025',   from:new Date(2025,9,1),          to:new Date(2025,11,31) },
  q126:  { label:'Q1 2026',   from:new Date(2026,0,1),          to:new Date(2026,2,31) },
  ytd:   { label:'YTD 2026',  from:new Date(2026,0,1),          to:new Date(2026,11,31) },
};

function fmtDateShort(d) {
  if (!d) return '—';
  return d.toLocaleDateString('id-ID',{day:'2-digit',month:'short',year:'numeric'});
}

/* Returns true if a date falls within active period */
function inPeriod(date) {
  if (!PERIOD.active || !date) return true;
  if (PERIOD.from && date < PERIOD.from) return false;
  if (PERIOD.to   && date > PERIOD.to)   return false;
  return true;
}

/* Parse a date string 'DD/MM/YYYY' → Date object, or null if TBA/invalid */
function parseCycleDate(str) {
  if (!str || str === 'TBA') return null;
  const m = str.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  return new Date(+m[3], +m[2]-1, +m[1]);
}

/* ─────────────────────────────────────────────────────────────────────────
   CORE PERIOD FILTER ENGINE
   
   Filtering rule (single consistent definition):
   A COMPANY is in-period if ANY of its cycles' Submit MOT date (Obtained
   cycles) or Submit MOI date (Submit/Process cycles) falls within the
   selected period range. This ensures that when you filter October 2025,
   you see all companies that had ANY submission activity in that month.

   For the KPI cards, each KPI uses its own per-cycle date field:
     KPI1 (Submitted) → Submit MOI date of Submit #1/#2 cycles
     KPI2 (Obtained)  → Submit MOT date of Obtained cycles
     KPI5 (Pending)   → Submit MOI date of Submit(Process) cycles
   
   Tables/charts: show WHOLE companies if any cycle matches.
   ───────────────────────────────────────────────────────────────────────── */

/** Parse date from 'DD/MM/YYYY' or 'YYYY-MM-DD' format. Returns Date or null. */
function pDate(str) {
  if (!str || str === 'TBA' || str === 'null' || str === 'undefined') return null;
  // ISO format
  const iso = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return new Date(+iso[1], +iso[2]-1, +iso[3]);
  // DD/MM/YYYY or D/M/YYYY
  const dmy = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (dmy) {
    let y = +dmy[3];
    if (y < 100) y += 2000;
    return new Date(y, +dmy[2]-1, +dmy[1]);
  }
  return null;
}

/** True if date d falls within the active period (inclusive).
 *  Returns FALSE for null/undefined dates when period is active —
 *  a missing date must never pass the filter. */
function inPd(d) {
  if (!PERIOD.active) return true;
  if (!d) return false;            // null date = not in any period
  if (PERIOD.from && d < PERIOD.from) return false;
  if (PERIOD.to   && d > PERIOD.to)   return false;
  return true;
}

/**
 * Extract all key dates from a single cycle object.
 *
 * DATA MODEL (verified against Excel):
 *   Submit #N / Revision #N cycles:
 *     submitDate  → Submit MOI date
 *     releaseDate → PERTEK Terbit date   ← authoritative release date
 *
 *   Obtained #N / Obtained (Revision #N) cycles:
 *     submitDate  → Submit MOT date
 *     releaseDate → SPI Terbit date
 *
 * Returns { submitMOI, pertekTerbit, submitMOT, spiTerbit }
 */
function cycleDates(c) {
  const isSubmitRow   = /^submit #|^revision #/i.test(c.type);
  const isObtainedRow = /^obtained/i.test(c.type);
  return {
    submitMOI:   isSubmitRow   ? pDate(c.submitDate)  : null,
    pertekTerbit: isSubmitRow   ? pDate(c.releaseDate) : null,  // PERTEK Terbit
    submitMOT:   isObtainedRow ? pDate(c.submitDate)  : null,
    spiTerbit:   isObtainedRow ? pDate(c.releaseDate) : null,   // SPI Terbit
  };
}

/**
 * Given an Obtained cycle, find its paired Submit cycle from the same company's
 * cycles array and return the PERTEK Terbit date from that Submit cycle.
 * Pairing: Obtained #1 ← Submit #1, Obtained #2 ← Submit #2, etc.
 * Obtained (Revision #N) ← Revision #N
 */
function getPertekTerbitForObtained(obtCycle, allCycles) {
  // Extract cycle number / revision number from obtained type
  const m = obtCycle.type.match(/^Obtained\s+(?:\(Revision\s+)?#?(\d+)/i);
  if (!m) return null;
  const num = m[1];
  // Find matching Submit or Revision cycle
  const paired = allCycles.find(c => {
    if (c === obtCycle) return false;
    const isRevision = /revision/i.test(obtCycle.type);
    if (isRevision) return new RegExp(`^Revision\\s*#?${num}\\b`, 'i').test(c.type);
    return new RegExp(`^Submit\\s*#?${num}\\b`, 'i').test(c.type);
  });
  return paired ? pDate(paired.releaseDate) : null;
}

/**
 * Does this company (with its cycles array) match the active period?
 * Company is included in tables/charts if ANY cycle has ANY key date in period.
 * This is the broad "show the company row" filter — KPI calculations use
 * narrower per-field filters below.
 */
function companyInPeriod(cycles) {
  if (!PERIOD.active) return true;
  if (!cycles || !cycles.length) return false;  // no cycles → not in any period
  // A company matches only if at least one real (non-null) cycle date falls in period
  return cycles.some(c => {
    const { submitMOI, pertekTerbit, submitMOT, spiTerbit } = cycleDates(c);
    return inPd(submitMOI) || inPd(pertekTerbit) || inPd(submitMOT) || inPd(spiTerbit);
  });
}

/* Filter SPI array — company is included if any cycle date falls in period */
function filteredSPI() {
  if (!PERIOD.active) return SPI;
  return SPI.filter(d => companyInPeriod(d.cycles || []));
}

/* Filter RA array — match based on SPI company cycle dates (consistent with filteredSPI) */
function filteredRA() {
  if (!PERIOD.active) return RA;
  const validCodes = new Set(SPI.filter(co => companyInPeriod(co.cycles||[])).map(co => co.code));
  return RA.filter(r => validCodes.has(r.code));
}

/* Filter PENDING by cycle dates */
function filteredPending() {
  if (!PERIOD.active) return PENDING;
  return PENDING.filter(d => companyInPeriod(d.cycles || []));
}

/**
 * Get cycles from a company that individually match the active period.
 * Used for per-cycle KPI calculations.
 * @param {Array} cycles    — cycle array from company data
 * @param {string} role     — 'submitRow'|'obtainedRow'|'any'
 * @param {string} dateField — 'submitMOI'|'pertekTerbit'|'submitMOT'|'spiTerbit'|'any'
 * @param {Array}  allCycles — full cycle array (needed for pertekTerbit lookup on obtained rows)
 */
function matchingCycles(cycles, role, dateField, allCycles) {
  if (!cycles) return [];
  const ac = allCycles || cycles;
  return cycles.filter(c => {
    const isObt = /^obtained/i.test(c.type);
    const isSub = /^submit #|^revision #/i.test(c.type);
    if (role === 'submitRow'   && !isSub)  return false;
    if (role === 'obtainedRow' && !isObt)  return false;
    if (!PERIOD.active) return true;
    if (dateField === 'any') {
      const cd = cycleDates(c);
      return inPd(cd.submitMOI)||inPd(cd.pertekTerbit)||inPd(cd.submitMOT)||inPd(cd.spiTerbit);
    }
    if (dateField === 'pertekTerbit' && isObt) {
      // For obtained rows, look up PERTEK Terbit from the paired Submit cycle
      return inPd(getPertekTerbitForObtained(c, ac));
    }
    const cd = cycleDates(c);
    return inPd(cd[dateField]);
  });
}

/** Compatibility shim — old code calls cycleMatchesPeriod */
function cycleMatchesPeriod(cycles) {
  return companyInPeriod(cycles);
}

/* Set filter mode */
function setFilterMode(mode, el) {
  FILTER_MODE = mode;
  document.querySelectorAll('#pf-mode-both,#pf-mode-submit,#pf-mode-release').forEach(x => x.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('pfModeDesc').innerHTML = MODE_DESC[mode];
  if (PERIOD.active) applyPeriodFilter();
}

/* ── UI CONTROLS ── */
function togglePeriod(e) {
  e.stopPropagation();
  const panel = document.getElementById('pfPanel');
  const wrap  = document.getElementById('pfWrap');
  const isOpen = panel.classList.contains('open');
  if (!isOpen) {
    // Position panel under the trigger
    const rect = wrap.getBoundingClientRect();
    panel.style.left = rect.left + 'px';
    panel.classList.add('open');
    wrap.classList.add('open');
    document.getElementById('pfIco').textContent = '▴';
  } else {
    closePeriod();
  }
}

function closePeriod() {
  document.getElementById('pfPanel').classList.remove('open');
  document.getElementById('pfWrap').classList.remove('open');
  document.getElementById('pfIco').textContent = '▾';
}

function applyPreset(key, el) {
  const p = PRESETS[key];
  document.querySelectorAll('.pf-preset').forEach(x => x.classList.remove('active'));
  el.classList.add('active');
  PERIOD.from   = p.from;
  PERIOD.to     = p.to;
  PERIOD.label  = p.label;
  PERIOD.active = key !== 'all';
  // Sync date inputs
  document.getElementById('pfFrom').value = p.from ? p.from.toISOString().slice(0,10) : '';
  document.getElementById('pfTo').value   = p.to   ? p.to.toISOString().slice(0,10)   : '';
  updatePeriodUI();
  applyPeriodFilter();
}

function onCustomDate() {
  const f = document.getElementById('pfFrom').value;
  const t = document.getElementById('pfTo').value;
  if (!f && !t) { applyPreset('all', document.getElementById('pre-all')); return; }
  // Deactivate presets
  document.querySelectorAll('.pf-preset').forEach(x => x.classList.remove('active'));
  PERIOD.from   = f ? new Date(f) : null;
  PERIOD.to     = t ? new Date(t+'T23:59:59') : null;
  PERIOD.active = !!(f || t);
  const fStr = f ? new Date(f).toLocaleDateString('id-ID',{day:'2-digit',month:'short',year:'numeric'}) : '—';
  const tStr = t ? new Date(t).toLocaleDateString('id-ID',{day:'2-digit',month:'short',year:'numeric'}) : '—';
  PERIOD.label = f && t ? fStr + ' – ' + tStr : f ? '≥ ' + fStr : '≤ ' + tStr;
  updatePeriodUI();
  applyPeriodFilter();
}

function clearPeriod() {
  PERIOD = { from:null, to:null, label:'All Time', active:false };
  FILTER_MODE = 'both';
  document.querySelectorAll('.pf-preset').forEach(x => x.classList.remove('active'));
  document.getElementById('pre-all').classList.add('active');
  document.getElementById('pf-mode-both').classList.add('active');
  document.getElementById('pf-mode-submit').classList.remove('active');
  document.getElementById('pf-mode-release').classList.remove('active');
  document.getElementById('pfModeDesc').innerHTML = MODE_DESC['both'];
  document.getElementById('pfFrom').value = '';
  document.getElementById('pfTo').value   = '';
  updatePeriodUI();
  applyPeriodFilter();
  closePeriod();
}

function updatePeriodUI() {
  const valEl = document.getElementById('pfVal');
  const wrap  = document.getElementById('pfWrap');
  const banner= document.getElementById('pfBanner');
  const bTxt  = document.getElementById('pfBannerTxt');
  const bSub  = document.getElementById('pfBannerSub');
  valEl.textContent = PERIOD.label;
  if (PERIOD.active) {
    // Show active dot in trigger
    if (!document.getElementById('pfDot')) {
      const dot = document.createElement('span');
      dot.id = 'pfDot'; dot.className = 'pf-active-dot';
      wrap.insertBefore(dot, wrap.firstChild);
    }
    banner.classList.add('show');
    const modeLabel = FILTER_MODE==='submit'?'Submit Date':FILTER_MODE==='release'?'Release Date':'Submit + Release Date';
    bTxt.textContent = 'Periode aktif: ' + PERIOD.label + ' · Filter: ' + modeLabel;
    const fSpi = filteredSPI().length, fPend = filteredPending().length, fRa = filteredRA().length;
    bSub.textContent = `${fSpi} SPI · ${fPend} Pending · ${fRa} Realization records ditampilkan`;
  } else {
    const dot = document.getElementById('pfDot');
    if (dot) dot.remove();
    banner.classList.remove('show');
  }
}

function applyPeriodFilter() {
  // Re-render all views that use filtered data
  renderSPI();
  renderUtilTable();
  renderRATable();
  renderMain();
  buildPipeline();
  buildProductDonut();
  buildTopCo();
  buildCmpChart();
  buildCmpList();
  buildRevList();
  buildPendingQuick();
  buildRevSummaryStrip();
  buildPendingSummaryStrip();
  buildPendingTable();
  buildLeadTimeAnalytics();
  buildOUChart();
  buildOUChartOverview();
  updateOUOverviewKPIs();
  updateSalesIntelKPIs();
  buildGauge();          // ← fix: gauge must rebuild on filter change
  updateOverviewStats(); // ← fix: insight strip + gauge labels
  updateOverviewKPIs();  // ← fix: KPI cards (calls filteredSPI/RA/Pending)
  buildAvailableQuota(); // ← fix: AVQ chart re-filters per period
  buildFlowKPIStrip();   // ← fix: flow KPI strip re-calculates obtained/utilized
  buildAvqPageKPIs();    // ← fix: Available Quota page KPI cards re-calculate
  // Refresh drill-down modal if currently open
  const drillModal = document.getElementById('obtainedDrillModal');
  if (drillModal && drillModal.style.display !== 'none') refreshObtainedDrill();
  const pendModal = document.getElementById('pendingDrillModal');
  if (pendModal && pendModal.style.display !== 'none') refreshPendingDrill();
  const subModal = document.getElementById('submitDrillModal');
  if (subModal && subModal.style.display !== 'none') refreshSubmitDrill();
  const realModal = document.getElementById('realizedDrillModal');
  if (realModal && realModal.style.display !== 'none') refreshRealizedDrill();
  const raModal = document.getElementById('reapplyDrillModal');
  if (raModal && raModal.style.display !== 'none') refreshReapplyDrill();
}

/* ─────────────────────────────────────────────────────────────────────────
   PERIOD-AWARE KPI ENGINE  — cycle-level, no double counting
   
   KPI 1 Total Submitted  : Submit MOI date of Submit #1 / Submit #2 cycles
   KPI 2 SPI Obtained     : Submit MOT date of Obtained cycles (from SPI only)
   KPI 3 Total Realized   : count of RA companies arrived + ETA JKT in period
   KPI 4 Re-Apply         : eligible/submitted RA companies in period
   KPI 5 Pending          : Submit MOI date of any submit cycle in PENDING
   ───────────────────────────────────────────────────────────────────────── */