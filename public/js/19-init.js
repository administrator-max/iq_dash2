/* ═══════════════════════════════════════
   APP INIT — window.onload
   Available Quota page tabs
   Rev/Pending summary strips
   Last-update clock
═══════════════════════════════════════ */

window.onload = async () => {
  // ── Load data from PostgreSQL API ──────────────────────────
  await loadData();

  updateStorageStatus();

  // Populate edit dropdown — sorted alphabetically A→Z
  const sel = document.getElementById('editCo');
  const allCos = [...SPI,...PENDING].sort((a,b) => a.code.localeCompare(b.code));
  allCos.forEach(d => { const o=document.createElement('option'); o.value=d.code; o.textContent=`${d.code} — ${(d.products||[]).join(', ')}`; sel.appendChild(o); });

  // Charts
  buildPipeline(); buildProductDonut(); buildTopCo(); buildCmpChart(); buildGauge(); buildUtilChart(); buildFlowKPIStrip(); buildAvailableQuota(); buildOUChart(); buildOUChartOverview();

  // Lead time overview KPIs
  updateOUOverviewKPIs();

  // Sales Intelligence KPIs
  updateSalesIntelKPIs();

  // Lists
  buildRevList(); buildPendingQuick(); buildRevDetailTable(); buildCmpList(); buildPendingTable();
  buildRevSummaryStrip(); buildPendingSummaryStrip();

  // Tables
  renderSPI(); renderUtilTable(); renderRATable(); renderMain();

  // Lead time analytics
  buildLeadTimeAnalytics();
  // Period filter (init as All Time)
  updatePeriodUI();
  // KPI cards — must run after all data is ready to replace hardcoded HTML values
  updateOverviewKPIs();
  buildAvailableQuota();
};

/* ── LAST UPDATE CLOCK ──────────────────────────────────────────── */
(function initLastUpdateClock() {
  function formatDT(d) {
    const dd = String(d.getDate()).padStart(2,'0');
    const mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
    const yy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2,'0');
    const mm = String(d.getMinutes()).padStart(2,'0');
    const ss = String(d.getSeconds()).padStart(2,'0');
    return `Last update: ${dd} ${mo} ${yy}  ${hh}:${mm}:${ss}`;
  }
  const el = document.getElementById('tbDateTime');
  if (!el) return;
  function tick() { el.textContent = formatDT(new Date()); }
  tick();
  setInterval(tick, 1000);
})();

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
  let totalObt = 0, totalUtil = 0, totalAvq = 0, coSet = new Set();
  const rows = [];
  filteredSPI().forEach(co => {
    const obtained = co.obtained || 0;
    if (obtained <= 0) return;
    const util = co.utilizationMT || 0;
    const avail = co.availableQuota != null ? co.availableQuota : (obtained - util);
    totalObt  += obtained;
    totalUtil += util;
    totalAvq  += avail;
    if (avail > 0) coSet.add(co.code);
  });

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('avqKpi1', totalAvq.toLocaleString());
  set('avqKpi2', totalObt.toLocaleString());
  set('avqKpi3', totalUtil.toLocaleString());
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
    const ap = co.availableByProd || {};
    const up = co.utilizationByProd || {};
    // Collect per-product data
    (co.products || []).forEach(p => {
      if (!prodMap[p]) prodMap[p] = { obtained:0, util:0, avail:0, cos:[] };
      const cycleObt = (co.cycles||[]).filter(c=>/^obtained/i.test(c.type))
        .reduce((s,c) => s + (c.products&&c.products[p]||0), 0);
      const obtForProd = Number(cycleObt) > 0 ? Number(cycleObt) : (Number(co.obtained) / Math.max((co.products||[]).length, 1));
      const utilForProd = up[p] || 0;
      const avqForProd  = ap[p] != null ? ap[p] : (obtForProd - utilForProd);
      prodMap[p].obtained += Number(obtForProd) || 0;
      prodMap[p].util     += Number(utilForProd) || 0;
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
  const entries = Object.entries(prodMap).sort((a,b) => b[1].avail - a[1].avail);
  grid.innerHTML = entries.map(([prod, d]) => {
    const utilPct = d.obtained > 0 ? Math.min((d.util / d.obtained * 100), 100).toFixed(0) : 0;
    const avqPct  = d.obtained > 0 ? Math.min((d.avail / d.obtained * 100), 100).toFixed(0) : 0;
    const c = clr(prod);
    return `<div style="border:1px solid var(--border);border-radius:var(--r2);overflow:hidden;box-shadow:var(--sh)">
      <div style="background:${c};padding:9px 14px;display:flex;justify-content:space-between;align-items:center">
        <span style="font-size:11.5px;font-weight:700;color:#fff">${prod}</span>
        <span style="font-size:10px;font-weight:600;padding:2px 7px;border-radius:3px;background:rgba(255,255,255,.2);color:#fff">${d.cos.length} co.</span>
      </div>
      <div style="padding:10px 14px">
        <div style="display:flex;justify-content:space-between;margin-bottom:8px">
          <div style="text-align:center;flex:1"><div style="font-size:16px;font-weight:700;color:var(--teal)">${d.obtained.toLocaleString()}</div><div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--txt3)">Obtained</div></div>
          <div style="text-align:center;flex:1"><div style="font-size:16px;font-weight:700;color:var(--green)">${d.util.toLocaleString()}</div><div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--txt3)">Utilized</div></div>
          <div style="text-align:center;flex:1"><div style="font-size:16px;font-weight:700;color:${c}">${d.avail.toLocaleString()}</div><div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--txt3)">Available</div></div>
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

/* ── Table view ── */
function buildAvqTable() {
  const tbody = document.getElementById('avqTableBody');
  if (!tbody) return;
  const rows = [];
  filteredSPI().forEach(co => {
    const obtained = co.obtained || 0;
    if (obtained <= 0) return;
    const ap = co.availableByProd || {};
    const up = co.utilizationByProd || {};
    const spi = getSPI(co.code);
    const grp = spi ? spi.group : '';
    if (Object.keys(ap).length > 0) {
      (co.products || []).forEach(p => {
        const cycleObt = (co.cycles||[]).filter(c=>/^obtained/i.test(c.type))
          .reduce((s,c) => s + (c.products&&c.products[p]||0), 0);
        const obt  = cycleObt || (obtained / (co.products||[]).length);
        const util = up[p] || 0;
        const avq  = ap[p] != null ? ap[p] : (obt - util);
        rows.push({ code:co.code, grp, prod:p, obt, util, avq, updBy:co.updatedBy||'', updDate:co.updatedDate||'' });
      });
    } else {
      const util = co.utilizationMT || 0;
      const avq  = co.availableQuota != null ? co.availableQuota : (obtained - util);
      (co.products || [co.products[0] || '—']).forEach(p => {
        rows.push({ code:co.code, grp, prod:p, obt:obtained/((co.products||[p]).length), util, avq, updBy:co.updatedBy||'', updDate:co.updatedDate||'' });
      });
    }
  });
  rows.sort((a,b) => b.avq - a.avq);
  tbody.innerHTML = rows.map(r => {
    const utilPct = r.obt > 0 ? (r.util / r.obt * 100) : 0;
    const fill = utilPct >= 80 ? 'var(--red2)' : utilPct >= 50 ? 'var(--amber-lt)' : 'var(--green-lt)';
    return `<tr>
      <td><div class="t-code" onclick="openDrawer('${r.code}')">${r.code}</div></td>
      <td style="font-size:11.5px;font-weight:600">${r.grp}</td>
      <td><span class="chip" style="background:#f0f9ff;color:#0369a1;font-size:10px;padding:2px 7px">${r.prod}</span></td>
      <td class="t-r t-mono">${r.obt.toLocaleString()}</td>
      <td class="t-r t-mono" style="color:var(--green)">${r.util > 0 ? r.util.toLocaleString() : '<span style="color:var(--txt3)">—</span>'}</td>
      <td class="t-r t-mono" style="color:#0891b2;font-weight:700">${r.avq.toLocaleString()}</td>
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
    const ap = co.availableByProd || {};
    const up = co.utilizationByProd || {};
    (co.products || []).forEach(p => {
      if (!prodMap[p]) prodMap[p] = { obtained:0, util:0, avail:0 };
      const cycleObt = (co.cycles||[]).filter(c=>/^obtained/i.test(c.type))
        .reduce((s,c) => s + (Number(c.products&&c.products[p])||0), 0);
      const obt = Number(cycleObt) > 0 ? Number(cycleObt) : (Number(co.obtained) / Math.max((co.products||[]).length,1));
      prodMap[p].obtained += Number(obt) || 0;
      prodMap[p].util     += Number(up[p]) || 0;
      prodMap[p].avail    += ap[p] != null ? (Number(ap[p]) || 0) : Math.max((Number(obt)||0) - (Number(up[p])||0), 0);
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
  const active  = SPI.filter(d => revisionStatus(d) === 'active');
  const reapply = SPI.filter(d => revisionStatus(d) === 'reapply');
  const revpend = SPI.filter(d => revisionStatus(d) === 'revpending');
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
  if (mtEl)  mtEl.textContent  = totalMT.toLocaleString() + ' MT';
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
      <span style="font-size:9.5px;color:var(--txt3)">${(d.mt||0).toLocaleString()} MT</span>
      ${daysEl}
    </div>`;
  }).join('');
}

/* Trigger rebuild when navigating to availquota page */
const _origGoPage = typeof goPage === 'function' ? goPage : null;