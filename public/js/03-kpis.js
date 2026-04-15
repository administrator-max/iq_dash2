/* ═══════════════════════════════════════
   OVERVIEW KPIs + DRILL-DOWN MODALS
═══════════════════════════════════════ */

function updateOverviewKPIs() {
  const kpis = document.querySelectorAll('#page-overview .kpi');

  /* ── KPI 1: Total Submitted ──────────────────────────────────────────── */
  let totalSubmitMT = 0, submitCoSet = new Set();
  const allForSubmit = [...SPI, ...PENDING]; // includes PERTEK Pending companies
  allForSubmit.forEach(co => {
    (co.cycles || []).forEach(c => {
      // Match Submit cycles only — Revision cycles are product modifications, not new MT
      // Same logic as breakdown grand total (revision shown informational only)
      const isSubmit = /^submit/i.test(c.type) && !/obtained/i.test(c.type);
      if (!isSubmit) return;
      const mt = typeof c.mt === 'number' ? c.mt : 0;
      if (mt <= 0) return;
      const d = pDate(c.submitDate);
      if (!PERIOD.active || inPd(d)) {
        totalSubmitMT += mt;
        submitCoSet.add(co.code);
      }
    });
  });

  /* ── KPI 2: SPI/PERTEK Obtained — filter by PERTEK Terbit date ────────
     PERTEK Terbit = releaseDate of the Submit #N cycle paired with each
     Obtained #N cycle. This is the "release date" that the filter period
     refers to: "which PERTEK was officially issued in November 2025?"
  ─────────────────────────────────────────────────────────────────────── */
  let totalObtainedMT = 0, obtCoSet = new Set();
  SPI.forEach(co => {
    const allCycles = co.cycles || [];
    // Dedup: take only FIRST occurrence of each cycleType per company
    // (prevents double-counting when DB has multiple rows per product for same cycle)
    const _seenCycleTypes = new Set();
    allCycles.forEach(c => {
      if (!/^obtained #/i.test(c.type)) return;
      const mt = typeof c.mt === 'number' ? c.mt : 0;
      if (mt <= 0) return;
      const cycleKey = c.type.toLowerCase().trim();
      if (_seenCycleTypes.has(cycleKey)) return; // skip duplicates
      _seenCycleTypes.add(cycleKey);
      const pertekTerbit = getPertekTerbitForObtained(c, allCycles);
      if (!PERIOD.active || inPd(pertekTerbit)) {
        totalObtainedMT += mt;
        obtCoSet.add(co.code);
      }
    });
  });

  /* ── KPI 3: Total Realized (company count) ──────────────────────────── */
  // Filter by arrivalDate (YYYY-MM-DD) — etaJKT is human-readable text, not parseable
  const arrivedRa = RA.filter(r => {
    if (!r.cargoArrived) return false;
    if (!PERIOD.active) return true;
    const ad = r.arrivalDate ? new Date(r.arrivalDate) : null;
    return inPd(ad);
  });
  const realizedCount   = arrivedRa.length;
  const totalRealizedMT = arrivedRa.reduce((s, r) => s + r.berat, 0);
  const arrivedCodes    = arrivedRa.map(r => r.code).join(', ') || '—';

  /* ── KPI 4: Re-Apply Eligible / Submitted ───────────────────────────── */
  // Scope re-apply pool to companies whose SPI cycles match the active period
  // (same logic as filteredSPI) — avoids using un-parseable etaJKT text
  const _raFilterCodes = new Set(
    PERIOD.active ? SPI.filter(co => companyInPeriod(co.cycles||[])).map(co => co.code) : []
  );
  const raPool = PERIOD.active
    ? RA.filter(r => _raFilterCodes.has(r.code))
    : RA;
  const eligCount      = raPool.filter(isEligible).length;
  const submittedCount = raPool.filter(isReapplySubmitted).length;
  const reapplyTotal   = eligCount + submittedCount;

  /* ── KPI 5: Pending MT ─────────────────────────────────────────────── */
  let pendMT = 0; const pendCoSet = new Set();
  PENDING.forEach(p => {
    const inScope = !PERIOD.active || (p.cycles || []).some(c => {
      if (!/submit/i.test(c.type) || /obtained/i.test(c.type)) return false;
      return inPd(pDate(c.submitDate));
    });
    if (inScope) { pendMT += p.mt; pendCoSet.add(p.code); }
  });

  /* ── KPI 2b: Total Utilized MT ──────────────────────────────────────── */
  const totalUtilizedMT = filteredSPI().reduce((s, co) => {
    const ubp = co.utilizationByProd || {};
    return s + Object.values(ubp).reduce((t, v) => t + (typeof v === 'number' ? v : 0), 0);
  }, 0);
  const utilCoCount = filteredSPI().filter(co => (co.utilizationMT || 0) > 0).length;

  /* ── Update DOM ───────────────────────────────────────────────────── */
  if (kpis[0]) {
    kpis[0].querySelector('.kpi-val').textContent  = totalSubmitMT.toLocaleString();
    kpis[0].querySelector('.kpi-unit').textContent = `MT · ${submitCoSet.size} companies`;
    const t = kpis[0].querySelector('.kpi-tag');
    if (t) { const n=t.querySelector('#kpiSubmitNote')||t; n.textContent = PERIOD.active ? `Filtered: ${submitCoSet.size} co.` : 'All Submissions'; }
  }
  if (kpis[1]) {
    kpis[1].querySelector('.kpi-val').textContent  = totalObtainedMT.toLocaleString();
    kpis[1].querySelector('.kpi-unit').textContent = `MT · ${obtCoSet.size} companies`;
    const t = kpis[1].querySelector('.kpi-tag');
    if (t) { const rate = totalSubmitMT>0?(totalObtainedMT/totalSubmitMT*100).toFixed(1):'—'; t.textContent=`${rate}% Approval Rate`; }
  }
  // Total Utilized KPI (addressed by ID — index-independent)
  const kpiUtilCoEl   = document.getElementById('kpiUtilCoCount');
  const kpiUtilMTEl   = document.getElementById('kpiUtilMT');
  const kpiUtilUnitEl = document.getElementById('kpiUtilUnit');
  const kpiUtilFillEl = document.getElementById('kpiUtilFill');
  const kpiUtilTagEl  = document.getElementById('kpiUtilTag');
  if (kpiUtilCoEl)   kpiUtilCoEl.textContent   = utilCoCount > 0 ? utilCoCount : '—';
  if (kpiUtilMTEl)   kpiUtilMTEl.textContent   = totalUtilizedMT > 0 ? totalUtilizedMT.toLocaleString() + ' MT total utilized' : '— MT';
  if (kpiUtilUnitEl) kpiUtilUnitEl.textContent = `compan${utilCoCount!==1?'ies':'y'} with shipment`;
  if (kpiUtilFillEl && totalObtainedMT > 0) kpiUtilFillEl.style.width = Math.min(100, totalUtilizedMT / totalObtainedMT * 100).toFixed(1) + '%';
  if (kpiUtilTagEl)  kpiUtilTagEl.textContent  = totalObtainedMT > 0 ? `${(totalUtilizedMT/totalObtainedMT*100).toFixed(1)}% of obtained allocated` : 'Of obtained quota allocated';
  if (kpis[2]) {
    kpis[2].querySelector('.kpi-val').textContent  = realizedCount;
    kpis[2].querySelector('.kpi-unit').textContent = `Companies with utilization${PERIOD.active?' in period':''}`;
    const kpiRealMTEl = document.getElementById('kpiRealMT');
    if (kpiRealMTEl) kpiRealMTEl.textContent = totalRealizedMT.toLocaleString() + ' MT total realized';
    const t = kpis[2].querySelector('.kpi-tag'); if (t) t.textContent = arrivedCodes;
    const fill = kpis[2].querySelector('.kpi-fill');
    if (fill && totalObtainedMT>0) fill.style.width = Math.min(100,totalRealizedMT/totalObtainedMT*100).toFixed(1)+'%';
  }
  // Re-Apply KPI (by ID — index-independent after reorder)
  const kpiReapplyValEl = document.getElementById('kpiReapplyVal');
  if (kpiReapplyValEl) kpiReapplyValEl.textContent = reapplyTotal;
  // Also update Re-Apply tag (find by traversing from kpiReapplyVal's parent .kpi)
  const reapplyKpiEl = kpiReapplyValEl ? kpiReapplyValEl.closest('.kpi') : null;
  if (reapplyKpiEl) {
    const ru = reapplyKpiEl.querySelector('.kpi-unit'); if (ru) ru.textContent = 'Companies — Re-Apply On Process';
    const rt = reapplyKpiEl.querySelector('.kpi-tag');  if (rt) rt.textContent = `🔵 ${submittedCount} Submitted · ✅ ${eligCount} Eligible`;
  }
  // Pending KPI (index 6 after reorder: Submit[0] Obtained[1] Utilized[via ID] Realized[2] AvailQuota[3] ReApply[4] Pending[5])
  // Use ID-based approach for safety
  const kpiPendValEl = document.getElementById('kpiPendVal');
  if (kpiPendValEl) {
    kpiPendValEl.textContent = pendMT.toLocaleString();
    const pendKpiEl = kpiPendValEl.closest('.kpi');
    if (pendKpiEl) { const pu = pendKpiEl.querySelector('.kpi-unit'); if(pu) pu.textContent = `MT · ${pendCoSet.size} companies`; }
  }

  // ── Also update pipeline sidebar labels ──────────────────────────────
  const pPendStat = document.getElementById('pipelinePendStat');
  if (pPendStat) pPendStat.textContent = `${pendMT.toLocaleString()} MT · ${pendCoSet.size} co.`;
  const pTotalMT = document.getElementById('pendTotalMT');
  if (pTotalMT) pTotalMT.textContent = `${pendMT.toLocaleString()} MT`;

  // SPI sidebar stat — recompute from live SPI data
  const spiTotal   = filteredSPI().reduce((s,d)=>s+d.obtained,0);
  const spiCount   = filteredSPI().length;
  const pSpiStat   = document.getElementById('pipelineSpiStat');
  if (pSpiStat) pSpiStat.textContent = `${spiTotal.toLocaleString()} MT · ${spiCount} co.`;

  // Re-Apply sidebar = realization-based (cargoArrived AND realPct ≥ 60%)
  const raEligPool = RA.filter(r => r.cargoArrived === true && r.realPct >= 0.6);
  const raEligMT   = raEligPool.reduce((s,r) => s + (r.obtained||0), 0);
  const pRaStat = document.getElementById('pipelineReapplyStat');
  if (pRaStat) pRaStat.textContent = `${raEligPool.length} co.`;

  // Pending card header labels
  const pSubt = document.getElementById('pendingCardSubtitle');
  if (pSubt) pSubt.textContent = `${pendCoSet.size} companies — awaiting PERTEK / SPI`;

  const pBadge = document.getElementById('pendingCardBadge');
  if (pBadge) pBadge.textContent = `${pendCoSet.size} Pending`;

  const pTblSubt = document.getElementById('pendingTableSubtitle');
  if (pTblSubt) pTblSubt.textContent = `${pendCoSet.size} companies · awaiting PERTEK / SPI`;

  // All Companies page filter pills — update by stable IDs
  const s = (id,v) => { const el=document.getElementById(id); if(el) el.textContent=v; };
  s('pillMAll',     SPI.length + PENDING.length);
  s('pillMSPI',     SPI.length);
  s('pillMPending', PENDING.length);

  // ── Active Revisions insight (dynamic from live data) ──────────────────
  const revRevision = SPI.filter(d => revisionStatus(d) === 'active');
  const revReapply  = SPI.filter(d => revisionStatus(d) === 'reapply');
  const revComplete = SPI.filter(d => d.revType === 'complete');
  const revActive   = [...revRevision, ...revReapply];
  const insValEl = document.getElementById('insRevVal');
  const insSubEl = document.getElementById('insRevSub');
  if (insValEl) insValEl.textContent = `${revRevision.length} Revision · ${revReapply.length} Re-Apply`;
  if (insSubEl) {
    const parts = [];
    if (revRevision.length) parts.push(revRevision.map(d=>d.code).join(', ') + ' (Revision)');
    if (revReapply.length)  parts.push(revReapply.map(d=>d.code).join(', ')  + ' (Re-Apply)');
    insSubEl.textContent = parts.length ? parts.join(' · ') : 'No active revisions';
  }
  const revBadge = document.getElementById('revCardBadge');
  if (revBadge) revBadge.textContent = `${revActive.length} Active`;
}


/* ─────────────────────────────────────────────────────────────────────────
   SPI / PERTEK OBTAINED DRILL-DOWN MODAL
   Shows one row per obtained cycle, filtered by Submit MOT date in period.
   ───────────────────────────────────────────────────────────────────────── */
/* ─────────────────────────────────────────────────────────────────
   PERTEK PENDING DRILL-DOWN MODAL
   Shows Company → Submission → Product expandable breakdown
   ───────────────────────────────────────────────────────────────── */
/* ─────────────────────────────────────────────────────────────────
   TOTAL SUBMITTED DRILL-DOWN MODAL
   One row per Submit cycle — sorted by Submit MOI date asc
   ───────────────────────────────────────────────────────────────── */
/* ─────────────────────────────────────────────────────────────────
   TOTAL REALIZED DRILL-DOWN MODAL
   ───────────────────────────────────────────────────────────────── */
function openRealizedDrill()  { const m=document.getElementById('realizedDrillModal'); if(!m) return; refreshRealizedDrill(); m.style.display='block'; }
function closeRealizedDrill() { const m=document.getElementById('realizedDrillModal'); if(m) m.style.display='none'; }

function refreshRealizedDrill() {
  const fmtDate = d => d ? d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'2-digit'}) : '—';
  const realColor = r => r>=0.8?'var(--green)':r>=0.6?'var(--teal)':'var(--red2)';

  // Filter: arrived companies, optionally within period
  const rows = RA.filter(r => {
    if (!r.cargoArrived) return false;
    if (!PERIOD.active) return true;
    const ad = r.arrivalDate ? new Date(r.arrivalDate) : null;
    return inPd(ad);
  }).sort((a,b) => {
    const da = a.arrivalDate ? new Date(a.arrivalDate) : null;
    const db = b.arrivalDate ? new Date(b.arrivalDate) : null;
    if (da && db) return da - db;
    return a.code.localeCompare(b.code);
  });

  const totalRealized = rows.reduce((s,r) => s + (r.berat||0), 0);
  const totalObtained = rows.reduce((s,r) => s + (r.obtained||0), 0);
  const avgReal       = rows.length ? (rows.reduce((s,r)=>s+r.realPct,0)/rows.length*100).toFixed(1) : '—';
  const periodLabel   = PERIOD.active ? PERIOD.label : 'All Time';

  document.getElementById('realDrillSubtitle').textContent =
    `Period: ${periodLabel} · ${rows.length} compan${rows.length!==1?'ies':'y'} · cargo arrived at JKT`;

  document.getElementById('realDrillSummary').innerHTML = [
    ['Realized (MT)',  totalRealized.toLocaleString()+' MT', 'var(--green)',   'var(--green-bg)',  'var(--green-bd)'],
    ['Obtained (MT)',  totalObtained.toLocaleString()+' MT', 'var(--teal)',    'var(--teal-bg)',   'var(--teal-bd)'],
    ['Companies',      rows.length,                          'var(--blue)',    'var(--blue-bg)',   'var(--blue-bd)'],
    ['Avg Real. %',    avgReal+'%',                          'var(--green)',   'var(--green-bg)',  'var(--green-bd)'],
  ].map(([lbl,val,col,bg,bd]) => `
    <div style="text-align:center;padding:6px 14px;background:${bg};border-radius:6px;border:1px solid ${bd}">
      <div style="font-size:10px;font-weight:700;color:${col};text-transform:uppercase;letter-spacing:.8px">${lbl}</div>
      <div style="font-size:18px;font-weight:700;color:${col};line-height:1.3">${val}</div>
    </div>`).join('');

  const body = document.getElementById('realDrillBody');
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="7" style="padding:24px;text-align:center;color:var(--txt3)">No arrivals in ${periodLabel}</td></tr>`;
    return;
  }

  body.innerHTML = rows.map(r => {
    const arrDate  = r.arrivalDate ? new Date(r.arrivalDate) : null;
    const pct      = (r.realPct*100).toFixed(1)+'%';
    const pctColor = realColor(r.realPct);
    const eligible = r.realPct >= 0.6 ? '✅ Eligible' : '✗ Below 60%';
    const eligColor= r.realPct >= 0.6 ? 'var(--green)' : 'var(--red2)';
    return `<tr style="border-bottom:1px solid var(--border);cursor:pointer" onclick="closeRealizedDrill();setTimeout(()=>openDrawer('${r.code}'),100)">
      <td style="padding:8px 14px;font-weight:700;color:var(--navy)">${r.code}</td>
      <td style="padding:8px 10px;font-size:11px;color:var(--txt)">${r.product||'—'}</td>
      <td style="padding:8px 10px;text-align:center;font-weight:600;color:var(--green);font-family:'DM Mono',monospace;font-size:11px">${fmtDate(arrDate)}</td>
      <td style="padding:8px 10px;text-align:right;font-family:'DM Mono',monospace;color:var(--txt3)">${(r.obtained||0).toLocaleString()}</td>
      <td style="padding:8px 10px;text-align:right;font-weight:700;font-family:'DM Mono',monospace;color:var(--green)">${(r.berat||0).toLocaleString()}</td>
      <td style="padding:8px 10px;text-align:center;font-weight:700;color:${pctColor}">${pct}</td>
      <td style="padding:8px 14px;font-size:11px;color:${eligColor}">${r.catatan||eligible}</td>
    </tr>`;
  }).join('');

  document.getElementById('realDrillFooter').textContent =
    `${rows.length} compan${rows.length!==1?'ies':'y'} with cargo arrived · Click row to open detail`;
}

/* ─────────────────────────────────────────────────────────────────
   AVAILABLE QUOTA DRILL-DOWN MODAL
   ───────────────────────────────────────────────────────────────── */
function openAvqDrill()  { const m=document.getElementById('avqDrillModal'); if(!m) return; refreshAvqDrill(); m.style.display='block'; }
function closeAvqDrill() { const m=document.getElementById('avqDrillModal'); if(m) m.style.display='none'; }

function refreshAvqDrill() {
  // Build rows using exact same logic as buildAvailableQuota() — single source of truth
  const rows = [];
  filteredSPI().forEach(co => {
    const obtained = typeof co.obtained === 'number' ? co.obtained : 0;
    if (obtained <= 0) return;
    const totalUtil = co.utilizationMT  != null ? co.utilizationMT  : 0;
    const totalAvq  = co.availableQuota != null ? co.availableQuota : (obtained - totalUtil);

    const aProd = co.availableByProd   || {};
    const uProd = co.utilizationByProd || {};

    // Build cycle-level obtained-per-product map
    const cycleProds = {};
    (co.cycles||[]).forEach(c => {
      if (!/^obtained/i.test(c.type) || (typeof c.mt==='number' && c.mt < 0)) return;
      Object.entries(c.products||{}).forEach(([p,v]) => {
        if (typeof v==='number' && v>0) cycleProds[p] = (cycleProds[p]||0) + v;
      });
    });

    if (Object.keys(aProd).length > 0) {
      Object.entries(aProd).forEach(([prod, avq]) => {
        const utilP = uProd[prod] || 0;
        const obtP  = cycleProds[prod] || (avq + utilP);
        rows.push({ code:co.code, group:co.group, product:prod, obtained:obtP, utilMT:utilP, avq });
      });
      Object.entries(uProd).forEach(([prod, util]) => {
        if (aProd[prod] != null) return;
        rows.push({ code:co.code, group:co.group, product:prod, obtained:cycleProds[prod]||util, utilMT:util, avq:0 });
      });
    } else {
      const prodEntries = Object.entries(cycleProds);
      if (prodEntries.length > 0) {
        const cycleTotal = prodEntries.reduce((s,[,v])=>s+v, 0);
        prodEntries.forEach(([prod, mt]) => {
          rows.push({ code:co.code, group:co.group, product:prod,
            obtained: mt,
            utilMT:  cycleTotal>0 ? Math.round(totalUtil * mt/cycleTotal) : 0,
            avq:     cycleTotal>0 ? Math.round(totalAvq  * mt/cycleTotal) : 0,
          });
        });
      } else {
        rows.push({ code:co.code, group:co.group, product:(co.products||[])[0]||'—', obtained, utilMT:totalUtil, avq:totalAvq });
      }
    }
  });

  rows.sort((a,b) => a.code.localeCompare(b.code) || a.product.localeCompare(b.product));

  const totalAvq  = rows.reduce((s,r) => s+r.avq,    0);
  const totalUtil = rows.reduce((s,r) => s+r.utilMT,  0);
  const totalObt  = rows.reduce((s,r) => s+r.obtained,0);
  const uniqueCos = new Set(rows.map(r=>r.code)).size;
  const utilRate  = totalObt > 0 ? (totalUtil/totalObt*100).toFixed(1) : '—';
  const avqRate   = totalObt > 0 ? (totalAvq /totalObt*100).toFixed(1) : '—';

  document.getElementById('avqDrillSubtitle').textContent =
    `${uniqueCos} companies · ${rows.length} product-rows · Obtained − Utilized`;

  document.getElementById('avqDrillSummary').innerHTML = [
    ['Available (MT)',  totalAvq.toLocaleString()+' MT',  '#0891b2',       '#ecfeff',           '#a5f3fc'],
    ['Obtained (MT)',   totalObt.toLocaleString()+' MT',  'var(--teal)',   'var(--teal-bg)',    'var(--teal-bd)'],
    ['Utilized (MT)',   totalUtil.toLocaleString()+' MT', 'var(--blue)',   'var(--blue-bg)',    'var(--blue-bd)'],
    ['Util. Rate',      utilRate+'%',                      'var(--blue)',   'var(--blue-bg)',    'var(--blue-bd)'],
    ['Avail. Rate',     avqRate+'%',                       '#0891b2',       '#ecfeff',           '#a5f3fc'],
  ].map(([lbl,val,col,bg,bd]) => `
    <div style="text-align:center;padding:6px 14px;background:${bg};border-radius:6px;border:1px solid ${bd}">
      <div style="font-size:10px;font-weight:700;color:${col};text-transform:uppercase;letter-spacing:.8px">${lbl}</div>
      <div style="font-size:18px;font-weight:700;color:${col};line-height:1.3">${val}</div>
    </div>`).join('');

  const body = document.getElementById('avqDrillBody');
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="7" style="padding:24px;text-align:center;color:var(--txt3)">No available quota data found</td></tr>`;
    return;
  }

  const maxAvq = Math.max(...rows.map(r=>r.avq), 1);
  let lastCode = null;
  body.innerHTML = rows.map(r => {
    const isFirst = r.code !== lastCode; lastCode = r.code;
    const utilPct  = r.obtained > 0 ? r.utilMT / r.obtained : 0;
    const avqPct   = r.obtained > 0 ? r.avq    / r.obtained : 0;
    const barW     = (r.avq / maxAvq * 100).toFixed(1);
    const avqCol   = r.avq > 0 ? '#0891b2' : r.avq === 0 ? 'var(--txt3)' : 'var(--red2)';
    const coSpi    = getSPI(r.code);
    const badge    = coSpi ? statusBadge(coSpi) : '';
    const rowBg    = isFirst ? '' : 'background:#f9fafb';
    const lBorder  = isFirst ? 'border-left:3px solid #0891b2' : 'border-left:3px solid #a5f3fc';
    return `<tr style="border-bottom:1px solid var(--border);${rowBg};cursor:pointer" onclick="closeAvqDrill();setTimeout(()=>openDrawer('${r.code}'),100)">
      <td style="padding:8px 14px;font-weight:700;color:var(--navy);${lBorder};padding-left:11px">${isFirst ? r.code : ''}</td>
      <td style="padding:8px 10px;font-size:11px;color:var(--txt2)">${r.product}</td>
      <td style="padding:8px 10px;text-align:right;font-family:'DM Mono',monospace;color:var(--txt3)">${r.obtained.toLocaleString()}</td>
      <td style="padding:8px 10px;text-align:right;font-family:'DM Mono',monospace;color:var(--blue)">${r.utilMT > 0 ? r.utilMT.toLocaleString() : '—'}</td>
      <td style="padding:8px 10px;text-align:center;color:var(--blue);font-weight:600">${r.obtained>0?(utilPct*100).toFixed(0)+'%':'—'}</td>
      <td style="padding:8px 10px;text-align:right">
        <div style="display:flex;align-items:center;gap:6px;justify-content:flex-end">
          <div style="width:60px;height:4px;background:var(--border);border-radius:2px;overflow:hidden;flex-shrink:0">
            <div style="height:4px;background:${avqCol};border-radius:2px;width:${barW}%"></div>
          </div>
          <span style="font-weight:${r.avq>0?'700':'400'};font-family:'DM Mono',monospace;color:${avqCol}">${r.avq.toLocaleString()}</span>
        </div>
      </td>
      <td style="padding:8px 14px">${badge}</td>
    </tr>`;
  }).join('');

  document.getElementById('avqDrillFooter').textContent =
    `${uniqueCos} companies · ${rows.length} product-rows · Click row to open company detail`;
}

/* ─────────────────────────────────────────────────────────────────
   TOTAL UTILIZED DRILL-DOWN MODAL
   ───────────────────────────────────────────────────────────────── */
function openUtilDrill()  { const m=document.getElementById('utilDrillModal'); if(!m) return; refreshUtilDrill(); m.style.display='block'; }
function closeUtilDrill() { const m=document.getElementById('utilDrillModal'); if(m) m.style.display='none'; }

function refreshUtilDrill() {
  const utilColor  = u => u >= 0.8 ? 'var(--green)' : u >= 0.5 ? 'var(--blue)' : 'var(--amber)';
  const periodLabel = PERIOD.active ? PERIOD.label : 'All Time';

  // Build per-product rows from SPI — same source as Available Quota and flow KPI strip
  const rows = [];
  filteredSPI().forEach(co => {
    const obtained = typeof co.obtained === 'number' ? co.obtained : 0;
    if (obtained <= 0) return;
    const ubp = co.utilizationByProd || {};
    const abp = co.availableByProd   || {};
    const totalUtil = co.utilizationMT != null ? co.utilizationMT : 0;
    if (totalUtil <= 0 && Object.keys(ubp).length === 0) return; // skip zero-util companies

    if (Object.keys(ubp).length > 0) {
      Object.entries(ubp).forEach(([prod, util]) => {
        if ((util || 0) <= 0) return;
        const avq = abp[prod] != null ? abp[prod] : Math.max(0, obtained - util);
        const obtProd = (() => {
          const cycleProds = {};
          (co.cycles||[]).forEach(c => {
            if (!/^obtained/i.test(c.type)) return;
            Object.entries(c.products||{}).forEach(([p,v]) => { if(typeof v==='number'&&v>0) cycleProds[p]=(cycleProds[p]||0)+v; });
          });
          return cycleProds[prod] || (util + (abp[prod]||0));
        })();
        rows.push({ code: co.code, group: co.group, product: prod, obtained: obtProd, utilMT: util, availMT: avq });
      });
    } else if (totalUtil > 0) {
      const prod = (co.products||[])[0] || '—';
      rows.push({ code: co.code, group: co.group, product: prod, obtained, utilMT: totalUtil, availMT: co.availableQuota ?? Math.max(0, obtained - totalUtil) });
    }
  });

  rows.sort((a,b) => a.code.localeCompare(b.code) || a.product.localeCompare(b.product));

  const totalUtil  = rows.reduce((s,r) => s+r.utilMT, 0);
  const totalAvail = rows.reduce((s,r) => s+r.availMT, 0);
  const totalObt   = filteredSPI().reduce((s,co) => s+(co.obtained||0), 0);
  const avgUtil    = totalObt > 0 ? (totalUtil/totalObt*100).toFixed(1) : '—';

  document.getElementById('utilDrillSubtitle').textContent =
    `Period: ${periodLabel} · ${rows.length} product-rows · ${new Set(rows.map(r=>r.code)).size} companies`;

  document.getElementById('utilDrillSummary').innerHTML = [
    ['Utilized (MT)',   totalUtil.toLocaleString()+' MT',  'var(--blue)',  'var(--blue-bg)',  'var(--blue-bd)'],
    ['Available (MT)',  totalAvail.toLocaleString()+' MT', 'var(--teal)',  'var(--teal-bg)',  'var(--teal-bd)'],
    ['Obtained (MT)',   totalObt.toLocaleString()+' MT',   'var(--navy)',  '#eef2ff',         '#c7d2fe'],
    ['Util. Rate',      avgUtil+'%',                        'var(--blue)',  'var(--blue-bg)',  'var(--blue-bd)'],
  ].map(([lbl,val,col,bg,bd]) => `
    <div style="text-align:center;padding:6px 14px;background:${bg};border-radius:6px;border:1px solid ${bd}">
      <div style="font-size:10px;font-weight:700;color:${col};text-transform:uppercase;letter-spacing:.8px">${lbl}</div>
      <div style="font-size:18px;font-weight:700;color:${col};line-height:1.3">${val}</div>
    </div>`).join('');

  const body = document.getElementById('utilDrillBody');
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="8" style="padding:24px;text-align:center;color:var(--txt3)">No utilization data recorded in ${periodLabel}</td></tr>`;
    return;
  }

  const maxUtil = Math.max(...rows.map(r=>r.utilMT), 1);
  body.innerHTML = rows.map(r => {
    const pct     = r.obtained > 0 ? r.utilMT/r.obtained : 0;
    const barW    = (r.utilMT/maxUtil*100).toFixed(1);
    const col     = utilColor(pct);
    const avqCol  = r.availMT > 0 ? 'var(--teal)' : r.availMT === 0 ? 'var(--txt3)' : 'var(--red2)';
    const coSpi   = getSPI(r.code);
    const badge   = coSpi ? statusBadge(coSpi) : '';
    return `<tr style="border-bottom:1px solid var(--border);cursor:pointer" onclick="closeUtilDrill();setTimeout(()=>openDrawer('${r.code}'),100)">
      <td style="padding:8px 14px;font-weight:700;color:var(--navy)">${r.code}</td>
      <td style="padding:8px 10px;font-size:11px;font-weight:600;color:var(--txt2)">${r.group}</td>
      <td style="padding:8px 10px;font-size:11px;color:var(--txt)">${r.product}</td>
      <td style="padding:8px 10px;text-align:right;font-family:'DM Mono',monospace;color:var(--txt3)">${r.obtained.toLocaleString()}</td>
      <td style="padding:8px 10px;text-align:right">
        <div style="display:flex;align-items:center;gap:6px;justify-content:flex-end">
          <div style="width:60px;height:4px;background:var(--border);border-radius:2px;overflow:hidden;flex-shrink:0">
            <div style="height:4px;background:${col};border-radius:2px;width:${barW}%"></div>
          </div>
          <span style="font-weight:700;font-family:'DM Mono',monospace;color:${col}">${r.utilMT.toLocaleString()}</span>
        </div>
      </td>
      <td style="padding:8px 10px;text-align:center;font-weight:700;color:${col}">${(pct*100).toFixed(0)}%</td>
      <td style="padding:8px 10px;text-align:right;font-weight:${r.availMT>0?'700':'400'};font-family:'DM Mono',monospace;color:${avqCol}">${r.availMT.toLocaleString()}</td>
      <td style="padding:8px 14px">${badge}</td>
    </tr>`;
  }).join('');

  document.getElementById('utilDrillFooter').textContent =
    `${new Set(rows.map(r=>r.code)).size} companies · ${rows.length} product-rows · Click row to open detail`;
}

/* ─────────────────────────────────────────────────────────────────
   TARGET RE-APPLY DRILL-DOWN MODAL
   ───────────────────────────────────────────────────────────────── */
function openReapplyDrill()  { const m=document.getElementById('reapplyDrillModal'); if(!m) return; refreshReapplyDrill(); m.style.display='block'; }
function closeReapplyDrill() { const m=document.getElementById('reapplyDrillModal'); if(m) m.style.display='none'; }

function refreshReapplyDrill() {
  const fmtDate = d => d ? d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'2-digit'}) : '—';
  const realColor = r => r>=0.8?'var(--green)':r>=0.6?'var(--teal)':'var(--red2)';

  // Pool: eligible + submitted, respecting period filter
  const _codes = new Set(PERIOD.active ? SPI.filter(co=>companyInPeriod(co.cycles||[])).map(co=>co.code) : []);
  const pool = PERIOD.active ? RA.filter(r=>_codes.has(r.code)) : RA;
  const rows = pool
    .filter(r => isEligible(r) || isReapplySubmitted(r))
    .sort((a,b) => {
      // submitted first, then eligible; within each group sort by realPct desc
      const gs = r => isReapplySubmitted(r) ? 0 : 1;
      const gd = gs(a) - gs(b);
      return gd !== 0 ? gd : b.realPct - a.realPct;
    });

  const subCount  = rows.filter(isReapplySubmitted).length;
  const eligCount = rows.filter(isEligible).length;
  const totalNew  = rows.filter(isReapplySubmitted).reduce((s,r)=>s+(r.reapplyNewTotal||0),0);
  const periodLabel = PERIOD.active ? PERIOD.label : 'All Time';

  document.getElementById('raDrillSubtitle').textContent =
    `${rows.length} compan${rows.length!==1?'ies':'y'} · ${subCount} submitted · ${eligCount} eligible`;

  document.getElementById('raDrillSummary').innerHTML = [
    ['🔵 Submitted',   subCount,                               '#5b21b6', '#f5f3ff', '#c4b5fd'],
    ['✅ Eligible',    eligCount,                              'var(--green)', 'var(--green-bg)', 'var(--green-bd)'],
    ['New Quota Req.', totalNew ? totalNew.toLocaleString()+' MT' : '—', '#5b21b6', '#f5f3ff', '#c4b5fd'],
    ['Total in Pool',  rows.length,                            'var(--blue)', 'var(--blue-bg)', 'var(--blue-bd)'],
  ].map(([lbl,val,col,bg,bd]) => `
    <div style="text-align:center;padding:6px 14px;background:${bg};border-radius:6px;border:1px solid ${bd}">
      <div style="font-size:10px;font-weight:700;color:${col};text-transform:uppercase;letter-spacing:.8px">${lbl}</div>
      <div style="font-size:18px;font-weight:700;color:${col};line-height:1.3">${val}</div>
    </div>`).join('');

  const body = document.getElementById('raDrillBody');
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="8" style="padding:24px;text-align:center;color:var(--txt3)">No eligible or submitted companies in ${periodLabel}</td></tr>`;
    return;
  }

  body.innerHTML = rows.map(r => {
    const sub     = isReapplySubmitted(r);
    const elig    = isEligible(r);
    const pct     = (r.realPct*100).toFixed(1)+'%';
    const pctCol  = realColor(r.realPct);
    const statusBadge = sub
      ? `<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:3px;background:#f5f3ff;color:#5b21b6;border:1px solid #c4b5fd">🔵 Submitted</span>`
      : `<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:3px;background:var(--green-bg);color:var(--green);border:1px solid var(--green-bd)">✅ Eligible</span>`;
    const submitDate = sub && r.reapplySubmitDate ? fmtDate(pDate(r.reapplySubmitDate)) : '—';
    const newQuota   = sub && r.reapplyNewTotal   ? r.reapplyNewTotal.toLocaleString()  : '—';
    const rowBg      = sub ? 'background:#faf5ff' : '';
    return `<tr style="border-bottom:1px solid var(--border);cursor:pointer;${rowBg}" onclick="closeReapplyDrill();setTimeout(()=>openDrawer('${r.code}'),100)">
      <td style="padding:8px 14px;font-weight:700;color:var(--navy)">${r.code}</td>
      <td style="padding:8px 10px;font-size:11px;color:var(--txt)">${r.product||'—'}</td>
      <td style="padding:8px 10px;text-align:right;font-family:'DM Mono',monospace;color:var(--txt3)">${(r.obtained||0).toLocaleString()}</td>
      <td style="padding:8px 10px;text-align:right;font-weight:700;font-family:'DM Mono',monospace;color:var(--green)">${(r.berat||0).toLocaleString()}</td>
      <td style="padding:8px 10px;text-align:center;font-weight:700;color:${pctCol}">${pct}</td>
      <td style="padding:8px 10px;text-align:center">${statusBadge}</td>
      <td style="padding:8px 10px;text-align:center;font-family:'DM Mono',monospace;font-size:11px;color:var(--txt3)">${submitDate}</td>
      <td style="padding:8px 14px;text-align:right;font-weight:700;font-family:'DM Mono',monospace;color:#5b21b6">${newQuota}</td>
    </tr>`;
  }).join('');

  document.getElementById('raDrillFooter').textContent =
    `${subCount} submitted · ${eligCount} eligible · Click row to open company detail`;
}

function openSubmitDrill() {
  const modal = document.getElementById('submitDrillModal');
  if (!modal) return;
  refreshSubmitDrill();
  modal.style.display = 'block';
}
function closeSubmitDrill() {
  const modal = document.getElementById('submitDrillModal');
  if (modal) modal.style.display = 'none';
}
function refreshSubmitDrill() {
  const fmtDate = d => d
    ? d.toLocaleDateString('en-GB', {day:'2-digit', month:'short', year:'2-digit'})
    : '—';

  /* ────────────────────────────────────────────────────────────────────────
     Determine display category for each cycle
     Categories:
       'submit1'   — Submit #1 · Initial Application
       'revision'  — Revision #N · Product Modification
       'submit2'   — Submit #2+ · Re-Apply (Additional MT / Products)
       'pending'   — New Submission · Awaiting PERTEK/SPI (first submission, no PERTEK issued yet)
  ──────────────────────────────────────────────────────────────────────── */
  function getCycleCategory(cycleType, co) {
    if (/^submit #1$/i.test(cycleType))                   return 'submit1';
    if (/^revision #/i.test(cycleType))                   return 'revision';
    if (/^submit #[2-9]/i.test(cycleType))                return 'submit2';
    if (/^submit \(process\)$/i.test(cycleType))          return 'pending';
    return 'submit1'; // fallback
  }

  /* Dynamic status — derived from cycle's own releaseDate + paired SPI cycle */
  function getCycleStatus(cy, co) {
    const cat = getCycleCategory(cy.type, co);
    const hasPERTEK = cy.releaseDate && cy.releaseDate !== 'TBA';
    const allCycles = co.cycles || [];

    if (cat === 'pending') {
      return { text: '📬 New Submission — Awaiting PERTEK', color: 'var(--red2)' };
    }
    if (cat === 'submit1') {
      // Find corresponding Obtained #1 to check SPI release
      const obt1 = allCycles.find(c => /^obtained #1$/i.test(c.type));
      const hasSPI = obt1 && obt1.releaseDate && obt1.releaseDate !== 'TBA';
      if (hasSPI)    return { text: '✅ SPI Issued', color: 'var(--green)' };
      if (hasPERTEK) return { text: '⏳ PERTEK Terbit — SPI Belum', color: 'var(--amber2)' };
      return { text: '🔄 In Process', color: 'var(--txt3)' };
    }
    if (cat === 'revision') {
      // Find Obtained (Revision #N) cycle
      const revN = (cy.type.match(/(\d+)/) || ['','1'])[1];
      const obtRev = allCycles.find(c => new RegExp(`obtained.*revision.*#${revN}`, 'i').test(c.type));
      const hasSPIRev = obtRev && obtRev.releaseDate && obtRev.releaseDate !== 'TBA';
      if (hasSPIRev) return { text: '✅ PERTEK Perubahan Terbit — SPI Issued', color: 'var(--green)' };
      if (hasPERTEK) return { text: '✅ PERTEK Perubahan Terbit', color: 'var(--violet)' };
      return { text: '🔄 Awaiting PERTEK Perubahan', color: 'var(--amber2)' };
    }
    if (cat === 'submit2') {
      // Find corresponding Obtained #2 cycle
      const n = (cy.type.match(/(\d+)/) || ['','2'])[1];
      const obt2 = allCycles.find(c => new RegExp(`^obtained #${n}$`, 'i').test(c.type));
      const hasSPI2 = obt2 && obt2.releaseDate && obt2.releaseDate !== 'TBA';
      if (hasSPI2)    return { text: '✅ SPI Perubahan Issued', color: 'var(--green)' };
      if (hasPERTEK)  return { text: '⏳ PERTEK Terbit — SPI TBA', color: 'var(--amber2)' };
      return { text: '⏳ PERTEK TBA — Under Review', color: 'var(--red2)' };
    }
    return { text: '—', color: 'var(--txt3)' };
  }

  /* ── Collect rows: SPI (Submit cycles only) + PENDING ── */
  const rows = [];
  [...SPI].forEach(co => {
    (co.cycles || []).forEach(cy => {
      // Submit cycles only — Revision cycles excluded (product modification, not new MT)
      const isSubmit = /^submit/i.test(cy.type) && !/obtained/i.test(cy.type);
      if (!isSubmit) return;
      const mt = typeof cy.mt === 'number' ? cy.mt : 0;
      if (mt <= 0) return;
      const submitDate = pDate(cy.submitDate);
      if (PERIOD.active && !inPd(submitDate)) return;
      const cat    = getCycleCategory(cy.type, co);
      const status = getCycleStatus(cy, co);
      rows.push({
        code: co.code, group: co.group || '—',
        cycle: cy.type, cat, submitDate, mt,
        status: status.text, statusColor: status.color,
        isPending: false,
      });
    });
  });

  // Add PENDING companies as 'pending' category
  [...PENDING].forEach(co => {
    (co.cycles || []).forEach(cy => {
      if (!/^submit/i.test(cy.type) || /obtained/i.test(cy.type)) return;
      const mt = typeof cy.mt === 'number' ? cy.mt : 0;
      if (mt <= 0) return;
      const submitDate = pDate(cy.submitDate);
      if (PERIOD.active && !inPd(submitDate)) return;
      rows.push({
        code: co.code, group: co.group || '—',
        cycle: cy.type, cat: 'pending', submitDate, mt,
        status: '📬 New Submission — Awaiting PERTEK', statusColor: 'var(--red2)',
        isPending: true,
      });
    });
  });

  // Dedup: keep only first occurrence per company+cycleType
  const _subSeen = new Set();
  const _subUniq = [];
  rows.forEach(r => {
    const key = `${r.code}|${r.cycle}`;
    if (!_subSeen.has(key)) { _subSeen.add(key); _subUniq.push(r); }
  });
  rows.length = 0; _subUniq.forEach(r => rows.push(r));

  const periodLabel = PERIOD.active ? PERIOD.label : 'All Time';

  /* ── Group rows by category for display ── */
  const CAT_ORDER = ['submit1', 'submit2', 'pending'];
  const CAT_META  = {
    submit1:  { label: '📋 Submit #1',                                     bg: '#eef2ff', bd: '#c7d2fe', tc: 'var(--navy)' },
    submit2:  { label: '📨 Submit #2 (Re-Apply — Additional MT/Products)',  bg: 'var(--blue-bg)',  bd: 'var(--blue-bd)',  tc: 'var(--blue)' },
    pending:  { label: '📬 New Submission — Awaiting PERTEK/SPI',                  bg: 'var(--red-bg)',   bd: 'var(--red-bd)',   tc: 'var(--red)' },
  };

  // Totals per category
  const catTotals = {};
  CAT_ORDER.forEach(c => catTotals[c] = { mt: 0, count: 0, cos: new Set() });
  rows.forEach(r => {
    if (catTotals[r.cat]) {
      catTotals[r.cat].mt    += r.mt;
      catTotals[r.cat].count += 1;
      catTotals[r.cat].cos.add(r.code);
    }
  });

  const spiOnlyMT = rows.filter(r => !r.isPending).reduce((s, r) => s + r.mt, 0);
  const pendingMT = rows.filter(r =>  r.isPending).reduce((s, r) => s + r.mt, 0);
  const totalMT   = spiOnlyMT + pendingMT;
  const coCount      = new Set(rows.map(r => r.code)).size;
  const cycleCount   = rows.length;

  // Subtitle
  document.getElementById('submitDrillSubtitle').textContent =
    `Period: ${periodLabel} · ${cycleCount} submission${cycleCount!==1?'s':''} · ${coCount} compan${coCount!==1?'ies':'y'}`;

  // Summary strip — 4 category boxes + total
  document.getElementById('submitDrillSummary').innerHTML = `
    <div style="text-align:center;padding:6px 14px;background:#f8fafc;border-radius:6px;border:1px solid var(--border2)">
      <div style="font-size:9.5px;font-weight:700;color:var(--navy);text-transform:uppercase;letter-spacing:.8px">Grand Total</div>
      <div style="font-size:20px;font-weight:700;color:var(--navy);line-height:1.2">${totalMT.toLocaleString()} <span style="font-size:11px">MT</span></div>
      <div style="font-size:10px;color:var(--txt3);margin-top:1px">${coCount} companies</div>
    </div>
    ${CAT_ORDER.map(cat => {
      const m = CAT_META[cat], t = catTotals[cat];
      if (t.count === 0) return '';
      return `<div style="text-align:center;padding:6px 12px;background:${m.bg};border-radius:6px;border:1px solid ${m.bd};min-width:110px">
        <div style="font-size:9px;font-weight:700;color:${m.tc};text-transform:uppercase;letter-spacing:.7px;line-height:1.3">${m.label.replace(/^[^ ]+ /,'')}</div>
        <div style="font-size:18px;font-weight:700;color:${m.tc};line-height:1.3">${t.mt.toLocaleString()} <span style="font-size:10px">MT</span></div>
        <div style="font-size:10px;color:var(--txt3);margin-top:1px">${t.cos.size} co. · ${t.count} cycle${t.count!==1?'s':''}</div>
      </div>`;
    }).join('')}
    ${PERIOD.active ? `<div style="text-align:center;padding:6px 12px;background:var(--amber-bg);border-radius:6px;border:1px solid var(--amber-bd)">
      <div style="font-size:9px;font-weight:700;color:var(--amber);text-transform:uppercase;letter-spacing:.7px">Filter</div>
      <div style="font-size:13px;font-weight:700;color:var(--amber);line-height:1.4">📅 ${periodLabel}</div>
    </div>` : ''}`;

  // Table rows — grouped by category with section headers
  const body = document.getElementById('submitDrillBody');
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="5" style="padding:24px;text-align:center;color:var(--txt3)">No submissions found for ${periodLabel}</td></tr>`;
    document.getElementById('submitDrillFooter').textContent = 'No data for selected period';
    return;
  }

  let html = '';
  CAT_ORDER.forEach(cat => {
    const catRows = rows.filter(r => r.cat === cat)
      .sort((a, b) => {
        if (a.submitDate && b.submitDate) return a.submitDate - b.submitDate;
        if (a.submitDate) return -1;
        if (b.submitDate) return 1;
        return a.code.localeCompare(b.code);
      });
    if (!catRows.length) return;
    const m = CAT_META[cat];
    const catMT = catRows.reduce((s, r) => s + r.mt, 0);
    const catCos = new Set(catRows.map(r => r.code)).size;

    // Section header row
    html += `<tr>
      <td colspan="5" style="padding:7px 14px;background:${m.bg};border-top:2px solid ${m.bd};border-bottom:1px solid ${m.bd}">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span style="font-size:11px;font-weight:700;color:${m.tc}">${m.label}</span>
          <span style="font-size:10.5px;font-family:'DM Mono',monospace;font-weight:700;color:${m.tc}">${catMT.toLocaleString()} MT · ${catCos} co.</span>
        </div>
      </td>
    </tr>`;

    catRows.forEach(r => {
      const groupBadge = `<span style="font-size:9px;font-weight:700;padding:1px 5px;border-radius:3px;background:${r.group==='CD'?'#e0f2fe':'#f0fdf4'};color:${r.group==='CD'?'#0369a1':'#166534'};margin-left:4px">Grp ${r.group}</span>`;
      // Clean cycle label (without category prefix since it's already in the section header)
      const cycleLabel = r.cycle
        .replace(/^Submit #1$/i,             'Submit #1')
        .replace(/^Submit #([2-9]\d*)$/i,    'Submit #$1')
        .replace(/^Submit \(Process\)$/i,    'In Process');
      const openFn = r.isPending
        ? `closeSubmitDrill();setTimeout(()=>openDrawerPending('${r.code}'),100)`
        : `closeSubmitDrill();setTimeout(()=>openDrawer('${r.code}'),100)`;
      html += `<tr style="border-bottom:1px solid var(--border);cursor:pointer" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background=''" onclick="${openFn}">
        <td style="padding:8px 14px 8px 22px;font-weight:700;color:var(--navy);white-space:nowrap">${r.code}${groupBadge}</td>
        <td style="padding:8px 10px;font-size:11px;color:var(--txt2)">${cycleLabel}</td>
        <td style="padding:8px 10px;text-align:center;font-weight:600;color:var(--txt2);font-family:'DM Mono',monospace;font-size:11px">${fmtDate(r.submitDate)}</td>
        <td style="padding:8px 10px;text-align:right;font-weight:700;color:var(--navy);font-family:'DM Mono',monospace">${r.mt.toLocaleString()}</td>
        <td style="padding:8px 14px;font-size:11px;color:${r.statusColor}">${r.status}</td>
      </tr>`;
    });
  });

  body.innerHTML = html;
  document.getElementById('submitDrillFooter').textContent =
    `${cycleCount} submissions · Grand total ${totalMT.toLocaleString()} MT (SPI: ${spiOnlyMT.toLocaleString()} MT · Pending: ${pendingMT.toLocaleString()} MT) · Click row to open company detail`;
}

function openPendingDrill() {
  const modal = document.getElementById('pendingDrillModal');
  if (!modal) return;
  refreshPendingDrill();
  modal.style.display = 'block';
}
function closePendingDrill() {
  const modal = document.getElementById('pendingDrillModal');
  if (modal) modal.style.display = 'none';
}

function refreshPendingDrill() {
  const pending = filteredPending();
  const today   = new Date(); today.setHours(0,0,0,0);

  /* ── helpers (same as buildPendingQuick) ── */
  const daysSince = str => {
    const d = pDate(str);
    return d ? Math.floor((today - d) / 86400000) : null;
  };
  const daysChip = days => {
    if (days === null) return '';
    const cls = days >= 90 ? 'urgent' : days >= 45 ? 'warn' : 'ok';
    const lbl = days === 0 ? 'Today' : days === 1 ? '1 day' : `${days} days`;
    return `<span class="pq-days-chip ${cls}" style="font-size:10px">⏱ ${lbl}</span>`;
  };
  const fmtDate = str => {
    const d = pDate(str);
    return d ? d.toLocaleDateString('id-ID',{day:'2-digit',month:'short',year:'numeric'}) : (str||'—');
  };

  /* ── summary strip ── */
  const totalMT  = pending.reduce((s,p) => s + (p.mt||0), 0);
  const allDays  = pending.map(p => {
    const sc = (p.cycles||[]).find(cy => /submit/i.test(cy.type) && !/obtained/i.test(cy.type));
    return sc ? daysSince(sc.submitDate) : null;
  }).filter(d => d !== null);
  const maxDays  = allDays.length ? Math.max(...allDays) : 0;
  const avgDays  = allDays.length ? Math.round(allDays.reduce((s,d)=>s+d,0)/allDays.length) : 0;

  const sub = document.getElementById('pendDrillSubtitle');
  if (sub) sub.textContent = `${pending.length} compan${pending.length===1?'y':'ies'} · ${totalMT.toLocaleString()} MT total · longest wait ${maxDays} days`;

  const sumEl = document.getElementById('pendDrillSummary');
  if (sumEl) sumEl.innerHTML = [
    ['Total Volume',   `${totalMT.toLocaleString()} MT`,      'var(--red2)'],
    ['Companies',      `${pending.length}`,                   'var(--txt)'],
    ['Longest Wait',   `${maxDays} days`,                     maxDays>=90?'var(--red2)':maxDays>=45?'var(--orange)':'var(--green)'],
    ['Avg Wait',       `${avgDays} days`,                     'var(--txt)'],
  ].map(([lbl,val,col]) => `
    <div style="display:flex;flex-direction:column;gap:2px">
      <div style="font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.9px;color:var(--txt3)">${lbl}</div>
      <div style="font-size:18px;font-weight:800;font-family:'DM Mono',monospace;color:${col};line-height:1">${val}</div>
    </div>`).join('');

  /* ══ Build accordion in modal body ══ */
  const body = document.getElementById('pendDrillBody');
  if (!body) return;
  body.innerHTML = '';

  pending.forEach(p => {
    const submitCycles = (p.cycles||[]).filter(cy =>
      /submit/i.test(cy.type) && !/obtained/i.test(cy.type)
    );
    const firstSub = submitCycles[0];
    const codays   = firstSub ? daysSince(firstSub.submitDate) : null;

    /* ── Company section ── */
    const section = document.createElement('div');
    section.style.cssText = 'border-bottom:1px solid var(--border)';

    // Product pills
    const prodPills = p.products.map(pr => {
      const dot = prodDot(pr);
      return `<span style="display:inline-flex;align-items:center;gap:3px;font-size:9.5px;
        font-weight:700;padding:1px 7px;border-radius:10px;
        background:${dot}18;color:${dot};border:1px solid ${dot}44">
        <span style="width:5px;height:5px;border-radius:50%;background:${dot};display:inline-block;flex-shrink:0"></span>
        ${pr}
      </span>`;
    }).join('');

    // Company header row
    const coRow = document.createElement('div');
    coRow.style.cssText = `display:flex;align-items:center;gap:12px;padding:12px 20px;
      cursor:pointer;transition:background .12s;border-left:3px solid transparent;
      user-select:none`;
    coRow.onmouseover = () => { if(!coRow.classList.contains('open')) coRow.style.background='var(--red-bg)'; };
    coRow.onmouseout  = () => { if(!coRow.classList.contains('open')) coRow.style.background=''; };
    coRow.innerHTML = `
      <div style="flex-shrink:0;min-width:50px">
        <div style="font-size:14px;font-weight:800;color:var(--red2);letter-spacing:.3px">${p.code}</div>
        <div style="font-size:9.5px;color:var(--txt3);margin-top:1px;font-weight:600">Grp ${p.group}</div>
      </div>
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;margin-bottom:3px">${prodPills}</div>
        <div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap">
          <span style="font-size:12px;font-weight:700;font-family:'DM Mono',monospace">${(p.mt||0).toLocaleString()} MT</span>
          <span class="badge b-pending" style="font-size:9.5px;padding:1px 6px">⏳ Pending</span>
          ${codays !== null ? daysChip(codays) : ''}
        </div>
      </div>
      <span class="drill-co-arrow">▶</span>`;

    // Submissions panel
    const subsPanel = document.createElement('div');
    subsPanel.style.cssText = 'display:none;border-top:1px solid var(--border);background:#fdfcfc';

    submitCycles.forEach(cy => {
      const ds      = daysSince(cy.submitDate);
      const cyMT    = typeof cy.mt === 'number' ? cy.mt : (p.mt||0);
      const prods   = cy.products && Object.keys(cy.products).length
                      ? cy.products
                      : p.products.reduce((o,pr)=>{ o[pr]=cyMT; return o; }, {});
      const totPMT  = Object.values(prods).reduce((s,v)=>s+(typeof v==='number'?v:0),0) || cyMT;
      const rawStat = cy.status || p.status || '';
      const cleanSt = rawStat.replace(/^Update\s+\d{1,2}\/\d{1,2}\/\d{2,4}\s*[-–]\s*/i,'');

      // Submission row
      const subRow = document.createElement('div');
      subRow.style.cssText = `display:flex;align-items:flex-start;gap:10px;
        padding:10px 20px 10px 36px;border-bottom:1px solid var(--border);
        cursor:pointer;transition:background .12s;position:relative;user-select:none`;
      subRow.onmouseover = () => { if(!subRow.classList.contains('open')) subRow.style.background='var(--amber-bg)'; };
      subRow.onmouseout  = () => { if(!subRow.classList.contains('open')) subRow.style.background=''; };
      subRow.innerHTML = `
        <div style="position:absolute;left:27px;top:0;bottom:0;width:1px;background:var(--red-bd)"></div>
        <div style="width:8px;height:8px;border-radius:50%;background:var(--red);flex-shrink:0;margin-top:5px;z-index:1;position:relative"></div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <span style="font-size:12px;font-weight:700;color:var(--txt)">${cy.type}</span>
            <span style="font-size:11px;font-weight:700;font-family:'DM Mono',monospace;color:var(--txt3)">${totPMT.toLocaleString()} MT</span>
            ${ds !== null ? daysChip(ds) : ''}
          </div>
          <div style="display:flex;align-items:center;gap:8px;font-size:10.5px;color:var(--txt3);margin-top:3px;flex-wrap:wrap">
            <span>📅 Submit: <strong style="color:var(--txt)">${fmtDate(cy.submitDate)}</strong></span>
            <span style="color:var(--border2)">|</span>
            <span>PERTEK Release: <strong style="color:${cy.releaseDate&&cy.releaseDate!=='TBA'?'var(--teal)':'var(--txt3)'}">
              ${cy.releaseDate&&cy.releaseDate!=='TBA' ? fmtDate(cy.releaseDate) : '⏳ TBA'}
            </strong></span>
          </div>
          ${cleanSt ? `<div style="font-size:10px;color:var(--red2);margin-top:4px;font-style:italic;line-height:1.4;
            padding:4px 8px;background:var(--red-bg);border-radius:4px;border-left:2px solid var(--red-lt)">
            ⚠ ${cleanSt}</div>` : ''}
        </div>
        <span style="font-size:10px;color:var(--txt3);transition:transform .18s;flex-shrink:0;margin-top:4px" class="drill-sub-arrow">▶</span>`;

      // Product rows panel
      const prodsPanel = document.createElement('div');
      prodsPanel.style.cssText = 'display:none;background:var(--bg);border-top:1px solid var(--border)';

      // Table header
      prodsPanel.innerHTML = `
        <div style="display:grid;grid-template-columns:1fr auto auto;gap:0;
          padding:5px 20px 5px 56px;border-bottom:1px solid var(--border);
          background:var(--bg2)">
          <span style="font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:var(--txt3)">Product</span>
          <span style="font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:var(--txt3);text-align:right;min-width:90px">Volume (MT)</span>
          <span style="font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:var(--txt3);text-align:right;min-width:55px;padding-left:12px">Share</span>
        </div>`;

      Object.entries(prods).filter(([,v])=>typeof v==='number'&&v>0).forEach(([prodName, prodMT]) => {
        const dot = prodDot(prodName);
        const pct = totPMT > 0 ? (prodMT/totPMT*100).toFixed(0) : '—';
        const bar = totPMT > 0 ? Math.min(100,(prodMT/totPMT*100)) : 0;
        const row = document.createElement('div');
        row.style.cssText = `display:grid;grid-template-columns:1fr auto auto;gap:0;
          align-items:center;padding:8px 20px 8px 56px;
          border-bottom:1px dashed var(--border)`;
        row.innerHTML = `
          <div style="display:flex;align-items:center;gap:8px;min-width:0">
            <div style="width:9px;height:9px;border-radius:2px;background:${dot};flex-shrink:0"></div>
            <div>
              <div style="font-size:11.5px;font-weight:600;color:var(--txt)">${prodName}</div>
              <div style="height:3px;width:min(${bar.toFixed(0)}%,120px);background:${dot};
                border-radius:2px;margin-top:3px;opacity:.6"></div>
            </div>
          </div>
          <div style="font-size:12px;font-weight:700;font-family:'DM Mono',monospace;
            color:var(--blue);text-align:right;min-width:90px">${prodMT.toLocaleString()} MT</div>
          <div style="font-size:11px;font-weight:700;padding:1px 7px;border-radius:3px;
            background:var(--blue-bg);color:var(--blue);border:1px solid var(--blue-bd);
            text-align:right;min-width:55px;margin-left:12px">${pct}%</div>`;
        prodsPanel.appendChild(row);
      });

      // Toggle: submission click → products
      subRow.addEventListener('click', e => {
        e.stopPropagation();
        const isOpen = subRow.classList.contains('open');
        subsPanel.querySelectorAll('[class*="drill-sub"]').forEach(el => {
          const parent = el.closest('div[style*="cursor:pointer"]');
          if (parent) parent.classList.remove('open');
        });
        subsPanel.querySelectorAll('[style*="border-top:1px solid var(--border)"][style*="display"]').forEach(el => {
          if (el !== subsPanel && el !== subRow) el.style.display='none';
        });
        const arrow = subRow.querySelector('.drill-sub-arrow');
        if (isOpen) {
          subRow.classList.remove('open');
          subRow.style.background = '';
          prodsPanel.style.display = 'none';
          if (arrow) arrow.style.transform = '';
        } else {
          // collapse all other sub rows first
          subsPanel.querySelectorAll('div[style*="cursor:pointer"]').forEach(r => {
            r.classList.remove('open');
            r.style.background = '';
            const a = r.querySelector('.drill-sub-arrow');
            if (a) a.style.transform = '';
          });
          subsPanel.querySelectorAll('div[style*="border-top"][style*="display:"]').forEach(p => {
            p.style.display = 'none';
          });
          subRow.classList.add('open');
          subRow.style.background = '#fef9ec';
          prodsPanel.style.display = 'block';
          if (arrow) arrow.style.transform = 'rotate(90deg)';
        }
      });

      subsPanel.appendChild(subRow);
      subsPanel.appendChild(prodsPanel);
    });

    // "Open full detail" link at bottom of submissions
    const detailRow = document.createElement('div');
    detailRow.style.cssText = `padding:8px 20px 8px 36px;font-size:10.5px;color:var(--blue);
      font-weight:600;cursor:pointer;display:flex;align-items:center;gap:5px;
      background:var(--blue-bg);border-top:1px solid var(--blue-bd);transition:background .12s`;
    detailRow.innerHTML = '↗ Open full company detail';
    detailRow.onmouseover = () => detailRow.style.background='#dbeafe';
    detailRow.onmouseout  = () => detailRow.style.background='var(--blue-bg)';
    detailRow.onclick = e => { e.stopPropagation(); closePendingDrill(); openDrawerPending(p.code); };
    subsPanel.appendChild(detailRow);

    // Toggle: company click → submissions
    coRow.addEventListener('click', () => {
      const isOpen = coRow.classList.contains('open');
      // collapse all company rows first
      body.querySelectorAll('[data-pend-co]').forEach(r => {
        r.classList.remove('open');
        r.style.cssText = r.style.cssText.replace('background:var(--red-bg);','');
        r.style.borderLeft = '3px solid transparent';
        const a = r.querySelector('.drill-co-arrow');
        if (a) a.style.transform = '';
      });
      body.querySelectorAll('[data-pend-subs]').forEach(p => { p.style.display='none'; });
      const arrow = coRow.querySelector('.drill-co-arrow');
      if (isOpen) {
        coRow.classList.remove('open');
        coRow.style.background = '';
        coRow.style.borderLeft = '3px solid transparent';
        if (arrow) arrow.style.transform = '';
      } else {
        coRow.classList.add('open');
        coRow.style.background = 'var(--red-bg)';
        coRow.style.borderLeft = '3px solid var(--red)';
        subsPanel.style.display = 'block';
        if (arrow) arrow.style.transform = 'rotate(90deg)';
      }
    });

    coRow.setAttribute('data-pend-co', p.code);
    subsPanel.setAttribute('data-pend-subs', p.code);

    section.appendChild(coRow);
    section.appendChild(subsPanel);
    body.appendChild(section);
  });

  // Empty state
  if (!pending.length) {
    body.innerHTML = `<div style="padding:32px;text-align:center;color:var(--txt3);font-size:13px">
      ✅ No pending companies in current filter period.
    </div>`;
  }
}

function openObtainedDrill() {
  const modal = document.getElementById('obtainedDrillModal');
  if (!modal) return;
  refreshObtainedDrill();
  modal.style.display = 'block';
}

function closeObtainedDrill() {
  const modal = document.getElementById('obtainedDrillModal');
  if (modal) modal.style.display = 'none';
}

function refreshObtainedDrill() {
  /* ── Collect all Obtained cycles, filtering by PERTEK Terbit date ──────
     For each Obtained cycle, we look up the PERTEK Terbit date from its
     paired Submit cycle (same company, matching cycle number).
     PERTEK Terbit = releaseDate of the Submit #N / Revision #N cycle.
  ─────────────────────────────────────────────────────────────────────── */
  const rows = [];
  SPI.forEach(co => {
    const allCycles = co.cycles || [];
    allCycles.forEach(c => {
      // Only show Obtained #N cycles — exclude revision-request-generated Obtained #2 cycles
      // (those created by csConfirmRev with _isRevReq flag, or auto-created Obtained #2
      //  from rrApplyObtained — these are tracked via the Revision table, not obtained drill)
      if (!/^obtained #/i.test(c.type)) return;
      // Skip Obtained #2 cycles created from CorpSec revision confirmation (not real re-apply)
      // These have _isRevReq on their source cycle or lack a proper PERTEK date
      if (/^obtained #[2-9]/i.test(c.type) && c._fromRevReq) return;
      const mt = typeof c.mt === 'number' ? c.mt : 0;

      // Get PERTEK Terbit from paired Submit cycle (this is the filter date)
      const pertekTerbit = getPertekTerbitForObtained(c, allCycles);
      const submitMOT    = pDate(c.submitDate);
      const spiTerbit    = pDate(c.releaseDate);

      // Filter by PERTEK Terbit date when period is active
      if (PERIOD.active && !inPd(pertekTerbit)) return;

      // Derive status
      const ra = getRA(co.code);
      let status = '—', statusColor = 'var(--txt3)';

      if (/obtained.*revision/i.test(c.type)) {
        if (spiTerbit)    { status = '✅ Revision — SPI Issued';        statusColor = 'var(--green)'; }
        else if (pertekTerbit) { status = '⏳ Revision — PERTEK Issued'; statusColor = 'var(--amber)'; }
        else                   { status = '🔄 Revision — Pending';       statusColor = 'var(--amber)'; }
      } else if (/obtained #[2-9]/i.test(c.type)) {
        if (ra && isReapplySubmitted(ra)) {
          status = '🔵 Re-Apply Submitted'; statusColor = '#7c3aed';
        } else {
          status = spiTerbit ? '✅ SPI Issued (Re-apply)' : '⏳ PERTEK Issued (Re-apply)';
          statusColor = spiTerbit ? 'var(--green)' : 'var(--amber)';
        }
      } else {
        // Obtained #1 (first/main cycle)
        if (spiTerbit)    { status = '✅ SPI Issued';              statusColor = 'var(--green)'; }
        else               { status = '⏳ PERTEK Issued — SPI TBA'; statusColor = 'var(--amber)'; }
      }

      rows.push({
        code: co.code, group: co.group,
        cycle: c.type, pertekTerbit, submitMOT, spiTerbit, mt,
        status, statusColor
      });
    });
  });

  // Dedup: keep only first occurrence per company+cycleType
  // (prevents duplicate rows when DB has multiple per-product cycle entries)
  const _obtSeen = new Set();
  const _obtUniq = [];
  rows.forEach(r => {
    const key = `${r.code}|${r.cycle}`;
    if (!_obtSeen.has(key)) { _obtSeen.add(key); _obtUniq.push(r); }
  });
  rows.length = 0; _obtUniq.forEach(r => rows.push(r));

  // Sort: by PERTEK Terbit date asc, then company code
  rows.sort((a, b) => {
    if (a.pertekTerbit && b.pertekTerbit) return a.pertekTerbit - b.pertekTerbit;
    if (a.pertekTerbit) return -1;
    if (b.pertekTerbit) return 1;
    return a.code.localeCompare(b.code);
  });

  const totalMT    = rows.filter(r => r.mt > 0).reduce((s, r) => s + r.mt, 0);
  const coCount    = new Set(rows.map(r => r.code)).size;
  const cycleCount = rows.length;
  const periodLabel = PERIOD.active ? PERIOD.label : 'All Time';

  // Modal header
  document.getElementById('drillSubtitle').textContent =
    `Period: ${periodLabel} · ${cycleCount} cycle${cycleCount!==1?'s':''} · ${coCount} compan${coCount!==1?'ies':'y'} · Filtered by PERTEK Terbit date`;

  // Summary strip
  document.getElementById('drillSummary').innerHTML = `
    <div style="text-align:center;padding:6px 14px;background:var(--teal-bg);border-radius:6px;border:1px solid var(--teal-bd)">
      <div style="font-size:10px;font-weight:700;color:var(--teal);text-transform:uppercase;letter-spacing:.8px">Total Obtained</div>
      <div style="font-size:20px;font-weight:700;color:var(--teal);line-height:1.2">${totalMT.toLocaleString()} <span style="font-size:12px">MT</span></div>
    </div>
    <div style="text-align:center;padding:6px 14px;background:var(--blue-bg);border-radius:6px;border:1px solid var(--blue-bd)">
      <div style="font-size:10px;font-weight:700;color:var(--blue);text-transform:uppercase;letter-spacing:.8px">Companies</div>
      <div style="font-size:20px;font-weight:700;color:var(--blue);line-height:1.2">${coCount}</div>
    </div>
    <div style="text-align:center;padding:6px 14px;background:var(--green-bg);border-radius:6px;border:1px solid var(--green-bd)">
      <div style="font-size:10px;font-weight:700;color:var(--green);text-transform:uppercase;letter-spacing:.8px">Cycles</div>
      <div style="font-size:20px;font-weight:700;color:var(--green);line-height:1.2">${cycleCount}</div>
    </div>
    ${PERIOD.active ? `<div style="text-align:center;padding:6px 14px;background:var(--amber-bg);border-radius:6px;border:1px solid var(--amber-bd)">
      <div style="font-size:10px;font-weight:700;color:var(--amber);text-transform:uppercase;letter-spacing:.8px">Filter: PERTEK Terbit</div>
      <div style="font-size:13px;font-weight:700;color:var(--amber);line-height:1.4">📅 ${periodLabel}</div>
    </div>` : ''}`;

  // Update modal header column (Submit MOT col header) to reflect correct fields
  const thead = document.querySelector('#drillTable thead tr');
  if (thead) {
    const ths = thead.querySelectorAll('th');
    if (ths[2]) ths[2].textContent = 'PERTEK Terbit';
    if (ths[3]) ths[3].textContent = 'Submit MOT';
    if (ths[4]) { ths[4].textContent = 'SPI Terbit'; }
  }

  const fmtDate = d => d ? d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'2-digit'}) : '—';
  const body = document.getElementById('drillBody');

  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="7" style="padding:24px;text-align:center;color:var(--txt3)">No obtained cycles found with PERTEK Terbit in ${periodLabel}</td></tr>`;
    return;
  }

  let lastCode = '';
  body.innerHTML = rows.map(r => {
    const stripe = r.code !== lastCode && lastCode !== '' ? ';background:var(--bg2)' : '';
    lastCode = r.code;
    const cycleLabel = r.cycle
      .replace(/^Obtained #1$/i, 'Submit #1 → Obtained')
      .replace(/^Obtained #(\d+)$/i, 'Submit #$1 → Obtained')
      .replace(/^Obtained \(Revision #(\d+)\)$/i, 'Revision #$1 → Obtained');
    const groupBadge = `<span style="font-size:9px;font-weight:700;padding:1px 5px;border-radius:3px;background:${r.group==='CD'?'#e0f2fe':'#f0fdf4'};color:${r.group==='CD'?'#0369a1':'#166534'};margin-left:4px">Grp ${r.group}</span>`;
    return `<tr style="border-bottom:1px solid var(--border);cursor:pointer${stripe}" onclick="closeObtainedDrill();setTimeout(()=>openDrawer('${r.code}'),100)">
      <td style="padding:8px 14px;font-weight:700;color:var(--navy)">${r.code}${groupBadge}</td>
      <td style="padding:8px 10px;color:var(--txt);font-size:11px">${cycleLabel}</td>
      <td style="padding:8px 10px;text-align:center;font-weight:600;color:var(--teal);font-family:'DM Mono',monospace;font-size:11px">${fmtDate(r.pertekTerbit)}</td>
      <td style="padding:8px 10px;text-align:center;color:var(--txt3);font-family:'DM Mono',monospace;font-size:11px">${fmtDate(r.submitMOT)}</td>
      <td style="padding:8px 10px;text-align:center;color:var(--txt3);font-family:'DM Mono',monospace;font-size:11px">${fmtDate(r.spiTerbit)}</td>
      <td style="padding:8px 10px;text-align:right;font-weight:700;color:var(--teal);font-family:'DM Mono',monospace">${r.mt > 0 ? r.mt.toLocaleString() : '—'}</td>
      <td style="padding:8px 14px;font-size:11px;color:${r.statusColor}">${r.status}</td>
    </tr>`;
  }).join('');

  document.getElementById('drillFooterNote').textContent =
    PERIOD.active
      ? `Filter reference: PERTEK Terbit date within ${periodLabel} · Click row to open company drawer`
      : `Showing all obtained cycles (all time) · Click row to open company drawer`;
}


document.addEventListener('click', e => {
  if (!e.target.closest('#pfWrap') && !e.target.closest('#pfPanel')) closePeriod();
});
const realColor  = r => r >= 0.8 ? 'var(--green)' : r >= 0.6 ? 'var(--teal)' : 'var(--red2)';
const realFill   = r => r >= 0.8 ? '#21c55d' : r >= 0.6 ? '#0c7c84' : '#ef4444';