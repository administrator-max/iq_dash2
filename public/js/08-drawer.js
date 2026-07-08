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

  // ── DEDUP: one entry per cycleType ─────────────────────────────────
  const _seenCycleTypes = new Set();
  const dedupedCycles = co.cycles.filter(c => {
    const key = (c.type || '').toLowerCase().trim();
    if (_seenCycleTypes.has(key)) return false;
    _seenCycleTypes.add(key);
    return true;
  });

  const rows = dedupedCycles.map(c => {
    const col = typeColor(c.type);
    const PDOT = {
      'GL BORON':'#0369a1','GI BORON':'#0f766e','BORDES ALLOY':'#dc2626',
      'AS STEEL':'#64748b','SHEETPILE':'#b45309','SEAMLESS PIPE':'#0d6946',
      'HOLLOW PIPE':'#78716c','PPGL CARBON':'#7c3aed',
      'ERW PIPE OD≤140mm':'#9333ea','ERW PIPE OD>140mm':'#0891b2','HRC/HRPO ALLOY':'#ca8a04',
    };
    const prodStr = c.products && Object.keys(c.products).length
      ? Object.entries(c.products).map(([k,v]) => {
          const col = PDOT[k] || '#64748b';
          const bg  = col + '18';
          const mtTxt = v !== 'TBA' && typeof v === 'number' ? fmtMt(v) + ' MT' : (v || 'TBA');
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
          ${c.mt!==undefined&&c.mt!==0?`<span style="font-size:10.5px;font-family:'DM Mono',monospace;color:var(--txt2);font-weight:600">${c.mt==='TBA'?'TBA MT':fmtMt(Math.abs(typeof c.mt==='number'?c.mt:0))+' MT'}</span>`:''}
        </div>
        <div style="display:flex;gap:10px;margin:3px 0;flex-wrap:wrap">
          <div style="font-size:10px;color:var(--txt3)">
            <span style="font-weight:700;color:var(--txt2)">${c.submitType||'Submit'}</span>
            <span style="margin-left:4px">${c.submitDate==='TBA'?'TBA':(fmtDateStd(c.submitDate)||'TBA')}</span>
          </div>
          <div style="font-size:10px;color:var(--txt3)">
            <span style="font-weight:700;color:var(--txt2)">${c.releaseType||'Release'}</span>
            <span style="margin-left:4px;color:${c.releaseDate==='TBA'?'var(--amber)':'var(--green)'};font-weight:${c.releaseDate==='TBA'?'600':'400'}">${c.releaseDate==='TBA'?'TBA':(fmtDateStd(cycleTerbitDate(c))||'TBA')}</span>
          </div>
        </div>
        ${prodStr?`<div style="display:flex;flex-wrap:wrap;gap:3px;margin-top:2px">${prodStr}</div>`:''}
        ${c.status?`<div style="font-size:10px;color:var(--txt3);margin-top:2px;font-style:italic">${c.status}</div>`:''}
      </div>
    </div>`;
  }).join('');

  // ── COLLAPSIBLE wrapper ────────────────────────────────────────────
  const cycleId = 'cyTl_' + (co.code || Math.random().toString(36).slice(2));
  return `<div class="d-sec" style="cursor:pointer;display:flex;align-items:center;justify-content:space-between;user-select:none"
    onclick="(function(el){el.style.display=el.style.display==='none'?'block':'none';this.querySelector('.cy-arrow').textContent=el.style.display==='none'?'▶':'▼';}).call(this,document.getElementById('${cycleId}'))">
    <span>Submission Cycle Timeline <span style="font-size:9px;color:var(--txt3);font-weight:400">(${dedupedCycles.length} cycles)</span></span>
    <span class="cy-arrow" style="font-size:10px;color:var(--txt3)">▼</span>
  </div>
  <div id="${cycleId}" style="padding:4px 0 8px">${rows}</div>`;
}

function openDrawer(code) {
  const co = getSPI(code); if (!co) { openDrawerPending(code); return; }
  const ra = getRA(code);
  // Silently refresh this company's data from server to ensure all users see latest
  fetch(`/api/company/${encodeURIComponent(code)}`).then(r=>r.json()).then(fresh => {
    // Merge fresh fields that might differ across sessions
    const fieldsToSync = ['obtained','utilizationMT','availableQuota','pertekNo','spiNo',
      'statusUpdate','updatedBy','updatedDate','spiRef','revType','revStatus','revSubmitDate'];
    fieldsToSync.forEach(f => { if (fresh[f] !== undefined) co[f] = fresh[f]; });
    if (fresh.cycles && fresh.cycles.length) co.cycles = fresh.cycles;
    if (fresh.shipments) co.shipments = fresh.shipments;
    if (fresh.utilizationByProd) co.utilizationByProd = fresh.utilizationByProd;
    if (fresh.availableByProd)   co.availableByProd   = fresh.availableByProd;
    // Fresh authoritative util/lots → recapture non-lot baseline (2026-06-26 fix).
    co._utilBaseline = {};
  }).catch(()=>{/* fallback to cached data — no-op */});

  document.getElementById('d-code').textContent = code;
  const _rs = revisionStatus(co);
  document.getElementById('d-grp').textContent = `Group ${co.group}  ·  ${_rs==='clean'?'Completed':_rs==='active'?'Under Revision':_rs==='revpending'?'PENDING — PERTEK Terbit, SPI Belum':'COMPLETE — SPI Terbit'}`;

  const statRow = `<div class="d-stats">
    <div class="d-stat"><div class="d-sv" style="color:var(--teal)">${fmtMt(co.obtained)}</div><div class="d-sl">MT Obtained</div></div>
    <div class="d-stat"><div class="d-sv" style="color:var(--navy)">${fmtMt(co.submit1)}</div><div class="d-sl">MT Submit</div></div>
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
    ${co.utilizationMT!=null?`<div class="dl-r"><div class="dl-k">Utilization MT</div><div class="dl-v" style="font-family:'DM Mono',monospace">${fmtMt(co.utilizationMT)} MT</div></div>`:''}
    ${co.availableQuota!=null?`<div class="dl-r"><div class="dl-k">Available Quota</div><div class="dl-v" style="font-weight:700;color:${co.availableQuota>0?'var(--teal)':co.availableQuota===0?'var(--txt3)':'var(--red2)'};font-family:'DM Mono',monospace">${fmtMt(co.availableQuota)} MT${co.revType==='active'?' <span style="font-size:9.5px;font-weight:400;color:var(--amber2)">(original PERTEK − revision TBA)</span>':''}</div></div>`:''}
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
                <div style="font-size:10.5px;font-family:'DM Mono',monospace;color:var(--txt3)">${fmtMt(f.mt)} MT</div>
              </div>
              <div style="display:flex;align-items:center;gap:5px;padding:0 4px 6px;font-size:10px;color:var(--orange);font-weight:700">↓ Split into:</div>
              ${co.revTo.map(t => {
                const isRet = t.label==='Retained';
                return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:5px">
                  <div style="flex:1;padding:5px 9px;background:${isRet?'var(--blue-bg)':'var(--green-bg)'};border:1px solid ${isRet?'var(--blue-bd)':'var(--green-bd)'};border-radius:var(--r)">
                    <div style="font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:${isRet?'var(--blue)':'var(--green)'};margin-bottom:2px">${t.label}</div>
                    <div style="font-weight:700;color:${isRet?'var(--blue)':'var(--green)'}">${t.prod}</div>
                    <div style="font-size:10.5px;font-family:'DM Mono',monospace;color:${isRet?'var(--blue)':'var(--green)'}">${fmtMt(t.mt)} MT</div>
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
                <div style="font-size:10.5px;font-family:'DM Mono',monospace;color:var(--txt3)">${fmtMt(f.mt)} MT</div>
              </div>
              <div style="font-size:18px;color:var(--txt3)">→</div>
              <div style="flex:1;padding:5px 9px;background:var(--green-bg);border:1px solid var(--green-bd);border-radius:var(--r);font-size:11.5px">
                <div style="font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--green);margin-bottom:2px">${t.label||'After'}</div>
                <div style="font-weight:700;color:var(--green)">${t.prod||'?'}</div>
                <div style="font-size:10.5px;font-family:'DM Mono',monospace;color:var(--green)">${fmtMt(t.mt||0)} MT</div>
              </div>
            </div>`;
          }).join('')
      : '';
    const _rstc = revisionStatus(co);
    revInfo = `<div class="d-sec">Revision — Current Status</div>
      <div style="padding:8px 11px;background:${_rstc==='active'?'var(--amber-bg)':_rstc==='revpending'?'var(--orange-bg)':'var(--violet-bg)'};border:1px solid ${_rstc==='active'?'var(--amber-bd)':_rstc==='revpending'?'var(--orange-bd)':'var(--violet-bd)'};border-radius:var(--r);margin-bottom:8px">
        <div style="font-size:11.5px;font-weight:700;color:${_rstc==='active'?'var(--amber)':_rstc==='revpending'?'var(--orange)':'var(--violet)'};margin-bottom:3px">${_rstc==='active'?'🔄 Awaiting Ministry Approval':_rstc==='revpending'?'⏳ PENDING — PERTEK Terbit, SPI Belum Terbit':'✅ COMPLETE — SPI / SPI Perubahan Terbit'}</div>
        <div style="font-size:11px;color:var(--txt2)">${co.revStatus}</div>
        <div style="font-size:10.5px;color:var(--txt3);margin-top:2px">Submitted: ${fmtDateStd(co.revSubmitDate)}</div>
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
      <div class="dl-r"><div class="dl-k">Obtained Quota</div><div class="dl-v t-mono">${fmtMt(ra.obtained)} MT</div></div>
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
      <div class="dl-r"><div class="dl-k">Target Obtained</div><div class="dl-v t-mono" style="color:var(--amber2)">${ra.target?fmtMt(ra.target)+' MT':'TBA'}</div></div>
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
          <div style="font-size:14px;font-weight:700;font-family:'DM Mono',monospace;color:var(--txt2)">${fmtMt(ra.reapplyPrevObtained||0)}</div>
          <div style="font-size:9px;color:var(--txt3)">MT</div>
        </div>
        <div style="text-align:center;padding:8px 6px;background:#fff;border:1px solid #e9d5ff;border-radius:var(--r)">
          <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:var(--txt3);margin-bottom:3px">+ Additional</div>
          <div style="font-size:14px;font-weight:700;font-family:'DM Mono',monospace;color:#5b21b6">+${fmtMt(ra.reapplyAdditional||0)}</div>
          <div style="font-size:9px;color:var(--txt3)">MT requested</div>
        </div>
        <div style="text-align:center;padding:8px 6px;background:#5b21b6;border-radius:var(--r)">
          <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:rgba(255,255,255,.7);margin-bottom:3px">New Total</div>
          <div style="font-size:16px;font-weight:700;font-family:'DM Mono',monospace;color:#fff">${fmtMt(ra.reapplyNewTotal||0)}</div>
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

  // ── Realization Details button block ────────────────────────────
  // Independent dari ra (RA record). Render kalau company punya rows di
  // table `realizations` (cek lewat REALIZATION_SUMMARY hasil endpoint
  // /api/realizations/summary). Klik buka modal dengan PIB breakdown.
  // Kalau belum ada data → tetap render tombol disabled-style sebagai
  // hint untuk import, biar user tahu fitur tersedia.
  const raSum = (typeof REALIZATION_SUMMARY === 'object' && REALIZATION_SUMMARY) ? REALIZATION_SUMMARY[co.code] : null;
  const hasRa = !!(raSum && raSum.pibs > 0);
  const raDetailBlock = `
    <div class="d-sec">Realization (PIB Customs Data)</div>
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;background:${hasRa?'#f0f7ff':'var(--bg2)'};border:1px solid ${hasRa?'var(--blue-bd)':'var(--border)'};border-radius:var(--r);margin-bottom:10px">
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;font-weight:600;color:var(--txt);margin-bottom:2px">
          ${hasRa ? '📦 Imported customs data tersedia' : '📭 Belum ada data realisasi PIB'}
        </div>
        ${hasRa
          ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px">
              <span style="font-size:10px;font-weight:700;padding:2px 8px;background:var(--blue-bg);color:var(--blue);border:1px solid var(--blue-bd);border-radius:10px;font-family:'DM Mono',monospace">${raSum.pibs} PIB${raSum.pibs===1?'':'s'}</span>
              <span style="font-size:10px;font-weight:700;padding:2px 8px;background:var(--teal-bg);color:var(--teal);border:1px solid var(--teal-bd);border-radius:10px;font-family:'DM Mono',monospace">${raSum.lines} line item${raSum.lines===1?'':'s'}</span>
            </div>`
          : `<div style="font-size:10.5px;color:var(--txt3);margin-top:2px">Import via Realization Import menu atau manual entry untuk lihat detail per-PIB.</div>`
        }
      </div>
      <button onclick="openRealizationDetail('${co.code}')"
        style="font-size:11px;font-weight:600;padding:7px 13px;border-radius:6px;
               background:${hasRa?'var(--blue)':'var(--bg)'};color:${hasRa?'#fff':'var(--txt3)'};
               border:${hasRa?'none':'1px solid var(--border2)'};cursor:pointer;
               display:inline-flex;align-items:center;gap:5px;transition:all .14s;white-space:nowrap;flex-shrink:0"
        onmouseover="this.style.background='${hasRa?'#1746b0':'var(--bg2)'}'"
        onmouseout="this.style.background='${hasRa?'var(--blue)':'var(--bg)'}'"
        title="Lihat detail per-PIB (Surat Persetujuan Pengeluaran Barang)">
        📋 Detail Realization
      </button>
    </div>`;

  // ── Lot-based realization (Berat Realized per shipment, entered by Ops) ──
  // Independent of PIB import — so realization recorded via shipments still has
  // a visible per-PT/per-lot detail (the PIB block above only covers imports).
  let lotRealRows = '', lotRealTotal = 0;
  if (co.shipments && typeof co.shipments === 'object') {
    Object.entries(co.shipments).forEach(([product, lots]) => {
      (lots || []).forEach(l => {
        const rm = Number(l.realMT) || 0;
        if (rm <= 0) return;
        lotRealTotal += rm;
        const arrived = l.cargoArrived || l.arrived;
        lotRealRows += `<tr>
          <td style="padding:4px 8px;font-size:11px">${product}</td>
          <td style="padding:4px 8px;font-size:11px;text-align:center">${l.lotNo != null ? l.lotNo : '-'}</td>
          <td style="padding:4px 8px;font-size:11px;text-align:right;font-family:'DM Mono',monospace;font-weight:700">${rm.toLocaleString()}</td>
          <td style="padding:4px 8px;font-size:11px;text-align:center">${l.pibDate || '—'}</td>
          <td style="padding:4px 8px;font-size:10.5px;text-align:center">${arrived ? '<span style="color:var(--green);font-weight:700">✓ Tiba</span>' : '<span style="color:var(--orange)">🚢 In-ship</span>'}</td>
        </tr>`;
      });
    });
  }
  const lotRealBlock = lotRealRows ? `
    <div class="d-sec">Realization — per Shipment / Lot</div>
    <div style="border:1px solid var(--border);border-radius:var(--r);overflow:hidden;margin-bottom:10px">
      <table style="width:100%;border-collapse:collapse">
        <thead><tr style="background:var(--bg2)">
          <th style="padding:5px 8px;font-size:9.5px;text-align:left;color:var(--txt3)">PRODUK</th>
          <th style="padding:5px 8px;font-size:9.5px;text-align:center;color:var(--txt3)">LOT</th>
          <th style="padding:5px 8px;font-size:9.5px;text-align:right;color:var(--txt3)">REALIZED MT</th>
          <th style="padding:5px 8px;font-size:9.5px;text-align:center;color:var(--txt3)">PIB DATE</th>
          <th style="padding:5px 8px;font-size:9.5px;text-align:center;color:var(--txt3)">STATUS</th>
        </tr></thead>
        <tbody>${lotRealRows}</tbody>
        <tfoot><tr style="background:var(--teal-bg)">
          <td colspan="2" style="padding:5px 8px;font-size:11px;font-weight:700">Total Realized</td>
          <td style="padding:5px 8px;font-size:11px;text-align:right;font-family:'DM Mono',monospace;font-weight:700;color:var(--teal)">${lotRealTotal.toLocaleString()}</td>
          <td colspan="2"></td>
        </tr></tfoot>
      </table>
    </div>` : '';

  document.getElementById('d-body').innerHTML = statRow + buildCycleTimeline(co) + spiInfo + revInfo + utilInfo + reapplyInfo + lotRealBlock + raDetailBlock;
  document.getElementById('overlay').classList.add('open');
}

function openDrawerPending(code) {
  const co = PENDING.find(d => d.code === code); if (!co) return;

  // Check if this PENDING company has PERTEK Terbit — determines the proper status display
  const hasCyclePertek = (co.cycles||[]).some(c =>
    c.releaseDate && c.releaseDate !== 'TBA' && !(/^obtained/i.test(c.type))
  );
  const pertekFromStatus = (co.status||'').match(/pertek\s*terbit/i) ||
    (co.remarks||'').match(/pertek\s*terbit/i);
  const hasPertek = hasCyclePertek || !!pertekFromStatus;

  const statusLabel = hasPertek
    ? '⏳ PENDING — PERTEK Terbit, Menunggu SPI'
    : '📬 New Submission — Awaiting PERTEK / SPI';
  const statusColor = hasPertek ? 'var(--orange)' : 'var(--red2)';

  document.getElementById('d-code').textContent = code;
  document.getElementById('d-grp').textContent = `Group ${co.group}  ·  ${hasPertek ? 'PENDING — PERTEK Terbit' : 'New Submission'}`;
  document.getElementById('d-body').innerHTML = `
    <div class="notice ${hasPertek ? 'n-orange' : 'n-red'}" style="margin-bottom:14px">
      <strong>${statusLabel}</strong><br>${co.status||''} · ${co.date||''}
      ${hasPertek ? `<div style="margin-top:4px;font-size:10.5px;font-weight:600;color:var(--orange)">
        ✅ PERTEK sudah terbit — CorpSec perlu input Obtained MT dan SPI data via Input Data form.
      </div>` : ''}
    </div>
    <div class="dl">
      <div class="dl-r"><div class="dl-k">Products</div><div class="dl-v">${chips(co.products)}</div></div>
      <div class="dl-r"><div class="dl-k">Submitted</div><div class="dl-v t-mono">${fmtMt(co.mt||0)} MT</div></div>
      <div class="dl-r"><div class="dl-k">Submit Date</div><div class="dl-v">${co.remarks||'—'}</div></div>
      <div class="dl-r"><div class="dl-k">Last Update</div><div class="dl-v">${co.date||'—'}</div></div>
      <div class="dl-r"><div class="dl-k">Approval Stage</div><div class="dl-v"><span class="badge ${hasPertek?'b-revpending':'b-pending'}">${co.status||'—'}</span></div></div>
    </div>
    ${buildCycleTimeline(co)}`;
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

/* ══════════════════════════════════════════════════
   REALIZATION DETAILS MODAL — per-company PIB breakdown
   Sources data from /api/realizations?company_code=CODE
   Renders one card per PIB (= one ship arrival) with:
     • Header: Company, Ship/Vessel Name, SPPB/PIB Number, Arrived Date
     • Table:  line items (NO, URAIAN BARANG, HS, VOLUME, ...)
   Plus Export XLSX of all line items for this company.
══════════════════════════════════════════════════ */
let _raDetailRows = []; // cached PIB rows for export
let _raLotRows   = []; // cached lot-based realization rows for export (fallback)

async function openRealizationDetail(code) {
  if (!code) return;
  const modal = document.getElementById('raDetailModal');
  const body  = document.getElementById('raDetailBody');
  if (!modal || !body) return;

  // Resolve company full name (header)
  const fullName = (typeof lookupCompanyNameByCode === 'function')
    ? lookupCompanyNameByCode(code) : '';
  const headerName = fullName || code;

  // Lookup vessel candidate from co.shipments (the .note field is the
  // user-typed ship name). We pass it down to the modal where each PIB
  // group can fall back to it when realization rows lack vessel info.
  const co = getSPI(code) || (typeof PENDING !== 'undefined' ? PENDING.find(p => p.code === code) : null);
  const allShipNotes = new Set();
  if (co && co.shipments) {
    Object.values(co.shipments).forEach(lots => {
      (lots || []).forEach(l => { if (l && l.note) allShipNotes.add(String(l.note).trim()); });
    });
  }
  const vesselHint = Array.from(allShipNotes).filter(Boolean).join(' · ') || '—';

  // Loading state
  body.innerHTML = `<div style="padding:40px;text-align:center;color:var(--txt3);font-size:13px">
    <div style="font-size:24px;margin-bottom:8px">⏳</div>
    Loading realization data for <strong>${code}</strong>…
  </div>`;
  modal.style.display = 'block';

  try {
    const res = await fetch(`/api/realizations?company_code=${encodeURIComponent(code)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    let rows = (data && data.realizations) || [];
    // ── Period filter ─────────────────────────────────────────────────────
    // realizations.pib_date is ISO 'YYYY-MM-DD'; pDate parses it cleanly.
    // When a period is active, show only PIB lines whose PIB date is in range.
    // Realization data is 100% dated (see audit), so this is a true time-slice
    // — unlike per-product utilization, where ~44% of lots have no pib_date.
    const _raTotalCount = rows.length;
    if (typeof PERIOD !== 'undefined' && PERIOD.active) {
      rows = rows.filter(r => inPd(pDate(r.pib_date)));
    }
    const _raHidden = _raTotalCount - rows.length;
    _raDetailRows = rows;
    _raLotRows = [];   // PIB path active — clear any stale lot-export rows

    if (!rows.length) {
      // Escape any data-derived text before it enters markup (note/vessel is
      // user-typed). Keeps the same render path as the rest of the modal.
      const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
      // ── Fallback: lot-based realization (entered by Ops via shipments) ──────
      // No PIB import rows, but realization may still exist on shipment lots
      // (realMT). Show that detail instead of an empty modal so PTs realized via
      // Operations input (e.g. the 19/06 batch) aren't shown as "no data".
      // Mirrors the drawer's "Realization — per Shipment / Lot". Display-only —
      // does NOT touch the PIB realizations table or any KPI.
      let lotRows = '', lotTotal = 0;
      _raLotRows = [];
      if (co && co.shipments && typeof co.shipments === 'object') {
        Object.entries(co.shipments).forEach(([product, lots]) => {
          (lots || []).forEach(l => {
            const rm = Number(l.realMT) || 0;
            if (rm <= 0) return;
            if (typeof PERIOD !== 'undefined' && PERIOD.active && !inPd(pDate(l.pibDate))) return;
            lotTotal += rm;
            const arrived = l.cargoArrived || l.arrived;
            const vessel  = (l.note && String(l.note).trim()) || (vesselHint !== '—' ? vesselHint : '—');
            _raLotRows.push({
              'Company':     headerName || code,
              'Code':        code,
              'Produk':      product,
              'Lot':         l.lotNo != null ? l.lotNo : '',
              'Realized MT': rm,
              'PIB Date':    l.pibDate || '',
              'Vessel/Note': (l.note && String(l.note).trim()) || '',
              'Status':      arrived ? 'Tiba JKT' : 'In-shipment',
              'Source':      'Operations (lot)',
            });
            lotRows += `<tr>
              <td style="padding:6px 10px;font-size:12px">${esc(product)}</td>
              <td style="padding:6px 10px;font-size:12px;text-align:center">${esc(l.lotNo != null ? l.lotNo : '-')}</td>
              <td style="padding:6px 10px;font-size:12px;text-align:right;font-family:'DM Mono',monospace;font-weight:700">${rm.toLocaleString()}</td>
              <td style="padding:6px 10px;font-size:12px;text-align:center">${esc(l.pibDate || '—')}</td>
              <td style="padding:6px 10px;font-size:12px;text-align:center">${esc(vessel)}</td>
              <td style="padding:6px 10px;font-size:11px;text-align:center">${arrived ? '<span style="color:var(--green);font-weight:700">✓ Tiba JKT</span>' : '<span style="color:var(--orange)">🚢 In-shipment</span>'}</td>
            </tr>`;
          });
        });
      }
      let content;
      if (lotRows) {
        _raDetailRows = [];   // PIB export has nothing; this is lot-sourced
        content = `
          <div style="background:#fff7ed;border:1px solid var(--orange-bd);border-radius:8px;padding:10px 14px;margin-bottom:12px;font-size:12px;color:var(--txt2)">
            ℹ️ Realisasi <strong>${esc(headerName)}</strong> dicatat via <strong>input Operations (per lot)</strong>, bukan import PIB. Detail customs PIB (HS code, nilai, kurs, pelabuhan) akan muncul di sini bila dokumen PIB diimport.
          </div>
          <div style="border:1px solid var(--border);border-radius:10px;overflow:hidden">
            <table style="width:100%;border-collapse:collapse">
              <thead><tr style="background:var(--bg2)">
                <th style="padding:8px 10px;font-size:10px;text-align:left;color:var(--txt3);text-transform:uppercase;letter-spacing:.5px">Produk</th>
                <th style="padding:8px 10px;font-size:10px;text-align:center;color:var(--txt3);text-transform:uppercase;letter-spacing:.5px">Lot</th>
                <th style="padding:8px 10px;font-size:10px;text-align:right;color:var(--txt3);text-transform:uppercase;letter-spacing:.5px">Realized MT</th>
                <th style="padding:8px 10px;font-size:10px;text-align:center;color:var(--txt3);text-transform:uppercase;letter-spacing:.5px">PIB Date</th>
                <th style="padding:8px 10px;font-size:10px;text-align:center;color:var(--txt3);text-transform:uppercase;letter-spacing:.5px">Vessel / Note</th>
                <th style="padding:8px 10px;font-size:10px;text-align:center;color:var(--txt3);text-transform:uppercase;letter-spacing:.5px">Status</th>
              </tr></thead>
              <tbody>${lotRows}</tbody>
              <tfoot><tr style="background:var(--teal-bg)">
                <td colspan="2" style="padding:8px 10px;font-size:12px;font-weight:700">Total Realized</td>
                <td style="padding:8px 10px;font-size:12px;text-align:right;font-family:'DM Mono',monospace;font-weight:700;color:var(--teal)">${lotTotal.toLocaleString()}</td>
                <td colspan="3"></td>
              </tr></tfoot>
            </table>
          </div>`;
      } else {
        const periodMsg = (_raHidden > 0)
          ? `Tidak ada PIB pada periode <strong>${esc(PERIOD.label)}</strong> untuk <strong>${esc(headerName)}</strong>.<br>
             <span style="font-size:11px">${_raHidden} PIB di luar periode disembunyikan — ubah atau clear filter periode untuk melihatnya.</span>`
          : `Belum ada data realisasi PIB untuk <strong>${esc(headerName)}</strong>.<br>
             <span style="font-size:11px">Import via menu Realization Import atau tambah manual.</span>`;
        content = `<div style="padding:40px;text-align:center;color:var(--txt3);font-size:13px">
          <div style="font-size:32px;margin-bottom:8px">📦</div>
          ${periodMsg}
        </div>`;
      }
      body.innerHTML = content;
      // Wire export so the lot-based realization (when present) is exportable too.
      const exportBtnLot = document.getElementById('raDetailExportBtn');
      if (exportBtnLot) exportBtnLot.onclick = () => exportRealizationDetail(code, headerName);
      return;
    }

    // Group rows by pib_no (one PIB = one arrival)
    const groups = {};
    rows.forEach(r => {
      const key = r.pib_no || `(no-pib-${r.id})`;
      if (!groups[key]) groups[key] = { pib_no: r.pib_no, pib_date: r.pib_date, items: [] };
      groups[key].items.push(r);
    });
    const groupList = Object.values(groups).sort((a, b) =>
      String(b.pib_date || '').localeCompare(String(a.pib_date || '')));

    // Aggregate stats across ALL PIBs
    const totalVol = rows.reduce((s, r) => s + (Number(r.volume)    || 0), 0);
    const totalVal = rows.reduce((s, r) => s + (Number(r.value_usd) || 0), 0);
    const _fmt = (n, d = 2) => n.toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: 0 });

    // ── Header summary strip ──────────────────────────────────────────
    const summaryHTML = `
      <div style="background:linear-gradient(135deg,#f0f7ff,#dbeafe);border:1px solid var(--blue-bd);border-radius:10px;padding:12px 16px;display:flex;align-items:center;gap:14px;flex-wrap:wrap">
        <div style="flex:1;min-width:160px">
          <div style="font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.9px;color:var(--txt3);margin-bottom:2px">Company</div>
          <div style="font-size:14px;font-weight:700;color:var(--txt);line-height:1.2">${headerName}</div>
          <div style="font-size:10px;color:var(--txt3);font-family:'DM Mono',monospace;margin-top:1px">${code}</div>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <div style="text-align:center;padding:6px 14px;background:#fff;border:1px solid var(--border);border-radius:8px;min-width:80px">
            <div style="font-size:18px;font-weight:700;color:var(--blue);line-height:1;font-family:'DM Mono',monospace">${groupList.length}</div>
            <div style="font-size:9.5px;color:var(--txt3);text-transform:uppercase;letter-spacing:.5px;margin-top:3px">PIB${groupList.length===1?'':'s'}</div>
          </div>
          <div style="text-align:center;padding:6px 14px;background:#fff;border:1px solid var(--border);border-radius:8px;min-width:80px">
            <div style="font-size:18px;font-weight:700;color:var(--navy);line-height:1;font-family:'DM Mono',monospace">${rows.length}</div>
            <div style="font-size:9.5px;color:var(--txt3);text-transform:uppercase;letter-spacing:.5px;margin-top:3px">Line Items</div>
          </div>
          <div style="text-align:center;padding:6px 14px;background:#fff;border:1px solid var(--border);border-radius:8px;min-width:110px">
            <div style="font-size:18px;font-weight:700;color:var(--teal);line-height:1;font-family:'DM Mono',monospace">${_fmt(totalVol, 2)}</div>
            <div style="font-size:9.5px;color:var(--txt3);text-transform:uppercase;letter-spacing:.5px;margin-top:3px">Total Volume <span style="font-weight:400">(TNE)</span></div>
          </div>
          <div style="text-align:center;padding:6px 14px;background:#fff;border:1px solid var(--border);border-radius:8px;min-width:130px">
            <div style="font-size:18px;font-weight:700;color:var(--green);line-height:1;font-family:'DM Mono',monospace">${_fmt(totalVal, 0)}</div>
            <div style="font-size:9.5px;color:var(--txt3);text-transform:uppercase;letter-spacing:.5px;margin-top:3px">Total Nilai <span style="font-weight:400">(USD)</span></div>
          </div>
        </div>
        ${groupList.length > 1 ? `
        <div style="display:flex;gap:5px;flex-shrink:0">
          <button onclick="setAllRaPibs(true)" type="button" title="Expand all PIBs"
            style="font-size:10px;font-weight:600;padding:5px 10px;border:1px solid var(--border2);background:#fff;color:var(--txt2);border-radius:6px;cursor:pointer">
            ⬇ Expand all
          </button>
          <button onclick="setAllRaPibs(false)" type="button" title="Collapse all PIBs"
            style="font-size:10px;font-weight:600;padding:5px 10px;border:1px solid var(--border2);background:#fff;color:var(--txt2);border-radius:6px;cursor:pointer">
            ⬆ Collapse all
          </button>
        </div>` : ''}
      </div>`;

    // ── One collapsible card per PIB (first expanded by default) ────
    const cardsHTML = groupList.map((g, gi) => {
      const sppb     = g.pib_no || '—';
      const arrived  = g.pib_date || '—';
      const vesselFromRow = (g.items[0] && (g.items[0].vessel || g.items[0].ship_name)) || '';
      const shipName = vesselFromRow || (vesselHint && vesselHint !== '—' ? vesselHint : '');
      const pibVol   = g.items.reduce((s, r) => s + (Number(r.volume)    || 0), 0);
      const pibVal   = g.items.reduce((s, r) => s + (Number(r.value_usd) || 0), 0);
      const isOpen   = gi === 0; // first PIB expanded; others collapsed
      const pid      = `raPib-${gi}`;

      return `
        <div style="border:1px solid var(--border);border-radius:10px;overflow:hidden;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.03)">
          <!-- Collapsible header row -->
          <button type="button" onclick="toggleRaPib('${pid}')"
            style="width:100%;padding:11px 16px;background:#f8fafc;border:none;border-bottom:1px solid var(--border);
                   display:flex;align-items:center;gap:14px;cursor:pointer;text-align:left;transition:background .14s"
            onmouseover="this.style.background='#eff4ff'"
            onmouseout="this.style.background='#f8fafc'">
            <span id="${pid}-chev" style="font-size:11px;color:var(--txt3);transition:transform .18s;transform:${isOpen?'rotate(90deg)':'rotate(0deg)'};display:inline-block">▶</span>
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;flex:1;min-width:0">
              <span style="font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:var(--txt3)">PIB</span>
              <span style="font-size:13px;font-weight:700;color:var(--blue);font-family:'DM Mono',monospace">${sppb}</span>
              <span style="font-size:11px;color:var(--txt3)">·</span>
              <span style="font-size:11px;color:var(--txt2)">Arrived <strong style="color:var(--txt);font-family:'DM Mono',monospace">${arrived}</strong></span>
              ${shipName ? `<span style="font-size:11px;color:var(--txt3)">·</span>
                <span style="font-size:11px;color:var(--txt2)">🚢 <strong style="color:var(--txt)">${shipName}</strong></span>` : ''}
            </div>
            <div style="display:flex;gap:6px;flex-shrink:0">
              <span style="font-size:10px;font-weight:700;padding:2px 8px;background:var(--blue-bg);color:var(--blue);border-radius:10px;font-family:'DM Mono',monospace">${g.items.length} line${g.items.length===1?'':'s'}</span>
              <span style="font-size:10px;font-weight:700;padding:2px 8px;background:var(--teal-bg);color:var(--teal);border-radius:10px;font-family:'DM Mono',monospace">${_fmt(pibVol,2)} MT</span>
              <span style="font-size:10px;font-weight:700;padding:2px 8px;background:var(--green-bg);color:var(--green);border-radius:10px;font-family:'DM Mono',monospace">\$${_fmt(pibVal,0)}</span>
            </div>
          </button>

          <!-- Collapsible body -->
          <!-- IMPORTANT: only overflow-x (for wide tables on small screens).
               overflow-y MUST stay visible — otherwise each PIB traps the
               scroll wheel and "Expand all" becomes unscrollable. Sticky
               table headers stick to the OUTER modal body scroll context. -->
          <div id="${pid}" style="display:${isOpen?'block':'none'}">
            ${!shipName ? `<div style="padding:8px 16px;background:#fffbeb;border-bottom:1px solid var(--amber-bd);font-size:10.5px;color:var(--amber);font-style:italic">
              ⚠ Nama kapal belum diisi — tambahkan via Sales/Ops "Vessel / Note" field
            </div>` : ''}
            <div class="ra-table-wrap" style="overflow-x:auto;overflow-y:hidden">
              <table style="width:100%;border-collapse:collapse;font-size:11px;min-width:1100px">
                <thead style="position:sticky;top:0;z-index:5">
                  <tr style="background:var(--navy);color:rgba(255,255,255,.85)">
                    <th style="padding:7px 8px;text-align:right;font-size:9px;font-weight:700;letter-spacing:.6px;white-space:nowrap;width:32px">NO</th>
                    <th style="padding:7px 8px;text-align:left;font-size:9px;font-weight:700;letter-spacing:.6px;min-width:240px">URAIAN BARANG</th>
                    <th style="padding:7px 8px;text-align:center;font-size:9px;font-weight:700;letter-spacing:.6px;white-space:nowrap" title="Pos Tarif / HS 10 Digit">HS CODE</th>
                    <th style="padding:7px 8px;text-align:right;font-size:9px;font-weight:700;letter-spacing:.6px;white-space:nowrap">VOLUME</th>
                    <th style="padding:7px 8px;text-align:center;font-size:9px;font-weight:700;letter-spacing:.6px;white-space:nowrap">SATUAN</th>
                    <th style="padding:7px 8px;text-align:right;font-size:9px;font-weight:700;letter-spacing:.6px;white-space:nowrap">NILAI</th>
                    <th style="padding:7px 8px;text-align:right;font-size:9px;font-weight:700;letter-spacing:.6px;white-space:nowrap">HRG. SATUAN</th>
                    <th style="padding:7px 8px;text-align:right;font-size:9px;font-weight:700;letter-spacing:.6px;white-space:nowrap">KURS</th>
                    <th style="padding:7px 8px;text-align:center;font-size:9px;font-weight:700;letter-spacing:.6px;white-space:nowrap">NEG. ASAL</th>
                    <th style="padding:7px 8px;text-align:center;font-size:9px;font-weight:700;letter-spacing:.6px;white-space:nowrap">PEL. TUJUAN</th>
                    <th style="padding:7px 8px;text-align:left;font-size:9px;font-weight:700;letter-spacing:.6px;white-space:nowrap">NO. L/S</th>
                    <th style="padding:7px 8px;text-align:left;font-size:9px;font-weight:700;letter-spacing:.6px;white-space:nowrap">TGL L/S</th>
                    <th style="padding:7px 8px;text-align:left;font-size:9px;font-weight:700;letter-spacing:.6px;white-space:nowrap">NO. INVOICE</th>
                    <th style="padding:7px 8px;text-align:left;font-size:9px;font-weight:700;letter-spacing:.6px;white-space:nowrap">TGL INVOICE</th>
                    <th style="padding:7px 8px;text-align:left;font-size:9px;font-weight:700;letter-spacing:.6px;white-space:nowrap">NO. PENGAJUAN</th>
                  </tr>
                </thead>
                <tbody>
                  ${g.items.map((r, idx) => {
                    const vol  = r.volume     != null ? Number(r.volume).toLocaleString(undefined,{maximumFractionDigits:3}) : '—';
                    const val  = r.value_usd  != null ? Number(r.value_usd).toLocaleString(undefined,{maximumFractionDigits:2}) : '—';
                    const up   = r.unit_price != null ? Number(r.unit_price).toLocaleString(undefined,{maximumFractionDigits:2}) : '—';
                    const kurs = r.kurs       != null ? Number(r.kurs).toLocaleString() : '—';
                    const desc = (r.description || '—').replace(/\n/g, ' · ');
                    const descShort = desc.length > 70 ? desc.slice(0, 70) + '…' : desc;
                    const escDesc = String(desc).replace(/"/g, '&quot;');
                    const rowBg = idx % 2 === 0 ? '#fff' : '#f9fafb';
                    return `<tr style="background:${rowBg};border-bottom:1px solid var(--border);transition:background .12s"
                      onmouseover="this.style.background='#eff4ff'"
                      onmouseout="this.style.background='${rowBg}'">
                      <td style="padding:6px 8px;font-family:'DM Mono',monospace;color:var(--txt3);text-align:right">${r.line_no || (idx+1)}</td>
                      <td style="padding:6px 8px;font-weight:600;color:var(--txt);line-height:1.4;max-width:340px" title="${escDesc}">${descShort}</td>
                      <td style="padding:6px 8px;text-align:center"><span style="display:inline-block;font-family:'DM Mono',monospace;font-size:10.5px;font-weight:600;background:var(--blue-bg);color:var(--blue);border:1px solid var(--blue-bd);padding:1px 7px;border-radius:4px;letter-spacing:.2px">${r.hs_code || '—'}</span></td>
                      <td style="padding:6px 8px;font-family:'DM Mono',monospace;font-weight:700;color:var(--blue);text-align:right;white-space:nowrap">${vol}</td>
                      <td style="padding:6px 8px;color:var(--txt3);text-align:center;font-size:10px">${r.unit || 'TNE'}</td>
                      <td style="padding:6px 8px;font-family:'DM Mono',monospace;text-align:right;color:var(--txt2);white-space:nowrap">${val}</td>
                      <td style="padding:6px 8px;font-family:'DM Mono',monospace;text-align:right;color:var(--txt2);white-space:nowrap">${up}</td>
                      <td style="padding:6px 8px;font-family:'DM Mono',monospace;text-align:right;color:var(--txt3);white-space:nowrap">${kurs}</td>
                      <td style="padding:6px 8px;color:var(--txt2);text-align:center">${r.country_origin || '—'}</td>
                      <td style="padding:6px 8px;color:var(--txt2);text-align:center">${r.port_destination || '—'}</td>
                      <td style="padding:6px 8px;font-family:'DM Mono',monospace;color:var(--txt2);font-size:10px;white-space:nowrap">${r.ls_no || '—'}</td>
                      <td style="padding:6px 8px;font-family:'DM Mono',monospace;color:var(--txt3);font-size:10px;white-space:nowrap">${r.ls_date || '—'}</td>
                      <td style="padding:6px 8px;font-family:'DM Mono',monospace;color:var(--txt2);font-size:10px;white-space:nowrap">${r.invoice_no || '—'}</td>
                      <td style="padding:6px 8px;font-family:'DM Mono',monospace;color:var(--txt3);font-size:10px;white-space:nowrap">${r.invoice_date || '—'}</td>
                      <td style="padding:6px 8px;font-family:'DM Mono',monospace;color:var(--txt2);font-size:10px;white-space:nowrap">${r.pengajuan_no || '—'}</td>
                    </tr>`;
                  }).join('')}
                </tbody>
                <tfoot>
                  <tr style="background:#f1f5f9;border-top:2px solid var(--border);font-weight:700">
                    <td colspan="3" style="padding:7px 8px;text-align:right;color:var(--txt2);font-size:10px;text-transform:uppercase;letter-spacing:.6px">PIB Subtotal</td>
                    <td style="padding:7px 8px;text-align:right;font-family:'DM Mono',monospace;color:var(--blue);white-space:nowrap">${_fmt(pibVol, 2)}</td>
                    <td style="padding:7px 8px;text-align:center;color:var(--txt3);font-size:10px">TNE</td>
                    <td style="padding:7px 8px;text-align:right;font-family:'DM Mono',monospace;color:var(--green);white-space:nowrap">${_fmt(pibVal, 2)}</td>
                    <td colspan="9"></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>`;
    }).join('');

    // Final assembly:
    //   Modal body itself is the scroll container (overflow-y:auto).
    //   Summary strip is position:sticky at top so it always shows.
    //   PIB cards flow normally below — natural document scroll.
    // This is the simplest model and avoids nested-scroll trap issues
    // entirely. Browser handles all wheel/touch/keyboard scroll natively.
    // Period-scope banner — only when a filter is active (and trimmed rows)
    const periodBanner = (typeof PERIOD !== 'undefined' && PERIOD.active)
      ? `<div style="margin:0 0 8px;padding:6px 12px;background:var(--amber-bg);border:1px solid var(--amber-bd);
                     border-radius:8px;font-size:11px;color:var(--txt2);display:flex;align-items:center;gap:6px">
           <span>📅</span><span>Difilter periode <strong>${PERIOD.label}</strong> (by PIB date)${_raHidden > 0 ? ` · ${_raHidden} PIB di luar periode disembunyikan` : ''}</span>
         </div>`
      : '';
    body.innerHTML = `
      <div style="position:sticky;top:0;background:var(--bg);z-index:30;
                  padding:18px 0 10px;margin-bottom:4px">
        ${periodBanner}
        ${summaryHTML}
      </div>
      <div style="display:flex;flex-direction:column;gap:12px">
        ${cardsHTML}
      </div>`;

    // Wire export button (replace handler each open to capture latest rows)
    const exportBtn = document.getElementById('raDetailExportBtn');
    if (exportBtn) {
      exportBtn.onclick = () => exportRealizationDetail(code, headerName);
    }
    // Reset scroll position so each open starts at the summary strip
    body.scrollTop = 0;

    // ── Wheel forwarding ──────────────────────────────────────────────
    // Inner table wrappers have overflow-x:auto (for wide tables) — some
    // browsers still capture vertical wheel even with overflow-y:hidden.
    // Forward vertical wheels to the modal body (#raDetailBody) so the
    // user gets one continuous scroll across all PIBs.
    const pibScroll = document.getElementById('raDetailBody');
    if (pibScroll) {
      document.querySelectorAll('.ra-table-wrap').forEach(wrap => {
        wrap.addEventListener('wheel', e => {
          if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
            pibScroll.scrollTop += e.deltaY;
            e.preventDefault();
          }
        }, { passive: false });
      });
    }
  } catch (err) {
    body.innerHTML = `<div style="padding:40px;text-align:center;color:var(--red2);font-size:12px">
      ⚠ Gagal memuat data realisasi: ${err.message}<br>
      <button onclick="openRealizationDetail('${code}')" style="margin-top:10px;padding:5px 12px;border:1px solid var(--red-bd);background:var(--red-bg);color:var(--red2);border-radius:5px;cursor:pointer">Coba lagi</button>
    </div>`;
  }
}

/* Toggle a single PIB card open/closed (used by the chevron buttons) */
function toggleRaPib(pid) {
  const body = document.getElementById(pid);
  const chev = document.getElementById(pid + '-chev');
  if (!body) return;
  const isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : 'block';
  if (chev) chev.style.transform = isOpen ? 'rotate(0deg)' : 'rotate(90deg)';
}

/* Expand or collapse ALL PIB cards in the modal at once */
function setAllRaPibs(open) {
  document.querySelectorAll('[id^="raPib-"]').forEach(el => {
    if (el.id.endsWith('-chev')) {
      el.style.transform = open ? 'rotate(90deg)' : 'rotate(0deg)';
    } else {
      el.style.display = open ? 'block' : 'none';
    }
  });
}

function closeRealizationDetail() {
  const m = document.getElementById('raDetailModal');
  if (m) m.style.display = 'none';
  _raDetailRows = [];
  _raLotRows = [];
}

/* Export current realization rows to XLSX. Uses SheetJS already loaded
   in index.html (CDN). Falls back to CSV blob if XLSX is unavailable. */
async function exportRealizationDetail(code, companyName) {
  // Lot-based realization fallback: when there are no PIB rows but the modal is
  // showing Operations/lot realization, export those instead (same data shown).
  if (!_raDetailRows.length) {
    if (!_raLotRows.length) return;
    try { await ensureXLSX(); } catch (e) { /* falls back to CSV below */ }
    // Same 20-column schema as the PIB export so both files are structurally
    // identical. Lot realization has no customs detail (HS/value/kurs/ports/
    // L-S/invoice/pengajuan) → those columns stay blank; what we have maps in.
    const lotRows = _raLotRows.map(r => ({
      'Company':           r.Company || code,
      'PIB / SPPB':        '',
      'PIB Date':          r['PIB Date'] || '',
      'Line No':           r.Lot != null ? r.Lot : '',
      'Uraian Barang':     [r.Produk, r['Vessel/Note'], r.Status].filter(Boolean).join(' · '),
      'HS Code':           '',
      'Volume':            r['Realized MT'] != null ? Number(r['Realized MT']) : '',
      'Satuan':            'TNE',
      'Nilai':             '',
      'Harga Satuan':      '',
      'Kurs':              '',
      'Negara Asal':       '',
      'Pelabuhan Tujuan':  '',
      'Pelabuhan Muat':    '',
      'No. L/S':           '',
      'Tgl L/S':           '',
      'No. Invoice':       '',
      'Tgl Invoice':       '',
      'No. Pengajuan':     '',
      'Tgl Pengajuan':     '',
    }));
    const fnameLot = `Realization_${code}_${new Date().toISOString().slice(0,10)}.xlsx`;
    if (typeof XLSX !== 'undefined') {
      const ws = XLSX.utils.json_to_sheet(lotRows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Realization');
      XLSX.writeFile(wb, fnameLot);
    } else {
      const headers = Object.keys(lotRows[0]);
      const csv = [headers.join(',')]
        .concat(lotRows.map(r => headers.map(h => {
          const v = r[h]; const s = v == null ? '' : String(v);
          return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
        }).join(',')))
        .join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = fnameLot.replace('.xlsx', '.csv'); a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    return;
  }
  try { await ensureXLSX(); } catch (e) { /* falls back to CSV below */ }
  const rows = _raDetailRows.map(r => ({
    'Company':           companyName || code,
    'PIB / SPPB':        r.pib_no || '',
    'PIB Date':          r.pib_date || '',
    'Line No':           r.line_no || '',
    'Uraian Barang':     r.description || '',
    'HS Code':           r.hs_code || '',
    'Volume':            r.volume != null ? Number(r.volume) : '',
    'Satuan':            r.unit || '',
    'Nilai':             r.value_usd != null ? Number(r.value_usd) : '',
    'Harga Satuan':      r.unit_price != null ? Number(r.unit_price) : '',
    'Kurs':              r.kurs != null ? Number(r.kurs) : '',
    'Negara Asal':       r.country_origin || '',
    'Pelabuhan Tujuan':  r.port_destination || '',
    'Pelabuhan Muat':    r.port_loading || '',
    'No. L/S':           r.ls_no || '',
    'Tgl L/S':           r.ls_date || '',
    'No. Invoice':       r.invoice_no || '',
    'Tgl Invoice':       r.invoice_date || '',
    'No. Pengajuan':     r.pengajuan_no || '',
    'Tgl Pengajuan':     r.pengajuan_date || '',
  }));
  const fname = `Realization_${code}_${new Date().toISOString().slice(0,10)}.xlsx`;
  if (typeof XLSX !== 'undefined') {
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Realization');
    XLSX.writeFile(wb, fname);
  } else {
    // CSV fallback
    const headers = Object.keys(rows[0]);
    const csv = [headers.join(',')]
      .concat(rows.map(r => headers.map(h => {
        const v = r[h]; const s = v == null ? '' : String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
      }).join(',')))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = fname.replace('.xlsx', '.csv'); a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

// Close on Esc (only when modal is visible, before drawer's Esc handler)
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  const m = document.getElementById('raDetailModal');
  if (m && m.style.display === 'block') {
    closeRealizationDetail();
    e.stopImmediatePropagation();
  }
}, true);