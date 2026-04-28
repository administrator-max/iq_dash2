/* ═══════════════════════════════════════
   REVISION MANAGEMENT + saveEdit
   rrGetCategory, buildRevMgmtSection,
   rrSave/Approve/Cancel/Reopen, saveEdit
═══════════════════════════════════════ */

const RR_APPROVAL_STAGES = [
  'Submit',
  'Menunggu Disposisi Direktur',
  'Menunggu Disposisi Kasubdit',
  'Menunggu Disposisi Kasi',
  'Menunggu proses verifikasi oleh staff',
  'Menunggu Persetujuan Kasi',
  'Menunggu Persetujuan Kasubdit',
  'Menunggu Persetujuan Direktur',
  'Menunggu Persetujuan Dirjen',
  'Menunggu Keputusan Dirjen',
  'Pertek terbit',
  'Submit SPI',
  'Proses Pengiriman ke Inatrade',
  'Penerimaan Permohonan di Inatrade',
  'Verifikasi Permohonan',
  'Penelitian Pemprosesan Pendok',
  'Penelitian Ketua Tim',
  'Penelitian Direktur',
  'Penelitian Dirjen',
  'SPI Terbit',
];


/* Categorize a company record into one of four categories */
function rrGetCategory(co) {
  if (!co) return 'unknown';
  if (co.revType === 'active') {
    // Check for Submit #2 cycle OR salesRevReqType === 'Re-Apply'
    const hasSubmit2 = (co.cycles||[]).some(c => /^submit\s*#[2-9]/i.test(c.type));
    const salesType  = co.salesRevReqType || (() => {
      if (co.salesRevRequest && typeof co.salesRevRequest === 'object') {
        for (const v of Object.values(co.salesRevRequest)) {
          if (v && v.revisionType) return v.revisionType;
        }
      }
      return '';
    })();
    const isReapply = hasSubmit2 || salesType === 'Re-Apply';
    return isReapply ? 'submit2' : 'revision';
  }
  if (co.revType === 'complete') {
    // 'complete' BUT still has Obtained #2 without SPI → show edit form as 'complete_pending'
    const hasObt2WithoutSPI = (co.cycles||[]).some(c =>
      /^obtained\s*#[2-9]|^obtained.*revision/i.test(c.type) &&
      (!c.releaseDate || c.releaseDate === 'TBA')
    );
    return hasObt2WithoutSPI ? 'complete_pending' : 'complete';
  }
  return 'clean';
}

function rrCategoryLabel(cat) {
  switch (cat) {
    case 'submit2':          return { cls:'rr-cat-active',   ico:'🔄', txt:'Submit #2 / Additional — Awaiting Approval' };
    case 'revision':         return { cls:'rr-cat-active',   ico:'🔄', txt:'Revision Active — Awaiting Approval' };
    case 'complete':         return { cls:'rr-cat-complete',  ico:'✓',  txt:'Revision / Submit #2 — Approved & Complete' };
    case 'complete_pending': return { cls:'rr-cat-active',   ico:'⏳', txt:'Revision/Submit #2 Approved — SPI Belum Terbit' };
    default:                 return { cls:'rr-cat-clean',     ico:'✅', txt:'Completed — SPI Active' };
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

    let reqRows = reqProds.map(([prod, req], _ri) => {
      const dot      = prodDot(prod);
      const pid      = prod.replace(/[^a-zA-Z0-9]/g,'_') + '_cs' + _ri;
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

    // Detect if this Obtained #2 is TBA/empty — offer quick-fill button
    const isObt2TBA = /^obtained #2/i.test(c.type) && (c.mt == null || c.mt === 0 || c.mt === 'TBA');
    const mtDisp = (c.mt != null && c.mt !== 'TBA' && c.mt > 0)
      ? `<strong style="color:var(--teal)">${Number(c.mt).toLocaleString()} MT</strong>`
      : `<span style="color:var(--txt3);font-style:italic">TBA MT</span>`;

    // Build per-product MT display
    const prodLines = c.products && Object.keys(c.products).length
      ? Object.entries(c.products).map(([p,m]) => {
          const dotC = (typeof prodDot==='function') ? prodDot(p) : '#94a3b8';
          const safeM = (!isNaN(Number(m)) && Number(m) > 0) ? Number(m).toLocaleString() + ' MT' : 'TBA';
          return `<span style="display:inline-flex;align-items:center;gap:3px;margin-right:8px">
            <span style="width:6px;height:6px;border-radius:2px;background:${dotC};display:inline-block"></span>
            <span style="font-size:10px">${p}: <strong>${safeM}</strong></span></span>`;
        }).join('')
      : mtDisp;

    // PERTEK/SPI date display
    const pertekDateDisp = c.pertekDate ? ` · PERTEK: <strong>${c.pertekDate}</strong>` : '';
    const spiDateDisp    = c.spiDate    ? ` · SPI: <strong>${c.spiDate}</strong>`       : '';

    html += `<div class="rr-cycle-row ${rowCls}" style="position:relative">
      <div class="rr-cycle-dot" style="background:${dotColor}"></div>
      <div class="rr-cycle-body">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
          <div class="rr-cycle-type">${c.type}${isActive ? ' <span style="font-size:9px;font-weight:700;padding:1px 5px;background:var(--amber-lt);color:#fff;border-radius:3px;margin-left:4px">ACTIVE</span>' : ''}</div>
          ${isObt2TBA ? `<button onclick="document.getElementById('rrObtTotal')?.scrollIntoView({behavior:'smooth',block:'center'}); document.querySelector('.rr-obt-prod-inp')?.focus()"
            style="font-size:9.5px;font-weight:700;padding:2px 8px;border-radius:4px;border:1px solid var(--teal-bd);background:var(--teal-bg);color:var(--teal);cursor:pointer;white-space:nowrap;flex-shrink:0">
            ✏️ Isi Obtained MT
          </button>` : ''}
        </div>
        <div class="rr-cycle-meta" style="margin-top:3px;flex-wrap:wrap">${prodLines}</div>
        <div class="rr-cycle-meta" style="margin-top:2px">
          ${c.submitType||'Submit'}: <strong>${c.submitDate||'TBA'}</strong> &nbsp;·&nbsp;
          ${c.releaseType||'Release'}: <strong>${c.releaseDate||'TBA'}</strong>${pertekDateDisp}${spiDateDisp}
        </div>
        ${c.status ? `<div class="rr-cycle-status">${c.status}</div>` : ''}
      </div>
    </div>`;
  });
  html += `</div>`;

  // ── 4. Editable fields for active revision / Submit #2 ─────────────────
  if (cat === 'revision' || cat === 'submit2' || cat === 'complete_pending') {
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

    // Build per-product obtained input rows from ALL confirmed salesRevRequest targets
    // This accumulates across multiple confirmed products (e.g. 2 ERW products)
    let prodList = [];
    const salesRevReq2 = co.salesRevRequest || {};
    Object.entries(salesRevReq2).filter(([,v]) => v && v.requested).forEach(([p, req]) => {
      const targets = req.targetProducts && req.targetProducts.length
        ? req.targetProducts
        : [{ product: req.newProduct || p, mt: req.confirmedMT || req.requestedMT || null }];
      targets.forEach(t => {
        const nm = t.product || p;
        if (nm && !prodList.find(x => x.prod === nm)) {
          prodList.push({ prod: nm, mt: t.mt || req.confirmedMT || req.requestedMT || null });
        }
      });
    });
    // Fallback to revTo if salesRevRequest empty
    if (!prodList.length && co.revTo && co.revTo.length) {
      prodList = co.revTo;
    }

    // Load existing obtained #2 cycle values for pre-fill
    const obt2Cy = (co.cycles||[]).find(c => /^obtained\s*#2/i.test(c.type) || /^obtained.*revision/i.test(c.type));
    const obt2Prods = obt2Cy ? (obt2Cy.products || {}) : {};
    const obt2MT    = obt2Cy ? obt2Cy.mt : null;
    const obt2SPI   = obt2Cy ? (obt2Cy.releaseDate||'') : '';
    const obt2SpiDate = obt2Cy ? (obt2Cy.spiDate||'') : '';
    const obt2PERTEK= (co.cycles||[]).find(c => /^(submit\s*#2|revision\s*#)/i.test(c.type));
    const pertekVal = obt2PERTEK ? (obt2PERTEK.releaseDate||'') : (co.pertekNo||'');
    const pertekDateVal = obt2PERTEK ? (obt2PERTEK.pertekDate||'') : (co.pertekDate||'');

    // Per-product obtained MT inputs
    let obtainedHtml = '';
    if (prodList.length > 0) {
      const prodRows = prodList.map((t, i) => {
        const prodName = t.prod || t.product || '';
        // Pre-fill: existing Obtained #2 value if valid → revTo.mt → empty
        const existRaw = obt2Prods[prodName];
        const existParsed = parseFloat(String(existRaw).replace(/,/g,''));
        const revToMT = (t.mt != null && !isNaN(Number(t.mt)) && Number(t.mt) > 0) ? Number(t.mt) : null;
        const existNum = (!isNaN(existParsed) && existParsed > 0)
          ? existParsed
          : revToMT;
        const existVal = existNum != null ? existNum.toLocaleString() : '';
        const dotColor = (typeof prodDot === 'function') ? prodDot(prodName) : '#94a3b8';
        const dot = `<span style="display:inline-block;width:7px;height:7px;border-radius:2px;background:${dotColor};margin-right:5px;vertical-align:middle;flex-shrink:0"></span>`;
        return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          <div style="flex:1;font-size:11px;font-weight:600;color:var(--txt);display:flex;align-items:center">${dot}${prodName}</div>
          <input type="text" inputmode="decimal" class="fi rr-obt-prod-inp" data-prod="${prodName}"
            value="${existVal}" placeholder="e.g. 2,200"
            oninput="fmtThousandInline(this);rrUpdateObtTotal()"
            style="width:120px;text-align:right;font-family:'DM Mono',monospace;font-size:12px;font-weight:700">
        </div>`;
      }).join('');
      // Compute initial total for display
      const initTotal = prodList.reduce((s, t) => {
        const prodName = t.prod || t.product || '';
        const raw = obt2Prods[prodName];
        const parsed = parseFloat(String(raw).replace(/,/g,''));
        const revToMT2 = (t.mt != null && !isNaN(Number(t.mt)) && Number(t.mt) > 0) ? Number(t.mt) : 0;
        const v = (!isNaN(parsed) && parsed > 0) ? parsed : revToMT2;
        return s + v;
      }, 0);
      const initTotalDisp = initTotal > 0 ? initTotal.toLocaleString() + ' MT' : '—';

      obtainedHtml = `<div style="margin-bottom:12px;padding:10px;background:var(--teal-bg);border:1px solid var(--teal-bd);border-radius:7px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <div class="fl" style="color:var(--teal);margin-bottom:0">Obtained MT — Per Produk
            <span class="tti" data-tip="Isi Obtained MT yang resmi diterbitkan dalam PERTEK/SPI revision ini. Pre-filled dari revisi request — edit sesuai dokumen resmi.">i</span>
          </div>
          <button onclick="rrApplyObtained('${code}')"
            style="font-size:10.5px;font-weight:700;padding:4px 12px;border-radius:5px;border:none;
              background:var(--teal);color:#fff;cursor:pointer;transition:background .13s;white-space:nowrap"
            onmouseover="this.style.background='#0a6670'" onmouseout="this.style.background='var(--teal)'">
            ✓ Terapkan ke Obtained #2
          </button>
        </div>
        ${prodRows}
        <div style="display:flex;justify-content:flex-end;margin-top:6px;font-size:10px;color:var(--txt3);gap:4px;align-items:center">
          Total: <strong id="rrObtTotal" style="color:var(--teal);font-family:'DM Mono',monospace">${initTotalDisp}</strong>
        </div>
      </div>`;
    } else {
      // No product breakdown — single MT field
      const singleVal = (obt2MT != null && !isNaN(Number(obt2MT))) ? Number(obt2MT).toLocaleString() : '';
      obtainedHtml = `<div style="margin-bottom:12px;padding:10px;background:var(--teal-bg);border:1px solid var(--teal-bd);border-radius:7px">
        <div class="fl" style="color:var(--teal);margin-bottom:8px">Obtained MT (Total)</div>
        <input type="text" inputmode="decimal" class="fi rr-obt-prod-inp" data-prod="_total"
          value="${singleVal}" placeholder="MT"
          oninput="fmtThousandInline(this)"
          style="width:130px;text-align:right;font-family:'DM Mono',monospace;font-size:12px">
      </div>`;
    }

    html += `<div class="rr-edit-area">
      <div class="rr-edit-hd">✏️ Update Revision / Submit #2 Status</div>
      ${changeHtml}
      ${obtainedHtml}
      <div class="rr-form-row">
        <div>
          <div class="fl">Approval Stage</div>
          <select class="fi" id="rrApprovalStage" onchange="rrUpdateObtTotal()">${stageOpts}</select>
        </div>
        <div>
          <div class="fl">Rev. Submit Date</div>
          <input class="fi" id="rrRevDate" type="text" placeholder="DD/MM/YYYY" value="${dateVal}">
        </div>
      </div>
      <div class="rr-form-row">
        <div>
          <div class="fl">PERTEK No. (Revision)</div>
          <input class="fi" id="rrRevPertekNo" type="text" placeholder="e.g. 601/ILMATE/PERTEK-SPI-P/II/2026" value="${pertekVal && pertekVal !== 'TBA' ? pertekVal : ''}">
        </div>
        <div>
          <div class="fl">PERTEK Terbit Date</div>
          <input class="fi" id="rrRevPertekDate" type="text" placeholder="DD/MM/YYYY" value="${pertekDateVal && pertekDateVal !== 'TBA' ? pertekDateVal : ''}">
        </div>
      </div>
      <div class="rr-form-row">
        <div>
          <div class="fl">SPI No. (Revision)</div>
          <input class="fi" id="rrRevSpiNo" type="text" placeholder="e.g. 04.SPI-05.26.1624" value="${obt2SPI && obt2SPI !== 'TBA' ? obt2SPI : ''}">
        </div>
        <div>
          <div class="fl">SPI Terbit Date</div>
          <input class="fi" id="rrRevSpiDate" type="text" placeholder="DD/MM/YYYY" value="${obt2SpiDate && obt2SpiDate !== 'TBA' ? obt2SpiDate : ''}">
        </div>
      </div>
      <div class="rr-form-row full">
        <div>
          <div class="fl">Status Note <span class="tti" data-tip="Internal — ditampilkan di Revision table">i</span></div>
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

  

  el.innerHTML = html;
}

/* ── CorpSec: confirm / reject individual revision request items ── */
function csConfirmRev(prod, pid, code) {
  const co = getSPI(code); if (!co) return;
  const req = co.salesRevRequest && co.salesRevRequest[prod];
  if (!req) return;

  // Read MT from input — use requestedMT as fallback only if input is truly empty
  const inp = document.getElementById('csconf-mt-' + pid);
  const raw = inp ? inp.value.replace(/,/g,'').trim() : '';
  const mt  = raw !== '' ? parseFloat(raw) : (req.requestedMT || null);

  req.status        = 'confirmed';
  req.confirmedMT   = mt;
  req.confirmedDate = new Date().toLocaleDateString('id-ID',{day:'2-digit',month:'short',year:'numeric'});
  req.confirmedBy   = currentRole || 'CorpSec';

  // ── Build products object from targetProducts ──────────────────────
  if (!co.cycles) co.cycles = [];
  const targets = req.targetProducts && req.targetProducts.length
    ? req.targetProducts
    : [{ product: req.newProduct || prod, mt }];
  const prodObj = {};
  targets.forEach(t => { if (t.product) prodObj[t.product] = t.mt || mt || 0; });
  if (!Object.keys(prodObj).length) prodObj[prod] = mt || 0;

  // Remove stale pending cycle for this prod
  co.cycles = co.cycles.filter(c =>
    !(c.type === `Revision Request — ${prod}` && c.status === 'pending')
  );

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

  // ── Update revType + accumulate revFrom/revTo ──────────────────────
  // revFrom/revTo accumulate across multiple csConfirmRev calls (multi-product)
  if (!co.revFrom) co.revFrom = [];
  if (!co.revTo)   co.revTo   = [];

  // Remove old entry for this prod if re-confirming
  co.revFrom = co.revFrom.filter(f => f.prod !== prod);
  co.revTo   = co.revTo.filter(f => f.prod !== prod && !targets.some(t => t.product === f.prod));

  // Add updated entries — revFrom uses per-product obtained MT, not total
  const obtByProdMap = (typeof getObtainedByProd === 'function') ? getObtainedByProd(co) : {};
  const fromMT = obtByProdMap[prod] != null ? obtByProdMap[prod] : (co.obtained || 0);
  co.revFrom.push({ prod, mt: fromMT, label: 'Before' });
  targets.forEach(t => {
    // Use confirmed MT (mt from input) — not requestedMT
    const toMT = (t.mt != null && !isNaN(Number(t.mt)) && Number(t.mt) > 0)
      ? Number(t.mt)
      : (mt || 0);
    co.revTo.push({ prod: t.product || prod, mt: toMT, label: 'After' });
  });

  // Activate revision tracking
  co.revType   = 'active';
  co.revStatus = `Revision Request dikonfirmasi — ${prod}${req.newProduct ? ' → ' + req.newProduct : ''} · ${now}`;
  if (!co.revNote) co.revNote = req.note || '';

  buildRevMgmtSection(co);
  applyRolePermissions();
  buildRevList && buildRevList();
  updateSPICounts && updateSPICounts();
  saveToStorage();
  patchToServer(co).catch(err => notifySaveError('csConfirmRev', err));
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
  saveToStorage();
  patchToServer(co).catch(err => notifySaveError('csBatalRev', err));
}

/* ── Action handlers ─────────────────────────────────────────────────────── */

/* Save approval stage + date + note to the live record */

/* ── Read obtained MT from revision edit form ── */
function rrReadObtainedFromForm(co) {
  const inputs = document.querySelectorAll('.rr-obt-prod-inp');
  if (!inputs.length) return { total: null, byProd: {} };
  const byProd = {};
  let total = 0;
  inputs.forEach(inp => {
    const prod = inp.dataset.prod;
    const raw  = (inp.value || '').replace(/,/g,'').trim();
    const val  = parseFloat(raw);
    const safeVal = (!isNaN(val) && val > 0) ? val : 0;
    if (prod === '_total') {
      total = safeVal;
    } else if (prod && safeVal > 0) {
      byProd[prod] = safeVal;
      total += safeVal;
    }
  });
  return { total, byProd };
}

/* ── Apply obtained MT values directly to Obtained #2 cycle ── */
function rrApplyObtained(code) {
  const co = getSPI(code); if (!co) return;
  const { total: obtTotal, byProd: obtByProd } = rrReadObtainedFromForm(co);

  if (obtTotal <= 0 && !Object.keys(obtByProd).length) {
    alert('Isi Obtained MT terlebih dahulu sebelum menerapkan.'); return;
  }

  // Find or create Obtained #2 cycle
  let obt2Cy = (co.cycles||[]).find(c => /^obtained\s*#2/i.test(c.type) || /^obtained.*revision/i.test(c.type));
  if (!obt2Cy) {
    if (!co.cycles) co.cycles = [];
    obt2Cy = {
      type: 'Obtained #2', mt: null, products: {},
      submitType: 'Submit MOT (Submit #2) Perubahan', submitDate: 'TBA',
      releaseType: 'SPI Perubahan', releaseDate: 'TBA', status: '', _fromRevReq: true
    };
    co.cycles.push(obt2Cy);
  }

  obt2Cy.mt       = obtTotal;
  obt2Cy.products = obtByProd;
  const spiNoVal   = (g('rrRevSpiNo')    || {}).value || '';
  const spiDateVal = (g('rrRevSpiDate')  || {}).value || '';
  const pkNoVal    = (g('rrRevPertekNo') || {}).value || '';
  const pkDateVal  = (g('rrRevPertekDate')|| {}).value || '';
  if (spiNoVal)   { obt2Cy.releaseDate = spiNoVal; co.spiNo = spiNoVal; }
  if (spiDateVal) { obt2Cy.spiDate = spiDateVal; co.spiDate = spiDateVal; }
  if (pkNoVal)    { co.pertekNo = pkNoVal; }
  if (pkDateVal)  { co.pertekDate = pkDateVal; }
  obt2Cy.status = `Obtained #2 — ${obtTotal.toLocaleString()} MT${spiNoVal ? ' · SPI: ' + spiNoVal : ''}${spiDateVal ? ' · ' + spiDateVal : ''}`;
  co.revMT = obtTotal;

  // Visual feedback on button
  const btn = document.querySelector(`button[onclick="rrApplyObtained('${code}')"]`);
  if (btn) {
    const orig = btn.textContent;
    btn.textContent = '✓ Diterapkan!';
    btn.style.background = 'var(--green)';
    setTimeout(() => { if(btn){ btn.textContent = orig; btn.style.background = 'var(--teal)'; } }, 1800);
  }

  // Refresh cycle history panel
  buildRevMgmtSection(co);

  // Persist to localStorage + server
  saveToStorage();
  patchToServer(co).catch(err => notifySaveError('rrApplyObtained', err));

  nsShowToast(`✓ Obtained #2 updated — ${obtTotal.toLocaleString()} MT`);
}

/* ── Update obtained total display ── */
function rrUpdateObtTotal() {
  const el = document.getElementById('rrObtTotal');
  if (!el) return;
  let t = 0;
  document.querySelectorAll('.rr-obt-prod-inp').forEach(inp => {
    t += parseFloat(inp.value.replace(/,/g,'')) || 0;
  });
  el.textContent = t > 0 ? t.toLocaleString() + ' MT' : '—';
}

function rrSaveStatus(code) {
  const co     = getSPI(code); if (!co) return;
  const stage  = (g('rrApprovalStage') || {}).value || '';
  const date   = (g('rrRevDate')       || {}).value || '';
  const note   = (g('rrStatusNote')    || {}).value || '';
  const pertekNo   = (g('rrRevPertekNo')   || {}).value || '';
  const pertekDate = (g('rrRevPertekDate') || {}).value || '';
  const spiNo      = (g('rrRevSpiNo')      || {}).value || '';
  const spiDate    = (g('rrRevSpiDate')    || {}).value || '';
  const { total: obtTotal, byProd: obtByProd } = rrReadObtainedFromForm(co);

  co.revStatus = stage;
  if (date)      co.revSubmitDate = date;
  if (note) {
    co.revNote     = note;
    // Sync to statusUpdate so it shows in PERTEK & SPI main table "STATUS UPDATE" column
    co.statusUpdate = note;
  }
  if (pertekNo)  co.pertekNo  = pertekNo;
  if (pertekDate)co.pertekDate = pertekDate;
  if (spiNo)     co.spiNo     = spiNo;

  // Update / create the Obtained #2 cycle with new MT values
  const dateStr = new Date().toLocaleDateString('id-ID',{day:'2-digit',month:'2-digit',year:'2-digit'});
  let obt2Cy = (co.cycles||[]).find(c => /^obtained\s*#2/i.test(c.type) || /^obtained.*revision/i.test(c.type));
  if (!obt2Cy) {
    obt2Cy = { type: 'Obtained #2', mt: null, products: {}, submitType: 'Submit MOT (Submit #2) Perubahan', submitDate: 'TBA', releaseType: 'SPI Perubahan', releaseDate: 'TBA', status: '', _fromRevReq: true };
    if (!co.cycles) co.cycles = [];
    co.cycles.push(obt2Cy);
  }
  if (obtTotal > 0) { obt2Cy.mt = obtTotal; co.revMT = obtTotal; }
  if (Object.keys(obtByProd).length) obt2Cy.products = obtByProd;
  if (spiNo)    { obt2Cy.releaseDate = spiNo; }
  if (spiDate)  { obt2Cy.spiDate = spiDate; }

  // Update active Submit #2 / Revision cycle with PERTEK no + date
  const activeCy = rrGetActiveCycle(co);
  if (activeCy) {
    activeCy.status = `Update ${dateStr} - ${stage}`;
    if (pertekNo)   activeCy.releaseDate = pertekNo;
    if (pertekDate) activeCy.pertekDate  = pertekDate;
  }

  _refreshAfterRREdit();
  buildRevMgmtSection(co);
  saveToStorage();
  patchToServer(co).catch(err => notifySaveError('rrSaveStatus', err));
  nsShowToast(`✓ ${code} revision status updated`);
}

/* Mark revision as fully approved — sets revType to 'complete' */
function rrMarkApproved(code) {
  const co     = getSPI(code); if (!co) return;
  const stage  = (g('rrApprovalStage') || {}).value || '';
  const date   = (g('rrRevDate')       || {}).value || '';
  const pertekNo   = (g('rrRevPertekNo')   || {}).value || '';
  const pertekDate = (g('rrRevPertekDate') || {}).value || '';
  const spiNo      = (g('rrRevSpiNo')      || {}).value || '';
  const spiDate    = (g('rrRevSpiDate')    || {}).value || '';
  const { total: obtTotal, byProd: obtByProd } = rrReadObtainedFromForm(co);

  co.revType   = 'complete';
  co.revStatus = spiNo
    ? `SPI Perubahan Terbit — No. ${spiNo}`
    : (pertekNo ? `PERTEK Perubahan Terbit — No. ${pertekNo}` : `APPROVED — ${stage}`);

  // Update active Submit #2 / Revision cycle
  const activeCy = rrGetActiveCycle(co);
  if (activeCy) {
    activeCy.status = `APPROVED — ${stage}`;
    if (pertekNo) activeCy.releaseDate = pertekNo;
  }

  // Update / create Obtained #2 cycle
  let obt2Cy = (co.cycles||[]).find(c => /^obtained\s*#2/i.test(c.type) || /^obtained.*revision/i.test(c.type));
  if (!obt2Cy) {
    obt2Cy = { type: 'Obtained #2', mt: null, products: {}, submitType: 'Submit MOT (Submit #2) Perubahan', submitDate: date || 'TBA', releaseType: 'SPI Perubahan', releaseDate: spiNo || 'TBA', status: '', _fromRevReq: true };
    if (!co.cycles) co.cycles = [];
    co.cycles.push(obt2Cy);
  }
  if (obtTotal > 0) {
    obt2Cy.mt   = obtTotal;
    co.revMT    = obtTotal;
    // Update co.obtained to reflect new total (revision approved)
    co.obtained = (co.obtained || 0) - (co.revMT || 0) + obtTotal;
  }
  if (Object.keys(obtByProd).length) obt2Cy.products = obtByProd;
  if (spiNo) {
    obt2Cy.releaseDate = spiNo;
    co.spiNo = spiNo;
    obt2Cy.status = `SPI Perubahan TERBIT — No. ${spiNo}${spiDate ? ' · ' + spiDate : ''}`;
  } else if (pertekNo) {
    obt2Cy.status = `PERTEK Perubahan TERBIT — No. ${pertekNo}${pertekDate ? ' · ' + pertekDate : ''} · SPI TBA`;
  }
  if (pertekNo)   { co.pertekNo = pertekNo; }
  if (pertekDate) { co.pertekDate = pertekDate; if (activeCy) activeCy.pertekDate = pertekDate; }
  if (spiDate)    { co.spiDate = spiDate; obt2Cy.spiDate = spiDate; }

  _refreshAfterRREdit();
  buildRevMgmtSection(co);
  saveToStorage();
  patchToServer(co).catch(err => notifySaveError('rrMarkApproved', err));
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
  saveToStorage();
  patchToServer(co).catch(err => notifySaveError('rrCancelRevision', err));
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

  // ── Auto-extract PERTEK date from status text if not formally filled ──────
  // CorpSec sometimes types "PERTEK TERBIT 14/04/2026" in the Status Update field
  // instead of using the formal PERTEK Date input → extract it automatically
  let _autoPertekDate = newPertekDate;
  if (!hasPERTEK && newStatusUpdate) {
    const m = newStatusUpdate.match(/pertek\s*terbit[:\s]+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i);
    if (m) _autoPertekDate = m[1].replace(/-/g, '/');
  }
  const _hasPERTEK = _autoPertekDate !== '' && _autoPertekDate != null;

  /* ── 1. Locate or promote company ── */
  let co = getSPI(c);
  let promotedFromPending = false;

  if (!co) {
    // In PENDING — if PERTEK date now filled, promote to SPI array
    const pi = PENDING.findIndex(p => p.code === c);
    if (pi >= 0) {
      if (_hasPERTEK && _autoPertekDate) {
        const pr = PENDING.splice(pi, 1)[0];
        const prods = pr.products || [];
        const submitMT  = newSubmitMT   != null ? newSubmitMT   : (pr.mt || 0);
        const obtMT     = newObtainedMT != null ? newObtainedMT : 0;
        const subProdObj = Object.keys(newSubmitProds).length > 0
          ? newSubmitProds
          : (pr.cycles && pr.cycles[0] ? pr.cycles[0].products
            : prods.reduce((o, p) => { o[p] = Math.round(submitMT / Math.max(prods.length,1)); return o; }, {}));
        const obtProdObj = Object.keys(newObtainedProds).length > 0
          ? newObtainedProds
          : prods.reduce((o, p) => { o[p] = Math.round(obtMT / Math.max(prods.length,1)); return o; }, {});
        const _pertekDateFinal = _autoPertekDate; // might be auto-extracted from status text
        const newRec = {
          code: pr.code, group: pr.group || 'CD',
          submit1: submitMT, obtained: obtMT, products: prods,
          revType: 'complete', revSubmitDate: _pertekDateFinal,
          revStatus: hasSPI
            ? `SPI TERBIT ${newSpiDate}`
            : `PERTEK TERBIT ${_pertekDateFinal} — SPI belum terbit`,
          revNote: hasSPI
            ? `SPI TERBIT ${newSpiDate}`
            : `PERTEK TERBIT ${_pertekDateFinal} — SPI belum terbit`,
          revFrom: [], revTo: [], revMT: 0,
          remarks: newRem || pr.remarks || '',
          spiRef: hasSPI ? `SPI TERBIT ${newSpiDate}` : `PERTEK TERBIT ${_pertekDateFinal}`,
          pertekNo: newPertekNo, spiNo: newSpiNo,
          statusUpdate: newStatusUpdate || '',
          cycles: [
            { type: 'Submit #1', mt: submitMT, products: subProdObj,
              submitType: 'Submit MOI', submitDate: newSubmitDate || (pr.cycles&&pr.cycles[0]?pr.cycles[0].submitDate:''),
              releaseType: 'PERTEK', releaseDate: _pertekDateFinal,
              pertekDate: _pertekDateFinal,
              status: newStatusUpdate ? `PERTEK TERBIT ${_pertekDateFinal} · ${newStatusUpdate}` : `PERTEK TERBIT ${_pertekDateFinal}` },
            { type: 'Obtained #1', mt: obtMT, products: obtProdObj,
              submitType: 'Submit MOT', submitDate: 'TBA',
              releaseType: 'SPI', releaseDate: hasSPI ? newSpiDate : 'TBA',
              status: hasSPI ? `SPI TERBIT ${newSpiDate}` : `PERTEK Terbit: ${_pertekDateFinal} · SPI: belum terbit` },
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

  /* ── 4. Persist to server + localStorage, then refresh ── */
  saveToStorage(); // localStorage backup
  updateStorageStatus();

  // PATCH to server so data survives page refresh
  if (co) {
    patchToServer(co).then(() => {
      showSaveToast(new Date().toISOString());
    }).catch(err => {
      console.error('Server PATCH failed:', err);
      // Show visible error to user — not just silent console warning
      const errMsg = `⚠️ Data tersimpan di browser, tapi gagal sync ke server: ${err.message}. Coba refresh dan input ulang.`;
      setTimeout(() => alert(errMsg), 300);
      showSaveToast(new Date().toISOString());
    });
  } else {
    // Also save PENDING company changes to server
    const pi2 = PENDING.findIndex(p => p.code === c);
    if (pi2 >= 0) {
      patchToServer(PENDING[pi2]).catch(err =>
        notifySaveError('PENDING update', err)
      );
    }
    showSaveToast(new Date().toISOString());
  }

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