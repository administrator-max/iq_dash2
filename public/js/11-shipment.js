/* ═══════════════════════════════════════
   SALES & OPS SHIPMENT ENGINE
   buildSalesOpsForm, lot management,
   collectShipmentData, reapply table
═══════════════════════════════════════ */

function buildSalesOpsForm(co) {
  if (!co) return;

  const shipments = ensureShipments(co);
  const obtByProd = getObtainedByProd(co);
  const products  = Object.keys(obtByProd);

  if (!products.length) {
    g('salesFormWrap').innerHTML = '<div class="pmt-note">No products with obtained quota found.</div>';
    g('opsFormWrap').innerHTML   = '<div class="pmt-note">No products with obtained quota found.</div>';
    return;
  }

  /* ── Build Sales form ── */
  let salesHTML = '';
  products.forEach(prod => {
    const obtMT   = obtByProd[prod] || 0;
    const lots    = shipments[prod] || [];
    const usedMT  = lots.reduce((s, l) => s + (l.utilMT || 0), 0);
    const availMT = obtMT - usedMT;
    const dot     = prodDot(prod);

    salesHTML += `
    <div class="sprod-block" data-prod="${prod}">
      <div class="sprod-hdr">
        <div class="sprod-hdr-left">
          <div class="sprod-hdr-dot" style="background:${dot}"></div>
          <span class="sprod-hdr-name">${prod}</span>
          <span class="sprod-quota-badge">PERTEK: ${obtMT.toLocaleString()} MT</span>
        </div>
        <span class="sprod-avail-badge${availMT < 0 ? ' warn' : ''}" id="sales-avail-${prod.replace(/[^a-zA-Z0-9]/g,'_')}">
          Available: ${availMT.toLocaleString()} MT
        </span>
      </div>

      <table class="sship-table">
        <thead>
          <tr>
            <th style="width:32px" class="t-c">Lot</th>
            <th style="width:185px">Utilization</th>
            <th style="width:105px">ETA JKT</th>
            <th>Note / Vessel</th>
            <th style="width:24px"></th>
          </tr>
        </thead>
        <tbody id="sales-tbody-${prod.replace(/[^a-zA-Z0-9]/g,'_')}">
          ${lots.map((lot, idx) => buildSalesRow(prod, idx, lot, obtMT)).join('')}
        </tbody>
      </table>

      <div class="add-ship-row">
        <button class="add-ship-btn" onclick="addSalesLot('${prod}')" id="sales-addbtn-${prod.replace(/[^a-zA-Z0-9]/g,'_')}">
          + Add Shipment Lot
        </button>
        <div class="sprod-total-val" id="sales-total-${prod.replace(/[^a-zA-Z0-9]/g,'_')}">
          ${usedMT.toLocaleString()} / ${obtMT.toLocaleString()} MT used
        </div>
      </div>
    </div>`;
  });

  // Grand total bar
  const grandUtil = products.reduce((s, p) => s + totalUtilForProd(shipments, p), 0);
  const grandObt  = products.reduce((s, p) => s + (obtByProd[p] || 0), 0);
  salesHTML += `
  <div class="grand-total-bar">
    <span>Total Utilization — All Products</span>
    <span class="grand-total-val" id="sales-grand-total">${grandUtil.toLocaleString()} / ${grandObt.toLocaleString()} MT</span>
  </div>`;

  g('salesFormWrap').innerHTML = salesHTML;

  // Build Re-Apply per-product table
  buildReapplyTable(co);

  /* ── Build Ops form ── */
  let opsHTML = '';
  products.forEach(prod => {
    const obtMT  = obtByProd[prod] || 0;
    const lots   = shipments[prod] || [];
    const dot    = prodDot(prod);
    const totalReal = lots.reduce((s, l) => s + (l.realMT || 0), 0);

    opsHTML += `
    <div class="sprod-block" data-prod="${prod}">
      <div class="sprod-hdr">
        <div class="sprod-hdr-left">
          <div class="sprod-hdr-dot" style="background:${dot}"></div>
          <span class="sprod-hdr-name">${prod}</span>
          <span class="sprod-quota-badge">PERTEK: ${obtMT.toLocaleString()} MT</span>
        </div>
        <span class="sprod-avail-badge" id="ops-real-${prod.replace(/[^a-zA-Z0-9]/g,'_')}">
          Realized: ${totalReal.toLocaleString()} MT
        </span>
      </div>

      <table class="sship-table">
        <thead>
          <tr>
            <th style="width:32px" class="t-c">Lot</th>
            <th style="width:100px" class="t-r">Util MT</th>
            <th style="width:100px" class="t-r">Real MT</th>
            <th style="width:105px">PIB Date</th>
            <th style="min-width:100px">Realization %</th>
            <th style="width:24px"></th>
          </tr>
        </thead>
        <tbody id="ops-tbody-${prod.replace(/[^a-zA-Z0-9]/g,'_')}">
          ${lots.map((lot, idx) => buildOpsRow(prod, idx, lot)).join('')}
        </tbody>
      </table>

      <div class="add-ship-row">
        <div style="font-size:9.5px;color:var(--txt3);font-style:italic">
          Realization synced from Sales shipment lots. PIB Date and Actual MT updated by Operations.
        </div>
        <div class="sprod-total-val" id="ops-total-${prod.replace(/[^a-zA-Z0-9]/g,'_')}">
          ${totalReal.toLocaleString()} / ${obtMT.toLocaleString()} MT realized
        </div>
      </div>
    </div>`;
  });

  // Grand total bar for ops
  const grandReal = products.reduce((s, p) =>
    s + (shipments[p] || []).reduce((ss, l) => ss + (l.realMT || 0), 0), 0);
  opsHTML += `
  <div class="grand-total-bar" style="background:#065f46">
    <span>Total Realization — All Products</span>
    <span class="grand-total-val" id="ops-grand-total">${grandReal.toLocaleString()} / ${grandObt.toLocaleString()} MT</span>
  </div>`;

  g('opsFormWrap').innerHTML = opsHTML;

  // Apply role locking to new inputs
  applyShipmentRoleLock();
}

/* ── Build a Sales shipment row ── */
function buildSalesRow(prod, idx, lot, obtMT) {
  const pid    = prod.replace(/[^a-zA-Z0-9]/g,'_');
  const lotNo  = idx + 1;
  const curMT  = lot.utilMT != null ? lot.utilMT : 0;
  const eta    = lot.etaJKT || '';
  const note   = lot.note   || '';
  const hist   = lot.utilHistory || [];

  // History HTML
  let histHTML = '';
  if (hist.length) {
    const rows = hist.map(h => `
      <div class="util-hist-row">
        <span class="util-hist-date">${h.date || '—'}</span>
        <span class="util-hist-prev">${(h.prev||0).toLocaleString()}</span>
        <span class="util-hist-delta">+${(h.delta||0).toLocaleString()}</span>
        <span class="util-hist-total">${(h.total||0).toLocaleString()}</span>
        <span class="util-hist-note">${h.note || ''}</span>
      </div>`).join('');
    histHTML = `
      <button class="util-hist-btn" onclick="toggleUtilHist('${pid}',${idx})">
        📋 History (${hist.length})
      </button>
      <div class="util-hist-panel" id="util-hist-${pid}-${idx}">
        <div class="util-hist-hd">
          <span>Date</span><span style="text-align:right">Prev MT</span>
          <span style="text-align:right">+Add MT</span><span style="text-align:right">Total MT</span>
          <span>Note</span>
        </div>
        ${rows}
      </div>`;
  }

  return `
  <tr id="sales-row-${pid}-${idx}" data-prod="${prod}" data-idx="${idx}">
    <td class="t-c"><span class="lot-badge">${lotNo}</span></td>
    <td>
      <div class="util-inc-wrap">
        <div class="util-cur-row">
          <span class="util-cur-lbl">Current</span>
          <span class="util-cur-val" id="util-cur-${pid}-${idx}">${curMT.toLocaleString()} MT</span>
        </div>
        <div class="util-add-row">
          <span class="util-add-lbl">+</span>
          <input type="text" inputmode="numeric"
            class="util-add-inp sales-util-add-inp"
            id="util-add-${pid}-${idx}"
            data-prod="${prod}" data-idx="${idx}"
            value="" placeholder="0"
            oninput="onSalesAddChange(this)"
            title="Add new utilization MT · Cannot cause total to exceed PERTEK obtained">
          <button class="util-apply-btn sales-util-apply-btn"
            id="util-apply-${pid}-${idx}"
            data-prod="${prod}" data-idx="${idx}"
            onclick="applySalesUtil('${prod}',${idx})"
            disabled>Apply</button>
        </div>
        <div class="val-err" id="util-err-${pid}-${idx}"></div>
        ${histHTML}
      </div>
    </td>
    <td>
      <input type="text"
        class="ship-txt-inp sales-eta-inp"
        data-prod="${prod}" data-idx="${idx}"
        value="${eta}"
        placeholder="e.g. 07 Mar 26">
    </td>
    <td>
      <input type="text"
        class="ship-txt-inp sales-note-inp"
        data-prod="${prod}" data-idx="${idx}"
        value="${note}"
        placeholder="Vessel / note…">
    </td>
    <td>
      <button class="del-ship-btn" onclick="deleteSalesLot('${prod}', ${idx})"
        title="Remove this lot" ${idx === 0 ? 'disabled' : ''}>✕</button>
    </td>
  </tr>`;
}

/* ── Build an Ops shipment row ── */
function buildOpsRow(prod, idx, lot) {
  const pid    = prod.replace(/[^a-zA-Z0-9]/g,'_');
  const lotNo  = idx + 1;
  const util   = lot.utilMT  != null ? lot.utilMT  : null;
  const real   = lot.realMT  != null ? lot.realMT  : '';
  const pib    = lot.pibDate || '';
  const realPct = (util && util > 0 && lot.realMT != null)
    ? Math.min(100, Math.round(lot.realMT / util * 100))
    : 0;
  const barColor = realPct >= 60 ? '#16a34a' : realPct >= 30 ? '#d97706' : '#94a3b8';
  const pibStatus = pib
    ? `<span class="pib-pill pib-done">✓ ${pib}</span>`
    : `<span class="pib-pill pib-none">—</span>`;

  return `
  <tr id="ops-row-${pid}-${idx}" data-prod="${prod}" data-idx="${idx}">
    <td class="t-c"><span class="lot-badge">${lotNo}</span></td>
    <td class="t-r" style="font-family:'DM Mono',monospace;font-size:11px;color:var(--txt2)">
      ${util != null ? Number(util).toLocaleString() + ' MT' : '<span style="color:var(--txt3)">—</span>'}
    </td>
    <td>
      <input type="text" inputmode="numeric"
        class="ship-inp ops-real-inp"
        data-prod="${prod}" data-idx="${idx}"
        value="${real !== '' ? Number(real).toLocaleString() : ''}"
        placeholder="0"
        oninput="onOpsRealChange(this)"
        title="Actual arrived MT for Lot ${lotNo} · Cannot exceed Util MT">
      <div class="val-err" id="real-err-${pid}-${idx}"></div>
    </td>
    <td>
      <input type="text"
        class="ship-txt-inp ops-pib-inp"
        data-prod="${prod}" data-idx="${idx}"
        value="${pib}"
        placeholder="DD/MM/YYYY"
        oninput="onOpsPibChange(this)">
    </td>
    <td>
      <div class="real-bar-wrap">
        <div class="real-bar-bg">
          <div class="real-bar-fill" id="real-bar-${pid}-${idx}"
            style="width:${realPct}%;background:${barColor}"></div>
        </div>
        <span class="real-pct-lbl" id="real-pct-${pid}-${idx}"
          style="color:${barColor}">${realPct > 0 ? realPct + '%' : '—'}</span>
      </div>
    </td>
    <td>
      <button class="del-ship-btn" title="Cannot delete — synced from Sales" disabled>✕</button>
    </td>
  </tr>`;
}

/* ── Add a new Sales lot for a product ── */
function addSalesLot(prod) {
  const co = getCurrentEditCo();
  if (!co) return;
  if (!co.shipments) co.shipments = {};
  if (!co.shipments[prod]) co.shipments[prod] = [];

  const lotNum = co.shipments[prod].length + 1;
  co.shipments[prod].push({ lotNo: lotNum, utilMT: null, etaJKT: '', note: '', realMT: null, pibDate: '', arrived: false });

  buildSalesOpsForm(co);   // rebuild both forms
  applyShipmentRoleLock();
  livePreview();
}

/* ── Delete a Sales lot (and its paired Ops row) ── */
function deleteSalesLot(prod, idx) {
  const co = getCurrentEditCo();
  if (!co || !co.shipments || !co.shipments[prod]) return;
  if (co.shipments[prod].length <= 1) return;  // always keep at least 1

  co.shipments[prod].splice(idx, 1);
  // Re-number lots
  co.shipments[prod].forEach((l, i) => { l.lotNo = i + 1; });

  buildSalesOpsForm(co);
  applyShipmentRoleLock();
  livePreview();
}

/* ── Helper: get the company object currently being edited ── */
function getCurrentEditCo() {
  const c = gv('editCo');
  return c ? (getSPI(c) || PENDING.find(p => p.code === c)) : null;
}

/* ── Sales: Util MT changed → validate + update available badge + totals ── */
/* ── Toggle utilization history panel ── */
function toggleUtilHist(pid, idx) {
  const panel = g(`util-hist-${pid}-${idx}`);
  if (panel) panel.classList.toggle('open');
}

/* ── Sales: +Add input changed → validate only, don't write yet ── */
function onSalesAddChange(inp) {
  fmtThousandInline(inp);
  const prod   = inp.dataset.prod;
  const idx    = parseInt(inp.dataset.idx);
  const co     = getCurrentEditCo();
  if (!co) return;

  ensureShipments(co);
  const pid    = prod.replace(/[^a-zA-Z0-9]/g,'_');
  const rawVal = inp.value.replace(/,/g,'');
  const addVal = rawVal === '' ? 0 : parseFloat(rawVal);

  const curMT   = (co.shipments[prod] && co.shipments[prod][idx])
                  ? (co.shipments[prod][idx].utilMT || 0) : 0;
  const obtMT   = (getObtainedByProd(co))[prod] || 0;
  const otherMT = totalUtilForProd(co.shipments, prod) - curMT; // util from other lots
  const newTotal = curMT + addVal;
  const available = obtMT - otherMT - newTotal;

  const errEl   = g(`util-err-${pid}-${idx}`);
  const applyBtn = g(`util-apply-${pid}-${idx}`);

  if (addVal <= 0 || rawVal === '') {
    inp.classList.remove('err');
    if (errEl) errEl.classList.remove('show');
    if (applyBtn) applyBtn.disabled = true;
  } else if (available < 0) {
    inp.classList.add('err');
    if (errEl) {
      errEl.textContent = `Exceeds quota by ${Math.abs(available).toLocaleString()} MT (max +${(obtMT - otherMT - curMT).toLocaleString()} MT)`;
      errEl.classList.add('show');
    }
    if (applyBtn) applyBtn.disabled = true;
  } else {
    inp.classList.remove('err');
    if (errEl) errEl.classList.remove('show');
    if (applyBtn) applyBtn.disabled = false;
  }
}

/* ── Sales: Apply incremental utilization ── */
function applySalesUtil(prod, idx) {
  const co = getCurrentEditCo();
  if (!co) return;
  ensureShipments(co);

  const pid    = prod.replace(/[^a-zA-Z0-9]/g,'_');
  const addInp = g(`util-add-${pid}-${idx}`);
  if (!addInp) return;

  const rawVal = addInp.value.replace(/,/g,'');
  const addVal = rawVal === '' ? 0 : parseFloat(rawVal);
  if (!addVal || addVal <= 0) return;

  const lot    = co.shipments[prod] && co.shipments[prod][idx];
  if (!lot) return;

  const curMT  = lot.utilMT || 0;
  const obtMT  = (getObtainedByProd(co))[prod] || 0;
  const otherMT = totalUtilForProd(co.shipments, prod) - curMT;

  // Final guard: cannot exceed obtained
  if (otherMT + curMT + addVal > obtMT) {
    alert(`Cannot add ${addVal.toLocaleString()} MT — exceeds PERTEK obtained quota of ${obtMT.toLocaleString()} MT for ${prod}.`);
    return;
  }

  const newMT  = curMT + addVal;

  // Get note from the row's note input (current vessel/note field)
  const noteInp = document.querySelector(`.sales-note-inp[data-prod="${prod}"][data-idx="${idx}"]`);
  const noteVal = noteInp ? noteInp.value.trim() : '';

  // Record history entry
  if (!lot.utilHistory) lot.utilHistory = [];
  const now = new Date();
  const dateStr = `${now.getDate().toString().padStart(2,'0')}/${(now.getMonth()+1).toString().padStart(2,'0')}/${now.getFullYear()} ${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`;
  lot.utilHistory.push({ date: dateStr, prev: curMT, delta: addVal, total: newMT, note: noteVal });

  // Commit new utilMT
  lot.utilMT = newMT;

  // Reset add input
  addInp.value = '';

  // Update current display
  const curDisp = g(`util-cur-${pid}-${idx}`);
  if (curDisp) curDisp.textContent = `${newMT.toLocaleString()} MT`;

  // Disable apply btn
  const applyBtn = g(`util-apply-${pid}-${idx}`);
  if (applyBtn) applyBtn.disabled = true;

  // Recompute totals & badges
  const usedMT  = totalUtilForProd(co.shipments, prod);
  const availMT = obtMT - usedMT;

  const badge = g(`sales-avail-${pid}`);
  if (badge) {
    badge.textContent = `Available: ${availMT.toLocaleString()} MT`;
    badge.className   = `sprod-avail-badge${availMT < 0 ? ' warn' : ''}`;
  }
  const totalEl = g(`sales-total-${pid}`);
  if (totalEl) totalEl.textContent = `${usedMT.toLocaleString()} / ${obtMT.toLocaleString()} MT used`;

  const grandEl = g('sales-grand-total');
  if (grandEl && co.shipments) {
    const obtByProd = getObtainedByProd(co);
    const gt = Object.keys(co.shipments).reduce((s, p) => s + totalUtilForProd(co.shipments, p), 0);
    const go = Object.values(obtByProd).reduce((s, v) => s + v, 0);
    grandEl.textContent = `${gt.toLocaleString()} / ${go.toLocaleString()} MT`;
  }

  // Refresh history display in the row
  const histBtnWrap = document.querySelector(`#sales-row-${pid}-${idx} .util-hist-btn`)?.parentElement ||
                      document.querySelector(`#sales-row-${pid}-${idx} td:nth-child(2) .util-inc-wrap`);
  // Rebuild the row to reflect new history
  const obtMTFull = (getObtainedByProd(co))[prod] || 0;
  const tbody = g(`sales-tbody-${pid}`);
  if (tbody) {
    const lots = co.shipments[prod] || [];
    tbody.innerHTML = lots.map((l, i) => buildSalesRow(prod, i, l, obtMTFull)).join('');
    applyShipmentRoleLock();
  }

  // Sync Ops column
  syncOpsUtilDisplay(co, prod);
  livePreview();
}

/* ── Sync Ops read-only Util MT column when Sales changes ── */
function syncOpsUtilDisplay(co, prod) {
  const pid  = prod.replace(/[^a-zA-Z0-9]/g,'_');
  const lots = (co.shipments || {})[prod] || [];
  lots.forEach((lot, idx) => {
    const row = g(`ops-row-${pid}-${idx}`);
    if (!row) return;
    const utilCell = row.querySelectorAll('td')[1];
    if (utilCell) {
      utilCell.innerHTML = lot.utilMT != null
        ? `<span style="font-family:'DM Mono',monospace;font-size:11px;color:var(--txt2)">${Number(lot.utilMT).toLocaleString()} MT</span>`
        : `<span style="color:var(--txt3)">—</span>`;
    }
    // Re-validate real MT against new util
    const realInp = row.querySelector(`.ops-real-inp[data-idx="${idx}"]`);
    if (realInp && realInp.value) onOpsRealChange(realInp);
  });
}

/* ── Ops: Real MT changed → validate ≤ util + update bar ── */
function onOpsRealChange(inp) {
  fmtThousandInline(inp);
  const prod = inp.dataset.prod;
  const idx  = parseInt(inp.dataset.idx);
  const co   = getCurrentEditCo();
  if (!co) return;

  ensureShipments(co);
  const rawVal = inp.value.replace(/,/g,'');
  const newVal = rawVal === '' ? null : parseFloat(rawVal);

  if (co.shipments[prod] && co.shipments[prod][idx] !== undefined) {
    co.shipments[prod][idx].realMT   = newVal;
    co.shipments[prod][idx].arrived  = newVal != null && newVal > 0;
  }

  const utilMT  = co.shipments[prod][idx].utilMT || 0;
  const pid     = prod.replace(/[^a-zA-Z0-9]/g,'_');
  const errEl   = g(`real-err-${pid}-${idx}`);

  if (newVal != null && utilMT > 0 && newVal > utilMT) {
    inp.classList.add('err');
    if (errEl) { errEl.textContent = `Cannot exceed Util MT (${utilMT.toLocaleString()} MT)`; errEl.classList.add('show'); }
  } else {
    inp.classList.remove('err');
    if (errEl) errEl.classList.remove('show');
  }

  // Update realization bar
  const realPct  = (utilMT > 0 && newVal != null) ? Math.min(100, Math.round(newVal / utilMT * 100)) : 0;
  const barColor = realPct >= 60 ? '#16a34a' : realPct >= 30 ? '#d97706' : '#94a3b8';
  const barEl    = g(`real-bar-${pid}-${idx}`);
  const pctEl    = g(`real-pct-${pid}-${idx}`);
  if (barEl) { barEl.style.width = realPct + '%'; barEl.style.background = barColor; }
  if (pctEl) { pctEl.textContent = realPct > 0 ? realPct + '%' : '—'; pctEl.style.color = barColor; }

  // Update product total
  const lots     = co.shipments[prod] || [];
  const totalReal = lots.reduce((s, l) => s + (l.realMT || 0), 0);
  const obtMT    = (getObtainedByProd(co))[prod] || 0;
  const totalEl  = g(`ops-total-${pid}`);
  if (totalEl) totalEl.textContent = `${totalReal.toLocaleString()} / ${obtMT.toLocaleString()} MT realized`;

  // Update ops badge
  const badge = g(`ops-real-${pid}`);
  if (badge) badge.textContent = `Realized: ${totalReal.toLocaleString()} MT`;

  // Update grand total
  const grandEl = g('ops-grand-total');
  if (grandEl && co.shipments) {
    const obtByProd = getObtainedByProd(co);
    const gr = Object.keys(co.shipments).reduce((s, p) =>
      s + (co.shipments[p] || []).reduce((ss, l) => ss + (l.realMT || 0), 0), 0);
    const go = Object.values(obtByProd).reduce((s, v) => s + v, 0);
    grandEl.textContent = `${gr.toLocaleString()} / ${go.toLocaleString()} MT`;
  }

  livePreview();
}

/* ── Ops: PIB date changed ── */
function onOpsPibChange(inp) {
  const prod = inp.dataset.prod;
  const idx  = parseInt(inp.dataset.idx);
  const co   = getCurrentEditCo();
  if (!co) return;
  ensureShipments(co);
  if (co.shipments[prod] && co.shipments[prod][idx] !== undefined) {
    co.shipments[prod][idx].pibDate = inp.value.trim();
    co.shipments[prod][idx].arrived = inp.value.trim() !== '';
  }
  livePreview();
}

/* ── Apply role lock to new shipment inputs ── */
function applyShipmentRoleLock() {
  if (!currentRole) return;
  const allowed = ROLE_PERMISSIONS[currentRole] || [];

  const canSales = allowed.includes('salesShipTable');
  const canOps   = allowed.includes('opsShipTable');

  document.querySelectorAll('.sales-util-add-inp,.sales-util-apply-btn,.sales-eta-inp,.sales-note-inp,.add-ship-btn').forEach(el => {
    el.disabled = !canSales;
  });
  document.querySelectorAll('.del-ship-btn').forEach(btn => {
    // del buttons: only enable if canSales AND not the first lot
    const idx = parseInt(btn.closest('tr')?.dataset?.idx ?? '0');
    btn.disabled = !canSales || idx === 0;
  });
  document.querySelectorAll('.ops-real-inp,.ops-pib-inp').forEach(el => {
    el.disabled = !canOps;
  });
  // Re-apply table inputs follow Sales permissions
  document.querySelectorAll('.reapply-prod-inp').forEach(el => {
    el.disabled = !canSales;
  });
}

/* ── Collect all shipment data from the form → write back to co.shipments ── */
function collectShipmentData(co) {
  if (!co) return;
  const obtByProd = getObtainedByProd(co);

  // ── Normalize lot objects: ensure lotNo is always set (1-based) ──
  if (co.shipments) {
    Object.values(co.shipments).forEach(lots => {
      lots.forEach((l, i) => {
        if (l.lotNo == null) l.lotNo = (l.lot != null ? l.lot : i + 1);
      });
    });
  }

  // Sales utilMT is written directly to co.shipments on each Apply click (incremental model).
  // Only collect ETA and Note fields here.
  document.querySelectorAll('.sales-eta-inp').forEach(inp => {
    const prod = inp.dataset.prod;
    const idx  = parseInt(inp.dataset.idx);
    if (co.shipments[prod] && co.shipments[prod][idx]) co.shipments[prod][idx].etaJKT = inp.value.trim();
  });
  document.querySelectorAll('.sales-note-inp').forEach(inp => {
    const prod = inp.dataset.prod;
    const idx  = parseInt(inp.dataset.idx);
    if (co.shipments[prod] && co.shipments[prod][idx]) co.shipments[prod][idx].note = inp.value.trim();
  });

  // Collect Ops inputs
  document.querySelectorAll('.ops-real-inp').forEach(inp => {
    const prod = inp.dataset.prod;
    const idx  = parseInt(inp.dataset.idx);
    if (co.shipments && co.shipments[prod] && co.shipments[prod][idx]) {
      const raw = inp.value.replace(/,/g,'');
      co.shipments[prod][idx].realMT  = raw ? parseFloat(raw) : null;
      co.shipments[prod][idx].arrived = raw && parseFloat(raw) > 0;
    }
  });
  document.querySelectorAll('.ops-pib-inp').forEach(inp => {
    const prod = inp.dataset.prod;
    const idx  = parseInt(inp.dataset.idx);
    if (co.shipments && co.shipments[prod] && co.shipments[prod][idx]) {
      co.shipments[prod][idx].pibDate = inp.value.trim();
    }
  });

  // Collect re-apply per-product targets
  collectReapplyData(co);

  // Recompute aggregate utilizationMT, availableQuota, utilizationByProd, availableByProd
  const obtByProd2 = getObtainedByProd(co);
  co.utilizationByProd = {};
  co.availableByProd   = {};
  let totalUtil = 0;
  Object.entries(obtByProd2).forEach(([prod, obtMT]) => {
    const used = totalUtilForProd(co.shipments, prod);
    co.utilizationByProd[prod] = used;
    co.availableByProd[prod]   = Math.max(0, obtMT - used);
    totalUtil += used;
  });
  co.utilizationMT  = totalUtil;
  co.availableQuota = Math.max(0, (co.obtained || 0) - totalUtil);
}

/* ── Build per-product Re-Apply Target table ── */
function buildReapplyTable(co) {
  const wrap = document.getElementById('reapplyProdTableWrap');
  if (!wrap) return;

  const obtByProd = getObtainedByProd(co);
  const products  = Object.keys(obtByProd);

  if (!products.length) {
    wrap.innerHTML = '<div class="pmt-note" style="color:var(--txt3)">No products found.</div>';
    return;
  }

  // Load existing per-product re-apply targets from co.reapplyByProd
  const existing = co.reapplyByProd || {};

  let rows = products.map(p => {
    const dot    = prodDot(p);
    const obtMT  = obtByProd[p] || 0;
    const val    = existing[p] != null ? existing[p] : '';
    const pid    = p.replace(/[^a-zA-Z0-9]/g,'_');
    return `<tr>
      <td>
        <div class="pmt-prod-chip">
          <div class="pmt-prod-dot" style="background:${dot}"></div>
          <span>${p}</span>
        </div>
      </td>
      <td class="pmt-ref-mt">${obtMT.toLocaleString()} MT</td>
      <td style="width:140px">
        <input type="text" inputmode="numeric"
          class="pmt-mt-inp reapply-prod-inp"
          data-prod="${p}"
          value="${val !== '' ? Number(val).toLocaleString() : ''}"
          placeholder="0"
          oninput="fmtThousandInline(this)"
          title="Re-Apply target MT for ${p} in next cycle">
      </td>
    </tr>`;
  }).join('');

  const grandTotal = products.reduce((s, p) => s + (existing[p] || 0), 0);

  wrap.innerHTML = `
    <div class="pmt-note" style="margin-bottom:8px">
      <strong>One row per product.</strong> Enter the planned re-apply MT for the next quota cycle.
      This is the target quantity to request — independent of current utilization.
    </div>
    <table class="pmt-table">
      <thead>
        <tr>
          <th>Product</th>
          <th class="t-r" style="width:120px">Current Obtained</th>
          <th class="t-r" style="width:140px">Re-Apply Target (MT) ↓</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr class="pmt-total-row">
          <td colspan="2">Total Re-Apply Target</td>
          <td class="pmt-total-val" id="reapplyTotal">${grandTotal.toLocaleString()} MT</td>
        </tr>
      </tfoot>
    </table>`;

  // Apply role lock
  const canSales = currentRole && (ROLE_PERMISSIONS[currentRole]||[]).includes('salesShipTable');
  wrap.querySelectorAll('.reapply-prod-inp').forEach(inp => { inp.disabled = !canSales; });
}

/* ── Collect re-apply data from form → co.reapplyByProd ── */
function collectReapplyData(co) {
  if (!co) return;
  co.reapplyByProd = co.reapplyByProd || {};
  let total = 0;
  document.querySelectorAll('.reapply-prod-inp').forEach(inp => {
    const prod = inp.dataset.prod;
    const raw  = inp.value.replace(/,/g,'');
    const val  = raw ? parseFloat(raw) : 0;
    co.reapplyByProd[prod] = val;
    total += val;
  });
  // Keep legacy co.target as the grand total for backward compat
  co.target = total || null;
}

/* ══ END SALES & OPERATIONS SHIPMENT ENGINE ══════════════════════════════ */