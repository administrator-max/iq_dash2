/* ═══════════════════════════════════════
   LEAD TIME ANALYTICS
   parseDate, computeLeadTimes,
   buildLeadTimeAnalytics, calcReapplyEst
═══════════════════════════════════════ */

function parseDate(str) {
  if (!str) return null;
  // Look for pattern like "30/10/25" or "09/01/26" or "27/11/2025"
  const m = str.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
  if (!m) return null;
  let [,d,mo,y] = m;
  if (y.length === 2) y = '20'+y;
  return new Date(+y, +mo-1, +d);
}

function extractSubmitDate(remarks) {
  // remarks: "SUBMIT MOT 30/10/25" or "SUBMIT MOI 05/11/25"
  return parseDate(remarks);
}

function extractIssuedDate(spiRef) {
  // spiRef may be "SPI TERBIT 7/11/25 · ..." or "PERTEK TERBIT 25/02/26"
  return parseDate(spiRef);
}

function diffDays(d1, d2) {
  if (!d1 || !d2) return null;
  return Math.round((d2 - d1) / (1000*60*60*24));
}

/* ─────────────────────────────────────────────────────────────────────────
   LEAD TIME ENGINE — cycle-level, 3-stage, period-aware
   
   For each Submit+Obtained cycle pair, calculate:
     Stage 1: Submit MOI → PERTEK Terbit   (days)
     Stage 2: PERTEK Terbit → Submit MOT   (days)
     Stage 3: Submit MOT → SPI Terbit      (days)
     Total:   Submit MOI → SPI Terbit      (days)
   
   One row per cycle, not per company. Respects period filter on Submit MOI.
   ───────────────────────────────────────────────────────────────────────── */
function computeLeadTimes() {
  const result = [];

  const processCompany = co => {
    const cycles = co.cycles || [];
    let i = 0;
    while (i < cycles.length) {
      const c = cycles[i];
      const isSubmitRow = /^submit #|^revision #/i.test(c.type);
      if (!isSubmitRow) { i++; continue; }

      // Find the matching obtained cycle following this submit
      const obtCycle = cycles.slice(i+1).find(x => /^obtained/i.test(x.type));

      const submitMOI    = pDate(c.submitDate);
      const pertekTerbit = pDate(c.releaseDate);   // PERTEK Terbit
      const submitMOT    = obtCycle ? pDate(obtCycle.submitDate)  : null;
      const spiTerbit    = obtCycle ? pDate(obtCycle.releaseDate) : null;

      // Period filter: use Submit MOI date of the submit cycle
      if (PERIOD.active && submitMOI && !inPd(submitMOI)) { i++; continue; }
      // Only skip if absolutely no date data at all (and not a Submit #2 worth tracking)
      const isSubmit2orRev = /^submit\s*#[2-9]|^revision/i.test(c.type);
      if (!submitMOI && !isSubmit2orRev) { i++; continue; }

      const s1 = pertekTerbit && submitMOI    ? Math.round((pertekTerbit-submitMOI)/(864e5))   : null;
      const s2 = submitMOT    && pertekTerbit ? Math.round((submitMOT-pertekTerbit)/(864e5))   : null;
      const s3 = spiTerbit    && submitMOT    ? Math.round((spiTerbit-submitMOT)/(864e5))      : null;
      const total = spiTerbit && submitMOI    ? Math.round((spiTerbit-submitMOI)/(864e5))      : null;

      result.push({
        code: co.code, group: co.group, products: co.products,
        cycleType: c.type,
        submitMOI, pertekTerbit, submitMOT, spiTerbit,
        s1, s2, s3,
        days: total,
        hasAllStages: !!(s1 !== null && s2 !== null && s3 !== null),
        submitStr: `SUBMIT MOI ${submitMOI ? submitMOI.toLocaleDateString('en-GB') : 'TBA'}`,
        issuedStr: spiTerbit ? `SPI TERBIT ${spiTerbit.toLocaleDateString('en-GB')}` : 'SPI TBA',
      });
      i++;
    }
  };

  [...SPI, ...PENDING].forEach(processCompany);

  return result
    .filter(r => r.submitMOI)
    .sort((a, b) => {
      const dd = (a.submitMOI||0) - (b.submitMOI||0);
      if (dd !== 0) return dd;
      return (a.days||999) - (b.days||999);
    });
}

function buildLeadTimeAnalytics() {
  const all = computeLeadTimes();
  if (!all.length) { document.getElementById('ltBadge').textContent = '0 cycles found'; return; }

  // Use only cycles with complete total (SPI issued) for KPI summaries
  const complete = all.filter(r => r.days !== null && r.days >= 0);
  // Use all cycles for stage breakdown (may have partial data)
  const withS1 = all.filter(r => r.s1 !== null && r.s1 >= 0);
  const withS3 = all.filter(r => r.s3 !== null && r.s3 >= 0);

  const avg = complete.length
    ? Math.round(complete.reduce((s, r) => s + r.days, 0) / complete.length) : 0;
  const avgS1 = withS1.length
    ? Math.round(withS1.reduce((s, r) => s + r.s1, 0) / withS1.length) : null;
  const avgS2 = all.filter(r=>r.s2!==null&&r.s2>=0).length
    ? Math.round(all.filter(r=>r.s2!==null&&r.s2>=0).reduce((s,r)=>s+r.s2,0)/all.filter(r=>r.s2!==null&&r.s2>=0).length) : null;
  const avgS3 = withS3.length
    ? Math.round(withS3.reduce((s, r) => s + r.s3, 0) / withS3.length) : null;

  const periodLabel = PERIOD.active ? ` (${PERIOD.label})` : '';
  document.getElementById('ltBadge').textContent =
    `${all.length} cycle${all.length!==1?'s':''} analysed${periodLabel}`;

  /* ── Sort chart data by total days for display ── */
  const chartData = [...complete].sort((a, b) => a.days - b.days);

  /* ── KPI Cards ── */
  const fmtD = n => n !== null ? `${n}d` : '—';
  document.getElementById('ltKpiRow').innerHTML = `
    <div style="background:var(--green-bg);border:1px solid var(--green-bd);border-radius:var(--r2);padding:12px 14px;border-top:3px solid var(--green-lt)">
      <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--green);margin-bottom:4px">Stage 1 Avg</div>
      <div style="font-size:11px;font-weight:600;color:var(--txt3);margin-bottom:2px">Submit MOI → PERTEK</div>
      <div style="font-size:24px;font-weight:700;color:var(--green);line-height:1">${fmtD(avgS1)} <span style="font-size:11px;font-weight:500">avg</span></div>
      <div style="font-size:9.5px;color:var(--txt3);margin-top:3px">${withS1.length} cycles w/ data</div>
    </div>
    <div style="background:var(--teal-bg);border:1px solid var(--teal-bd);border-radius:var(--r2);padding:12px 14px;border-top:3px solid var(--teal)">
      <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--teal);margin-bottom:4px">Stage 2 Avg</div>
      <div style="font-size:11px;font-weight:600;color:var(--txt3);margin-bottom:2px">PERTEK → Submit MOT</div>
      <div style="font-size:24px;font-weight:700;color:var(--teal);line-height:1">${fmtD(avgS2)} <span style="font-size:11px;font-weight:500">avg</span></div>
      <div style="font-size:9.5px;color:var(--txt3);margin-top:3px">${all.filter(r=>r.s2!==null&&r.s2>=0).length} cycles w/ data</div>
    </div>
    <div style="background:var(--blue-bg);border:1px solid var(--blue-bd);border-radius:var(--r2);padding:12px 14px;border-top:3px solid var(--blue)">
      <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--blue);margin-bottom:4px">Stage 3 Avg</div>
      <div style="font-size:11px;font-weight:600;color:var(--txt3);margin-bottom:2px">Submit MOT → SPI</div>
      <div style="font-size:24px;font-weight:700;color:var(--blue);line-height:1">${fmtD(avgS3)} <span style="font-size:11px;font-weight:500">avg</span></div>
      <div style="font-size:9.5px;color:var(--txt3);margin-top:3px">${withS3.length} cycles w/ data</div>
    </div>
    <div style="background:var(--amber-bg);border:1px solid var(--amber-bd);border-radius:var(--r2);padding:12px 14px;border-top:3px solid var(--amber-lt)">
      <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--amber);margin-bottom:4px">Total Avg</div>
      <div style="font-size:11px;font-weight:600;color:var(--txt3);margin-bottom:2px">MOI → SPI (end-to-end)</div>
      <div style="font-size:24px;font-weight:700;color:var(--amber);line-height:1">${avg}d <span style="font-size:11px;font-weight:500">avg</span></div>
      <div style="font-size:9.5px;color:var(--txt3);margin-top:3px">${complete.length} complete cycles</div>
    </div>`;

  /* ── Stacked Bar Chart: 3 stages per cycle ── */
  const labels    = chartData.map(r => r.code + (chartData.filter(x=>x.code===r.code).length>1 ? ` (${r.cycleType.replace(/submit /i,'').replace(/ #/,'#')})` : ''));
  const s1Data    = chartData.map(r => r.s1);
  const s2Data    = chartData.map(r => r.s2);
  const s3Data    = chartData.map(r => r.s3);
  const avgLine   = chartData.map(() => avg);

  mkChart('ltChart', {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'MOI→PERTEK',    data: s1Data, backgroundColor: '#21c55d', borderRadius:0, stack:'lt' },
        { label: 'PERTEK→MOT',    data: s2Data, backgroundColor: '#0c7c84', borderRadius:0, stack:'lt' },
        { label: 'MOT→SPI',       data: s3Data, backgroundColor: '#1e56c6', borderRadius:4, stack:'lt' },
        { label: `Total Avg (${avg}d)`, data: avgLine, type:'line',
          borderColor:'rgba(239,68,68,.7)', borderWidth:1.5, borderDash:[5,4],
          pointRadius:0, fill:false, stack:undefined }
      ]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { labels:{ font:{size:10.5,family:'DM Sans'}, color:'#64748b', boxWidth:10, padding:8 } },
        tooltip: {
          mode: 'index', intersect: false,
          callbacks: {
            title: ctx => {
              const r = chartData[ctx[0].dataIndex];
              return `${r.code} · ${r.cycleType}`;
            },
            label: ctx => {
              if (ctx.dataset.type === 'line') return ` Avg: ${avg}d`;
              const r = chartData[ctx.dataIndex];
              const stage = ctx.datasetIndex;
              const val = ctx.raw;
              if (val === null) return null;
              const dates = [
                r.submitMOI    ? r.submitMOI.toLocaleDateString('en-GB')    : '?',
                r.pertekTerbit ? r.pertekTerbit.toLocaleDateString('en-GB') : '?',
                r.submitMOT    ? r.submitMOT.toLocaleDateString('en-GB')    : '?',
                r.spiTerbit    ? r.spiTerbit.toLocaleDateString('en-GB')    : '?',
              ];
              const stageNames = [
                ` Stage 1 (MOI→PERTEK): ${val}d  [${dates[0]} → ${dates[1]}]`,
                ` Stage 2 (PERTEK→MOT): ${val}d  [${dates[1]} → ${dates[2]}]`,
                ` Stage 3 (MOT→SPI):    ${val}d  [${dates[2]} → ${dates[3]}]`,
              ];
              return stageNames[stage] || null;
            },
            footer: ctx => {
              const r = chartData[ctx[0].dataIndex];
              const tot = r.days !== null ? `Total: ${r.days}d (vs avg ${avg}d, ${r.days>avg?'+':''}${r.days-avg}d)` : `Total: TBA`;
              return tot;
            }
          }
        }
      },
      scales: {
        x: { stacked:true, grid:{display:false}, ticks:{font:{size:9,family:'DM Sans'},color:'#64748b'} },
        y: { stacked:true, grid:{color:'#f1f5f9'}, ticks:{font:{size:10},color:'#64748b',callback:v=>v+'d'} }
      },
      onClick: (e, els) => { if (els.length) openDrawer(chartData[els[0].index].code); }
    }
  });

  /* ── Detail Table: one row per cycle ── */
  const ptEl = document.getElementById('ltProdTable');
  const fmtDate = d => d ? d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'2-digit'}) : '—';
  const allSorted = [...all].sort((a,b) => (a.submitMOI||0)-(b.submitMOI||0));
  ptEl.innerHTML = `
    <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--txt3);margin-bottom:6px">All Cycles — Date Detail</div>
    <div style="overflow-y:auto;max-height:220px">
    <table style="width:100%;border-collapse:collapse;font-size:10px">
      <thead><tr style="background:var(--bg2);position:sticky;top:0">
        <th style="padding:4px 6px;text-align:left;font-weight:700;color:var(--txt3);white-space:nowrap">Co.</th>
        <th style="padding:4px 6px;text-align:left;font-weight:700;color:var(--txt3);white-space:nowrap">Cycle</th>
        <th style="padding:4px 4px;text-align:center;font-weight:700;color:var(--green);white-space:nowrap">S1</th>
        <th style="padding:4px 4px;text-align:center;font-weight:700;color:var(--teal);white-space:nowrap">S2</th>
        <th style="padding:4px 4px;text-align:center;font-weight:700;color:var(--blue);white-space:nowrap">S3</th>
        <th style="padding:4px 4px;text-align:center;font-weight:700;color:var(--amber);white-space:nowrap">Tot</th>
      </tr></thead>
      <tbody>${allSorted.map(r => {
        const col = r.days===null?'var(--txt3)':r.days<=avg*0.85?'var(--green)':r.days<=avg?'var(--teal)':r.days<=avg*1.3?'var(--amber)':'var(--red)';
        const cycleShort = r.cycleType.replace(/^Submit /i,'').replace(/^Obtained /i,'Obt ').replace(/ #(\d)/,'#$1');
        return `<tr style="border-bottom:1px solid var(--border)">
          <td style="padding:3px 6px;font-weight:700;color:var(--txt)">${r.code}</td>
          <td style="padding:3px 6px;color:var(--txt3);font-size:9px">${r.cycleType}</td>
          <td style="padding:3px 4px;text-align:center;color:var(--green)">${r.s1!==null?r.s1+'d':'—'}</td>
          <td style="padding:3px 4px;text-align:center;color:var(--teal)">${r.s2!==null?r.s2+'d':'—'}</td>
          <td style="padding:3px 4px;text-align:center;color:var(--blue)">${r.s3!==null?r.s3+'d':'—'}</td>
          <td style="padding:3px 4px;text-align:center;font-weight:700;color:${col}">${r.days!==null?r.days+'d':'—'}</td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>
    <div style="margin-top:6px;font-size:9px;color:var(--txt3)">S1=MOI→PERTEK · S2=PERTEK→MOT · S3=MOT→SPI</div>`;
}


/* ETA JKT editing removed — data imported via Excel/manual import */

/** Helper: get week label for a date, e.g. "W3 Apr" */
function getWeekLabel(date) {
  const m = date.toLocaleDateString('en-GB',{month:'short'});
  const d = date.getDate();
  const w = d <= 7 ? 'W1' : d <= 14 ? 'W2' : d <= 21 ? 'W3' : 'W4';
  return w + ' ' + m;
}

/** Helper: compute reapply estimate = arrivalDate + 7 days, formatted as "DD Mon YYYY" */
function calcReapplyEst(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  d.setDate(d.getDate() + 7);
  return d.toLocaleDateString('en-GB', {day:'2-digit', month:'short', year:'numeric'});
}


/** Build the interactive ETA JKT cell HTML for a given RA record */
/** updateGaugeCounts — refresh the status counter badges in the Shipment card header */
function updateGaugeCounts() {
  const allRA = filteredRA();
  const sub   = allRA.filter(isReapplySubmitted).length;
  const elig  = allRA.filter(isEligible).length;
  const ship  = allRA.filter(d => !d.cargoArrived && !isReapplySubmitted(d)).length;
  const below = allRA.filter(d => d.cargoArrived && !isEligible(d) && !isReapplySubmitted(d)).length;
  const set = (id, val) => { const el=document.getElementById(id); if(el) el.textContent=val; };
  set('gaugeSubmitted',  sub);
  set('gaugeElig',       elig);
  set('gaugeTransit',    ship);
  set('gaugeBelowThresh',below);
}

/** etaBuildCell — DEPRECATED (ETA is now read-only; imported from data) */
function etaBuildCell(d) {
  if (d.cargoArrived) {
    return `<span style="font-size:11px;font-weight:700;color:var(--green)">✓ ${d.etaJKT||'Arrived'}</span>`;
  }
  return `<span style="font-size:11px;font-weight:600;color:var(--orange)">🚢 ${d.etaJKT||'—'}</span>`;
}

/** Re-render all affected views after ETA/arrival change */
function refreshAfterEtaChange() {
  renderUtilTable();   // in-shipment table
  renderRATable();     // unified re-apply monitoring table
  renderMain();
  buildUtilChart();
  buildFlowKPIStrip();
  buildTopCo();
  updateGaugeCounts();
  updateOverviewStats();
}

/** Rebuild overview realized MT / eligible count from live RA data */
function updateOverviewStats() {
  const fRa      = filteredRA(); // ← use filtered set so period filter applies
  const submitted = fRa.filter(isReapplySubmitted).length;
  const eligible  = fRa.filter(isEligible).length;
  const inShip    = fRa.filter(r => !r.cargoArrived).length;
  const arrived   = fRa.filter(r => r.cargoArrived);
  const totalBerat   = arrived.reduce((s,r) => s + r.berat, 0);
  const totalObtArr  = arrived.reduce((s,r) => s + r.obtained, 0);
  const realPct   = totalObtArr > 0 ? totalBerat / totalObtArr : 0;
  const subCodes  = fRa.filter(isReapplySubmitted).map(r=>r.code).join(', ') || '—';
  const eligCodes = fRa.filter(isEligible).map(r=>r.code).join(', ') || '—';
  const below     = fRa.filter(r => r.cargoArrived && r.realPct < 0.6 && !isReapplySubmitted(r)).length;
  // Update gauge text
  const gPct = document.querySelector('.gauge-pct');
  if (gPct) gPct.textContent = (realPct*100).toFixed(1) + '%';
  // Update gauge MT stat boxes
  const gRealMT = document.getElementById('gaugeRealMT');
  if (gRealMT) gRealMT.textContent = totalBerat.toLocaleString(undefined,{maximumFractionDigits:0});
  const gRemMT = document.getElementById('gaugeRemainMT');
  if (gRemMT) gRemMT.textContent = Math.max(0, totalObtArr - totalBerat).toLocaleString(undefined,{maximumFractionDigits:0});
  // Update gauge stat boxes
  const gs = document.getElementById('gaugeSubmitted'); if (gs) gs.textContent = submitted;
  const ge = document.getElementById('gaugeElig');      if (ge) ge.textContent = eligible;
  const gt = document.getElementById('gaugeTransit');   if (gt) gt.textContent = inShip;
  const gb = document.getElementById('gaugeBelowThresh');if(gb) gb.textContent = below;
  // Update insight strip
  const insVal = document.getElementById('insRealVal') || document.querySelector('.ins-val.insight-real');
  if (insVal) insVal.textContent = `${submitted} Submitted · ${eligible} Eligible · ${inShip} In Shipment`;
  const insSub = document.getElementById('insRealSub') || document.querySelector('.ins-sub.insight-real-sub');
  if (insSub) insSub.textContent = submitted > 0
    ? `Submitted: ${subCodes}${eligible > 0 ? ' · Eligible: '+eligCodes : ''}`
    : `Eligible: ${eligCodes}`;
  updateOverviewKPIs();
}


/* ══════════════════════════════════════════════════
   LOCAL STORAGE — Persistence Engine
   Saves mutable fields of RA and SPI to localStorage.
   Auto-loads on startup, survives page refresh.
══════════════════════════════════════════════════ */