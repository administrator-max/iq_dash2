/* ═══════════════════════════════════════
   UTILIZATION TABLE + RA TABLE
   + Comparison List + Pending Table
═══════════════════════════════════════ */

function setUtilTab(mode, el) {
  utilTabMode = mode;
  // Reset all 4 tab buttons
  ['utilTab1','utilTab2','utilTab3','utilTab4'].forEach(id => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.style.fontWeight   = '600';
    btn.style.color        = 'var(--txt2)';
    btn.style.borderBottom = '3px solid transparent';
  });
  const colors = { INSHIP:'var(--orange)', ARRIVED:'var(--green)', WAITING:'#64748b', REAPPLY:'#5b21b6' };
  el.style.fontWeight   = '700';
  el.style.color        = colors[mode];
  el.style.borderBottom = `3px solid ${colors[mode]}`;

  // Show/hide the correct table wrapper
  const uw = document.getElementById('utilBodyWrap');
  const rw = document.getElementById('raBodyWrap');
  if (uw) uw.style.display = mode === 'REAPPLY' ? 'none' : '';
  if (rw) rw.style.display = mode === 'REAPPLY' ? ''     : 'none';

  // Update label strip
  const lbl = document.getElementById('utilTabLabel');
  if (lbl) {
    const labels = {
      INSHIP:  { text:'🚢 In Shipment — Cargo NOT Yet at JKT · Utilization counted · Realization pending',                                     bg:'var(--orange-bg)', color:'var(--orange)', bd:'var(--orange-bd)' },
      ARRIVED: { text:'✓ Arrived at JKT — Beacukai Registered · Realization counted',                                                          bg:'var(--green-bg)',  color:'var(--green)',  bd:'var(--green-bd)'  },
      WAITING: { text:'⏳ Waiting Utilization &amp; Shipment — PERTEK quota obtained · No shipment scheduled · Utilization not yet recorded',   bg:'#f8fafc',          color:'#64748b',       bd:'#e2e8f0'          },
      REAPPLY: { text:'🔵 Re-Apply Monitoring &amp; Submission Plan — Realization performance · Eligibility · Re-Apply planning',               bg:'#f5f3ff',          color:'#5b21b6',       bd:'#c4b5fd'          },
    };
    const l = labels[mode];
    lbl.innerHTML            = l.text;
    lbl.style.background     = l.bg;
    lbl.style.color          = l.color;
    lbl.style.borderBottom   = `1px solid ${l.bd}`;
  }

  if (mode === 'REAPPLY') {
    renderRATable();
  } else {
    renderUtilTable();
  }
}

/* Realization Monitoring — flat per-product rows, one row per product per company */
function renderUtilTable() {
  buildFlowKPIStrip();

  const raMap = {};
  filteredRA().forEach(r => { raMap[r.code] = r; });

  // ── Build flat per-product rows from RA + SPI data ────────────────────────────
  function buildFlatRows(d) {
    const co  = getSPI(d.code);
    const ubp = co ? (co.utilizationByProd  || {}) : {};
    const rbp = co ? (co.realizationByProd  || {}) : {};
    const ebp = co ? (co.etaByProd          || {}) : {};
    const abp = co ? (co.arrivedByProd      || {}) : {};
    const obtByProd = co ? getObtainedByProd(co) : {};
    const prods = Object.keys(obtByProd).filter(p => (obtByProd[p]||0) > 0);

    // Single-product: one row
    if (!prods.length || prods.length === 1) {
      const prod = prods[0] || d.product;
      return [{
        code: d.code, product: prod,
        obtained:     obtByProd[prod] || d.obtained || 0,
        utilMT:       ubp[prod] || d.berat || 0,
        realMT:       rbp[prod] != null ? rbp[prod] : (d.cargoArrived ? d.berat : 0),
        realPct:      d.realPct || 0,
        etaJKT:       ebp[prod] || d.etaJKT || '',
        cargoArrived: abp[prod] != null ? (abp[prod] === true) : d.cargoArrived,
        _isFirst: true, _isSub: false, _subCount: 1,
        _origRA: d,
      }];
    }

    // Multi-product: one full row per product
    const hasRBP = Object.keys(rbp).length > 0;
    return prods.map((prod, idx) => {
      const prodObt     = obtByProd[prod] || 0;
      const prodUtil    = ubp[prod] || 0;
      const prodArrived = Object.keys(abp).length > 0 ? (abp[prod] === true) : d.cargoArrived;
      const prodReal    = hasRBP
        ? (rbp[prod] || 0)
        : (prodArrived && d.obtained > 0
            ? Math.round(d.berat * (prodObt / d.obtained) * 100) / 100
            : 0);
      const prodRealPct = prodObt > 0 ? prodReal / prodObt : 0;
      return {
        code: d.code, product: prod,
        obtained:     prodObt,
        utilMT:       prodUtil,
        realMT:       prodReal,
        realPct:      prodRealPct,
        etaJKT:       ebp[prod] || d.etaJKT || '',
        cargoArrived: prodArrived,
        _isFirst:  idx === 0,
        _isSub:    idx > 0,
        _subCount: prods.length,
        _origRA:   d,
      };
    });
  }

  // ── Build pool ──────────────────────────────────────────────────────────────
  const baseRA = [...filteredRA()];
  filteredSPI().forEach(co => {
    if (raMap[co.code]) return;
    if (!co.shipments || !Object.keys(co.shipments).length) return;
    const allLots   = Object.values(co.shipments).flat();
    const totalUtil = allLots.reduce((s,l) => s+(l.utilMT||0), 0);
    if (totalUtil <= 0) return;
    baseRA.push({
      code: co.code, product: (co.products||[]).join(' + '),
      berat: totalUtil, obtained: co.obtained || 0,
      cargoArrived: false, realPct: 0,
      utilPct: Math.min(1, totalUtil/(co.obtained||1)),
      etaJKT: allLots.filter(l=>l.etaJKT).map(l=>l.etaJKT)[0] || '',
      reapplyStage: null,
    });
  });

  // ── Waiting pool ────────────────────────────────────────────────────────────
  const waitingFlat = [];
  filteredSPI().forEach(co => {
    if (raMap[co.code]) return;
    if ((co.utilizationMT || 0) > 0) return;
    if (!co.obtained || co.obtained <= 0) return;
    if (co.shipments) {
      const lots = Object.values(co.shipments).flat();
      if (lots.some(l => (l.utilMT||0) > 0)) return;
    }
    const obtByProd = getObtainedByProd(co);
    const prods     = Object.keys(obtByProd).filter(p => (obtByProd[p]||0) > 0);
    if (!prods.length) return;
    prods.forEach((prod, idx) => {
      waitingFlat.push({
        code: co.code, product: prod,
        obtained: obtByProd[prod] || 0,
        utilMT: 0, realMT: 0, realPct: 0,
        etaJKT: '', cargoArrived: false,
        _isWaiting: true,
        _isFirst: idx === 0, _isSub: idx > 0, _subCount: prods.length,
      });
    });
  });

  // Expand all RA to flat rows
  const allFlat = [];
  baseRA.forEach(d => buildFlatRows(d).forEach(r => allFlat.push(r)));

  const inShipRows  = allFlat.filter(r => !r.cargoArrived);
  const arrivedRows = allFlat.filter(r =>  r.cargoArrived);

  const sortFn = (a,b) => {
    const cc = a.code.localeCompare(b.code);
    return cc !== 0 ? cc : (a.product||'').localeCompare(b.product||'');
  };
  inShipRows.sort(sortFn);
  arrivedRows.sort(sortFn);
  waitingFlat.sort(sortFn);

  // Recompute _isFirst/_isSub after sort — flags baked in pre-sort may be wrong
  // if products sort into a different order than they appeared in obtByProd.
  [inShipRows, arrivedRows, waitingFlat].forEach(arr => {
    let lastCode = null;
    const codeCounts = {};
    arr.forEach(r => { codeCounts[r.code] = (codeCounts[r.code] || 0) + 1; });
    arr.forEach(r => {
      r._isFirst  = r.code !== lastCode;
      r._isSub    = r.code === lastCode;
      r._subCount = codeCounts[r.code] || 1;
      lastCode    = r.code;
    });
  });

  const waitingCos = [...new Set(waitingFlat.map(r => r.code))].length;
  const gw = document.getElementById('gaugeWaiting');
  if (gw) gw.textContent = waitingCos;

  const tbody = document.getElementById('utilBody');
  tbody.innerHTML = '';

  // ── Row renderer — every product is a full standalone row ─────────────────
  function renderRow(r) {
    const isFirst  = r._isFirst  === true;
    const isSub    = r._isSub    === true;
    const isMulti  = (r._subCount || 0) > 1;
    const arrived  = r.cargoArrived;
    const isWait   = r._isWaiting === true;

    // Left border: first product of company gets full accent; sub-products get lighter
    const lBd = isWait
      ? (isSub ? 'border-left:3px solid #e2e8f0' : 'border-left:3px solid #94a3b8')
      : isSub
        ? `border-left:3px solid ${arrived ? '#bbf7d0' : '#fed7aa'}`
        : `border-left:3px solid ${arrived ? 'var(--green-lt)' : 'var(--orange)'}`;
    const rowBg  = isWait ? 'background:#f8fafc'
                 : arrived ? 'background:#f8fffe' : 'background:#fff8f3';
    const topBd  = isSub ? 'border-top:1px dashed var(--border)'
                 : isFirst && isMulti ? 'border-top:2px solid var(--border2)' : '';

    // Company code cell — show code only on first product row; indent arrow for rest
    const codeCell = isSub
      ? `<div style="padding-left:14px;font-size:10.5px;color:var(--txt3)">↳</div>`
      : `<div class='t-code' onclick="openDrawer('${r.code}');event.stopPropagation()">${r.code}</div>
         ${isMulti ? `<div style="font-size:9px;color:var(--txt3);margin-top:1px">${r._subCount} products</div>` : ''}`;

    // Product cell — indented for sub-products
    const dot = `<span style="width:7px;height:7px;border-radius:50%;background:${pc(r.product).solid};flex-shrink:0"></span>`;
    const prodCell = isSub
      ? `<div style="padding-left:20px;display:flex;align-items:center;gap:5px">${dot}<span style="font-size:11.5px;color:var(--txt2)">${r.product}</span></div>`
      : `<div style="display:flex;align-items:center;gap:5px">${dot}<span style="font-size:11.5px;font-weight:${isMulti?'600':'400'}">${r.product}</span></div>`;

    // Obtained
    const obtCell = `<span class="t-mono" style="font-size:11.5px;font-weight:700;color:${isSub?'var(--txt2)':'var(--txt)'}">${(r.obtained||0).toLocaleString()}</span>`;

    // Utilization
    const utilMT  = r.utilMT || 0;
    const utilPct = r.obtained > 0 ? utilMT / r.obtained : 0;
    const uClr    = utilPct >= 0.8 ? 'var(--green)' : utilPct >= 0.5 ? 'var(--blue)' : 'var(--txt2)';
    const utilCell = isWait
      ? `<span style="font-size:10px;color:var(--txt3);font-style:italic">—</span>`
      : utilMT > 0
        ? `<div><span class="t-mono" style="font-size:11.5px;font-weight:700;color:var(--blue)">${utilMT.toLocaleString()}</span>
             <div style="font-size:9.5px;color:${uClr};margin-top:1px">${(utilPct*100).toFixed(1)}%</div></div>`
        : `<span style="font-size:10px;color:var(--txt3)">—</span>`;

    // Realization MT
    const realMT  = r.realMT || 0;
    const realPct = r.realPct || 0;
    const realMTCell = isWait
      ? `<span style="font-size:10px;color:var(--txt3);font-style:italic">—</span>`
      : arrived
        ? `<span class="t-mono" style="font-size:11.5px;font-weight:700;color:${realColor(realPct)}">${realMT.toLocaleString()}</span>`
        : `<span style="font-size:10px;color:var(--txt3);font-style:italic">—</span>`;

    // Realization %
    const realPctCell = isWait
      ? `<span style="font-size:10px;color:var(--txt3);font-style:italic">—</span>`
      : arrived
        ? `<div><div style="font-size:11.5px;font-weight:700;color:${realColor(realPct)};margin-bottom:2px">${(realPct*100).toFixed(1)}%</div>
             <div class="u-trk" style="width:68px"><div class="u-fill" style="width:${Math.min(realPct*100,100)}%;background:${realFill(realPct)}"></div></div></div>`
        : `<span style="font-size:10px;color:var(--txt3);font-style:italic">Pending</span>`;

    // ETA
    const etaCell = isWait
      ? `<span style="font-size:10px;color:var(--txt3)">—</span>`
      : r.etaJKT
        ? arrived
          ? `<span style="font-size:11px;font-weight:700;color:var(--green)">✓ ${r.etaJKT}</span>`
          : `<span style="font-size:11px;font-weight:600;color:var(--orange)">🚢 ${r.etaJKT}</span>`
        : `<span style="font-size:10px;color:var(--txt3)">—</span>`;

    // Status
    const statusCell = isWait
      ? `<span style="font-size:9.5px;font-weight:700;padding:2px 8px;border-radius:3px;background:#f8fafc;color:#64748b;border:1px solid #e2e8f0">⏳ Awaiting Utilization</span>`
      : arrived
        ? `<span style="font-size:9.5px;font-weight:700;padding:2px 8px;border-radius:3px;background:var(--green-bg);color:var(--green);border:1px solid var(--green-bd)">✓ Arrived JKT</span>`
        : `<span style="font-size:9.5px;font-weight:700;padding:2px 8px;border-radius:3px;background:var(--orange-bg);color:var(--orange);border:1px solid var(--orange-bd)">🚢 In Shipment</span>`;

    return `<tr style="cursor:pointer;${rowBg};${topBd}" onclick="openDrawer('${r.code}')">
      <td style="${lBd}">${codeCell}</td>
      <td>${prodCell}</td>
      <td class="t-r" style="padding:5px 8px">${obtCell}</td>
      <td class="t-r" style="padding:5px 8px">${utilCell}</td>
      <td class="t-r" style="padding:5px 8px">${realMTCell}</td>
      <td style="padding:5px 8px">${realPctCell}</td>
      <td style="padding:5px 8px">${etaCell}</td>
      <td style="padding:5px 8px">${statusCell}</td>
    </tr>`;
  }

  // ── Render active tab ────────────────────────────────────────────────────────
  const mode = utilTabMode || 'INSHIP';
  const rows = mode === 'INSHIP' ? inShipRows : mode === 'ARRIVED' ? arrivedRows : waitingFlat;

  if (!rows.length) {
    const msgs = { INSHIP:'No in-shipment records.', ARRIVED:'No arrived records.', WAITING:'No companies awaiting utilization &amp; shipment.' };
    tbody.innerHTML = `<tr><td colspan='8' style='padding:24px;text-align:center;color:var(--txt3);font-size:12px'>${msgs[mode]||''}</td></tr>`;
  } else {
    rows.forEach(r => { tbody.innerHTML += renderRow(r); });
  }

  // Count
  const countEl = document.getElementById('utilBodyCount');
  if (countEl) {
    const n = [...new Set(rows.map(r => r.code))].length;
    countEl.textContent = `${n} compan${n===1?'y':'ies'}`;
  }

  updateGaugeCounts();
}



/* Re-Apply Monitoring & Submission Plan — ALL RA companies, 9 columns */
function renderRATable() {
  // Sort: 0=Submitted → 1=Eligible → 2=InShipment → 3=Arrived<60%
  const group = d => {
    if (isReapplySubmitted(d)) return 0;
    if (isEligible(d))         return 1;
    if (!d.cargoArrived)       return 2;
    return 3;
  };
  const sorted = [...filteredRA()].sort((a,b) => {
    const gd = group(a) - group(b);
    if (gd !== 0) return gd;
    // Within same group: sort A→Z by company code
    return a.code.localeCompare(b.code);
  });

  const tbody = document.getElementById('raBody');
  tbody.innerHTML = '';

  const submitted = sorted.filter(d => isReapplySubmitted(d)).length;
  const eligible  = sorted.filter(d => isEligible(d)).length;
  const inShip    = sorted.filter(d => !d.cargoArrived && !isReapplySubmitted(d)).length;
  const below     = sorted.filter(d => d.cargoArrived && !isEligible(d) && !isReapplySubmitted(d)).length;

  const badges = document.getElementById('raMonitorBadges');
  if (badges) badges.innerHTML = `
    <span style="font-size:10px;font-weight:700;padding:3px 10px;border-radius:3px;background:#f5f3ff;color:#5b21b6;border:1px solid #c4b5fd">🔵 ${submitted} Submitted</span>
    <span style="font-size:10px;font-weight:700;padding:3px 10px;border-radius:3px;background:var(--green-bg);color:var(--green);border:1px solid var(--green-bd)">✅ ${eligible} Eligible</span>
    <span style="font-size:10px;font-weight:700;padding:3px 10px;border-radius:3px;background:var(--orange-bg);color:var(--orange);border:1px solid var(--orange-bd)">🚢 ${inShip} In Shipment</span>
    <span style="font-size:10px;font-weight:700;padding:3px 10px;border-radius:3px;background:var(--red-bg);color:var(--red2);border:1px solid var(--red-bd)">❌ ${below} &lt;60%</span>`;
  const counter = document.getElementById('raMonitorCount');
  if (counter) counter.textContent = `${sorted.length} compan${sorted.length===1?'y':'ies'}`;

  if (!sorted.length) {
    tbody.innerHTML = `<tr><td colspan='9' style='padding:18px;text-align:center;color:var(--txt3);font-size:12px'>No records found.</td></tr>`;
    return;
  }

  const groupLabels = [
    {txt:'🔵 Re-Apply Submitted — New PERTEK On Process (Stage 2)',        col:'#5b21b6',       bg:'#f5f3ff',           bd:'#c4b5fd'},
    {txt:'✅ Eligible — Realization ≥ 60% · Ready to Submit Re-Apply',     col:'var(--green)',   bg:'var(--green-bg)',   bd:'var(--green-bd)'},
    {txt:'🚢 In Shipment — Cargo NOT Yet at JKT · See Realization Monitoring above', col:'var(--orange)',  bg:'var(--orange-bg)',  bd:'var(--orange-bd)'},
    {txt:'❌ Arrived — Realization < 60% · Not Yet Eligible for Re-Apply', col:'var(--red2)',    bg:'var(--red-bg)',     bd:'var(--red-bd)'},
  ];

  let lastGroup = -1;
  sorted.forEach(d => {
    const g   = group(d);
    const sub = isReapplySubmitted(d);
    const elig= isEligible(d);

    // ── Group header row ──────────────────────────────────────────────
    if (g !== lastGroup) {
      lastGroup = g;
      const lbl = groupLabels[g];
      tbody.innerHTML += `<tr><td colspan='9' style='padding:6px 14px;background:${lbl.bg};border-top:2px solid ${lbl.bd};border-bottom:1px solid ${lbl.bd};font-size:10px;font-weight:700;color:${lbl.col};letter-spacing:.3px'>${lbl.txt}</td></tr>`;
    }

    // ── Per-product breakdown (multi-product detection) ──────────────
    const coSPI      = getSPI(d.code);
    const obtByProd  = coSPI ? getObtainedByProd(coSPI) : {};
    const prodKeys   = Object.keys(obtByProd);
    const isMulti    = prodKeys.length > 1;

    // Row styling by group
    const rowBg = g===0?'background:#faf5ff':g===1?'':g===2?'background:#fff8f3':'background:#fff5f5';
    const lBd   = g===0?'border-left:3px solid #8b5cf6':g===1?'border-left:3px solid var(--green-lt)':g===2?'border-left:3px solid var(--orange)':'border-left:3px solid var(--red-lt)';
    const lBdSub= g===0?'border-left:3px solid #c4b5fd':g===1?'border-left:3px solid #bbf7d0':g===2?'border-left:3px solid #fed7aa':'border-left:3px solid #fecaca';

    // Shipment Status
    const shipStatus = d.cargoArrived
      ? `<div><span style='font-size:9.5px;font-weight:700;padding:2px 8px;border-radius:3px;background:var(--green-bg);color:var(--green);border:1px solid var(--green-bd)'>✓ Arrived JKT</span>
         <div style='font-size:9px;color:var(--txt3);margin-top:2px'>${d.etaJKT||''}</div></div>`
      : `<div><span style='font-size:9.5px;font-weight:700;padding:2px 8px;border-radius:3px;background:var(--orange-bg);color:var(--orange);border:1px solid var(--orange-bd)'>🚢 In Shipment</span>
         <div style='font-size:9px;color:var(--txt3);margin-top:2px'>ETA: ${d.etaJKT||'—'}</div></div>`;

    // Company-level Realization MT
    // Use sum of realizationByProd if present (exact per-product figures); else fall back to d.berat
    const rbpParent   = coSPI ? (coSPI.realizationByProd || {}) : {};
    const abpParent   = coSPI ? (coSPI.arrivedByProd     || {}) : {};
    const hasRBPParent = Object.keys(rbpParent).length > 0;
    const realMT = hasRBPParent
      ? Object.values(rbpParent).reduce((s, v) => s + (v || 0), 0)
      : (d.cargoArrived ? d.berat : 0);
    const realPctCalc = d.obtained > 0 ? realMT / d.obtained : d.realPct;
    const realMTCell = (d.cargoArrived || hasRBPParent)
      ? `<div>
           <span style='font-size:12px;font-weight:700;color:${realColor(realPctCalc)}'>${realMT.toLocaleString()}</span>
           ${hasRBPParent && Object.keys(rbpParent).some(p => rbpParent[p] > 0 && !(abpParent[p]))
             ? `<div style='font-size:9px;color:var(--txt3);font-style:italic;margin-top:1px'>Partial · some products pending</div>`
             : ''}
         </div>`
      : `<span style='font-size:10px;color:var(--txt3);font-style:italic'>Pending arrival</span>`;

    // Company-level Realization %
    const realPctCell = (d.cargoArrived || hasRBPParent)
      ? `<div><div style='font-size:12px;font-weight:700;color:${realColor(realPctCalc)};margin-bottom:2px'>${(realPctCalc*100).toFixed(1)}%</div>
           <div class='u-trk' style='width:65px'><div class='u-fill' style='width:${Math.min(realPctCalc*100,100)}%;background:${realFill(realPctCalc)}'></div></div></div>`
      : `<div><div style='font-size:12px;font-weight:700;color:var(--blue);margin-bottom:2px'>${d.utilPct!=null?(d.utilPct*100).toFixed(1)+'%':'—'}</div>
           <div style='font-size:9px;color:var(--txt3);font-style:italic'>Util% · pending arrival</div></div>`;

    // Remaining Balance = obtained − total realization (exact figures)
    const remaining = Math.max(0, d.obtained - realMT);
    const remCell   = remaining > 0
      ? `<span style='font-size:12px;font-weight:700;color:var(--teal)'>${remaining.toLocaleString()}</span>`
      : `<span style='font-size:10px;font-weight:700;color:var(--green)'>✓ Fully Realized</span>`;

    // Re-Apply Status badge
    const raStatus = sub
      ? `<span class='badge b-reapply' style='font-size:10px'>🔵 Submitted</span>`
      : elig
        ? `<span class='badge b-eligible' style='font-size:10px'>✅ Eligible</span>`
        : g===2
          ? `<span style='font-size:9.5px;font-weight:700;padding:2px 7px;border-radius:3px;background:var(--orange-bg);color:var(--orange);border:1px solid var(--orange-bd)'>🚢 In Shipment</span>`
          : `<span class='badge b-ineligible' style='font-size:10px'>✗ &lt;60%</span>`;

    // Re-Apply Submission Date
    const subDate = d.reapplyEst
      ? `<span style='font-size:11px;font-weight:700;color:var(--violet)'>${d.reapplyEst}</span>`
      : d.cargoArrived
        ? `<span style='font-size:10px;color:var(--txt3)'>—</span>`
        : `<span style='font-size:9.5px;color:var(--txt3);font-style:italic'>After arrival</span>`;

    // Product cell: list all products for multi-product companies
    const prodCell = isMulti
      ? `<div style='display:flex;flex-direction:column;gap:2px'>
           ${prodKeys.map(p => `<span style='display:inline-flex;align-items:center;gap:4px;font-size:10.5px'>
             <span style='width:6px;height:6px;border-radius:2px;background:${pc(p).solid};flex-shrink:0'></span>
             <span style='font-weight:600'>${p}</span>
           </span>`).join('')}
           <span style='font-size:9px;color:var(--txt3);margin-top:1px'>${prodKeys.length} products</span>
         </div>`
      : `<span style='font-size:11.5px'>${d.product}</span>`;

    // ── Parent row (company-level totals) ────────────────────────────
    tbody.innerHTML += `<tr style='cursor:pointer;${rowBg};border-top:2px solid var(--border2)' onclick="openDrawer('${d.code}')">
      <td style='${lBd}'>
        <div class='t-code'>${d.code}</div>
        <div style='font-size:9px;color:var(--txt3);margin-top:1px'>${prodKeys.length} product${prodKeys.length>1?'s':''}</div>
      </td>
      <td>${prodCell}</td>
      <td>${shipStatus}</td>
      <td class='t-r'>${realMTCell}</td>
      <td>${realPctCell}</td>
      <td class='t-r'>${remCell}</td>
      <td>${raStatus}</td>
      <td>${subDate}</td>
      <td class='t-r t-mono' style='color:var(--amber2);font-weight:700'>${d.target?d.target.toLocaleString()+' MT':'<span style="color:var(--txt3);font-weight:400">TBA</span>'}</td>
    </tr>`;

    // ── ↳ Sub-rows: one per product for ALL companies ──────────────────
    prodKeys.forEach(prod => {
      const prodObt    = obtByProd[prod] || 0;
      const ubp        = coSPI ? (coSPI.utilizationByProd  || {}) : {};
      const rbp        = coSPI ? (coSPI.realizationByProd  || {}) : {};
      const abp        = coSPI ? (coSPI.arrivedByProd      || {}) : {};
      const prodUtilMT = ubp[prod] || 0;

      // Per-product arrival: use arrivedByProd if present, else company-level cargoArrived
      const prodArrived = Object.keys(abp).length > 0 ? (abp[prod] === true) : d.cargoArrived;

      // Per-product realization: use realizationByProd if present, else proportional of berat
      const hasRBP     = Object.keys(rbp).length > 0;
      const prodRealMT = hasRBP
        ? (rbp[prod] || 0)
        : (prodArrived && d.obtained > 0
            ? Math.round(d.berat * (prodObt / d.obtained) * 10) / 10
            : 0);
      const prodRealPct = prodObt > 0 ? prodRealMT / prodObt : 0;
      // Remaining = obtained − realization (exact per-product figures)
      const prodRem     = Math.max(0, prodObt - prodRealMT);

      // Utilization cell — show for in-shipment products; "—" for fully arrived
      const subUtilMTCell = prodArrived
        ? `<span style='font-size:10px;color:var(--txt3)'>—</span>`
        : (prodUtilMT > 0
            ? `<div>
                 <span style='font-size:11.5px;font-weight:600;color:var(--blue)'>${prodUtilMT.toLocaleString()}</span>
                 <div style='font-size:9px;color:var(--txt3);margin-top:1px'>${prodObt>0?(prodUtilMT/prodObt*100).toFixed(1)+'%':''}</div>
               </div>`
            : `<span style='font-size:10px;color:var(--txt3)'>—</span>`);

      // Realization cell — exact figure if arrived; util MT if still in shipment
      const subRealMTCell = prodArrived
        ? `<div>
             <span style='font-size:11.5px;font-weight:600;color:${realColor(prodRealPct)}'>${prodRealMT.toLocaleString()}</span>
             <span style='font-size:9px;font-weight:700;padding:1px 5px;border-radius:3px;background:#dcfce7;color:var(--green);border:1px solid #bbf7d0;margin-left:4px'>✓ Arrived</span>
           </div>`
        : (prodUtilMT > 0
            ? `<div>
                 <span style='font-size:11.5px;font-weight:600;color:var(--blue)'>${prodUtilMT.toLocaleString()}</span>
                 <div style='font-size:9px;color:var(--txt3);font-style:italic;margin-top:1px'>Util · Real pending</div>
               </div>`
            : `<span style='font-size:10px;color:var(--txt3);font-style:italic'>Pending arrival</span>`);

      const subRealPctCell = prodArrived
        ? `<div style='display:flex;flex-direction:column;gap:2px'>
             <span style='font-size:11.5px;font-weight:700;color:${realColor(prodRealPct)}'>${(prodRealPct*100).toFixed(1)}%</span>
             <div class='u-trk' style='width:55px'><div class='u-fill' style='width:${Math.min(prodRealPct*100,100)}%;background:${realFill(prodRealPct)}'></div></div>
           </div>`
        : (prodUtilMT > 0
            ? `<div style='display:flex;flex-direction:column;gap:2px'>
                 <span style='font-size:11.5px;font-weight:700;color:var(--blue)'>${prodObt>0?(prodUtilMT/prodObt*100).toFixed(1)+'%':'—'}</span>
                 <div style='font-size:9px;color:var(--txt3);font-style:italic'>Util% · pending</div>
               </div>`
            : `<span style='font-size:10px;color:var(--txt3);font-style:italic'>Pending arrival</span>`);

      // Remaining = obtained − realization; "—" if product not yet arrived
      const subRemCell = prodArrived
        ? (prodRem > 0
            ? `<span style='font-size:11.5px;font-weight:600;color:var(--teal)'>${prodRem.toLocaleString()}</span>`
            : `<span style='font-size:10px;font-weight:700;color:var(--green)'>✓ Full</span>`)
        : `<span style='font-size:10px;color:var(--txt3)'>—</span>`;

      tbody.innerHTML += `<tr style='cursor:pointer;${rowBg}' onclick="openDrawer('${d.code}')">
        <td style='${lBdSub};padding:3px 8px'>
          <span style='font-size:10.5px;color:var(--txt3);padding-left:10px'>↳</span>
        </td>
        <td style='padding:4px 8px 4px 20px'>
          <span style='display:inline-flex;align-items:center;gap:5px'>
            <span style='width:7px;height:7px;border-radius:50%;background:${pc(prod).solid};flex-shrink:0'></span>
            <span style='font-size:11.5px;color:var(--txt2);font-weight:500'>${prod}</span>
          </span>
          <div style='font-size:9.5px;color:var(--txt3);margin-top:1px;padding-left:12px'>
            Obtained: <strong style='color:var(--txt2)'>${prodObt.toLocaleString()}</strong> MT
          </div>
        </td>
        <td style='padding:3px 8px'><span style='font-size:10px;color:var(--txt3)'>↑ same</span></td>
        <td class='t-r' style='padding:3px 8px'>${subRealMTCell}</td>
        <td style='padding:3px 8px'>${subRealPctCell}</td>
        <td class='t-r' style='padding:3px 8px'>${subRemCell}</td>
        <td style='padding:3px 8px'></td>
        <td style='padding:3px 8px'></td>
        <td style='padding:3px 8px'></td>
      </tr>`;
    });
  });
}


/* Comparison list */
function buildCmpList() {
  const maxS = Math.max(...SPI.map(d => d.submit1));
  const el = document.getElementById('cmpList'); el.innerHTML = '';
  [...filteredSPI()].sort((a,b) => a.code.localeCompare(b.code)).forEach(co => {
    const ra = getRA(co.code);
    const div = document.createElement('div');
    div.style.cssText = 'padding:6px 2px;border-bottom:1px solid var(--border);cursor:pointer;border-radius:3px;transition:background .1s';
    div.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px">
        <span style="font-size:12px;font-weight:700">${co.code} <span style="font-size:9px;color:var(--txt3);font-weight:400">${co.group}</span></span>
        <div style="display:flex;gap:6px;font-size:10.5px;font-family:'DM Mono',monospace">
          <span style="color:var(--navy2)">S:${co.submit1.toLocaleString()}</span>
          <span style="color:var(--teal);font-weight:700">O:${co.obtained.toLocaleString()}</span>
          ${ra ? `<span style="color:var(--green);font-weight:700">${(ra.realPct*100).toFixed(0)}%</span>` : ''}
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:2px">
        <div style="display:flex;align-items:center;gap:5px">
          <span style="font-size:9px;color:var(--txt3);font-weight:700;width:12px">S</span>
          <div style="flex:1;height:5px;background:var(--bg);border-radius:2px;overflow:hidden"><div style="height:5px;border-radius:2px;background:rgba(24,38,68,.35);width:${co.submit1/maxS*100}%"></div></div>
        </div>
        <div style="display:flex;align-items:center;gap:5px">
          <span style="font-size:9px;color:var(--txt3);font-weight:700;width:12px">O</span>
          <div style="flex:1;height:5px;background:var(--bg);border-radius:2px;overflow:hidden"><div style="height:5px;border-radius:2px;background:#0c7c84;width:${co.obtained/maxS*100}%"></div></div>
        </div>
      </div>`;
    div.onmouseover = () => div.style.background = 'var(--blue-bg)';
    div.onmouseout  = () => div.style.background = '';
    div.onclick = () => openDrawer(co.code);
    el.appendChild(div);
  });
}

/* Pending table */
function buildPendingTable() {
  const tbody = document.getElementById('pendingBody'); tbody.innerHTML = '';
  [...filteredPending()].sort((a,b) => a.code.localeCompare(b.code)).forEach(d => {
    tbody.innerHTML += `<tr class="tr-pending" style="cursor:pointer" onclick="openDrawerPending('${d.code}')">
      <td><div class="t-code">${d.code}</div></td>
      <td style="font-size:11.5px;font-weight:600">${d.group}</td>
      <td>${chips(d.products)}</td>
      <td class="t-r t-mono">${d.mt.toLocaleString()}</td>
      <td><span class="badge b-pending">${d.status}</span></td>
      <td style="font-size:11px;color:var(--txt3)">${d.date}</td>
    </tr>`;
  });
}

/* All companies table */
let mFilter = 'ALL', mSort = {col:null,dir:1};
function setMF(f, el) { mFilter=f; document.querySelectorAll('#page-all .fpill').forEach(p=>p.classList.remove('on')); el.classList.add('on'); renderMain(); }
function sortM(col) { if(mSort.col===col)mSort.dir*=-1; else{mSort.col=col;mSort.dir=1;} renderMain(); }