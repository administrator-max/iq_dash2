/* ═══════════════════════════════════════
   SPI PAGE — Rev List, Pending Quick,
   Rev Detail Table, SPI Table render
═══════════════════════════════════════ */

/* ══════════════════════════════════════════════════
   TABLE / LIST BUILDERS
══════════════════════════════════════════════════ */

/* Overview: revision list */
function buildRevList() {
  const el = document.getElementById('revList'); if(!el) return; el.innerHTML = '';
  // Under Revision now covers both active (revision) and reapply (Submit #2)
  const sections = [
    { rs: ['active','reapply'], label: '🔄 Under Revision', color: 'var(--amber)', bg: 'var(--amber-bg)', bd: 'var(--amber-bd)', badge: 'b-rev' },
    { rs: ['revpending'],       label: '⏳ Pending — PERTEK Terbit', color: 'var(--orange)', bg: 'var(--orange-bg)', bd: 'var(--orange-bd)', badge: 'b-revpending' },
  ];

  sections.forEach(sec => {
    const cos = filteredSPI().filter(d => d.revType !== 'none' && sec.rs.includes(revisionStatus(d)))
      .sort((a, b) => a.code.localeCompare(b.code));
    if (!cos.length) return;

    // Section label
    const hdr = document.createElement('div');
    hdr.style.cssText = `padding:5px 16px;background:${sec.bg};border-bottom:1px solid ${sec.bd};font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:${sec.color}`;
    hdr.textContent = `${sec.label}  ·  ${cos.length} co.`;
    el.appendChild(hdr);

    cos.forEach(co => {
      const chgHtml = co.revFrom.length
        ? co.revFrom.map((f,i) => {
            const t = co.revTo[i]||{};
            return `<span style="font-size:10px;font-weight:600;padding:1px 6px;background:var(--bg);border:1px solid var(--border);border-radius:3px">${f.prod}</span>
                    <span style="color:var(--txt3);font-size:13px;margin:0 3px">→</span>
                    <span style="font-size:10px;font-weight:700;padding:1px 6px;background:var(--green-bg);color:var(--green);border:1px solid var(--green-bd);border-radius:3px">${t.prod||'?'}</span>`;
          }).join('<br>')
        : '<span style="font-size:10.5px;color:var(--txt3)">See details</span>';
      const div = document.createElement('div');
      div.style.cssText = `padding:10px 16px;border-bottom:1px solid var(--border);cursor:pointer;transition:background .13s,border-left .13s;border-left:3px solid transparent`;
      div.onmouseover = () => { div.style.background='var(--blue-bg)'; div.style.borderLeft=`3px solid ${sec.color}`; };
      div.onmouseout  = () => { div.style.background=''; div.style.borderLeft='3px solid transparent'; };
      // Sales Revision Request mini-summary for sidebar
      const salesReq   = co.salesRevRequest || {};
      const reqEntries = Object.entries(salesReq).filter(([,v]) => v && v.requested);
      let salesReqMini = '';
      if (reqEntries.length > 0) {
        const confCount = reqEntries.filter(([,v]) => v.status === 'confirmed').length;
        const waitCount = reqEntries.filter(([,v]) => !v.status || v.status === 'pending').length;
        const ico = confCount === reqEntries.length ? '✅' : waitCount > 0 ? '⏳' : '✕';
        const col = confCount === reqEntries.length ? 'var(--green)' : waitCount > 0 ? 'var(--amber)' : 'var(--red2)';
        salesReqMini = `<div style="margin-top:4px;font-size:9.5px;color:${col};font-weight:600">
          ${ico} Rev Request: ${reqEntries.map(([p,v]) => {
            const newP = v.newProduct ? ` → ${v.newProduct}` : '';
            const mt   = v.confirmedMT != null ? v.confirmedMT.toLocaleString() : v.requestedMT != null ? v.requestedMT.toLocaleString() : '?';
            return `${p}${newP} (${mt} MT)`;
          }).join(' · ')}
        </div>`;
      }
      const _rs2 = revisionStatus(co);
      const _typeTag = _rs2 === 'reapply'
        ? `<span style="font-size:9px;font-weight:700;padding:1px 6px;border-radius:3px;background:var(--blue-bg);color:var(--blue);border:1px solid var(--blue-bd);margin-left:4px">Re-Apply</span>`
        : `<span style="font-size:9px;font-weight:700;padding:1px 6px;border-radius:3px;background:var(--amber-bg);color:var(--amber);border:1px solid var(--amber-bd);margin-left:4px">Revision</span>`;
      div.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
          <span style="font-size:13px;font-weight:700;color:var(--blue)">${co.code}${_typeTag} <span style="font-size:10px;color:var(--txt3);font-weight:400">↗ click for detail</span></span>
          <span class="badge ${sec.badge}">${sec.label.replace(/\s+·.*/,'')}</span>
        </div>
        <div style="font-size:10.5px;margin-top:3px;color:${sec.color}">${co.revStatus}</div>
        <div style="margin-top:4px">${buildRevNoteHtml(co)}</div>
        ${salesReqMini}`;
      div.onclick = () => openDrawer(co.code);
      el.appendChild(div);
    });
  });
}

/* Overview: pending quick list */
function buildPendingQuick() {
  const el = document.getElementById('pendingQuick');
  if(!el) return; el.innerHTML = '';
  const today = new Date();
  today.setHours(0,0,0,0);
  const pending = filteredPending();

  /* ── helpers ── */
  const daysSince = dateStr => {
    const d = pDate(dateStr);
    if (!d) return null;
    return Math.floor((today - d) / 86400000);
  };
  const daysChip = days => {
    if (days === null) return '';
    const cls = days >= 90 ? 'urgent' : days >= 45 ? 'warn' : 'ok';
    const label = days === 0 ? 'Today' : days === 1 ? '1 day ago' : `${days} days`;
    return `<span class="pq-days-chip ${cls}">⏱ ${label}</span>`;
  };
  const fmtDate = dateStr => {
    const d = pDate(dateStr);
    if (!d) return dateStr || '—';
    return d.toLocaleDateString('id-ID',{day:'2-digit',month:'short',year:'numeric'});
  };

  /* ── totals for footer ── */
  const totalMT  = pending.reduce((s,p) => s + (p.mt||0), 0);
  const maxDays  = pending.reduce((mx,p) => {
    const sc = (p.cycles||[]).find(cy => /submit/i.test(cy.type) && !/obtained/i.test(cy.type));
    const ds = sc ? daysSince(sc.submitDate) : null;
    return ds !== null ? Math.max(mx, ds) : mx;
  }, 0);

  /* ══ Build each company accordion ══ */
  pending.forEach(p => {
    const submitCycles = (p.cycles||[]).filter(cy =>
      /submit/i.test(cy.type) && !/obtained/i.test(cy.type)
    );

    // ── Company header ──────────────────────────────────────────
    const wrap = document.createElement('div');
    wrap.className = 'pq-wrap';

    const coRow = document.createElement('div');
    coRow.className = 'pq-co';

    const prodPills = p.products.map(pr => {
      const dot = prodDot(pr);
      return `<span style="display:inline-flex;align-items:center;gap:4px;font-size:10px;
                font-weight:700;padding:1px 7px;border-radius:10px;
                background:${dot}18;color:${dot};border:1px solid ${dot}40">
        <span style="width:5px;height:5px;border-radius:50%;background:${dot};display:inline-block;flex-shrink:0"></span>
        ${pr}
      </span>`;
    }).join('');

    // Days since first submit (use first submit cycle)
    const firstSub = submitCycles[0];
    const codays = firstSub ? daysSince(firstSub.submitDate) : null;

    coRow.innerHTML = `
      <div style="flex-shrink:0;min-width:42px">
        <div style="font-size:13px;font-weight:800;color:var(--red2);letter-spacing:.3px">${p.code}</div>
        <div style="font-size:9.5px;font-weight:600;color:var(--txt3);margin-top:1px">Grp ${p.group}</div>
      </div>
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;margin-bottom:3px">${prodPills}</div>
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          <span style="font-size:11px;font-weight:700;font-family:'DM Mono',monospace;color:var(--txt)">
            ${(p.mt||0).toLocaleString()} MT total
          </span>
          <span class="badge b-pending" style="font-size:9.5px;padding:1px 6px">⏳ Pending</span>
          ${codays !== null ? daysChip(codays) : ''}
        </div>
      </div>
      <span class="pq-co-arrow">▶</span>`;

    // ── Submission + Product sub-panel ─────────────────────────
    const subsPanel = document.createElement('div');
    subsPanel.className = 'pq-subs';

    submitCycles.forEach((cy, si) => {
      const subDate  = fmtDate(cy.submitDate);
      const ds       = daysSince(cy.submitDate);
      const cyMT     = typeof cy.mt === 'number' ? cy.mt : p.mt;
      const prods    = cy.products && Object.keys(cy.products).length
                       ? cy.products
                       : p.products.reduce((o,pr) => { o[pr] = cyMT; return o; }, {});
      const totalProdMT = Object.values(prods).reduce((s,v) => s + (typeof v==='number'?v:0), 0) || cyMT;

      // Status line — strip "Update DD/MM/YY - " prefix for readability
      const rawStatus = cy.status || p.status || '';
      const cleanStatus = rawStatus.replace(/^Update\s+\d{2}\/\d{2}\/\d{2,4}\s*[-–]\s*/i,'');

      const subRow = document.createElement('div');
      subRow.className = 'pq-sub';

      subRow.innerHTML = `
        <div class="pq-sub-line"></div>
        <div class="pq-sub-dot"></div>
        <div class="pq-sub-body">
          <div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap">
            <span class="pq-sub-title">${cy.type}</span>
            <span style="font-size:10px;font-weight:700;font-family:'DM Mono',monospace;
                         color:var(--txt3)">${totalProdMT.toLocaleString()} MT</span>
            ${ds !== null ? daysChip(ds) : ''}
          </div>
          <div class="pq-sub-meta">
            <span>📅 Submit: <strong>${subDate}</strong></span>
            <span style="color:var(--border)">|</span>
            <span>Release: <strong>${cy.releaseDate && cy.releaseDate!=='TBA' ? fmtDate(cy.releaseDate) : '⏳ TBA'}</strong></span>
          </div>
          ${cleanStatus ? `<div style="font-size:10.5px;color:var(--red2);margin-top:3px;
            font-style:italic;line-height:1.4">⚠ ${cleanStatus}</div>` : ''}
        </div>
        <span class="pq-sub-arrow">▶</span>`;

      // ── Product rows ────────────────────────────────────────
      const prodsPanel = document.createElement('div');
      prodsPanel.className = 'pq-prods';

      const prodEntries = Object.entries(prods).filter(([,v]) => typeof v==='number' && v>0);
      prodEntries.forEach(([prodName, prodMT]) => {
        const dot = prodDot(prodName);
        const pct = totalProdMT > 0 ? (prodMT/totalProdMT*100).toFixed(0) : '—';
        const row = document.createElement('div');
        row.className = 'pq-prod';
        row.innerHTML = `
          <div class="pq-prod-dot" style="background:${dot}"></div>
          <span class="pq-prod-name">${prodName}</span>
          <span class="pq-prod-mt">${prodMT.toLocaleString()} MT</span>
          <span class="pq-prod-pct">${pct}%</span>`;
        prodsPanel.appendChild(row);
      });

      // toggle: click submission row → expand/collapse products
      subRow.addEventListener('click', e => {
        e.stopPropagation();
        const isOpen = subRow.classList.contains('open');
        // collapse all siblings first
        subsPanel.querySelectorAll('.pq-sub').forEach(r => r.classList.remove('open'));
        subsPanel.querySelectorAll('.pq-prods').forEach(r => r.classList.remove('open'));
        if (!isOpen) {
          subRow.classList.add('open');
          prodsPanel.classList.add('open');
        }
      });

      subsPanel.appendChild(subRow);
      subsPanel.appendChild(prodsPanel);
    });

    // also add "open in detail" row at bottom of submission panel
    const detailLink = document.createElement('div');
    detailLink.style.cssText = `padding:7px 16px 7px 28px;font-size:10.5px;color:var(--blue);
      font-weight:600;cursor:pointer;display:flex;align-items:center;gap:5px;
      background:var(--blue-bg);border-top:1px solid var(--blue-bd);
      transition:background .12s`;
    detailLink.innerHTML = '↗ Open full company detail';
    detailLink.onmouseover = () => detailLink.style.background = '#dbeafe';
    detailLink.onmouseout  = () => detailLink.style.background = 'var(--blue-bg)';
    detailLink.onclick = e => { e.stopPropagation(); openDrawerPending(p.code); };
    subsPanel.appendChild(detailLink);

    // toggle: click company row → expand/collapse submissions
    coRow.addEventListener('click', () => {
      const isOpen = coRow.classList.contains('open');
      // collapse all company rows first
      el.querySelectorAll('.pq-co').forEach(r => r.classList.remove('open'));
      el.querySelectorAll('.pq-subs').forEach(r => r.classList.remove('open'));
      if (!isOpen) {
        coRow.classList.add('open');
        subsPanel.classList.add('open');
      }
    });

    wrap.appendChild(coRow);
    wrap.appendChild(subsPanel);
    el.appendChild(wrap);
  });

  /* ── Footer summary bar ── */
  if (pending.length) {
    const footer = document.createElement('div');
    footer.className = 'pq-footer';
    footer.innerHTML = `
      <span class="pq-footer-lbl">Total pending:</span>
      <span class="pq-footer-val">${totalMT.toLocaleString()} MT</span>
      <span class="pq-footer-lbl" style="margin-left:6px">·</span>
      <span class="pq-footer-lbl">${pending.length} compan${pending.length===1?'y':'ies'}</span>
      <span style="margin-left:auto;font-size:10px;color:var(--txt3)">Longest wait: </span>
      <span class="pq-days-chip ${maxDays>=90?'urgent':maxDays>=45?'warn':'ok'}" style="font-size:10px">
        ⏱ ${maxDays} days
      </span>`;
    el.appendChild(footer);
  }
}

/* buildRevNoteHtml: renders revision note with split reallocation support + Sales Rev Request */
function buildRevNoteHtml(d) {
  // Show Sales Revision Request badge if any pending/confirmed requests exist
  const salesReq = d.salesRevRequest || {};
  const reqEntries = Object.entries(salesReq).filter(([,v]) => v && v.requested);
  let salesReqHtml = '';
  if (reqEntries.length > 0) {
    const confCount = reqEntries.filter(([,v]) => v.status === 'confirmed').length;
    const batalCount = reqEntries.filter(([,v]) => v.status === 'rejected').length;
    const waitCount  = reqEntries.length - confCount - batalCount;
    const parts = [];
    if (confCount)  parts.push(`<span style="font-size:9.5px;font-weight:700;padding:1px 6px;border-radius:3px;background:var(--green-bg);color:var(--green);border:1px solid var(--green-bd)">✅ ${confCount} dikonfirmasi</span>`);
    if (waitCount)  parts.push(`<span style="font-size:9.5px;font-weight:700;padding:1px 6px;border-radius:3px;background:var(--amber-bg);color:var(--amber);border:1px solid var(--amber-bd)">⏳ ${waitCount} menunggu</span>`);
    if (batalCount) parts.push(`<span style="font-size:9.5px;font-weight:700;padding:1px 6px;border-radius:3px;background:var(--red-bg);color:var(--red2);border:1px solid var(--red-bd)">✕ ${batalCount} dibatalkan</span>`);
    const prodList = reqEntries.map(([prod, v]) => {
      const targets = v.targetProducts && v.targetProducts.length
                    ? v.targetProducts
                    : (v.newProduct ? [{ product: v.newProduct, mt: v.requestedMT }] : []);
      const tDisp = targets.length > 1
        ? targets.map(t => `${t.product||'—'}${t.mt!=null?' ('+Number(t.mt).toLocaleString()+' MT)':''}`).join(' + ')
        : targets.length === 1 && targets[0].product
          ? ` → ${targets[0].product}${targets[0].mt!=null?' ('+Number(targets[0].mt).toLocaleString()+' MT)':''}`
          : '';
      const confMT = v.confirmedMT != null ? v.confirmedMT.toLocaleString() : null;
      return `<span style="font-size:9.5px;color:var(--txt3)">${prod}${tDisp}${confMT?' [conf: '+confMT+' MT]':''}</span>`;
    }).join(' · ');
    salesReqHtml = `<div style="margin-top:4px;display:flex;flex-wrap:wrap;gap:3px;align-items:center">
      <span style="font-size:9.5px;font-weight:700;color:var(--txt3)">📋 Rev Request:</span>
      ${parts.join('')}
      <div style="width:100%;font-size:9.5px;color:var(--txt3);margin-top:2px">${prodList}</div>
    </div>`;
  }

  if (!d.revFrom || !d.revFrom.length) return (d.revNote || '—') + salesReqHtml;
  const isSplit = d.revFrom.length === 1 && d.revTo.length > 1;
  if (!isSplit) return (d.revNote || '—') + salesReqHtml;
  // Split: show structured breakdown
  const f = d.revFrom[0];
  const toLines = d.revTo.map(t => {
    const isRet = t.label === 'Retained';
    return `<div style="display:flex;align-items:center;gap:4px;margin-top:3px">
      <span style="color:var(--txt3);font-size:11px">→</span>
      <span style="font-size:10px;font-weight:700;padding:1px 6px;border-radius:3px;
        background:${isRet?'var(--blue-bg)':'var(--green-bg)'};
        color:${isRet?'var(--blue)':'var(--green)'};
        border:1px solid ${isRet?'var(--blue-bd)':'var(--green-bd)'}">
        ${t.label}: ${t.prod}
      </span>
      <span style="font-size:10px;font-family:'DM Mono',monospace;color:var(--txt3)">${t.mt.toLocaleString()} MT</span>
    </div>`;
  }).join('');
  return `<div>
    <div style="display:flex;align-items:center;gap:5px;margin-bottom:2px">
      <span style="font-size:9.5px;font-weight:700;padding:1px 5px;border-radius:3px;background:var(--orange-bg);color:var(--orange);border:1px solid var(--orange-bd)">SPLIT</span>
      <span style="font-size:10.5px;font-weight:600">${f.label}: ${f.prod} ${f.mt.toLocaleString()} MT</span>
    </div>
    ${toLines}
    ${salesReqHtml}
  </div>`;
}

/* SPI: revision detail table */
function getObtainedProdBreakdown(co) {
  // Returns HTML showing per-product obtained MT for multi-product companies.
  // Source: Obtained #1 cycle's products object.
  const obt1 = (co.cycles||[]).find(c => /^obtained\s*#1$/i.test(c.type));
  const prodMap = obt1 && obt1.products ? obt1.products : null;
  if (!prodMap || co.products.length <= 1) return null; // single product — no breakdown needed
  const entries = Object.entries(prodMap).filter(([,mt]) => (mt||0) > 0);
  if (!entries.length) return null;
  return entries.map(([prod, mt]) =>
    `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:2px 0;border-bottom:1px dashed var(--border)">
       <span style="display:inline-flex;align-items:center;gap:4px;font-size:9.5px;font-weight:700;padding:1px 6px;border-radius:3px;background:${pc(prod).light};color:${pc(prod).text}">${prod}</span>
       <span style="font-size:11px;font-family:'DM Mono',monospace;font-weight:600;color:var(--txt2)">${Number(mt).toLocaleString()} MT</span>
     </div>`
  ).join('');
}

function buildRevChgHtml(co) {
  if (!co.revFrom.length) return '—';
  const isSplit = co.revFrom.length === 1 && co.revTo.length > 1;
  if (isSplit) {
    const f = co.revFrom[0];
    const toRows = co.revTo.map(t => {
      const isRetained = t.label === 'Retained';
      return `<div style="display:flex;align-items:center;gap:4px;padding:2px 0">
        <span style="font-size:10.5px;color:var(--txt3);width:14px">→</span>
        <span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:3px;
          background:${isRetained?'var(--blue-bg)':'var(--green-bg)'};
          color:${isRetained?'var(--blue)':'var(--green)'};
          border:1px solid ${isRetained?'var(--blue-bd)':'var(--green-bd)'}">
          ${t.label}: ${t.prod}</span>
        <span style="font-size:10px;font-family:'DM Mono',monospace;color:var(--txt3)">${t.mt.toLocaleString()} MT</span>
      </div>`;
    }).join('');
    return `<div style="display:flex;align-items:center;gap:4px;padding:2px 0 4px">
        <span class="chg-from-lbl">${f.label}: ${f.prod}</span>
        <span class="chg-mt">${f.mt.toLocaleString()} MT</span>
        <span style="font-size:9.5px;color:var(--orange);font-weight:700;padding:1px 5px;background:var(--orange-bg);border:1px solid var(--orange-bd);border-radius:3px">SPLIT</span>
      </div>${toRows}`;
  }
  return co.revFrom.map((f,i) => {
    const t = co.revTo[i]||{};
    return `<div class="chg-row">
      <span class="chg-from-lbl">${f.label||'Before'}: ${f.prod}</span>
      <span class="chg-arrow">→</span>
      <span class="chg-to-lbl">${t.label||'After'}: ${t.prod||'?'}</span>
      <span class="chg-mt">${f.mt.toLocaleString()} MT</span>
    </div>`;
  }).join('');
}

function buildRevDetailTable() {
  const tbody = document.getElementById('revDetailBody');
  tbody.innerHTML = '';

  // Separate into Revision (product/tonnage change) vs Re-Apply (Submit #2 additional quota)
  const allNonClean = filteredSPI().filter(d => d.revType !== 'none');
  const revGroups = [
    { key: 'underrev', label: '🔄 Under Revision',
      bg: 'var(--amber-bg)', bd: 'var(--amber-bd)', tc: 'var(--amber)',
      cos: allNonClean.filter(co => revisionStatus(co) === 'active' || revisionStatus(co) === 'reapply') },
    { key: 'pending',  label: '⏳ Pending — PERTEK Terbit, Awaiting SPI',
      bg: 'var(--orange-bg)',bd: 'var(--orange-bd)',tc: 'var(--orange)',
      cos: allNonClean.filter(co => revisionStatus(co) === 'revpending') },
    { key: 'done',     label: '✅ Completed — SPI / PERTEK Terbit',
      bg: 'var(--violet-bg)',bd: 'var(--violet-bd)',tc: 'var(--violet)',
      cos: allNonClean.filter(co => revisionStatus(co) === 'completed') },
  ];

  revGroups.forEach(grp => {
    if (!grp.cos.length) return;

    // Section header row
    const hdr = document.createElement('tr');
    hdr.innerHTML = `<td colspan="9" style="padding:6px 14px;background:${grp.bg};border-top:2px solid ${grp.bd};border-bottom:1px solid ${grp.bd}">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span style="font-size:11px;font-weight:700;color:${grp.tc}">${grp.label}</span>
        <span style="font-size:10.5px;font-family:'DM Mono',monospace;color:${grp.tc}">${grp.cos.length} co.</span>
      </div></td>`;
    tbody.appendChild(hdr);

    grp.cos.forEach(co => {
      const rs = revisionStatus(co);
      const rowClass = rs==='active'?'tr-rev':rs==='reapply'?'tr-reapply':rs==='revpending'?'tr-rev':'tr-revdone';
      const typeLbl   = rs==='active'  ? 'Revision'
                      : rs==='reapply' ? 'Re-Apply'
                      : rs==='revpending' ? 'Pending'
                      : 'Complete';
      const typeColor = rs==='reapply' ? 'var(--blue)'    : grp.tc;
      const typeBg    = rs==='reapply' ? 'var(--blue-bg)' : grp.bg;
      const typeBd    = rs==='reapply' ? 'var(--blue-bd)' : grp.bd;
      const badgeCls  = rs==='active'?'b-rev':rs==='reapply'?'b-reapply':rs==='revpending'?'b-revpending':'b-revdone';

      // Sales Revision Request summary for this company
      const salesReq   = co.salesRevRequest || {};
      const reqEntries = Object.entries(salesReq).filter(([,v]) => v && v.requested);
      let salesReqCell = '<span style="color:var(--txt3);font-size:10px">—</span>';
      if (reqEntries.length > 0) {
        const lines = reqEntries.map(([prod, v]) => {
          const newP     = v.newProduct ? ` → <strong style="color:var(--blue)">${v.newProduct}</strong>` : '';
          const mt       = v.confirmedMT != null ? v.confirmedMT.toLocaleString()
                         : v.requestedMT != null ? v.requestedMT.toLocaleString() : '—';
          const stColor  = v.status==='confirmed' ? 'var(--green)' : v.status==='rejected' ? 'var(--red2)' : 'var(--amber)';
          const stIco    = v.status==='confirmed' ? '✅' : v.status==='rejected' ? '✕' : '⏳';
          return `<div style="display:flex;align-items:center;gap:4px;margin-bottom:2px">
            <span style="font-size:9.5px;font-weight:700;color:${stColor}">${stIco}</span>
            <span style="font-size:10px;font-weight:600">${prod}${newP}</span>
            <span style="font-size:9.5px;font-family:'DM Mono',monospace;color:var(--txt3)">${mt} MT</span>
          </div>`;
        }).join('');
        salesReqCell = `<div style="min-width:150px">${lines}</div>`;
      }

      const tr = document.createElement('tr'); tr.className = rowClass;
      tr.innerHTML = `
        <td style="color:var(--txt3);font-size:13px;cursor:pointer;padding:8px 10px" onclick="openDrawer('${co.code}')">↗</td>
        <td><div class="t-code" onclick="openDrawer('${co.code}')">${co.code}</div><div class="t-sub">${co.group}</div></td>
        <td style="padding:6px 10px"><span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:4px;background:${typeBg};color:${typeColor};border:1px solid ${typeBd};white-space:nowrap">${typeLbl}</span></td>
        <td class="t-r" style="vertical-align:top">
          ${(() => {
            const breakdown = getObtainedProdBreakdown(co);
            if (!breakdown) {
              return `<span class="t-mono" style="font-weight:700">${co.obtained.toLocaleString()} MT</span>`;
            }
            return `<div style="min-width:160px">
              <div style="font-size:12px;font-weight:700;font-family:'DM Mono',monospace;text-align:right;margin-bottom:4px;padding-bottom:4px;border-bottom:2px solid var(--border)">${co.obtained.toLocaleString()} MT <span style="font-size:9px;color:var(--txt3);font-weight:400">${co.products.length} products</span></div>
              ${breakdown}
            </div>`;
          })()}
        </td>
        <td>${buildRevChgHtml(co)}</td>
        <td class="t-r t-mono">${co.revMT ? co.revMT.toLocaleString() : '—'}</td>
        <td><span class="badge ${badgeCls}" style="font-size:10px;white-space:normal">${co.revStatus}</span></td>
        <td style="font-size:11px;color:var(--txt3)">${co.revSubmitDate}</td>
        <td style="vertical-align:top">${salesReqCell}</td>`;
      tbody.appendChild(tr);
    });
  });
}

/* SPI table */
let spiFilter = 'ALL', spiSortS = {col:null,dir:1};
function setSPIF(f, el) { spiFilter=f; document.querySelectorAll('#page-spi .fpill').forEach(p=>p.classList.remove('on')); el.classList.add('on'); renderSPI(); }
function sortS(col) { if(spiSortS.col===col)spiSortS.dir*=-1; else{spiSortS.col=col;spiSortS.dir=1;} renderSPI(); }
function updateSPICounts() {
  const base = filteredSPI();
  const nCompleted = base.filter(d=>revisionStatus(d)==='clean'||revisionStatus(d)==='completed').length;
  const nActive   = base.filter(d=>revisionStatus(d)==='active').length;
  const nReapply  = base.filter(d=>revisionStatus(d)==='reapply').length;
  const nUnderRev = nActive + nReapply;  // merged tab
  const nPending  = base.filter(d=>revisionStatus(d)==='revpending').length;
  const nNewSub   = filteredPending().length;
  const s = (id,v) => { const el=document.getElementById(id); if(el) el.textContent=v; };
  s('pillAll',        base.length);
  s('pillClean',      nCompleted);
  s('pillRev',        nUnderRev);   // merged: active + reapply
  s('pillReapply',    nReapply);    // kept for compat
  s('pillRevPending', nPending);
  s('pillNewSub',     nNewSub);
  s('ntcClean', `✅ ${nCompleted} Completed`);
  s('ntcActive',  `🔄 ${nUnderRev} Under Revision`);
  s('ntcPending', `⏳ ${nPending} PENDING`);
  // nav tab count
  const tab=document.querySelectorAll('.nav-tab')[1]; const cnt=tab&&tab.querySelector('.n-count'); if(cnt) cnt.textContent=base.length;
}
function renderSPI() {
  updateSPICounts();
  const q = (document.getElementById('spiQ')||{}).value||'';
  const tbody = document.getElementById('spiBody'); tbody.innerHTML = '';

  /* ── NEW SUBMISSION tab: shows PENDING companies (KARA, AADC, PPGL, SNSD) ── */
  if (spiFilter === 'NEWSUB') {
    let pRows = filteredPending().filter(d =>
      !q || d.code.toLowerCase().includes(q.toLowerCase()) ||
      (d.products||[]).some(p => p.toLowerCase().includes(q.toLowerCase()))
    );
    pRows.forEach(d => {
      const cy = (d.cycles||[]).find(c => /submit/i.test(c.type) && !/obtained/i.test(c.type));
      const latestStatus = cy ? (cy.status || d.status) : d.status;
      const tr = document.createElement('tr'); tr.className = 'tr-pending';
      tr.innerHTML = `
        <td><div class="t-code" onclick="openDrawerPending('${d.code}')">${d.code}</div></td>
        <td style="font-size:11.5px;font-weight:600">${d.group}</td>
        <td>${chips(d.products)}</td>
        <td class="t-r t-mono">${(d.mt||0).toLocaleString()}</td>
        <td class="t-r" style="color:var(--txt3);font-size:11px">—</td>
        <td class="t-r" style="color:var(--txt3);font-size:11px">—</td>
        <td><span class="badge b-pending">📬 New Submission</span></td>
        <td style="font-size:11px;color:var(--red2);line-height:1.4">${latestStatus||'—'}</td>
        <td style="font-size:10.5px;color:var(--txt3)">${d.remarks||'—'}</td>
        <td style="color:var(--txt3);font-size:11px">—</td>
        <td style="color:var(--txt3);font-size:11px">—</td>`;
      tbody.appendChild(tr);
    });
    document.getElementById('spiCount').textContent = `${pRows.length} companies`;
    return;
  }

  /* ── All other tabs: SPI companies ── */
  let rows = [...filteredSPI()].filter(d => {
    const rs = revisionStatus(d);
    const mq = !q || d.code.toLowerCase().includes(q.toLowerCase()) || d.products.some(p=>p.toLowerCase().includes(q.toLowerCase()));
    const mf = spiFilter==='ALL'         ? true
             : spiFilter==='CLEAN'       ? (rs==='clean' || rs==='completed')
             : spiFilter==='REV'         ? (rs==='active' || rs==='reapply')
             : spiFilter==='REAPPLY'     ? rs==='reapply'
             : spiFilter==='REVPENDING'  ? rs==='revpending'
             : /* fallback */               false;
    return mq && mf;
  });
  // Default sort A→Z by company code; override with column sort if active
  rows.sort((a,b) => a.code.localeCompare(b.code));
  if (spiSortS.col) rows.sort((a,b)=>(typeof a[spiSortS.col]==='number'?(a[spiSortS.col]-b[spiSortS.col]):String(a[spiSortS.col]).localeCompare(String(b[spiSortS.col])))*spiSortS.dir);
  rows.forEach(d => {
    const rs = revisionStatus(d);
    const rc = rs==='active'?'tr-rev':rs==='reapply'?'tr-reapply':rs==='revpending'?'tr-rev':rs==='completed'?'tr-revdone':'';
    const tr = document.createElement('tr'); tr.className = rc;
    // Compute live utilization for this company
    const spiUtil = (() => {
      if (d.shipments && Object.keys(d.shipments).length) {
        const tots = Object.values(d.shipments).flat().reduce((s,l)=>s+(l.utilMT||0),0);
        return tots > 0 ? tots : (d.utilizationMT || 0);
      }
      return d.utilizationMT || 0;
    })();
    const utilPct    = d.obtained > 0 ? Math.min(100,(spiUtil/d.obtained*100)).toFixed(0)+'%' : '—';
    const utilColor  = spiUtil > 0 ? 'var(--blue)' : 'var(--txt3)';
    const statusNote = d.statusUpdate || d.spiRef || '—';
      // Sales Rev Request indicator in company cell
      const salesReq2   = d.salesRevRequest || {};
      const reqE2 = Object.entries(salesReq2).filter(([,v]) => v && v.requested);
      const salesRevBadge = reqE2.length > 0 ? (() => {
        const conf  = reqE2.filter(([,v]) => v.status === 'confirmed').length;
        const wait  = reqE2.filter(([,v]) => !v.status || v.status === 'pending').length;
        const col   = conf===reqE2.length ? 'var(--green)' : wait>0 ? 'var(--amber)' : 'var(--red2)';
        const ico   = conf===reqE2.length ? '✅' : wait>0 ? '⏳' : '✕';
        return `<div style="margin-top:2px;font-size:9px;font-weight:700;color:${col}">${ico} Rev Req (${reqE2.length})</div>`;
      })() : '';
    tr.innerHTML = `
      <td><div class="t-code" onclick="openDrawer('${d.code}')">${d.code}${salesRevBadge}</div></td>
      <td style="font-size:11.5px;font-weight:600">${d.group}</td>
      <td>${chips(d.products)}</td>
      <td class="t-r t-mono">${d.submit1.toLocaleString()}</td>
      <td class="t-r t-mono" style="color:var(--teal)">${d.obtained.toLocaleString()}</td>
      <td class="t-r t-mono" style="color:${utilColor}">${spiUtil > 0 ? spiUtil.toLocaleString()+' MT' : '<span style="color:var(--txt3);font-size:10px">—</span>'}</td>
      <td>${statusBadge(d)}</td>
      <td style="font-size:11px;color:${rs==='active'?'var(--amber)':rs==='reapply'?'var(--blue)':rs==='revpending'?'var(--orange)':rs==='completed'?'var(--violet)':'var(--txt3)'}">
        ${d.revType!=='none' ? buildRevNoteHtml(d) : '—'}\n      </td>
      <td style="font-size:10.5px;color:var(--txt3);max-width:180px;line-height:1.4">${statusNote}</td>
      <td style="font-size:10.5px;font-family:'DM Mono',monospace;color:var(--blue)">${d.pertekNo||'<span style="color:var(--txt3)">—</span>'}</td>
      <td style="font-size:10.5px;font-family:'DM Mono',monospace;color:var(--teal)">${d.spiNo||'<span style="color:var(--txt3)">—</span>'}</td>`;
    tbody.appendChild(tr);
  });
  document.getElementById('spiCount').textContent = `${rows.length} companies`;
}


/* Utilization table — 4-group sort: 🔵 Re-Apply Submitted → ✅ Eligible → 🚢 In Shipment → ❌ <60% */
/* ── Util table tab state ──────────────────────────────────────── */
let utilTabMode = 'INSHIP';