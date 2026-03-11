/* ═══════════════════════════════════════
   ALL-COMPANIES TABLE (renderMain)
═══════════════════════════════════════ */

function renderMain() {
  const q = (document.getElementById('mainQ')||{}).value||'';

  /* ══════════════════════════════════════════════════════════════════
     BUILD COMPANY-LEVEL ROWS
     Data pulled from same sources as other modules:
     · Submit/Obtained  → SPI.cycles  (same as PERTEK & SPI page)
     · Utilization      → SPI.utilizationByProd/utilizationMT (same as Available Quota page)
     · Realization      → SPI.realizationByProd + RA.berat (same as Realization Monitoring)
     · Available Quota  → SPI.availableByProd/availableQuota (same as Available Quota page)
  ══════════════════════════════════════════════════════════════════ */
  const buildCompanyRow = (d) => {
    const ra  = getRA(d.code);
    const _rs = revisionStatus(d);
    const rowType = (_rs==='clean'||_rs==='completed') ? 'SPI'
                  : _rs==='reapply'  ? 'REAPPLY'
                  : _rs==='active'   ? 'REV'
                  : _rs==='revpending' ? 'REV' : 'SPI';

    const utilMT  = d.utilizationMT || 0;
    const availMT = (d.availableQuota != null) ? d.availableQuota : Math.max(0, d.obtained - utilMT);
    const realMT  = (ra && ra.cargoArrived) ? ra.berat   : 0;
    const realPct = (ra && ra.cargoArrived) ? ra.realPct : null;
    const utilPct = (ra && !ra.cargoArrived) ? ra.utilPct : null;

    // Per-product data
    const ubp = d.utilizationByProd  || {};
    const abp = d.availableByProd    || {};
    const rbp = d.realizationByProd  || {};
    const arb = d.arrivedByProd      || {};
    const obtByProd = getObtainedByProd(d);

    // Submit per product from cycle data
    const submitByProd = {};
    (d.cycles||[]).forEach(c => {
      if (!/^submit\s*#1/i.test(c.type)) return;
      Object.entries(c.products||{}).forEach(([p,v]) => {
        if (typeof v==='number' && v>0) submitByProd[p] = (submitByProd[p]||0) + v;
      });
    });

    // All product keys (union of obtained, util, avail)
    const allProds = [...new Set([
      ...Object.keys(obtByProd),
      ...Object.keys(ubp),
      ...Object.keys(abp),
    ])];

    const subRows = [];
    if (allProds.length > 1) {
      allProds.forEach(prod => {
        const obtP  = obtByProd[prod]  || 0;
        const subP  = submitByProd[prod] || 0;
        const utilP = ubp[prod]  || 0;
        const avqP  = abp[prod] != null ? abp[prod] : Math.max(0, obtP - utilP);
        const realP   = rbp[prod] != null ? rbp[prod]
                      : (arb[prod] === true && ra && ra.obtained > 0)
                        ? Math.round(ra.berat * (obtP / (ra.obtained||1)) * 100) / 100
                        : 0;
        const arrivedP  = arb[prod] != null ? arb[prod] : false;
        const realPctP  = obtP > 0 && arrivedP  ? realP / obtP  : null;
        const utilPctP  = obtP > 0 && !arrivedP && utilP > 0 ? utilP / obtP : null;
        subRows.push({ prod, subP, obtP, utilP, realP, realPctP, utilPctP, avqP, arrivedP });
      });
    }

    return { ...d, utilMT, availMT, berat: realMT, realPct, utilPct, rowType, subRows };
  };

  const all = [
    ...filteredSPI().map(buildCompanyRow),
    ...filteredPending().map(d => ({
      code:d.code, group:d.group, products:d.products,
      submit1:d.mt, obtained:0, utilMT:0, berat:0,
      realPct:null, utilPct:null, availMT:0,
      revType:'none', revNote:'', spiRef:d.status, remarks:d.remarks,
      rowType:'PENDING', subRows:[],
    }))
  ];

  /* ── Filter ────────────────────────────────────────────────────── */
  let rows = all.filter(d => {
    const mq = !q
      || d.code.toLowerCase().includes(q.toLowerCase())
      || d.products.some(p => p.toLowerCase().includes(q.toLowerCase()))
      || (d.spiRef||'').toLowerCase().includes(q.toLowerCase());
    const mf = mFilter==='ALL'      ? true
             : mFilter==='SPI'      ? ['SPI','REV','REAPPLY'].includes(d.rowType)
             : mFilter==='PENDING'  ? d.rowType==='PENDING'
             : mFilter==='REV'      ? (d.rowType==='REV' || d.rowType==='REAPPLY')
             : mFilter==='ELIGIBLE' ? (d.realPct!=null && d.realPct>=0.6)
             : true;
    return mq && mf;
  });

  /* ── Sort ────────────────────────────────────────────────────── */
  rows.sort((a,b) => a.code.localeCompare(b.code));
  if (mSort.col) {
    const col = mSort.col;
    rows.sort((a,b) => {
      const av = typeof a[col]==='number' ? (a[col]||0) : String(a[col]||'');
      const bv = typeof b[col]==='number' ? (b[col]||0) : String(b[col]||'');
      return (typeof av==='number' ? av-bv : av.localeCompare(bv)) * mSort.dir;
    });
  }

  /* ── Cell builders ──────────────────────────────────────────── */
  const mkNumCell = (val, col) => val > 0
    ? `<span style="color:${col};font-weight:600;font-family:'DM Mono',monospace">${val.toLocaleString()}</span>`
    : '<span style="color:var(--txt3)">—</span>';

  const mkPctCell = (pct, isUtilMode) => {
    if (pct == null) return '<span style="color:var(--txt3)">—</span>';
    const lbl  = isUtilMode ? 'Util' : 'Real';
    const col  = isUtilMode ? 'var(--blue)' : realColor(pct);
    const fill = isUtilMode ? 'var(--blue)'  : realFill(pct);
    return `<div class="u-cell">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px">
        <span style="font-size:9px;color:var(--txt3);font-weight:600">${lbl}</span>
        <span style="font-size:11px;font-weight:700;color:${col}">${(pct*100).toFixed(0)}%</span>
      </div>
      <div class="u-trk"><div class="u-fill" style="width:${Math.min(pct*100,100)}%;background:${fill}"></div></div>
    </div>`;
  };

  const mkAvqCell = (avq, isPending) => {
    if (isPending) return '<span style="color:var(--txt3)">—</span>';
    const col = avq > 0 ? 'var(--teal)' : avq === 0 ? 'var(--txt3)' : 'var(--red2)';
    return `<span style="color:${col};font-weight:${avq>0?'700':'400'};font-family:'DM Mono',monospace">${avq.toLocaleString()} MT</span>`;
  };

  const mkPertekCell = (d) => {
    if (d.rowType === 'PENDING') return `<div style="font-size:10.5px;color:var(--txt2);line-height:1.4">${(d.spiRef||'—').slice(0,80)}</div>`;
    const spiD = getSPI(d.code);
    const pertekNo = spiD && spiD.pertekNo ? `<div style="font-size:10px;font-family:'DM Mono',monospace;color:var(--blue);margin-top:2px">${spiD.pertekNo}</div>` : '';
    const spiNo    = spiD && spiD.spiNo    ? `<div style="font-size:10px;font-family:'DM Mono',monospace;color:var(--teal)">${spiD.spiNo}</div>` : '';
    return `<div style="line-height:1.5"><div style="font-size:10.5px;color:var(--txt2)">${(d.spiRef||'—').slice(0,60)}</div>${pertekNo}${spiNo}</div>`;
  };

  /* ── Render rows ─────────────────────────────────────────────── */
  const tbody = document.getElementById('mainBody'); tbody.innerHTML = '';

  rows.forEach(d => {
    const rc = d.rowType==='PENDING' ? 'tr-pending'
             : d.rowType==='REV'     ? 'tr-rev'
             : d.rowType==='REAPPLY' ? 'tr-reapply'
             : d.rowType==='DONE'    ? 'tr-revdone' : '';
    const raRec  = getRA(d.code);
    const isMulti = d.subRows && d.subRows.length > 1;

    /* Re-Apply badge */
    const eligHtml = (() => {
      if (!raRec || d.realPct == null) return '<span style="color:var(--txt3)">—</span>';
      if (isReapplySubmitted(raRec)) return '<span class="badge b-reapply" style="font-size:9px;padding:1px 5px">🔵 Submitted</span>';
      if (isEligible(raRec))         return '<span class="badge b-eligible" style="font-size:9px;padding:1px 5px">✓ Eligible</span>';
      return '<span class="badge b-ineligible" style="font-size:9px;padding:1px 5px">✗ &lt;60%</span>';
    })();

    const dispPct = d.realPct != null ? d.realPct : d.utilPct;

    const tr = document.createElement('tr'); tr.className = rc;
    if (isMulti) {
      tr.innerHTML = `
        <td>
          <div class="t-code" onclick="openDrawer('${d.code}')">${d.code}</div>
          <div style="font-size:9px;color:var(--txt3);margin-top:1px">▼ ${d.subRows.length} products</div>
        </td>
        <td style="font-size:11.5px;font-weight:600">${d.group}</td>
        <td style="font-size:10.5px;color:var(--txt3);font-style:italic">${d.products.length} products · total</td>
        <td class="t-r t-mono" style="font-weight:700">${N(d.submit1)}</td>
        <td class="t-r t-mono" style="color:${d.obtained>0?'var(--teal)':'var(--txt3)'};font-weight:700">${d.obtained>0?N(d.obtained):'—'}</td>
        <td class="t-r">${mkNumCell(d.utilMT,'var(--blue)')}</td>
        <td class="t-r">${mkNumCell(d.berat,'var(--green)')}</td>
        <td style="min-width:90px">${mkPctCell(dispPct, d.realPct==null && d.utilPct!=null)}</td>
        <td class="t-r">${mkAvqCell(d.availMT, false)}</td>
        <td>${eligHtml}</td>
        <td>${statusBadge(d)}</td>
        <td style="min-width:160px">${mkPertekCell(d)}</td>`;
      tbody.appendChild(tr);

      /* Sub-rows: one per product */
      d.subRows.forEach(s => {
        const trSub = document.createElement('tr');
        trSub.className = 'tr-sub' + (rc ? ' '+rc : '');
        const dispPctS = s.realPctP != null ? s.realPctP : s.utilPctP;
        trSub.innerHTML = `
          <td></td>
          <td></td>
          <td>
            <span style="display:inline-block;width:5px;height:5px;background:var(--txt3);border-radius:1px;margin-right:5px;vertical-align:middle;opacity:.4"></span>
            <span style="font-size:11px;color:var(--txt2);font-weight:500">${s.prod}</span>
          </td>
          <td class="t-r t-mono" style="color:var(--txt3)">${s.subP>0?s.subP.toLocaleString():'—'}</td>
          <td class="t-r t-mono" style="color:${s.obtP>0?'var(--teal)':'var(--txt3)'}">${s.obtP>0?s.obtP.toLocaleString():'—'}</td>
          <td class="t-r">${s.utilP>0?`<span style="color:var(--blue);font-family:'DM Mono',monospace">${s.utilP.toLocaleString()}</span>`:'<span style="color:var(--txt3)">—</span>'}</td>
          <td class="t-r">${s.realP>0?`<span style="color:var(--green);font-family:'DM Mono',monospace">${Number(s.realP).toLocaleString()}</span>`:'<span style="color:var(--txt3)">—</span>'}</td>
          <td style="min-width:90px">${mkPctCell(dispPctS, s.realPctP==null && s.utilPctP!=null)}</td>
          <td class="t-r">${mkAvqCell(s.avqP, false)}</td>
          <td></td><td></td><td></td>`;
        tbody.appendChild(trSub);
      });

    } else {
      tr.innerHTML = `
        <td><div class="t-code" onclick="openDrawer('${d.code}')">${d.code}</div></td>
        <td style="font-size:11.5px;font-weight:600">${d.group}</td>
        <td>${chips(d.products)}</td>
        <td class="t-r t-mono">${N(d.submit1)}</td>
        <td class="t-r t-mono" style="color:${d.obtained>0?'var(--teal)':'var(--txt3)'}">${d.obtained>0?N(d.obtained):'—'}</td>
        <td class="t-r">${mkNumCell(d.utilMT,'var(--blue)')}</td>
        <td class="t-r">${mkNumCell(d.berat,'var(--green)')}</td>
        <td style="min-width:90px">${mkPctCell(dispPct, d.realPct==null && d.utilPct!=null)}</td>
        <td class="t-r">${mkAvqCell(d.availMT, d.rowType==='PENDING')}</td>
        <td>${eligHtml}</td>
        <td>${d.rowType==='PENDING'?'<span class="badge b-pending">⏳ Pending</span>':statusBadge(d)}</td>
        <td style="min-width:160px">${mkPertekCell(d)}</td>`;
      tbody.appendChild(tr);
    }
  });

  /* ── Totals row in tfoot ────────────────────────────────────── */
  const tfoot = document.getElementById('mainFoot');
  if (tfoot) {
    const tSubmit = rows.reduce((s,d) => s + (d.submit1||0), 0);
    const tObtain = rows.reduce((s,d) => s + (d.obtained||0), 0);
    const tUtil   = rows.reduce((s,d) => s + (d.utilMT||0),   0);
    const tReal   = rows.reduce((s,d) => s + (d.berat||0),    0);
    const tAvail  = rows.reduce((s,d) => s + (d.availMT||0),  0);
    const arrived = rows.filter(d => d.realPct != null);
    const avgPct  = arrived.length ? arrived.reduce((s,d) => s + d.realPct, 0) / arrived.length : null;
    const pctStr  = avgPct != null
      ? `<div class="u-cell"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px">
           <span style="font-size:9px;color:var(--txt3)">Avg</span>
           <span style="font-size:11px;font-weight:700;color:${realColor(avgPct)}">${(avgPct*100).toFixed(0)}%</span>
         </div><div class="u-trk"><div class="u-fill" style="width:${Math.min(avgPct*100,100)}%;background:${realFill(avgPct)}"></div></div></div>`
      : '<span style="color:var(--txt3)">—</span>';
    tfoot.innerHTML = `<tr class="tr-totals">
      <td colspan="3" style="padding-left:14px">TOTAL &nbsp;·&nbsp; ${rows.length} companies</td>
      <td class="t-r t-mono">${tSubmit.toLocaleString()}</td>
      <td class="t-r t-mono" style="color:var(--teal)">${tObtain.toLocaleString()}</td>
      <td class="t-r t-mono" style="color:var(--blue)">${tUtil.toLocaleString()}</td>
      <td class="t-r t-mono" style="color:var(--green)">${tReal.toLocaleString()}</td>
      <td style="min-width:90px">${pctStr}</td>
      <td class="t-r t-mono" style="color:var(--teal)">${tAvail.toLocaleString()} MT</td>
      <td></td><td></td><td></td>
    </tr>`;
  }

  /* ── Pill counts ──────────────────────────────────────────────── */
  const cAll    = filteredSPI().length + filteredPending().length;
  const cSPI    = filteredSPI().length;
  const cPending = filteredPending().length;
  const pillAll  = document.getElementById('pillMAll');     if(pillAll)  pillAll.textContent  = cAll;
  const pillSPI  = document.getElementById('pillMSPI');     if(pillSPI)  pillSPI.textContent  = cSPI;
  const pillPend = document.getElementById('pillMPending'); if(pillPend) pillPend.textContent = cPending;

  /* ── Footer totals bar ───────────────────────────────────────── */
  const totBar = document.getElementById('mainTotalsBar');
  if (totBar) {
    const tS = rows.reduce((s,d) => s+(d.submit1||0), 0);
    const tO = rows.reduce((s,d) => s+(d.obtained||0), 0);
    const tU = rows.reduce((s,d) => s+(d.utilMT||0), 0);
    const tR = rows.reduce((s,d) => s+(d.berat||0), 0);
    const tA = rows.reduce((s,d) => s+(d.availMT||0), 0);
    totBar.innerHTML =
      `<span style="color:var(--navy)">Submit: <strong>${tS.toLocaleString()}</strong></span>` +
      `<span style="opacity:.3">·</span>` +
      `<span style="color:var(--teal)">Obtained: <strong>${tO.toLocaleString()}</strong></span>` +
      `<span style="opacity:.3">·</span>` +
      `<span style="color:var(--blue)">Utilized: <strong>${tU.toLocaleString()}</strong></span>` +
      `<span style="opacity:.3">·</span>` +
      `<span style="color:var(--green)">Realized: <strong>${tR.toLocaleString()}</strong></span>` +
      `<span style="opacity:.3">·</span>` +
      `<span style="color:#0891b2">Available: <strong>${tA.toLocaleString()}</strong></span>`;
  }

  document.getElementById('mainCount').textContent = `${rows.length} companies`;
}