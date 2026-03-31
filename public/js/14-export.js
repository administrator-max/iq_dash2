/* ═══════════════════════════════════════
   EXPORT — PDF, CSV, JSON, XLSX
═══════════════════════════════════════ */

function exportExecutivePDF() {

  /* ── A. DATA ENGINE — all KPIs use same filter logic as dashboard ───── */
  const N  = n => typeof n === 'number' ? n.toLocaleString('en-US') : (n ?? '—');
  const Nf = (n, d=1) => typeof n === 'number' ? n.toFixed(d) : '—';
  const genDate = new Date().toLocaleDateString('en-GB', {day:'2-digit',month:'long',year:'numeric'});

  // KPI 1 — Total Submitted (Submit #N, filter by Submit MOI date)
  let s1_mt = 0; const s1_co = new Set();
  [...SPI, ...PENDING].forEach(co => {
    (co.cycles||[]).forEach(c => {
      if (!/^submit #\d/i.test(c.type)) return;
      const mt = typeof c.mt === 'number' ? c.mt : 0;
      if (mt <= 0) return;
      if (!PERIOD.active || inPd(pDate(c.submitDate))) { s1_mt += mt; s1_co.add(co.code); }
    });
  });

  // KPI 2 — Obtained: only Obtained #N (non-revision) cycles. Same rule as overview.
  let s2_mt = 0; const s2_co = new Set();
  SPI.forEach(co => {
    const ac = co.cycles||[];
    ac.forEach(c => {
      if (!/^obtained #/i.test(c.type)) return;
      const mt = typeof c.mt === 'number' ? c.mt : 0;
      if (mt <= 0) return;
      const pt = getPertekTerbitForObtained(c, ac);
      if (!PERIOD.active || inPd(pt)) { s2_mt += mt; s2_co.add(co.code); }
    });
  });

  // KPI 3 — Realized: filter by arrivalDate (YYYY-MM-DD). etaJKT is display text only.
  const validSpiCodes = new Set(
    PERIOD.active ? SPI.filter(co => companyInPeriod(co.cycles||[])).map(co => co.code) : SPI.map(co => co.code)
  );
  const arrivedRA = RA.filter(r => {
    if (!r.cargoArrived) return false;
    if (!PERIOD.active) return true;
    const ad = r.arrivalDate ? new Date(r.arrivalDate) : null;
    return inPd(ad);
  });
  const s3_co    = arrivedRA.length;
  const s3_mt    = arrivedRA.reduce((t,r) => t+(r.berat||0), 0);
  const s3_codes = arrivedRA.map(r => r.code).join(', ') || '—';
  const avgReal  = arrivedRA.length ? arrivedRA.reduce((t,r) => t+r.realPct, 0)/arrivedRA.length*100 : 0;

  // KPI 4 — Re-Apply: scoped to SPI companies that match the period
  const raPool  = PERIOD.active ? RA.filter(r => validSpiCodes.has(r.code)) : RA;
  const s4_elig = raPool.filter(isEligible).length;
  const s4_sub  = raPool.filter(isReapplySubmitted).length;
  const s4_tot  = s4_elig + s4_sub;

  const appRate     = s1_mt > 0 ? (s2_mt/s1_mt*100).toFixed(1) : '—';
  const periodLabel = PERIOD.active ? PERIOD.label : 'All Time';

  // Available Quota KPI — source: Excel "Available (MT)" rows (pre-seeded in data)
  // Rule: Available = PERTEK Terbit MT (obtained) − Utilization MT
  // Revision TBA / Submit #2 TBA: use original obtained #1 only (already correct in data)
  // All companies with obtained > 0 are included (util=0 means full quota available)
  const availQuotaTotal = filteredSPI().reduce((sum, co) => {
    const obtained = typeof co.obtained === 'number' ? co.obtained : 0;
    if (obtained <= 0) return sum;
    if (co.availableQuota != null) return sum + co.availableQuota;
    const utilMT = co.utilizationMT != null ? co.utilizationMT : 0;
    return sum + (obtained - utilMT);
  }, 0);

  // Utilization total — same source as Overview KPI and Available Quota page
  const utilTotal   = filteredSPI().reduce((s, co) => {
    const ubp = co.utilizationByProd || {};
    return s + Object.values(ubp).reduce((t,v) => t + (typeof v==='number' ? v : 0), 0);
  }, 0);
  const utilCoCount = filteredSPI().filter(co => (co.utilizationMT||0) > 0).length;
  const utilRate    = s2_mt > 0 ? (utilTotal/s2_mt*100).toFixed(1) : '—';

  // Top 5 Products by obtained MT (PERTEK Terbit filter)
  const prodMap = {};
  SPI.forEach(co => {
    const ac = co.cycles||[];
    ac.forEach(c => {
      if (!/^obtained #/i.test(c.type)) return;
      const mt = typeof c.mt === 'number' ? c.mt : 0;
      if (mt <= 0) return;
      const pt = getPertekTerbitForObtained(c, ac);
      if (PERIOD.active && !inPd(pt)) return;
      Object.entries(c.products||{}).forEach(([p,q]) => {
        const v = typeof q === 'number' ? q : 0;
        if (v > 0) prodMap[p] = (prodMap[p]||0) + v;
      });
    });
  });
  const top5    = Object.entries(prodMap).sort((a,b) => b[1]-a[1]).slice(0,5);
  const maxProd = top5.length ? top5[0][1] : 1;

  // Top 10 Companies by obtained MT (PERTEK Terbit filter)
  const coData = filteredSPI().map(co => {
    const ac = co.cycles||[];
    let mt = 0;
    ac.forEach(c => {
      if (!/^obtained #/i.test(c.type)) return;
      const v = typeof c.mt === 'number' ? c.mt : 0;
      if (v <= 0) return;
      const pt = getPertekTerbitForObtained(c, ac);
      if (!PERIOD.active || inPd(pt)) mt += v;
    });
    return {code:co.code, group:co.group, mt};
  }).filter(x => x.mt > 0).sort((a,b) => b.mt-a.mt).slice(0,10);
  const maxCoMT = coData.length ? coData[0].mt : 1;

  // Realization detail for table (same arrivalDate filter)
  const realRows = RA.filter(r => {
    if (!r.cargoArrived) return false;
    if (!PERIOD.active) return true;
    const ad = r.arrivalDate ? new Date(r.arrivalDate) : null;
    return inPd(ad);
  }).map(r => ({
    code:r.code, product:r.product, obtained:r.obtained, berat:r.berat,
    realPct:r.realPct, eligible:isEligible(r), reapplied:isReapplySubmitted(r)
  })).sort((a,b) => b.realPct-a.realPct);

  // Pipeline status for management narrative
  const status = s1_mt === 0 ? 'No Activity in Period'
    : (s4_tot > s4_elig*2) ? 'Growing'
    : (s2_mt/Math.max(s1_mt,1) >= 0.5) ? 'Stable'
    : 'In Progress';

  /* ── B. FILENAME ─────────────────────────────────────────────────── */
  let pdfName;
  if (PERIOD.active && PERIOD.from && PERIOD.to) {
    const fd = d => d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}).replace(/ /g,'');
    pdfName = `Executive_Summary_${fd(PERIOD.from)}_${fd(PERIOD.to)}.pdf`;
  } else if (PERIOD.active) {
    pdfName = `Executive_Summary_${PERIOD.label.replace(/[^a-zA-Z0-9]/g,'_')}.pdf`;
  } else {
    pdfName = 'Executive_Summary_FullData.pdf';
  }

  /* ── C. SVG HELPERS ──────────────────────────────────────────────── */
  const hBar = (val, max, color, w=160, h=9) => {
    const f = max > 0 ? Math.round(Math.min(1,val/max)*w) : 0;
    return `<svg width="${w}" height="${h}" style="display:block;border-radius:2px;overflow:hidden"><rect width="${w}" height="${h}" fill="#eef2f7"/><rect width="${f}" height="${h}" fill="${color}"/></svg>`;
  };

  const cdBar = (val, max, base, stripe, w=96, h=9) => {
    const f = max > 0 ? Math.round(Math.min(1,val/max)*w) : 0;
    const uid = 'p'+(val*100|0);
    return `<svg width="${w}" height="${h}" style="display:block;border-radius:2px;overflow:hidden">`+
      `<defs><pattern id="${uid}" x="0" y="0" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">`+
      `<rect width="6" height="6" fill="${base}"/><line x1="0" y1="0" x2="0" y2="6" stroke="${stripe}" stroke-width="2.5"/></pattern></defs>`+
      `<rect width="${w}" height="${h}" fill="#eef2f7"/><rect width="${f}" height="${h}" fill="url(#${uid})"/></svg>`;
  };

  const vChart = (items, maxV) => {
    const bW=26, gap=11, cH=80;
    const cols=['#0c7c84','#1e4ea6','#6d28d9','#0e9c9c','#b45309'];
    const tw = items.length*(bW+gap)+gap;
    let bars='';
    items.forEach(([nm,v],i) => {
      const x=gap+i*(bW+gap), bH=Math.max(3,Math.round(v/maxV*cH)), y=cH-bH, c=cols[i%5];
      const lbl = nm.length>9 ? nm.slice(0,8)+'…' : nm;
      bars += `<rect x="${x}" y="${y}" width="${bW}" height="${bH}" fill="${c}" rx="2"/>`+
        `<text x="${x+bW/2}" y="${y-4}" font-size="7" text-anchor="middle" fill="#374151" font-family="Helvetica,Arial" font-weight="600">${N(v)}</text>`+
        `<text x="${x+bW/2}" y="${cH+11}" font-size="6.5" text-anchor="middle" fill="#6b7280" font-family="Helvetica,Arial">${lbl}</text>`;
    });
    return `<svg width="${tw}" height="${cH+18}" overflow="visible" style="display:block">${bars}</svg>`;
  };

  /* ── D. ROW RENDERERS ────────────────────────────────────────────── */
  const renderCoBar = (co, rank) => {
    const isCD = co.group === 'CD';
    const base = isCD ? '#0e9c9c' : '#0c7c84';
    const bar  = isCD ? cdBar(co.mt, maxCoMT, base, '#065b5b', 96, 9)
                      : hBar(co.mt, maxCoMT, base, 96, 9);
    const grp  = isCD
      ? `<span style="font-size:5.5pt;font-weight:700;padding:1px 4px;border-radius:2px;background:#dbeafe;color:#1d4ed8;margin-left:3px">CD</span>`
      : `<span style="font-size:5.5pt;font-weight:700;padding:1px 4px;border-radius:2px;background:#d1fae5;color:#065f46;margin-left:3px">AB</span>`;
    return `<tr>`+
      `<td style="padding:4px 5px;font-size:7pt;font-weight:700;color:#94a3b8;text-align:center;width:16px">${rank}</td>`+
      `<td style="padding:4px 6px;font-size:7.5pt;font-weight:700;color:#1e293b;white-space:nowrap">${co.code}${grp}</td>`+
      `<td style="padding:4px 5px">${bar}</td>`+
      `<td style="padding:4px 5px;font-size:7.5pt;font-weight:700;color:${base};text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap">${N(co.mt)}</td>`+
      `</tr>`;
  };

  const renderRealRow = r => {
    const pct  = (r.realPct*100).toFixed(1);
    const bc   = r.realPct>=0.8?'#16a34a':r.realPct>=0.6?'#0c7c84':'#d97706';
    const bw   = Math.round(r.realPct*72);
    const [badge,bgC,txtC] = r.reapplied   ? ['Re-Applied ✓','#ede9fe','#5b21b6']
                            : r.eligible   ? ['Eligible',    '#dcfce7','#166534']
                                           : ['Below 60%',   '#fef3c7','#92400e'];
    return `<tr>`+
      `<td style="padding:4px 7px;font-size:7.5pt;font-weight:700;color:#1e293b">${r.code}</td>`+
      `<td style="padding:4px 7px;font-size:7pt;color:#64748b">${r.product}</td>`+
      `<td style="padding:4px 7px;font-size:7.5pt;text-align:right;font-variant-numeric:tabular-nums">${N(r.obtained)}</td>`+
      `<td style="padding:4px 7px;font-size:7.5pt;text-align:right;font-variant-numeric:tabular-nums">${N(Math.round(r.berat))}</td>`+
      `<td style="padding:4px 7px">`+
        `<div style="display:flex;align-items:center;gap:5px">`+
          `<svg width="72" height="7" style="flex-shrink:0;border-radius:2px;overflow:hidden"><rect width="72" height="7" fill="#eef2f7"/><rect width="${bw}" height="7" fill="${bc}"/></svg>`+
          `<span style="font-size:7.5pt;font-weight:700;color:${bc}">${pct}%</span>`+
        `</div></td>`+
      `<td style="padding:4px 7px"><span style="font-size:6.5pt;font-weight:700;padding:2px 6px;border-radius:3px;background:${bgC};color:${txtC};white-space:nowrap">${badge}</span></td>`+
      `</tr>`;
  };

  /* ── E. CSS ──────────────────────────────────────────────────────── */
  const CSS = `
    @page{size:A4 portrait;margin:0}
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    html,body{width:210mm;background:#fff;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;
      font-size:9pt;color:#1e293b;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .page{width:210mm;min-height:297mm;padding:12mm 13mm 20mm 13mm;position:relative;
          page-break-after:always;background:#fff}
    .page:last-child{page-break-after:avoid}

    .mhd{display:flex;justify-content:space-between;align-items:flex-end;
         padding-bottom:8px;margin-bottom:13px;border-bottom:2.5px solid #0c7c84}
    .mhd-lbl{font-size:6pt;font-weight:700;text-transform:uppercase;letter-spacing:2px;
              color:#0c7c84;margin-bottom:3px}
    .mhd-ttl{font-size:15pt;font-weight:700;color:#182644;line-height:1;letter-spacing:-.3px}
    .mhd-r{text-align:right}
    .ppill{display:inline-block;background:#0c7c84;color:#fff;font-size:7.5pt;font-weight:700;
           padding:4px 11px;border-radius:4px;letter-spacing:.3px}
    .meta{font-size:6.5pt;color:#94a3b8;margin-top:3px}

    .sec{display:flex;align-items:center;gap:7px;margin:13px 0 8px;
         padding-bottom:5px;border-bottom:1px solid #e2e8f0}
    .sn{width:18px;height:18px;border-radius:50%;background:#182644;color:#fff;
        font-size:7.5pt;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0}
    .st{font-size:9.5pt;font-weight:700;color:#182644}
    .sb{margin-left:auto;font-size:6.5pt;font-weight:700;padding:2px 8px;
        border-radius:3px;background:#f1f5f9;color:#64748b}

    .kg{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:6px}
    .kc{border-radius:6px;padding:9px 10px;border:1px solid #e2e8f0;
        border-top:3px solid #0c7c84;background:#f8fafc}
    .kl{font-size:5.5pt;font-weight:700;text-transform:uppercase;letter-spacing:1px;
        color:#64748b;margin-bottom:5px}
    .kv{font-size:17pt;font-weight:700;line-height:1;color:#0c7c84}
    .ku{font-size:6.5pt;color:#64748b;margin-top:3px}
    .kn{font-size:5.5pt;color:#94a3b8;margin-top:2px;font-style:italic}

    .mkov{background:#f8fafc;border:1px solid #e2e8f0;border-left:3px solid #182644;
          border-radius:5px;padding:9px 13px;margin-bottom:2px}
    .mkov-ttl{font-size:6pt;font-weight:700;text-transform:uppercase;letter-spacing:1.2px;
               color:#64748b;margin-bottom:7px}
    .mkov-ul{list-style:none;display:flex;flex-direction:column;gap:4px}
    .mkov-ul li{font-size:7.5pt;color:#334155;line-height:1.5;padding-left:14px;position:relative}
    .mkov-ul li::before{content:'▸';position:absolute;left:0;color:#0c7c84;font-size:7pt;top:1px}
    .mkov-ul li strong{color:#182644}

    .fn{font-size:5.5pt;color:#94a3b8;margin-top:5px;padding-top:4px;
        border-top:1px dashed #e2e8f0;line-height:1.6}

    .tc{display:grid;grid-template-columns:1fr 1fr;gap:16px}
    .ch{font-size:6pt;font-weight:700;text-transform:uppercase;letter-spacing:1px;
        color:#64748b;margin-bottom:8px;padding-bottom:4px;border-bottom:1px solid #e2e8f0}

    .pca{background:#fafcff;border:1px solid #f0f4f8;border-radius:5px;
         padding:8px 6px 6px;margin-bottom:9px}
    .pnote{font-size:6.5pt;color:#94a3b8;margin-top:8px;line-height:1.5;
           padding:5px 7px;background:#f8fafc;border-radius:3px;
           border-left:2px solid #e2e8f0;font-style:italic}

    .dt{width:100%;border-collapse:collapse}
    .dt th{font-size:6pt;font-weight:700;text-transform:uppercase;letter-spacing:.8px;
           color:#475569;padding:4px 7px;background:#f1f5f9;
           border-bottom:1.5px solid #e2e8f0;text-align:left}
    .dt th.r{text-align:right}
    .dt td{border-bottom:1px solid #f8fafc;vertical-align:middle}
    .dt tr:last-child td{border-bottom:none}
    .dt tr:nth-child(even) td{background:#fafcff}

    .lgd{display:flex;gap:11px;flex-wrap:wrap;align-items:center;
         margin-top:8px;padding-top:6px;border-top:1px solid #f1f5f9}
    .li{display:flex;align-items:center;gap:4px;font-size:6pt;color:#475569}

    .is{display:grid;grid-template-columns:repeat(3,1fr);gap:9px;margin-bottom:12px}
    .ic{border-radius:7px;padding:9px 12px;border:1px solid #e2e8f0}
    .il{font-size:6pt;font-weight:700;text-transform:uppercase;letter-spacing:1px;
        color:#64748b;margin-bottom:4px}
    .iv{font-size:22pt;font-weight:700;line-height:1;margin-bottom:4px}
    .ib{font-size:6.5pt;color:#64748b;line-height:1.5}

    .tg{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:12px}
    .tb{background:#f8fafc;border:1px solid #e2e8f0;border-left:3px solid #0c7c84;
        border-radius:4px;padding:9px 11px}
    .tbh{font-size:6pt;font-weight:700;text-transform:uppercase;letter-spacing:.8px;
         color:#0c7c84;margin-bottom:4px}
    .tbb{font-size:7.5pt;color:#334155;line-height:1.6}

    .pf{position:absolute;bottom:7mm;left:13mm;right:13mm;
        display:flex;justify-content:space-between;align-items:center;
        border-top:1px solid #e2e8f0;padding-top:4px}
    .pfl{font-size:6pt;color:#94a3b8}
    .pfr{font-size:6pt;color:#94a3b8}

    .ptb{position:fixed;top:0;left:0;right:0;z-index:1200;background:#182644;color:#fff;
         padding:10px 20px;display:flex;align-items:center;justify-content:space-between;
         font-family:Helvetica,Arial,sans-serif;font-size:13px;box-shadow:0 2px 12px rgba(0,0,0,.4)}
    .ptb-l{display:flex;flex-direction:column;gap:2px}
    .ptb-t{font-weight:700;font-size:13.5px}
    .ptb-s{font-size:10.5px;color:#94a3b8}
    .ptb-r{display:flex;gap:9px}
    .bp{background:#0c7c84;color:#fff;border:none;border-radius:6px;padding:7px 20px;
        font-size:12.5px;font-weight:700;cursor:pointer}
    .bp:hover{background:#0a6670}
    .bc{background:rgba(255,255,255,.1);color:#fff;border:none;border-radius:6px;
        padding:7px 14px;font-size:12.5px;cursor:pointer}
    .spc{height:50px}
    @media print{.ptb,.spc{display:none!important}html,body{width:210mm}}
  `;

  /* ── F. PAGE 1 ────────────────────────────────────────────────────── */
  const p1 = `<div class="page">

    <div class="mhd">
      <div>
        <div class="mhd-lbl">Executive Summary</div>
        <div class="mhd-ttl">Import Quota Management</div>
      </div>
      <div class="mhd-r">
        <div class="ppill">📅 ${periodLabel}</div>
        <div class="meta">Prepared: ${genDate} &nbsp;·&nbsp; CONFIDENTIAL</div>
      </div>
    </div>

    <div class="sec">
      <div class="sn">1</div>
      <div class="st">Quota Performance Overview</div>
      <div class="sb">${PERIOD.active ? periodLabel : 'All Submissions'}</div>
    </div>

    <div class="kg" style="grid-template-columns:repeat(6,1fr)">
      <div class="kc" style="border-top-color:#0c7c84">
        <div class="kl">Total Submitted</div>
        <div class="kv" style="color:#0c7c84">${N(s1_mt)}</div>
        <div class="ku">MT &nbsp;·&nbsp; ${s1_co.size} companies</div>
        <div class="kn">Submit #1 + Re-Apply</div>
      </div>
      <div class="kc" style="border-top-color:#1e4ea6">
        <div class="kl">Quota Obtained</div>
        <div class="kv" style="color:#1e4ea6">${N(s2_mt)}</div>
        <div class="ku">MT &nbsp;·&nbsp; ${s2_co.size} companies</div>
        <div class="kn">Approval rate: ${appRate}%</div>
      </div>
      <div class="kc" style="border-top-color:#2563eb">
        <div class="kl">Total Utilized</div>
        <div class="kv" style="color:#2563eb">${N(utilTotal)}</div>
        <div class="ku">MT &nbsp;·&nbsp; ${utilCoCount} companies</div>
        <div class="kn">Utilization rate: ${utilRate}%</div>
      </div>
      <div class="kc" style="border-top-color:#15803d">
        <div class="kl">Cargo Realized</div>
        <div class="kv" style="color:#15803d">${s3_co}</div>
        <div class="ku">companies &nbsp;·&nbsp; ${N(Math.round(s3_mt))} MT</div>
        <div class="kn">Avg realization: ${Nf(avgReal)}%</div>
      </div>
      <div class="kc" style="border-top-color:#0f766e">
        <div class="kl">Available Quota</div>
        <div class="kv" style="color:#0f766e">${N(availQuotaTotal)}</div>
        <div class="ku">MT remaining across companies</div>
        <div class="kn">Obtained − Utilization</div>
      </div>
      <div class="kc" style="border-top-color:#dc2626">
        <div class="kl">New Submission</div>
        <div class="kv" style="color:#dc2626">${filteredPending().length}</div>
        <div class="ku">companies &nbsp;·&nbsp; ${N(filteredPending().reduce((s,d)=>s+(typeof d.mt==='number'?d.mt:0),0))} MT</div>
        <div class="kn">Awaiting PERTEK / SPI — MoI review</div>
      </div>
    </div>

    <div class="fn">
      ★ Quota Obtained filtered by PERTEK release date &nbsp;|&nbsp;
      Submitted filtered by submission date &nbsp;|&nbsp;
      Utilized = MT allocated to customers &nbsp;|&nbsp;
      Realized = cargo physically arrived at Jakarta port
    </div>

    <div class="sec" style="margin-top:11px">
      <div class="sn" style="background:#475569;font-size:9pt">◆</div>
      <div class="st">Management Key Overview</div>
    </div>

    <div class="mkov">
      <div class="mkov-ttl">Summary at a Glance</div>
      <ul class="mkov-ul">
        <li>${s1_mt > 0
          ? `Submission activity began in October 2025 — <strong>${N(s1_mt)} MT</strong> submitted across <strong>${s1_co.size} companies</strong>.`
          : `No submission activity recorded in the selected period. All submissions begin from <strong>October 2025</strong>.`}</li>
        <li>Obtained quota performance shows <strong>${N(s2_mt)} MT</strong> approved${s2_co.size > 0 ? ` across <strong>${s2_co.size} companies</strong>` : ''} — approval rate <strong>${appRate}%</strong>.</li>
        <li>Utilization: <strong>${N(utilTotal)} MT</strong> allocated to customers across <strong>${utilCoCount} companies</strong> — utilization rate <strong>${utilRate}%</strong> of obtained quota.</li>
        <li>Realization progress: <strong>${s3_co} ${s3_co===1?'company has':'companies have'}</strong> executed imports${s3_co > 0 ? `, averaging <strong>${Nf(avgReal)}% realization</strong>` : ''}.</li>
        <li><strong>${s4_tot} ${s4_tot===1?'company is':'companies are'}</strong> in the re-apply pipeline${s4_sub > 0 ? ` — <strong>${s4_sub}</strong> already submitted for new quota` : ''}.</li>
        <li>Overall pipeline status: <strong>${status}</strong>${s1_mt===0?' — no activity in this period':s2_mt>0?' — approvals progressing on schedule':' — awaiting quota approvals'}.</li>
      </ul>
    </div>

    ${(() => {
      // Build available quota breakdown by product
      // Source: co.availableByProd — exact per-product values from Excel "Available (MT)" row
      const prodAvail = {};
      filteredSPI().forEach(co => {
        const obtained = typeof co.obtained === 'number' ? co.obtained : 0;
        if (obtained <= 0) return;
        if (co.availableByProd && Object.keys(co.availableByProd).length > 0) {
          // Use Excel exact per-product available values
          Object.entries(co.availableByProd).forEach(([p, v]) => {
            const val = typeof v === 'number' ? v : 0;
            if (val > 0) prodAvail[p] = (prodAvail[p] || 0) + val;
          });
        } else {
          // Company has full quota available (util=0) — attribute to first product
          const utilMT = co.utilizationMT != null ? co.utilizationMT : 0;
          const avq = co.availableQuota != null ? co.availableQuota : (obtained - utilMT);
          if (avq > 0 && co.products && co.products.length > 0) {
            prodAvail[co.products[0]] = (prodAvail[co.products[0]] || 0) + avq;
          }
        }
      });

      const prodEntries = Object.entries(prodAvail)
        .map(([p, v]) => [p, Math.round(v)])
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1]);

      if (!prodEntries.length) return '';

      const totalAvail = prodEntries.reduce((s, [, v]) => s + v, 0);
      const maxAvail = prodEntries[0][1];
      const cols = ['#0f766e','#1e4ea6','#6d28d9','#0c7c84','#b45309','#dc2626','#0891b2','#ca8a04'];

      const bars = prodEntries.map(([p, v], i) => {
        const pct = totalAvail > 0 ? (v / totalAvail * 100).toFixed(0) : 0;
        const barW = maxAvail > 0 ? Math.round((v / maxAvail) * 110) : 0;
        const c = cols[i % cols.length];
        const lbl = p.length > 16 ? p.slice(0, 15) + '…' : p;
        return `<tr>
          <td style="padding:3px 6px;font-size:7pt;font-weight:600;color:#1e293b;white-space:nowrap;width:110px">${lbl}</td>
          <td style="padding:3px 4px">
            <svg width="110" height="8" style="display:block;border-radius:2px;overflow:hidden">
              <rect width="110" height="8" fill="#eef2f7"/>
              <rect width="${barW}" height="8" fill="${c}"/>
            </svg>
          </td>
          <td style="padding:3px 6px;font-size:7.5pt;font-weight:700;color:${c};text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap">${N(v)} MT</td>
          <td style="padding:3px 4px;font-size:6.5pt;font-weight:700;color:#94a3b8;text-align:right;white-space:nowrap">${pct}%</td>
        </tr>`;
      }).join('');

      const topProd = prodEntries[0];
      const top2 = prodEntries.slice(0, 2).map(([p, v]) => `<strong>${p}</strong> (${N(v)} MT)`).join(' and ');

      return `<div class="mkov" style="margin-top:8px;border-left-color:#0f766e">
        <div class="mkov-ttl" style="color:#0f766e">Available Quota — Remaining Capacity by Product</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:start">
          <div>
            <table style="width:100%;border-collapse:collapse">${bars}</table>
            <div style="font-size:5.5pt;color:#94a3b8;margin-top:5px;font-style:italic">Available = Obtained − Consumed (Berat Realized / Utilized) · Proportional split per product</div>
          </div>
          <div>
            <ul class="mkov-ul">
              <li>Total available quota across all products: <strong style="color:#0f766e">${N(totalAvail)} MT</strong> across <strong>${prodEntries.length} product type${prodEntries.length > 1 ? 's' : ''}</strong>.</li>
              <li>Largest available pool: ${top2}${prodEntries.length > 2 ? ` — leading the remaining ${prodEntries.length - 2} product type${prodEntries.length - 2 > 1 ? 's' : ''}` : ''}.</li>
              <li>${topProd[1] / totalAvail >= 0.5
                ? `<strong>${topProd[0]}</strong> dominates available capacity at <strong>${(topProd[1]/totalAvail*100).toFixed(0)}%</strong> of total remaining quota — priority deployment recommended.`
                : `Available quota is distributed across multiple products — balanced realization pace expected across the portfolio.`}</li>
              <li>Companies with no remaining quota (fully consumed or not yet entered) are excluded from this breakdown.</li>
            </ul>
          </div>
        </div>
      </div>`;
    })()}


    <div class="sec">
      <div class="sn" style="background:#1e56c6">📊</div>
      <div class="st">Obtain vs Utilization</div>
      <div class="sb">Obtained quota vs. MT in-shipment (Util) and arrived/realized (Real) · all SPI companies</div>
    </div>

    ${(() => {
      // Build Obtain vs Utilization data from RA pool (same filter as dashboard)
      const ouRows = filteredSPI().map(co => {
        const ra = getRA ? getRA(co.code) : RA.find(r => r.code === co.code);
        const obtained = typeof co.obtained === 'number' ? co.obtained : 0;
        if (!obtained) return null;
        let utilMT = 0, realMT = 0, isArrived = false;
        if (ra) {
          isArrived = !!ra.cargoArrived;
          if (isArrived) { realMT = ra.berat || 0; }
          else           { utilMT = ra.berat || 0; }
        }
        const utilPct = obtained > 0 ? utilMT / obtained : 0;
        const realPct = obtained > 0 ? realMT / obtained : 0;
        return { code: co.code, obtained, utilMT, realMT, isArrived, utilPct, realPct };
      }).filter(Boolean).sort((a,b) => b.obtained - a.obtained);

      if (!ouRows.length) return '<div style="font-size:7.5pt;color:#94a3b8;padding:10px;text-align:center">No data</div>';

      const maxObt = Math.max(...ouRows.map(r => r.obtained));
      const BAR_W = 110; // px width of bar track

      const rows = ouRows.map(r => {
        const obtW  = maxObt > 0 ? Math.round(r.obtained / maxObt * BAR_W) : 0;
        const utilW = maxObt > 0 ? Math.round((r.isArrived ? r.realMT : r.utilMT) / maxObt * BAR_W) : 0;
        const utilColor = r.isArrived ? '#16a34a' : '#1e56c6';
        const utilLabel = r.isArrived
          ? `${N(Math.round(r.realMT))} MT (Real ${(r.realPct*100).toFixed(0)}%)`
          : `${N(Math.round(r.utilMT))} MT (Util ${(r.utilPct*100).toFixed(0)}%)`;
        const statusTag = r.isArrived
          ? `<span style="font-size:5.5pt;font-weight:700;padding:1px 4px;border-radius:2px;background:#dcfce7;color:#166534">✓ Arrived</span>`
          : `<span style="font-size:5.5pt;font-weight:700;padding:1px 4px;border-radius:2px;background:#dbeafe;color:#1d4ed8">🚢 In Ship.</span>`;
        return `<tr>
          <td style="padding:2px 5px;font-size:6.5pt;font-weight:700;color:#1e293b;white-space:nowrap;width:30px">${r.code}</td>
          <td style="padding:2px 5px;width:${BAR_W+4}px">
            <div style="position:relative;height:7px;background:#eef2f7;border-radius:2px;overflow:hidden;margin-bottom:2px">
              <div style="position:absolute;left:0;top:0;height:7px;width:${obtW}px;background:#c7d2e8;border-radius:2px"></div>
              <div style="position:absolute;left:0;top:0;height:7px;width:${utilW}px;background:${utilColor};border-radius:2px"></div>
            </div>
          </td>
          <td style="padding:2px 5px;font-size:6pt;font-weight:700;color:#64748b;white-space:nowrap;width:52px">${N(r.obtained)} MT</td>
          <td style="padding:2px 5px;font-size:6pt;color:${utilColor};white-space:nowrap;width:90px">${utilLabel}</td>
          <td style="padding:2px 5px">${statusTag}</td>
        </tr>`;
      }).join('');

      // Totals row
      const totalObt  = ouRows.reduce((s,r) => s + r.obtained, 0);
      const totalUtil = ouRows.filter(r => !r.isArrived).reduce((s,r) => s + r.utilMT, 0);
      const totalReal = ouRows.filter(r =>  r.isArrived).reduce((s,r) => s + r.realMT, 0);

      return `<div style="margin-bottom:8px">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:6px;padding:5px 8px;background:#f8fafc;border-radius:4px;border:1px solid #e2e8f0">
          <div style="display:flex;align-items:center;gap:4px"><div style="width:14px;height:6px;background:#c7d2e8;border-radius:1px"></div><span style="font-size:6pt;color:#64748b">Obtained</span></div>
          <div style="display:flex;align-items:center;gap:4px"><div style="width:14px;height:6px;background:#1e56c6;border-radius:1px"></div><span style="font-size:6pt;color:#64748b">In Shipment (Util)</span></div>
          <div style="display:flex;align-items:center;gap:4px"><div style="width:14px;height:6px;background:#16a34a;border-radius:1px"></div><span style="font-size:6pt;color:#64748b">Arrived (Real)</span></div>
          <div style="margin-left:auto;font-size:6pt;color:#94a3b8">Sorted by Obtained MT · bar scale = largest obtained</div>
        </div>
        <table style="width:100%;border-collapse:collapse">
          <colgroup><col style="width:30px"><col style="width:${BAR_W+4}px"><col style="width:52px"><col style="width:90px"><col></colgroup>
          ${rows}
        </table>
        <div style="display:flex;gap:18px;margin-top:5px;padding:5px 8px;background:#f8fafc;border-radius:4px;border:1px solid #e2e8f0">
          <div><span style="font-size:6pt;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px">Total Obtained</span><br><span style="font-size:8pt;font-weight:700;color:#182644">${N(totalObt)} MT</span></div>
          <div><span style="font-size:6pt;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px">Total In-Shipment (Util)</span><br><span style="font-size:8pt;font-weight:700;color:#1e56c6">${N(Math.round(totalUtil))} MT</span></div>
          <div><span style="font-size:6pt;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px">Total Arrived (Real)</span><br><span style="font-size:8pt;font-weight:700;color:#16a34a">${N(Math.round(totalReal))} MT</span></div>
          <div><span style="font-size:6pt;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px">% Consumed vs Obtained</span><br><span style="font-size:8pt;font-weight:700;color:#0c7c84">${totalObt > 0 ? ((totalUtil+totalReal)/totalObt*100).toFixed(1) : 0}%</span></div>
        </div>
      </div>`;
    })()}

    <div class="sec">
      <div class="sn" style="background:#0c7c84">📋</div>
      <div class="st">Realization Monitoring</div>
      <div class="sb">Per-company shipment status · Utilization = in-shipment · Realization = arrived &amp; Beacukai-registered</div>
    </div>

    ${(() => {
      // Build per-company monitoring table: all RA companies
      const monRows = filteredSPI().map(co => {
        const ra = RA.find(r => r.code === co.code);
        const obtained = typeof co.obtained === 'number' ? co.obtained : 0;
        if (!obtained || !ra) return null;
        const isArrived = !!ra.cargoArrived;
        const utilMT  = !isArrived ? (ra.berat || 0) : 0;
        const realMT  =  isArrived ? (ra.berat || 0) : 0;
        const pct     = isArrived ? ra.realPct : (ra.utilPct || (ra.berat / obtained));
        const pctNum  = typeof pct === 'number' ? pct : 0;
        const barColor = isArrived
          ? (pctNum >= 0.8 ? '#16a34a' : pctNum >= 0.6 ? '#0c7c84' : '#d97706')
          : '#1e56c6';
        const barW = Math.round(Math.min(pctNum, 1) * 60);
        const eligTag = isEligible(ra)
          ? `<span style="font-size:5.5pt;font-weight:700;padding:1px 5px;border-radius:2px;background:#dcfce7;color:#166534">✓ Eligible</span>`
          : isReapplySubmitted(ra)
          ? `<span style="font-size:5.5pt;font-weight:700;padding:1px 5px;border-radius:2px;background:#ede9fe;color:#5b21b6">Submitted</span>`
          : `<span style="font-size:5.5pt;padding:1px 5px;border-radius:2px;background:#f1f5f9;color:#64748b">${isArrived ? 'Below 60%' : 'In Shipment'}</span>`;
        const etaCell = isArrived
          ? `<span style="color:#16a34a">✓ ${ra.arrivalDate || 'Arrived'}</span>`
          : `<span style="color:#1e56c6">${(ra.etaJKT||'—').slice(0,20)}</span>`;
        return `<tr style="border-bottom:1px solid #f1f5f9">
          <td style="padding:2px 5px;font-size:6.5pt;font-weight:700;color:#1e293b;white-space:nowrap">${co.code}</td>
          <td style="padding:2px 5px;font-size:6pt;color:#64748b">${ra.product||''}</td>
          <td style="padding:2px 5px;font-size:6.5pt;font-variant-numeric:tabular-nums;text-align:right">${N(obtained)}</td>
          <td style="padding:2px 5px;font-size:6.5pt;font-variant-numeric:tabular-nums;text-align:right;color:#1e56c6">${utilMT > 0 ? N(Math.round(utilMT)) : '—'}</td>
          <td style="padding:2px 5px;font-size:6.5pt;font-variant-numeric:tabular-nums;text-align:right;color:#16a34a">${realMT > 0 ? N(Math.round(realMT)) : '—'}</td>
          <td style="padding:2px 6px">
            <div style="display:flex;align-items:center;gap:4px">
              <div style="width:60px;height:5px;background:#eef2f7;border-radius:2px;overflow:hidden;flex-shrink:0">
                <div style="width:${barW}px;height:5px;background:${barColor}"></div>
              </div>
              <span style="font-size:6.5pt;font-weight:700;color:${barColor}">${(pctNum*100).toFixed(0)}%</span>
            </div>
          </td>
          <td style="padding:2px 5px">${eligTag}</td>
          <td style="padding:2px 5px;font-size:5.5pt;color:#64748b">${etaCell}</td>
        </tr>`;
      }).filter(Boolean);

      if (!monRows.length) return '<div style="font-size:7.5pt;color:#94a3b8;padding:10px;text-align:center">No monitoring data</div>';

      return `<table style="width:100%;border-collapse:collapse;margin-bottom:6px">
        <thead>
          <tr style="background:#f8fafc;border-bottom:2px solid #e2e8f0">
            <th style="padding:3px 5px;font-size:6pt;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.6px;text-align:left">Co.</th>
            <th style="padding:3px 5px;font-size:6pt;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.6px;text-align:left">Product</th>
            <th style="padding:3px 5px;font-size:6pt;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.6px;text-align:right">Obtained</th>
            <th style="padding:3px 5px;font-size:6pt;font-weight:700;color:#1e56c6;text-transform:uppercase;letter-spacing:.6px;text-align:right">Util (MT)</th>
            <th style="padding:3px 5px;font-size:6pt;font-weight:700;color:#16a34a;text-transform:uppercase;letter-spacing:.6px;text-align:right">Real (MT)</th>
            <th style="padding:3px 5px;font-size:6pt;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.6px">% Status</th>
            <th style="padding:3px 5px;font-size:6pt;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.6px">Eligibility</th>
            <th style="padding:3px 5px;font-size:6pt;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.6px">ETA / Arrival</th>
          </tr>
        </thead>
        <tbody>${monRows.join('')}</tbody>
      </table>
      <div style="font-size:5.5pt;color:#94a3b8;font-style:italic">Util = In-shipment MT · Real = Arrived &amp; Beacukai-registered · % threshold for re-apply eligibility: ≥ 60%</div>`;
    })()}

    <div class="sec">
      <div class="sn">2</div>
      <div class="st">Quota Distribution Analysis</div>
      <div class="sb">By obtained MT</div>
    </div>

    <div class="tc">
      <div>
        <div class="ch">Top 5 Products — Obtained MT</div>
        ${top5.length > 0 ? `
        <div class="pca">${vChart(top5, maxProd)}</div>
        <table class="dt">
          ${top5.map(([nm,v],i)=>{
            const c=['#0c7c84','#1e4ea6','#6d28d9','#0e9c9c','#b45309'][i];
            return `<tr>`+
              `<td style="padding:4px 5px;font-size:7pt;font-weight:700;color:#94a3b8;width:15px;text-align:center">${i+1}</td>`+
              `<td style="padding:4px 7px;font-size:7.5pt;font-weight:600;color:#1e293b">${nm}</td>`+
              `<td style="padding:4px 5px">${hBar(v,maxProd,c,80,8)}</td>`+
              `<td style="padding:4px 5px;font-size:7.5pt;font-weight:700;color:${c};text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap">${N(v)} MT</td>`+
              `</tr>`;
          }).join('')}
        </table>
        ${(() => {
          // Build SVG donut chart for products
          const total = top5.reduce((s,[,v]) => s+v, 0);
          const cols = ['#0c7c84','#1e4ea6','#6d28d9','#0e9c9c','#b45309'];
          const r = 36, cx2 = 46, cy2 = 46, sw = 14;
          let startAngle = -Math.PI/2;
          const slices = top5.map(([nm,v],i) => {
            const frac = v/total;
            const angle = frac * 2 * Math.PI;
            const x1 = cx2 + (r-sw/2)*Math.cos(startAngle);
            const y1 = cy2 + (r-sw/2)*Math.sin(startAngle);
            const x2 = cx2 + (r-sw/2)*Math.cos(startAngle+angle);
            const y2 = cy2 + (r-sw/2)*Math.sin(startAngle+angle);
            const large = angle > Math.PI ? 1 : 0;
            const path = `M ${x1} ${y1} A ${r-sw/2} ${r-sw/2} 0 ${large} 1 ${x2} ${y2}`;
            const slice = `<path d="${path}" fill="none" stroke="${cols[i]}" stroke-width="${sw}" stroke-linecap="round"/>`;
            startAngle += angle;
            return slice;
          }).join('');
          const legend = top5.map(([nm,v],i) => {
            const pct = (v/total*100).toFixed(0);
            const lbl = nm.length>13 ? nm.slice(0,12)+'…' : nm;
            return `<div style="display:flex;align-items:center;gap:4px;margin-bottom:3px">
              <span style="width:8px;height:8px;border-radius:2px;background:${cols[i]};flex-shrink:0;display:inline-block"></span>
              <span style="font-size:6pt;color:#334155;flex:1">${lbl}</span>
              <span style="font-size:6pt;font-weight:700;color:${cols[i]}">${pct}%</span>
            </div>`;
          }).join('');
          return `<div style="display:flex;align-items:center;gap:10px;margin-top:8px;padding:6px;background:#fafcff;border-radius:5px;border:1px solid #f0f4f8">
            <svg width="92" height="92" viewBox="0 0 92 92">
              <circle cx="${cx2}" cy="${cy2}" r="${r-sw/2}" fill="none" stroke="#f1f5f9" stroke-width="${sw}"/>
              ${slices}
              <text x="${cx2}" y="${cy2-4}" text-anchor="middle" font-size="7" font-weight="700" fill="#182644" font-family="Helvetica,Arial">${N(total)}</text>
              <text x="${cx2}" y="${cy2+6}" text-anchor="middle" font-size="5.5" fill="#64748b" font-family="Helvetica,Arial">MT Total</text>
            </svg>
            <div style="flex:1">${legend}</div>
          </div>`;
        })()}
        <div class="pnote">Volumes based on PERTEK-approved quota.${PERIOD.active?' Filtered to '+periodLabel+'.':''}</div>`
        : `<div style="font-size:7.5pt;color:#94a3b8;padding:20px 0;text-align:center;background:#fafcff;border-radius:5px;border:1px dashed #e2e8f0">No product data for selected period</div>`}
      </div>

      <div>
        <div class="ch">Top 10 Companies — Obtained MT</div>
        ${coData.length > 0 ? `
        <table class="dt" style="width:100%">
          <colgroup><col style="width:16px"><col><col style="width:96px"><col style="width:52px"></colgroup>
          ${coData.map((co,i)=>renderCoBar(co,i+1)).join('')}
        </table>
        <div class="lgd">
          <span style="font-size:5.5pt;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:#94a3b8">Legend</span>
          <span class="li">
            <svg width="16" height="9" style="border-radius:2px;overflow:hidden"><rect width="16" height="9" fill="#0c7c84"/></svg>
            Group AB — Solid
          </span>
          <span class="li">
            <svg width="16" height="9" style="border-radius:2px;overflow:hidden">
              <defs><pattern id="lgp" x="0" y="0" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="6" height="6" fill="#0e9c9c"/>
                <line x1="0" y1="0" x2="0" y2="6" stroke="#065b5b" stroke-width="2.5"/>
              </pattern></defs>
              <rect width="16" height="9" fill="url(#lgp)"/>
            </svg>
            Group CD — Striped
          </span>
        </div>`
        : `<div style="font-size:7.5pt;color:#94a3b8;padding:20px 0;text-align:center;background:#fafcff;border-radius:5px;border:1px dashed #e2e8f0">No data for selected period</div>`}
      </div>
    </div>

    <div class="sec">
      <div class="sn" style="background:#991b1b">⚠</div>
      <div class="st">Utilization Lead Time Alert</div>
      <div class="sb">PERTEK Obtained → First Utilization · Standard: 14 days</div>
    </div>

    ${(() => {
      // Build lead time data for PDF
      const ltRecords = [];
      filteredSPI().forEach(co => {
        const pertekDate = getPertekDateForCo(co);
        const obtByProd  = getObtainedByProd(co);
        Object.entries(obtByProd).forEach(([prod, obtMT]) => {
          if (!obtMT || obtMT <= 0) return;
          const shipments   = co.shipments || {};
          const utilMT      = totalUtilForProd(shipments, prod);
          const firstUtilDate = getFirstUtilDate(co, prod);
          let leadDays = null, leadStatus = 'no-pertek';
          if (pertekDate) {
            if (firstUtilDate) {
              leadDays   = diffDays(pertekDate, firstUtilDate);
              leadStatus = leadDays > OU_LEAD_STD ? 'overdue' : 'normal';
            } else {
              const daysSince = diffDays(pertekDate, new Date());
              leadStatus = daysSince > OU_LEAD_STD ? 'overdue' : 'normal';
              leadDays   = daysSince;
            }
          }
          ltRecords.push({ code: co.code, product: prod, obtained: obtMT, utilized: utilMT, leadDays, leadStatus, pertekDate, firstUtilDate });
        });
      });

      const nearLimit = ltRecords.filter(r => r.leadDays !== null && r.leadDays > 10 && r.leadDays <= OU_LEAD_STD);
      const overdue   = ltRecords.filter(r => r.leadStatus === 'overdue');
      const normal    = ltRecords.filter(r => r.leadStatus === 'normal' && !(r.leadDays > 10));

      const fmtD2 = d => d ? d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'2-digit'}) : '—';

      const overdueRows = overdue.map(r =>
        `<tr>
          <td style="padding:3px 7px;font-size:7pt;font-weight:700;color:#1e293b">${r.code}</td>
          <td style="padding:3px 7px;font-size:7pt;color:#64748b">${r.product}</td>
          <td style="padding:3px 7px;font-size:7pt;text-align:right;font-variant-numeric:tabular-nums">${r.obtained.toLocaleString()} MT</td>
          <td style="padding:3px 7px;font-size:7pt;text-align:right">${r.utilized > 0 ? r.utilized.toLocaleString() + ' MT' : '—'}</td>
          <td style="padding:3px 7px;font-size:7pt;text-align:center">${fmtD2(r.pertekDate)}</td>
          <td style="padding:3px 7px;font-size:7pt;text-align:center">${r.firstUtilDate ? fmtD2(r.firstUtilDate) : '<em>No entry</em>'}</td>
          <td style="padding:3px 7px;font-size:7.5pt;font-weight:700;color:#991b1b;text-align:center">${r.leadDays !== null ? r.leadDays + 'd' : '—'}</td>
        </tr>`
      ).join('');

      const nearRows = nearLimit.map(r =>
        `<tr>
          <td style="padding:3px 7px;font-size:7pt;font-weight:700;color:#1e293b">${r.code}</td>
          <td style="padding:3px 7px;font-size:7pt;color:#64748b">${r.product}</td>
          <td style="padding:3px 7px;font-size:7pt;text-align:right;font-variant-numeric:tabular-nums">${r.obtained.toLocaleString()} MT</td>
          <td style="padding:3px 7px;font-size:7pt;text-align:right">${r.utilized > 0 ? r.utilized.toLocaleString() + ' MT' : '—'}</td>
          <td style="padding:3px 7px;font-size:7pt;text-align:center">${fmtD2(r.pertekDate)}</td>
          <td style="padding:3px 7px;font-size:7pt;text-align:center">${r.firstUtilDate ? fmtD2(r.firstUtilDate) : '<em>No entry</em>'}</td>
          <td style="padding:3px 7px;font-size:7.5pt;font-weight:700;color:#b45309;text-align:center">${r.leadDays !== null ? r.leadDays + 'd' : '—'}</td>
        </tr>`
      ).join('');

      return `
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:8px;margin-bottom:10px">
        <div style="border-radius:6px;padding:9px 10px;border:1px solid #e2e8f0;border-top:3px solid #991b1b;background:#fff5f5">
          <div style="font-size:5.5pt;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#991b1b;margin-bottom:5px">⚠ Overdue Products</div>
          <div style="font-size:22pt;font-weight:700;line-height:1;color:#991b1b">${overdue.length}</div>
          <div style="font-size:6pt;color:#64748b;margin-top:3px">products exceeded 14-day standard</div>
        </div>
        <div style="border-radius:6px;padding:9px 10px;border:1px solid #e2e8f0;border-top:3px solid #b45309;background:#fffbeb">
          <div style="font-size:5.5pt;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#b45309;margin-bottom:5px">⏱ Near Limit (10–14d)</div>
          <div style="font-size:22pt;font-weight:700;line-height:1;color:#b45309">${nearLimit.length}</div>
          <div style="font-size:6pt;color:#64748b;margin-top:3px">products approaching limit</div>
        </div>
        <div style="border-radius:6px;padding:9px 10px;border:1px solid #e2e8f0;border-top:3px solid #15803d;background:#f0fdf4">
          <div style="font-size:5.5pt;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#15803d;margin-bottom:5px">✓ Normal Status</div>
          <div style="font-size:22pt;font-weight:700;line-height:1;color:#15803d">${normal.length}</div>
          <div style="font-size:6pt;color:#64748b;margin-top:3px">products within 10 days</div>
        </div>
        <div style="border-radius:6px;padding:9px 10px;border:1px solid #e2e8f0;border-top:3px solid #182644;background:#f8fafc">
          <div style="font-size:5.5pt;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#64748b;margin-bottom:5px">Standard</div>
          <div style="font-size:22pt;font-weight:700;line-height:1;color:#182644">14d</div>
          <div style="font-size:6pt;color:#64748b;margin-top:3px">PERTEK → First Utilization</div>
        </div>
      </div>

      ${overdue.length > 0 ? `
      <div style="background:#fff5f5;border:1px solid #fecaca;border-left:3px solid #991b1b;border-radius:5px;padding:8px 11px;margin-bottom:8px">
        <div style="font-size:6pt;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#991b1b;margin-bottom:6px">⚠ Overdue — Immediate Attention Required</div>
        <table class="dt" style="width:100%">
          <thead><tr>
            <th>Company</th><th>Product</th><th class="r">Obtained</th><th class="r">Utilized</th>
            <th style="text-align:center">PERTEK Date</th><th style="text-align:center">First Util Date</th>
            <th style="text-align:center;color:#991b1b">Lead Days</th>
          </tr></thead>
          <tbody>${overdueRows}</tbody>
        </table>
      </div>` : `<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:5px;padding:8px 11px;margin-bottom:8px;font-size:7.5pt;color:#15803d;font-weight:600">✓ No overdue products — all within the 14-day lead time standard.</div>`}

      ${nearLimit.length > 0 ? `
      <div style="background:#fffbeb;border:1px solid #fde68a;border-left:3px solid #b45309;border-radius:5px;padding:8px 11px;margin-bottom:8px">
        <div style="font-size:6pt;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#b45309;margin-bottom:6px">⏱ Approaching Limit — Monitor Closely</div>
        <table class="dt" style="width:100%">
          <thead><tr>
            <th>Company</th><th>Product</th><th class="r">Obtained</th><th class="r">Utilized</th>
            <th style="text-align:center">PERTEK Date</th><th style="text-align:center">First Util Date</th>
            <th style="text-align:center;color:#b45309">Lead Days</th>
          </tr></thead>
          <tbody>${nearRows}</tbody>
        </table>
      </div>` : ''}`;
    })()}

    <div class="pf">
      <div class="pfl">Import Quota Management &nbsp;·&nbsp; CONFIDENTIAL &nbsp;·&nbsp; ${genDate}</div>
      <div class="pfr">Page 1 of 2</div>
    </div>
  </div>`;

  /* ── G. PAGE 2 ────────────────────────────────────────────────────── */
  const p2 = `<div class="page">

    <div class="mhd" style="margin-bottom:11px;padding-bottom:7px">
      <div>
        <div class="mhd-lbl">Executive Summary</div>
        <div class="mhd-ttl" style="font-size:14pt">Import Quota Management</div>
      </div>
      <div class="mhd-r">
        <div class="ppill" style="font-size:7pt;padding:3px 9px">📅 ${periodLabel}</div>
        <div class="meta">${genDate}</div>
      </div>
    </div>

    <div class="sec">
      <div class="sn">3</div>
      <div class="st">Realization Overview</div>
      <div class="sb">Cargo arrived JKT &nbsp;·&nbsp; Eligibility ≥ 60%</div>
    </div>

    <div class="is">
      <div class="ic" style="background:#f0fdf4;border-color:#bbf7d0">
        <div class="il">Companies Realized</div>
        <div class="iv" style="color:#15803d">${s3_co}</div>
        <div class="ib">Cargo arrived at Jakarta port<br><strong style="color:#1e293b">${s3_codes}</strong></div>
      </div>
      <div class="ic" style="background:#eff6ff;border-color:#bfdbfe">
        <div class="il">Avg. Realization Rate</div>
        <div class="iv" style="color:#1e4ea6">${Nf(avgReal)}%</div>
        <div class="ib">Across all arrived companies<br>Threshold for re-apply: ≥ 60%</div>
      </div>
      <div class="ic" style="background:#fffbeb;border-color:#fde68a">
        <div class="il">Re-Apply Pipeline</div>
        <div class="iv" style="color:#c2760a">${s4_tot}</div>
        <div class="ib">${s4_sub} submitted to MoI<br>${s4_elig} eligible, pending submission</div>
      </div>
    </div>

    <table class="dt" style="width:100%;margin-bottom:5px">
      <thead><tr>
        <th>Company</th><th>Product</th>
        <th class="r">Obtained (MT)</th><th class="r">Realized (MT)</th>
        <th>Realization Progress</th><th>Re-Apply Status</th>
      </tr></thead>
      <tbody>${realRows.length > 0 ? realRows.map(renderRealRow).join('') :
        `<tr><td colspan="6" style="padding:16px;text-align:center;color:#94a3b8;font-size:7.5pt">No realization data for selected period.</td></tr>`
      }</tbody>
    </table>
    <div class="fn">
      Realization % = Realized MT ÷ Obtained MT × 100% &nbsp;|&nbsp;
      Cargo must be physically arrived at Jakarta &amp; Beacukai-registered &nbsp;|&nbsp;
      Eligibility threshold: ≥ 60%
    </div>

    <div class="sec" style="margin-top:14px">
      <div class="sn">4</div>
      <div class="st">New Submission Pipeline</div>
      <div class="sb">First-time PERTEK applications &nbsp;·&nbsp; Awaiting Ministry approval</div>
    </div>

    ${(() => {
      const pcos = filteredPending();
      if (!pcos.length) return '<div style="padding:8px 12px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:5px;font-size:7.5pt;color:#15803d;font-weight:600">✓ No pending new submissions in selected period.</div>';
      const totalMT = pcos.reduce((s,d) => s + (typeof d.mt==='number' ? d.mt : 0), 0);
      const rows = pcos.map(d => {
        const cy = (d.cycles||[]).find(c => /submit/i.test(c.type) && !/obtained/i.test(c.type));
        const submitDate = cy ? (cy.submitDate||d.date||'—') : (d.date||'—');
        const stage = d.status || '—';
        return `<tr>
          <td style="padding:4px 7px;font-size:7.5pt;font-weight:700;color:#1e293b">${d.code}</td>
          <td style="padding:4px 7px;font-size:7pt;color:#475569">${d.group}</td>
          <td style="padding:4px 7px;font-size:7pt">${(d.products||[]).join(', ')}</td>
          <td style="padding:4px 7px;font-size:7.5pt;font-weight:700;text-align:right;font-variant-numeric:tabular-nums">${typeof d.mt==='number'?d.mt.toLocaleString():'TBA'}</td>
          <td style="padding:4px 7px;font-size:7pt;color:#475569;white-space:nowrap">${submitDate}</td>
          <td style="padding:4px 7px;font-size:7pt;color:#991b1b;font-style:italic">${stage}</td>
        </tr>`;
      }).join('');
      return `
      <div style="display:flex;gap:10px;margin-bottom:8px">
        <div style="flex:1;border-radius:5px;padding:8px 11px;background:#fef2f2;border:1px solid #fecaca;border-top:3px solid #dc2626">
          <div style="font-size:5.5pt;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#991b1b;margin-bottom:3px">Companies Pending</div>
          <div style="font-size:20pt;font-weight:700;color:#dc2626;line-height:1">${pcos.length}</div>
          <div style="font-size:6pt;color:#64748b;margin-top:2px">Awaiting PERTEK / SPI issuance</div>
        </div>
        <div style="flex:1;border-radius:5px;padding:8px 11px;background:#fff7ed;border:1px solid #fed7aa;border-top:3px solid #c2760a">
          <div style="font-size:5.5pt;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#c2760a;margin-bottom:3px">Total Volume Pending</div>
          <div style="font-size:20pt;font-weight:700;color:#c2760a;line-height:1">${N(totalMT)}</div>
          <div style="font-size:6pt;color:#64748b;margin-top:2px">MT submitted — awaiting approval</div>
        </div>
        <div style="flex:2;border-radius:5px;padding:8px 11px;background:#f8fafc;border:1px solid #e2e8f0">
          <div style="font-size:5.5pt;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#64748b;margin-bottom:3px">Companies</div>
          <div style="font-size:8pt;font-weight:700;color:#1e293b;line-height:1.5">${pcos.map(d=>d.code).join('  ·  ')}</div>
          <div style="font-size:6pt;color:#94a3b8;margin-top:2px">All in Submit #1 — first PERTEK application</div>
        </div>
      </div>
      <table class="dt" style="width:100%">
        <thead><tr>
          <th>Company</th><th>Group</th><th>Product</th>
          <th class="r">Submit MT</th><th>Submit Date</th><th>Approval Stage</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
    })()}

    <div class="fn" style="margin-bottom:14px">
      New Submission = Submit #1 only · First PERTEK application · Ministry of Industry review in progress
    </div>

    <div class="sec" style="margin-top:14px">
      <div class="sn" style="background:#475569">★</div>
      <div class="st">Key Takeaways for Management</div>
    </div>
    <div class="tg">
      <div class="tb" style="border-left-color:#0c7c84">
        <div class="tbh">Quota Submission</div>
        <div class="tbb">
          <strong>${N(s1_mt)} MT</strong> submitted across <strong>${s1_co.size} companies</strong>.
          Quota approved for <strong>${N(s2_mt)} MT</strong> — approval rate <strong>${appRate}%</strong>.
          ${filteredSPI().length} companies active in the quota cycle.
        </div>
      </div>
      <div class="tb" style="border-left-color:#15803d">
        <div class="tbh">Realization &amp; Re-Apply</div>
        <div class="tbb">
          <strong>${s3_co} ${s3_co===1?'company':'companies'}</strong> with cargo at Jakarta,
          averaging <strong>${Nf(avgReal)}% realization</strong>.
          <strong>${s4_tot} ${s4_tot===1?'company':'companies'}</strong> in re-apply pipeline —
          <strong>${s4_sub}</strong> submitted, <strong>${s4_elig}</strong> eligible pending.
        </div>
      </div>
      <div class="tb" style="border-left-color:#dc2626">
        <div class="tbh">New Submissions Pending</div>
        <div class="tbb">
          <strong>${filteredPending().length} ${filteredPending().length===1?'company':'companies'}</strong> with first-time PERTEK applications awaiting Ministry approval —
          <strong>${N(filteredPending().reduce((s,d)=>s+(typeof d.mt==='number'?d.mt:0),0))} MT</strong> total volume pending.
          Companies: <strong>${filteredPending().map(d=>d.code).join(', ')||'—'}</strong>.
        </div>
      </div>
    </div>

    <div class="pf">
      <div class="pfl">Import Quota Management &nbsp;·&nbsp; CONFIDENTIAL &nbsp;·&nbsp; ${genDate}</div>
      <div class="pfr">Page 2 of 2</div>
    </div>
  </div>`;

  /* ── H. RENDER ────────────────────────────────────────────────────── */
  const win = window.open('','_blank','width=960,height=1200,menubar=no,toolbar=no,scrollbars=yes');
  if (!win) { alert('Pop-ups are blocked.\nPlease allow pop-ups and try again.'); return; }
  win.document.write(`<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><title>${pdfName.replace('.pdf','')}</title>
<style>${CSS}</style></head><body>
<div class="ptb">
  <div class="ptb-l">
    <div class="ptb-t">📄 Executive Summary PDF Preview</div>
    <div class="ptb-s">${periodLabel} &nbsp;·&nbsp; ${genDate} &nbsp;·&nbsp; <em>${pdfName}</em></div>
  </div>
  <div class="ptb-r">
    <button class="bp" onclick="window.print()">⬇ Save as PDF</button>
    <button class="bc" onclick="window.close()">✕ Close</button>
  </div>
</div>
<div class="spc"></div>
${p1}
${p2}
<!-- Hidden placeholder divs for JS builders that target specific IDs -->
<div id="revList"      style="display:none"></div>
<div id="pendingQuick" style="display:none"></div>
</body></html>`);
  win.document.close();
}

function doExportCSV() { const hd=['Code','Group','Products','Submit_MT','Obtained_MT','Realized_MT','Realization_Pct','RevType','Status','SPI_Ref','Eligible']; const fSpi=filteredSPI(); const rows=[...fSpi.map(d=>{const ra=getRA(d.code);return[d.code,d.group,d.products.join(';'),d.submit1,d.obtained,ra?ra.berat:'',ra?(ra.realPct*100).toFixed(1)+'%':'',d.revType,statusBadge(d).replace(/<[^>]+>/g,''),d.spiRef,ra?isEligible(ra)?'Yes':'No':''];}), ...filteredPending().map(d=>[d.code,d.group,d.products.join(';'),d.mt,0,'','','pending',d.status,'',''])]; const csv=[hd,...rows].map(r=>r.map(v=>`"${v}"`).join(',')).join('\n'); const a=document.createElement('a');a.href='data:text/csv;charset=utf-8,\uFEFF'+encodeURIComponent(csv);a.download='quota_monitoring_2026.csv';a.click(); }
function doExportJSON() { const d={metadata:{date:'2026-02-26',note:'Realization% = berat/obtained. Eligibility: Realization >= 60%'},spi:filteredSPI(),pending:filteredPending(),reapply:filteredRA()}; const a=document.createElement('a');a.href='data:application/json,'+encodeURIComponent(JSON.stringify(d,null,2));a.download='quota_data_2026.json';a.click(); }

/* ══════════════════════════════════════════════════
   EXPORT TO EXCEL — AUDIT-READY, FILTER-AWARE
   Uses SheetJS (xlsx 0.18.5) from CDN.
   4 sheets:
     1. Summary      — KPI totals matching dashboard
     2. Sub. Cycles  — one row per cycle, no merging
     3. SPI & Real.  — one row per SPI company
     4. Pending      — one row per pending company
══════════════════════════════════════════════════ */
function doExportXLSX() {
  if (typeof XLSX === 'undefined') {
    alert('SheetJS library not loaded yet. Please wait a moment and try again.'); return;
  }

  /* ── helper: format date DD-MMM-YYYY ── */
  function fmtD(str) {
    if (!str || str === 'TBA') return 'TBA';
    const d = pDate(str);
    if (!d) return str;
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return String(d.getDate()).padStart(2,'0') + '-' + months[d.getMonth()] + '-' + d.getFullYear();
  }

  /* ── helper: products obj → string ── */
  function prodsStr(prods) {
    if (!prods) return '';
    if (Array.isArray(prods)) return prods.join('; ');
    return Object.entries(prods).map(([k,v]) => v === 'TBA' ? `${k}: TBA` : `${k}: ${Number(v).toLocaleString()} MT`).join('; ');
  }

  /* ── collect filtered data (same logic as dashboard) ── */
  const fSPI     = filteredSPI();
  const fRA      = filteredRA();
  const fPending = filteredPending();

  /* ─────────────────────────────────────────────────────
     SHEET 1: SUMMARY — KPI totals
     Mirrors updateOverviewKPIs() logic exactly
  ───────────────────────────────────────────────────── */

  // KPI 1: Total Submitted MT (Submit #N cycles, Submit MOI date in period)
  let kpi1_mt = 0, kpi1_co = new Set();
  const allForSubmit = [...SPI, ...PENDING];
  allForSubmit.forEach(co => {
    (co.cycles || []).forEach(c => {
      if (!/^submit #\d/i.test(c.type)) return;
      const mt = typeof c.mt === 'number' ? c.mt : 0;
      if (mt <= 0) return;
      const sd = pDate(c.submitDate);
      if (!PERIOD.active || inPd(sd)) { kpi1_mt += mt; kpi1_co.add(co.code); }
    });
  });

  // KPI 2: SPI Obtained (Obtained #N cycles, Submit MOT date in period)
  let kpi2_mt = 0, kpi2_co = new Set();
  fSPI.forEach(co => {
    (co.cycles || []).forEach(c => {
      if (!/^obtained/i.test(c.type)) return;
      const mt = typeof c.mt === 'number' ? c.mt : 0;
      if (mt <= 0) return;
      const sd = pDate(c.submitDate); // Submit MOT date
      if (!PERIOD.active || inPd(sd)) { kpi2_mt += mt; kpi2_co.add(co.code); }
    });
  });

  // KPI 3: Total Realized (cargoArrived=true in filtered RA)
  const arrivedRA = fRA.filter(r => r.cargoArrived);
  const kpi3_mt   = arrivedRA.reduce((s,r) => s + (r.berat||0), 0);
  const kpi3_co   = arrivedRA.length;
  const kpi3_avg  = fRA.length > 0
    ? (fRA.reduce((s,r) => s + (r.cargoArrived ? r.realPct : (r.utilPct||0)), 0) / fRA.length * 100)
    : 0;

  // KPI 4: Re-Apply eligible
  const eligRA    = fRA.filter(r => r.cargoArrived && r.realPct >= 0.6);
  const kpi4_co   = eligRA.length;
  const kpi4_mt   = eligRA.reduce((s,r) => s + (r.target||0), 0);

  // KPI 5: Pending
  let kpi5_mt = 0, kpi5_co = new Set();
  fPending.forEach(co => {
    (co.cycles || []).forEach(c => {
      if (!/^submit/i.test(c.type)) return;
      const mt = typeof c.mt === 'number' ? c.mt : 0;
      if (mt <= 0) return;
      const sd = pDate(c.submitDate);
      if (!PERIOD.active || inPd(sd)) { kpi5_mt += mt; kpi5_co.add(co.code); }
    });
  });

  const modeLabel = FILTER_MODE==='submit'?'Submit Date Only':FILTER_MODE==='release'?'Release Date Only':'Submit + Release Date';
  const summaryRows = [
    ['Import Quota Monitor 2026 — Export Report'],
    [],
    ['Generated On', new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})],
    ['Period Filter', PERIOD.active ? PERIOD.label : 'All Time (No Filter)'],
    ['Filter Mode',  modeLabel],
    ['Data Source',  'Claude_-_Timeline_Submission.xlsx · 26 Feb 2026'],
    [],
    ['KPI', 'MT / Count', 'Companies', 'Notes'],
    ['Total Submitted (Submit MOI)',   kpi1_mt, kpi1_co.size,  'Sum of all Submit #N cycle MTs where Submit MOI date is in period'],
    ['SPI / Pertek Obtained',          kpi2_mt, kpi2_co.size,  'Sum of Obtained #N cycle MTs where Submit MOT date is in period (SPI companies only)'],
    ['Total Realized (Arrived Cargo)', kpi3_mt, kpi3_co,       'cargoArrived=true records in filtered RA'],
    ['Avg Realization Rate',           parseFloat(kpi3_avg.toFixed(1)) + '%', '—', 'Avg of realPct (arrived) and utilPct (in shipment) across all filtered RA'],
    ['Re-Apply Target',                kpi4_mt, kpi4_co,       'Eligible = cargoArrived=true AND realPct ≥ 60%'],
    ['New Submission',                 kpi5_mt, kpi5_co.size,  'Sum of Submit #N cycle MTs in PENDING where Submit MOI date is in period'],
    [],
    ['Filtered Companies Summary'],
    ['SPI Companies in View', fSPI.length],
    ['Pending Companies in View', fPending.length],
    ['Realization Records in View', fRA.length],
    [],
    ['IMPORTANT NOTES'],
    ['Realization %', '= Berat Arrived ÷ Obtained × 100%  (cargo arrived & Beacukai-registered only)'],
    ['Utilization %',  '= Berat Allocated ÷ Obtained × 100% (sold/allocated, cargo still at sea)'],
    ['Re-Apply Rule',  'cargoArrived = true AND realPct ≥ 60%'],
    ['Cycles',         'Each submission round is a separate row — do NOT merge Submit #1 & #2'],
    ['Double Counting','KPI MTs are summed per unique cycle; no company counted twice per cycle number'],
  ];

  /* ─────────────────────────────────────────────────────
     SHEET 2: SUBMISSION CYCLES — one row per cycle
     All companies that pass the filter, all their cycles.
  ───────────────────────────────────────────────────── */
  const CYCLE_HDR = [
    'Company Code','Group','Overall Status',
    'Cycle Type','Products (per cycle)','MT (per cycle)',
    'Submit Type','Submit Date','Release Type','Release Date',
    'Cycle Status / Notes',
    'Revision Note','Rev. Submit Date','Rev. Approval Status',
  ];
  const cycleRows = [CYCLE_HDR];

  const allFiltered = [
    ...fSPI.map(d => ({...d, _section:'SPI'})),
    ...fPending.map(d => ({...d, _section:'PENDING'})),
  ];

  allFiltered.forEach(co => {
    const status = co._section === 'PENDING' ? 'New Submission'
      : revisionStatus(co) === 'reapply'   ? 'Re-Apply (Submit #2)'
      : revisionStatus(co) === 'active'    ? 'Under Revision'
      : co.revType === 'complete' ? 'Rev. Complete'
      : 'SPI Issued';
    (co.cycles || []).forEach(c => {
      const mtVal = typeof c.mt === 'number' ? c.mt : (c.mt === 'TBA' ? 'TBA' : '');
      cycleRows.push([
        co.code,
        co.group,
        status,
        c.type,
        prodsStr(c.products),
        mtVal,
        c.submitType  || '',
        fmtD(c.submitDate),
        c.releaseType || '',
        fmtD(c.releaseDate),
        c.status || '',
        co.revNote         || '',
        co.revSubmitDate   || '',
        co.revStatus       || '',
      ]);
    });
  });

  /* ─────────────────────────────────────────────────────
     SHEET 3: SPI & REALIZATION — one row per SPI company
  ───────────────────────────────────────────────────── */
  const SPI_HDR = [
    'Company Code','Group','Products','Overall Status',
    'Submit #1 (MT)','Obtained (MT)',
    'Cargo Arrived?',
    'Berat Realized (MT)','Realization %',
    'Berat Utilized (MT)','Utilization %',
    'Re-Apply Eligible','Re-Apply Stage',
    'Target Re-Apply (MT)','Re-Apply Product',
    'PERTEK No.','SPI No.','Shipment Ref.','Utilization MT','Available Quota MT','Updated By','Updated Date',
    'ETA Jakarta','PIB Release Date','Re-Apply Est.',
    'Status Update (CorpSec)',
    'Rev. Type','Rev. Note','Rev. Status','Rev. Submit Date',
    'SPI / Pertek Ref.',
  ];
  const spiRows = [SPI_HDR];

  fSPI.forEach(co => {
    const ra = getRA(co.code);
    const elig = ra && ra.cargoArrived && ra.realPct >= 0.6;
    const status = revisionStatus(co) === 'reapply'  ? 'Re-Apply (Submit #2)'
      : revisionStatus(co) === 'active'  ? 'Under Revision'
      : co.revType === 'complete' ? 'Rev. Complete' : 'SPI Issued';
    spiRows.push([
      co.code,
      co.group,
      co.products.join('; '),
      status,
      typeof co.submit1 === 'number' ? co.submit1 : '',
      typeof co.obtained === 'number' ? co.obtained : '',
      ra ? (ra.cargoArrived ? 'Yes' : 'No') : '',
      ra && ra.cargoArrived ? ra.berat : '',
      ra && ra.cargoArrived ? parseFloat((ra.realPct*100).toFixed(2)) : '',
      ra && !ra.cargoArrived ? ra.berat : '',
      ra && !ra.cargoArrived && ra.utilPct != null ? parseFloat((ra.utilPct*100).toFixed(2)) : '',
      elig ? 'Yes' : (ra ? 'No' : ''),
      ra && ra.reapplyStage ? `Stage ${ra.reapplyStage}` : '',
      ra && ra.target ? ra.target : '',
      ra && ra.reapplyProduct ? ra.reapplyProduct : '',
      co.pertekNo || (ra ? (ra.pertekNo||ra.pertek||'') : '') || '',
      co.spiNo    || (ra ? (ra.spiNo||ra.spi||'')       : '') || '',
      ra ? ra.catatan : '',
      ra ? ra.etaJKT  : '',
      ra ? (ra.pibReleaseDate || '') : '',
      ra && ra.reapplyEst ? ra.reapplyEst : '',
      co.statusUpdate || '',
      co.revType || '',
      co.revNote || '',
      co.revStatus || '',
      co.revSubmitDate || '',
      co.spiRef || '',
      co.utilizationMT != null ? co.utilizationMT : '',
      co.availableQuota != null ? co.availableQuota : (co.obtained != null ? '' : ''),
      co.updatedBy || '',
      co.updatedDate || '',
    ]);
  });

  /* ─────────────────────────────────────────────────────
     SHEET 4: PENDING — one row per pending company
  ───────────────────────────────────────────────────── */
  const PEND_HDR = [
    'Company Code','Group','Products',
    'Submit MT','Submit MOI Date','Latest Update Date',
    'Approval Stage / Status',
    'Cycle Type','Release Type','Release Date',
    'Remarks',
  ];
  const pendRows = [PEND_HDR];

  fPending.forEach(co => {
    // Use first Submit cycle for primary info
    const submitCycle = (co.cycles || []).find(c => /^submit/i.test(c.type)) || {};
    pendRows.push([
      co.code,
      co.group,
      co.products.join('; '),
      typeof co.mt === 'number' ? co.mt : '',
      fmtD(submitCycle.submitDate),
      co.date || '',
      co.status || '',
      submitCycle.type || '',
      submitCycle.releaseType || '',
      fmtD(submitCycle.releaseDate),
      co.remarks || '',
    ]);
  });

  /* ── VALIDATION CHECK — recalculate totals to confirm no drift ── */
  const checkObtained = fSPI.reduce((s,co) => {
    (co.cycles||[]).forEach(c => {
      if (/^obtained/i.test(c.type) && typeof c.mt==='number') s += c.mt;
    });
    return s;
  }, 0);
  // If drift detected, add a note row to summary
  if (Math.abs(checkObtained - kpi2_mt) > 0.01) {
    summaryRows.push([]);
    summaryRows.push(['⚠ VALIDATION WARNING', `Cycle-sum obtained (${checkObtained}) differs from KPI2 (${kpi2_mt}). Review filter logic.`]);
  }

  /* ── BUILD WORKBOOK ── */
  const wb = XLSX.utils.book_new();

  function makeSheet(rows, headerLen) {
    const ws = XLSX.utils.aoa_to_sheet(rows);

    // Auto column widths (max 60 chars)
    const colWidths = [];
    rows.forEach(row => {
      (row || []).forEach((val, ci) => {
        const len = val == null ? 4 : String(val).length;
        colWidths[ci] = Math.min(60, Math.max(colWidths[ci] || 8, len + 2));
      });
    });
    ws['!cols'] = colWidths.map(w => ({ wch: w }));

    // Freeze top row (first data/header row — different per sheet)
    ws['!freeze'] = { xSplit: 0, ySplit: headerLen, topLeftCell: `A${headerLen+1}`, activeCell: 'A1', sqref: 'A1' };

    return ws;
  }

  // Sheet 1: Summary — header at row 8 (index 7), freeze row 8
  const ws1 = makeSheet(summaryRows, 8);
  // Bold title cell A1
  if (ws1['A1']) ws1['A1'].s = { font:{ bold:true, sz:14 }, fill:{ fgColor:{ rgb:'182644' } }, font2:{ color:{ rgb:'FFFFFF' } } };
  XLSX.utils.book_append_sheet(wb, ws1, 'Summary');

  // Sheet 2: Submission Cycles — header at row 1
  const ws2 = makeSheet(cycleRows, 1);
  XLSX.utils.book_append_sheet(wb, ws2, 'Submission Cycles');

  // Sheet 3: SPI & Realization — header at row 1
  const ws3 = makeSheet(spiRows, 1);
  XLSX.utils.book_append_sheet(wb, ws3, 'SPI & Realization');

  // Sheet 4: New Submission — header at row 1
  const ws4 = makeSheet(pendRows, 1);
  XLSX.utils.book_append_sheet(wb, ws4, 'New Submission');

  /* ── Set number format on MT columns using cell-level format ── */
  // For sheets 2,3,4 — find MT numeric cells and apply number format
  [ws2, ws3, ws4].forEach(ws => {
    const ref = ws['!ref'];
    if (!ref) return;
    const range = XLSX.utils.decode_range(ref);
    for (let R = range.s.r+1; R <= range.e.r; R++) {
      for (let C = range.s.c; C <= range.e.c; C++) {
        const addr = XLSX.utils.encode_cell({r:R, c:C});
        const cell = ws[addr];
        if (!cell) continue;
        if (cell.t === 'n') {
          // Check if it looks like an MT value (>=0, could be large)
          // Apply thousand separator format to all numeric cells
          cell.z = '#,##0.##';
        }
      }
    }
  });

  /* ── Generate filename with period label ── */
  const periodTag = PERIOD.active
    ? PERIOD.label.replace(/[/\\:*?"<>| ]/g, '_')
    : 'AllTime';
  const dateTag = new Date().toISOString().slice(0,10);
  const filename = `QuotaMonitor_${periodTag}_${dateTag}.xlsx`;

  /* ── Download ── */
  XLSX.writeFile(wb, filename);

  /* ── Show confirmation toast ── */
  const toast = document.createElement('div');
  toast.style.cssText = 'position:fixed;bottom:30px;left:50%;transform:translateX(-50%);background:#14673e;color:#fff;padding:10px 22px;border-radius:8px;font-size:13px;font-weight:600;z-index:1100;box-shadow:0 4px 20px rgba(0,0,0,.2)';
  toast.textContent = `✅ Export ready: ${filename}  ·  ${fSPI.length} SPI + ${fPending.length} Pending companies  ·  ${cycleRows.length-1} cycle rows`;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 5000);
}

/* ══════════════════════════════════════════════════
   INIT
══════════════════════════════════════════════════ */
/* ══════════════════════════════════════════════════
   LEAD TIME ANALYTICS
══════════════════════════════════════════════════ */

/* Parse dates from remarks (submit) and spiRef (issued) strings.
   Format: dd/mm/yy or d/m/yy or dd/mm/yyyy */