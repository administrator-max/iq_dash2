/* ═══════════════════════════════════════
   NAVIGATION + IMPORT MODAL
   + HelpDesk widget
═══════════════════════════════════════ */

/* ══════════════════════════════════════════════════
   HELP DESK
══════════════════════════════════════════════════ */
let hdOpen = false;
function toggleHD() { hdOpen=!hdOpen; document.getElementById('hdWin').classList.toggle('open',hdOpen); }
function hdAsk(q) { document.getElementById('hdIn').value=q; hdSend(); }
function hdSend() {
  const inp = document.getElementById('hdIn'), q = inp.value.trim(); if (!q) return;
  const msgs = document.getElementById('hdMsgs');
  msgs.innerHTML += `<div class="hd-msg user">${q}</div>`;
  inp.value = '';
  setTimeout(() => { msgs.innerHTML += `<div class="hd-msg bot">${hdAnswer(q)}</div>`; msgs.scrollTop=msgs.scrollHeight; }, 300);
  msgs.scrollTop = msgs.scrollHeight;
}
function hdAnswer(q) {
  const ql = q.toLowerCase();
  const code = [...SPI,...PENDING].map(d=>d.code).find(c=>ql.includes(c.toLowerCase()));
  if (code) {
    const co = getSPI(code), ra = getRA(code);
    if (co) {
      let t = `<strong>${code}</strong> — Group ${co.group}<br>Products: ${co.products.join(', ')}<br>Obtained: ${co.obtained.toLocaleString()} MT<br>Status: ${co.revType==='none'?'✅ Completed':co.revType==='active'?'🔄 Revision Active':'✓ Rev. Complete'}`;
      if (co.revType!=='none') t += `<br>Revision: ${co.revNote}`;
      if (ra) t += `<br>Realization: <strong>${(ra.realPct*100).toFixed(0)}%</strong> — ${isEligible(ra)?'✓ Eligible for re-apply':'✗ Not yet eligible'}`;
      return t;
    }
    const pend = PENDING.find(d=>d.code===code);
    if (pend) return `<strong>${code}</strong> — New Submission<br>${pend.mt.toLocaleString()} MT · ${pend.status}`;
  }
  if (ql.includes('eligible')||ql.includes('re-apply')) {
    const el=RA.filter(isEligible), nel=RA.filter(r=>!isEligible(r));
    const inShipment = nel.filter(r=>!r.cargoArrived);
    const belowThresh = nel.filter(r=>r.cargoArrived && r.realPct<0.6);
    return `<strong>Rule: Realization ≥ 60% AND cargo arrived at JKT</strong><br>`
      +`<em style='font-size:10.5px;color:#64748b'>Utilization % ≠ Realization %. Moves to Realization only upon JKT arrival.</em><br><br>`
      +`<strong>✅ ${el.length} eligible:</strong><br>${el.map(r=>`${r.code} (Real: ${(r.realPct*100).toFixed(0)}%)`).join(', ')}<br><br>`
      +(inShipment.length?`<strong>🚢 ${inShipment.length} in shipment (Util counted, Real pending arrival):</strong><br>${inShipment.map(r=>`${r.code} (Util: ${r.utilPct!=null?(r.utilPct*100).toFixed(0):0}%, ETA: ${r.etaJKT})`).join(', ')}<br><br>`:'')
      +(belowThresh.length?`<strong>❌ Below 60% realization:</strong><br>${belowThresh.map(r=>`${r.code} (Real: ${(r.realPct*100).toFixed(0)}%)`).join(', ')}`:'');
  }
  if (ql.includes('revision')) {
    const act=SPI.filter(d=>revisionStatus(d)==='active');
    const pnd=SPI.filter(d=>revisionStatus(d)==='revpending');
    const cmp=SPI.filter(d=>revisionStatus(d)==='completed');
    return `<strong>${act.length} Under Revision:</strong><br>${act.map(d=>`${d.code}: ${d.revStatus}`).join('<br>')}`
      +(pnd.length?`<br><br><strong>⏳ ${pnd.length} PENDING (PERTEK Terbit, SPI Belum):</strong><br>${pnd.map(d=>`${d.code}: ${d.revStatus}`).join('<br>')}`:'')
      +(cmp.length?`<br><br><strong>✅ ${cmp.length} COMPLETE (SPI Terbit):</strong><br>${cmp.map(d=>`${d.code}: ${d.revStatus}`).join('<br>')}`:'' );
  }
  if (ql.includes('pending')) return `<strong>${PENDING.length} pending MoI:</strong><br>${PENDING.map(d=>`${d.code}: ${d.status}`).join('<br>')}`;
  if (ql.includes('realization')||ql.includes('top')) {
    const top=[...RA].sort((a,b)=>b.realPct-a.realPct).slice(0,5);
    return `<strong>Top realization:</strong><br>${top.map(r=>`${r.code}: ${(r.realPct*100).toFixed(0)}% (${r.berat.toLocaleString()} MT)`).join('<br>')}`;
  }
  if (ql.includes('total')||ql.includes('summary')) {
    const spiT = (typeof canonicalObtained === 'function')
      ? SPI.reduce((s,d)=>s+canonicalObtained(d),0)
      : SPI.reduce((s,d)=>s+d.obtained,0);
    const pendT = PENDING.reduce((s,d)=>s+d.mt,0);
    return `<strong>Summary:</strong><br>Obtained: ${spiT.toLocaleString()} MT · ${SPI.length} co.<br>Pending: ${pendT.toLocaleString()} MT · ${PENDING.length} co.<br>Re-Apply Eligible: ${SPI.length} co. · ${spiT.toLocaleString()} MT quota<br>Re-Apply Submitted (Stage 2): ${RA.filter(isReapplySubmitted).length} co.<br>Realized (cargo arrived): ${RA.filter(r=>r.cargoArrived).length} co.<br><br>Eligibility rule: Realization ≥ 60% AND cargo arrived at JKT`;
  }
  return `Try: company name (e.g. "BTS"), "who is eligible", "active revisions", "pending companies", "top realization", or "total summary".`;
}

/* ══════════════════════════════════════════════════
   NAVIGATION
══════════════════════════════════════════════════ */
function goPage(id, el) {
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t=>t.classList.remove('active'));
  const pg = document.getElementById('page-'+id);
  if (pg) pg.classList.add('active');
  if (el) el.classList.add('active');
  // Rebuild Available Quota page on navigate
  if (id === 'availquota') {
    buildAvqPageKPIs();
    buildAvailableQuota(); // existing chart builder
    buildAvqProdChart();
    // reset tab to chart view
    setAvqTab('chart', document.getElementById('avqTabChart'));
  }
  // Render the unified Utilization & Realization table fresh on navigate
  // (data-dependent; the init render can race the data load → empty table).
  if (id === 'utilization' && typeof renderUtilTable === 'function') {
    renderUtilTable();
  }
}
function navFilter(f) {
  const tabs = document.querySelectorAll('.nav-tab');
  goPage('all', tabs[4]);
  mFilter = f;
  document.querySelectorAll('#page-all .fpill').forEach(p=>p.classList.remove('on'));
  const map = {ALL:0,SPI:1,PENDING:2,REV:3,ELIGIBLE:4};
  if (map[f]!=null) document.querySelectorAll('#page-all .fpill')[map[f]].classList.add('on');
  renderMain();
}

/* ══════════════════════════════════════════════════
   IMPORT / EXPORT
══════════════════════════════════════════════════ */
function openImport()  {
  document.getElementById('importModal').classList.add('open');
  setMTab('manual', document.querySelector('.mtab.active') || document.querySelector('.mtab'));
  // Mark companies with saved drafts in the dropdown so user knows
  // there's unfinished work to resume.
  if (typeof refreshDropdownDraftBadges === 'function') refreshDropdownDraftBadges();
}

function closeImport() {
  // ── Snapshot current form state so accidental close (✕ / backdrop /
  //    Esc) doesn't lose user input. Save is keyed by (role, company).
  //    Survives until next save-success or 7d TTL.
  try {
    if (typeof captureModalState === 'function' && typeof saveFormDraft === 'function') {
      const s = captureModalState();
      if (s && s.code && s.role) {
        saveFormDraft(s.code, s.role, s.data);
        if (typeof refreshDropdownDraftBadges === 'function') refreshDropdownDraftBadges();
        // Brief, low-key toast — only when there's actually a draft to save
        if (typeof showToast === 'function' &&
            typeof _isDraftNonEmpty === 'function' && _isDraftNonEmpty(s.data)) {
          showToast(`📝 Draft ${s.code} disimpan — buka kembali untuk lanjut`, 'info');
        }
      }
    }
  } catch(e) { console.warn('closeImport draft save failed:', e); }
  document.getElementById('importModal').classList.remove('open');
}
function setMTab(id,el){ document.querySelectorAll('.mtab').forEach(t=>t.classList.remove('active')); el.classList.add('active'); document.querySelectorAll('.m-sec').forEach(s=>s.classList.remove('active')); document.getElementById('mt-'+id).classList.add('active'); }

/* ══════════════════════════════════════════════════
   FORM DRAFT — capture / restore / debounced auto-save
   Persists modal field values across accidental closes.
══════════════════════════════════════════════════ */
function captureModalState() {
  const codeEl = document.getElementById('editCo');
  if (!codeEl || !codeEl.value) return null;
  const role = typeof currentRole !== 'undefined' ? currentRole : null;
  if (!role) return null;
  const data = { fields: {}, submitMT: {}, obtainedMT: {}, reapplyMT: {} };
  // Simple top-level inputs that hold submission/PERTEK/SPI/status info.
  ['eSubmitDate','ePertekNo','ePertekDate','eSpiNo','eSpiDate',
   'eStatus','eStatusUpdate','eRem','eTarget','eBerat','eETA',
   'ePIBRelease','eUtilMT'].forEach(id => {
    const el = document.getElementById(id);
    if (el && el.value !== '' && el.value != null) data.fields[id] = el.value;
  });
  document.querySelectorAll('.pmt-submit-inp').forEach(inp => {
    if (inp.value && inp.dataset.prod) data.submitMT[inp.dataset.prod] = inp.value;
  });
  document.querySelectorAll('.pmt-obtained-inp').forEach(inp => {
    if (inp.value && inp.dataset.prod) data.obtainedMT[inp.dataset.prod] = inp.value;
  });
  document.querySelectorAll('.reapply-prod-inp').forEach(inp => {
    if (inp.value && inp.dataset.prod) data.reapplyMT[inp.dataset.prod] = inp.value;
  });
  return { code: codeEl.value, role, data };
}

function applyFormDraft(draft) {
  if (!draft || !draft.data) return 0;
  const d = draft.data;
  let restored = 0;
  const _q = sel => { try { return document.querySelector(sel); } catch(e) { return null; } };
  Object.entries(d.fields || {}).forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (el) { el.value = val; restored++; }
  });
  Object.entries(d.submitMT || {}).forEach(([prod, val]) => {
    const inp = _q(`.pmt-submit-inp[data-prod="${CSS.escape(prod)}"]`);
    if (inp) { inp.value = val; restored++; }
  });
  Object.entries(d.obtainedMT || {}).forEach(([prod, val]) => {
    const inp = _q(`.pmt-obtained-inp[data-prod="${CSS.escape(prod)}"]`);
    if (inp) { inp.value = val; restored++; }
  });
  Object.entries(d.reapplyMT || {}).forEach(([prod, val]) => {
    const inp = _q(`.reapply-prod-inp[data-prod="${CSS.escape(prod)}"]`);
    if (inp) { inp.value = val; restored++; }
  });
  return restored;
}

let _draftSaveTimer = null;
function scheduleDraftSave() {
  clearTimeout(_draftSaveTimer);
  _draftSaveTimer = setTimeout(() => {
    try {
      const s = captureModalState();
      if (s && typeof saveFormDraft === 'function') {
        saveFormDraft(s.code, s.role, s.data);
      }
    } catch(e) { /* swallow */ }
  }, 500);
}

/* Add a 📝 badge to dropdown options whose code has a saved draft so
   the user knows where to resume. Idempotent — safe to call multiple
   times after open / save / discard. */
function refreshDropdownDraftBadges() {
  const sel = document.getElementById('editCo');
  if (!sel || typeof listDraftCompanyCodes !== 'function') return;
  const drafts = listDraftCompanyCodes();
  Array.from(sel.options).forEach(opt => {
    if (!opt.value) return;
    const baseText = opt.dataset.baseLabel || opt.textContent.replace(/^📝\s*/, '');
    opt.dataset.baseLabel = baseText;
    opt.textContent = drafts.has(opt.value) ? `📝 ${baseText}` : baseText;
  });
}

/* One-time wire: attach a debounced input listener to the import modal
   so any typing / select-change triggers a draft save. Runs after DOM
   is ready; safe to call multiple times (event listener is idempotent). */
function _wireDraftCaptureOnce() {
  const modal = document.getElementById('importModal');
  if (!modal || modal.dataset.draftWired === '1') return;
  modal.dataset.draftWired = '1';
  modal.addEventListener('input',  scheduleDraftSave, true);
  modal.addEventListener('change', scheduleDraftSave, true);
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _wireDraftCaptureOnce);
} else {
  _wireDraftCaptureOnce();
}