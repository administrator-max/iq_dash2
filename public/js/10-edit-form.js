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
               'submitProdTable','obtainedProdTable','corpsecRevConfirm'],
  Sales:      ['salesShipTable','eTarget','salesRevReq'],
  Operations: ['opsShipTable'],
  SuperAdmin: ['eSubmitDate','ePertekNo','ePertekDate','eSpiNo','eSpiDate','eStatus','eStatusUpdate',
               'submitProdTable','obtainedProdTable','corpsecRevConfirm',
               'salesShipTable','opsShipTable','eTarget','salesRevReq','eRem'],
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
    buildRoleHistory();
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

  // Show only sections for current role (hide others completely)
  ALL_SECTIONS.forEach(secId => {
    const el = g(secId);
    if (!el) return;
    const isOpen = secAllowed.includes(secId);
    // Hide sections not belonging to this role; show allowed ones
    el.style.display = isOpen ? '' : 'none';
    el.classList.toggle('locked', false); // clear any old locked class
    // Remove any leftover lock icons
    const lockIco = el.querySelector('.sec-lock-ico');
    if (lockIco) lockIco.remove();
  });

  // ── Revision/Re-Apply active → disable Submission, PERTEK, SPI sections ──
  // When a company has an active revision or re-apply, CorpSec cannot edit
  // the original submission data to prevent accidental overwrites.
  // SuperAdmin remains unrestricted.
  const editCoCode = gv('editCo');
  const editCo     = editCoCode ? (getSPI(editCoCode) || PENDING.find(p => p.code === editCoCode)) : null;
  const hasActiveRev = editCo && editCo.revType && editCo.revType !== 'none' && editCo.revType !== 'clean';

  if (hasActiveRev && currentRole !== 'SuperAdmin') {
    // Disable all fields in Submission, PERTEK, SPI sections
    const LOCKED_BY_REV = ['eSubmitDate','ePertekNo','ePertekDate',
                            'eSpiNo','eSpiDate','eStatus','eStatusUpdate'];
    const LOCKED_PRODS  = ['submitProdTable','obtainedProdTable'];

    LOCKED_BY_REV.forEach(id => {
      const el = g(id); if (!el) return;
      el.disabled = true;
      const wrap = g('wrap-' + id);
      if (wrap) {
        wrap.style.opacity = '0.45';
        wrap.style.cursor  = 'not-allowed';
        wrap.title         = 'Tidak bisa diedit — sedang ada Revision / Re-Apply aktif';
      }
    });

    // Disable product MT tables
    document.querySelectorAll('.pmt-submit-inp,.pmt-prod-rename,.pmt-obtained-inp').forEach(el => {
      el.disabled = true;
    });
    [g('wrap-submitProdTable'), g('wrap-obtainedProdTable')].forEach(wrap => {
      if (!wrap) return;
      wrap.style.opacity = '0.45';
      wrap.style.cursor  = 'not-allowed';
      wrap.title         = 'Tidak bisa diedit — sedang ada Revision / Re-Apply aktif';
    });

    // Add banner notice to each locked section
    ['sec-submission','sec-pertek','sec-spi'].forEach(secId => {
      const sec = g(secId); if (!sec) return;
      // Add banner if not already there
      if (!sec.querySelector('.rev-lock-banner')) {
        const hd = sec.querySelector('.ef-sec-hd');
        if (hd) {
          const banner = document.createElement('div');
          banner.className = 'rev-lock-banner';
          banner.style.cssText = 'display:flex;align-items:center;gap:6px;padding:5px 13px;' +
            'background:var(--amber-bg);border-bottom:1px solid var(--amber-bd);' +
            'font-size:10px;font-weight:600;color:var(--amber)';
          banner.innerHTML = '🔒 Dikunci — ada Revision / Re-Apply aktif. Edit via section Revision Management.';
          hd.insertAdjacentElement('afterend', banner);
        }
      }
    });
  } else {
    // Remove any revision lock banners if no active revision
    document.querySelectorAll('.rev-lock-banner').forEach(b => b.remove());
  }

  // ── Sales Revision Request lock ───────────────────────────────────
  const canSalesRev = allowed.includes('salesRevReq');
  const revReqWrap  = g('salesRevReqWrap');
  if (revReqWrap) {
    revReqWrap.querySelectorAll('.revreq-chk,.revreq-mt-inp,.revreq-newprod-inp,.revreq-note-inp').forEach(el => {
      // checkboxes always unlocked for Sales; child inputs unlocked only if checkbox checked
      if (el.classList.contains('revreq-chk')) {
        el.disabled = !canSalesRev;
      } else {
        const row = el.closest('tr');
        const chk = row ? row.querySelector('.revreq-chk') : null;
        el.disabled = !canSalesRev || !(chk && chk.checked);
      }
    });
    const wrapEl = g('wrap-salesRevReq');
    if (wrapEl) {
      wrapEl.style.opacity = canSalesRev ? '1' : '0.55';
      wrapEl.style.cursor  = canSalesRev ? '' : 'not-allowed';
      wrapEl.title         = canSalesRev ? '' : 'Restricted by role';
    }
  }

  // ── CorpSec Revision Confirm lock ──────────────────────────────────
  const canCorpSecRev = allowed.includes('corpsecRevConfirm');
  document.querySelectorAll('.corpsec-revconfirm-inp').forEach(inp => {
    inp.disabled = !canCorpSecRev;
  });
  const csRevWrap = g('corpsecRevConfirmWrap');
  if (csRevWrap) {
    csRevWrap.style.opacity = canCorpSecRev ? '1' : '0.55';
    csRevWrap.style.cursor  = canCorpSecRev ? '' : 'not-allowed';
    csRevWrap.title         = canCorpSecRev ? '' : 'Restricted by role — requires Sales revision request first';
  }

  // Enable save button once role is selected and company is selected
  const saveBtn = g('saveBtn');
  if (saveBtn) {
    saveBtn.disabled = false;
    saveBtn.style.opacity = '1';
    saveBtn.style.cursor  = '';
  }

  // Rebuild role history when role or company changes
  buildRoleHistory();
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
  // First: use availableByProd if set (respects manual overrides)
  if (co.availableByProd && Object.keys(co.availableByProd).length) {
    // availableByProd is what's left; we need total obtained per prod
  }
  // Primary: Obtained #1 cycle products
  const cycles = co.cycles || [];
  const obtCy = cycles.find(cy => /^obtained\s*#?1/i.test(cy.type))
             || cycles.find(cy => /^obtained/i.test(cy.type));
  if (obtCy && obtCy.products) {
    Object.entries(obtCy.products).forEach(([p, v]) => {
      if (typeof v === 'number' && v > 0) result[p] = v;
    });
  }
  // Fallback: use co products list with co.obtained total split evenly
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
    // Ensure at least one lot exists
    if (co.shipments[p].length === 0) {
      co.shipments[p].push({ lot: 1, utilMT: null, etaJKT: '', note: '', realMT: null, pibDate: '', arrived: false });
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
/* ══════════════════════════════════════════════════════════════════
   ROLE HISTORY — show relevant change history per role
   Called after role selected + company loaded.
══════════════════════════════════════════════════════════════════ */
function buildRoleHistory() {
  const sec  = document.getElementById('sec-role-history');
  const body = document.getElementById('roleHistoryBody');
  const badge= document.getElementById('roleHistoryRoleBadge');
  if (!sec || !body) return;

  const c  = gv('editCo');
  const co = c ? (getSPI(c) || PENDING.find(p => p.code === c)) : null;
  const ra = c ? getRA(c) : null;
  if (!co || !currentRole) { sec.style.display = 'none'; return; }

  const role  = currentRole;
  const entries = []; // { date, icon, text, color }

  const fmtD = s => s || '—';
  const roleColors = {
    CorpSec:    { bg:'#eff6ff', bd:'#bfdbfe', tc:'#1d4ed8', badge:'background:#1d4ed8;color:#fff' },
    Sales:      { bg:'#f0fdf4', bd:'#bbf7d0', tc:'#15803d', badge:'background:#15803d;color:#fff' },
    Operations: { bg:'#fff7ed', bd:'#fed7aa', tc:'#c2410c', badge:'background:#c2410c;color:#fff' },
    SuperAdmin: { bg:'#faf5ff', bd:'#e9d5ff', tc:'#7c3aed', badge:'background:#7c3aed;color:#fff' },
  };
  const rc = roleColors[role] || roleColors.SuperAdmin;

  // ── CorpSec: submission, PERTEK, SPI, revision, statusUpdate ──────────
  if (role === 'CorpSec' || role === 'SuperAdmin') {
    const cycles = co.cycles || [];

    // Submission cycles
    cycles.filter(c => /^submit/i.test(c.type) && !/obtained/i.test(c.type)).forEach(c => {
      if (c.submitDate) entries.push({
        date: c.submitDate, icon: '📤', section: 'Submission & PERTEK',
        text: `<strong>${c.type}</strong> — Submit: ${fmtD(c.submitDate)}${c.mt ? ' · ' + c.mt.toLocaleString() + ' MT' : ''}${c.submitType ? ' · ' + c.submitType : ''}`,
        color: 'var(--blue)'
      });
    });

    // Obtained / PERTEK cycles
    cycles.filter(c => /^obtained/i.test(c.type)).forEach(c => {
      if (c.submitDate || c.releaseDate) entries.push({
        date: c.releaseDate || c.submitDate, icon: '📄', section: 'Submission & PERTEK',
        text: `<strong>${c.type}</strong> — PERTEK/SPI: ${fmtD(c.releaseDate)}${c.mt ? ' · ' + c.mt.toLocaleString() + ' MT' : ''}${c.status ? ' · <em>' + c.status + '</em>' : ''}`,
        color: 'var(--teal)'
      });
    });

    // Revision request confirmed cycles
    cycles.filter(c => c._isRevReq).forEach(c => {
      entries.push({
        date: c.releaseDate, icon: '✅', section: 'Revision & Status',
        text: `<strong>Rev Konfirmasi</strong> — ${c.type.replace('Revision Request — ','')}${c.mt ? ' · ' + c.mt.toLocaleString() + ' MT' : ''} · ${c.status||''}`,
        color: 'var(--green)'
      });
    });

    // PERTEK No & SPI No (static fields)
    if (co.pertekNo) entries.push({ date: null, icon: '🔢', section: 'Submission & PERTEK', text: `PERTEK No: <strong>${co.pertekNo}</strong>`, color: 'var(--txt3)' });
    if (co.spiNo)    entries.push({ date: null, icon: '✅', section: 'Submission & PERTEK', text: `SPI No: <strong>${co.spiNo}</strong>`, color: 'var(--green)' });

    // Status update
    if (co.statusUpdate) entries.push({
      date: co.updatedDate || null, icon: '📝', section: 'Revision & Status',
      text: `Status Update: <em>${co.statusUpdate}</em>${co.updatedBy ? ' · oleh ' + co.updatedBy : ''}`,
      color: 'var(--txt2)'
    });

    // Revision status
    if (co.revStatus && co.revType !== 'none') entries.push({
      date: co.revSubmitDate || null, icon: '🔄', section: 'Revision & Status',
      text: `Revision: <strong>${co.revStatus}</strong>${co.revNote ? ' · ' + co.revNote : ''}`,
      color: 'var(--amber)'
    });
  }

  // ── Sales: revision requests (primary), shipments, reapply ──────────
  if (role === 'Sales' || role === 'SuperAdmin') {

    // ① Revision Requests — always show, with full detail and CorpSec response
    const revReqs = co.salesRevRequest || {};
    const reqEntries = Object.entries(revReqs).filter(([,v]) => v && v.requested);
    if (reqEntries.length) {
      reqEntries.forEach(([prod, req]) => {
        const targets  = (req.targetProducts||[]).filter(t => t.product);
        const tDisp    = targets.length > 1
          ? targets.map(t => `<strong>${t.product}</strong>${t.mt ? ' ('+Number(t.mt).toLocaleString()+' MT)' : ''}`).join(' + ')
          : targets.length === 1 && targets[0].product
            ? `<strong>${targets[0].product}</strong>${targets[0].mt ? ' ('+Number(targets[0].mt).toLocaleString()+' MT)' : ''}`
            : req.newProduct ? `<strong>${req.newProduct}</strong>` : '<em>Tetap sama</em>';

        const isConf   = req.status === 'confirmed';
        const isBatal  = req.status === 'rejected';
        const stIcon   = isConf ? '✅' : isBatal ? '✕' : '⏳';
        const stLabel  = isConf ? 'Dikonfirmasi CorpSec' : isBatal ? 'Dibatalkan CorpSec' : 'Menunggu CorpSec';
        const stColor  = isConf ? 'var(--green)' : isBatal ? 'var(--red2)' : 'var(--amber)';
        const stBg     = isConf ? 'var(--green-bg)' : isBatal ? 'var(--red-bg)' : 'var(--amber-bg)';
        const stBd     = isConf ? 'var(--green-bd)' : isBatal ? 'var(--red-bd)' : 'var(--amber-bd)';

        // Build the detail text
        const dot    = `<span style="display:inline-block;width:7px;height:7px;border-radius:2px;background:${prodDot(prod)};margin-right:3px;vertical-align:middle;flex-shrink:0"></span>`;
        let text = `${dot}<strong>${prod}</strong> → ${tDisp}`;
        if (req.note) text += ` · <em style="color:var(--txt3)">${req.note}</em>`;

        // CorpSec response line
        let responseHtml = '';
        if (isConf) {
          responseHtml = `<div style="margin-top:4px;display:flex;align-items:center;gap:5px;flex-wrap:wrap">
            <span style="font-size:9px;font-weight:700;padding:2px 7px;border-radius:3px;
              background:${stBg};color:${stColor};border:1px solid ${stBd}">${stIcon} ${stLabel}</span>
            ${req.confirmedMT ? `<span style="font-size:10px;font-family:'DM Mono',monospace;font-weight:700;color:${stColor}">${Number(req.confirmedMT).toLocaleString()} MT dikonfirmasi</span>` : ''}
            ${req.confirmedDate ? `<span style="font-size:9.5px;color:var(--txt3)">oleh ${req.confirmedBy||'CorpSec'} · ${req.confirmedDate}</span>` : ''}
          </div>`;
        } else if (isBatal) {
          responseHtml = `<div style="margin-top:4px">
            <span style="font-size:9px;font-weight:700;padding:2px 7px;border-radius:3px;
              background:${stBg};color:${stColor};border:1px solid ${stBd}">${stIcon} ${stLabel}</span>
          </div>`;
        } else {
          responseHtml = `<div style="margin-top:4px">
            <span style="font-size:9px;font-weight:700;padding:2px 7px;border-radius:3px;
              background:${stBg};color:${stColor};border:1px solid ${stBd}">${stIcon} ${stLabel}</span>
          </div>`;
        }

        entries.push({
          date: req.confirmedDate || null,
          icon: '📋',
          text: text + responseHtml,
          color: 'var(--txt)',
          section: 'Revision Request ke CorpSec',
        });
      });
    } else {
      // No revision request yet — show placeholder
      entries.push({
        date: null, icon: '📋',
        text: '<em style="color:var(--txt3)">Belum ada Revision Request yang diajukan ke CorpSec.</em>',
        color: 'var(--txt3)',
        section: 'Revision Request ke CorpSec',
      });
    }

    // ② Shipment utilization & ETA
    const ships = co.shipments || {};
    const shipEntries = [];
    Object.entries(ships).forEach(([prod, lots]) => {
      lots.forEach(lot => {
        if (lot.utilMT || lot.etaJKT || lot.note) {
          const dot = `<span style="display:inline-block;width:7px;height:7px;border-radius:2px;background:${prodDot(prod)};margin-right:3px;vertical-align:middle"></span>`;
          shipEntries.push({
            date: lot.etaJKT || null, icon: '📦',
            text: `${dot}<strong>${prod}</strong> Lot ${lot.lotNo||1} — ${lot.utilMT ? '<strong>'+lot.utilMT.toLocaleString()+' MT</strong>' : '<em style="color:var(--txt3)">Util belum diisi</em>'} · ETA: ${lot.etaJKT || '—'}${lot.note ? ' · <em>'+lot.note+'</em>' : ''}`,
            color: lot.utilMT ? 'var(--blue)' : 'var(--txt3)',
            section: 'Utilisasi & ETA Shipment',
          });
        }
      });
    });
    if (shipEntries.length) {
      shipEntries.forEach(e => entries.push(e));
    }

    // ③ Reapply targets
    const reapply = co.reapplyByProd || {};
    const reapplyEntries = Object.entries(reapply).filter(([,v]) => v > 0);
    if (reapplyEntries.length) entries.push({
      date: null, icon: '♻️',
      text: `Re-Apply Target: ${reapplyEntries.map(([p,v]) =>
        `<span style="display:inline-flex;align-items:center;gap:3px;font-size:9.5px;font-weight:700;padding:1px 6px;border-radius:3px;background:var(--violet-bg);color:var(--violet);border:1px solid var(--violet-bd)">${p}: ${Number(v).toLocaleString()} MT</span>`
      ).join(' ')}`,
      color: 'var(--violet)',
      section: 'Target Re-Apply',
    });
  }

  // ── Operations: realization, PIB date, cargo arrived ─────────────────
  if (role === 'Operations' || role === 'SuperAdmin') {
    const ships = co.shipments || {};
    Object.entries(ships).forEach(([prod, lots]) => {
      lots.forEach(lot => {
        if (lot.realMT || lot.pibDate || lot.cargoArrived) {
          const dot = `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${prodDot(prod)};margin-right:4px;vertical-align:middle"></span>`;
          const arrived = lot.cargoArrived
            ? `<span style="font-size:9.5px;font-weight:700;padding:1px 5px;border-radius:3px;background:var(--green-bg);color:var(--green);border:1px solid var(--green-bd)">✅ Arrived</span>` : '';
          entries.push({
            date: lot.pibDate || null, icon: '🚢',
            text: `${dot}<strong>${prod}</strong> Lot ${lot.lotNo} — Real: ${lot.realMT ? lot.realMT.toLocaleString() + ' MT' : '—'} · PIB: ${lot.pibDate || '—'} ${arrived}`,
            color: 'var(--green)'
          });
        }
      });
    });

    // RA realization
    if (ra && (ra.berat || ra.realPct)) entries.push({
      date: ra.arrivalDate || null, icon: '📊', section: 'Realisasi',
      text: `Realisasi: <strong>${(ra.berat||0).toLocaleString()} MT</strong> · ${(ra.realPct*100||0).toFixed(1)}% · ${ra.cargoArrived ? '✅ Cargo Arrived' : '🚢 In Transit'} · ETA: ${ra.etaJKT || '—'}`,
      color: ra.cargoArrived ? 'var(--green)' : 'var(--blue)'
    });
  }

  // ── Last updated ───────────────────────────────────────────────────────
  if (co.updatedBy && co.updatedDate) entries.push({
    date: co.updatedDate, icon: '💾', section: 'Info',
    text: `Last saved by <strong>${co.updatedBy}</strong> · ${co.updatedDate}`,
    color: 'var(--txt3)'
  });

  if (!entries.length) {
    sec.style.display = 'none';
    return;
  }

  // Render — group by section if entries have .section
  badge.textContent = role;
  badge.style.cssText = rc.badge;
  sec.style.display = 'block';

  // Group entries by section for cleaner display
  let html = '';
  let lastSection = null;
  entries.forEach(e => {
    if (e.section && e.section !== lastSection) {
      lastSection = e.section;
      html += `<div style="font-size:8.5px;font-weight:700;text-transform:uppercase;
        letter-spacing:.8px;color:var(--txt3);margin:${html?'8px':'0'}px 0 3px;
        padding-bottom:3px;border-bottom:1px solid ${rc.bd}">${e.section}</div>`;
    }
    html += `<div style="display:flex;align-items:flex-start;gap:8px;padding:6px 8px;
      border-radius:6px;background:${rc.bg};border:1px solid ${rc.bd};margin-bottom:3px">
      <span style="flex-shrink:0;font-size:12px;line-height:1.5">${e.icon}</span>
      <div style="flex:1;min-width:0;font-size:10.5px;color:${e.color};line-height:1.5">${e.text}</div>
      ${e.date ? `<span style="flex-shrink:0;font-size:9px;color:var(--txt3);
        font-family:'DM Mono',monospace;white-space:nowrap;margin-top:2px">${e.date}</span>` : ''}
    </div>`;
  });
  body.innerHTML = html;
}