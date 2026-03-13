/* ═══════════════════════════════════════
   EDIT FORM — Roles, Permissions,
   Live Preview, loadEdit, cancelEdit
═══════════════════════════════════════ */

/* ── Thousand-separator helpers ───────────────────────── */
function fmtThousand(el) {
  const raw = el.value.replace(/[^0-9]/g, '');
  el.value = raw ? Number(raw).toLocaleString() : '';
}
function parseMTField(id) {
  const v = document.getElementById(id).value.replace(/,/g, '');
  const n = parseInt(v, 10);
  return isNaN(n) ? null : n;
}
function g(id) { return document.getElementById(id); }
function gv(id) { return g(id) ? g(id).value.trim() : ''; }

/* ── Live preview ─────────────────────────────────────── */
function livePreview() {
  const c = gv('editCo');
  if (!c) return;
  // Sum per-product submit inputs (replaces single eSubmitMT)
  let sMT = 0;
  document.querySelectorAll('.pmt-submit-inp').forEach(i => {
    const n = parseInt((i.value||'').replace(/,/g,''),10); if (!isNaN(n)) sMT += n;
  });
  if (sMT === 0) sMT = null; // null = "—" in preview
  // Sum per-product obtained inputs (replaces single eObtainedMT)
  let oMT = 0;
  document.querySelectorAll('.pmt-obtained-inp').forEach(i => {
    const n = parseInt((i.value||'').replace(/,/g,''),10); if (!isNaN(n)) oMT += n;
  });
  if (oMT === 0) oMT = null;
  const uMT  = parseMTField('eUtilMT');
  const avq  = (oMT != null && uMT != null) ? oMT - uMT : null;
  const pd   = gv('ePertekDate');
  const sd   = gv('eSpiDate');
  const pn   = gv('ePertekNo');
  const sn   = gv('eSpiNo');
  const who  = currentRole;
  const roleColors = { CorpSec:'upd-corpsec', Sales:'upd-sales', Operations:'upd-ops', SuperAdmin:'upd-superadmin' };
  const whoTag = who ? `<span class="upd-tag ${roleColors[who]||'upd-system'}">${who}</span>` : '';
  const hasPERTEK = pd && pd !== 'TBA';
  const hasSPI    = sd && sd !== 'TBA';
  const cat = hasSPI    ? '<span style="color:var(--teal);font-weight:700">✅ SPI Issued</span>'
            : hasPERTEK ? '<span style="color:var(--orange);font-weight:700">⏳ PERTEK Terbit — SPI Belum</span>'
            : '<span style="color:var(--txt3)">🔄 Pending / In Process</span>';
  const avqColor = avq != null ? (avq > 0 ? 'var(--teal)' : 'var(--red2)') : 'var(--txt3)';
  g('epContent').innerHTML =
    `${whoTag} <strong>${c}</strong> &nbsp;·&nbsp; ` +
    `Submit: <strong>${sMT != null ? sMT.toLocaleString() : '—'} MT</strong> &nbsp;·&nbsp; ` +
    `Obtained: <strong>${oMT != null ? oMT.toLocaleString() : '—'} MT</strong><br>` +
    `Utilization: <strong>${uMT != null ? uMT.toLocaleString() : '—'} MT</strong> &nbsp;·&nbsp; ` +
    `Available Quota: <strong style="color:${avqColor}">${avq != null ? avq.toLocaleString() : '—'} MT</strong><br>` +
    `PERTEK No: <strong>${pn||'—'}</strong> &nbsp; Terbit: <strong>${pd||'TBA'}</strong> &nbsp;·&nbsp; ` +
    `SPI No: <strong>${sn||'—'}</strong> &nbsp; Terbit: <strong>${sd||'TBA'}</strong><br>` +
    `Category: ${cat}`;
}

/* ── Cancel ───────────────────────────────────────────── */
function cancelEdit() {
  g('editFields').style.display = 'none';
  g('epContent').innerHTML = '—';
}

/* ══════════════════════════════════════════════════
   ROLE-BASED ACCESS CONTROL
══════════════════════════════════════════════════ */
let currentRole = null; // null = no role selected

/* Role → which field IDs are EDITABLE (all others locked) */
const ROLE_PERMISSIONS = {
  // submitProdTable / obtainedProdTable = the dynamic per-product MT inputs (no single eSubmitMT/eObtainedMT anymore)
  // salesShipTable / opsShipTable = the new multi-product multi-shipment tables (Sections D & E)
  CorpSec:    ['eSubmitDate','ePertekNo','ePertekDate','eSpiNo','eSpiDate','eStatus','eStatusUpdate',
               'submitProdTable','obtainedProdTable'],
  Sales:      ['salesShipTable','eTarget'],
  Operations: ['opsShipTable'],
  SuperAdmin: ['eSubmitDate','ePertekNo','ePertekDate','eSpiNo','eSpiDate','eStatus','eStatusUpdate',
               'submitProdTable','obtainedProdTable',
               'salesShipTable','opsShipTable','eTarget','eRem'],
};

/* Sections locked per role */
const SECTION_ACCESS = {
  CorpSec:    ['sec-submission','sec-pertek','sec-spi','sec-revision-mgmt'],
  Sales:      ['sec-sales'],
  Operations: ['sec-operations'],
  SuperAdmin: ['sec-submission','sec-pertek','sec-spi','sec-revision-mgmt','sec-sales','sec-operations','sec-remarks'],
};

function selectRole(role, btn) {
  currentRole = role;

  // Update button visual state
  document.querySelectorAll('.role-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  // Hide the lock message, enable company select
  g('roleLockMsg').style.display = 'none';
  g('editCo').disabled = false;
  g('editCo').style.cursor = '';

  // Update active role badge in footer
  const roleLabels = {
    CorpSec:    '🏛 CorpSec — can edit: Submission · PERTEK · SPI · Status Update',
    Sales:      '💼 Sales — can edit: Utilization per Product · ETA per Shipment · Target Re-Apply',
    Operations: '🚢 Operations — can edit: Realized MT per Shipment · PIB Release Date',
    SuperAdmin: '⚙️ Super Admin — full access to all fields',
  };
  const el = g('activeRoleBadge');
  if (el) {
    const roleColors = { CorpSec:'ral-corpsec', Sales:'ral-sales', Operations:'ral-ops', SuperAdmin:'ral-super' };
    el.innerHTML = `<span class="role-access-label ${roleColors[role]||''}">${roleLabels[role]||role}</span>`;
  }

  // Apply permissions if fields are already visible
  if (g('editFields').style.display !== 'none') {
    applyRolePermissions();
    livePreview();
  }
}

function applyRolePermissions() {
  if (!currentRole) return;

  const allowed    = ROLE_PERMISSIONS[currentRole] || [];
  const secAllowed = SECTION_ACCESS[currentRole]   || [];

  // All known static field IDs (dynamic product-MT inputs handled separately below)
  // Note: eBerat, ePIBRelease, eETA, eUtilMT are now hidden (legacy compat) — handled via shipment tables
  const ALL_FIELDS = ['eSubmitDate','ePertekNo','ePertekDate',
                      'eSpiNo','eSpiDate','eStatus','eStatusUpdate','eTarget','eRem'];

  // Apply shipment table locks
  applyShipmentRoleLock();

  // ── Dynamic per-product MT inputs ────────────────────────────────
  // These are <input class="pmt-submit-inp"> and <input class="pmt-obtained-inp">
  // generated at runtime by buildProductMTTables(). Enable/disable by class + wrap opacity.
  const canSubmitProds   = allowed.includes('submitProdTable');
  const canObtainedProds = allowed.includes('obtainedProdTable');

  document.querySelectorAll('.pmt-submit-inp').forEach(inp => {
    inp.disabled = !canSubmitProds;
  });
  document.querySelectorAll('.pmt-prod-rename').forEach(sel => {
    sel.disabled = !canSubmitProds;
  });
  document.querySelectorAll('.pmt-obtained-inp').forEach(inp => {
    inp.disabled = !canObtainedProds;
  });

  const wSub = g('wrap-submitProdTable');
  if (wSub) {
    wSub.style.opacity = canSubmitProds ? '1' : '0.55';
    wSub.style.cursor  = canSubmitProds ? '' : 'not-allowed';
    wSub.title         = canSubmitProds ? '' : 'Restricted by role';
  }
  const wObt = g('wrap-obtainedProdTable');
  if (wObt) {
    wObt.style.opacity = canObtainedProds ? '1' : '0.55';
    wObt.style.cursor  = canObtainedProds ? '' : 'not-allowed';
    wObt.title         = canObtainedProds ? '' : 'Restricted by role';
  }
  // ─────────────────────────────────────────────────────────────────
  const ALL_SECTIONS = ['sec-submission','sec-pertek','sec-spi','sec-revision-mgmt','sec-operations','sec-sales','sec-remarks'];

  // Enable/disable individual fields
  ALL_FIELDS.forEach(id => {
    const el = g(id);
    if (!el) return;
    const isAllowed = allowed.includes(id);
    el.disabled = !isAllowed;
    const wrap = g('wrap-' + id);
    if (wrap) {
      wrap.style.opacity   = isAllowed ? '1' : '0.55';
      wrap.style.cursor    = isAllowed ? '' : 'not-allowed';
      wrap.title           = isAllowed ? '' : 'Restricted by role';
    }
  });

  // Lock/unlock section cards visually
  ALL_SECTIONS.forEach(secId => {
    const el = g(secId);
    if (!el) return;
    const isOpen = secAllowed.includes(secId);
    el.classList.toggle('locked', !isOpen);
    // Add/remove lock indicator in section header
    const hd = el.querySelector('.ef-sec-hd');
    if (hd) {
      let lockIco = hd.querySelector('.sec-lock-ico');
      if (!isOpen) {
        if (!lockIco) {
          lockIco = document.createElement('span');
          lockIco.className = 'sec-lock-ico';
          lockIco.style.cssText = 'font-size:11px;margin-left:6px;opacity:.6';
          lockIco.textContent = '🔒';
          el.querySelector('.ef-sec-title').appendChild(lockIco);
        }
      } else if (lockIco) {
        lockIco.remove();
      }
    }
  });

  // Enable save button once role is selected and company is selected
  const saveBtn = g('saveBtn');
  if (saveBtn) {
    saveBtn.disabled = false;
    saveBtn.style.opacity = '1';
    saveBtn.style.cursor  = '';
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   SALES & OPERATIONS — SHIPMENT-BASED FORM ENGINE
   ──────────────────────────────────────────────────────────────────────────

   DATA MODEL (per company, stored in co.shipments):
   co.shipments = {
     "GL BORON": [
       { lot: 1, utilMT: 200, etaJKT: "07 Mar 26", note: "KEWEI 65G",
         realMT: 200, pibDate: "14 Mar 26", arrived: true },
       { lot: 2, utilMT: 150, etaJKT: "10 Apr 26", note: "", realMT: null, pibDate: "", arrived: false }
     ],
     "SHEETPILE": [ ... ]
   }

   VALIDATION RULES:
   - utilMT per lot ≤ remaining PERTEK quota per product
   - realMT per lot ≤ utilMT of same lot
   - Total utilMT per product ≤ obtainedMT per product (from Obtained #1 cycle)
   ══════════════════════════════════════════════════════════════════════════ */

/* ── Get obtained MT per product for a company ── */
function getObtainedByProd(co) {
  const result = {};
  if (!co) return result;

  // Sum ALL Obtained #N cycles (covers #1 + #2 re-apply cycles)
  const cycles = co.cycles || [];
  cycles.forEach(cy => {
    if (!/^obtained/i.test(cy.type)) return;
    if (!cy.products) return;
    Object.entries(cy.products).forEach(([p, v]) => {
      const n = typeof v === 'number' ? v : parseFloat(v);
      if (!isNaN(n) && n > 0) result[p] = (result[p] || 0) + n;
    });
  });

  // Per-product fallback: for products in co.products that aren't in any cycle,
  // distribute the remaining co.obtained evenly among them
  const covered  = Object.keys(result);
  const missing  = (co.products || []).filter(p => !covered.includes(p));
  if (missing.length) {
    const coveredTotal = covered.reduce((s, p) => s + result[p], 0);
    const remainder    = Math.max(0, (co.obtained || 0) - coveredTotal);
    const share        = remainder > 0 ? Math.round(remainder / missing.length) : 0;
    missing.forEach(p => { if (share > 0) result[p] = share; });
  }

  // Last resort: if nothing found at all, split co.obtained evenly
  if (!Object.keys(result).length && co.products && co.obtained) {
    const n = co.products.length;
    co.products.forEach(p => { result[p] = Math.round(co.obtained / n); });
  }

  return result;
}

/* ── Ensure co.shipments exists and has arrays for each product ── */
function ensureShipments(co) {
  if (!co.shipments) co.shipments = {};
  const obtByProd = getObtainedByProd(co);
  Object.keys(obtByProd).forEach(p => {
    if (!co.shipments[p]) co.shipments[p] = [];
    // Normalize existing lots: ensure lotNo is always set
    co.shipments[p].forEach((l, i) => {
      if (l.lotNo == null) l.lotNo = (l.lot != null ? l.lot : i + 1);
    });
    // Ensure at least one lot exists
    if (co.shipments[p].length === 0) {
      co.shipments[p].push({ lotNo: 1, utilMT: null, etaJKT: '', note: '', realMT: null, pibDate: '', arrived: false });
    }
  });
  return co.shipments;
}

/* ── Total util MT used for a product across all lots ── */
function totalUtilForProd(shipments, prod) {
  return (shipments[prod] || []).reduce((s, lot) => s + (lot.utilMT || 0), 0);
}

/* ── Remaining quota for a product (obtained - all lots utilMT) ── */
function remainingQuota(co, prod) {
  const obtained = (getObtainedByProd(co))[prod] || 0;
  const used     = totalUtilForProd(co.shipments || {}, prod);
  return obtained - used;
}

/* ════════════════════════════════════════════════════════════════════
   buildSalesOpsForm(co)
   Renders both the Sales form (#salesFormWrap) and the Ops form
   (#opsFormWrap) dynamically for the selected company.
════════════════════════════════════════════════════════════════════ */