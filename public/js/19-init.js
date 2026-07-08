/* ═══════════════════════════════════════
   APP INIT — window.onload
   Available Quota page tabs
   Rev/Pending summary strips
   Last-update clock
═══════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', async () => {
  // ── Disable Chart.js animations globally ──────────────────
  // Boot creates ~10 charts back-to-back; each default-animated chart
  // costs ~200-400ms of main-thread time. Killing animations cuts
  // perceived load time by 2-3s on slower devices without impacting UX.
  if (typeof Chart !== 'undefined' && Chart.defaults) {
    Chart.defaults.animation = false;
    Chart.defaults.animations = { colors: false, x: false, y: false };
    Chart.defaults.responsiveAnimationDuration = 0;
  }

  // ── Load data from PostgreSQL API ──────────────────────────
  // The server is the single source of truth for display. We never
  // merge localStorage into SPI/PENDING/RA anymore — that used to mask
  // newer DB changes from other users with stale local copies.
  // The realization summary loads in parallel — used by the drawer to
  // decide whether to render the "Detail Realization" button + badge.
  await Promise.all([
    loadData(),
    (typeof loadRealizationSummary === 'function' ? loadRealizationSummary() : Promise.resolve()),
  ]);

  // ── Migrate any pending local edits from a previous session ────────
  // If the user had a save fail (e.g. server was down), buffered edits
  // are pushed to DB now — but only if the user's snapshot is strictly
  // newer than the DB row (server-side concurrency check). Stale local
  // entries are discarded so they can't overwrite newer DB data.
  if (typeof migrateLocalToServer === 'function') {
    try {
      const summary = await migrateLocalToServer();
      const total = (summary.pushed||0) + (summary.discardedStale||0) + (summary.conflicts||0) + (summary.failed||0);
      if (total > 0) {
        console.log('[migrateLocalToServer]', summary);
        if (typeof showToast === 'function') {
          if (summary.pushed)         showToast(`Synced ${summary.pushed} pending edit(s) from your last session`, 'success');
          if (summary.discardedStale) showToast(`${summary.discardedStale} pending edit(s) discarded — DB had newer data`, 'warn');
          if (summary.conflicts)      showToast(`${summary.conflicts} pending edit(s) skipped — modified by another user`, 'warn');
          if (summary.failed)         showToast(`${summary.failed} edit(s) couldn't sync; will retry next time`, 'error');
        }
        // After migration, refresh data so display reflects what's actually
        // in the DB (including anything we just pushed).
        await loadData();
      }
    } catch (e) {
      console.error('migrateLocalToServer failed:', e);
    }
  }

  updateStorageStatus();

  // Populate edit dropdown — single flat list, sorted alphabetically A→Z.
  // Label format: "CODE — Full Company Name" (resolved from
  // company_directory). Listing products instead of names was confusing
  // because multiple companies share the same product list.
  // Includes:
  //   1. All existing SPI/PENDING companies (for editing)
  //   2. Companies from company_directory that don't yet have any
  //      submission row — so CorpSec can add a brand-new New Submission
  //      (e.g. PT IKM filing its first MOI). dataset.isNew flags these
  //      so saveEdit POSTs /api/company instead of PATCHing.
  const sel = document.getElementById('editCo');
  const existingCodes = new Set([...SPI, ...PENDING].map(d => d.code));
  const resolveName = code => {
    if (typeof lookupCompanyNameByCode === 'function') {
      const n = lookupCompanyNameByCode(code);
      if (n) return n;
    }
    return '';
  };

  // Build a unified list of {code, name, isNew} entries
  const dropdownEntries = [];
  [...SPI, ...PENDING].forEach(d => {
    dropdownEntries.push({
      code: d.code,
      name: d.fullName || resolveName(d.code) || (d.products || []).join(', '),
      isNew: false,
    });
  });
  (COMPANY_DIRECTORY || []).forEach(d => {
    if (!d.abbreviation || existingCodes.has(d.abbreviation)) return;
    dropdownEntries.push({
      code: d.abbreviation,
      name: d.fullName || '',
      isNew: true,
    });
  });
  dropdownEntries.sort((a, b) => a.code.localeCompare(b.code));
  dropdownEntries.forEach(e => {
    const o = document.createElement('option');
    o.value = e.code;
    o.textContent = `${e.code} — ${e.name}`;
    if (e.isNew) o.dataset.isNew = '1';
    sel.appendChild(o);
  });

  // ── Two-phase render ──────────────────────────────────────
  // Phase 1 (synchronous): only what the user sees first — the Overview
  // page, the KPI strip, and the period filter. Anything tied to a
  // non-active tab (Util / Comparison / Available Quota / SPI page) is
  // pushed to Phase 2 so the initial paint isn't blocked.
  buildPipeline();
  buildProductDonut();
  buildTopCo();
  buildFlowKPIStrip();
  buildOUChartOverview();
  buildRevSummaryStrip();
  buildPendingSummaryStrip();
  updatePeriodUI();
  updateOverviewKPIs();

  // Phase 2 (deferred): off-screen tabs + heavy analytics. Scheduled
  // via requestAnimationFrame + microtask so initial Overview paint
  // commits FIRST, then the rest renders in the next frame. This keeps
  // navigation to other tabs safe (renders complete within ~16-32ms,
  // far faster than human click latency).
  requestAnimationFrame(() => {
    // Group A — table renders for other tabs (cheap, immediate)
    renderSPI();
    renderMain();
    buildRevList();
    buildPendingQuick();
    buildPendingTable();
    buildRevDetailTable();
    buildCmpList();
    // Group B — heavier chart renders, next frame
    requestAnimationFrame(() => {
      buildCmpChart();
      buildGauge();
      buildUtilChart();
      buildAvailableQuota();
      buildOUChart();
      renderUtilTable();
      renderRATable();
      updateOUOverviewKPIs();
      updateSalesIntelKPIs();
      buildLeadTimeAnalytics();
    });
  });
});

/* ── LAST UPDATE (data-edit time from server) ───────────────────────
   Shows when the DATA was last edited (server-provided, identical on every
   device) — NOT a per-device wall clock. Re-rendered by loadData() each fetch.
   The instant is the same for all viewers; it's formatted in local time. */
function renderLastUpdate() {
  const el = document.getElementById('tbDateTime');
  if (!el) return;
  const iso = window.LAST_DATA_UPDATE;
  const d = iso ? new Date(iso) : null;
  if (!d || isNaN(d)) { el.textContent = 'Last update: —'; return; }
  const dd = String(d.getDate()).padStart(2,'0');
  const mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
  const yy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2,'0');
  const mm = String(d.getMinutes()).padStart(2,'0');
  el.textContent = `Last update: ${dd} ${mo} ${yy}  ${hh}:${mm}`;
}
renderLastUpdate();

/* ══════════════════════════════════════════════════
   AVAILABLE QUOTA PAGE — TAB CONTROLLER
══════════════════════════════════════════════════ */
function setAvqTab(tab, el) {
  ['chart','prod','table'].forEach(t => {
    const v = document.getElementById('avqView' + t.charAt(0).toUpperCase() + t.slice(1));
    if (v) v.style.display = (t === tab) ? (t==='chart'?'block':'') : 'none';
  });
  // Reset all tab buttons
  ['avqTabChart','avqTabProd','avqTabTable'].forEach(id => {
    const b = document.getElementById(id);
    if (b) { b.style.background = 'var(--bg)'; b.style.color = 'var(--txt3)'; }
  });
  if (el) { el.style.background = 'var(--navy)'; el.style.color = '#fff'; }
  // Set display of prod view properly
  const pv = document.getElementById('avqViewProd');
  if (pv) pv.style.display = tab==='prod' ? 'block' : 'none';
  const tv = document.getElementById('avqViewTable');
  if (tv) tv.style.display = tab==='table' ? 'block' : 'none';
  // Rebuild if needed
  if (tab === 'prod')  buildAvqProdGrid();
  if (tab === 'table') buildAvqTable();
}

/* ── KPI cards on Available Quota page ── */
function buildAvqPageKPIs() {
  // Obtained basis MUST match the AVQ breakdown chart directly below these cards
  // (buildAvailableQuota uses canonicalObtained). Using the PERTEK-gated
  // canonicalObtainedFiltered here made the cards read 0 while the breakdown
  // showed the real balance for the same companies — a page-internal
  // contradiction. canonicalObtained honours the ledger and, for an active
  // period, counts every company that companyInPeriod() surfaces (i.e. any
  // Submit/Obtained/Revision-Request activity in range), showing its balance.
  // NOTE: this intentionally diverges from Overview KPI2 (quota *issued* in the
  // period) — the AVQ page answers "balance of companies active this period".
  let totalObt = 0, totalUtil = 0, totalAvq = 0, coSet = new Set();
  [...filteredSPI(), ...filteredPending()].forEach(co => {
    const coObt = (typeof canonicalObtained === 'function')
      ? canonicalObtained(co) : canonicalObtainedFiltered(co);
    if (coObt <= 0) return;
    const util  = scopedUtilTotal(co);   // period-aware (rule #3): util sliced by lot date
    const avail = PERIOD.active ? Math.max(0, coObt - util)
                                : (co.availableQuota != null ? co.availableQuota : Math.max(0, coObt - util));
    totalObt  += coObt;
    totalUtil += util;
    totalAvq  += avail;
    if (avail > 0) coSet.add(co.code);
  });

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('avqKpi1', fmtMt(totalAvq));
  set('avqKpi2', fmtMt(totalObt));
  set('avqKpi3', fmtMt(totalUtil));
  set('avqKpi4', coSet.size);

  const utilPct = totalObt > 0 ? (totalUtil / totalObt * 100).toFixed(1) : 0;
  const avqPct  = totalObt > 0 ? (totalAvq  / totalObt * 100).toFixed(1) : 0;

  const f1 = document.getElementById('avqKpiFill1');
  if (f1) f1.style.width = avqPct + '%';
  const f3 = document.getElementById('avqKpiFill3');
  if (f3) f3.style.width = utilPct + '%';

  const t1 = document.getElementById('avqKpiTag1');
  if (t1) t1.textContent = avqPct + '% of obtained remaining';
  const t3 = document.getElementById('avqKpiTag3');
  if (t3) t3.textContent = utilPct + '% utilization rate';
}

/* ── By Product grid view ── */
function buildAvqProdGrid() {
  const grid = document.getElementById('avqProdGrid');
  if (!grid) return;
  const prodMap = {}; // product → { obtained, util, avail, companies[] }
  filteredSPI().forEach(co => {
    const ap = scopedAvailByProd(co);   // period-aware (rule #3): util sliced by lot date
    const up = scopedUtilByProd(co);
    // Deduped per-product obtained map (legacy DB has duplicate Obtained
    // cycle rows; without dedup totals multiply by the duplicate factor).
    const cycleProds = (typeof getObtainedByProdAgg === 'function')
      ? getObtainedByProdAgg(co) : {};
    // Collect per-product data.
    // β-1: iterate products that actually carry quota (util+avail from
    // company_product_stats), NOT the stale co.products list, and use util+avail
    // as obtained — no even-split fallback. Fixes mis-assignment after a
    // product-change revision left co.products stale (e.g. GAS/MJU still listing
    // BORDES ALLOY after moving to GI BORON / HOLLOW PIPE).
    Object.keys(cycleProds).forEach(p => {
      if (!prodMap[p]) prodMap[p] = { obtained:0, util:0, avail:0, cos:[] };
      const obtForProd  = Number(cycleProds[p]) || 0;
      const utilForProd = Number(up[p]) || 0;
      const avqForProd  = ap[p] != null ? Number(ap[p]) : (obtForProd - utilForProd);
      prodMap[p].obtained += obtForProd;
      prodMap[p].util     += utilForProd;
      prodMap[p].avail    += Number(avqForProd) || 0;
      prodMap[p].cos.push(co.code);
    });
  });
  const PROD_CLR = {
    'GL BORON':'#0369a1','GI BORON':'#0f766e','SHEETPILE':'#b45309',
    'BORDES ALLOY':'#dc2626','PPGL CARBON':'#7c3aed','ERW PIPE OD≤140mm':'#9333ea',
    'ERW PIPE OD>140mm':'#0891b2','AS STEEL':'#64748b','Hollow Pipe':'#78716c',
    'SEAMLESS PIPE':'#0d6946','HRC/HRPO ALLOY':'#ca8a04',
  };
  const clr = p => { for (const k in PROD_CLR) if (p && p.toUpperCase().includes(k.toUpperCase())) return PROD_CLR[k]; return '#64748b'; };
  // Store prodMap for popup use
  grid._prodMap = prodMap;

  const entries = Object.entries(prodMap).sort((a,b) => b[1].avail - a[1].avail);
  grid.innerHTML = entries.map(([prod, d]) => {
    // Suppress tiny negative avail (XLSX manual re-allocation rounding artifacts)
    const dispAvail = snapZero(d.avail);
    const utilPct = d.obtained > 0 ? Math.min((d.util / d.obtained * 100), 100).toFixed(0) : 0;
    const avqPct  = d.obtained > 0 ? Math.max(0, Math.min((dispAvail / d.obtained * 100), 100)).toFixed(0) : 0;
    const c = clr(prod);
    return `<div style="border:1px solid var(--border);border-radius:var(--r2);overflow:hidden;box-shadow:var(--sh)">
      <div style="background:${c};padding:9px 14px;display:flex;justify-content:space-between;align-items:center">
        <span style="font-size:11.5px;font-weight:700;color:#fff">${prod}</span>
        <span onclick="openProdCoPopup(event,'${prod.replace(/'/g,"\\'")}',this)"
          style="font-size:10px;font-weight:700;padding:2px 9px;border-radius:3px;background:rgba(255,255,255,.22);color:#fff;
          cursor:pointer;border:1px solid rgba(255,255,255,.35);transition:background .15s;user-select:none"
          onmouseover="this.style.background='rgba(255,255,255,.38)'"
          onmouseout="this.style.background='rgba(255,255,255,.22)'"
          title="Click to see company breakdown">
          ${d.cos.length} co. ▾
        </span>
      </div>
      <div style="padding:10px 14px">
        <div style="display:flex;justify-content:space-between;margin-bottom:8px">
          <div style="text-align:center;flex:1"><div style="font-size:16px;font-weight:700;color:var(--teal)">${fmtMt(d.obtained)}</div><div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--txt3)">Obtained</div></div>
          <div style="text-align:center;flex:1"><div style="font-size:16px;font-weight:700;color:var(--green)">${fmtMt(d.util)}</div><div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--txt3)">Utilized</div></div>
          <div style="text-align:center;flex:1"><div style="font-size:16px;font-weight:700;color:${c}">${fmtMt(dispAvail)}</div><div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--txt3)">Available</div></div>
        </div>
        <div style="height:6px;background:var(--border);border-radius:3px;overflow:hidden;margin-bottom:5px">
          <div style="height:6px;background:${c};border-radius:3px;width:${avqPct}%;transition:width .8s"></div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--txt3)">
          <span>${avqPct}% available</span>
          <span style="font-size:9.5px;color:var(--txt3)">${d.cos.slice(0,4).join(', ')}${d.cos.length>4?'…':''}</span>
        </div>
      </div>
    </div>`;
  }).join('');
}

/* ── Product → Company popup ─────────────────────────────────────────── */
function openProdCoPopup(event, prodName, anchorEl) {
  event.stopPropagation();
  const popup  = document.getElementById('prodCoPopup');
  const box    = document.getElementById('prodCoPopupBox');
  if (!popup || !box) return;

  const PROD_CLR = {
    'GL BORON':'#0369a1','GI BORON':'#0f766e','SHEETPILE':'#b45309',
    'BORDES ALLOY':'#dc2626','PPGL CARBON':'#7c3aed','ERW PIPE OD≤140mm':'#9333ea',
    'ERW PIPE OD>140mm':'#0891b2','AS STEEL':'#64748b','HOLLOW PIPE':'#78716c',
    'SEAMLESS PIPE':'#0d6946','HRC/HRPO ALLOY':'#ca8a04',
  };
  const clr = p => { for (const k in PROD_CLR) if (p && p.toUpperCase().includes(k.toUpperCase())) return PROD_CLR[k]; return '#64748b'; };
  const col = clr(prodName);

  // Position popup near the clicked badge
  const rect = anchorEl.getBoundingClientRect();
  popup.style.display = 'block';
  // position after display so we can measure box
  requestAnimationFrame(() => {
    const bw = box.offsetWidth  || 520;
    const bh = box.offsetHeight || 400;
    let left = rect.left;
    let top  = rect.bottom + 8;
    if (left + bw > window.innerWidth  - 12) left = window.innerWidth  - bw - 12;
    if (top  + bh > window.innerHeight - 12) top  = rect.top - bh - 8;
    if (left < 8) left = 8;
    if (top  < 8) top  = 8;
    box.style.left = left + 'px';
    box.style.top  = top  + 'px';
  });

  // Header
  document.getElementById('prodCoPopupHdr').style.background = col;
  document.getElementById('prodCoPopupTitle').textContent = prodName;

  // Collect per-company data for this product
  const coRows = [];
  filteredSPI().forEach(co => {
    const ap  = scopedAvailByProd(co);   // period-aware (rule #3)
    const up  = scopedUtilByProd(co);
    const cycleProds = (typeof getObtainedByProdAgg === 'function')
      ? getObtainedByProdAgg(co) : {};
    // β-1: include a company only if it actually holds quota (util+avail) for
    // this product, sourced from company_product_stats — NOT the stale
    // co.products list. obtForProd = util+avail; no even-split fallback (which
    // used to assign a company's whole total to a product it no longer holds,
    // e.g. GAS/MJU still appearing under Bordes after revising to GI/Hollow).
    const obtForProd = Number(cycleProds[prodName]) || 0;
    if (obtForProd <= 0) return;
    const utilForProd = Number(up[prodName]) || 0;
    const avqForProd  = ap[prodName] != null ? Number(ap[prodName]) : (obtForProd - utilForProd);
    coRows.push({ code: co.code, group: co.group, obt: obtForProd, util: utilForProd, avq: avqForProd });
  });
  coRows.sort((a, b) => b.avq - a.avq);

  const totalObt  = coRows.reduce((s, r) => s + r.obt,  0);
  const totalUtil = coRows.reduce((s, r) => s + r.util, 0);
  const totalAvq  = coRows.reduce((s, r) => s + r.avq,  0);

  document.getElementById('prodCoPopupSub').textContent =
    `${coRows.length} compan${coRows.length !== 1 ? 'ies' : 'y'} · ${fmtMt(totalAvq)} MT available`;

  // Summary strip
  document.getElementById('prodCoPopupStrip').innerHTML = [
    ['Obtained', totalObt,  'var(--teal)'],
    ['Utilized', totalUtil, 'var(--green)'],
    ['Available',totalAvq,  col],
  ].map(([lbl, val, c2]) => `
    <div style="flex:1;text-align:center;padding:8px 6px;border-right:1px solid var(--border)">
      <div style="font-size:15px;font-weight:800;color:${c2};font-family:'DM Mono',monospace">${fmtMt(val)}</div>
      <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--txt3);margin-top:1px">${lbl}</div>
    </div>`).join('');

  // Company list
  const maxObt = Math.max(...coRows.map(r => r.obt), 1);
  document.getElementById('prodCoPopupList').innerHTML = coRows.map(r => {
    const utilPct = r.obt > 0 ? (r.util / r.obt * 100).toFixed(0) : 0;
    const avqPct  = r.obt > 0 ? Math.max(0, r.avq  / r.obt * 100).toFixed(0) : 0;
    const barUtil = (r.util / maxObt * 100).toFixed(1);
    const barAvq  = (Math.max(0, r.avq) / maxObt * 100).toFixed(1);
    const avqCol  = r.avq > 0 ? col : 'var(--red2)';
    const co = getSPI(r.code);
    const grpBadge = `<span style="font-size:9px;font-weight:700;padding:1px 5px;border-radius:3px;
      background:${r.group==='CD'?'#e0f2fe':'#f0fdf4'};
      color:${r.group==='CD'?'#0369a1':'#166534'}">${r.group}</span>`;
    return `<div style="padding:10px 18px;border-bottom:1px solid var(--border);cursor:pointer;transition:background .12s"
      onmouseover="this.style.background='var(--bg2)'" onmouseout="this.style.background=''"
      onclick="closeProdCoPopup();setTimeout(()=>openDrawer('${r.code}'),80)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
        <div style="display:flex;align-items:center;gap:6px">
          <span style="font-size:13px;font-weight:800;color:var(--navy)">${r.code}</span>
          ${grpBadge}
        </div>
        <div style="display:flex;align-items:center;gap:10px">
          <span style="font-size:11px;color:var(--txt3)">Obt <strong style="color:var(--teal)">${fmtMt(r.obt)}</strong></span>
          <span style="font-size:11px;color:var(--txt3)">Used <strong style="color:var(--green)">${r.util > 0 ? fmtMt(r.util) : '—'}</strong></span>
          <span style="font-size:13px;font-weight:800;color:${avqCol};font-family:'DM Mono',monospace">${fmtMt(r.avq)} MT</span>
        </div>
      </div>
      <div style="position:relative;height:7px;background:var(--border);border-radius:4px;overflow:hidden">
        <div style="position:absolute;inset:0;background:${col}22;border-radius:4px"></div>
        <div style="position:absolute;top:0;left:0;height:100%;width:${barUtil}%;background:${col};opacity:.45;border-radius:4px"></div>
        <div style="position:absolute;top:0;left:${barUtil}%;height:100%;width:${barAvq}%;background:${avqCol};border-radius:0 4px 4px 0"></div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:9px;color:var(--txt3);margin-top:3px">
        <span>${utilPct}% utilized</span>
        <span style="color:${avqCol};font-weight:600">${avqPct}% available · click to open →</span>
      </div>
    </div>`;
  }).join('');
}

function closeProdCoPopup() {
  const p = document.getElementById('prodCoPopup');
  if (p) p.style.display = 'none';
}

/* ── Table view ── */
/* ── HS filter state for the full-detail avqTable ── */
let _avqTableHsFilter = '';
let _avqTableHsSearch = '';

function avqTableSetHsFilter(hs, el) {
  _avqTableHsFilter = hs;
  _avqTableHsSearch = '';
  const si = document.getElementById('avqTableHsSearch'); if (si) si.value = '';
  document.querySelectorAll('.avq-tbl-hs-chip').forEach(c => c.classList.remove('avq-chip-on'));
  if (el) el.classList.add('avq-chip-on');
  buildAvqTable();
}
function avqTableApplyHsSearch(val) {
  _avqTableHsSearch = val.trim().toLowerCase();
  _avqTableHsFilter = '';
  document.querySelectorAll('.avq-tbl-hs-chip').forEach(c => c.classList.remove('avq-chip-on'));
  const allChip = document.querySelector('.avq-tbl-hs-chip[data-hs=""]');
  if (!_avqTableHsSearch && allChip) allChip.classList.add('avq-chip-on');
  buildAvqTable();
}

function buildAvqTable() {
  const tbody = document.getElementById('avqTableBody');
  if (!tbody) return;

  // Build all rows with HS code
  const allRows = [];
  filteredSPI().forEach(co => {
    // Use canonical obtained — not raw co.obtained from DB
    const obtained = canonicalObtained(co) || co.obtained || 0;
    if (obtained <= 0) return;
    const ap = scopedAvailByProd(co);   // period-aware (rule #3)
    const up = scopedUtilByProd(co);
    const spi = getSPI(co.code);
    const grp = spi ? spi.group : '';
    const getHS = p => (typeof PROD_HS_CODES !== 'undefined' ? (PROD_HS_CODES[p] || '—') : '—');
    if (Object.keys(ap).length > 0) {
      // Deduped per-product obtained — avoids multiplying when DB has
      // duplicate Obtained cycle rows for the same cycle_type.
      const cycleProds = (typeof getObtainedByProdAgg === 'function')
        ? getObtainedByProdAgg(co) : {};
      // rule #4: iterate the post-revision obtained product set (util+avail),
      // NOT the stale co.products list, and use the actual per-product obtained
      // (no even-split fallback that would mis-assign a revised-away product).
      Object.keys(cycleProds).forEach(p => {
        const obt  = Number(cycleProds[p]) || 0;
        if (obt <= 0) return;
        const util = up[p] || 0;
        const avq  = ap[p] != null ? ap[p] : (obt - util);
        allRows.push({ code:co.code, grp, prod:p, hs:getHS(p), obt, util, avq, updBy:co.updatedBy||'', updDate:co.updatedDate||'' });
      });
    } else {
      const util = scopedUtilTotal(co);
      const avq  = PERIOD.active ? Math.max(0, obtained - util)
                                 : (co.availableQuota != null ? co.availableQuota : (obtained - util));
      (co.products || [co.products[0] || '—']).forEach(p => {
        allRows.push({ code:co.code, grp, prod:p, hs:getHS(p), obt:obtained/((co.products||[p]).length), util, avq, updBy:co.updatedBy||'', updDate:co.updatedDate||'' });
      });
    }
  });
  allRows.sort((a,b) => b.avq - a.avq);

  // ── Build HS filter chip bar ──────────────────────────────────────
  const hsSet    = new Set(allRows.map(r => r.hs).filter(h => h && h !== '—'));
  const hsSorted = ['', ...Array.from(hsSet).sort()];
  const chipsEl  = document.getElementById('avqTableHsChips');
  if (chipsEl) {
    chipsEl.innerHTML = hsSorted.map(hs => {
      const label  = hs === '' ? 'All' : hs;
      const isOn   = (_avqTableHsFilter === hs && !_avqTableHsSearch) || (hs==='' && !_avqTableHsFilter && !_avqTableHsSearch);
      return `<button class="avq-tbl-hs-chip${isOn?' avq-chip-on':''}" data-hs="${hs}"
        onclick="avqTableSetHsFilter('${hs}',this)"
        style="font-size:10px;font-weight:700;padding:3px 9px;border-radius:20px;cursor:pointer;
          border:1px solid ${isOn?'var(--navy)':'var(--border2)'};
          background:${isOn?'var(--navy)':'var(--bg)'};
          color:${isOn?'#fff':'var(--txt3)'};
          transition:all .15s;white-space:nowrap">
        ${label}
      </button>`;
    }).join('');
  }

  // ── Apply filter ──────────────────────────────────────────────────
  let rows = allRows;
  if (_avqTableHsFilter) rows = rows.filter(r => r.hs === _avqTableHsFilter);
  if (_avqTableHsSearch) rows = rows.filter(r =>
    r.prod.toLowerCase().includes(_avqTableHsSearch) ||
    r.hs.toLowerCase().includes(_avqTableHsSearch) ||
    r.code.toLowerCase().includes(_avqTableHsSearch)
  );

  tbody.innerHTML = rows.map(r => {
    const utilPct = r.obt > 0 ? (r.util / r.obt * 100) : 0;
    const fill = utilPct >= 80 ? 'var(--red2)' : utilPct >= 50 ? 'var(--amber-lt)' : 'var(--green-lt)';
    const hsHl = (_avqTableHsFilter && r.hs === _avqTableHsFilter)
      ? 'font-weight:700;color:var(--navy)'
      : 'color:var(--txt3)';
    return `<tr>
      <td><div class="t-code" onclick="openDrawer('${r.code}')">${r.code}</div></td>
      <td style="font-size:11.5px;font-weight:600">${r.grp}</td>
      <td><span class="chip" style="background:#f0f9ff;color:#0369a1;font-size:10px;padding:2px 7px">${r.prod}</span></td>
      <td style="font-size:10.5px;font-family:'DM Mono',monospace;${hsHl}">${r.hs}</td>
      <td class="t-r t-mono">${fmtMt(r.obt)}</td>
      <td class="t-r t-mono" style="color:var(--green)">${r.util > 0 ? fmtMt(r.util) : '<span style="color:var(--txt3)">—</span>'}</td>
      <td class="t-r t-mono" style="color:#0891b2;font-weight:700">${fmtMt(r.avq)}</td>
      <td>
        <div style="display:flex;align-items:center;gap:6px">
          <div style="flex:1;height:5px;background:var(--border);border-radius:3px;overflow:hidden">
            <div style="height:5px;background:${fill};border-radius:3px;width:${Math.min(utilPct,100).toFixed(0)}%"></div>
          </div>
          <span style="font-size:10.5px;font-weight:600;color:${fill};width:36px;text-align:right">${utilPct.toFixed(0)}%</span>
        </div>
      </td>
      <td style="font-size:10px;color:var(--txt3)">${r.updDate || '—'}</td>
    </tr>`;
  }).join('');
}

/* ── By-Product bar chart (bottom of page) ── */
function buildAvqProdChart() {
  const el = document.getElementById('avqProdChart');
  if (!el) return;
  const prodMap = {};
  filteredSPI().forEach(co => {
    const ap = scopedAvailByProd(co);   // period-aware (rule #3)
    const up = scopedUtilByProd(co);
    // Use deduped helper so legacy duplicate Obtained #N rows don't
    // multiply the per-product obtained MT (was producing huge values
    // like GL BORON ~600,000 MT vs real total of 22,870 MT).
    const cycleProds = (typeof getObtainedByProdAgg === 'function')
      ? getObtainedByProdAgg(co) : {};
    // β-1: iterate products with actual quota (util+avail), not the stale
    // co.products list; obtained = util+avail (no even-split fallback).
    Object.keys(cycleProds).forEach(p => {
      if (!prodMap[p]) prodMap[p] = { obtained:0, util:0, avail:0 };
      const obt = Number(cycleProds[p]) || 0;
      prodMap[p].obtained += obt;
      prodMap[p].util     += Number(up[p]) || 0;
      prodMap[p].avail    += ap[p] != null ? (Number(ap[p]) || 0) : Math.max(obt - (Number(up[p])||0), 0);
    });
  });
  const sorted = Object.entries(prodMap).sort((a,b) => b[1].obtained - a[1].obtained);
  if (CH['avqProdChart']) CH['avqProdChart'].destroy();
  CH['avqProdChart'] = new Chart(el, {
    type: 'bar',
    data: {
      labels: sorted.map(([k]) => k),
      datasets: [
        { label:'Obtained', data: sorted.map(([,v]) => Math.round(v.obtained)), backgroundColor:'rgba(12,124,132,.22)', borderColor:'#0c7c84', borderWidth:1, borderRadius:3 },
        { label:'Utilized', data: sorted.map(([,v]) => Math.round(v.util)),     backgroundColor:'rgba(33,197,93,.65)',  borderColor:'#21c55d', borderWidth:0, borderRadius:3 },
        { label:'Available',data: sorted.map(([,v]) => Math.round(v.avail)),    backgroundColor:'rgba(8,145,178,.65)',  borderColor:'#0891b2', borderWidth:0, borderRadius:3 },
      ]
    },
    options: {
      responsive:true,
      plugins:{
        legend:{ labels:{ font:{size:11,family:'DM Sans'}, color:'#4a5568', boxWidth:10, padding:12 } },
        tooltip:{ mode:'index', intersect:false }
      },
      scales:{
        x:{ grid:{display:false}, ticks:{font:{size:10.5,family:'DM Sans'},color:'#1a1f2e'} },
        y:{ grid:{color:'#f1f5f9'}, ticks:{font:{size:10},color:'#64748b',callback:v=>v.toLocaleString()+' MT'} }
      }
    }
  });
}

/* ══════════════════════════════════════════════════
   COMPACT STATUS STRIPS (Overview)
══════════════════════════════════════════════════ */
function buildRevSummaryStrip() {
  const el = document.getElementById('revSummaryStrip');
  if (!el) return;
  const badge = document.getElementById('revCardBadge');
  // Group by revisionStatus
  const active  = filteredSPI().filter(d => revisionStatus(d) === 'active');
  const reapply = filteredSPI().filter(d => revisionStatus(d) === 'reapply');
  const revpend = filteredSPI().filter(d => revisionStatus(d) === 'revpending');
  const total   = active.length + reapply.length + revpend.length;
  if (badge) badge.textContent = total + ' Active';

  const groups = [
    { items: active,  label: '🔄 Under Revision', color:'var(--amber)',  bg:'var(--amber-bg)',  bd:'var(--amber-bd)' },
    { items: reapply, label: '📨 Re-Apply Submit', color:'#7c3aed',      bg:'#f5f3ff',          bd:'#c4b5fd' },
    { items: revpend, label: '⏳ PERTEK Pending',  color:'var(--red2)',   bg:'var(--red-bg)',    bd:'var(--red-bd)' },
  ].filter(g => g.items.length > 0);

  el.innerHTML = groups.map(g => `
    <div style="padding:5px 8px;background:${g.bg};border:1px solid ${g.bd};border-radius:var(--r);display:flex;align-items:center;justify-content:space-between">
      <span style="font-size:10.5px;font-weight:700;color:${g.color}">${g.label}</span>
      <div style="display:flex;flex-wrap:wrap;gap:3px;justify-content:flex-end;max-width:65%">
        ${g.items.map(d => `<span style="font-size:10px;font-weight:700;padding:1px 6px;border-radius:3px;background:rgba(0,0,0,.06);color:${g.color}">${d.code}</span>`).join('')}
      </div>
    </div>`).join('');
}

function buildPendingSummaryStrip() {
  const el    = document.getElementById('pendingSummaryStrip');
  const mtEl  = document.getElementById('pendTotalMT');
  const bdgEl = document.getElementById('pendingCardBadge');
  if (!el) return;
  const pending = filteredPending();
  const totalMT = pending.reduce((s,d) => s + (d.mt||0), 0);
  if (mtEl)  mtEl.textContent  = fmtMt(totalMT) + ' MT';
  if (bdgEl) bdgEl.textContent = pending.length + ' Pending';
  el.innerHTML = pending.map(d => {
    const daysEl = d.date ? (() => {
      const parsed = pDate(d.date);
      if (!parsed) return '';
      const days = Math.round((Date.now() - parsed) / 86400000);
      const col = days > 90 ? 'var(--red2)' : days > 30 ? 'var(--amber)' : 'var(--txt3)';
      return `<span style="font-size:9.5px;font-weight:600;color:${col}">⏱ ${days}d</span>`;
    })() : '';
    return `<div style="display:flex;align-items:center;gap:5px;padding:4px 9px;background:var(--red-bg);border:1px solid var(--red-bd);border-radius:var(--r)">
      <span style="font-size:11px;font-weight:700;color:var(--red2)">${d.code}</span>
      <span style="font-size:9.5px;color:var(--txt3)">${fmtMt(d.mt||0)} MT</span>
      ${daysEl}
    </div>`;
  }).join('');
}

/* ── Active Revisions popup (Overview insight → modal, no page navigation) ──
   Replaces the old behaviour where the insight card jumped to the PERTEK &
   SPI page. Shows the same Revision / Re-Apply / PERTEK-Pending breakdown in
   a self-contained modal; clicking a company chip opens its drawer. */
function openActiveRevPopup() {
  const modal = document.getElementById('activeRevModal');
  const body  = document.getElementById('activeRevBody');
  if (!modal || !body) return;
  const active  = filteredSPI().filter(d => revisionStatus(d) === 'active');
  const reapply = filteredSPI().filter(d => revisionStatus(d) === 'reapply');
  const revpend = filteredSPI().filter(d => revisionStatus(d) === 'revpending');
  const total   = active.length + reapply.length + revpend.length;
  const sub = document.getElementById('activeRevSubtitle');
  if (sub) sub.textContent = `${active.length} Under Revision · ${reapply.length} Re-Apply · ${revpend.length} PERTEK Pending`;
  const groups = [
    { items: active,  label: '🔄 Under Revision', color:'var(--amber)', bg:'var(--amber-bg)', bd:'var(--amber-bd)' },
    { items: reapply, label: '📨 Re-Apply Submit', color:'#7c3aed',      bg:'#f5f3ff',         bd:'#c4b5fd' },
    { items: revpend, label: '⏳ PERTEK Pending',  color:'var(--red2)',   bg:'var(--red-bg)',   bd:'var(--red-bd)' },
  ].filter(g => g.items.length > 0);
  body.innerHTML = total === 0
    ? `<div style="text-align:center;color:var(--txt3);padding:24px 0;font-size:12px">No active revisions right now.</div>`
    : groups.map(g => `
      <div style="border:1px solid ${g.bd};border-radius:var(--r);overflow:hidden">
        <div style="padding:7px 12px;background:${g.bg};font-size:11px;font-weight:700;color:${g.color};display:flex;justify-content:space-between;align-items:center">
          <span>${g.label}</span><span>${g.items.length}</span>
        </div>
        <div style="padding:9px 12px;display:flex;flex-wrap:wrap;gap:5px">
          ${g.items.map(d => `<span onclick="closeActiveRevPopup();openDrawer('${d.code}')" title="Buka detail ${d.code}" style="cursor:pointer;font-size:11px;font-weight:700;padding:2px 9px;border-radius:4px;background:rgba(0,0,0,.05);color:${g.color}">${d.code}</span>`).join('')}
        </div>
      </div>`).join('');
  modal.style.display = 'block';
}
function closeActiveRevPopup() {
  const modal = document.getElementById('activeRevModal');
  if (modal) modal.style.display = 'none';
}

/* Trigger rebuild when navigating to availquota page */
const _origGoPage = typeof goPage === 'function' ? goPage : null;

/* ══════════════════════════════════════════════════
   TOAST — non-blocking error / success notifications
   Used to surface PATCH failures so users know a save
   didn't persist (instead of silently swallowing in console).
══════════════════════════════════════════════════ */
function showToast(msg, kind) {
  kind = kind || 'error';
  let host = document.getElementById('_toastHost');
  if (!host) {
    host = document.createElement('div');
    host.id = '_toastHost';
    host.style.cssText = 'position:fixed;bottom:22px;left:50%;transform:translateX(-50%);z-index:1100;display:flex;flex-direction:column;gap:8px;pointer-events:none;max-width:90vw';
    document.body.appendChild(host);
  }
  const colors = {
    error:   { bg:'#fee2e2', bd:'#fecaca', fg:'#991b1b', ico:'⚠' },
    success: { bg:'#dcfce7', bd:'#a7f3c4', fg:'#15803d', ico:'✓' },
    info:    { bg:'#e0f2fe', bd:'#c3d3f9', fg:'#1e3a8a', ico:'ℹ' },
  };
  const c = colors[kind] || colors.error;
  const t = document.createElement('div');
  t.style.cssText = `pointer-events:auto;background:${c.bg};border:1px solid ${c.bd};color:${c.fg};padding:9px 14px;border-radius:8px;font:600 12px 'DM Sans',sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.12);display:flex;align-items:center;gap:8px;animation:fadeUp .2s ease`;
  t.innerHTML = `<span style="font-size:14px">${c.ico}</span><span>${msg}</span>`;
  host.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .25s'; }, 4000);
  setTimeout(() => t.remove(), 4400);
}

/* notifySaveError — used by patchToServer .catch handlers to surface errors */
function notifySaveError(context, err) {
  const msg = err && err.message ? err.message : String(err);
  console.warn(`[${context}] save failed:`, err);
  showToast(`Save failed (${context}): ${msg}`, 'error');
}

/* ══════════════════════════════════════════════════
   GLOBAL ESC KEY — close topmost visible overlay
   Order matters: close highest z-index first.
══════════════════════════════════════════════════ */
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;

  // 1. Inline tooltip popups (z-index 800)
  const popup = document.getElementById('prodCoPopup');
  if (popup && popup.style.display !== 'none') { closeProdCoPopup(); return; }

  // 2. Drill-down modals (z-index 700) — close whichever is visible
  const drillIds = [
    'obtainedDrillModal','submitDrillModal','realizedDrillModal','avqDrillModal',
    'utilDrillModal','reapplyDrillModal','pendingDrillModal','leadTimeDrillModal','salesPriorityModal',
  ];
  const drillCloseFns = {
    obtainedDrillModal:'closeObtainedDrill', submitDrillModal:'closeSubmitDrill',
    realizedDrillModal:'closeRealizedDrill', avqDrillModal:'closeAvqDrill',
    utilDrillModal:'closeUtilDrill', reapplyDrillModal:'closeReapplyDrill',
    pendingDrillModal:'closePendingDrill', leadTimeDrillModal:'closeLeadTimeDrill',
    salesPriorityModal:'closeSalesPriority',
  };
  for (const id of drillIds) {
    const m = document.getElementById(id);
    if (m && m.style.display !== 'none' && m.style.display !== '') {
      const fn = window[drillCloseFns[id]];
      if (typeof fn === 'function') { fn(); return; }
      m.style.display = 'none'; return;
    }
  }

  // 3. Import modal (z-index 600)
  const im = document.getElementById('importModal');
  if (im && im.classList.contains('open') && typeof closeImport === 'function') { closeImport(); return; }

  // 4. Drawer overlay (z-index 500)
  const ov = document.getElementById('overlay');
  if (ov && ov.classList.contains('open') && typeof closeDrawer === 'function') { closeDrawer(); return; }

  // 5. Period filter panel (z-index 400)
  const pf = document.getElementById('pfPanel');
  if (pf && pf.classList.contains('open') && typeof closePeriod === 'function') { closePeriod(); return; }

  // 6. Search dropdown (z-index 400)
  const sd = document.querySelector('.s-drop.open');
  if (sd) { sd.classList.remove('open'); return; }
});