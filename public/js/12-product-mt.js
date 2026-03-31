/* ═══════════════════════════════════════
   PRODUCT MT TABLES
   buildProductMTTables, renames,
   updateObtainedTotal, collectProductMTs
═══════════════════════════════════════ */

/* ══════════════════════════════════════════════════════════════
   buildProductMTTables(co)
   ─────────────────────────────────────────────────────────────
   Renders two dynamic per-product MT tables for the CorpSec form:
     A) Submit MT table   → #submitProdTableWrap
     B) Obtained MT table → #obtainedProdTableWrap

   Data source: co.cycles[0].products (Submit #1 MT per product)
                co.cycles[1].products (Obtained #1 MT per product)
   Falls back to co.products list when cycles are missing.

   Each product row gets:
     .pmt-submit-inp   (class) with data-prod="PRODUCT_NAME"
     .pmt-obtained-inp (class) with data-prod="PRODUCT_NAME"
   so saveEdit() can collect them without fixed IDs.
══════════════════════════════════════════════════════════════ */

const PROD_DOT_COLORS = {
  'GL BORON':          '#0369a1',
  'GI BORON':          '#0f766e',
  'BORDES ALLOY':      '#dc2626',
  'AS STEEL':          '#64748b',
  'SHEETPILE':         '#b45309',
  'SEAMLESS PIPE':     '#0d6946',
  'HOLLOW PIPE':       '#78716c',
  'PPGL CARBON':       '#7c3aed',
  'ERW PIPE OD≤140mm': '#9333ea',
  'ERW PIPE OD>140mm': '#0891b2',
  'HRC/HRPO ALLOY':    '#ca8a04',
};
const prodDot = p => PROD_DOT_COLORS[p] || '#94a3b8';

/* HS Codes per product — Indonesian Customs Tariff (BTKI 2022) */
const PROD_HS_CODES = {
  'GL BORON':          '7210.41.11',
  'GI BORON':          '7210.49.19',
  'BORDES ALLOY':      '7208.51.00',
  'AS STEEL':          '7228.30.00',
  'SHEETPILE':         '7301.10.00',
  'SEAMLESS PIPE':     '7304.31.00',
  'HOLLOW PIPE':       '7306.30.00',
  'PPGL CARBON':       '7210.61.11',
  'ERW PIPE OD≤140mm': '7306.30.10',
  'ERW PIPE OD>140mm': '7306.30.90',
  'HRC/HRPO ALLOY':    '7225.30.00',
};
const prodHS = p => PROD_HS_CODES[p] || '—';

function buildProductMTTables(co) {
  const products = co.products || [];
  const cycles   = co.cycles   || [];

  // Find the primary Submit and Obtained cycles
  const subCy = cycles.find(cy => /^submit\s*#?1/i.test(cy.type))
             || cycles.find(cy => /^submit/i.test(cy.type) && !/obtained/i.test(cy.type));
  const obtCy = cycles.find(cy => /^obtained\s*#?1/i.test(cy.type))
             || cycles.find(cy => /^obtained/i.test(cy.type));

  const subProds = (subCy && subCy.products) ? subCy.products : {};
  const obtProds = (obtCy && obtCy.products) ? obtCy.products : {};

  // Use union of products from both cycles + co.products
  const allProds = [...new Set([
    ...products,
    ...Object.keys(subProds),
    ...Object.keys(obtProds),
  ])].filter(Boolean);

  // ── A. Submit MT table ──────────────────────────────────────────
  const subWrap = g('submitProdTableWrap');
  if (subWrap) {
    if (!allProds.length) {
      subWrap.innerHTML = '<div class="pmt-note">No products found for this company.</div>';
    } else {
      // All master products for dropdown — each option shows name + HS code
      const ALL_PROD_KEYS = Object.keys(PROD_DOT_COLORS);

      let rows = allProds.map((p, ri) => {
        const v  = typeof subProds[p] === 'number' ? subProds[p].toLocaleString() : '';
        const hs = prodHS(p);
        const opts = ALL_PROD_KEYS.map(op =>
          `<option value="${op}"${op === p ? ' selected' : ''}>${op} · HS ${prodHS(op)}</option>`
        ).join('');
        return `<tr data-orig-prod="${p}">
          <td style="padding:5px 8px">
            <div class="pmt-sel-wrap">
              <select
                id="psel-${ri}"
                class="pmt-prod-select pmt-prod-rename"
                data-row="${ri}"
                data-orig="${p}"
                title="Change product — triggers SPI Issued Revision on Save"
                onchange="onProdSelectChange(this)">
                ${opts}
              </select>
              <div class="pmt-hs-row">
                <div class="pmt-prod-dot" id="pdot-${ri}" style="background:${prodDot(p)}"></div>
                <span id="phsv-${ri}" class="pmt-hs-chip">HS ${hs}</span>
                <span id="prev-${ri}" class="pmt-rev-pill">🔄 Revision</span>
              </div>
            </div>
          </td>
          <td style="width:145px;padding:5px 8px">
            <input type="text" inputmode="numeric"
              class="pmt-mt-inp pmt-submit-inp"
              id="pmt-${ri}"
              data-prod="${p}"
              value="${v}"
              placeholder="0"
              oninput="fmtThousandInline(this);livePreview()">
          </td>
        </tr>`;
      }).join('');

      const totalSubmit = allProds.reduce((s, p) => {
        const v = typeof subProds[p] === 'number' ? subProds[p] : 0;
        return s + v;
      }, 0);

      subWrap.innerHTML = `
        <table class="pmt-table">
          <thead>
            <tr>
              <th>Product &amp; HS Code <span class="tti" data-tip="Gunakan dropdown untuk memilih atau mengganti produk. Kode HS update otomatis saat produk diganti. Mengganti nama produk akan membuat record SPI Issued → Revision saat Save, dan akan merambat ke semua chart, tabel, dan data master.">i</span></th>
              <th class="t-r" style="width:145px">Submit MT</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
          <tfoot>
            <tr class="pmt-total-row">
              <td>Total Submitted</td>
              <td class="pmt-total-val" id="submitMTTotal">${totalSubmit.toLocaleString()} MT</td>
            </tr>
          </tfoot>
        </table>`;
    }
  }

  // ── B. Obtained MT table ────────────────────────────────────────
  const obtWrap = g('obtainedProdTableWrap');
  if (obtWrap) {
    if (!allProds.length) {
      obtWrap.innerHTML = '<div class="pmt-note">No products found for this company.</div>';
    } else {
      let rows = allProds.map(p => {
        const sv = typeof subProds[p] === 'number' ? subProds[p].toLocaleString() + ' MT' : '—';
        const ov = typeof obtProds[p] === 'number' ? obtProds[p].toLocaleString() : '';
        const hs = prodHS(p);
        return `<tr>
          <td style="padding:5px 8px">
            <div class="pmt-prod-chip" style="margin-bottom:3px">
              <div class="pmt-prod-dot" style="background:${prodDot(p)}"></div>
              <span style="font-weight:700">${p}</span>
            </div>
            <span class="pmt-hs-chip">HS ${hs}</span>
          </td>
          <td class="pmt-ref-mt">${sv}</td>
          <td style="width:140px;padding:5px 8px">
            <input type="text" inputmode="numeric"
              class="pmt-mt-inp pmt-obtained-inp"
              data-prod="${p}"
              value="${ov}"
              placeholder="0"
              oninput="fmtThousandInline(this);updateObtainedTotal();livePreview()">
          </td>
        </tr>`;
      }).join('');

      const totalObtained = allProds.reduce((s, p) => {
        const v = typeof obtProds[p] === 'number' ? obtProds[p] : 0;
        return s + v;
      }, 0);

      obtWrap.innerHTML = `
        <table class="pmt-table">
          <thead>
            <tr>
              <th>Product &amp; HS Code <span class="tti" data-tip="Satu nomor PERTEK mencakup semua produk. Isi Obtained MT per produk secara individual — meski dokumen PERTEK hanya satu. Total akan masuk ke KPI 2 (SPI/PERTEK Obtained).">i</span></th>
              <th class="t-r" style="width:120px">Submitted</th>
              <th class="t-r" style="width:140px">Obtained MT ↓</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
          <tfoot>
            <tr class="pmt-total-row">
              <td colspan="2">Total Obtained</td>
              <td class="pmt-total-val" id="obtainedMTTotal">${totalObtained.toLocaleString()} MT</td>
            </tr>
          </tfoot>
        </table>`;
    }
  }

  // Re-apply role-based lock state to the freshly rendered inputs
  if (currentRole) {
    const allowed = ROLE_PERMISSIONS[currentRole] || [];
    const canSub = allowed.includes('submitProdTable');
    document.querySelectorAll('.pmt-submit-inp').forEach(inp => {
      inp.disabled = !canSub;
    });
    document.querySelectorAll('.pmt-prod-rename').forEach(sel => {
      sel.disabled = !canSub;
    });
    document.querySelectorAll('.pmt-obtained-inp').forEach(inp => {
      inp.disabled = !allowed.includes('obtainedProdTable');
    });
  }
}

/* ══════════════════════════════════════════════════════════════════════
   PRODUCT RENAME — dropdown  (CorpSec / SuperAdmin only)
   _pendingRenames: { origProd → newProd }   accumulated until Save
   ══════════════════════════════════════════════════════════════════════ */
const _pendingRenames = {};

function onProdSelectChange(sel) {
  const ri       = parseInt(sel.dataset.row, 10);
  const origProd = sel.dataset.orig;
  const newProd  = sel.value;

  // Live UI: update dot color
  const dot = document.getElementById('pdot-' + ri);
  if (dot) dot.style.background = prodDot(newProd);

  // Live UI: update HS chip text
  const hsEl = document.getElementById('phsv-' + ri);
  if (hsEl) hsEl.textContent = 'HS ' + prodHS(newProd);

  // Live UI: show / hide Revision pill
  const pill = document.getElementById('prev-' + ri);
  if (pill) pill.classList.toggle('show', newProd !== origProd);

  // Sync the MT input's data-prod so collectProductMTs reads the new name
  const mtInp = document.getElementById('pmt-' + ri);
  if (mtInp) mtInp.dataset.prod = newProd;

  // Track pending renames
  if (newProd !== origProd) {
    _pendingRenames[origProd] = newProd;
  } else {
    delete _pendingRenames[origProd];
  }

  livePreview();
}

/* ══════════════════════════════════════════════════════════════════════
   applyProductRenames — called inside saveEdit after core data write
   For each origProd → newProd rename:
     1. co.products[] array
     2. Every cycle's products{} map
     3. co.shipments keys
     4. RA record product label
     5. Injects Revision #N + Obtained (Revision #N) cycles
     6. Sets revType / revFrom / revTo / revStatus so dashboard shows "Under Revision"
   ══════════════════════════════════════════════════════════════════════ */
function applyProductRenames(co) {
  const renames = Object.entries(_pendingRenames);
  if (!renames.length) return;

  renames.forEach(([origProd, newProd]) => {
    // 1. co.products list
    if (Array.isArray(co.products)) {
      const idx = co.products.indexOf(origProd);
      if (idx >= 0) co.products.splice(idx, 1, newProd);
      else if (!co.products.includes(newProd)) co.products.push(newProd);
    }

    // 2. All existing cycles — rename products map keys
    (co.cycles || []).forEach(cy => {
      if (cy.products && Object.prototype.hasOwnProperty.call(cy.products, origProd)) {
        cy.products[newProd] = cy.products[origProd];
        delete cy.products[origProd];
      }
    });

    // 3. co.shipments keys
    if (co.shipments && co.shipments[origProd]) {
      co.shipments[newProd] = co.shipments[origProd];
      delete co.shipments[origProd];
    }

    // 4. RA record product label
    const raRec = RA.find(r => r.code === co.code);
    if (raRec && raRec.product === origProd) raRec.product = newProd;

    // 5. Inject Revision cycle pair
    const today = new Date().toLocaleDateString('en-GB',
      {day:'2-digit', month:'2-digit', year:'numeric'}).split('/').join('/');
    const existingRevs = (co.cycles || []).filter(cy => /^revision #/i.test(cy.type));
    const nextRevNum   = existingRevs.length + 1;

    // MT for this product (from Obtained #1 cycle)
    const obtCy  = (co.cycles || []).find(cy => /^obtained\s*#?1/i.test(cy.type));
    const origMT = (obtCy && obtCy.products) ? (obtCy.products[newProd] || 0) : 0;

    co.cycles = co.cycles || [];
    co.cycles.push({
      type:        'Revision #' + nextRevNum,
      mt:          -origMT,
      products:    { [origProd]: origMT },
      submitType:  'Submit MOI Perubahan (Revision #' + nextRevNum + ')',
      submitDate:  today,
      releaseType: 'PERTEK Perubahan (Revision #' + nextRevNum + ')',
      releaseDate: 'TBA',
      status:      'Product change: ' + origProd + ' → ' + newProd +
                   ' · Submitted ' + today + ' · Awaiting PERTEK Perubahan',
    });
    co.cycles.push({
      type:        'Obtained (Revision #' + nextRevNum + ')',
      mt:          origMT,
      products:    { [newProd]: origMT },
      submitType:  'Submit MOT Perubahan (Revision #' + nextRevNum + ')',
      submitDate:  'TBA',
      releaseType: 'SPI Perubahan (Revision #' + nextRevNum + ')',
      releaseDate: 'TBA',
      status:      'Awaiting SPI Perubahan — product changed from ' + origProd + ' to ' + newProd,
    });

    // 6. Mark company as Under Revision
    co.revType       = 'active';
    co.revSubmitDate = today;
    co.revStatus     = 'Menunggu PERTEK Perubahan — ' + origProd + ' → ' + newProd;
    co.revNote       = 'Product change: ' + origProd + ' → ' + newProd +
                       (origMT > 0 ? ' (' + origMT.toLocaleString() + ' MT)' : '');
    co.revFrom = co.revFrom || [];
    co.revTo   = co.revTo   || [];
    co.revMT   = co.revMT   || 0;
    co.revFrom.push({ prod: origProd, mt: origMT, label: 'Original (Rev #' + nextRevNum + ')' });
    co.revTo.push(  { prod: newProd,  mt: origMT, label: 'Revised (Rev #'  + nextRevNum + ')' });
    co.revMT += origMT;
    co.spiRef = (co.spiRef || '') +
                ' · Rev #' + nextRevNum + ': ' + origProd + '→' + newProd;
  });

  // Clear pending map after applying
  Object.keys(_pendingRenames).forEach(k => delete _pendingRenames[k]);
}

/* Thousand-separator for inline pmt inputs (no fixed ID) */
function fmtThousandInline(el) {
  const raw = el.value.replace(/[^0-9]/g, '');
  el.value = raw ? Number(raw).toLocaleString() : '';
  // Update submit total live
  let st = 0;
  document.querySelectorAll('.pmt-submit-inp').forEach(i => {
    const n = parseInt((i.value || '').replace(/,/g,''), 10);
    if (!isNaN(n)) st += n;
  });
  const stEl = g('submitMTTotal');
  if (stEl) stEl.textContent = st.toLocaleString() + ' MT';
}

function updateObtainedTotal() {
  let tot = 0;
  document.querySelectorAll('.pmt-obtained-inp').forEach(i => {
    const n = parseInt((i.value || '').replace(/,/g,''), 10);
    if (!isNaN(n)) tot += n;
  });
  const el = g('obtainedMTTotal');
  if (el) el.textContent = tot.toLocaleString() + ' MT';
}

/* Read all per-product MT inputs → { PRODUCT: mt, ... } and total */
function collectProductMTs(cls) {
  const result = {};
  let total = 0;
  document.querySelectorAll('.' + cls).forEach(inp => {
    const prod = inp.dataset.prod;
    const n    = parseInt((inp.value || '').replace(/,/g,''), 10);
    if (prod && !isNaN(n)) {
      result[prod] = n;
      total += n;
    }
  });
  return { byProd: result, total };
}

/* ── Load current values into all fields ──────────────── */
function loadEdit() {
  // Clear any leftover renames from previous company selection
  Object.keys(_pendingRenames).forEach(k => delete _pendingRenames[k]);

  const c  = gv('editCo');
  const ef = g('editFields');
  if (!c) { ef.style.display = 'none'; return; }

  // Find record — could be in SPI or PENDING
  const co  = getSPI(c) || PENDING.find(p => p.code === c);
  const ra  = getRA(c);
  const ac  = co ? (co.cycles || []) : [];

  // Relevant cycles
  const subCy = ac.find(cy => /^submit\s*#?1/i.test(cy.type))
             || ac.find(cy => /^submit/i.test(cy.type) && !/obtained/i.test(cy.type));
  const obtCy = ac.find(cy => /^obtained\s*#?1/i.test(cy.type))
             || ac.find(cy => /^obtained/i.test(cy.type));

  // ── Submission ──
  // eSubmitMT removed — now per-product table.  submitDate stays single.
  g('eSubmitDate').value = subCy ? (subCy.submitDate || '') : '';

  // ── PERTEK ──
  const pertekDateRaw = subCy ? subCy.releaseDate : '';
  g('ePertekNo').value   = co ? (co.pertekNo || '') : '';
  g('ePertekDate').value = pertekDateRaw && pertekDateRaw !== 'TBA' ? pertekDateRaw : '';
  // eObtainedMT removed — now per-product table.

  // ── SPI ──
  g('eSpiNo').value   = co ? (co.spiNo || '') : '';
  const spiDateRaw = obtCy ? obtCy.releaseDate : '';
  g('eSpiDate').value = spiDateRaw && spiDateRaw !== 'TBA' ? spiDateRaw : '';

  // ── Status & notes ──
  g('eStatus').value       = co ? (co.spiRef || '') : '';
  // statusUpdate is SUBMISSION-LEVEL — one note per submission, shared across all products
  g('eStatusUpdate').value = co ? (co.statusUpdate || '') : '';

  // ── Other roles ──
  g('eUtilMT').value     = (co && co.utilizationMT != null) ? co.utilizationMT.toLocaleString() : '';
  g('eBerat').value      = ra ? (ra.berat || '') : '';
  g('eETA').value        = ra ? (ra.etaJKT || '') : '';
  g('ePIBRelease').value = ra ? (ra.pibReleaseDate || '') : '';
  g('eTarget').value     = ra && ra.target ? ra.target : '';
  g('eRem').value        = co ? (co.remarks || '') : '';

  // ── Build per-product MT tables (Sections A & B: CorpSec) ──
  if (co) buildProductMTTables(co);

  // ── Build Sales & Ops shipment forms (Sections D & E) ──
  if (co) {
    ensureShipments(co);
    buildSalesOpsForm(co);  // also calls buildReapplyTable + buildRevisionRequestTable
    buildRevMgmtSection(co);
  } else {
    g('salesFormWrap').innerHTML = '<div class="pmt-note" style="color:var(--txt3)">No product data available.</div>';
    g('opsFormWrap').innerHTML   = '<div class="pmt-note" style="color:var(--txt3)">No product data available.</div>';
    const rmb = g('revMgmtBody'); if (rmb) rmb.innerHTML = '<div class="rr-no-active">Select a company above to manage its revision &amp; re-apply cycles.</div>';
  }

  ef.style.display = 'block';

  // Apply role-based field permissions (also locks/unlocks product table inputs)
  applyRolePermissions();
  applyShipmentRoleLock();
  livePreview();
  buildRoleHistory();
}

/* ════════════════════════════════════════════════════════════════════════════
   REVISION & RE-APPLY MANAGEMENT  (CorpSec · SuperAdmin)
   Builds the interactive Section D panel for the selected company.
   Auto-categorizes based on live cycle data, mirrors the SPI Issued
   "Revision & Submit #2 — Product Change Summary" table.
════════════════════════════════════════════════════════════════════════════ */