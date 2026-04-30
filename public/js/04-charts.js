/* ═══════════════════════════════════════
   CHARTS — Pipeline, Donut, Quota, Gauge…
   Also: revisionStatus, statusBadge, N helper
═══════════════════════════════════════ */

const N = n => n != null ? Number(n).toLocaleString() : '—';
const chips = prods => prods.map(p => `<span class="chip" style="background:${pc(p).light};color:${pc(p).text}">${p}</span>`).join('');

/* ── REVISION STATUS LOGIC ─────────────────────────────────────
   revType='active'   → Under Revision (no PERTEK yet)
   revType='complete' → two sub-states based on SPI issuance:
     PENDING  : PERTEK Terbit / PERTEK Perubahan Terbit issued,
                SPI / SPI Perubahan NOT yet issued
     COMPLETE : PERTEK issued AND SPI / SPI Perubahan also issued

   Detection: SPI issued when spiRef contains 'SPI TERBIT'
              OR revStatus contains 'SPI TERBIT' or 'SPI Perubahan Terbit'

   Current data (04 Mar 2026):
     BTS  → spiRef:'PERTEK TERBIT 25/02/26'         → SPI belum → PENDING
     DIOR → spiRef:'PERTEK TERBIT 3/12/25'           → SPI belum → PENDING
     GIS  → spiRef:'PERTEK TERBIT 01/03/26'          → SPI belum → PENDING
     SMS  → spiRef:'PERTEK TERBIT 26/02/26'          → SPI belum → PENDING
     MJU  → spiRef:'SPI TERBIT 05/01/26'             → SPI terbit → COMPLETE
──────────────────────────────────────────────────────────────── */
function revisionStatus(d) {
  if (d.revType === 'none')   return 'clean';
  if (d.revType === 'active') {
    // Distinguish Re-Apply (Submit #2 — additional quota) from Revision (product/tonnage change)
    const hasSubmit2 = (d.cycles||[]).some(c => /^submit\s*#[2-9]/i.test(c.type));
    const baseStatus = hasSubmit2 ? 'reapply' : 'active';
    // If approval stage indicates PERTEK already issued → move to 'revpending' (Pending tab)
    const pendingStages = /pertek terbit|submit spi|proses pengiriman|penerimaan permohonan|verifikasi permohonan|penelitian|spi terbit/i;
    const stageIsPending =
      (d.revStatus && pendingStages.test(d.revStatus)) ||
      (d.revNote   && pendingStages.test(d.revNote));
    if (stageIsPending) return 'revpending';
    return baseStatus;
  }
  // revType='complete': PERTEK already issued — check if SPI also issued

  // Explicit override: if revStatus/spiRef says 'SPI Perubahan belum terbit' → PENDING
  const explicitPending =
    (d.revStatus && d.revStatus.includes('SPI Perubahan belum')) ||
    (d.spiRef    && d.spiRef.includes('SPI Perubahan belum'));
  if (explicitPending) return 'revpending';

  // ── NEW: SPI NO. field is populated + statusUpdate says SPI Terbit → Completed
  // This covers BTS/GIS/SMS type: PERTEK complete, SPI issued, statusUpdate='SPI Terbit'
  const spiNoFilled    = d.spiNo && d.spiNo.trim() !== '';
  const statusIsSPI    = d.statusUpdate && /spi\s*terbit/i.test(d.statusUpdate);
  if (spiNoFilled && statusIsSPI) return 'completed';

  // ── Also completed if spiNo filled regardless (SPI issued = done)
  // Only if revStatus does not explicitly say pending
  if (spiNoFilled && !explicitPending) return 'completed';

  // SPI Perubahan issued via spiRef or revStatus text
  const spiPerubahanIssued =
    (d.spiRef    && d.spiRef.includes('SPI Perubahan Terbit')) ||
    (d.revStatus && d.revStatus.includes('SPI Perubahan Terbit')) ||
    (d.revStatus && d.revStatus.startsWith('✅ Done'));

  // Special case: companies that went via Pertek route (no separate SPI Perubahan)
  const hasPertekOnly =
    d.spiRef && d.spiRef.includes('PERTEK TERBIT') &&
    !d.spiRef.includes('SPI TERBIT') && !d.spiRef.includes('SPI Perubahan');
  if (hasPertekOnly) return 'revpending';

  return spiPerubahanIssued ? 'completed' : 'revpending';
}

function statusBadge(d) {
  const rs = revisionStatus(d);
  if (rs === 'reapply')    return '<span class="badge b-reapply">📨 Re-Apply Submit #2</span>';
  if (rs === 'active')     return '<span class="badge b-rev">🔄 Under Revision</span>';
  if (rs === 'revpending') return '<span class="badge b-revpending">⏳ PENDING — PERTEK Terbit, SPI Belum</span>';
  if (rs === 'completed')  return '<span class="badge b-revdone">✅ COMPLETE — SPI Terbit</span>';
  if (d.spiRef && d.spiRef.includes('PERTEK TERBIT')) return '<span class="badge b-pertek">✓ Pertek</span>';
  return '<span class="badge b-spi">✅ SPI Issued</span>';
}

/* ══════════════════════════════════════════════════
   CHARTS
══════════════════════════════════════════════════ */
const CH = {};
function mkChart(id, cfg) {
  if (CH[id]) { CH[id].destroy(); CH[id] = null; }
  const el = document.getElementById(id);
  if (!el) return null;
  CH[id] = new Chart(el, cfg);
  return CH[id];
}

/* PIPELINE — hover shows company list */
function buildPipeline() {
  const spiPool = filteredSPI();
  const raMap   = {}; RA.forEach(r => { raMap[r.code] = r; });

  // Re-Apply Eligible = companies with cargoArrived AND realPct ≥ 60%
  // (includes both "eligible" and "already submitted" — what matters is realization)
  const reapplyPool = RA.filter(r => r.cargoArrived === true && r.realPct >= 0.6);
  const reapplyMT   = reapplyPool.reduce((s,r) => s + (r.obtained||0), 0);
  const reapplyN    = reapplyPool.length;

  // Update pipeline sidebar stats dynamically — use canonicalObtained for accuracy
  const _pipeObt = co => (typeof canonicalObtained==='function') ? canonicalObtained(co) : (co.obtained||0);
  const ps = document.getElementById('pipelineSpiStat');
  if (ps) ps.textContent = `${spiPool.reduce((s,d)=>s+_pipeObt(d),0).toLocaleString()} MT · ${spiPool.length} co.`;
  const pr = document.getElementById('pipelineReapplyStat');
  if (pr) pr.textContent = `${reapplyN} co.`;

  mkChart('pipelineChart', {
    type: 'doughnut',
    data: {
      labels: [
        `SPI / PERTEK Obtained (${spiPool.length})`,
        `Re-Apply Eligible (${reapplyN})`,
        `Pertek Pending (${filteredPending().length})`
      ],
      datasets: [{ data: [
        spiPool.reduce((s,d)=>s+_pipeObt(d),0),
        reapplyMT,
        filteredPending().reduce((s,d)=>s+d.mt,0)
      ], backgroundColor: ['#0c7c84','#8b5cf6','#dc2626'], borderColor:'#fff', borderWidth:3, hoverOffset:6 }]
    },
    options: {
      cutout: '64%',
      plugins: {
        legend: { display: false },
        tooltip: { enabled: false }
      },
      onHover: (e, els) => {
        const h = document.getElementById('pipelineHover');
        if (!els.length) { h.classList.remove('show'); return; }
        buildPipelineHover(els[0].index);
        h.classList.add('show');
      },
      onClick: (e, els) => {
        if (!els.length) return;
        const idx = els[0].index;
        if (idx===0) navFilter('SPI');
        else if (idx===1) goPage('utilization',document.querySelectorAll('.nav-tab')[2]);
        else navFilter('PENDING');
      }
    }
  });
}

function buildPipelineHover(idx) {
  const h = document.getElementById('pipelineHover');
  if (idx === 0) {
    const sorted = [...filteredSPI()].sort((a,b) => b.obtained - a.obtained);
    h.innerHTML = `<div class="ph-title">✅ SPI / PERTEK Obtained — ${sorted.length} companies</div>` +
      sorted.map(d => `<div class="ph-row"><span class="ph-code">${d.code}</span><span class="ph-mt">${d.obtained.toLocaleString()} MT</span></div>`).join('');
  } else if (idx === 1) {
    // Re-Apply Eligible = companies with cargoArrived AND realPct ≥ 60%
    const eligible = RA.filter(r => r.cargoArrived === true && r.realPct >= 0.6)
                       .sort((a,b) => b.realPct - a.realPct);
    h.innerHTML = `<div class="ph-title">🔵 Re-Apply Eligible — ${eligible.length} companies<br><span style="font-weight:400;font-size:10px;color:var(--txt3)">Realization ≥ 60% &amp; cargo arrived</span></div>` +
      eligible.map(r => {
        const stage = isReapplySubmitted(r) ? ' 🔵' : ' ✅';
        return `<div class="ph-row"><span class="ph-code">${r.code}${stage}</span><span class="ph-mt">${(r.realPct*100).toFixed(0)}% · ${r.obtained.toLocaleString()} MT</span></div>`;
      }).join('');
  } else {
    h.innerHTML = `<div class="ph-title">⏳ Pertek Pending — ${filteredPending().length} companies</div>` +
      filteredPending().map(d => `<div class="ph-row"><span class="ph-code">${d.code}</span><span class="ph-mt">${d.mt.toLocaleString()} MT</span></div>`).join('');
  }
}

/* PRODUCT DONUT — solid colors, legend with product + company list */
function buildProductDonut() {
  // Aggregate MT per product across all SPI companies
  const map = {};
  const coMap = {}; // product → [companies]
  filteredSPI().forEach(co => {
    co.products.forEach(p => {
      if (!map[p]) { map[p] = 0; coMap[p] = []; }
      map[p] += co.obtained / co.products.length;
      coMap[p].push(co.code);
    });
  });
  const entries = Object.entries(map).sort((a,b) => b[1]-a[1]);
  const total = entries.reduce((s,[,v]) => s+v, 0);

  mkChart('productDonut', {
    type: 'doughnut',
    data: {
      labels: entries.map(([k]) => k),
      datasets: [{ data: entries.map(([,v]) => Math.round(v)),
        backgroundColor: entries.map(([k]) => pc(k).solid),
        borderColor: '#fff', borderWidth: 2, hoverOffset: 4 }]
    },
    options: {
      cutout: '52%',
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: {
          label: ctx => ` ${ctx.label}: ${ctx.parsed.toLocaleString()} MT (${(ctx.parsed/total*100).toFixed(1)}%)`
        }}
      }
    }
  });

  // Build custom legend
  const leg = document.getElementById('prodLegend');
  leg.innerHTML = entries.map(([k, v]) => {
    const pct = (v / total * 100).toFixed(1);
    return `
    <div class="pl-row" title="${coMap[k].join(', ')}">
      <div class="pl-dot" style="background:${pc(k).solid}"></div>
      <span class="pl-name">${k}</span>
      <span class="pl-mt">${Math.round(v).toLocaleString()} MT</span>
      <span class="pl-pct" style="background:${pc(k).light};color:${pc(k).text}">${pct}%</span>
    </div>
    <div style="padding:0 6px 3px 23px;font-size:9.5px;color:var(--txt3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${coMap[k].slice(0,6).join(', ')}${coMap[k].length>6?'…':''}</div>`;
  }).join('');
}

/* TOP COMPANIES — stripe pattern for AB vs CD group distinction */
function makeStripePattern(baseColor, stripeColor) {
  const c = document.createElement('canvas'); c.width=10; c.height=10;
  const ctx = c.getContext('2d');
  ctx.fillStyle = baseColor; ctx.fillRect(0,0,10,10);
  ctx.strokeStyle = stripeColor; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(0,10); ctx.lineTo(10,0); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-2,2); ctx.lineTo(2,-2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(8,12); ctx.lineTo(12,8); ctx.stroke();
  return ctx.createPattern(c, 'repeat');
}

/* ════════════════════════════════════════════════════════
   AVAILABLE QUOTA BAR CHART
   Source: Excel "Utilization (MT)" and "Available (MT)" dedicated rows per company.
   Rule:   Available = PERTEK Terbit MT (obtained) − Utilization MT
   Case 1 — No revision:   obtained − utilization
   Case 2 — Revision TBA:  original obtained #1 − utilization
                            (revised MT excluded until PERTEK Perubahan issued)
   Case 3 — Submit #2 TBA: obtained #1 − utilization (same rule)
   All 29 companies with PERTEK Terbit shown, including util=0.
═══════════════════════════════════════════════════════ */
function buildAvailableQuota() {
  // Local palette — intentionally different from the canonical pc() in
  // 01-data.js. The AVQ bar chart uses a brighter teal/blue/orange
  // scheme so adjacent product bars are visually distinct from the
  // donut/badges elsewhere on the page. Do not "consolidate" with
  // PRODUCT_META without a UX review.
  const pc = p => {
    const MAP = {
      'GL BORON':'#0c7c84','GI BORON':'#1e56c6','BORDES ALLOY':'#d97706',
      'AS STEEL':'#7c3aed','SHEETPILE':'#059669','SEAMLESS PIPE':'#0d6946',
      'HRC/HRPO ALLOY':'#ca8a04','HOLLOW PIPE':'#78716c',
      'PPGL CARBON':'#7c3aed','ERW PIPE OD≤140mm':'#9333ea','ERW PIPE OD>140mm':'#0891b2',
    };
    for (const k in MAP) if (p && p.toUpperCase().includes(k.toUpperCase())) return MAP[k];
    return '#64748b';
  };

  // Build per-product rows using availableByProd / utilizationByProd (exact Excel values).
  // Multi-product companies (e.g. BTS: BORDES 900 + AS STEEL 900 + SHEETPILE 3200 + SEAMLESS 1000)
  // get ONE ROW PER PRODUCT so that product-filter pills show correct per-product MT.
  const rows = [];
  filteredSPI().forEach(co => {
    // CRITICAL: use canonicalObtained — not raw co.obtained (may include in-process cycles)
    const obtained = (typeof canonicalObtained === 'function' ? canonicalObtained(co) : null)
                     || (typeof co.obtained === 'number' ? co.obtained : 0);
    if (obtained <= 0) return;
    const totalUtil = co.utilizationMT  != null ? co.utilizationMT  : 0;
    // SOURCE OF TRUTH: always use company-level availableQuota (from companies.available_quota).
    // availableByProd is used only for per-product DISPLAY breakdown, NOT for the total.
    const totalAvq  = co.availableQuota != null ? co.availableQuota : (obtained - totalUtil);

    const aProd = co.availableByProd   || {};
    const uProd = co.utilizationByProd || {};

    // Build cycle-level obtained-per-product map (used for display only).
    // Use the deduped helper — legacy DB has duplicate Obtained #N rows
    // (one per product) which would otherwise multiply per-product MT and
    // blow up the chart total (was producing 787,538 vs real 22,870 MT).
    const cycleProds = (typeof getObtainedByProdAgg === 'function')
      ? getObtainedByProdAgg(co)
      : (() => {
          const seen = new Set();
          const out  = {};
          (co.cycles || []).forEach(c => {
            if (!/^obtained\s*#\d/i.test(c.type)) return;
            if (c._fromRevReq) return;
            const k = (c.type || '').toLowerCase().trim();
            if (seen.has(k)) return;
            seen.add(k);
            Object.entries(c.products || {}).forEach(([p, v]) => {
              if (typeof v === 'number' && v > 0) out[p] = (out[p] || 0) + v;
            });
          });
          return out;
        })();

    if (Object.keys(aProd).length > 0) {
      // Per-product breakdown available — use for display.
      // BUT: normalise so that sum of per-product avq == totalAvq (company-level truth).
      const rawSum = Object.values(aProd).reduce((s, v) => s + (typeof v === 'number' ? v : 0), 0);

      Object.entries(aProd).forEach(([prod, avqRaw]) => {
        const utilForProd = uProd[prod] || 0;
        const obtForProd  = cycleProds[prod] || (avqRaw + utilForProd);
        // Normalise per-product avq proportionally to match company-level total
        const avq = rawSum > 0 ? Math.round(totalAvq * avqRaw / rawSum) : 0;
        rows.push({
          code: co.code, product: prod,
          obtained: obtForProd, utilMT: utilForProd, avq,
          updatedBy: co.updatedBy || '', updatedDate: co.updatedDate || '',
        });
      });
      // Correct last product's rounding so sum is exactly totalAvq
      const pushed = rows.filter(r => r.code === co.code && Object.keys(aProd).includes(r.product));
      if (pushed.length > 0) {
        const sumSoFar = pushed.reduce((s, r) => s + r.avq, 0);
        pushed[pushed.length - 1].avq += (totalAvq - sumSoFar);
      }
      // Also add fully-utilized products (avail=0 but had utilization, not in aProd)
      Object.entries(uProd).forEach(([prod, util]) => {
        if (aProd[prod] != null) return;
        const obtForProd = cycleProds[prod] || util;
        rows.push({
          code: co.code, product: prod,
          obtained: obtForProd, utilMT: util, avq: 0,
          updatedBy: co.updatedBy || '', updatedDate: co.updatedDate || '',
        });
      });
    } else {
      // No per-product data — split totalAvq proportionally across cycle products
      const prodEntries = Object.entries(cycleProds);
      if (prodEntries.length > 0) {
        const cycleTotal = prodEntries.reduce((s, [, v]) => s + v, 0);
        let remaining = totalAvq;
        prodEntries.forEach(([prod, mt], i) => {
          const isLast = i === prodEntries.length - 1;
          const share  = isLast ? remaining : (cycleTotal > 0 ? Math.round(totalAvq * mt / cycleTotal) : 0);
          const uShare = cycleTotal > 0 ? Math.round(totalUtil * mt / cycleTotal) : 0;
          remaining -= share;
          rows.push({
            code: co.code, product: prod,
            obtained: mt, utilMT: uShare, avq: share,
            updatedBy: co.updatedBy || '', updatedDate: co.updatedDate || '',
          });
        });
      } else {
        rows.push({
          code: co.code, product: (co.products || [])[0] || '—',
          obtained, utilMT: totalUtil, avq: totalAvq,
          updatedBy: co.updatedBy || '', updatedDate: co.updatedDate || '',
        });
      }
    }
  });

  // Sort A→Z by company code, then by product name
  rows.sort((a, b) => a.code.localeCompare(b.code) || a.product.localeCompare(b.product));

  // KPI totals — sum avq across all product-rows; company count uses unique codes
  const totalAvq = rows.reduce((s, r) => s + r.avq, 0);
  const totalObt = rows.reduce((s, r) => s + r.obtained, 0);
  const uniqueCos = new Set(rows.filter(r => r.avq > 0).map(r => r.code)).size;
  const kpiVal  = document.getElementById('kpiAvqVal');
  const kpiUnit = document.getElementById('kpiAvqUnit');
  const kpiTag  = document.getElementById('kpiAvqTag');
  const kpiFill = document.getElementById('kpiAvqFill');
  if (kpiVal)  kpiVal.textContent  = rows.length > 0 ? totalAvq.toLocaleString() : '—';
  if (kpiUnit) kpiUnit.textContent = `MT · ${uniqueCos} compan${uniqueCos!==1?'ies':'y'} with PERTEK Terbit`;
  if (kpiTag)  kpiTag.textContent  = rows.length > 0
    ? `${totalObt > 0 ? (totalAvq/totalObt*100).toFixed(1) : '—'}% remaining of obtained`
    : 'No SPI data available';
  if (kpiFill && totalObt > 0) kpiFill.style.width = Math.max(0, Math.min(100, totalAvq/totalObt*100)).toFixed(1) + '%';

  // Render bar chart
  const el = document.getElementById('avqChart');
  if (!el) return;

  if (rows.length === 0) {
    el.innerHTML = `<div style="padding:30px;text-align:center;color:var(--txt3);font-size:12px">
      No companies with PERTEK Terbit found in selected period.
    </div>`;
    return;
  }

  // Product filter pills — built from unique products across all rows
  const products = [...new Set(rows.map(r => r.product))].sort();
  const fwEl = document.getElementById('avqFilterWrap');
  if (fwEl && !fwEl._built) {
    fwEl._built = true;
    fwEl._active = 'ALL';
    const makePill = (label, val) => {
      const p = document.createElement('span');
      p.className = 'avq-pill';
      p.style.cssText = `background:${val==='ALL'?'var(--blue)':pc(val)};color:#fff;border:none;opacity:${fwEl._active===val?1:.55}`;
      p.textContent = val === 'ALL' ? 'All Products' : label;
      p.onclick = () => {
        fwEl._active = val;
        fwEl.querySelectorAll('.avq-pill').forEach(pp => pp.style.opacity = '.55');
        p.style.opacity = '1';
        buildAvailableQuota();
      };
      return p;
    };
    fwEl.appendChild(makePill('All', 'ALL'));
    products.forEach(prod => fwEl.appendChild(makePill(prod, prod)));
  }

  const activeFilter = fwEl ? fwEl._active : 'ALL';
  // Filter rows by active product; for ALL show every row
  const filtered = activeFilter === 'ALL' ? rows : rows.filter(r => r.product === activeFilter);

  const maxObt = Math.max(...filtered.map(r => r.obtained), 1);

  // Update total badge
  const badge = document.getElementById('avqTotalBadge');
  if (badge) {
    const filtTotal = filtered.reduce((s,r)=>s+r.avq,0);
    badge.textContent = `Available: ${filtTotal.toLocaleString()} MT`;
  }

  // Build HTML rows
  const hdr = `<div class="avq-hdr">
    <div>Company</div><div>Obtained vs Available</div>
    <div style="text-align:right">Available MT</div>
    <div>Product</div>
  </div>`;

  const barRows = filtered.map(r => {
    const obtW  = (r.obtained / maxObt * 100).toFixed(1);
    const utilW = (r.utilMT   / maxObt * 100).toFixed(1);
    const avqW  = Math.max(0, r.avq / maxObt * 100).toFixed(1);
    const col   = pc(r.product);
    const avqColor = r.avq > 0 ? col : 'var(--red2)';
    const tag = r.updatedBy
      ? `<span class="upd-tag upd-${r.updatedBy.toLowerCase()}" style="font-size:8.5px;padding:1px 5px">${r.updatedBy}</span>`
      : '';
    return `<div class="avq-row" style="margin-bottom:8px" onclick="openDrawer('${r.code}')" title="Click to open ${r.code} detail">
      <div>
        <div class="avq-co">${r.code}</div>
        <div>${tag}</div>
      </div>
      <div>
        <div class="avq-bar-bg" style="position:relative;cursor:pointer" title="${r.code}: Obtained ${r.obtained.toLocaleString()} MT · Used ${r.utilMT.toLocaleString()} MT · Available ${r.avq.toLocaleString()} MT">
          <!-- Obtained (faint background) -->
          <div style="position:absolute;inset:0;background:${col}22;border-radius:5px"></div>
          <!-- Utilized (solid) -->
          <div style="position:absolute;top:0;left:0;height:100%;width:${utilW}%;background:${col};border-radius:5px;opacity:.5"></div>
          <!-- Available (bright right segment) -->
          <div style="position:absolute;top:0;left:${utilW}%;height:100%;width:${avqW}%;background:${avqColor};border-radius:0 5px 5px 0;opacity:${r.avq>0?1:.9}"></div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:9px;color:var(--txt3);margin-top:2px">
          <span>Used: ${r.utilMT.toLocaleString()} MT</span>
          <span>Available: ${r.avq.toLocaleString()} MT</span>
        </div>
      </div>
      <div class="avq-mt" style="color:${avqColor}">${r.avq >= 0 ? r.avq.toLocaleString() : '('+Math.abs(r.avq).toLocaleString()+')'}  MT</div>
      <div class="avq-prod">${r.product}</div>
    </div>`;
  }).join('');

  // ── Total summary row ───────────────────────────────────────────────
  const filtTotalObt  = filtered.reduce((s, r) => s + r.obtained, 0);
  const filtTotalUtil = filtered.reduce((s, r) => s + r.utilMT,   0);
  const filtTotalAvq  = filtered.reduce((s, r) => s + r.avq,      0);
  const totUtilW = filtTotalObt > 0 ? (filtTotalUtil / filtTotalObt * 100).toFixed(1) : 0;
  const totAvqW  = filtTotalObt > 0 ? Math.max(0, filtTotalAvq / filtTotalObt * 100).toFixed(1) : 0;
  const avqTotColor = filtTotalAvq > 0 ? 'var(--blue)' : 'var(--red2)';

  // Per-product breakdown for total row
  const prodTotals = {};
  filtered.forEach(r => { prodTotals[r.product] = (prodTotals[r.product] || 0) + r.avq; });
  const prodSummaryHtml = Object.entries(prodTotals)
    .filter(([, v]) => v > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([prod, mt]) => {
      const col = pc(prod);
      const shortProd = prod.length > 14 ? prod.slice(0, 13) + '\u2026' : prod;
      return `<span style="display:inline-flex;align-items:center;gap:3px;font-size:9px;font-weight:700;` +
        `padding:1px 6px;border-radius:3px;background:${col}18;color:${col};border:1px solid ${col}44;white-space:nowrap">` +
        `<span style="width:5px;height:5px;border-radius:50%;background:${col};display:inline-block;flex-shrink:0"></span>` +
        `${shortProd}: ${mt.toLocaleString()} MT` +
        `</span>`;
    }).join('');

  const totalRow = `
    <div style="margin-top:10px;padding-top:10px;border-top:2px solid var(--border2)">
      <div class="avq-row" style="background:var(--bg2);border-radius:8px;padding:8px 6px;border:1px solid var(--border2)">
        <div>
          <div class="avq-co" style="color:var(--navy);font-size:13px;font-weight:800">TOTAL</div>
          <div style="font-size:9px;color:var(--txt3);margin-top:2px">${new Set(filtered.map(r=>r.code)).size} companies</div>
        </div>
        <div>
          <div class="avq-bar-bg" style="position:relative">
            <div style="position:absolute;inset:0;background:var(--navy)22;border-radius:5px"></div>
            <div style="position:absolute;top:0;left:0;height:100%;width:${totUtilW}%;background:var(--navy);border-radius:5px;opacity:.4"></div>
            <div style="position:absolute;top:0;left:${totUtilW}%;height:100%;width:${totAvqW}%;background:${avqTotColor};border-radius:0 5px 5px 0"></div>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:9px;color:var(--txt3);margin-top:3px">
            <span>Used: <strong style="color:var(--navy)">${filtTotalUtil.toLocaleString()} MT</strong></span>
            <span>Available: <strong style="color:${avqTotColor}">${filtTotalAvq.toLocaleString()} MT</strong></span>
          </div>
          <div style="margin-top:5px;display:flex;flex-wrap:wrap;gap:4px">${prodSummaryHtml}</div>
        </div>
        <div class="avq-mt" style="color:${avqTotColor};font-size:16px;font-weight:800">${filtTotalAvq.toLocaleString()} MT</div>
        <div class="avq-prod" style="font-size:9.5px;color:var(--txt3);line-height:1.6">
          Obtained<br><strong style="color:var(--navy);font-size:11px">${filtTotalObt.toLocaleString()}</strong>
        </div>
      </div>
    </div>`;

  el.innerHTML = hdr + '<div class="avq-wrap">' + barRows + totalRow + '</div>';
}

function buildTopCo() {
  const canvas = document.getElementById('topCoChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  /* ── AB/CD colour palette ─────────────────────────────────────────────
     Group AB → solid teal (#0c7c84)
     Group CD → diagonal-stripe pattern (teal base, dark-teal stripes)
     Status tints: normal / revision active (amber) / revision complete (purple)
  ──────────────────────────────────────────────────────────────────────── */
  const PALETTE = {
    AB: { base:'#0c7c84', border:'#0f766e',
          rev_active:   { base:'#d97706', border:'#b45309' },
          rev_complete: { base:'#7c3aed', border:'#6d28d9' },
          reapply:      { base:'#8b5cf6', border:'#7c3aed' } },
    CD: { base:'#0e9c9c', stripe:'#065b5b', border:'#0d9488',
          rev_active:   { base:'#fbbf24', stripe:'#92400e', border:'#f59e0b' },
          rev_complete: { base:'#a78bfa', stripe:'#4c1d95', border:'#8b5cf6' },
          reapply:      { base:'#c4b5fd', stripe:'#4c1d95', border:'#8b5cf6' } },
  };

  /* ── Resolve bar color for a company ────────────────────────────────── */
  const getBarColor = co => {
    const grp = co.group === 'CD' ? 'CD' : 'AB';
    let variant;
    if (co.revType === 'active')    variant = 'rev_active';
    else if (co.revType === 'complete') variant = 'rev_complete';
    const ra = getRA(co.code);
    if (!variant && ra && isReapplySubmitted(ra)) variant = 'reapply';

    if (grp === 'CD') {
      const p = variant ? PALETTE.CD[variant] : PALETTE.CD;
      return { bg: makeStripePattern(p.base, p.stripe || PALETTE.CD.stripe), border: p.border };
    } else {
      const p = variant ? PALETTE.AB[variant] : PALETTE.AB;
      return { bg: p.base, border: p.border };
    }
  };

  /* ── Per-company obtained MT filtered by PERTEK Terbit date ─────────── */
  const getObtainedForPeriod = co => {
    // Only count Obtained #N (non-revision) cycles — consistent with KPI2.
    const allCycles = co.cycles || [];
    let total = 0;
    allCycles.forEach(c => {
      if (!/^obtained #/i.test(c.type)) return;
      const mt = typeof c.mt === 'number' ? c.mt : 0;
      if (mt <= 0) return;
      const pertekTerbit = getPertekTerbitForObtained(c, allCycles);
      if (!PERIOD.active || inPd(pertekTerbit)) total += mt;
    });
    return total;
  };

  /* ── Build sorted dataset ─────────────────────────────────────────────
     Only companies visible in filteredSPI() (which does broad company-level
     period match), then further filter to those with >0 obtained in period.
  ──────────────────────────────────────────────────────────────────────── */
  const dataset = filteredSPI()
    .map(co => ({
      ...co,
      periodObtained: getObtainedForPeriod(co),
    }))
    .filter(co => co.periodObtained > 0)
    .sort((a, b) => a.code.localeCompare(b.code))
    .slice(0, 15);

  if (!dataset.length) return;

  const colors  = dataset.map(co => getBarColor(co));
  const bgArr   = colors.map(c => c.bg);
  const bdrArr  = colors.map(c => c.border);

  mkChart('topCoChart', {
    type: 'bar',
    data: {
      labels: dataset.map(d => d.code),
      datasets: [{
        label: 'Obtained (MT)',
        data: dataset.map(d => d.periodObtained),
        backgroundColor: bgArr,
        borderColor: bdrArr,
        borderWidth: 1.5,
        borderRadius: 4,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: 4, right: 10 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: ctx2 => {
              const co = dataset[ctx2[0].dataIndex];
              const grpLabel = `Group ${co.group}`;
              return `${co.code}  [${grpLabel}]  —  ${co.periodObtained.toLocaleString()} MT`;
            },
            label: ctx2 => {
              const co = dataset[ctx2.dataIndex];
              const ra = getRA(co.code);
              const lines = [`  Group: ${co.group} (${co.group==='CD'?'Striped':'Solid'})`];
              co.products.forEach(p => lines.push(`  • ${p}`));
              if (co.revType === 'active')    lines.push(`  ⚠ Revision Active`);
              if (co.revType === 'complete')  lines.push(`  ✓ Revision Complete`);
              if (ra && isReapplySubmitted(ra)) lines.push(`  🔵 Re-Apply Submitted`);
              if (ra && ra.cargoArrived) lines.push(`  Realization: ${(ra.realPct*100).toFixed(0)}%`);
              else if (ra && ra.utilPct) lines.push(`  Utilization: ${(ra.utilPct*100).toFixed(0)}%`);
              if (PERIOD.active && co.obtained !== co.periodObtained)
                lines.push(`  (All-time total: ${co.obtained.toLocaleString()} MT)`);
              return lines;
            }
          }
        }
      },
      scales: {
        x: { grid:{display:false}, ticks:{font:{size:10.5,family:'DM Sans'},color:'#64748b'} },
        y: {
          type: 'logarithmic',
          min: 100,
          grid:{color:'#f1f5f9'},
          ticks:{
            font:{size:10},color:'#64748b',
            callback:v => {
              const n = Number(v);
              if (![100,1000,10000,100000,1000000].includes(n)) return '';
              return n.toLocaleString();
            }
          }
        }
      },
      onClick: (e, els) => { if (els.length) openDrawer(dataset[els[0].index].code); }
    }
  });

  // HTML legend below the chart — guaranteed to never overlap bars.
  const legendEl = document.getElementById('topCoLegend');
  if (legendEl) {
    const usedGroups = new Set(dataset.map(co => co.group));
    const hasRevAct  = dataset.some(co => co.revType === 'active');
    const hasRevCmp  = dataset.some(co => co.revType === 'complete');
    const items = [];
    if (usedGroups.has('AB')) items.push({ text:'Group AB — Solid',   bg:'#0c7c84', stripe:null,      border:'#0f766e' });
    if (usedGroups.has('CD')) items.push({ text:'Group CD — Striped', bg:'#0e9c9c', stripe:'#065b5b', border:'#0d9488' });
    if (hasRevAct) items.push({ text:'Revision Active',   bg:'#d97706', stripe:null, border:'#b45309' });
    if (hasRevCmp) items.push({ text:'Revision Complete', bg:'#7c3aed', stripe:null, border:'#6d28d9' });

    // Render a tiny canvas swatch per item so we can show the stripe pattern.
    const swatchHTML = it => {
      const c = document.createElement('canvas');
      c.width = 12; c.height = 12;
      const cx = c.getContext('2d');
      cx.fillStyle = it.stripe ? makeStripePattern(it.bg, it.stripe) : it.bg;
      cx.fillRect(0, 0, 12, 12);
      cx.strokeStyle = it.border; cx.lineWidth = 1;
      cx.strokeRect(0.5, 0.5, 11, 11);
      return c;
    };
    legendEl.innerHTML = '';
    items.forEach(it => {
      const row = document.createElement('span');
      row.style.cssText = 'display:inline-flex;align-items:center;gap:5px;white-space:nowrap';
      row.appendChild(swatchHTML(it));
      const lbl = document.createElement('span');
      lbl.textContent = it.text;
      row.appendChild(lbl);
      legendEl.appendChild(row);
    });
  }
}

function buildCmpChart() {
  const data = [...filteredSPI()].sort((a,b) => a.code.localeCompare(b.code)).slice(0, 15);
  mkChart('cmpChart', {
    type: 'bar',
    data: {
      labels: data.map(d => d.code),
      datasets: [
        { label:'Submitted', data:data.map(d=>d.submit1), backgroundColor:'rgba(24,38,68,.18)', borderColor:'rgba(24,38,68,.45)', borderWidth:1, borderRadius:2 },
        { label:'Obtained',  data:data.map(d=>d.obtained), backgroundColor:'rgba(12,124,132,.8)', borderColor:'#0c7c84', borderWidth:0, borderRadius:2 },
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: 8, right: 12, bottom: 4, left: 4 } },
      plugins: {
        legend: {
          position: 'bottom',
          align: 'start',
          labels: { font: { size: 10.5, family: 'DM Sans' }, color: '#4a5568', boxWidth: 10, padding: 16, usePointStyle: true }
        },
        tooltip: { mode:'index', intersect:false }
      },
      scales: {
        x: { grid:{display:false}, ticks:{font:{size:10,family:'DM Sans'},color:'#1a1f2e'} },
        y: { grid:{color:'#f1f5f9'}, ticks:{font:{size:10},color:'#64748b',callback:v=>v.toLocaleString()+' MT'} }
      },
      onClick: (e, els) => { if (els.length) openDrawer(data[els[0].index].code); }
    }
  });
}

/* ══════════════════════════════════════════════════
   FLOW KPI STRIP — 6-step analytical summary
   ① Obtained → ② Utilized → ③ Realized → ④ Real% → ⑤ Remaining → ⑥ Re-Apply Target
══════════════════════════════════════════════════ */
function buildFlowKPIStrip() {
  const el = document.getElementById('utilFlowStrip');
  if (!el) return;

  const fRa = filteredRA();
  const arrived   = fRa.filter(r => r.cargoArrived);
  const inShip    = fRa.filter(r => !r.cargoArrived);

  // ① Obtained — total from ALL SPI companies using canonicalObtainedFiltered
  // (consistent with Overview KPI2, OU chart, and Available Quota page)
  const totalObtained = (typeof canonicalObtainedFiltered === 'function')
    ? filteredSPI().reduce((s, co) => s + canonicalObtainedFiltered(co), 0)
    : filteredSPI().reduce((s, co) => s + (co.obtained || 0), 0);
  // ② Utilized — sum of utilizationByProd across ALL SPI companies
  //    This is the SINGLE source of truth: same data used by Detail — Company & Product Level
  const totalUtilized = filteredSPI().reduce((s, co) => {
    const ubp = co.utilizationByProd || {};
    return s + Object.values(ubp).reduce((t, v) => t + (typeof v === 'number' ? v : 0), 0);
  }, 0);
  // ③ Realized — sum of berat for arrived companies
  const totalRealized = arrived.reduce((s, r) => s + r.berat, 0);
  // ④ Realization % (of obtained)
  const realPct = totalObtained > 0 ? (totalRealized / totalObtained * 100) : 0;
  // ⑤ Remaining = obtained − utilized (unallocated quota)
  const totalRemaining = Math.max(0, totalObtained - totalUtilized);
  // ⑥ Target Re-Apply
  const totalTarget = fRa.reduce((s, r) => s + (r.target || 0), 0);
  // Eligible count
  const eligCount = arrived.filter(r => r.realPct >= 0.6).length;

  const steps = [
    { num:'①', label:'Obtained Quota', val: totalObtained.toLocaleString(), unit:'MT', note:`${fRa.length} companies`, color:'var(--navy)', bg:'#eef2ff', border:'#c7d2fe' },
    { num:'②', label:'Utilized (In Shipment)', val: totalUtilized > 0 ? totalUtilized.toLocaleString() : '—', unit: totalUtilized > 0 ? 'MT allocated' : 'pending', note: `${inShip.length} in transit`, color:'var(--blue)', bg:'var(--blue-bg)', border:'var(--blue-bd)' },
    { num:'③', label:'Realized', val: totalRealized > 0 ? totalRealized.toLocaleString() : '—', unit: totalRealized > 0 ? 'MT arrived JKT' : 'none yet', note: `${arrived.length} co. arrived`, color:'var(--green)', bg:'var(--green-bg)', border:'var(--green-bd)' },
    { num:'④', label:'Realization %', val: realPct.toFixed(1) + '%', unit: realPct >= 60 ? '≥ 60% threshold' : '< 60% threshold', note: `${eligCount} eligible co.`, color: realPct >= 60 ? 'var(--green)' : realPct >= 40 ? 'var(--amber)' : 'var(--red2)', bg: realPct >= 60 ? 'var(--green-bg)' : realPct >= 40 ? 'var(--amber-bg)' : 'var(--red-bg)', border: realPct >= 60 ? 'var(--green-bd)' : realPct >= 40 ? 'var(--amber-bd)' : 'var(--red-bd)' },
    { num:'⑤', label:'Remaining Quota', val: totalRemaining.toLocaleString(), unit:'MT unallocated', note:'Obtained − Utilized', color:'var(--teal)', bg:'var(--teal-bg)', border:'var(--teal-bd)' },
    { num:'⑥', label:'Target Re-Apply', val: totalTarget > 0 ? totalTarget.toLocaleString() : '—', unit: totalTarget > 0 ? 'MT next cycle' : 'TBA', note:`${eligCount} eligible to apply`, color:'var(--amber)', bg:'var(--amber-bg)', border:'var(--amber-bd)' },
  ];

  const arrows = steps.map((s, i) => {
    const isLast = i === steps.length - 1;
    return `
    <div style="display:flex;align-items:stretch;flex:1;min-width:0">
      <div style="flex:1;padding:13px 14px 11px;border-right:${isLast?'none':'1px solid var(--border)'};position:relative">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:5px">
          <span style="font-size:13px;font-weight:900;color:${s.color};font-family:'DM Mono',monospace;line-height:1">${s.num}</span>
          <span style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--txt3)">${s.label}</span>
        </div>
        <div style="font-size:22px;font-weight:700;color:${s.color};line-height:1;margin-bottom:3px;font-variant-numeric:tabular-nums">${s.val}</div>
        <div style="font-size:9.5px;color:var(--txt3);margin-bottom:2px">${s.unit}</div>
        <div style="font-size:9px;font-weight:600;padding:1px 6px;border-radius:3px;background:${s.bg};color:${s.color};border:1px solid ${s.border};display:inline-block">${s.note}</div>
        ${!isLast ? `<div style="position:absolute;right:-10px;top:50%;transform:translateY(-50%);font-size:16px;color:var(--border2);z-index:1;font-weight:900">›</div>` : ''}
      </div>
    </div>`;
  }).join('');

  el.innerHTML = `
    <div style="display:flex;align-items:stretch;background:var(--surf);border:1px solid var(--border);border-radius:var(--r2);overflow:hidden;box-shadow:var(--sh)">
      ${arrows}
    </div>`;
}

function buildGauge() {
  const fRa     = filteredRA(); // respects period filter
  const arrived   = fRa.filter(r => r.cargoArrived);
  const realized  = arrived.reduce((s,r) => s + r.berat, 0);
  const obtained  = arrived.reduce((s,r) => s + r.obtained, 0);
  const remaining = obtained - realized;
  // Weighted avg realization (berat / obtained), not simple mean of realPct
  const avgReal   = obtained > 0 ? realized / obtained : 0;
  // Update static labels
  const rmt = document.getElementById('gaugeRealMT');
  if (rmt) rmt.textContent = realized.toLocaleString(undefined,{maximumFractionDigits:0});
  const remEl = document.getElementById('gaugeRemainMT');
  if (remEl) remEl.textContent = Math.max(0,remaining).toLocaleString(undefined,{maximumFractionDigits:0});
  const gPct = document.querySelector('.gauge-pct');
  if (gPct) gPct.textContent = (avgReal*100).toFixed(1) + '%';
  // Update stat boxes
  const sub  = fRa.filter(isReapplySubmitted).length;
  const elig = fRa.filter(isEligible).length;
  const inShip = fRa.filter(r => !r.cargoArrived).length;
  const below  = fRa.filter(r => r.cargoArrived && r.realPct < 0.6 && !isReapplySubmitted(r)).length;
  const gs = document.getElementById('gaugeSubmitted'); if (gs) gs.textContent = sub;
  const ge = document.getElementById('gaugeElig');      if (ge) ge.textContent = elig;
  const gt = document.getElementById('gaugeTransit');   if (gt) gt.textContent = inShip;
  const gb = document.getElementById('gaugeBelowThresh');if(gb) gb.textContent = below;
  mkChart('gaugeChart', {
    type: 'doughnut',
    data: { datasets: [{ data:[realized, Math.max(0,remaining)], backgroundColor:['#21c55d','#e2e8f0'], borderWidth:0, circumference:180, rotation:270 }] },
    options: { cutout:'72%', responsive:false, plugins:{legend:{display:false},tooltip:{enabled:false}} }
  });
}

function buildUtilChart() {
  const sorted = [...filteredRA()].sort((a,b) => b.realPct - a.realPct);

  /* ── inject panel container once ── */
  const chartWrap = document.getElementById('utilChart').parentElement;
  let panel = document.getElementById('utilChartPanel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'utilChartPanel';
    panel.style.cssText = 'display:none;margin-top:8px;padding:10px 14px;background:var(--surf);border:1px solid var(--border2);border-radius:var(--r2);box-shadow:var(--sh);animation:fadeUp .15s ease';
    chartWrap.appendChild(panel);
  }

  function showUtilPanel(d) {
    const co   = getSPI(d.code);
    const rbp  = co ? (co.realizationByProd || {}) : {};
    const ubp  = co ? (co.utilizationByProd || {}) : {};
    const abp  = co ? (co.arrivedByProd     || {}) : {};
    const obtByProd = co ? getObtainedByProd(co) : {};
    const prods = co ? (co.products || []) : [d.product];

    /* status colour */
    const statusColor = isReapplySubmitted(d) ? '#7c3aed' : isEligible(d) ? 'var(--green)' : !d.cargoArrived ? 'var(--orange)' : 'var(--red2)';
    const statusLabel = isReapplySubmitted(d) ? '🔵 Re-Apply Submitted' : isEligible(d) ? '✅ Eligible' : !d.cargoArrived ? '🚢 In Shipment' : '❌ Below 60%';

    /* overall realization bar */
    const overallPct = (d.realPct * 100);
    const barFill    = isReapplySubmitted(d) ? '#8b5cf6' : isEligible(d) ? '#21c55d' : !d.cargoArrived ? '#f97316' : '#ef4444';

    /* per-product rows */
    const prodRows = prods.map(p => {
      const obt     = obtByProd[p] || 0;
      const util    = ubp[p]  != null ? ubp[p]  : 0;
      const arrived = abp[p]  != null ? abp[p]  : d.cargoArrived;
      let   real    = rbp[p]  != null ? rbp[p]  : (arrived ? (obt > 0 ? Math.round(d.berat*(obt/(d.obtained||1))*100)/100 : 0) : 0);
      const realPct = obt > 0 ? (real / obt * 100) : (arrived ? (d.realPct*100) : 0);
      const utilPct = obt > 0 ? (util / obt * 100) : 0;
      const pColor  = pc(p).solid;
      const pBg     = pc(p).light;

      /* bar color per product */
      const pBarCol = arrived
        ? (realPct >= 60 ? '#21c55d' : '#ef4444')
        : '#f97316';

      const statusTxt = arrived
        ? `${realPct.toFixed(1)}% Realization`
        : `${utilPct.toFixed(1)}% Utilization (In Shipment)`;

      return `
        <div style="display:flex;align-items:center;gap:10px;padding:6px 8px;border-radius:var(--r);background:${pBg}22;border:1px solid ${pColor}22;margin-bottom:4px">
          <div style="width:8px;height:8px;border-radius:2px;background:${pColor};flex-shrink:0"></div>
          <div style="flex:1;min-width:0">
            <div style="font-size:11px;font-weight:700;color:var(--txt);margin-bottom:3px">${p}</div>
            <div style="display:flex;align-items:center;gap:6px">
              <div style="flex:1;height:6px;background:var(--border);border-radius:3px;overflow:hidden">
                <div style="height:6px;background:${pBarCol};border-radius:3px;width:${Math.min(realPct||utilPct,100).toFixed(1)}%;transition:width .3s"></div>
              </div>
              <span style="font-size:10.5px;font-weight:700;color:${pBarCol};white-space:nowrap">${statusTxt}</span>
            </div>
            ${obt > 0 ? `<div style="font-size:9.5px;color:var(--txt3);margin-top:2px">${arrived ? `${real.toLocaleString()} MT arrived` : `${util.toLocaleString()} MT allocated`} · ${obt.toLocaleString()} MT obtained</div>` : ''}
          </div>
        </div>`;
    }).join('');

    panel.style.display = 'block';
    panel.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:14px;font-weight:800;color:var(--navy)">${d.code}</span>
          <span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:3px;background:${barFill}20;color:${statusColor};border:1px solid ${barFill}40">${statusLabel}</span>
          <span style="font-size:11px;font-weight:700;color:${barFill};font-family:'DM Mono',monospace">${overallPct.toFixed(1)}% overall</span>
        </div>
        <button onclick="document.getElementById('utilChartPanel').style.display='none'" style="background:var(--border);border:none;border-radius:4px;width:22px;height:22px;cursor:pointer;font-size:12px;color:var(--txt3);display:flex;align-items:center;justify-content:center;flex-shrink:0">✕</button>
      </div>
      <div style="margin-bottom:6px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
          <span style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.9px;color:var(--txt3)">Overall Realization</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <div style="flex:1;height:8px;background:var(--border);border-radius:4px;overflow:hidden">
            <div style="height:8px;background:${barFill};border-radius:4px;width:${Math.min(overallPct,100).toFixed(1)}%;transition:width .4s"></div>
          </div>
          <span style="font-size:11px;font-weight:700;color:${barFill};font-family:'DM Mono',monospace;min-width:44px;text-align:right">${overallPct.toFixed(1)}%</span>
        </div>
        <div style="font-size:9.5px;color:var(--txt3);margin-top:3px">${d.berat.toLocaleString()} MT ${d.cargoArrived ? 'arrived' : 'allocated'} · ${(d.obtained||0).toLocaleString()} MT obtained · ETA: ${d.etaJKT||'—'}</div>
      </div>
      <div style="border-top:1px solid var(--border);padding-top:8px">
        <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.9px;color:var(--txt3);margin-bottom:6px">Products Breakdown</div>
        ${prodRows}
      </div>
      <div style="margin-top:8px;border-top:1px solid var(--border);padding-top:6px;display:flex;justify-content:flex-end">
        <button onclick="openDrawer('${d.code}')" style="font-size:10.5px;font-weight:600;padding:4px 12px;border-radius:var(--r);border:1px solid var(--blue-bd);background:var(--blue-bg);color:var(--blue);cursor:pointer">View Full Detail ↗</button>
      </div>`;
  }

  mkChart('utilChart', {
    type: 'bar',
    data: {
      labels: sorted.map(d => d.code),
      datasets: [
        { label:'Realization %', data:sorted.map(d => +(d.realPct*100).toFixed(1)),
          backgroundColor: sorted.map(d => isReapplySubmitted(d) ? '#8b5cf6' : isEligible(d) ? '#21c55d' : !d.cargoArrived ? '#f97316' : '#ef4444'), borderRadius:3, borderWidth:0 },
        { label:'60% Threshold', data:sorted.map(()=>60), type:'line',
          borderColor:'rgba(220,38,38,.6)', borderWidth:1.5, borderDash:[5,4],
          pointRadius:0, fill:false }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: 6, right: 12, bottom: 4, left: 4 } },
      plugins: {
        legend: {
          position: 'bottom',
          align: 'start',
          labels: { font: { size: 10.5, family: 'DM Sans' }, color: '#4a5568', boxWidth: 10, padding: 14, usePointStyle: true }
        },
        tooltip: {
          callbacks:{
            title: ctx => {
              if (ctx[0]?.dataset?.label === '60% Threshold') return null;
              const d = sorted[ctx[0].dataIndex];
              return `${d.code} · ${d.product}`;
            },
            label: ctx => {
              if (ctx.dataset.label === '60% Threshold') return null;
              const d = sorted[ctx.dataIndex];
              const co  = getSPI(d.code);
              const rbp = co ? (co.realizationByProd || {}) : {};
              const ubp = co ? (co.utilizationByProd || {}) : {};
              const abp = co ? (co.arrivedByProd     || {}) : {};
              const obtByProd = co ? getObtainedByProd(co) : {};
              const prods = co ? (co.products || [d.product]) : [d.product];
              const lines = [` Overall: ${ctx.parsed.y.toFixed(1)}% realization`];
              prods.forEach(p => {
                const obt  = obtByProd[p] || 0;
                const arrived = abp[p] != null ? abp[p] : d.cargoArrived;
                const real = rbp[p] != null ? rbp[p] : (arrived && obt > 0 ? Math.round(d.berat*(obt/(d.obtained||1))*100)/100 : 0);
                const util = ubp[p] != null ? ubp[p] : 0;
                const pct  = obt > 0 ? (arrived ? (real/obt*100) : (util/obt*100)) : (d.realPct*100);
                lines.push(` ${p}: ${pct.toFixed(1)}% ${arrived ? 'realized' : 'utilized'} (${arrived ? real.toLocaleString() : util.toLocaleString()} MT)`);
              });
              return lines;
            },
            afterBody: ctx => {
              if (ctx[0]?.dataset?.label === '60% Threshold') return null;
              return ['', ' ↗ Click bar to see full breakdown'];
            }
          }
        }
      },
      scales: {
        x: { grid:{display:false}, ticks:{font:{size:10,family:'DM Sans'},color:'#1a1f2e'} },
        y: { min:0, max:108, grid:{color:'#f1f5f9'}, ticks:{font:{size:10},color:'#64748b',callback:v=>v+'%'} }
      },
      onClick: (e, els) => {
        if (!els.length) return;
        const d = sorted[els[0].index];
        if (els[0].datasetIndex === 1) { openDrawer(d.code); return; }
        showUtilPanel(d);
      }
    }
  });
}