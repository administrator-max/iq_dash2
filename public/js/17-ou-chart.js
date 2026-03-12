/* ═══════════════════════════════════════
   OBTAIN vs UTILIZATION CHART MODULE
   buildOUChart, buildOUChartOverview,
   Lead-time drill, overview KPIs
═══════════════════════════════════════ */

const OU_PROD_COLORS = {
  'SHEETPILE':              { solid: '#1e56c6', light: '#eff4ff', border: '#c3d3f9', label: 'Sheet Pile',        hex: '#1e56c6' },
  'GI BORON':               { solid: '#ca8a04', light: '#fef9c3', border: '#fde68a', label: 'GI Boron',          hex: '#ca8a04' },
  'GL BORON':               { solid: '#16a34a', light: '#dcfce7', border: '#86efac', label: 'GL Boron',          hex: '#16a34a' },
  'GL':                     { solid: '#16a34a', light: '#dcfce7', border: '#86efac', label: 'GL',                hex: '#16a34a' },
  'BORDES ALLOY':           { solid: '#16a34a', light: '#dcfce7', border: '#86efac', label: 'Wear Plate/Bordes', hex: '#16a34a' },
  'AS STEEL':               { solid: '#ea580c', light: '#fff7ed', border: '#fed7aa', label: 'AS Steel',          hex: '#ea580c' },
  'SEAMLESS PIPE':          { solid: '#7c3aed', light: '#f5f3ff', border: '#ddd6fe', label: 'Seamless Pipe',     hex: '#7c3aed' },
  'PPGL':                   { solid: '#0891b2', light: '#ecfeff', border: '#a5f3fc', label: 'PPGL',              hex: '#0891b2' },
  'PPGL CARBON':            { solid: '#0891b2', light: '#ecfeff', border: '#a5f3fc', label: 'PPGL Carbon',       hex: '#0891b2' },
  'GL + PPGL':              { solid: '#0f766e', light: '#ccfbf1', border: '#99f6e4', label: 'GL + PPGL',         hex: '#0f766e' },
  'GI BORON + ERW PIPE':    { solid: '#b45309', light: '#fef3c7', border: '#fde68a', label: 'GI Boron + ERW',    hex: '#b45309' },
  'GI':                     { solid: '#ca8a04', light: '#fef9c3', border: '#fde68a', label: 'GI',                hex: '#ca8a04' },
  'ERW PIPE OD≤140mm':      { solid: '#9333ea', light: '#f3e8ff', border: '#d8b4fe', label: 'ERW Pipe ≤140mm',  hex: '#9333ea' },
  'ERW PIPE OD>140mm':      { solid: '#6366f1', light: '#eef2ff', border: '#c7d2fe', label: 'ERW Pipe >140mm',  hex: '#6366f1' },
  'HOLLOW PIPE':            { solid: '#64748b', light: '#f1f5f9', border: '#cbd5e1', label: 'Hollow Pipe',       hex: '#64748b' },
  'HRC/HRPO ALLOY':         { solid: '#dc2626', light: '#fef2f2', border: '#fecaca', label: 'HRC/HRPO Alloy',   hex: '#dc2626' },
};
/** Get OU color for a product — fallback to a neutral grey */
function ouPC(prod) {
  return OU_PROD_COLORS[prod] || { solid: '#94a3b8', light: '#f1f5f9', border: '#e2e8f0', label: prod, hex: '#94a3b8' };
}

/** Build the color legend HTML for the OU chart */
function buildOULegend(products) {
  const seen = new Set();
  const items = products.filter(p => { if (seen.has(p)) return false; seen.add(p); return true; });
  return `<div style="display:flex;flex-wrap:wrap;gap:10px;padding:8px 16px;border-bottom:1px solid var(--border);background:#f8fafc;align-items:center">
    <span style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--txt3)">Products:</span>
    ${items.map(p => {
      const c = ouPC(p);
      return `<span style="display:inline-flex;align-items:center;gap:5px;font-size:10px;font-weight:600;color:${c.solid}">
        <span style="width:12px;height:12px;border-radius:2px;background:${c.solid};flex-shrink:0;display:inline-block"></span>${c.label}
      </span>`;
    }).join('')}
    <span style="display:inline-flex;align-items:center;gap:5px;font-size:10px;font-weight:600;color:#dc2626;margin-left:4px">
      <span style="width:12px;height:12px;border-radius:2px;background:#dc2626;flex-shrink:0;display:inline-block"></span>⚠ Overdue
    </span>
    <span style="display:inline-flex;align-items:center;gap:5px;font-size:10px;font-weight:600;color:var(--txt3);margin-left:4px">
      <span style="width:12px;height:12px;border-radius:2px;background:#e2e8f0;border:1px solid #cbd5e1;flex-shrink:0;display:inline-block"></span>Remaining
    </span>
    <span style="display:inline-flex;align-items:center;gap:5px;font-size:10px;font-weight:600;color:var(--navy);margin-left:4px">
      <span style="width:18px;height:2px;border-top:2px dashed var(--navy);flex-shrink:0;display:inline-block;margin-bottom:1px"></span>Obtained (line)
    </span>
  </div>`;
}

let ouFilterMode  = 'ALL';   // ALL | PROD | CO
let ouStatusMode  = 'ALL';   // ALL | NORMAL | OVERDUE
const OU_LEAD_STD = 14;      // days

/* Overview chart has its own independent filter state */
let ouOvFilterMode = 'ALL';
let ouOvStatusMode = 'ALL';

function setOUOvFilter(mode, el) {
  ouOvFilterMode = mode;
  document.querySelectorAll('#ouOvFiltAll,#ouOvFiltProd,#ouOvFiltCo').forEach(x => x.classList.remove('on'));
  el.classList.add('on');
  buildOUChartOverview();
}

function setOUOvStatus(mode, el) {
  ouOvStatusMode = mode;
  document.querySelectorAll('#ouOvStatusAll,#ouOvStatusNorm,#ouOvStatusOver').forEach(x => x.classList.remove('on'));
  el.classList.add('on');
  buildOUChartOverview();
}

/** Build per-company-product records for the OU chart */
function buildOUData() {
  const records = [];

  filteredSPI().forEach(co => {
    const pertekDate = getPertekDateForCo(co);
    const obtByProd  = getObtainedByProd(co);

    Object.entries(obtByProd).forEach(([prod, obtMT]) => {
      if (!obtMT || obtMT <= 0) return;

      // Utilized MT — from utilizationByProd[prod], the single source of truth
      // shared with Shipment & Realization Monitoring column "Utilization (MT)"
      const utilMT    = (co.utilizationByProd || {})[prod] || 0;
      const remaining = Math.max(0, obtMT - utilMT);

      // First utilization date: earliest ETA/PIB date with utilMT > 0
      const firstUtilDate = getFirstUtilDate(co, prod);

      // Lead time
      let leadDays = null;
      let leadStatus = 'no-pertek';

      if (pertekDate) {
        if (firstUtilDate) {
          leadDays   = diffDays(pertekDate, firstUtilDate);
          leadStatus = leadDays > OU_LEAD_STD ? 'overdue' : 'normal';
        } else {
          // No utilization entry: check if 14+ days have passed since PERTEK
          const today   = new Date();
          const daysSince = diffDays(pertekDate, today);
          if (daysSince > OU_LEAD_STD) {
            leadStatus = 'overdue';
            leadDays   = daysSince; // days since PERTEK with no util
          } else {
            leadStatus = 'normal';
            leadDays   = daysSince;
          }
        }
      }

      records.push({
        code: co.code,
        product: prod,
        obtained: obtMT,
        utilized: utilMT,
        remaining,
        utilPct: obtMT > 0 ? (utilMT / obtMT) : 0,
        pertekDate,
        firstUtilDate,
        leadDays,
        leadStatus,   // 'normal' | 'overdue' | 'no-pertek'
        hasUtil: utilMT > 0,
      });
    });
  });

  return records;
}

/** Get PERTEK date for a company from its cycles */
function getPertekDateForCo(co) {
  const cycles = co.cycles || [];
  // Find the first Submit cycle that has a releaseDate (PERTEK Terbit)
  for (const c of cycles) {
    if (/^submit #?1/i.test(c.type) || /^revision #?1/i.test(c.type)) {
      const d = pDate(c.releaseDate);
      if (d) return d;
    }
  }
  // Fallback: any Submit cycle with releaseDate
  for (const c of cycles) {
    if (/^submit/i.test(c.type) && !/obtained/i.test(c.type)) {
      const d = pDate(c.releaseDate);
      if (d) return d;
    }
  }
  return null;
}

/** Get earliest utilization date for a product from shipment lots */
function getFirstUtilDate(co, prod) {
  const lots = (co.shipments || {})[prod] || [];
  let earliest = null;
  lots.forEach(lot => {
    if (!lot.utilMT || lot.utilMT <= 0) return;
    // Try pibDate first (actual arrival), then etaJKT string
    let d = null;
    if (lot.pibDate && lot.pibDate.trim()) {
      d = pDate(lot.pibDate);
    }
    if (!d && lot.etaJKT && lot.etaJKT.trim()) {
      // etaJKT may be "07 Mar 26" — try parsing
      d = parseETA(lot.etaJKT);
    }
    if (d && (!earliest || d < earliest)) earliest = d;
  });
  // Fallback: use RA data
  if (!earliest) {
    const ra = getRA(co.code);
    if (ra && ra.arrivalDate) {
      const d = pDate(ra.arrivalDate);
      if (d) earliest = d;
    }
  }
  return earliest;
}

/** Parse ETA strings like "07 Mar 26", "07 Mar 2026", "2026-03-07" */
function parseETA(str) {
  if (!str) return null;
  // Try ISO
  const iso = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(+iso[1], +iso[2]-1, +iso[3]);
  // Try "DD Mon YY" or "DD Mon YYYY"
  const months = {jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11};
  const m = str.match(/(\d{1,2})\s+([A-Za-z]{3})\s+(\d{2,4})/);
  if (m) {
    let y = +m[3]; if (y < 100) y += 2000;
    const mo = months[m[2].toLowerCase()];
    if (mo !== undefined) return new Date(y, mo, +m[1]);
  }
  return pDate(str);
}

/** Filter and aggregate OU data based on current filter modes */
function getFilteredOUData(records) {
  let filtered = records;

  // Status filter
  if (ouStatusMode === 'NORMAL')  filtered = filtered.filter(r => r.leadStatus === 'normal');
  if (ouStatusMode === 'OVERDUE') filtered = filtered.filter(r => r.leadStatus === 'overdue');

  return filtered;
}

/** Aggregate records by product or company */
function aggregateOU(records, byField) {
  const map = {};
  records.forEach(r => {
    const key = byField === 'product' ? r.product : r.code;
    if (!map[key]) map[key] = { label: key, obtained: 0, utilized: 0, remaining: 0, overdue: 0, normal: 0, count: 0, leadDaysArr: [] };
    map[key].obtained  += r.obtained;
    map[key].utilized  += r.utilized;
    map[key].remaining += r.remaining;
    map[key].count++;
    if (r.leadStatus === 'overdue') map[key].overdue++;
    else if (r.leadStatus === 'normal') map[key].normal++;
    if (r.leadDays !== null) map[key].leadDaysArr.push(r.leadDays);
  });
  return Object.values(map).sort((a, b) => b.obtained - a.obtained);
}

function setOUFilter(mode, el) {
  ouFilterMode = mode;
  document.querySelectorAll('#ouFiltAll,#ouFiltProd,#ouFiltCo').forEach(x => x.classList.remove('on'));
  el.classList.add('on');
  buildOUChart();
}

function setOUStatus(mode, el) {
  ouStatusMode = mode;
  document.querySelectorAll('#ouStatusAll,#ouStatusNorm,#ouStatusOver').forEach(x => x.classList.remove('on'));
  el.classList.add('on');
  buildOUChart();
}

function buildOUChart() {
  const allRecords  = buildOUData();
  const filtered    = getFilteredOUData(allRecords);

  /* ── KPI Summary Strip ── */
  // Total Obtained: sum Obtained #N cycle MTs across ALL filteredSPI — matches KPI2
  let totalObtained = 0;
  filteredSPI().forEach(co => {
    (co.cycles || []).forEach(c => {
      if (!/^obtained #/i.test(c.type)) return;
      const mt = typeof c.mt === 'number' ? c.mt : 0;
      if (mt <= 0) return;
      const pertekTerbit = getPertekTerbitForObtained(c, co.cycles);
      if (!PERIOD.active || inPd(pertekTerbit)) totalObtained += mt;
    });
  });
  const totalUtilized = allRecords.reduce((s, r) => s + r.utilized, 0);
  const totalRemain   = allRecords.reduce((s, r) => s + r.remaining, 0);
  const overdueCount  = allRecords.filter(r => r.leadStatus === 'overdue').length;
  const normalCount   = allRecords.filter(r => r.leadStatus === 'normal').length;
  const avgUtilPct    = totalObtained > 0 ? Math.round(totalUtilized / totalObtained * 100) : 0;

  const kpiStrip = document.getElementById('ouKpiStrip');
  if (kpiStrip) kpiStrip.innerHTML = `
    <div style="padding:11px 16px;border-right:1px solid var(--border)">
      <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--txt3);margin-bottom:3px">Total Obtained</div>
      <div style="font-size:22px;font-weight:700;color:var(--navy);line-height:1">${totalObtained.toLocaleString()}</div>
      <div style="font-size:10px;color:var(--txt3);margin-top:2px">MT · ${allRecords.length} product-company pairs</div>
    </div>
    <div style="padding:11px 16px;border-right:1px solid var(--border)">
      <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--blue);margin-bottom:3px">Total Utilized</div>
      <div style="font-size:22px;font-weight:700;color:var(--blue);line-height:1">${totalUtilized.toLocaleString()}</div>
      <div style="font-size:10px;color:var(--txt3);margin-top:2px">MT · ${avgUtilPct}% avg utilization</div>
    </div>
    <div style="padding:11px 16px;border-right:1px solid var(--border)">
      <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--txt3);margin-bottom:3px">Remaining</div>
      <div style="font-size:22px;font-weight:700;color:var(--teal);line-height:1">${totalRemain.toLocaleString()}</div>
      <div style="font-size:10px;color:var(--txt3);margin-top:2px">MT · unallocated quota</div>
    </div>
    <div style="padding:11px 16px">
      <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--red2);margin-bottom:3px">Lead Time Status</div>
      <div style="display:flex;align-items:baseline;gap:8px">
        <span style="font-size:22px;font-weight:700;color:var(--red2);line-height:1">${overdueCount}</span>
        <span style="font-size:12px;color:var(--txt3)">⚠ Revision</span>
        <span style="font-size:22px;font-weight:700;color:var(--green);line-height:1;margin-left:8px">${normalCount}</span>
        <span style="font-size:12px;color:var(--txt3)">✓ Normal</span>
      </div>
      <div style="font-size:10px;color:var(--txt3);margin-top:2px">Standard: ≤ ${OU_LEAD_STD} days</div>
    </div>`;

  /* ── Chart data ── */
  let labels, obtData, utilData, remainData, overdueFlags, productKeys;

  if (ouFilterMode === 'PROD') {
    const agg = aggregateOU(filtered, 'product');
    labels      = agg.map(r => r.label);
    obtData     = agg.map(r => r.obtained);
    utilData    = agg.map(r => r.utilized);
    remainData  = agg.map(r => r.remaining);
    overdueFlags= agg.map(r => r.overdue > 0);
    productKeys = agg.map(r => r.label);
  } else if (ouFilterMode === 'CO') {
    const agg = aggregateOU(filtered, 'company');
    labels      = agg.map(r => r.label);
    obtData     = agg.map(r => r.obtained);
    utilData    = agg.map(r => r.utilized);
    remainData  = agg.map(r => r.remaining);
    overdueFlags= agg.map(r => r.overdue > 0);
    // For company aggregation, try to get primary product
    productKeys = agg.map(r => {
      const recs = filtered.filter(x => x.code === r.label);
      return recs.length ? recs[0].product : '';
    });
  } else {
    // All: one bar per company-product pair — sorted by product name for grouping
    const sorted = [...filtered].sort((a, b) => {
      if (a.product !== b.product) return a.product.localeCompare(b.product);
      return b.obtained - a.obtained; // within same product: largest first
    });
    labels      = sorted.map(r => `${r.code} · ${r.product}`);
    obtData     = sorted.map(r => r.obtained);
    utilData    = sorted.map(r => r.utilized);
    remainData  = sorted.map(r => r.remaining);
    overdueFlags= sorted.map(r => r.leadStatus === 'overdue');
    productKeys = sorted.map(r => r.product);
  }

  /* ── Inject color legend ── */
  const allProds = [...new Set(allRecords.map(r => r.product))];
  const legendEl = document.getElementById('ouLegend');
  if (legendEl) legendEl.innerHTML = buildOULegend(allProds);

  /* ── Per-bar colors — fully solid for readability ── */
  const utilColors   = productKeys.map((p, i) =>
    overdueFlags[i] ? '#dc2626' : ouPC(p).solid);
  const remainColors = productKeys.map(p => ouPC(p).light);

  /* ── Build / rebuild chart ── */
  mkChart('obtainUtilChart', {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Utilized (MT)',
          data: utilData,
          backgroundColor: utilColors,
          borderRadius: 0,
          stack: 'ou',
          order: 1,
        },
        {
          label: 'Remaining (MT)',
          data: remainData,
          backgroundColor: remainColors,
          borderColor: productKeys.map(p => ouPC(p).border),
          borderWidth: 1,
          borderRadius: 4,
          stack: 'ou',
          order: 1,
        },
        {
          label: 'Obtained (MT) — Total Line',
          data: obtData,
          type: 'line',
          borderColor: 'rgba(24,38,68,.55)',
          borderWidth: 2,
          borderDash: [4, 3],
          pointRadius: 3,
          pointBackgroundColor: 'rgba(24,38,68,.7)',
          fill: false,
          stack: undefined,
          order: 0,
        }
      ]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { labels: { font: { size: 10.5, family: 'DM Sans' }, color: '#64748b', boxWidth: 10, padding: 10 } },
        tooltip: {
          mode: 'index', intersect: false,
          callbacks: {
            title: ctx => labels[ctx[0].dataIndex],
            label: ctx => {
              const i = ctx.dataIndex;
              const prod = productKeys[i] || '';
              const prodLabel = ouPC(prod).label;
              if (ctx.dataset.label.startsWith('Obtained')) return ` Obtained: ${obtData[i].toLocaleString()} MT`;
              if (ctx.dataset.label.startsWith('Utilized'))  return ` Utilized: ${utilData[i].toLocaleString()} MT (${Math.round(utilData[i]/(obtData[i]||1)*100)}%) · ${prodLabel}`;
              if (ctx.dataset.label.startsWith('Remaining')) return ` Remaining: ${remainData[i].toLocaleString()} MT`;
              return null;
            },
            afterBody: ctx => {
              const i = ctx[0].dataIndex;
              const flag = overdueFlags[i];
              return flag ? ['', '⚠ Lead Time Status: REVISION (>14 days)'] : ['', '✓ Lead Time Status: Normal (≤14 days)'];
            }
          }
        }
      },
      scales: {
        x: { stacked: true, grid: { display: false }, ticks: { font: { size: 9, family: 'DM Sans' }, color: '#64748b', maxRotation: 45 } },
        y: { stacked: true, grid: { color: '#f1f5f9' }, ticks: { font: { size: 10 }, color: '#64748b', callback: v => v.toLocaleString() + ' MT' } }
      }
    }
  });

  /* ── Detail Table — per-company, multi-product breakdown with ↳ sub-rows ── */
  const tbody = document.getElementById('ouTableBody');
  if (!tbody) return;

  const Nmt = v => typeof v === 'number' ? v.toLocaleString() : '—';

  // Build RA lookup map
  const raLookup = {};
  RA.forEach(ra => { raLookup[ra.code] = ra; });

  // Group allRecords by company code (preserving per-product rows),
  // then sort companies A→Z by code
  const byCode = {};
  allRecords.forEach(r => {
    if (!byCode[r.code]) byCode[r.code] = [];
    byCode[r.code].push(r);
  });
  const sortedCodes = Object.keys(byCode).sort((a, b) => a.localeCompare(b));

  let html = '';

  sortedCodes.forEach(code => {
    const prods   = byCode[code];          // array of {product, obtained, utilized, …}
    const ra      = raLookup[code];
    const isMulti = prods.length > 1;

    // Per-company totals for the header row
    const coObtained = prods.reduce((s, r) => s + r.obtained, 0);
    // Utilization from SPI utilizationByProd — same source as Shipment & Realization Monitoring
    const coSPIrec   = getSPI(code);
    const coUBP      = coSPIrec ? (coSPIrec.utilizationByProd || {}) : {};
    const coUtilized = Object.values(coUBP).reduce((s, v) => s + (typeof v === 'number' ? v : 0), 0);

    // Realization from RA (cargo-arrived gives single berat total)
    const coRealMT  = (ra && ra.cargoArrived) ? ra.berat  : 0;
    const coRealPct = (ra && ra.cargoArrived) ? ra.realPct : 0;

    // ETA display
    const etaHTML = ra && ra.etaJKT
      ? (ra.cargoArrived
          ? `<span style="font-size:10.5px;font-weight:700;color:var(--green)">✓ ${ra.etaJKT}</span>`
          : `<span style="font-size:10.5px;font-weight:600;color:var(--orange)">🚢 ${ra.etaJKT}</span>`)
      : `<span style="font-size:10px;color:var(--txt3)">—</span>`;

    // Status badge
    let shipBadge, rowBg;
    if (!ra) {
      shipBadge = `<span style="font-size:9.5px;font-weight:700;padding:2px 8px;border-radius:3px;background:var(--bg);color:var(--txt3);border:1px solid var(--border)">— No Shipment</span>`;
      rowBg = '';
    } else if (ra.cargoArrived) {
      shipBadge = `<span style="font-size:9.5px;font-weight:700;padding:2px 8px;border-radius:3px;background:var(--green-bg);color:var(--green);border:1px solid var(--green-bd)">✓ Arrived JKT</span>`;
      rowBg = 'background:#f8fffe';
    } else {
      shipBadge = `<span style="font-size:9.5px;font-weight:700;padding:2px 8px;border-radius:3px;background:var(--orange-bg);color:var(--orange);border:1px solid var(--orange-bd)">🚢 In Shipment</span>`;
      rowBg = 'background:#fff8f3';
    }

    // Realization % bar (company total)
    const realPctCell = coRealPct > 0
      ? `<div style="display:flex;flex-direction:column;gap:2px">
           <span style="font-size:11.5px;font-weight:700;color:${realColor(coRealPct)}">${(coRealPct*100).toFixed(1)}%</span>
           <div class="u-trk" style="width:70px"><div class="u-fill" style="width:${Math.min(coRealPct*100,100)}%;background:${realFill(coRealPct)}"></div></div>
         </div>`
      : `<span style="font-size:10px;color:var(--txt3);font-style:italic">${ra && !ra.cargoArrived ? 'Pending arrival' : '—'}</span>`;

    // ── Company header row ──────────────────────────────────────────────
    // Product cell: if multi-product show badge count + primary product dots
    const prodSummary = isMulti
      ? `<div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap">
           ${prods.map(r => `<span style="display:inline-flex;align-items:center;gap:3px;font-size:10.5px;font-weight:600">
             <span style="width:7px;height:7px;border-radius:2px;background:${ouPC(r.product).solid};flex-shrink:0"></span>${r.product}
           </span>`).join('<span style="color:var(--border2);margin:0 2px">·</span>')}
           <span style="font-size:9px;font-weight:700;padding:1px 5px;border-radius:3px;background:var(--blue-bg);color:var(--blue);border:1px solid var(--blue-bd)">${prods.length} products</span>
         </div>`
      : `<span style="display:inline-flex;align-items:center;gap:5px">
           <span style="width:8px;height:8px;border-radius:2px;background:${ouPC(prods[0].product).solid};flex-shrink:0"></span>
           <span style="font-size:11.5px">${prods[0].product}</span>
         </span>`;

    html += `<tr style="cursor:pointer;${rowBg};border-top:2px solid var(--border2)" onclick="openDrawer('${code}')">
      <td style="border-left:3px solid ${ra && ra.cargoArrived ? 'var(--green-lt)' : ra ? 'var(--orange)' : 'var(--border2)'}">
        <span class="t-code">${code}</span>
        ${isMulti ? `<div style="font-size:9px;color:var(--txt3);margin-top:1px">${prods.length} products</div>` : ''}
      </td>
      <td>${prodSummary}</td>
      <td class="t-r t-mono" style="font-weight:700">${Nmt(coObtained)}</td>
      <td class="t-r t-mono" style="color:var(--blue);font-weight:700">${coUtilized > 0 ? Nmt(coUtilized) : '<span style="color:var(--txt3)">—</span>'}</td>
      <td class="t-r t-mono" style="color:${coRealMT > 0 ? 'var(--green)' : 'var(--txt3)'};font-weight:700">${coRealMT > 0 ? coRealMT.toLocaleString() : '—'}</td>
      <td>${realPctCell}</td>
      <td>${etaHTML}</td>
      <td>${shipBadge}</td>
    </tr>`;

    // ── Sub-rows for each product (only when multi-product) ──────────────
    // Per-product realization: use realizationByProd if present, else proportional split
    const coRBP = coSPIrec ? (coSPIrec.realizationByProd || {}) : {};
    const hasRBP = Object.keys(coRBP).length > 0;

    if (isMulti) {
      prods.forEach(r => {
        // Use realizationByProd for exact per-product realization (e.g. GKL ERW lots)
        // Fall back to proportional split of ra.berat when not available
        const prodRealMT = ra && ra.cargoArrived
          ? (hasRBP
              ? (coRBP[r.product] || 0)
              : (coObtained > 0 ? Math.round(ra.berat * (r.obtained / coObtained) * 10) / 10 : 0))
          : 0;
        const prodRealPct = r.obtained > 0 ? prodRealMT / r.obtained : 0;

        // Per-product util from utilizationByProd (same source as Shipment & Realization Monitoring)
        const prodUtil    = coUBP[r.product] || 0;
        const subUtilCell = prodUtil > 0
          ? `<span style="font-size:11.5px;font-weight:600;color:var(--blue)">${Nmt(prodUtil)}</span>`
          : `<span style="font-size:10px;color:var(--txt3)">—</span>`;

        const subRealCell = prodRealMT > 0
          ? `<span style="font-size:11.5px;font-weight:600;color:var(--green)">${prodRealMT.toLocaleString()}</span>`
          : `<span style="font-size:10px;color:var(--txt3);font-style:italic">—</span>`;

        html += `<tr style="cursor:pointer;${rowBg}" onclick="openDrawer('${code}')">
          <td style="border-left:3px solid var(--border);padding:3px 8px">
            <span style="font-size:10.5px;color:var(--txt3);padding-left:8px">↳</span>
          </td>
          <td style="padding:3px 8px">
            <span style="display:inline-flex;align-items:center;gap:5px;padding-left:14px">
              <span style="width:7px;height:7px;border-radius:50%;background:${ouPC(r.product).solid};flex-shrink:0"></span>
              <span style="font-size:11.5px;color:var(--txt2)">${r.product}</span>
            </span>
          </td>
          <td class="t-r t-mono" style="font-size:11.5px;color:var(--txt2)">${Nmt(r.obtained)}</td>
          <td class="t-r" style="padding:3px 8px">${subUtilCell}</td>
          <td class="t-r" style="padding:3px 8px">${subRealCell}</td>
          <td style="padding:3px 8px"><span style="font-size:10px;color:var(--txt3)">↑ see above</span></td>
          <td style="padding:3px 8px"><span style="font-size:10px;color:var(--txt3)">↑ same</span></td>
          <td></td>
        </tr>`;
      });
    }
  });

  tbody.innerHTML = html || `<tr><td colspan="8" style="padding:20px;text-align:center;color:var(--txt3);font-size:12px">No data matching current filters.</td></tr>`;
}

/** Build the condensed Obtain vs Util chart on the Overview page (with filter support) */
function buildOUChartOverview() {
  const allRecords = buildOUData();

  // Apply status filter
  let filtered = [...allRecords];
  if (ouOvStatusMode === 'NORMAL')  filtered = filtered.filter(r => r.leadStatus === 'normal');
  if (ouOvStatusMode === 'OVERDUE') filtered = filtered.filter(r => r.leadStatus === 'overdue');

  // Apply grouping mode
  let labels, obtData, utilData, remainData, overdueFlags, productKeys, tooltipSource;

  if (ouOvFilterMode === 'PROD') {
    const agg = aggregateOU(filtered, 'product');
    labels       = agg.map(r => r.label);
    obtData      = agg.map(r => r.obtained);
    utilData     = agg.map(r => r.utilized);
    remainData   = agg.map(r => r.remaining);
    overdueFlags = agg.map(r => r.overdue > 0);
    productKeys  = agg.map(r => r.label);
    tooltipSource = agg;
  } else if (ouOvFilterMode === 'CO') {
    const agg = aggregateOU(filtered, 'company');
    labels       = agg.map(r => r.label);
    obtData      = agg.map(r => r.obtained);
    utilData     = agg.map(r => r.utilized);
    remainData   = agg.map(r => r.remaining);
    overdueFlags = agg.map(r => r.overdue > 0);
    productKeys  = agg.map(r => {
      const recs = filtered.filter(x => x.code === r.label);
      return recs.length ? recs[0].product : '';
    });
    tooltipSource = agg;
  } else {
    const sorted = [...filtered].sort((a, b) => {
      if (a.product !== b.product) return a.product.localeCompare(b.product);
      return b.obtained - a.obtained;
    });
    labels       = sorted.map(r => `${r.code} · ${r.product.split(' ')[0]}`);
    obtData      = sorted.map(r => r.obtained);
    utilData     = sorted.map(r => r.utilized);
    remainData   = sorted.map(r => r.remaining);
    overdueFlags = sorted.map(r => r.leadStatus === 'overdue');
    productKeys  = sorted.map(r => r.product);
    tooltipSource = sorted;
  }

  // Legend
  const allProds = [...new Set(allRecords.map(r => r.product))];
  const legendEl = document.getElementById('ouOverviewLegend');
  if (legendEl) legendEl.innerHTML = buildOULegend(allProds);

  const utilColors   = productKeys.map((p, i) => overdueFlags[i] ? '#dc2626' : ouPC(p).solid);
  const remainColors = productKeys.map(p => ouPC(p).light);

  mkChart('obtainUtilChartOverview', {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Utilized (MT)',  data: utilData,   backgroundColor: utilColors,   borderRadius: 0, stack: 'ou', order: 1 },
        { label: 'Remaining (MT)', data: remainData, backgroundColor: remainColors, borderColor: productKeys.map(p => ouPC(p).border), borderWidth: 1, borderRadius: 3, stack: 'ou', order: 1 },
        { label: 'Obtained (MT)',  data: obtData,    type: 'line', borderColor: 'rgba(24,38,68,.5)', borderWidth: 1.5, borderDash: [4,3], pointRadius: 2, fill: false, stack: undefined, order: 0 },
      ]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { labels: { font: { size: 10, family: 'DM Sans' }, color: '#64748b', boxWidth: 9, padding: 9 } },
        tooltip: {
          mode: 'index', intersect: false,
          callbacks: {
            title: ctx => {
              const r = tooltipSource[ctx[0].dataIndex];
              return r ? (r.code ? `${r.code} · ${r.product}` : r.label) : labels[ctx[0].dataIndex];
            },
            label: ctx => {
              const i = ctx.dataIndex;
              if (ctx.dataset.label.startsWith('Obtained'))  return ` Obtained: ${obtData[i].toLocaleString()} MT`;
              if (ctx.dataset.label.startsWith('Utilized'))  return ` Utilized: ${utilData[i].toLocaleString()} MT`;
              if (ctx.dataset.label.startsWith('Remaining')) return ` Remaining: ${remainData[i].toLocaleString()} MT`;
              return null;
            },
            afterBody: ctx => {
              const r = tooltipSource[ctx[0].dataIndex];
              if (!r || !r.leadStatus) return [];
              const status = r.leadStatus === 'overdue'
                ? `⚠ Revision — ${r.leadDays}d (>${OU_LEAD_STD}d limit)`
                : r.leadDays !== null ? `✓ Normal — ${r.leadDays}d` : '— No PERTEK date';
              return ['', `Lead Time: ${status}`, `Product: ${ouPC(r.product||r.label).label}`];
            }
          }
        }
      },
      scales: {
        x: { stacked: true, grid: { display: false }, ticks: { font: { size: 8.5, family: 'DM Sans' }, color: '#64748b', maxRotation: 40 } },
        y: { stacked: true, grid: { color: '#f1f5f9' }, ticks: { font: { size: 9.5 }, color: '#64748b', callback: v => v.toLocaleString() } }
      },
      onClick: (e, els) => {
        if (!els.length) return;
        const r = tooltipSource[els[0].index];
        if (r && r.code) openDrawer(r.code);
      }
    }
  });
}

/** Update the Obtain vs Utilization lead time insight card on Overview */
function updateOUOverviewKPIs() {
  const records   = buildOUData();
  const nearLimit = records.filter(r => r.leadDays !== null && r.leadDays > 10 && r.leadDays <= OU_LEAD_STD);
  const overdue   = records.filter(r => r.leadStatus === 'overdue');

  const ico    = document.getElementById('ouInsightIco');
  const lbl    = document.getElementById('ouInsightLbl');
  const val    = document.getElementById('ouInsightVal');
  const sub    = document.getElementById('ouInsightSub');
  const accent = document.getElementById('ouInsightAccent');
  const card   = document.getElementById('ouLeadTimeInsight');

  if (!val) return;

  // Always show both counts
  const overdueCount   = overdue.length;
  const nearCount      = nearLimit.length;

  if (overdueCount > 0) {
    if (ico)    ico.textContent = '⚠';
    if (lbl)    { lbl.textContent = 'Obtain vs Utilization'; lbl.style.color = 'var(--red2)'; }
    if (val)    val.innerHTML   =
      `<span style="color:var(--red2);font-weight:800">${overdueCount} Overdue</span>` +
      (nearCount > 0 ? ` · <span style="color:var(--amber);font-weight:700">${nearCount} Near limit</span>` : '');
    if (sub)    sub.textContent = `>${OU_LEAD_STD}d without utilization · 14-day standard`;
    if (accent) accent.style.background = 'var(--red-lt)';
    if (card)   { card.style.borderColor = 'var(--red-bd)'; card.style.background = '#fff8f8'; }
  } else if (nearCount > 0) {
    if (ico)    ico.textContent = '⏱';
    if (lbl)    { lbl.textContent = 'Obtain vs Utilization'; lbl.style.color = 'var(--amber)'; }
    if (val)    val.innerHTML   =
      `<span style="color:var(--amber);font-weight:800">${nearCount} Near limit</span>` +
      ` · <span style="color:var(--green);font-weight:700">0 Overdue</span>`;
    if (sub)    sub.textContent = `10–14 days lead time · monitor closely`;
    if (accent) accent.style.background = 'linear-gradient(90deg,var(--amber-lt),var(--green-lt))';
    if (card)   { card.style.borderColor = 'var(--amber-bd)'; card.style.background = '#fffcf0'; }
  } else {
    if (ico)    ico.textContent = '✅';
    if (lbl)    { lbl.textContent = 'Obtain vs Utilization'; lbl.style.color = 'var(--green)'; }
    if (val)    val.innerHTML   = `<span style="color:var(--green);font-weight:800">All On Track</span>`;
    if (sub)    sub.textContent = `${records.filter(r=>r.leadStatus==='normal').length} products within 14-day standard`;
    if (accent) accent.style.background = 'var(--green-lt)';
    if (card)   { card.style.borderColor = 'var(--green-bd)'; card.style.background = '#f0fdf4'; }
  }
}

/* ── Lead Time Drill Modal ── */
let ltDrillTabMode = 'ALL';

function setLtDrillTab(mode, el) {
  ltDrillTabMode = mode;
  document.querySelectorAll('#leadTimeDrillModal .fpill').forEach(x => x.classList.remove('on'));
  el.classList.add('on');
  renderLtDrillTable();
}

function openLeadTimeDrill() {
  const modal = document.getElementById('leadTimeDrillModal');
  if (!modal) return;
  ltDrillTabMode = 'ALL';
  // Reset tab buttons
  document.querySelectorAll('#leadTimeDrillModal .fpill').forEach(x => x.classList.remove('on'));
  const allBtn = document.getElementById('ltDrillTabAll');
  if (allBtn) allBtn.classList.add('on');
  refreshLtDrillModal();
  modal.style.display = 'block';
}

function closeLeadTimeDrill() {
  const modal = document.getElementById('leadTimeDrillModal');
  if (modal) modal.style.display = 'none';
}

function refreshLtDrillModal() {
  const records   = buildOUData();
  const nearLimit = records.filter(r => r.leadDays !== null && r.leadDays > 10 && r.leadDays <= OU_LEAD_STD);
  const overdue   = records.filter(r => r.leadStatus === 'overdue');
  const normal    = records.filter(r => r.leadStatus === 'normal' && !(r.leadDays > 10));

  // subtitle
  const sub = document.getElementById('ltDrillSubtitle');
  if (sub) sub.textContent = `${records.length} company–product pairs · ${overdue.length} overdue · ${nearLimit.length} near limit · ${normal.length} normal`;

  // KPI strip — compact, horizontal
  const strip = document.getElementById('ltDrillSummary');
  if (strip) strip.innerHTML = `
    <div style="display:flex;border-bottom:1px solid var(--border)">
      <div style="flex:1;padding:10px 18px;border-right:1px solid var(--border);background:#fef2f2">
        <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#dc2626">⚠ Overdue</div>
        <div style="font-size:22px;font-weight:800;color:#dc2626;line-height:1.2">${overdue.length}</div>
        <div style="font-size:10px;color:var(--txt3)">companies &gt;14 days</div>
      </div>
      <div style="flex:1;padding:10px 18px;border-right:1px solid var(--border);background:#fffbeb">
        <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--amber)">⏱ Near Limit</div>
        <div style="font-size:22px;font-weight:800;color:var(--amber);line-height:1.2">${nearLimit.length}</div>
        <div style="font-size:10px;color:var(--txt3)">companies 10–14 days</div>
      </div>
      <div style="flex:1;padding:10px 18px;border-right:1px solid var(--border);background:var(--green-bg)">
        <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--green)">✓ Normal</div>
        <div style="font-size:22px;font-weight:800;color:var(--green);line-height:1.2">${normal.length}</div>
        <div style="font-size:10px;color:var(--txt3)">companies ≤14 days</div>
      </div>
      <div style="flex:1;padding:10px 18px;">
        <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--txt3)">Standard</div>
        <div style="font-size:22px;font-weight:800;color:var(--navy);line-height:1.2">14d</div>
        <div style="font-size:10px;color:var(--txt3)">PERTEK → First Util</div>
      </div>
    </div>`;

  renderLtDrillTable();
}

function renderLtDrillTable() {
  const records = buildOUData();
  let rows = [...records].sort((a, b) => {
    const order = r => r.leadStatus === 'overdue' ? 0 : (r.leadDays > 10) ? 1 : 2;
    const diff = order(a) - order(b);
    return diff !== 0 ? diff : (b.leadDays || 0) - (a.leadDays || 0);
  });

  if (ltDrillTabMode === 'OVERDUE') rows = rows.filter(r => r.leadStatus === 'overdue');
  else if (ltDrillTabMode === 'NEAR')   rows = rows.filter(r => r.leadDays !== null && r.leadDays > 10 && r.leadDays <= OU_LEAD_STD);
  else if (ltDrillTabMode === 'NORMAL') rows = rows.filter(r => r.leadStatus === 'normal' && !(r.leadDays > 10));

  const tbody = document.getElementById('ltDrillBody');
  if (!tbody) return;

  tbody.innerHTML = rows.map(r => {
    const isOverdue = r.leadStatus === 'overdue';
    const isNear    = r.leadDays !== null && r.leadDays > 10 && r.leadDays <= OU_LEAD_STD;
    const rowBg     = isOverdue ? 'background:#fff8f8' : isNear ? 'background:#fffcf0' : '';
    const leftBd    = isOverdue ? 'border-left:3px solid #dc2626' : isNear ? 'border-left:3px solid var(--amber-lt)' : 'border-left:3px solid transparent';
    const c         = ouPC(r.product);
    const utilPct   = r.obtained > 0 ? Math.round(r.utilized / r.obtained * 100) : 0;

    // Status badge
    let badge;
    if (isOverdue) badge = `<span style="display:inline-flex;align-items:center;gap:4px;font-size:10px;font-weight:700;padding:3px 10px;border-radius:4px;background:#fef2f2;color:#dc2626;border:1px solid #fecaca">⚠ Overdue</span>`;
    else if (isNear) badge = `<span style="display:inline-flex;align-items:center;gap:4px;font-size:10px;font-weight:700;padding:3px 10px;border-radius:4px;background:#fffbeb;color:var(--amber);border:1px solid #fde68a">⏱ Near Limit</span>`;
    else badge = `<span style="display:inline-flex;align-items:center;gap:4px;font-size:10px;font-weight:700;padding:3px 10px;border-radius:4px;background:var(--green-bg);color:var(--green);border:1px solid var(--green-bd)">✓ Normal</span>`;

    // % util bar
    const barColor = isOverdue ? '#dc2626' : isNear ? '#d97706' : c.solid;
    const utilBar  = `<div style="display:flex;align-items:center;gap:6px">
      <div style="flex:1;height:7px;background:#e2e8f0;border-radius:4px;min-width:50px">
        <div style="width:${Math.min(100,utilPct)}%;height:100%;background:${barColor};border-radius:4px"></div>
      </div>
      <span style="font-size:11.5px;font-weight:700;color:${barColor};white-space:nowrap;min-width:34px;text-align:right">${utilPct}%</span>
    </div>`;

    return `<tr style="${rowBg}" onclick="closeLeadTimeDrill();openDrawer('${r.code}')" style="cursor:pointer" title="Click to open ${r.code}">
      <td style="padding:10px 14px;${leftBd};cursor:pointer">
        <span style="font-weight:700;font-size:13px;color:var(--blue)">${r.code}</span>
      </td>
      <td style="padding:10px 10px">
        <span style="display:inline-flex;align-items:center;gap:5px">
          <span style="width:9px;height:9px;border-radius:2px;background:${c.solid};flex-shrink:0"></span>
          <span style="font-size:12px;font-weight:600;color:var(--txt)">${r.product}</span>
        </span>
      </td>
      <td style="padding:10px 10px;text-align:right;font-family:'DM Mono',monospace;font-size:12px;color:var(--txt2)">${r.obtained.toLocaleString()} MT</td>
      <td style="padding:10px 10px;text-align:right;font-family:'DM Mono',monospace;font-size:12px;font-weight:600;color:${c.solid}">${r.utilized > 0 ? r.utilized.toLocaleString() + ' MT' : '<span style="color:var(--txt3)">— MT</span>'}</td>
      <td style="padding:10px 14px;min-width:130px">${utilBar}</td>
      <td style="padding:10px 14px;text-align:center">${badge}</td>
    </tr>`;
  }).join('');

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="padding:28px;text-align:center;color:var(--txt3);font-size:12px">No records for this filter.</td></tr>`;
  }
}

/* ════════════════════════════════════════════════════════════════
   SALES PRIORITY ANALYSIS ENGINE
   Determines which company/product to sell first based on:
   - Single-product PERTEK (highest impact on re-apply speed)
   - Remaining quota < 20% (near finish — urgency to close)
   - Re-apply eligible (≥ 60% realization)
   - Near eligible (50–60%)
   - Lead time status (overdue = pressure)
   Outputs ranked list with urgency score + plain-English recommendation
════════════════════════════════════════════════════════════════ */

let spTabMode = 'ALL';