/* ═══════════════════════════════════════
   SALES PRIORITY ANALYSIS
   getSPEligibility, buildSalesPriorityData,
   renderSPTable, openSalesPriority modal
═══════════════════════════════════════ */

function setSPTab(mode, el) {
  spTabMode = mode;
  document.querySelectorAll('#salesPriorityModal .fpill').forEach(x => x.classList.remove('on'));
  el.classList.add('on');
  renderSPTable();
}


/** Core data builder — returns array of scored records */
/* ════════════════════════════════════════════════════════════════
   SALES PRIORITY ANALYSIS — STRICT ELIGIBILITY + PRIORITY RULES

   STEP 1 — ELIGIBILITY GATE (checked PER COMPANY before any ranking):
   A company is eligible ONLY IF its CURRENT active PERTEK is TERBIT.

   INELIGIBLE (excluded entirely):
     revType = 'active'  → there is an ongoing revision or re-apply.
                           The PERTEK Perubahan releaseDate will be 'TBA'.
                           → NOT ELIGIBLE regardless of original PERTEK.
                           Covers: HDP, CGK, GNG, GAS, BDG (active) + MJU, BTS (complete)

   ELIGIBLE:
     revType = 'none'    → original Submit #1 PERTEK has a real releaseDate (not TBA)
     revType = 'complete'→ either PERTEK Perubahan has a real releaseDate,
                           or original PERTEK has a real releaseDate
                           Covers: DIOR, MJU, BTS, SMS, GIS

   STEP 2 — PRIORITY ASSIGNMENT (only for eligible companies):
     HIGH   : isSingle (1 product in PERTEK) AND isOverdue (lead time > 14d)
              → Sort by remainMT ASC (smallest first)
              → If NO single-product+overdue exist, tier is empty (skip to MED/LOW)
     MEDIUM : NOT isSingle AND isOverdue (lead time > 14d)
              → Sort by remainMT ASC
     LOW    : everything else (within lead time ≤ 14d, or no lead time data)
              → Sort by remainMT ASC
════════════════════════════════════════════════════════════════ */

/**
 * ════════════════════════════════════════════════════════════════
 * ELIGIBILITY GATE — STRICT RULES
 *
 * A company is eligible for Sales Priority ONLY when:
 *   (A) SPI / SPI Perubahan is TERBIT (Obtained #1 cycle has a real SPI releaseDate)
 *       AND
 *   (B) No active revision or re-apply is ON PROCESS (revType !== 'active')
 *
 * NOT ELIGIBLE:
 *   1. revType === 'active'  → Revision / Re-Apply currently ON PROCESS
 *      Covers: HDP, CGK, GNG, GAS, BDG (active) + MJU, BTS (complete) — and any new ones
 *
 *   2. Obtained #1 cycle has releaseDate === 'TBA' or missing
 *      → SPI not yet issued even though PERTEK may be TERBIT
 *      Covers: BTS (SPI TBA), SMS (SPI TBA), GIS (SPI TBA), DIOR (SPI on hold)
 *
 *   3. DIOR/MJU special: PERTEK Perubahan TERBIT but SPI Perubahan TBA
 *      → The revised SPI has not been issued yet → still NOT eligible to sell new product
 *      However MJU's ORIGINAL SPI was obtained (05/01/26) — but the product changed
 *      and SPI Perubahan is pending, so cannot sell the new product → NOT eligible
 *
 * ELIGIBLE (all others with real SPI TERBIT date and no active revision):
 *   EMS, AMP, MIN, JKT, BHG, BBB, GKL, ADP, KJK, HKG, MSN, SPA, LCP, SJH, SGD
 * ════════════════════════════════════════════════════════════════
 */
function getSPEligibility(co) {
  // ── RULE 1: Active revision / re-apply (PERTEK Perubahan TBA) blocks ──
  if (co.revType === 'active') {
    return {
      eligible: false,
      reason: co.revNote
        ? `Revision ON PROCESS — ${co.revNote}`
        : 'Revision / Re-Apply ON PROCESS — PERTEK Perubahan belum TERBIT'
    };
  }

  const cycles = co.cycles || [];

  // ── RULE 2 (complete revision): PERTEK Perubahan must be TERBIT ───────
  // For revType='complete', check Revision #1 cycle releaseDate.
  if (co.revType === 'complete') {
    const revCy = cycles.find(c => /^revision\s*#?1/i.test(c.type))
               || cycles.find(c => /revision/i.test(c.type) && !/obtained/i.test(c.type));
    if (revCy) {
      const pertekPDate = (revCy.releaseDate || '').trim();
      if (pertekPDate && pertekPDate !== 'TBA') {
        return { eligible: true, reason: `PERTEK Perubahan TERBIT ${pertekPDate}`, pertekDate: pertekPDate };
      }
      return { eligible: false, reason: 'PERTEK Perubahan belum TERBIT — Revision ON PROCESS' };
    }
  }

  // ── RULE 3: Original PERTEK — check Submit #1 releaseDate ─────────────
  const submitCy = cycles.find(c => /^submit\s*#?1/i.test(c.type))
                || cycles.find(c => /^submit/i.test(c.type) && !/perubahan|revision/i.test(c.type));

  if (!submitCy) {
    return { eligible: false, reason: 'No Submit cycle found — PERTEK not yet issued' };
  }

  const pertekDate = (submitCy.releaseDate || '').trim();
  if (!pertekDate || pertekDate === 'TBA') {
    return { eligible: false, reason: 'PERTEK belum TERBIT — masih ON PROCESS' };
  }

  // ── ELIGIBLE: PERTEK TERBIT with a real date ───────────────────────────
  return { eligible: true, reason: `PERTEK TERBIT ${pertekDate}`, pertekDate };
}

/** Build list of excluded companies (for the ⛔ Not Eligible tab) */
function buildExcludedList() {
  const excluded = [];

  filteredSPI().forEach(co => {
    const e = getSPEligibility(co);

    // Case A: failed eligibility gate (active revision / PERTEK not TERBIT)
    if (!e.eligible) {
      excluded.push({
        code:       co.code,
        reason:     e.reason,
        products:   co.products || [],
        revType:    co.revType  || '',
        revStatus:  co.revStatus || '',
        revNote:    co.revNote  || '',
        obtained:   co.obtained || 0,
        remainMT:   co.availableQuota || 0,
        reasonType: co.revType === 'active'
          ? 'revision'
          : e.reason.includes('PERTEK Perubahan belum TERBIT')
            ? 'pertek-perubahan'
            : 'new-submission'
      });
      return;
    }

    // Case B: passed eligibility but ALL products have remainMT = 0
    const obtByProd   = getObtainedByProd(co);
    const utilByProd  = co.utilizationByProd  || {};
    const availByProd = co.availableByProd    || {};

    const zeroProds = [];
    Object.entries(obtByProd).forEach(([prod, obtMT]) => {
      if (!obtMT || obtMT <= 0) return;
      const utilMT   = utilByProd[prod] !== undefined
        ? utilByProd[prod]
        : (Object.keys(utilByProd).length === 0 ? (co.utilizationMT || 0) : 0);
      const remainMT = availByProd[prod] !== undefined
        ? availByProd[prod]
        : Math.max(0, obtMT - utilMT);
      if (remainMT <= 0) zeroProds.push(prod);
    });

    const allProds     = Object.keys(obtByProd).filter(p => obtByProd[p] > 0);
    const allZero      = allProds.length > 0 && zeroProds.length === allProds.length;

    if (allZero) {
      excluded.push({
        code:       co.code,
        reason:     'Remaining quota = 0 MT — all quota has been utilized',
        products:   co.products || [],
        revType:    co.revType  || '',
        revStatus:  co.revStatus || '',
        revNote:    co.revNote  || '',
        obtained:   co.obtained || 0,
        remainMT:   0,
        reasonType: 'zero-remaining'
      });
    }
  });

  // Sort: active revision first, then zero-remaining, then pertek pending
  const o = { revision: 0, 'zero-remaining': 1, 'pertek-perubahan': 2, 'new-submission': 3 };
  excluded.sort((a, b) => (o[a.reasonType] || 3) - (o[b.reasonType] || 3));
  return excluded;
}

/**
 * ════════════════════════════════════════════════════════════════
 * BUILD RANKED PRIORITY LIST
 *
 * Only eligible companies (PERTEK TERBIT + no active revision + remainMT > 0).
 *
 * LEAD TIME measured from: PERTEK TERBIT date (Submit #1 or Revision #1 releaseDate) → today
 * (If first utilization exists, lead time = PERTEK date → first util date instead)
 *
 * HIGH   = single-product PERTEK AND lead time > 14d
 *          Sorted by remainMT ASC (smallest first)
 * MEDIUM = multi-product PERTEK AND lead time > 14d
 *          Sorted by remainMT ASC
 * LOW    = lead time ≤ 14d (within standard) — any product count
 *          Sorted by remainMT ASC
 *
 * NOT ELIGIBLE: remainMT = 0, or revType = 'active', or PERTEK not TERBIT
 * ════════════════════════════════════════════════════════════════
 */
function buildSalesPriorityData() {
  const results = [];
  const today   = new Date();

  filteredSPI().forEach(co => {
    // ── GATE: must pass eligibility ───────────────────────────────
    const elig = getSPEligibility(co);
    if (!elig.eligible) return;

    const obtByProd = getObtainedByProd(co);
    const numProds  = Object.keys(obtByProd).length;
    const isSingle  = numProds === 1;

    // ── PERTEK TERBIT date (start of lead time clock) ─────────────
    // Use the eligibility result's pertekDate if available,
    // otherwise find it from cycles.
    const cycles = co.cycles || [];
    let pertekDate = elig.pertekDate ? pDate(elig.pertekDate) : null;
    if (!pertekDate) {
      // Try Revision #1 for complete revisions, else Submit #1
      const revCy = co.revType === 'complete'
        ? (cycles.find(c => /^revision\s*#?1/i.test(c.type))
           || cycles.find(c => /revision/i.test(c.type) && !/obtained/i.test(c.type)))
        : null;
      const subCy = cycles.find(c => /^submit\s*#?1/i.test(c.type))
                 || cycles.find(c => /^submit/i.test(c.type) && !/perubahan|revision/i.test(c.type));
      const srcCy = revCy || subCy;
      pertekDate = srcCy ? pDate(srcCy.releaseDate) : null;
    }

    Object.entries(obtByProd).forEach(([prod, obtMT]) => {
      if (!obtMT || obtMT <= 0) return;

      // ── Utilization & remaining ────────────────────────────────
      const utilByProd  = co.utilizationByProd  || {};
      const availByProd = co.availableByProd    || {};
      const utilMT = utilByProd[prod] !== undefined
        ? utilByProd[prod]
        : (Object.keys(utilByProd).length === 0 ? (co.utilizationMT || 0) : 0);
      const remainMT = availByProd[prod] !== undefined
        ? availByProd[prod]
        : Math.max(0, obtMT - utilMT);
      const utilPct = obtMT > 0 ? utilMT / obtMT : 0;

      // ── GATE: Remaining = 0 → Not Eligible (nothing left to sell) ─
      if (remainMT <= 0) return;

      // ── Lead time: PERTEK TERBIT date → first utilization (or today) ──
      const firstUtilD = getFirstUtilDate(co, prod);
      let leadDays     = null;
      let isOverdue    = false;

      if (pertekDate) {
        const endDate = firstUtilD || today;
        leadDays  = diffDays(pertekDate, endDate);
        isOverdue = leadDays > OU_LEAD_STD;
      }

      // ── STRICT PRIORITY TIERS ─────────────────────────────────
      // HIGH   = single-product AND overdue (>14d)
      // MEDIUM = multi-product  AND overdue (>14d)
      // LOW    = everything else (≤14d, no SPI date, etc.)
      const priority = (isSingle && isOverdue)  ? 'HIGH'
                     : (!isSingle && isOverdue) ? 'MED'
                     : 'LOW';

      // ── Signal badges ─────────────────────────────────────────
      const signals = [];
      if (isSingle)
        signals.push({ text: '⭐ Single-Product', color: '#0e7490', bg: '#ecfeff', bd: '#a5f3fc' });
      if (isOverdue)
        signals.push({ text: `⚠ ${leadDays}d overdue`, color: '#dc2626', bg: '#fef2f2', bd: '#fecaca' });
      else if (leadDays !== null)
        signals.push({ text: `✓ ${leadDays}d on-track`, color: '#15803d', bg: '#f0fdf4', bd: '#bbf7d0' });
      if (numProds > 1)
        signals.push({ text: `${numProds} products`, color: '#64748b', bg: '#f1f5f9', bd: '#e2e8f0' });

      // ── Recommendation ────────────────────────────────────────
      const N   = v => Math.round(v).toLocaleString();
      const pct = v => Math.round(v * 100) + '%';
      let rec;
      if (priority === 'HIGH') {
        rec = `Priority: ${co.code} – ${prod} — Single-product PERTEK, lead time overdue (${leadDays}d > 14d). `
            + `Remaining quota ${N(remainMT)} MT · ${pct(utilPct)} utilized. `
            + `Push remaining sales now to close this cycle and qualify for re-apply.`;
      } else if (priority === 'MED') {
        rec = `${co.code} – ${prod}: Multi-product PERTEK · lead time overdue (${leadDays}d > 14d). `
            + `Remaining ${N(remainMT)} MT · ${pct(utilPct)} utilized. `
            + `Accelerate sales to close cycle sooner.`;
      } else {
        rec = `${co.code} – ${prod}: Within 14-day standard`
            + (leadDays !== null ? ` (${leadDays}d)` : '')
            + `. Remaining ${N(remainMT)} MT · ${pct(utilPct)} utilized. `
            + (numProds > 1 ? 'Multi-product PERTEK. ' : '')
            + `Monitor and maintain steady progress.`;
      }

      results.push({
        code: co.code, prod, obtMT, utilMT, remainMT, utilPct,
        isSingle, numProds, isOverdue, leadDays, pertekDate,
        priority, signals, rec,
        eligReason: elig.reason
      });
    });
  });

  // Sort: tier first (HIGH → MED → LOW), then remainMT ASC within each tier
  const tierOrder = { HIGH: 0, MED: 1, LOW: 2 };
  results.sort((a, b) => {
    const td = tierOrder[a.priority] - tierOrder[b.priority];
    return td !== 0 ? td : a.remainMT - b.remainMT;
  });

  return results;
}

/** Update the Sales Priority insight card in the insights strip */
function updateSalesIntelKPIs() {
  const data      = buildSalesPriorityData();
  const top       = data[0];
  const highCount = data.filter(r => r.priority === 'HIGH').length;
  const medCount  = data.filter(r => r.priority === 'MED').length;

  const spInsVal = document.getElementById('spInsightVal');
  const spInsSub = document.getElementById('spInsightSub');
  if (spInsVal) spInsVal.innerHTML =
    `<span style="color:#dc2626;font-weight:800">${highCount} High</span>` +
    ` · <span style="color:#d97706;font-weight:700">${medCount} Medium</span>`;
  if (spInsSub) spInsSub.textContent = top
    ? `Top pick: ${top.code} – ${top.prod}`
    : 'No high-priority items';
}

function openSalesPriority(tab) {
  spTabMode = tab || 'ALL';
  const modal = document.getElementById('salesPriorityModal');
  if (!modal) return;
  document.querySelectorAll('#salesPriorityModal .fpill').forEach(x => x.classList.remove('on'));
  const tabMap = { ALL: 'spTabAll', HIGH: 'spTabHigh', MED: 'spTabMed', LOW: 'spTabLow', EXCL: 'spTabExcl' };
  const btn = document.getElementById(tabMap[spTabMode] || 'spTabAll');
  if (btn) btn.classList.add('on');
  refreshSPModal();
  modal.style.display = 'block';
}

function closeSalesPriority() {
  const modal = document.getElementById('salesPriorityModal');
  if (modal) modal.style.display = 'none';
}

function refreshSPModal() {
  const data     = buildSalesPriorityData();
  const excluded = buildExcludedList();
  const high     = data.filter(r => r.priority === 'HIGH');
  const med      = data.filter(r => r.priority === 'MED');
  const low      = data.filter(r => r.priority === 'LOW');
  const singleCos = [...new Set(data.filter(r => r.isSingle).map(r => r.code))];
  const overdueCos = [...new Set(data.filter(r => r.isOverdue).map(r => r.code))];

  const strip = document.getElementById('spKpiStrip');
  if (strip) strip.innerHTML = `
    <div style="flex:1;padding:10px 16px;border-right:1px solid var(--border);background:#fef2f2">
      <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#dc2626">🔴 High</div>
      <div style="font-size:22px;font-weight:800;color:#dc2626;line-height:1.2">${high.length}</div>
      <div style="font-size:10px;color:var(--txt3)">single-product + overdue</div>
    </div>
    <div style="flex:1;padding:10px 16px;border-right:1px solid var(--border);background:#fffbeb">
      <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#d97706">🟡 Medium</div>
      <div style="font-size:22px;font-weight:800;color:#d97706;line-height:1.2">${med.length}</div>
      <div style="font-size:10px;color:var(--txt3)">multi-product + overdue</div>
    </div>
    <div style="flex:1;padding:10px 16px;border-right:1px solid var(--border)">
      <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#64748b">🔵 Lower</div>
      <div style="font-size:22px;font-weight:800;color:#64748b;line-height:1.2">${low.length}</div>
      <div style="font-size:10px;color:var(--txt3)">within lead time</div>
    </div>
    <div style="flex:1;padding:10px 16px;border-right:1px solid var(--border);background:#ecfeff">
      <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#0e7490">⭐ Single-Product</div>
      <div style="font-size:22px;font-weight:800;color:#0e7490;line-height:1.2">${singleCos.length}</div>
      <div style="font-size:10px;color:var(--txt3)">eligible companies</div>
    </div>
    <div style="flex:1;padding:10px 16px;border-right:1px solid var(--border);background:#fff5f5">
      <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#dc2626">⚠ Overdue</div>
      <div style="font-size:22px;font-weight:800;color:#dc2626;line-height:1.2">${overdueCos.length}</div>
      <div style="font-size:10px;color:var(--txt3)">lead time &gt;14d</div>
    </div>
    <div style="flex:1;padding:10px 16px;background:#f8fafc">
      <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#94a3b8">⛔ Not Eligible</div>
      <div style="font-size:22px;font-weight:800;color:#94a3b8;line-height:1.2">${excluded.length}</div>
      <div style="font-size:10px;color:var(--txt3)">revision active / 0 remaining / PERTEK pending</div>
    </div>`;

  renderSPTable();
}

function renderSPTable() {
  const tbody = document.getElementById('spTableBody');
  if (!tbody) return;

  // ── ⛔ Not Eligible tab ──────────────────────────────────────
  if (spTabMode === 'EXCL') {
    const excluded = buildExcludedList();
    if (!excluded.length) {
      tbody.innerHTML = `<tr><td colspan="10" style="padding:28px;text-align:center;color:var(--txt3);font-size:12px">No excluded companies.</td></tr>`;
      return;
    }
    tbody.innerHTML = excluded.map((e, idx) => {
      const reasonBadge = e.reasonType === 'revision'
        ? `<span style="font-size:10px;font-weight:700;padding:2px 9px;border-radius:4px;background:#fef2f2;color:#dc2626;border:1px solid #fecaca">⛔ Revision / Re-Apply ON PROCESS</span>`
        : e.reasonType === 'zero-remaining'
        ? `<span style="font-size:10px;font-weight:700;padding:2px 9px;border-radius:4px;background:#f0fdf4;color:#15803d;border:1px solid #86efac">✅ Fully Utilized — Remaining 0 MT</span>`
        : e.reasonType === 'pertek-perubahan'
        ? `<span style="font-size:10px;font-weight:700;padding:2px 9px;border-radius:4px;background:#fffbeb;color:#d97706;border:1px solid #fde68a">⏳ PERTEK Perubahan belum TERBIT</span>`
        : `<span style="font-size:10px;font-weight:700;padding:2px 9px;border-radius:4px;background:#f1f5f9;color:#64748b;border:1px solid #e2e8f0">⏳ PERTEK belum TERBIT</span>`;
      return `
        <tr style="background:#fafafa;cursor:pointer" onclick="closeSalesPriority();openDrawer('${e.code}')" title="Open ${e.code}">
          <td style="padding:9px 8px 9px 16px;border-left:3px solid #e2e8f0;color:var(--txt3);font-size:10px;font-weight:700">${idx + 1}</td>
          <td style="padding:9px 10px"><span style="font-weight:700;font-size:13px;color:#94a3b8">${e.code}</span></td>
          <td style="padding:9px 10px;color:var(--txt3);font-size:11.5px">${e.products.join(', ')}</td>
          <td colspan="5" style="padding:9px 10px">
            ${reasonBadge}
            <div style="font-size:10px;color:var(--txt3);margin-top:4px">${e.reason}</div>
            ${e.revStatus ? `<div style="font-size:9.5px;color:var(--txt3);margin-top:2px;font-style:italic">${e.revStatus}</div>` : ''}
          </td>
          <td colspan="2" style="padding:9px 10px;text-align:center">
            <span style="font-size:9.5px;font-weight:700;padding:3px 9px;border-radius:3px;background:#f1f5f9;color:#94a3b8;border:1px solid #e2e8f0;white-space:nowrap">⛔ Not Eligible</span>
          </td>
        </tr>`;
    }).join('');
    return;
  }

  // ── Eligible rows ─────────────────────────────────────────────
  const data = buildSalesPriorityData();
  const rows = spTabMode === 'HIGH' ? data.filter(r => r.priority === 'HIGH')
             : spTabMode === 'MED'  ? data.filter(r => r.priority === 'MED')
             : spTabMode === 'LOW'  ? data.filter(r => r.priority === 'LOW')
             : data;

  const pBadge = p =>
    p === 'HIGH' ? `<span style="font-size:9.5px;font-weight:700;padding:3px 9px;border-radius:3px;background:#fef2f2;color:#dc2626;border:1px solid #fecaca;white-space:nowrap">🔴 High</span>`
  : p === 'MED'  ? `<span style="font-size:9.5px;font-weight:700;padding:3px 9px;border-radius:3px;background:#fffbeb;color:#d97706;border:1px solid #fde68a;white-space:nowrap">🟡 Medium</span>`
  :                `<span style="font-size:9.5px;font-weight:700;padding:3px 9px;border-radius:3px;background:#f1f5f9;color:#64748b;border:1px solid #e2e8f0;white-space:nowrap">🔵 Lower</span>`;

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="10" style="padding:28px;text-align:center;color:var(--txt3);font-size:12px">No records for this filter.</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map((r, idx) => {
    const rowBg  = r.priority === 'HIGH' ? 'background:#fffafa'
                 : r.priority === 'MED'  ? 'background:#fffdf5' : '';
    const leftBd = r.priority === 'HIGH' ? 'border-left:3px solid #dc2626'
                 : r.priority === 'MED'  ? 'border-left:3px solid #d97706'
                 :                         'border-left:3px solid #e2e8f0';
    const pc = ouPC(r.prod);
    const utilBarClr = r.isOverdue ? '#dc2626' : pc.solid;

    const utilBar = `<div style="display:flex;align-items:center;gap:5px">
      <div style="flex:1;height:6px;background:#e2e8f0;border-radius:3px;min-width:44px">
        <div style="width:${Math.min(100, Math.round(r.utilPct * 100))}%;height:100%;background:${utilBarClr};border-radius:3px"></div>
      </div>
      <span style="font-size:10.5px;font-weight:700;color:${utilBarClr};white-space:nowrap">${Math.round(r.utilPct * 100)}%</span>
    </div>`;

    const ldCell = r.leadDays !== null
      ? (r.isOverdue
          ? `<span style="font-size:11px;font-weight:700;color:#dc2626">⚠ ${r.leadDays}d</span>`
          : `<span style="font-size:11px;font-weight:600;color:var(--green)">✓ ${r.leadDays}d</span>`)
      : `<span style="font-size:11px;color:var(--txt3)">—</span>`;

    const sigHtml = r.signals.map(s =>
      `<span style="font-size:9px;font-weight:700;padding:1px 6px;border-radius:3px;background:${s.bg};color:${s.color};border:1px solid ${s.bd};white-space:nowrap;margin-right:2px">${s.text}</span>`
    ).join('');

    return `<tr style="${rowBg};cursor:pointer" onclick="closeSalesPriority();openDrawer('${r.code}')" title="Open ${r.code}">
      <td style="padding:9px 8px 9px 16px;${leftBd};color:var(--txt3);font-size:10px;font-weight:700">${idx + 1}</td>
      <td style="padding:9px 10px">
        <div style="display:flex;align-items:center;gap:5px">
          ${r.isSingle ? '<span title="Single-product PERTEK" style="font-size:13px">⭐</span>' : ''}
          <span style="font-weight:700;font-size:13px;color:var(--blue)">${r.code}</span>
        </div>
        <div style="font-size:9.5px;color:var(--txt3);margin-top:1px">${r.numProds} product${r.numProds !== 1 ? 's' : ''} in PERTEK</div>
      </td>
      <td style="padding:9px 10px">
        <span style="display:inline-flex;align-items:center;gap:5px">
          <span style="width:8px;height:8px;border-radius:2px;background:${pc.solid};flex-shrink:0"></span>
          <span style="font-size:11.5px;font-weight:600">${r.prod}</span>
        </span>
      </td>
      <td style="padding:9px 10px;text-align:right;font-family:'DM Mono',monospace;font-size:11.5px">${r.obtMT.toLocaleString()}</td>
      <td style="padding:9px 10px;min-width:100px">${utilBar}</td>
      <td style="padding:9px 10px;text-align:center">${ldCell}</td>
      <td style="padding:9px 10px;text-align:right;font-family:'DM Mono',monospace;font-size:11.5px;font-weight:700;color:${r.isOverdue ? '#dc2626' : 'var(--teal)'}">${Math.round(r.remainMT).toLocaleString()} MT</td>
      <td style="padding:9px 10px;max-width:180px">${sigHtml}</td>
      <td style="padding:9px 10px;text-align:center">${pBadge(r.priority)}</td>
      <td style="padding:9px 16px;font-size:11px;color:var(--txt2);max-width:260px;line-height:1.5">${r.rec}</td>
    </tr>`;
  }).join('');
}