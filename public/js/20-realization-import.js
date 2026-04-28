/* ═══════════════════════════════════════════════════════════════════
   REALIZATION IMPORT — Ops feature
   - Upload Excel (.xlsx) PIB customs export → parse via SheetJS → POST batch
   - Manual entry form → POST single row
   - List existing realizations for the selected company
   Backend endpoints: GET/POST/DELETE /api/realizations  (server.js)
═══════════════════════════════════════════════════════════════════ */

let _realizParsed     = null;   // { sourceFile, rows: [...] }
let _realizActiveTab  = 'excel';

/* Filename-derived company name → 3-letter code is now resolved via the
   DB-backed COMPANY_DIRECTORY (loaded into COMPANY_NAME_TO_CODE in 01-data.js).
   See company.xlsx — the canonical library. No more hardcoded map here. */

/* ── PIB Excel header → JS field mapping ─────────────────────────── */
const PIB_HEADER_MAP = {
  'No':                  'lineNo',
  'Uraian Barang':       'description',
  'Pos Tarif/HS 10 Digit': 'hsCode',
  'Volume':              'volume',
  'Satuan':              'unit',
  'Nilai':               'valueUSD',
  'Hrg. Satuan':         'unitPrice',
  'Kurs':                'kurs',
  'Negara Asal':         'countryOrigin',
  'Pelabuhan Tujuan':    'portDestination',
  'No. L/S':             'lsNo',
  'Tgl. L/S':            'lsDate',
  'No. PIB':             'pibNo',
  'Tgl. PIB':            'pibDate',
  'No. Invoice':         'invoiceNo',
  'Tgl. Invoice':        'invoiceDate',
  'Pelabuhan Muat':      'portLoading',
  'No Pengajuan':        'pengajuanNo',
  'Tanggal Pengajuan':   'pengajuanDate',
};

/* ── Modal open/close ────────────────────────────────────────────── */
function openRealizationImport() {
  populateRealizCompanyPicker();
  populateRealizManualProductList();
  document.getElementById('realizImportModal').style.display = 'block';
  setRealizTab('excel', document.getElementById('realizTabExcel'));
  resetRealizParsed();
  bindRealizDropZone();
}

function closeRealizationImport() {
  document.getElementById('realizImportModal').style.display = 'none';
}

/* Opens the Realization Import modal and pre-selects whichever company
   is currently picked in the Input Data → Manual Update form. Used by
   the "Upload Excel / Manual Entry" button inside the Operations section
   so Ops users don't have to re-pick the company. */
function openRealizationImportFromForm() {
  openRealizationImport();
  const editCo = document.getElementById('editCo');
  const sel    = document.getElementById('realizCompanyPick');
  if (editCo && editCo.value && sel) {
    sel.value = editCo.value;
    if (sel.onchange) sel.onchange();
    const hint = document.getElementById('realizCompanyHint');
    if (hint) {
      const full = (typeof lookupCompanyNameByCode === 'function') ? lookupCompanyNameByCode(editCo.value) : '';
      hint.textContent = `Pre-selected from Input Data → ${editCo.value}${full ? ` (${full})` : ''}`;
    }
  }
}

function setRealizTab(tab, el) {
  _realizActiveTab = tab;
  ['excel','manual','list'].forEach(t => {
    const pane = document.getElementById('realizPane' + t.charAt(0).toUpperCase() + t.slice(1));
    if (pane) pane.style.display = (t === tab) ? 'block' : 'none';
    const btn = document.getElementById('realizTab' + t.charAt(0).toUpperCase() + t.slice(1));
    if (btn) {
      btn.style.color = (t === tab) ? 'var(--blue)' : 'var(--txt3)';
      btn.style.fontWeight = (t === tab) ? '700' : '600';
      btn.style.borderBottomColor = (t === tab) ? 'var(--blue)' : 'transparent';
    }
  });
  if (tab === 'list') loadRealizationsList();
}

/* ── Company picker populated from SPI + PENDING, augmented with
   full names from COMPANY_DIRECTORY (DB-backed library). ────────── */
function populateRealizCompanyPicker() {
  const sel = document.getElementById('realizCompanyPick');
  if (!sel) return;
  const all = [...(typeof SPI !== 'undefined' ? SPI : []), ...(typeof PENDING !== 'undefined' ? PENDING : [])];
  all.sort((a,b) => a.code.localeCompare(b.code));
  sel.innerHTML = '<option value="">— select company —</option>' +
    all.map(c => {
      const full = c.fullName || (typeof lookupCompanyNameByCode === 'function' ? lookupCompanyNameByCode(c.code) : '');
      const label = full ? `${c.code} — ${full}` : `${c.code} — ${(c.products||[]).join(', ') || '—'}`;
      return `<option value="${c.code}">${label}</option>`;
    }).join('');
  sel.onchange = () => {
    const hint = document.getElementById('realizCompanyHint');
    const full = sel.value && typeof lookupCompanyNameByCode === 'function' ? lookupCompanyNameByCode(sel.value) : '';
    if (hint) hint.textContent = sel.value ? (full ? `${sel.value} — ${full}` : `Records will be saved under code ${sel.value}`) : '';
    if (_realizActiveTab === 'list') loadRealizationsList();
  };
}

function populateRealizManualProductList() {
  const sel = document.getElementById('realizManualProduct');
  if (!sel) return;
  const products = (typeof PRODUCT_META === 'object')
    ? Object.keys(PRODUCT_META)
    : ['GL BORON','GI BORON','BORDES ALLOY','AS STEEL','SHEETPILE','SEAMLESS PIPE','HOLLOW PIPE','PPGL CARBON','ERW PIPE OD≤140mm','ERW PIPE OD>140mm','HRC/HRPO ALLOY'];
  sel.innerHTML = '<option value="">— auto from HS code —</option>' +
    products.sort().map(p => `<option value="${p}">${p}</option>`).join('');
}

/* ── HS code → canonical product name ────────────────────────────── */
function realizProductFromHS(hs) {
  if (!hs || typeof PRODUCT_META !== 'object') return null;
  const norm = String(hs).trim();
  for (const [name, meta] of Object.entries(PRODUCT_META)) {
    if (meta.hsCode === norm) return name;
  }
  return null;
}

/* ── Drag-drop zone wiring ───────────────────────────────────────── */
function bindRealizDropZone() {
  const dz = document.getElementById('realizDropZone');
  const inp = document.getElementById('realizFileInput');
  if (!dz || !inp || dz._wired) return;
  dz._wired = true;
  dz.onclick = () => inp.click();
  dz.ondragover = e => { e.preventDefault(); dz.classList.add('over'); };
  dz.ondragleave = () => dz.classList.remove('over');
  dz.ondrop = e => {
    e.preventDefault();
    dz.classList.remove('over');
    if (e.dataTransfer.files.length) parseRealizFile(e.dataTransfer.files[0]);
  };
}

function handleRealizFile(ev) {
  const f = ev.target.files && ev.target.files[0];
  if (f) parseRealizFile(f);
}

/* ── Parse the xlsx in-browser via SheetJS ───────────────────────── */
function parseRealizFile(file) {
  if (typeof XLSX === 'undefined') {
    showToast('Excel parser (SheetJS) not loaded — refresh the page', 'error');
    return;
  }
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const wb = XLSX.read(e.target.result, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      if (!aoa.length) throw new Error('Empty sheet');
      const headers = aoa[0].map(h => String(h).trim());
      const rows = [];
      for (let i = 1; i < aoa.length; i++) {
        const r = aoa[i];
        if (!r || r.every(v => v === '' || v == null)) continue;
        const obj = {};
        headers.forEach((h, idx) => {
          const key = PIB_HEADER_MAP[h];
          if (key) obj[key] = r[idx];
        });
        // Normalize numeric fields
        ['lineNo','volume','valueUSD','unitPrice','kurs'].forEach(k => {
          if (obj[k] !== undefined && obj[k] !== '') {
            const n = Number(obj[k]);
            obj[k] = Number.isNaN(n) ? null : n;
          }
        });
        // Resolve product from HS code
        if (obj.hsCode) obj.product = realizProductFromHS(obj.hsCode);
        rows.push(obj);
      }
      if (!rows.length) throw new Error('No data rows found');

      _realizParsed = { sourceFile: file.name, rows };
      // Try to auto-select company from filename
      autoSelectCompanyFromFilename(file.name);
      renderRealizPreview();
    } catch (err) {
      showToast(`Parse failed: ${err.message}`, 'error');
      console.error(err);
    }
  };
  reader.onerror = () => showToast('File read failed', 'error');
  reader.readAsArrayBuffer(file);
}

function autoSelectCompanyFromFilename(filename) {
  const base = filename.replace(/\.xlsx?$/i, '').replace(/-\d+$/, '').trim();
  const code = (typeof lookupCompanyCodeByName === 'function')
    ? lookupCompanyCodeByName(base)
    : null;
  if (code) {
    const sel = document.getElementById('realizCompanyPick');
    if (sel) {
      sel.value = code;
      const hint = document.getElementById('realizCompanyHint');
      if (hint) hint.textContent = `Auto-detected from filename → ${code}${COMPANY_CODE_TO_NAME[code] ? ` (${COMPANY_CODE_TO_NAME[code]})` : ''}`;
    }
  }
}

function renderRealizPreview() {
  if (!_realizParsed) return;
  const { sourceFile, rows } = _realizParsed;
  const summary = document.getElementById('realizParsedSummary');
  const wrap    = document.getElementById('realizPreviewWrap');
  const body    = document.getElementById('realizPreviewBody');
  const cnt     = document.getElementById('realizPreviewCount');
  if (!summary || !wrap || !body || !cnt) return;

  const totalVolume = rows.reduce((s,r) => s + (Number(r.volume)||0), 0);
  const totalValue  = rows.reduce((s,r) => s + (Number(r.valueUSD)||0), 0);
  const pibNos      = [...new Set(rows.map(r => r.pibNo).filter(Boolean))];
  const productResolved = rows.filter(r => r.product).length;

  summary.style.display = 'block';
  summary.innerHTML = `
    <strong>${sourceFile}</strong> — ${rows.length} line items · ${pibNos.length} PIB(s): ${pibNos.join(', ')||'—'}<br>
    Total volume: <strong>${totalVolume.toLocaleString(undefined,{maximumFractionDigits:3})}</strong> ${rows[0].unit||'TNE'} ·
    Total value: <strong>$${totalValue.toLocaleString()}</strong> ·
    Products auto-resolved: <strong>${productResolved}/${rows.length}</strong>
  `;

  cnt.textContent = rows.length;
  body.innerHTML = rows.map(r => `
    <tr>
      <td style="padding:4px 6px;border-bottom:1px solid var(--border)">${r.lineNo??'—'}</td>
      <td style="padding:4px 6px;border-bottom:1px solid var(--border);max-width:280px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${(r.description||'').replace(/"/g,'&quot;')}">${r.description||'—'}</td>
      <td style="padding:4px 6px;border-bottom:1px solid var(--border);font-family:'DM Mono',monospace">${r.hsCode||'—'}${r.product?` <span style="color:var(--blue);font-weight:700">→ ${r.product}</span>`:''}</td>
      <td style="padding:4px 6px;border-bottom:1px solid var(--border);text-align:right;font-family:'DM Mono',monospace">${r.volume?.toLocaleString?.(undefined,{maximumFractionDigits:3})||'—'}</td>
      <td style="padding:4px 6px;border-bottom:1px solid var(--border);text-align:right;font-family:'DM Mono',monospace">${r.valueUSD?.toLocaleString?.()||'—'}</td>
      <td style="padding:4px 6px;border-bottom:1px solid var(--border);font-family:'DM Mono',monospace">${r.pibNo||'—'}</td>
      <td style="padding:4px 6px;border-bottom:1px solid var(--border)">${r.pibDate||'—'}</td>
      <td style="padding:4px 6px;border-bottom:1px solid var(--border)">${r.countryOrigin||'—'}</td>
    </tr>
  `).join('');
  wrap.style.display = 'block';
}

function resetRealizParsed() {
  _realizParsed = null;
  ['realizParsedSummary','realizPreviewWrap'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  const inp = document.getElementById('realizFileInput');
  if (inp) inp.value = '';
}

/* ── Confirm bulk import ─────────────────────────────────────────── */
async function confirmRealizationImport() {
  if (!_realizParsed) return;
  const code = document.getElementById('realizCompanyPick').value;
  if (!code) { showToast('Pick a company first', 'error'); return; }

  const btn = document.getElementById('realizConfirmBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  try {
    const res = await fetch('/api/realizations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        companyCode: code,
        source: 'excel',
        sourceFile: _realizParsed.sourceFile,
        importedBy: (typeof currentRole === 'function' ? currentRole() : '') || 'Operations',
        rows: _realizParsed.rows,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    const data = await res.json();
    showToast(`Imported ${data.inserted} row(s) for ${code}`, 'success');
    resetRealizParsed();
    setRealizTab('list', document.getElementById('realizTabList'));
  } catch (err) {
    notifySaveError('realization import', err);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '💾 Save to Database'; }
  }
}

/* ── Manual entry submit ─────────────────────────────────────────── */
async function submitRealizationManual() {
  const code = document.getElementById('realizCompanyPick').value;
  if (!code) { showToast('Pick a company first', 'error'); return; }
  const form = document.getElementById('realizManualForm');
  const fd = new FormData(form);
  const row = {};
  fd.forEach((v, k) => { row[k] = v; });
  // Coerce numerics
  ['lineNo','volume','valueUSD','unitPrice','kurs'].forEach(k => {
    if (row[k] !== '' && row[k] != null) row[k] = Number(row[k]);
    else delete row[k];
  });
  // Auto-resolve product from HS if user didn't pick one
  if (!row.product && row.hsCode) row.product = realizProductFromHS(row.hsCode);

  if (!row.pibNo) { showToast('PIB No is required', 'error'); return; }

  try {
    const res = await fetch('/api/realizations/single', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        companyCode: code,
        importedBy: (typeof currentRole === 'function' ? currentRole() : '') || 'Operations',
        ...row,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    showToast('Realization saved', 'success');
    form.reset();
  } catch (err) {
    notifySaveError('realization manual entry', err);
  }
}

/* ── List view ───────────────────────────────────────────────────── */
async function loadRealizationsList() {
  const code = document.getElementById('realizCompanyPick').value;
  const body = document.getElementById('realizListBody');
  if (!body) return;
  if (!code) {
    body.innerHTML = `<tr><td colspan="9" style="padding:18px;text-align:center;color:var(--txt3)">Pick a company to see records</td></tr>`;
    return;
  }
  body.innerHTML = `<tr><td colspan="9" style="padding:18px;text-align:center;color:var(--txt3)">Loading…</td></tr>`;
  try {
    const res = await fetch(`/api/realizations?company_code=${encodeURIComponent(code)}`);
    const data = await res.json();
    const rows = data.realizations || [];
    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="9" style="padding:18px;text-align:center;color:var(--txt3)">No realizations yet for ${code}</td></tr>`;
      return;
    }
    body.innerHTML = rows.map(r => `
      <tr>
        <td style="padding:5px 8px;border-bottom:1px solid var(--border);font-family:'DM Mono',monospace">${r.pib_no||'—'}</td>
        <td style="padding:5px 8px;border-bottom:1px solid var(--border)">${r.line_no||1}</td>
        <td style="padding:5px 8px;border-bottom:1px solid var(--border);font-family:'DM Mono',monospace">${r.hs_code||'—'}</td>
        <td style="padding:5px 8px;border-bottom:1px solid var(--border);font-weight:600">${r.product||'—'}</td>
        <td style="padding:5px 8px;border-bottom:1px solid var(--border);text-align:right;font-family:'DM Mono',monospace">${r.volume!=null?Number(r.volume).toLocaleString(undefined,{maximumFractionDigits:3}):'—'}</td>
        <td style="padding:5px 8px;border-bottom:1px solid var(--border);text-align:right;font-family:'DM Mono',monospace">${r.value_usd!=null?Number(r.value_usd).toLocaleString():'—'}</td>
        <td style="padding:5px 8px;border-bottom:1px solid var(--border)">${r.pib_date||'—'}</td>
        <td style="padding:5px 8px;border-bottom:1px solid var(--border)"><span style="font-size:9.5px;font-weight:700;padding:2px 6px;border-radius:3px;background:${r.source==='excel'?'var(--blue-bg)':'var(--green-bg)'};color:${r.source==='excel'?'var(--blue)':'var(--green)'};border:1px solid ${r.source==='excel'?'var(--blue-bd)':'var(--green-bd)'}">${(r.source||'manual').toUpperCase()}</span></td>
        <td style="padding:5px 8px;border-bottom:1px solid var(--border);text-align:right">
          <button onclick="deleteRealization(${r.id})" title="Delete this row" style="background:var(--red-bg);color:var(--red2);border:1px solid var(--red-bd);border-radius:4px;padding:2px 8px;font-size:10px;cursor:pointer">Delete</button>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    body.innerHTML = `<tr><td colspan="9" style="padding:18px;text-align:center;color:var(--red2)">Load failed: ${err.message||err}</td></tr>`;
  }
}

async function deleteRealization(id) {
  if (!confirm('Delete this realization row?')) return;
  try {
    const res = await fetch(`/api/realizations/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    showToast('Deleted', 'success');
    loadRealizationsList();
  } catch (err) {
    notifySaveError('realization delete', err);
  }
}
