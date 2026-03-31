/* ═══════════════════════════════════════
   LOCAL STORAGE — Save / Load / Status
═══════════════════════════════════════ */

const LS_KEY = 'quotaDashboard_v1';

/** Fields that can change at runtime and should be persisted */
const RA_MUTABLE  = ['berat','realPct','utilPct','cargoArrived','arrivalDate',
                     'etaJKT','pibReleaseDate','reapplyEst','reapplySubmitted','target'];
const SPI_MUTABLE = ['spiRef','remarks','revType','revStatus','revNote','statusUpdate',
                     'salesRevRequest','spiNo','pertekNo','updatedBy','updatedDate',
                     'utilizationMT','availableQuota','shipments','reapplyTargets'];

/** Serialize current state → localStorage */
function saveToStorage() {
  const snap = {
    ts: new Date().toISOString(),
    ra: {},
    spi: {}
  };
  RA.forEach(r => {
    const obj = {};
    RA_MUTABLE.forEach(k => { if (r[k] !== undefined) obj[k] = r[k]; });
    snap.ra[r.code] = obj;
  });
  SPI.forEach(s => {
    const obj = {};
    SPI_MUTABLE.forEach(k => { if (s[k] !== undefined) obj[k] = s[k]; });
    snap.spi[s.code] = obj;
  });
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(snap));
    return snap.ts;
  } catch(e) {
    console.warn('localStorage save failed:', e);
    return null;
  }
}

/** Load persisted state → merge into RA / SPI arrays */
function loadFromStorage() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const snap = JSON.parse(raw);
    // Merge RA
    if (snap.ra) {
      RA.forEach(r => {
        const saved = snap.ra[r.code];
        if (!saved) return;
        RA_MUTABLE.forEach(k => { if (saved[k] !== undefined) r[k] = saved[k]; });
      });
    }
    // Merge SPI
    if (snap.spi) {
      SPI.forEach(s => {
        const saved = snap.spi[s.code];
        if (!saved) return;
        SPI_MUTABLE.forEach(k => { if (saved[k] !== undefined) s[k] = saved[k]; });
      });
    }
    return snap.ts;
  } catch(e) {
    console.warn('localStorage load failed:', e);
    return null;
  }
}

/** Clear all saved data */
function clearStorage() {
  try { localStorage.removeItem(LS_KEY); } catch(e) {}
}

/** Show a brief save confirmation toast */
function showSaveToast(ts) {
  let toast = document.getElementById('saveToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'saveToast';
    toast.style.cssText = 'position:fixed;bottom:80px;right:22px;background:var(--green);color:#fff;' +
      'font-size:12px;font-weight:600;padding:8px 16px;border-radius:var(--r);box-shadow:var(--sh2);' +
      'z-index:1100;opacity:0;transition:opacity .25s;pointer-events:none';
    document.body.appendChild(toast);
  }
  const d = ts ? new Date(ts) : new Date();
  toast.textContent = '✅ Saved — ' + d.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
  toast.style.opacity = '1';
  setTimeout(() => { toast.style.opacity = '0'; }, 2500);
}

/** Manual Save button handler — saves and updates status display */
function manualSave() {
  const ts = saveToStorage();
  showSaveToast(ts);
  updateStorageStatus();
}

/** Reset All button handler — clears storage and reloads */
function confirmReset() {
  if (confirm('Reset all saved edits and reload from original data?\n\nThis cannot be undone.')) {
    clearStorage();
    location.reload();
  }
}

/** Update the storage status panel inside the Manage tab */
function updateStorageStatus() {
  const el = document.getElementById('storageStatus');
  if (!el) return;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) {
      el.innerHTML = '<span style="color:var(--txt3)">⚪ No saved data yet — changes will be lost on refresh until you save.</span>';
      return;
    }
    const snap = JSON.parse(raw);
    const ts = snap.ts ? new Date(snap.ts).toLocaleString('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}) : 'unknown';
    const raCodes = Object.keys(snap.ra || {}).join(', ') || '—';
    el.innerHTML = `<span style="color:var(--green);font-weight:700">💾 Data saved</span> · Last saved: <strong>${ts}</strong><br>
      <span style="color:var(--txt3);font-size:10.5px">Companies with saved state: ${raCodes}</span>`;
  } catch(e) {
    el.innerHTML = '<span style="color:var(--red)">⚠ Could not read storage status.</span>';
  }
}

/* ══════════════════════════════════════════════════
   OBTAIN (MT) vs UTILIZATION (MT) — CHART ENGINE
   Lead Time Standard: 14 days
   Lead Time = PERTEK Obtained Date → First Utilization Entry Date
   Status: Normal (≤14d) | Overdue/Revision (>14d or no util within 14d)
══════════════════════════════════════════════════ */

/* ── Centralized OU product color palette (management-friendly) ── */