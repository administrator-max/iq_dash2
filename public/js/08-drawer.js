/* ═══════════════════════════════════════
   DRAWER — Company Detail Side Panel
   + Search Handler
═══════════════════════════════════════ */

/* ══════════════════════════════════════════════════
   DRAWER
══════════════════════════════════════════════════ */
/* ── CYCLE TIMELINE for drawer ── */
function buildCycleTimeline(co) {
  if (!co.cycles || !co.cycles.length) return '';
  const typeColor = t => {
    if (t.startsWith('Submit #') || t === 'Submit (Process)') return {bg:'#eff4ff',bd:'#c3d3f9',tx:'#1e56c6',ico:'↑'};
    if (t.startsWith('Obtained #'))  return {bg:'#edfcf2',bd:'#a7f3c4',tx:'#14673e',ico:'✓'};
    if (t.startsWith('Revision'))    return {bg:'#fefce8',bd:'#fde68a',tx:'#8f4d0a',ico:'🔄'};
    if (t.startsWith('Obtained (Rev')) return {bg:'#f5f3ff',bd:'#ddd6fe',tx:'#5b21b6',ico:'✓'};
    return {bg:'#f8fafc',bd:'#e2e8f0',tx:'#4a5568',ico:'·'};
  };
  const rows = co.cycles.map(c => {
    const col = typeColor(c.type);
    // Per-product MT chips — color-coded by product type
    const PDOT = {
      'GL BORON':'#0369a1','GI BORON':'#0f766e','BORDES ALLOY':'#dc2626',
      'AS STEEL':'#64748b','SHEETPILE':'#b45309','SEAMLESS PIPE':'#0d6946',
      'HOLLOW PIPE':'#78716c','PPGL CARBON':'#7c3aed',
      'ERW PIPE OD≤140mm':'#9333ea','ERW PIPE OD>140mm':'#0891b2','HRC/HRPO ALLOY':'#ca8a04',
    };
    const prodStr = c.products && Object.keys(c.products).length
      ? Object.entries(c.products).map(([k,v]) => {
          const col = PDOT[k] || '#64748b';
          const bg  = col + '18'; // 10% opacity hex approximation
          const mtTxt = v !== 'TBA' && typeof v === 'number' ? v.toLocaleString() + ' MT' : (v || 'TBA');
          return `<span style="display:inline-flex;align-items:center;gap:4px;font-size:10px;padding:2px 6px;border-radius:3px;background:${bg};border:1px solid ${col}33;color:${col}">
            <span style="display:inline-block;width:6px;height:6px;border-radius:1px;background:${col};flex-shrink:0"></span>
            <span style="font-weight:600">${k}</span>
            <span style="font-family:'DM Mono',monospace;opacity:.8">${mtTxt}</span>
          </span>`;
        }).join(' ')
      : '';
    return `<div style="display:flex;gap:0;margin-bottom:6px">
      <div style="display:flex;flex-direction:column;align-items:center;width:24px;flex-shrink:0">
        <div style="width:20px;height:20px;border-radius:50%;background:${col.bg};border:1.5px solid ${col.bd};display:flex;align-items:center;justify-content:center;font-size:10px;color:${col.tx};font-weight:700">${col.ico}</div>
        <div style="width:1px;flex:1;background:var(--border);min-height:10px"></div>
      </div>
      <div style="flex:1;padding:0 0 0 8px;margin-bottom:2px">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:4px">
          <span style="font-size:11px;font-weight:700;color:${col.tx}">${c.type}</span>
          ${c.mt!==undefined&&c.mt!==0?`<span style="font-size:10.5px;font-family:'DM Mono',monospace;color:var(--txt2);font-weight:600">${c.mt==='TBA'?'TBA MT':Number(Math.abs(typeof c.mt==='number'?c.mt:0)).toLocaleString()+' MT'}</span>`:''}
        </div>
        <div style="display:flex;gap:10px;margin:3px 0;flex-wrap:wrap">
          <div style="font-size:10px;color:var(--txt3)">
            <span style="font-weight:700;color:var(--txt2)">${c.submitType||'Submit'}</span>
            <span style="margin-left:4px">${c.submitDate||'TBA'}</span>
          </div>
          <div style="font-size:10px;color:var(--txt3)">
            <span style="font-weight:700;color:var(--txt2)">${c.releaseType||'Release'}</span>
            <span style="margin-left:4px;color:${c.releaseDate==='TBA'?'var(--amber)':'var(--green)'};font-weight:${c.releaseDate==='TBA'?'600':'400'}">${c.releaseDate||'TBA'}</span>
          </div>
        </div>
        ${prodStr?`<div style="display:flex;flex-wrap:wrap;gap:3px;margin-top:2px">${prodStr}</div>`:''}
        ${c.status?`<div style="font-size:10px;color:var(--txt3);margin-top:2px;font-style:italic">${c.status}</div>`:''}
      </div>
    </div>`;
  }).join('');
  return `<div class="d-sec">Submission Cycle Timeline</div>
    <div style="padding:4px 0 8px">${rows}</div>`;
}

function openDrawer(code) {
  const co = getSPI(code); if (!co) { openDrawerPending(code); return; }
  const ra = getRA(code);
  document.getElementById('d-code').textContent = code;
  const _rs = revisionStatus(co);
  document.getElementById('d-grp').textContent = `Group ${co.group}  ·  ${_rs==='clean'?'Completed':_rs==='active'?'Under Revision':_rs==='revpending'?'PENDING — PERTEK Terbit, SPI Belum':'COMPLETE — SPI Terbit'}`;

  const statRow = `<div class="d-stats">
    <div class="d-stat"><div class="d-sv" style="color:var(--teal)">${co.obtained.toLocaleString()}</div><div class="d-sl">MT Obtained</div></div>
    <div class="d-stat"><div class="d-sv" style="color:var(--navy)">${co.submit1.toLocaleString()}</div><div class="d-sl">MT Submit</div></div>
    ${ra?`<div class="d-stat"><div class="d-sv" style="color:${ra.cargoArrived?realColor(ra.realPct):'var(--blue)'}">${ra.cargoArrived?(ra.realPct*100).toFixed(0):(ra.utilPct!=null?(ra.utilPct*100).toFixed(0):'—')}%</div><div class="d-sl">${ra.cargoArrived?'Realization':'Utilization'}</div></div>`:''}
    ${ra?`<div class="d-stat"><div class="d-sv" style="font-size:13px;color:${isReapplySubmitted(ra)?'#5b21b6':isEligible(ra)?'var(--green)':'var(--orange)'}">${isReapplySubmitted(ra)?'🔵 Submitted':isEligible(ra)?'✓ Eligible':'✗ Not Yet'}</div><div class="d-sl">Re-Apply</div></div>`:''}
  </div>`;

  const spiInfo = `<div class="d-sec">SPI / Permit Details</div><div class="dl">
    <div class="dl-r"><div class="dl-k">Products</div><div class="dl-v">${co.products.join(' · ')}</div></div>
    <div class="dl-r"><div class="dl-k">Status</div><div class="dl-v">${statusBadge(co)}</div></div>
    <div class="dl-r"><div class="dl-k">SPI / Pertek</div><div class="dl-v" style="font-size:11.5px;font-family:'DM Mono',monospace;line-height:1.5">${co.spiRef}</div></div>
    ${co.pertekNo?`<div class="dl-r"><div class="dl-k">PERTEK No.</div><div class="dl-v" style="font-family:'DM Mono',monospace;color:var(--blue)">${co.pertekNo}</div></div>`:''}
    ${co.spiNo?`<div class="dl-r"><div class="dl-k">SPI No.</div><div class="dl-v" style="font-family:'DM Mono',monospace;color:var(--teal)">${co.spiNo}</div></div>`:''}
    ${co.statusUpdate?`<div class="dl-r"><div class="dl-k" style="color:var(--violet)">📋 Status Update<br><span style="font-size:9px;font-weight:400;color:var(--txt3);font-style:italic">Submission-level</span></div><div class="dl-v" style="font-size:11.5px;white-space:pre-wrap;line-height:1.5;color:var(--txt2)">${co.statusUpdate}</div></div>`:''}
    ${co.utilizationMT!=null?`<div class="dl-r"><div class="dl-k">Utilization MT</div><div class="dl-v" style="font-family:'DM Mono',monospace">${co.utilizationMT.toLocaleString()} MT</div></div>`:''}
    ${co.availableQuota!=null?`<div class="dl-r"><div class="dl-k">Available Quota</div><div class="dl-v" style="font-weight:700;color:${co.availableQuota>0?'var(--teal)':co.availableQuota===0?'var(--txt3)':'var(--red2)'};font-family:'DM Mono',monospace">${co.availableQuota.toLocaleString()} MT${co.revType==='active'?' <span style="font-size:9.5px;font-weight:400;color:var(--amber2)">(original PERTEK − revision TBA)</span>':''}</div></div>`:''}
    ${co.updatedBy?`<div class="dl-r"><div class="dl-k">Last Updated By</div><div class="dl-v"><span class="upd-tag upd-${co.updatedBy.toLowerCase()}">${co.updatedBy}</span>${co.updatedDate?' · '+co.updatedDate:''}</div></div>`:''}
    <div class="dl-r"><div class="dl-k">Submit Date</div><div class="dl-v">${co.remarks}</div></div>
  </div>`;

  // Revision — no history, no strikethrough, clean change display
  let revInfo = '';
  if (co.revType !== 'none') {
    const isSplitDraw = co.revFrom.length === 1 && co.revTo.length > 1;
    const chgRows = co.revFrom.length
      ? isSplitDraw
        ? (() => {
            const f = co.revFrom[0];
            return `<div style="padding:6px 0;border-bottom:1px solid var(--border)">
              <div style="padding:7px 10px;background:var(--bg);border:1px solid var(--border);border-radius:var(--r);margin-bottom:7px">
                <div style="font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--txt3);margin-bottom:2px">${f.label}</div>
                <div style="font-weight:600">${f.prod}</div>
                <div style="font-size:10.5px;font-family:'DM Mono',monospace;color:var(--txt3)">${f.mt.toLocaleString()} MT</div>
              </div>
              <div style="display:flex;align-items:center;gap:5px;padding:0 4px 6px;font-size:10px;color:var(--orange);font-weight:700">↓ Split into:</div>
              ${co.revTo.map(t => {
                const isRet = t.label==='Retained';
                return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:5px">
                  <div style="flex:1;padding:5px 9px;background:${isRet?'var(--blue-bg)':'var(--green-bg)'};border:1px solid ${isRet?'var(--blue-bd)':'var(--green-bd)'};border-radius:var(--r)">
                    <div style="font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:${isRet?'var(--blue)':'var(--green)'};margin-bottom:2px">${t.label}</div>
                    <div style="font-weight:700;color:${isRet?'var(--blue)':'var(--green)'}">${t.prod}</div>
                    <div style="font-size:10.5px;font-family:'DM Mono',monospace;color:${isRet?'var(--blue)':'var(--green)'}">${t.mt.toLocaleString()} MT</div>
                  </div>
                </div>`;
              }).join('')}
            </div>`;
          })()
        : co.revFrom.map((f,i) => {
            const t = co.revTo[i]||{};
            return `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)">
              <div style="flex:1;padding:5px 9px;background:var(--bg);border:1px solid var(--border);border-radius:var(--r);font-size:11.5px">
                <div style="font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--txt3);margin-bottom:2px">${f.label||'Before'}</div>
                <div style="font-weight:600">${f.prod}</div>
                <div style="font-size:10.5px;font-family:'DM Mono',monospace;color:var(--txt3)">${f.mt.toLocaleString()} MT</div>
              </div>
              <div style="font-size:18px;color:var(--txt3)">→</div>
              <div style="flex:1;padding:5px 9px;background:var(--green-bg);border:1px solid var(--green-bd);border-radius:var(--r);font-size:11.5px">
                <div style="font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--green);margin-bottom:2px">${t.label||'After'}</div>
                <div style="font-weight:700;color:var(--green)">${t.prod||'?'}</div>
                <div style="font-size:10.5px;font-family:'DM Mono',monospace;color:var(--green)">${(t.mt||0).toLocaleString()} MT</div>
              </div>
            </div>`;
          }).join('')
      : '';
    const _rstc = revisionStatus(co);
    revInfo = `<div class="d-sec">Revision — Current Status</div>
      <div style="padding:8px 11px;background:${_rstc==='active'?'var(--amber-bg)':_rstc==='revpending'?'var(--orange-bg)':'var(--violet-bg)'};border:1px solid ${_rstc==='active'?'var(--amber-bd)':_rstc==='revpending'?'var(--orange-bd)':'var(--violet-bd)'};border-radius:var(--r);margin-bottom:8px">
        <div style="font-size:11.5px;font-weight:700;color:${_rstc==='active'?'var(--amber)':_rstc==='revpending'?'var(--orange)':'var(--violet)'};margin-bottom:3px">${_rstc==='active'?'🔄 Awaiting Ministry Approval':_rstc==='revpending'?'⏳ PENDING — PERTEK Terbit, SPI Belum Terbit':'✅ COMPLETE — SPI / SPI Perubahan Terbit'}</div>
        <div style="font-size:11px;color:var(--txt2)">${co.revStatus}</div>
        <div style="font-size:10.5px;color:var(--txt3);margin-top:2px">Submitted: ${co.revSubmitDate}</div>
      </div>
      ${chgRows}`;
  }

  // Realization info
  let utilInfo = '';
  if (ra) {
    const ineligReason = !isEligible(ra) && !isReapplySubmitted(ra)
      ? (!ra.cargoArrived
          ? `⚠ Cargo in shipment (ETA: ${ra.etaJKT}) — Realization = 0% until cargo arrives at JKT & Beacukai`
          : `⚠ Realization ${(ra.realPct*100).toFixed(1)}% below 60% threshold`)
      : '';
    const drDispReal = ra.cargoArrived ? ra.realPct  : null;
    const drDispUtil = ra.cargoArrived ? null        : ra.utilPct;
    utilInfo = `<div class="d-sec">Import Status, Utilization &amp; Realization</div><div class="dl">
      <div class="dl-r"><div class="dl-k">Product</div><div class="dl-v">${ra.product}</div></div>
      <div class="dl-r"><div class="dl-k">Obtained Quota</div><div class="dl-v t-mono">${ra.obtained.toLocaleString()} MT</div></div>
      <div class="dl-r"><div class="dl-k">Import Volume</div><div class="dl-v t-mono" style="color:var(--txt2)">${ra.berat.toLocaleString()} MT <span style="font-size:10px;color:var(--txt3)">(allocated/sold)</span></div></div>
      <div class="dl-r"><div class="dl-k">Utilization %</div><div class="dl-v">${drDispUtil!=null?`<strong style='color:var(--blue)'>${(drDispUtil*100).toFixed(1)}%</strong> <span style='font-size:10px;color:var(--txt3)'>(cargo in shipment — moves to Realization upon JKT arrival)</span>`:'<span style="font-size:11px;color:var(--txt3);font-style:italic">— Cargo arrived, see Realization %</span>'}</div></div>
      <div class="dl-r"><div class="dl-k">Realization %</div><div class="dl-v">${drDispReal!=null?`<strong style='color:${realColor(drDispReal)}'>${(drDispReal*100).toFixed(1)}%</strong> <span style='font-size:10px;color:var(--txt3)'>(arrived at JKT &amp; Beacukai ÷ obtained)</span>`:'<span style="font-size:11px;color:var(--txt3);font-style:italic">— Cargo not yet at JKT</span>'}</div></div>
      <div class="dl-r"><div class="dl-k">ETA / Arrival</div><div class="dl-v">${ra.cargoArrived
        ? `<span class='badge b-eligible' style='font-size:10.5px'>✓ Arrived — ${ra.etaJKT}</span>`
        : `<span style='font-size:11px;font-weight:700;color:var(--orange)'>🚢 In Shipment — ${ra.etaJKT||'—'}</span>`
      }</div></div>
      <div class="dl-r"><div class="dl-k">Eligibility Rule</div><div class="dl-v" style="font-size:11px;color:var(--txt3);line-height:1.5">Realization ≥ 60% <em>AND</em> cargo arrived at JKT &amp; Beacukai-registered.<br><em>Utilization % alone does not confer eligibility.</em></div></div>
      <div class="dl-r"><div class="dl-k">Eligibility</div><div class="dl-v">${isReapplySubmitted(ra)?'<span class="badge b-reapply">🔵 Re-Apply Submitted — Stage 2 On Process</span>':isEligible(ra)?'<span class="badge b-eligible">✓ Eligible for Re-Apply</span>':`<span class="badge b-ineligible">✗ Not Eligible</span><div style='font-size:10.5px;color:var(--txt3);margin-top:4px'>${ineligReason}</div>`}</div></div>
      <div class="dl-r"><div class="dl-k">Shipment Ref.</div><div class="dl-v">${ra.catatan}</div></div>
      <div class="dl-r"><div class="dl-k">Target Obtained</div><div class="dl-v t-mono" style="color:var(--amber2)">${ra.target?ra.target.toLocaleString()+' MT':'TBA'}</div></div>
      <div class="dl-r"><div class="dl-k">Est. Re-Apply Period</div><div class="dl-v" style="font-weight:700;color:var(--violet)">${ra.reapplyEst || '—'} <span style="font-size:10px;color:var(--txt3);font-weight:400">${ra.cargoArrived ? '(Arrival Date + 7 days)' : '(Available once cargo arrives)'}</span></div></div>
    </div>`;
  }

  // Re-Apply Stage 2 block — only for companies that have submitted
  let reapplyInfo = '';
  if (ra && isReapplySubmitted(ra)) {
    reapplyInfo = `
    <div class="d-sec" style="color:#5b21b6">🔵 Re-Apply — Stage 2: PERTEK Pending / On Process</div>
    <div style="padding:12px 14px;background:#f5f3ff;border:1px solid #c4b5fd;border-radius:var(--r);margin-bottom:10px">
      <div style="font-size:11.5px;font-weight:700;color:#5b21b6;margin-bottom:10px">📋 Re-Apply Request Details</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
        <div style="padding:7px 10px;background:#fff;border:1px solid #e9d5ff;border-radius:var(--r)">
          <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--txt3);margin-bottom:2px">Product</div>
          <div style="font-weight:700;color:#5b21b6">${ra.reapplyProduct}</div>
        </div>
        <div style="padding:7px 10px;background:#fff;border:1px solid #e9d5ff;border-radius:var(--r)">
          <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--txt3);margin-bottom:2px">Submitted On</div>
          <div style="font-weight:700">${ra.reapplySubmitDate}</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:10px">
        <div style="text-align:center;padding:8px 6px;background:#fff;border:1px solid #e9d5ff;border-radius:var(--r)">
          <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:var(--txt3);margin-bottom:3px">Prev. Quota #1</div>
          <div style="font-size:14px;font-weight:700;font-family:'DM Mono',monospace;color:var(--txt2)">${(ra.reapplyPrevObtained||0).toLocaleString()}</div>
          <div style="font-size:9px;color:var(--txt3)">MT</div>
        </div>
        <div style="text-align:center;padding:8px 6px;background:#fff;border:1px solid #e9d5ff;border-radius:var(--r)">
          <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:var(--txt3);margin-bottom:3px">+ Additional</div>
          <div style="font-size:14px;font-weight:700;font-family:'DM Mono',monospace;color:#5b21b6">+${(ra.reapplyAdditional||0).toLocaleString()}</div>
          <div style="font-size:9px;color:var(--txt3)">MT requested</div>
        </div>
        <div style="text-align:center;padding:8px 6px;background:#5b21b6;border-radius:var(--r)">
          <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:rgba(255,255,255,.7);margin-bottom:3px">New Total</div>
          <div style="font-size:16px;font-weight:700;font-family:'DM Mono',monospace;color:#fff">${(ra.reapplyNewTotal||0).toLocaleString()}</div>
          <div style="font-size:9px;color:rgba(255,255,255,.6)">MT total quota</div>
        </div>
      </div>
      <div style="padding:8px 10px;background:#fff;border:1px solid #e9d5ff;border-radius:var(--r)">
        <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--txt3);margin-bottom:4px">Current Status</div>
        <div style="display:flex;align-items:center;gap:7px">
          <span style="width:7px;height:7px;border-radius:50%;background:#8b5cf6;flex-shrink:0;animation:pulse 1.6s infinite"></span>
          <span style="font-size:11.5px;font-weight:600;color:#5b21b6">${ra.reapplyStatus}</span>
        </div>
      </div>
    </div>`;
  }

  document.getElementById('d-body').innerHTML = statRow + buildCycleTimeline(co) + spiInfo + revInfo + utilInfo + reapplyInfo;
  document.getElementById('overlay').classList.add('open');
}

function openDrawerPending(code) {
  const co = PENDING.find(d => d.code === code); if (!co) return;
  document.getElementById('d-code').textContent = code;
  document.getElementById('d-grp').textContent = `Group ${co.group}  ·  New Submission`;
  document.getElementById('d-body').innerHTML = `
    <div class="notice n-red" style="margin-bottom:14px"><strong>📬 New Submission — Awaiting PERTEK / SPI</strong><br>${co.status} · ${co.date}</div>
    <div class="dl">
      <div class="dl-r"><div class="dl-k">Products</div><div class="dl-v">${chips(co.products)}</div></div>
      <div class="dl-r"><div class="dl-k">Submitted</div><div class="dl-v t-mono">${co.mt.toLocaleString()} MT</div></div>
      <div class="dl-r"><div class="dl-k">Submit Date</div><div class="dl-v">${co.remarks}</div></div>
      <div class="dl-r"><div class="dl-k">Last Update</div><div class="dl-v">${co.date}</div></div>
      <div class="dl-r"><div class="dl-k">Approval Stage</div><div class="dl-v"><span class="badge b-pending">${co.status}</span></div></div>
    </div>`;
  document.getElementById('overlay').classList.add('open');
}

function maybeCloseDrawer(e) { if (e.target === document.getElementById('overlay')) closeDrawer(); }
function closeDrawer() { document.getElementById('overlay').classList.remove('open'); }

/* ══════════════════════════════════════════════════
   GLOBAL SEARCH
══════════════════════════════════════════════════ */
function handleSearch(q) {
  const dd = document.getElementById('sDrop');
  if (!q || q.length < 1) { dd.classList.remove('open'); return; }
  const ql = q.toLowerCase();
  const results = [];
  filteredSPI().forEach(co => {
    const sc = (co.code.toLowerCase().startsWith(ql)?3:0)+(co.code.toLowerCase().includes(ql)?2:0)+
               (co.products.some(p=>p.toLowerCase().includes(ql))?1:0)+(co.spiRef.toLowerCase().includes(ql)?1:0);
    if (sc > 0) results.push({type:'SPI', co, sc});
  });
  PENDING.forEach(co => {
    const sc = (co.code.toLowerCase().includes(ql)?2:0)+(co.products.some(p=>p.toLowerCase().includes(ql))?1:0);
    if (sc > 0) results.push({type:'PENDING', co, sc});
  });
  results.sort((a,b) => b.sc - a.sc);
  if (!results.length) { dd.innerHTML='<div class="sd-none">No results</div>'; dd.classList.add('open'); return; }
  dd.innerHTML = `<div class="sd-hd">${results.length} result${results.length>1?'s':''}</div>`;
  results.slice(0,8).forEach(r => {
    const co = r.co; const ra = getRA(co.code);
    const badge = r.type==='PENDING' ? '<span class="badge b-pending" style="font-size:9px">Pending</span>'
      : co.revType==='active' ? '<span class="badge b-rev" style="font-size:9px">Revision</span>'
      : co.revType==='complete' ? '<span class="badge b-revdone" style="font-size:9px">Rev.Done</span>'
      : '<span class="badge b-spi" style="font-size:9px">SPI</span>';
    const div = document.createElement('div'); div.className = 'sd-row';
    div.innerHTML = `<div class="sd-code">${co.code}</div>
      <div class="sd-meta">
        <div class="sd-name">${(co.products||[]).join(' · ')} ${badge}</div>
        <div class="sd-detail">${r.type==='PENDING'?co.status:(co.spiRef||'').slice(0,60)}${ra?` · Realization: ${(ra.realPct*100).toFixed(0)}%`:''}</div>
      </div>`;
    div.onclick = () => { dd.classList.remove('open'); document.getElementById('gSearch').value=''; r.type==='PENDING'?openDrawerPending(co.code):openDrawer(co.code); };
    dd.appendChild(div);
  });
  dd.classList.add('open');
}
document.addEventListener('click', e => { if (!e.target.closest('.g-search') && !e.target.closest('.s-drop')) document.getElementById('sDrop').classList.remove('open'); });