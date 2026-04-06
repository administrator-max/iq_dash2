/* ── Global product→PID map for revision request table ──────────────
   Products like "ERW PIPE OD≤140mm" and "ERW PIPE OD>140mm" both
   collapse to "ERW_PIPE_OD_140mm" when stripping non-alphanumeric.
   We keep an index-based map so each product gets a unique DOM id.
─────────────────────────────────────────────────────────────────── */
let _revReqPidMap = {}; // prodName → unique pid string

function makeRevPid(prodName) {
  if (_revReqPidMap[prodName]) return _revReqPidMap[prodName];
  // Fallback: simple replace (unique if no collision)
  return prodName.replace(/[^a-zA-Z0-9]/g, '_');
}
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

  // Build Revision Request table
  buildRevisionRequestTable(co);

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
        <!-- Direct edit mode: single input for current utilMT -->
        <div class="util-edit-wrap" id="util-edit-wrap-${pid}-${idx}">
          <div style="display:flex;align-items:center;gap:5px">
            <input type="text" inputmode="numeric"
              class="util-add-inp sales-util-direct-inp"
              id="util-direct-${pid}-${idx}"
              data-prod="${prod}" data-idx="${idx}"
              value="${curMT > 0 ? curMT.toLocaleString() : ''}"
              placeholder="0"
              oninput="onSalesDirectChange(this)"
              title="Edit langsung nilai utilisasi MT">
            <span style="font-size:10px;color:var(--txt3);flex-shrink:0">MT</span>
            <button class="util-apply-btn sales-util-save-btn"
              id="util-save-${pid}-${idx}"
              data-prod="${prod}" data-idx="${idx}"
              onclick="saveSalesUtil('${prod}',${idx})"
              style="background:var(--blue);color:#fff;border-color:var(--blue)">Simpan</button>
          </div>
          <div class="val-err" id="util-err-${pid}-${idx}"></div>
        </div>
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
  co.shipments[prod].push({ lot: lotNum, utilMT: null, etaJKT: '', note: '', realMT: null, pibDate: '', arrived: false });

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
  co.shipments[prod].forEach((l, i) => { l.lot = i + 1; });

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
/* ── Sales: validate direct MT input ── */
function onSalesDirectChange(inp) {
  fmtThousandInline(inp);
  const prod   = inp.dataset.prod;
  const idx    = parseInt(inp.dataset.idx);
  const co     = getCurrentEditCo();
  if (!co) return;

  ensureShipments(co);
  const pid    = prod.replace(/[^a-zA-Z0-9]/g,'_');
  const rawVal = inp.value.replace(/,/g,'');
  const newMT  = rawVal === '' ? 0 : parseFloat(rawVal);
  const obtMT  = (getObtainedByProd(co))[prod] || 0;
  const curMT  = (co.shipments[prod] && co.shipments[prod][idx])
                 ? (co.shipments[prod][idx].utilMT || 0) : 0;
  const otherMT = totalUtilForProd(co.shipments, prod) - curMT;
  const available = obtMT - otherMT - newMT;

  const errEl  = g(`util-err-${pid}-${idx}`);
  const saveBtn = g(`util-save-${pid}-${idx}`);

  if (newMT < 0) {
    inp.classList.add('err');
    if (errEl) { errEl.textContent = 'Nilai tidak boleh negatif'; errEl.classList.add('show'); }
    if (saveBtn) saveBtn.disabled = true;
  } else if (available < 0) {
    inp.classList.add('err');
    if (errEl) {
      errEl.textContent = `Melebihi kuota ${Math.abs(available).toLocaleString()} MT (max ${(obtMT - otherMT).toLocaleString()} MT)`;
      errEl.classList.add('show');
    }
    if (saveBtn) saveBtn.disabled = true;
  } else {
    inp.classList.remove('err');
    if (errEl) errEl.classList.remove('show');
    if (saveBtn) saveBtn.disabled = false;
  }
}

/* ── Keep onSalesAddChange for backward compat (no-op now) ── */
function onSalesAddChange(inp) { onSalesDirectChange(inp); }

/* ── Sales: Save direct utilization edit ── */
function saveSalesUtil(prod, idx) {
  const co = getCurrentEditCo();
  if (!co) return;
  ensureShipments(co);

  const pid     = prod.replace(/[^a-zA-Z0-9]/g,'_');
  const directInp = g(`util-direct-${pid}-${idx}`);
  if (!directInp) return;

  const rawVal = directInp.value.replace(/,/g,'');
  const newMT  = rawVal === '' ? 0 : parseFloat(rawVal);
  if (newMT < 0) return;

  const lot    = co.shipments[prod] && co.shipments[prod][idx];
  if (!lot) return;

  const curMT   = lot.utilMT || 0;
  const obtMT   = (getObtainedByProd(co))[prod] || 0;
  const otherMT = totalUtilForProd(co.shipments, prod) - curMT;

  if (otherMT + newMT > obtMT) {
    alert(`Nilai ${newMT.toLocaleString()} MT melebihi kuota PERTEK ${obtMT.toLocaleString()} MT untuk ${prod}.`);
    return;
  }

  const delta  = newMT - curMT;

  // Get note from vessel/note input
  const noteInp = document.querySelector(`.sales-note-inp[data-prod="${prod}"][data-idx="${idx}"]`);
  const noteVal = noteInp ? noteInp.value.trim() : '';

  // Record history entry (only if value changed)
  if (delta !== 0) {
    if (!lot.utilHistory) lot.utilHistory = [];
    const now = new Date();
    const dateStr = `${now.getDate().toString().padStart(2,'0')}/${(now.getMonth()+1).toString().padStart(2,'0')}/${now.getFullYear()} ${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`;
    lot.utilHistory.push({ date: dateStr, prev: curMT, delta, total: newMT, note: noteVal });
  }

  // Commit
  lot.utilMT = newMT;

  // Visual feedback — flash save button green briefly
  const saveBtn = g(`util-save-${pid}-${idx}`);
  if (saveBtn) {
    const orig = saveBtn.textContent;
    saveBtn.textContent = '✓ Tersimpan';
    saveBtn.style.background = 'var(--green)';
    setTimeout(() => {
      if (saveBtn) { saveBtn.textContent = orig; saveBtn.style.background = 'var(--blue)'; }
    }, 1400);
  }

  // Update input to formatted value
  directInp.value = newMT > 0 ? newMT.toLocaleString() : '';

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

  document.querySelectorAll('.sales-util-direct-inp,.sales-util-save-btn,.sales-util-add-inp,.sales-util-apply-btn,.sales-eta-inp,.sales-note-inp,.add-ship-btn').forEach(el => {
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

  // Sales utilMT: read from direct edit input first (may have unsaved value)
  document.querySelectorAll('.sales-util-direct-inp').forEach(inp => {
    const prod = inp.dataset.prod;
    const idx  = parseInt(inp.dataset.idx);
    if (co.shipments && co.shipments[prod] && co.shipments[prod][idx]) {
      const raw = inp.value.replace(/,/g,'');
      const val = raw ? parseFloat(raw) : 0;
      if (val >= 0) co.shipments[prod][idx].utilMT = val;
    }
  });
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
    <div style="display:flex;align-items:center;gap:5px;margin-bottom:8px">
      <span style="font-size:11px;font-weight:700;color:var(--txt2)">Target Re-Apply per Produk</span>
      <span class="tti" data-tip="Satu baris per produk. Isi target MT re-apply untuk siklus quota berikutnya — tidak tergantung utilisasi saat ini.">i</span>
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
/* ════════════════════════════════════════════════════════════════════
   SALES REVISION REQUEST TABLE
   Sales dapat input request revision produk dan/atau kuantiti.
   CorpSec akan melihat ini dan dapat edit qty-nya.
════════════════════════════════════════════════════════════════════ */
function buildRevisionRequestTable(co) {
  const wrap = document.getElementById('salesRevReqWrap');
  if (!wrap) return;

  const obtByProd = getObtainedByProd(co);
  const products  = Object.keys(obtByProd);
  if (!products.length) {
    wrap.innerHTML = '<div class="pmt-note" style="color:var(--txt3)">No products found.</div>';
    return;
  }

  // Data model per produk:
  // { requested: bool, requestedMT: number|null, note: string,
  //   targetProducts: [{ product: string, mt: number|null }] }
  // targetProducts = array produk tujuan (bisa 1 atau lebih untuk split)
  // ── Sanitize salesRevRequest: normalize requested to strict boolean ──
  if (co.salesRevRequest) {
    Object.keys(co.salesRevRequest).forEach(prod => {
      const r = co.salesRevRequest[prod];
      if (!r) { delete co.salesRevRequest[prod]; return; }
      const wasReq = r.requested === true || r.requested === 'true' || r.requested === 1;
      r.requested = wasReq;
      if (!wasReq) delete co.salesRevRequest[prod];
    });
  }
  const existing  = co.salesRevRequest || {};
  const canSales  = currentRole && (ROLE_PERMISSIONS[currentRole]||[]).includes('salesShipTable');

  // ── Build unique PID map (populate global _revReqPidMap) ──────────
  // Prevents collision: "ERW PIPE OD≤140mm" vs "ERW PIPE OD>140mm" → both "ERW_PIPE_OD_140mm"
  _revReqPidMap = {};
  products.forEach((p, idx) => {
    const base = p.replace(/[^a-zA-Z0-9]/g, '_');
    _revReqPidMap[p] = `${base}_${idx}`;
  });

  const ALL_PRODS = Object.keys(PROD_COLORS).concat(
    Object.keys(obtByProd).filter(k => !PROD_COLORS[k])
  );

  function buildTargetRows(sourceProd, targets, disabled) {
    // targets = [{product:'', mt:null}, ...]
    if (!targets || targets.length === 0) targets = [{ product: '', mt: null }];
    return targets.map((t, i) => {
      const pid2 = makeRevPid(sourceProd);
      const opts = `<option value="">— Tetap sama —</option>` +
        ALL_PRODS.map(op =>
          `<option value="${op}" ${op === t.product ? 'selected' : ''}>${op}</option>`
        ).join('');
      const mt = t.mt != null ? Number(t.mt).toLocaleString() : '';
      const isLast  = i === targets.length - 1;
      const canDel  = targets.length > 1;
      return `<div class="revreq-target-row" data-source="${sourceProd}" data-idx="${i}"
        style="display:flex;align-items:center;gap:6px;margin-bottom:5px">
        <div style="width:14px;flex-shrink:0;font-size:10px;color:var(--txt3);text-align:center">→</div>
        <select class="fi revreq-newprod-inp" data-prod="${sourceProd}" data-idx="${i}"
          ${disabled ? 'disabled' : ''}
          style="flex:1;min-width:0;padding:4px 6px;font-size:11.5px;border:1px solid var(--border2);border-radius:5px;background:var(--bg);color:var(--txt)"
          onchange="syncRevReqTotal('${sourceProd}')">
          ${opts}
        </select>
        <input type="text" inputmode="decimal" class="pmt-mt-inp revreq-target-mt" data-prod="${sourceProd}" data-idx="${i}"
          value="${mt}" placeholder="MT (e.g. 123.50)"
          oninput="fmtThousandInline(this);syncRevReqTotal('${sourceProd}')"
          ${disabled ? 'disabled' : ''}
          style="width:80px;flex-shrink:0;text-align:right">
        ${canDel && !disabled ? `<button onclick="removeRevReqTarget('${sourceProd}',${i})"
          style="flex-shrink:0;width:22px;height:22px;border:1px solid var(--border2);border-radius:4px;background:var(--red-bg);color:var(--red2);cursor:pointer;font-size:12px;display:flex;align-items:center;justify-content:center;padding:0"
          title="Hapus baris ini">✕</button>` : '<div style="width:22px"></div>'}
      </div>`;
    }).join('');
  }

  const rows = products.map(p => {
    const pid   = makeRevPid(p);
    const obtMT = obtByProd[p] || 0;
    const req   = existing[p] || {};
    const dot   = prodDot(p);
    const note  = req.note || '';
    // Strict boolean: handle true, "true", 1 — never treat object/undefined as true
    const isReq = req.requested === true || req.requested === 'true' || req.requested === 1;
    const targets = (req.targetProducts && req.targetProducts.length)
                  ? req.targetProducts
                  : [{ product: req.newProduct || '', mt: req.requestedMT || null }];
    const disabled = !canSales || !isReq;

    // Sum of all target MTs for display
    const totalTargetMT = targets.reduce((s,t) => s + (parseFloat(String(t.mt||'').replace(/,/g,''))||0), 0);
    const totalDisp = totalTargetMT > 0
      ? `<span style="font-size:9.5px;color:var(--blue);font-weight:700">${totalTargetMT.toLocaleString()} MT total</span>`
      : '';
    return `<div class="revreq-row" id="revreq-row-${pid}"
      style="padding:10px;border:1px solid var(--border);border-radius:7px;margin-bottom:8px;
        background:${isReq ? 'var(--bg)' : 'var(--bg2)'};
        opacity:${isReq ? '1' : '0.65'};transition:opacity .2s">
      <!-- Row header: checkbox + product info + note -->
      <div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:${isReq?'10px':'0'}">
        <input type="checkbox" class="revreq-chk" data-prod="${p}" data-pid="${pid}"
          ${isReq ? 'checked' : ''} ${canSales?'':'disabled'}
          onchange="toggleRevReqRow('${pid}',this.checked)"
          style="margin-top:3px;flex-shrink:0"
          title="Request revision for ${p}">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
            <div class="pmt-prod-chip">
              <div class="pmt-prod-dot" style="background:${dot}"></div>
              <span style="font-weight:700">${p}</span>
            </div>
            <span style="font-size:9.5px;color:var(--txt3)">Obtained: ${obtMT.toLocaleString()} MT</span>
            ${totalDisp}
          </div>
          <input type="text" class="fi revreq-note-inp" data-prod="${p}"
            value="${note}" placeholder="Alasan / catatan permintaan revisi…"
            ${!isReq || !canSales ? 'disabled' : ''}
            style="margin-top:6px;width:100%;font-size:11px">
        </div>
      </div>
      <!-- Target products (shown only when checked) -->
      <div class="revreq-targets" id="revreq-targets-${pid}"
        style="display:${isReq?'block':'none'};padding-left:24px">
        <div style="font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:var(--txt3);margin-bottom:6px">
          Produk / Qty Tujuan
        </div>
        <div class="revreq-targets-wrap" id="revreq-targets-wrap-${pid}">
          ${buildTargetRows(p, isReq ? targets : [{ product:'', mt:null }], !isReq || !canSales)}
        </div>
        ${canSales ? `<button onclick="addRevReqTarget('${p}')"
          style="margin-top:4px;font-size:10.5px;font-weight:600;padding:3px 10px;border-radius:5px;
            border:1px dashed var(--border2);background:var(--bg2);color:var(--blue);cursor:pointer;
            display:${isReq?'inline-block':'none'}"
          id="revreq-addbtn-${pid}">
          + Tambah Produk Tujuan
        </button>` : ''}
      </div>
    </div>`;
  }).join('');

  wrap.innerHTML = `
    <div style="display:flex;align-items:center;gap:5px;margin-bottom:10px">
      <span style="font-size:11px;font-weight:700;color:var(--txt2)">📋 Revision Request ke CorpSec</span>
      <span class="tti" data-tip="Centang produk yang ingin direvisi (kuantiti atau jenis produk). Satu produk bisa dipecah ke beberapa produk tujuan — klik + Tambah Produk Tujuan untuk split.">i</span>
    </div>
    <div id="revreq-rows-wrap">${rows}</div>
    <div style="margin-top:8px;font-size:10px;color:var(--txt3)">
      <span class="tti tip-right" data-tip="Request ini tidak langsung mengubah data — CorpSec perlu konfirmasi terlebih dahulu sebelum perubahan berlaku" style="display:inline-flex;margin-top:2px">i</span>
    </div>`;
}

/* Add a new target row for a source product */
function addRevReqTarget(sourceProd) {
  const pid  = makeRevPid(sourceProd);
  const wrap = document.getElementById('revreq-targets-wrap-' + pid);
  if (!wrap) return;
  const idx  = wrap.querySelectorAll('.revreq-target-row').length;
  const ALL_PRODS = Object.keys(PROD_COLORS);
  const opts = `<option value="">— Tetap sama —</option>` +
    ALL_PRODS.map(op => `<option value="${op}">${op}</option>`).join('');
  const newRow = document.createElement('div');
  newRow.className = 'revreq-target-row';
  newRow.dataset.source = sourceProd;
  newRow.dataset.idx    = idx;
  newRow.style.cssText  = 'display:flex;align-items:center;gap:6px;margin-bottom:5px';
  newRow.innerHTML = `
    <div style="width:14px;flex-shrink:0;font-size:10px;color:var(--txt3);text-align:center">→</div>
    <select class="fi revreq-newprod-inp" data-prod="${sourceProd}" data-idx="${idx}"
      style="flex:1;min-width:0;padding:4px 6px;font-size:11.5px;border:1px solid var(--border2);border-radius:5px;background:var(--bg);color:var(--txt)"
      onchange="syncRevReqTotal('${sourceProd}')">
      ${opts}
    </select>
    <input type="text" inputmode="decimal" class="pmt-mt-inp revreq-target-mt" data-prod="${sourceProd}" data-idx="${idx}"
      value="" placeholder="MT (e.g. 123.50)"
      oninput="fmtThousandInline(this);syncRevReqTotal('${sourceProd}')"
      style="width:80px;flex-shrink:0;text-align:right">
    <button onclick="removeRevReqTarget('${sourceProd}',${idx})"
      style="flex-shrink:0;width:22px;height:22px;border:1px solid var(--border2);border-radius:4px;background:var(--red-bg);color:var(--red2);cursor:pointer;font-size:12px;display:flex;align-items:center;justify-content:center;padding:0"
      title="Hapus baris ini">✕</button>`;
  wrap.appendChild(newRow);
  // Re-number delete buttons
  rebuildRevReqTargetIndices(sourceProd);
}

/* Remove a target row */
function removeRevReqTarget(sourceProd, idx) {
  const pid  = makeRevPid(sourceProd);
  const wrap = document.getElementById('revreq-targets-wrap-' + pid);
  if (!wrap) return;
  const rows = wrap.querySelectorAll('.revreq-target-row');
  if (rows.length <= 1) return; // keep at least 1
  if (rows[idx]) rows[idx].remove();
  rebuildRevReqTargetIndices(sourceProd);
  syncRevReqTotal(sourceProd);
}

/* Re-number data-idx after add/remove */
function rebuildRevReqTargetIndices(sourceProd) {
  const pid  = makeRevPid(sourceProd);
  const wrap = document.getElementById('revreq-targets-wrap-' + pid);
  if (!wrap) return;
  wrap.querySelectorAll('.revreq-target-row').forEach((row, i) => {
    row.dataset.idx = i;
    row.querySelectorAll('[data-idx]').forEach(el => el.dataset.idx = i);
    const delBtn = row.querySelector('button[onclick*="removeRevReqTarget"]');
    if (delBtn) delBtn.setAttribute('onclick', `removeRevReqTarget('${sourceProd}',${i})`);
    const rows = wrap.querySelectorAll('.revreq-target-row');
    if (delBtn) delBtn.style.display = rows.length > 1 ? 'flex' : 'none';
  });
}

/* Update total MT display next to product name */
function syncRevReqTotal(sourceProd) {
  const pid  = makeRevPid(sourceProd);
  const wrap = document.getElementById('revreq-targets-wrap-' + pid);
  if (!wrap) return;
  let total = 0;
  wrap.querySelectorAll('.revreq-target-mt').forEach(inp => {
    total += parseFloat(inp.value.replace(/,/g,'')) || 0;
  });
  // Update total badge in row header
  const rowEl = document.getElementById('revreq-row-' + pid);
  if (!rowEl) return;
  let badge = rowEl.querySelector('.revreq-total-badge');
  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'revreq-total-badge';
    badge.style.cssText = 'font-size:9.5px;color:var(--blue);font-weight:700';
    const chip = rowEl.querySelector('.pmt-prod-chip');
    if (chip && chip.parentNode) chip.parentNode.insertBefore(badge, chip.nextSibling);
  }
  badge.textContent = total > 0 ? `${total.toLocaleString()} MT total` : '';
}

function toggleRevReqRow(pid, checked) {
  const row     = document.getElementById('revreq-row-' + pid);
  const targets = document.getElementById('revreq-targets-' + pid);
  if (!row) return;

  row.style.opacity    = checked ? '1' : '0.65';
  row.style.background = checked ? 'var(--bg)' : 'var(--bg2)';

  // Update margin-bottom on header div
  const headerDiv = row.firstElementChild;
  if (headerDiv) headerDiv.style.marginBottom = checked ? '10px' : '0';

  // Show/hide targets section
  if (targets) {
    targets.style.display = checked ? 'block' : 'none';
    targets.querySelectorAll('input,select').forEach(el => {
      el.disabled = !checked;
      if (!checked) {
        if (el.tagName === 'SELECT') el.selectedIndex = 0;
        else el.value = '';
      }
    });
    const addBtn = targets.querySelector('button');
    if (addBtn) addBtn.style.display = checked ? '' : 'none';
  }

  // Enable/disable note input
  const noteInp = row.querySelector('.revreq-note-inp');
  if (noteInp) {
    noteInp.disabled = !checked;
    if (!checked) noteInp.value = '';
  }

  if (!checked) {
    const badge = row.querySelector('.revreq-total-badge');
    if (badge) badge.textContent = '';
  }

  // Sync to live co object immediately so state is consistent
  const chk = row.querySelector('.revreq-chk');
  const prod = chk ? chk.dataset.prod : null;
  if (prod) {
    const co = getCurrentEditCo();
    if (co) {
      if (!co.salesRevRequest) co.salesRevRequest = {};
      if (!checked) {
        delete co.salesRevRequest[prod]; // remove unchecked product
      } else {
        co.salesRevRequest[prod] = co.salesRevRequest[prod] || {};
        co.salesRevRequest[prod].requested = true;
      }
    }
  }
}

/* Collect revision request data from Sales form */
function collectRevisionRequestData(co) {
  if (!co) return;
  co.salesRevRequest = co.salesRevRequest || {};
  let hasAny = false;
  document.querySelectorAll('.revreq-chk').forEach(chk => {
    const prod = chk.dataset.prod;
    const pid  = chk.dataset.pid;
    const row  = document.getElementById('revreq-row-' + pid);
    if (!row) return;
    const requested = chk.checked;
    const note      = row.querySelector('.revreq-note-inp')?.value.trim() || '';

    // Collect all target product rows
    const targetRows = row.querySelectorAll('.revreq-target-row');
    const targets = [];
    targetRows.forEach(tr => {
      const sel = tr.querySelector('.revreq-newprod-inp');
      const inp = tr.querySelector('.revreq-target-mt');
      const product = sel ? sel.value : '';
      const raw     = inp ? inp.value.replace(/,/g,'') : '';
      const mt      = raw ? parseFloat(raw.replace(/,/g,'')) : null;
      if (product || mt) targets.push({ product, mt });
    });

    if (requested) {
      // Backward compat: keep newProduct + requestedMT as first target
      const first = targets[0] || {};
      co.salesRevRequest[prod] = {
        requested: true,
        newProduct:   first.product || null,
        requestedMT:  first.mt      || null,
        targetProducts: targets,
        note,
        status: co.salesRevRequest[prod]?.status || null,
        confirmedMT: co.salesRevRequest[prod]?.confirmedMT || null,
      };
      hasAny = true;
    } else {
      delete co.salesRevRequest[prod];
    }
  });
  if (!hasAny) co.salesRevRequest = {};
}