/* ═══════════════════════════════════════
   REVISION MANAGEMENT + saveEdit
   rrGetCategory, buildRevMgmtSection,
   rrSave/Approve/Cancel/Reopen, saveEdit
═══════════════════════════════════════ */

const RR_APPROVAL_STAGES = [
  'Menunggu Disposisi Kasi',
  'Menunggu Disposisi Direktur',
  'Menunggu Persetujuan Direktur',
  'Menunggu Persetujuan Kasubdit',
  'Menunggu Penerbitan PERTEK',
  'PERTEK Terbit — Menunggu SPI',
  'SPI Terbit — Selesai',
];

const RR_REAPPLY_STATUS_OPTIONS = [
  'Not Yet Submitted',
  'Submitted to MoI',
  'Menunggu Disposisi Kasi',
  'Menunggu Persetujuan Direktur',
  'PERTEK Obtained',
  'SPI Obtained',
];

/* Categorize a company record into one of four categories */
function rrGetCategory(co) {
  if (!co) return 'unknown';
  if (co.revType === 'active') {
    const hasSubmit2 = (co.cycles||[]).some(c => /^submit\s*#[2-9]/i.test(c.type));
    return hasSubmit2 ? 'submit2' : 'revision';
  }
  if (co.revType === 'complete') return 'complete';
  return 'clean';
}

function rrCategoryLabel(cat) {
  switch (cat) {
    case 'submit2':   return { cls:'rr-cat-active',   ico:'🔄', txt:'Submit #2 / Additional — Awaiting Approval' };
    case 'revision':  return { cls:'rr-cat-active',   ico:'🔄', txt:'Revision Active — Awaiting Approval' };
    case 'complete':  return { cls:'rr-cat-complete',  ico:'✓',  txt:'Revision / Submit #2 — Approved & Complete' };
    default:          return { cls:'rr-cat-clean',     ico:'✅', txt:'Completed — SPI Active' };
  }
}

/* Get the latest non-obtained cycle (active or pending) */
function rrGetActiveCycle(co) {
  const ac = (co && co.cycles) || [];
  // Prefer last Submit #N or Revision #N cycle
  const submitCycles = ac.filter(c =>
    /^(submit\s*#[2-9]|revision\s*#\d)/i.test(c.type)
  );
  return submitCycles[submitCycles.length - 1] || null;
}

/* Build the full Revision & Re-Apply panel */
function buildRevMgmtSection(co) {
  const el = g('revMgmtBody');
  if (!el) return;
  if (!co) { el.innerHTML = '<div class="rr-no-active">Select a company above.</div>'; return; }

  const code = co.code;
  const cat  = rrGetCategory(co);
  const catL = rrCategoryLabel(cat);
  const ra   = getRA(code);
  const ac   = co.cycles || [];
  const activeCycle = rrGetActiveCycle(co);

  // ── 1. Category badge ──────────────────────────────────────────────────
  let html = `<div class="rr-cat-badge ${catL.cls}">${catL.ico} ${catL.txt}</div>`;

  // ── 2. Summary stats row ───────────────────────────────────────────────
  const cycleCount = ac.length;
  const latestObt  = ac.filter(c => /^obtained/i.test(c.type)).pop();
  const obtMT      = latestObt ? (typeof latestObt.mt === 'number' ? latestObt.mt.toLocaleString() + ' MT' : 'TBA') : '—';
  const realPct    = ra ? (ra.realPct * 100).toFixed(1) + '%' : '—';
  html += `<div class="rr-status-grid">
    <div class="rr-stat-box"><div class="rr-stat-val" style="color:var(--teal)">${obtMT}</div><div class="rr-stat-lbl">Obtained #1</div></div>
    <div class="rr-stat-box"><div class="rr-stat-val" style="color:${ra ? (ra.realPct>=.6?'var(--green)':'var(--red2)') : 'var(--txt3)'}">${realPct}</div><div class="rr-stat-lbl">Realization</div></div>
    <div class="rr-stat-box"><div class="rr-stat-val" style="color:var(--blue)">${cycleCount}</div><div class="rr-stat-lbl">Total Cycles</div></div>
  </div>`;

  // ── 2b. Sales Revision Request panel (CorpSec read + confirm) ───────────
  const salesRevReq = co.salesRevRequest || {};
  const reqProds = Object.entries(salesRevReq).filter(([,v]) => v && v.requested);

  if (reqProds.length > 0) {
    const canConfirm = currentRole && (ROLE_PERMISSIONS[currentRole]||[]).includes('corpsecRevConfirm');

    let reqRows = reqProds.map(([prod, req]) => {
      const dot      = prodDot(prod);
      const pid      = prod.replace(/[^a-zA-Z0-9]/g,'_');
      const reqMT    = req.requestedMT != null ? req.requestedMT.toLocaleString() + ' MT' : '—';
      // Support split: show all target products
      const targets  = req.targetProducts && req.targetProducts.length
                     ? req.targetProducts
                     : (req.newProduct ? [{ product: req.newProduct, mt: req.requestedMT }] : []);
      const newP     = targets.length > 0 && targets.some(t => t.product)
        ? targets.map(t => t.product ? ` → <strong style="color:var(--blue)">${t.product}</strong>${t.mt ? ` <span style="font-size:9.5px;color:var(--txt3)">(${Number(t.mt).toLocaleString()} MT)</span>` : ''}` : '').filter(Boolean).join(', ')
        : '';
      const note     = req.note || '';
      const isConf   = req.status === 'confirmed';
      const isBatal  = req.status === 'rejected';
      const confMT   = req.confirmedMT != null ? Number(req.confirmedMT).toLocaleString() : (req.requestedMT != null ? Number(req.requestedMT).toLocaleString() : '');

      // Status badge
      const statusBadge = isConf
        ? `<span style="font-size:9.5px;font-weight:700;padding:2px 8px;border-radius:3px;background:var(--green-bg);color:var(--green);border:1px solid var(--green-bd)">✅ Dikonfirmasi</span>`
        : isBatal
        ? `<span style="font-size:9.5px;font-weight:700;padding:2px 8px;border-radius:3px;background:var(--red-bg);color:var(--red2);border:1px solid var(--red-bd)">✕ Dibatalkan</span>`
        : `<span style="font-size:9.5px;font-weight:700;padding:2px 8px;border-radius:3px;background:var(--amber-bg);color:var(--amber);border:1px solid var(--amber-bd)">⏳ Menunggu</span>`;

      const actionArea = canConfirm ? `
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          <input type="text" inputmode="numeric"
            class="pmt-mt-inp corpsec-revconfirm-inp"
            data-prod="${prod}" id="csconf-mt-${pid}"
            value="${confMT}"
            placeholder="Qty (MT)"
            oninput="fmtThousandInline(this)"
            style="width:90px;font-size:11.5px;padding:4px 7px;border:1px solid var(--border2);border-radius:5px;text-align:right">
          <button onclick="csConfirmRev('${prod}','${pid}','${code}')"
            style="font-size:10.5px;font-weight:700;padding:4px 10px;border-radius:5px;border:none;cursor:pointer;
              background:var(--green);color:#fff;transition:background .15s"
            onmouseover="this.style.background='#16a34a'" onmouseout="this.style.background='var(--green)'">
            ✓ Konfirmasi
          </button>
          <button onclick="csBatalRev('${prod}','${pid}','${code}')"
            style="font-size:10.5px;font-weight:700;padding:4px 10px;border-radius:5px;border:1px solid var(--red-bd);cursor:pointer;
              background:var(--red-bg);color:var(--red2);transition:background .15s"
            onmouseover="this.style.background='#fecaca'" onmouseout="this.style.background='var(--red-bg)'">
            ✕ Batal
          </button>
        </div>` : `<div>${statusBadge}</div>`;

      return `<tr style="border-bottom:1px solid var(--border);padding:6px 0">
        <td style="padding:8px 10px">
          <div class="pmt-prod-chip">
            <div class="pmt-prod-dot" style="background:${dot}"></div>
            <span style="font-weight:700">${prod}</span>
          </div>
          ${newP ? `<div style="font-size:10px;color:var(--txt3);margin-top:2px">${newP}</div>` : ''}
          ${note ? `<div style="font-size:9.5px;color:var(--txt3);margin-top:2px;font-style:italic">💬 ${note}</div>` : ''}
        </td>
        <td style="padding:8px 10px;text-align:right;vertical-align:top">
          ${targets.length > 1
            ? targets.map(t => `<div style="font-size:10px;color:var(--amber);font-family:'DM Mono',monospace;white-space:nowrap">
                ${t.product||'(sama)'}: <strong>${t.mt!=null?Number(t.mt).toLocaleString():'—'} MT</strong>
              </div>`).join('')
            : `<span style="font-weight:700;color:var(--amber);font-family:'DM Mono',monospace">${reqMT}</span>`
          }
        </td>
        <td style="padding:8px 10px">${statusBadge}</td>
        <td style="padding:8px 10px">${actionArea}</td>
      </tr>`;
    }).join('');

    html += `<div id="corpsecRevConfirmWrap" style="margin-bottom:12px;padding:12px;background:var(--amber-bg);border:1px solid var(--amber-bd);border-radius:8px">
      <div style="font-size:11px;font-weight:700;color:var(--amber);margin-bottom:10px;display:flex;align-items:center;gap:6px">
        📋 Sales Revision Request
        <span style="font-size:9.5px;font-weight:600;padding:1px 6px;background:var(--amber);color:#fff;border-radius:3px">${reqProds.length} produk</span>
        ${!canConfirm
          ? '<span style="font-size:9.5px;color:var(--amber);opacity:.7">🔒 CorpSec / Super Admin only</span>'
          : '<span style="font-size:9.5px;color:var(--green)">✏️ Konfirmasi per produk</span>'}
      </div>
      <table style="width:100%;border-collapse:collapse;background:#fff;border-radius:6px;overflow:hidden;border:1px solid var(--border)">
        <thead>
          <tr style="background:var(--bg2)">
            <th style="padding:7px 10px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:var(--txt3)">Produk</th>
            <th style="padding:7px 10px;text-align:right;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:var(--txt3);width:110px">Qty Diminta</th>
            <th style="padding:7px 10px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:var(--txt3);width:110px">Status</th>
            <th style="padding:7px 10px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:var(--txt3)">Aksi CorpSec</th>
          </tr>
        </thead>
        <tbody>${reqRows}</tbody>
      </table>
      <div style="margin-top:8px;font-size:10px;color:var(--txt3)">
        <span class="tti" data-tip="Input qty konfirmasi (pre-filled dari request Sales), lalu klik Konfirmasi atau Batal per produk. Hasil tersimpan saat klik Save &amp; Refresh.">i</span>
      </div>
    </div>`;
  } else {
    html += `<div style="margin-bottom:10px;padding:8px 12px;background:var(--bg2);border:1px solid var(--border);border-radius:6px;font-size:10.5px;color:var(--txt3)">
      📋 <em>Belum ada Revision Request dari Sales.</em> CorpSec tidak dapat input revision sampai Sales mengajukan request.
    </div>`;
  }

  // ── 3. Cycle timeline ──────────────────────────────────────────────────
  html += `<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--txt3);margin-bottom:6px">Cycle History</div>`;
  html += `<div class="rr-cycle-timeline">`;
  ac.forEach(c => {
    const isActive   = (c === activeCycle);
    const isObtained = /^obtained/i.test(c.type);
    const isTBA      = c.releaseDate === 'TBA' || !c.releaseDate;
    let rowCls = '';
    if (isActive) rowCls = 'active-cycle';
    else if (isObtained && !isTBA) rowCls = 'complete-cycle';
    else if (isObtained && isTBA)  rowCls = 'pending-cycle';

    const dotColor = rowCls === 'active-cycle'   ? 'var(--amber-lt)'
                   : rowCls === 'complete-cycle' ? 'var(--green-lt)'
                   : rowCls === 'pending-cycle'  ? '#93c5fd'
                   : 'var(--border2)';

    const prodStr = c.products
      ? Object.entries(c.products).map(([p,m]) => `${p}: ${typeof m==='number'?m.toLocaleString():m} MT`).join(' · ')
      : '—';

    html += `<div class="rr-cycle-row ${rowCls}">
      <div class="rr-cycle-dot" style="background:${dotColor}"></div>
      <div class="rr-cycle-body">
        <div class="rr-cycle-type">${c.type}${isActive ? ' <span style="font-size:9px;font-weight:700;padding:1px 5px;background:var(--amber-lt);color:#fff;border-radius:3px;margin-left:4px">ACTIVE</span>' : ''}</div>
        <div class="rr-cycle-meta">${prodStr}</div>
        <div class="rr-cycle-meta">
          ${c.submitType}: <strong>${c.submitDate||'TBA'}</strong> &nbsp;·&nbsp;
          ${c.releaseType}: <strong>${c.releaseDate||'TBA'}</strong>
        </div>
        ${c.status ? `<div class="rr-cycle-status">${c.status}</div>` : ''}
      </div>
    </div>`;
  });
  html += `</div>`;

  // ── 4. Editable fields for active revision / Submit #2 ─────────────────
  if (cat === 'revision' || cat === 'submit2') {
    const stageVal  = co.revStatus || '';
    const dateVal   = co.revSubmitDate || '';
    const noteVal   = co.revNote || '';

    // Product change summary from revFrom/revTo
    let changeHtml = '';
    if (co.revFrom && co.revFrom.length) {
      changeHtml = `<div style="margin-bottom:10px">
        <div class="fl" style="margin-bottom:5px">Product Change (From → To)</div>
        <div style="display:flex;flex-direction:column;gap:4px">`;
      co.revFrom.forEach((f, i) => {
        const t = (co.revTo || [])[i] || {};
        changeHtml += `<div style="display:flex;align-items:center;gap:6px;font-size:11.5px">
          <span style="padding:2px 8px;background:var(--bg);border:1px solid var(--border);border-radius:3px;font-weight:600">${f.prod} — ${(f.mt||'').toLocaleString ? (typeof f.mt==='number'?f.mt.toLocaleString():f.mt) : f.mt} MT</span>
          <span style="color:var(--txt3)">→</span>
          <span style="padding:2px 8px;background:var(--green-bg);border:1px solid var(--green-bd);border-radius:3px;font-weight:700;color:var(--green)">${t.prod||'?'} — ${(typeof t.mt==='number'?t.mt.toLocaleString():t.mt)||'TBA'} MT</span>
        </div>`;
      });
      changeHtml += `</div></div>`;
    }

    const stageOpts = RR_APPROVAL_STAGES.map(s =>
      `<option value="${s}" ${s===stageVal?'selected':''}>${s}</option>`
    ).join('');

    html += `<div class="rr-edit-area">
      <div class="rr-edit-hd">✏️ Update Revision / Submit #2 Status</div>
      ${changeHtml}
      <div class="rr-form-row">
        <div>
          <div class="fl">Approval Stage</div>
          <select class="fi" id="rrApprovalStage">${stageOpts}</select>
        </div>
        <div>
          <div class="fl">Rev. Submit Date</div>
          <input class="fi" id="rrRevDate" type="text" placeholder="DD/MM/YYYY" value="${dateVal}">
        </div>
      </div>
      <div class="rr-form-row full">
        <div>
          <div class="fl">Status Note <span class="ef-hint">Internal — shown in Revision table</span></div>
          <input class="fi" id="rrStatusNote" type="text" placeholder="e.g. Update 06/03/26 — Awaiting ministry sign-off" value="${noteVal.replace(/"/g,'&quot;')}">
        </div>
      </div>
      <div class="rr-action-row">
        <button class="btn-rev-approve" onclick="rrMarkApproved('${code}')">✓ Mark Approved (Complete)</button>
        <button class="btn-rev-cancel" onclick="rrCancelRevision('${code}')">✕ Cancel Revision</button>
        <button class="btn btn-s" onclick="rrSaveStatus('${code}')" style="margin-left:auto">💾 Save Status Update</button>
      </div>
    </div>`;
  } else if (cat === 'complete') {
    html += `<div class="notice n-green" style="margin-bottom:10px;font-size:11.5px">
      <strong>✓ Revision/Submit #2 approved.</strong> Status: ${co.revStatus||'Complete'}.<br>
      Products and MT have been updated per the approved revision.
    </div>
    <div style="display:flex;gap:7px">
      <button class="btn btn-s btn-p" onclick="rrReopenRevision('${code}')" style="font-size:11px">🔄 Re-open Revision</button>
    </div>`;
  } else {
    html += `<div class="rr-no-active" style="padding:10px 0">✅ No active revision for this company. Use <strong>+ Add New Submission</strong> above to start a new cycle.</div>`;
  }

  // ── 5. Re-Apply tracking ────────────────────────────────────────────────
  const isElig    = ra && isEligible(ra);
  const raStatus  = (ra && ra.reapplyStatus) || 'Not Yet Submitted';
  const raDate    = (ra && ra.reapplySubmitDate) || '';
  const raSpiNo   = (ra && ra.reapplySpiNo) || '';
  const raStatusOpts = RR_REAPPLY_STATUS_OPTIONS.map(s =>
    `<option value="${s}" ${s===raStatus?'selected':''}>${s}</option>`
  ).join('');

  const raColorEl = isElig ? 'var(--green)' : 'var(--orange)';
  html += `<div class="rr-reapply-panel">
    <div class="rr-reapply-hd">♻️ Re-Apply Tracking</div>
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
      <span style="font-size:11.5px;font-weight:600;color:${raColorEl}">
        ${ra ? `Realization: ${(ra.realPct*100).toFixed(1)}%` : 'No realization data'}
      </span>
      <span>${isElig ? '<span class="badge b-eligible">✓ Eligible for Re-Apply</span>' : ra ? '<span class="badge b-ineligible">✗ Not Yet Eligible (&lt;60%)</span>' : ''}</span>
    </div>
    <div class="rr-form-row">
      <div>
        <div class="fl">Re-Apply Status</div>
        <select class="fi" id="rrReapplyStatus">${raStatusOpts}</select>
      </div>
      <div>
        <div class="fl">Re-Apply Submit Date</div>
        <input class="fi" id="rrReapplyDate" type="text" placeholder="DD/MM/YYYY" value="${raDate}">
      </div>
    </div>
    <div class="rr-form-row">
      <div>
        <div class="fl">Target Re-Apply MT</div>
        <input class="fi" id="rrReapplyMT" type="number" placeholder="e.g. 1500" value="${ra && ra.target ? ra.target : ''}">
      </div>
      <div>
        <div class="fl">New SPI / PERTEK No.</div>
        <input class="fi" id="rrReaplySpiNo" type="text" placeholder="e.g. 04.PI-05.26.xxxx" value="${raSpiNo}">
      </div>
    </div>
    <div style="display:flex;justify-content:flex-end;margin-top:8px">
      <button class="btn btn-p" onclick="rrSaveReapply('${code}')" style="font-size:11px;background:var(--blue)">💾 Save Re-Apply Update</button>
    </div>
  </div>`;

  el.innerHTML = html;
}

/* ── CorpSec: confirm / reject individual revision request items ── */
function csConfirmRev(prod, pid, code) {
  const co = getSPI(code); if (!co) return;
  const req = co.salesRevRequest && co.salesRevRequest[prod];
  if (!req) return;

  const inp = document.getElementById('csconf-mt-' + pid);
  const raw = inp ? inp.value.replace(/,/g,'') : '';
  const mt  = raw ? Number(raw) : (req.requestedMT || null);

  req.status      = 'confirmed';
  req.confirmedMT = mt;
  req.confirmedDate = new Date().toLocaleDateString('id-ID',{day:'2-digit',month:'short',year:'numeric'});
  req.confirmedBy   = currentRole || 'CorpSec';

  // ── Inject into cycle history as a "Revision Request (Confirmed)" entry ──
  if (!co.cycles) co.cycles = [];
  // Build products object for the cycle: use targetProducts if split, else single
  const targets  = req.targetProducts && req.targetProducts.length
                 ? req.targetProducts : [{ product: req.newProduct || prod, mt }];
  const prodObj  = {};
  targets.forEach(t => { if (t.product) prodObj[t.product] = t.mt || mt || 0; });
  if (!Object.keys(prodObj).length) prodObj[prod] = mt || 0;

  // Remove any previous pending revision request cycle for this prod to avoid dupes
  const existingIdx = co.cycles.findIndex(c =>
    c.type === `Revision Request — ${prod}` && c.status === 'pending'
  );
  if (existingIdx >= 0) co.cycles.splice(existingIdx, 1);

  const now = new Date().toLocaleDateString('id-ID',{day:'2-digit',month:'2-digit',year:'numeric'});
  co.cycles.push({
    type:        `Revision Request — ${prod}`,
    mt:          mt || 0,
    products:    prodObj,
    submitType:  'Sales Request',
    submitDate:  req.confirmedDate,
    releaseType: 'CorpSec Confirmation',
    releaseDate: now,
    status:      `✅ Dikonfirmasi oleh ${currentRole||'CorpSec'} · ${req.confirmedDate}${req.note ? ' · ' + req.note : ''}`,
    _isRevReq:   true,
  });

  // Set revType to active so it appears in revision tracking
  if (co.revType === 'none' || co.revType === 'clean') {
    co.revType   = 'active';
    co.revStatus = `Revision Request dikonfirmasi — ${prod}${req.newProduct ? ' → ' + req.newProduct : ''} · ${now}`;
    co.revNote   = req.note || '';
    // Populate revFrom / revTo for the detail table
    if (!co.revFrom) co.revFrom = [];
    if (!co.revTo)   co.revTo   = [];
    co.revFrom.push({ prod, mt: co.obtained || 0, label: 'Before' });
    targets.forEach(t => {
      co.revTo.push({ prod: t.product || prod, mt: t.mt || mt || 0, label: 'After' });
    });
  }

  buildRevMgmtSection(co);
  applyRolePermissions();
  // Refresh sidebar/tables to reflect new status
  buildRevList && buildRevList();
  updateSPICounts && updateSPICounts();
}

function csBatalRev(prod, pid, code) {
  const co = getSPI(code); if (!co) return;
  if (!co.salesRevRequest || !co.salesRevRequest[prod]) return;
  co.salesRevRequest[prod].status      = 'rejected';
  co.salesRevRequest[prod].confirmedMT = null;

  // Remove any injected pending revision request cycle for this prod
  if (co.cycles) {
    co.cycles = co.cycles.filter(c => !(c._isRevReq && c.type === `Revision Request — ${prod}`));
  }

  buildRevMgmtSection(co);
  applyRolePermissions();
}

/* ── Action handlers ─────────────────────────────────────────────────────── */

/* Save approval stage + date + note to the live record */
function rrSaveStatus(code) {
  const co = getSPI(code); if (!co) return;
  const stage = (g('rrApprovalStage') || {}).value || '';
  const date  = (g('rrRevDate')  || {}).value || '';
  const note  = (g('rrStatusNote') || {}).value || '';

  co.revStatus = stage;
  if (date) co.revSubmitDate = date;
  if (note) co.revNote = note;

  // Update the most recent active cycle's status
  const activeCy = rrGetActiveCycle(co);
  if (activeCy) activeCy.status = `Update ${new Date().toLocaleDateString('id-ID',{day:'2-digit',month:'2-digit',year:'2-digit'})} - ${stage}`;

  _refreshAfterRREdit();
  buildRevMgmtSection(co);
  nsShowToast(`✓ ${code} revision status updated`);
}

/* Mark revision as fully approved — sets revType to 'complete' */
function rrMarkApproved(code) {
  const co = getSPI(code); if (!co) return;
  const stage = (g('rrApprovalStage') || {}).value || '';
  const date  = (g('rrRevDate')  || {}).value || '';

  co.revType   = 'complete';
  co.revStatus = stage.includes('SPI') ? `SPI TERBIT — ${stage}` : `PERTEK TERBIT${date ? ' ' + date : ''} — ${stage}`;

  // Update active cycle
  const activeCy = rrGetActiveCycle(co);
  if (activeCy) {
    activeCy.status = `APPROVED — ${stage}`;
    if (date) activeCy.releaseDate = date;
  }

  _refreshAfterRREdit();
  buildRevMgmtSection(co);
  nsShowToast(`✓ ${code} revision marked as approved/complete`);
}

/* Cancel revision — revert to clean SPI, keep only Submit #1 + Obtained #1 */
function rrCancelRevision(code) {
  const co = getSPI(code); if (!co) return;
  if (!confirm(`Cancel the active revision for ${code}? The original obtained products will be preserved and the revision cycle removed.`)) return;

  // Keep only Submit #1 and Obtained #1 cycles (remove any Revision/Submit #2 cycles)
  co.cycles = (co.cycles || []).filter(c =>
    /^(submit\s*#1|obtained\s*#1)$/i.test(c.type.trim())
  );
  // Update Obtained #1 status to note the cancellation
  const obt1 = co.cycles.find(c => /^obtained\s*#1$/i.test(c.type.trim()));
  if (obt1) obt1.status = 'Revision cancelled — original product unchanged';

  co.revType       = 'none';
  co.revNote       = '';
  co.revSubmitDate = '';
  co.revStatus     = '';
  co.revFrom       = [];
  co.revTo         = [];
  co.revMT         = 0;
  co.remarks       = (co.remarks||'').replace(/Revision Cancelled.*$/, '') + ' — Revision Cancelled ' + new Date().toLocaleDateString('id-ID',{day:'2-digit',month:'2-digit',year:'numeric'});
  co.spiRef        = (co.spiRef||'') + ' · Original product unchanged';

  _refreshAfterRREdit();
  buildRevMgmtSection(co);
  nsShowToast(`✓ ${code} revision cancelled — original products restored`);
}

/* Re-open a completed revision back to active */
function rrReopenRevision(code) {
  const co = getSPI(code); if (!co) return;
  co.revType = 'active';
  _refreshAfterRREdit();
  buildRevMgmtSection(co);
  nsShowToast(`${code} revision re-opened as active`);
}

/* Save Re-Apply tracking data */
function rrSaveReapply(code) {
  let ra = getRA(code);
  const status = (g('rrReapplyStatus') || {}).value || '';
  const date   = (g('rrReapplyDate')   || {}).value || '';
  const mt     = parseFloat((g('rrReapplyMT')  || {}).value || '');
  const spiNo  = (g('rrReaplySpiNo')   || {}).value || '';

  if (!ra) {
    // Create a placeholder RA record for this company if it doesn't exist
    const co = getSPI(code);
    if (!co) return;
    const obtMT = co.obtained || 0;
    ra = { code, product: co.products.join(' + '), berat: 0, obtained: obtMT, realPct: 0, target: mt || null, period: '—', pertek: '', spi: '', catatan: '', eta: '—' };
    RA.push(ra);
  }

  if (status) ra.reapplyStatus     = status;
  if (date)   ra.reapplySubmitDate = date;
  if (!isNaN(mt) && mt > 0) ra.target = mt;
  if (spiNo)  ra.reaplySpiNo       = spiNo;

  _refreshAfterRREdit();
  const co = getSPI(code);
  if (co) buildRevMgmtSection(co);
  nsShowToast(`✓ ${code} re-apply data updated`);
}

/* Shared refresh after any RR edit */
function _refreshAfterRREdit() {
  buildRevList();
  buildRevDetailTable();
  renderSPI();
  renderMain();
  updateOverviewKPIs();
  if (typeof autoSave === 'function') autoSave();
}

/* ── Save all fields — mutate live data — refresh every section ── */
function saveEdit() {
  const c = gv('editCo');
  if (!c) return;

  // ── Role guard: must have a role selected ──
  if (!currentRole) {
    alert('Please select your role before saving.');
    return;
  }

  const allowed = ROLE_PERMISSIONS[currentRole] || [];
  const can = id => allowed.includes(id);

  // ── Collect shipment data from Sales & Ops forms ─────────────────
  const co_live = getSPI(c) || PENDING.find(p => p.code === c);
  if (co_live && (can('salesShipTable') || can('opsShipTable'))) {
    collectShipmentData(co_live);
  }

  // ── Collect Sales Revision Request ────────────────────────────────
  if (co_live && can('salesRevReq')) {
    collectRevisionRequestData(co_live);
  }

  // ── Collect CorpSec Revision Confirmation ─────────────────────────
  // Status (confirmed/rejected) is set directly by csConfirmRev/csBatalRev buttons
  // confirmedMT is read from the input at the time of button click (already stored in co.salesRevRequest)

  // ── Per-product MT tables (CorpSec / SuperAdmin) ──────────────────
  const canSubmit   = can('submitProdTable');
  const canObtained = can('obtainedProdTable');

  // Collect per-product submit MTs → {byProd:{PROD:mt,...}, total:n}
  const submitMTData   = canSubmit   ? collectProductMTs('pmt-submit-inp')   : { byProd:{}, total:null };
  const obtainedMTData = canObtained ? collectProductMTs('pmt-obtained-inp') : { byProd:{}, total:null };

  const newSubmitMT   = submitMTData.total;     // total across all products, or null if no access
  const newObtainedMT = obtainedMTData.total;   // total across all products, or null if no access
  const newSubmitProds   = submitMTData.byProd;   // { 'GL BORON': 4000, 'PPGL CARBON': 2000, … }
  const newObtainedProds = obtainedMTData.byProd; // { 'GL BORON': 400,  'PPGL CARBON': 400,  … }

  // ── Other single-field reads ──────────────────────────────────────
  const newSubmitDate = can('eSubmitDate')  ? gv('eSubmitDate')          : null;
  const newPertekNo   = can('ePertekNo')   ? gv('ePertekNo')             : null;
  const newPertekDate = can('ePertekDate') ? gv('ePertekDate')           : null;
  const newSpiNo      = can('eSpiNo')      ? gv('eSpiNo')                : null;
  const newSpiDate    = can('eSpiDate')    ? gv('eSpiDate')              : null;
  const newStatus     = can('eStatus')     ? gv('eStatus')               : null;
  // statusUpdate is SUBMISSION-LEVEL — one note for entire submission
  const newStatusUpdate = can('eStatusUpdate') ? g('eStatusUpdate').value.trim() : null;
  const newBerat      = can('eBerat')      ? parseFloat(g('eBerat').value): NaN;
  const newETA        = can('eETA')        ? gv('eETA')                  : null;
  const newPIBRelease = can('ePIBRelease') ? gv('ePIBRelease')           : null;
  const newTarget     = can('eTarget')     ? parseFloat(g('eTarget').value): NaN;
  const newRem        = can('eRem')        ? gv('eRem')                  : null;

  const hasPERTEK = newPertekDate !== '' && newPertekDate != null;
  const hasSPI    = newSpiDate    !== '' && newSpiDate    != null;

  /* ── 1. Locate or promote company ── */
  let co = getSPI(c);
  let promotedFromPending = false;

  if (!co) {
    // In PENDING — if PERTEK date now filled, promote to SPI array
    const pi = PENDING.findIndex(p => p.code === c);
    if (pi >= 0) {
      if (hasPERTEK && newPertekDate) {
        const pr = PENDING.splice(pi, 1)[0];
        const prods = pr.products || [];
        // Use per-product data from tables, fall back to aggregate
        const submitMT  = newSubmitMT   != null ? newSubmitMT   : (pr.mt || 0);
        const obtMT     = newObtainedMT != null ? newObtainedMT : 0;
        // Per-product breakdown for cycles.products
        const subProdObj = Object.keys(newSubmitProds).length > 0
          ? newSubmitProds
          : (pr.cycles && pr.cycles[0] ? pr.cycles[0].products
            : prods.reduce((o, p) => { o[p] = Math.round(submitMT / Math.max(prods.length,1)); return o; }, {}));
        const obtProdObj = Object.keys(newObtainedProds).length > 0
          ? newObtainedProds
          : prods.reduce((o, p) => { o[p] = Math.round(obtMT / Math.max(prods.length,1)); return o; }, {});
        const newRec = {
          code: pr.code, group: pr.group || 'CD',
          submit1: submitMT, obtained: obtMT, products: prods,
          revType: 'complete', revSubmitDate: newPertekDate,
          revStatus: hasSPI
            ? `SPI TERBIT ${newSpiDate}`
            : `PERTEK TERBIT ${newPertekDate} — SPI belum terbit`,
          revNote: hasSPI
            ? `SPI TERBIT ${newSpiDate}`
            : `PERTEK TERBIT ${newPertekDate} — SPI belum terbit`,
          revFrom: [], revTo: [], revMT: 0,
          remarks: newRem || pr.remarks || '',
          spiRef: hasSPI ? `SPI TERBIT ${newSpiDate}` : `PERTEK TERBIT ${newPertekDate}`,
          pertekNo: newPertekNo, spiNo: newSpiNo,
          // statusUpdate is submission-level (one note, all products)
          statusUpdate: newStatusUpdate || '',
          cycles: [
            { type: 'Submit #1', mt: submitMT, products: subProdObj,
              submitType: 'Submit MOI', submitDate: newSubmitDate || (pr.cycles&&pr.cycles[0]?pr.cycles[0].submitDate:''),
              releaseType: 'PERTEK', releaseDate: newPertekDate,
              status: newStatusUpdate ? `PERTEK TERBIT ${newPertekDate} · ${newStatusUpdate}` : `PERTEK TERBIT ${newPertekDate}` },
            { type: 'Obtained #1', mt: obtMT, products: obtProdObj,
              submitType: 'Submit MOT', submitDate: 'TBA',
              releaseType: 'SPI', releaseDate: hasSPI ? newSpiDate : 'TBA',
              status: hasSPI ? `SPI TERBIT ${newSpiDate}` : `PERTEK Terbit: ${newPertekDate} · SPI: belum terbit` },
          ],
        };
        SPI.push(newRec);
        co = newRec;
        promotedFromPending = true;
      } else {
        // Stay in PENDING — update what we can
        const p = PENDING[pi];
        // Update total MT from per-product sum
        if (newSubmitMT != null) p.mt = newSubmitMT;
        if (newRem) p.remarks = newRem;
        if (newStatus) p.status = newStatus;
        // Store submission-level status update
        if (newStatusUpdate !== null) p.statusUpdate = newStatusUpdate;
        const subCy = (p.cycles||[]).find(cy => /^submit/i.test(cy.type));
        if (subCy && newSubmitDate) subCy.submitDate = newSubmitDate;
        if (subCy && newSubmitMT != null) subCy.mt = newSubmitMT;
        // Write per-product submit MT into pending cycle.products
        if (subCy && canSubmit && Object.keys(newSubmitProds).length > 0) {
          subCy.products = { ...subCy.products, ...newSubmitProds };
        }
      }
    }
  }

  if (co) {
    /* ── 2. Mutate SPI record ── */
    const ac     = co.cycles || [];
    const subCy  = ac.find(cy => /^submit #1/i.test(cy.type));
    const obtCy  = ac.find(cy => /^obtained #1/i.test(cy.type));

    // ── Submit MT (per product) → KPI1 ─────────────────────────────
    if (canSubmit && Object.keys(newSubmitProds).length > 0) {
      // Update co.submit1 = total of all per-product submit MTs
      co.submit1 = newSubmitMT || co.submit1;
      if (subCy) {
        subCy.mt = newSubmitMT || subCy.mt;
        // Write per-product breakdown into cycle.products
        subCy.products = { ...subCy.products, ...newSubmitProds };
      }
    }
    if (newSubmitDate && subCy) subCy.submitDate = newSubmitDate;

    // ── PERTEK No. — ONE per submission ──────────────────────────────
    if (newPertekNo) co.pertekNo = newPertekNo;

    // ── PERTEK date → Submit #1 releaseDate (KPI2 filter date) ───────
    if (hasPERTEK && subCy) {
      subCy.releaseDate = newPertekDate;
      subCy.status = newStatusUpdate
        ? `PERTEK TERBIT ${newPertekDate} · ${newStatusUpdate}`
        : `PERTEK TERBIT ${newPertekDate}`;
    }

    // ── Obtained MT (per product) → KPI2 ────────────────────────────
    if (canObtained && Object.keys(newObtainedProds).length > 0) {
      co.obtained = newObtainedMT || co.obtained;
      if (obtCy) {
        obtCy.mt = newObtainedMT || obtCy.mt;
        // Write per-product breakdown — replaces old products map completely
        // Merge: keep existing products not in the form, update those that are
        obtCy.products = { ...obtCy.products, ...newObtainedProds };
      }
      // Keep co.products list in sync (add any new product names)
      Object.keys(newObtainedProds).forEach(p => {
        if (!co.products.includes(p)) co.products.push(p);
      });
    }

    // ── SPI No. — ONE per submission ──────────────────────────────────
    if (newSpiNo) co.spiNo = newSpiNo;

    // ── SPI date → Obtained #1 releaseDate (SPI Terbit) ──────────────
    if (hasSPI && obtCy) {
      obtCy.releaseDate = newSpiDate;
      obtCy.status = `SPI TERBIT ${newSpiDate}`;
    }

    // spiRef — explicit status wins; else derive from document dates
    if (newStatus) {
      co.spiRef = newStatus;
    } else if (hasSPI) {
      co.spiRef = newSpiNo
        ? `SPI TERBIT ${newSpiDate} · No. ${newSpiNo}`
        : `SPI TERBIT ${newSpiDate}`;
    } else if (hasPERTEK) {
      co.spiRef = newPertekNo
        ? `PERTEK TERBIT ${newPertekDate} · No. ${newPertekNo}`
        : `PERTEK TERBIT ${newPertekDate}`;
    }

    // Auto-update revType/revStatus for non-promoted companies
    if (!promotedFromPending && co.revType === 'complete') {
      if (hasSPI)    co.revStatus = `SPI TERBIT ${newSpiDate}`;
      else if (hasPERTEK) co.revStatus = `PERTEK TERBIT ${newPertekDate} — SPI belum terbit`;
    }

    if (newRem) co.remarks = newRem;
    if (newStatusUpdate !== null) co.statusUpdate = newStatusUpdate;

    // Utilization MT + Available Quota — always derive from shipments if they exist
    if (co.shipments && Object.keys(co.shipments).length > 0) {
      // Already computed by collectShipmentData() above — just ensure availableQuota is updated
      co.availableQuota = Math.max(0, (co.obtained || 0) - (co.utilizationMT || 0));
    } else {
      // Legacy fallback: read from hidden input (SuperAdmin only)
      const newUtilMT = can('eUtilMT') ? parseMTField('eUtilMT') : null;
      if (newUtilMT != null) {
        co.utilizationMT  = newUtilMT;
        co.availableQuota = Math.max(0, co.obtained - newUtilMT);
      } else if (co.obtained != null && co.utilizationMT != null) {
        co.availableQuota = Math.max(0, co.obtained - co.utilizationMT);
      }
    }

    // Updated By
    const newUpdatedBy = currentRole;
    if (newUpdatedBy) {
      co.updatedBy   = newUpdatedBy;
      co.updatedDate = new Date().toLocaleDateString('id-ID',{day:'2-digit',month:'short',year:'numeric'});
    }
  }

  /* ── 3. Mutate RA record + sync from shipment data ── */
  const ra = RA.find(r => r.code === c);

  // ── 3a. Sync from co.shipments (Sales/Ops role saves) ────────────────
  if (co && co.shipments && (can('salesShipTable') || can('opsShipTable'))) {
    // Aggregate across all lots and products for the RA record
    const allLots = Object.values(co.shipments).flat();
    const totalUtil  = allLots.reduce((s, l) => s + (l.utilMT  || 0), 0);
    const totalReal  = allLots.filter(l => l.arrived).reduce((s, l) => s + (l.realMT || 0), 0);
    const totalBerat = allLots.reduce((s, l) => s + (l.realMT != null ? l.realMT : (l.utilMT || 0)), 0);
    const anyArrived = allLots.some(l => l.arrived && l.realMT > 0);
    const latestETA  = allLots.filter(l => l.etaJKT).map(l => l.etaJKT).join(' · ') || '';
    const latestPIB  = allLots.filter(l => l.pibDate).map(l => l.pibDate).join(', ') || '';
    const obtMT      = co.obtained || 1;

    if (ra) {
      // Merge shipment data into RA record
      if (totalUtil > 0 || totalReal > 0) {
        ra.berat        = anyArrived ? totalReal : totalUtil;
        ra.cargoArrived = anyArrived;
        ra.realPct      = anyArrived  ? Math.min(1, totalReal  / obtMT) : 0;
        ra.utilPct      = !anyArrived ? Math.min(1, totalUtil  / obtMT) : null;
      }
      if (latestETA)  ra.etaJKT        = latestETA;
      if (latestPIB)  ra.pibReleaseDate = latestPIB;
    } else if (totalUtil > 0 || totalReal > 0) {
      // No RA record yet — create one from shipment data
      RA.push({
        code: c, product: (co.products || []).join(' + '),
        berat: anyArrived ? totalReal : totalUtil,
        obtained: co.obtained || 0,
        cargoArrived: anyArrived,
        realPct:  anyArrived  ? Math.min(1, totalReal / obtMT) : 0,
        utilPct:  !anyArrived ? Math.min(1, totalUtil / obtMT) : null,
        arrivalDate: null,
        etaJKT: latestETA,
        pibReleaseDate: latestPIB,
        reapplyEst: '', target: null,
        pertek: co.pertekNo || '', spi: co.spiNo || '',
        catatan: '',
      });
    }
  }

  // ── 3b. Legacy single-field updates (CorpSec / Ops direct entry) ─────
  if (ra) {
    if (!isNaN(newBerat) && newBerat >= 0 && can('eBerat')) {
      ra.berat = newBerat;
      const obtMT = (co && co.obtained > 0) ? co.obtained : (ra.obtained || 1);
      if (ra.cargoArrived) ra.realPct = newBerat / obtMT;
      else                 ra.utilPct = newBerat / obtMT;
    }
    if (newETA        && can('eETA'))        ra.etaJKT         = newETA;
    if (newPIBRelease && can('ePIBRelease')) ra.pibReleaseDate = newPIBRelease;
    if (!isNaN(newTarget))                   ra.target         = newTarget;
    // Always sync PERTEK / SPI numbers from CorpSec edits
    if (newPertekNo) { ra.pertek = newPertekNo; ra.pertekNo = newPertekNo; }
    if (newSpiNo)    { ra.spi    = newSpiNo;    ra.spiNo    = newSpiNo; }
    // Keep ra.obtained in sync if CorpSec changed the obtained MT
    if (co && co.obtained) ra.obtained = co.obtained;
  }

  /* ── 3c. Apply product renames → inject Revision cycles into SPI ── */
  if (co && (can('submitProdTable') || currentRole === 'SuperAdmin')) {
    applyProductRenames(co);
  }

  /* ── 4. Refresh ALL dashboard sections ── */
  showSaveToast(saveToStorage());
  updateStorageStatus();
  cancelEdit();
  closeImport();
  buildRoleHistory && buildRoleHistory();

  // Charts
  buildPipeline(); buildProductDonut(); buildTopCo();
  buildUtilChart(); buildCmpChart(); buildGauge(); buildFlowKPIStrip();
  // Tables & lists
  renderSPI(); renderUtilTable(); renderRATable(); renderMain();
  buildRevList(); buildPendingQuick(); buildRevDetailTable();
  buildCmpList(); buildPendingTable();
  // Analytics & KPIs
  buildLeadTimeAnalytics();
  buildAvailableQuota();
  updateOverviewStats();
  updateOverviewKPIs();
}
/* ══════════════════════════════════════════════════════════════════════
   EXPORT EXECUTIVE PDF — Management Summary (A4 Portrait)
   Board-level, concise, visual. 2 pages max.
   Filter-aware: uses same KPI logic as dashboard.
   ══════════════════════════════════════════════════════════════════════ */