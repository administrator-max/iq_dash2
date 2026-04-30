/* ═══════════════════════════════════════
   LOCAL STORAGE — Pending-sync buffer ONLY
   ─────────────────────────────────────────────────────
   Per request 30-Apr-2026: this is a multi-user dashboard. The database
   is the single source of truth. localStorage is no longer merged into
   the display (the old `loadFromStorage` overlay is gone). Its sole
   role now is to buffer changes that have not yet been synced to the
   server — e.g. when a save fails because the DB was offline. On the
   next page load, `migrateLocalToServer()` pushes any buffered entries
   to the server (with optimistic-concurrency validation), then clears
   them. After every successful patch, the matching entry is removed
   via `clearStorageForCode()` so we never overwrite newer DB data.
═══════════════════════════════════════ */

const LS_KEY = 'quotaDashboard_v1';

/** Fields that can change at runtime and should be persisted */
const RA_MUTABLE  = ['berat','realPct','utilPct','cargoArrived','arrivalDate',
                     'etaJKT','pibReleaseDate','reapplyEst','reapplySubmitted','target'];
const SPI_MUTABLE = ['spiRef','remarks','revType','revStatus','revNote','statusUpdate',
                     'salesRevRequest','spiNo','pertekNo','spiDate','pertekDate','updatedBy','updatedDate',
                     'utilizationMT','availableQuota','shipments','reapplyTargets'];

/** Serialize current state → localStorage (offline-resilient buffer between
    user input and server sync — NOT a display source). */
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

/** Read raw snapshot WITHOUT merging into globals. Returns null if empty. */
function readStorageSnapshot() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch(e) {
    console.warn('localStorage read failed:', e);
    return null;
  }
}

/** Backward-compat alias: legacy callers may still invoke loadFromStorage().
    It is now a NO-OP that does NOT touch SPI/RA. The display always comes
    from /api/data; pending local edits are only pushed via
    migrateLocalToServer() on boot, never merged into globals. */
function loadFromStorage() {
  const snap = readStorageSnapshot();
  return snap && snap.ts ? snap.ts : null;
}

/** Clear all saved data */
function clearStorage() {
  try { localStorage.removeItem(LS_KEY); } catch(e) {}
}

/** Remove a single company's buffered entry (called after a successful
    patch so we don't accidentally re-push stale data on next boot). */
function clearStorageForCode(code) {
  if (!code) return;
  try {
    const snap = readStorageSnapshot();
    if (!snap) return;
    let touched = false;
    if (snap.ra && snap.ra[code]) { delete snap.ra[code]; touched = true; }
    if (snap.spi && snap.spi[code]) { delete snap.spi[code]; touched = true; }
    if (!touched) return;
    const empty = (!snap.ra || !Object.keys(snap.ra).length) &&
                  (!snap.spi || !Object.keys(snap.spi).length);
    if (empty) {
      localStorage.removeItem(LS_KEY);
    } else {
      snap.ts = new Date().toISOString();
      localStorage.setItem(LS_KEY, JSON.stringify(snap));
    }
  } catch(e) {
    console.warn('clearStorageForCode failed:', e);
  }
}

/** migrateLocalToServer — boot-time push of buffered local changes to DB.
    Logic:
      1. Read localStorage snapshot
      2. For each company entry, COMPARE local snap.ts vs the company's
         _updatedAt token from the freshly-fetched server data
         - If DB ≥ local → discard local (DB wins; data is stale)
         - If local > DB → apply onto in-memory co + push via patchToServer
      3. Clear pushed/stale entries; keep only entries that hit a network
         error so they retry on the next boot.
    Returns { pushed, discardedStale, conflicts, failed }. */
async function migrateLocalToServer() {
  const snap = readStorageSnapshot();
  if (!snap || (!snap.ra && !snap.spi)) {
    return { pushed: 0, discardedStale: 0, conflicts: 0, failed: 0 };
  }

  const codes = new Set([
    ...Object.keys(snap.spi || {}),
    ...Object.keys(snap.ra  || {}),
  ]);
  const localTs = snap.ts ? new Date(snap.ts).getTime() : 0;
  let pushed = 0, discardedStale = 0, conflicts = 0, failed = 0;
  const failedCodes = new Set();

  for (const code of codes) {
    const co = (typeof getSPI === 'function' ? getSPI(code) : null) ||
               (typeof PENDING !== 'undefined' ? PENDING.find(p => p.code === code) : null);
    if (!co) { discardedStale++; continue; }

    // Only push if user's local snapshot is strictly newer than DB.
    // 1-second tolerance for clock drift.
    const dbTs = co._updatedAt ? new Date(co._updatedAt).getTime() : 0;
    if (localTs - dbTs <= 1000) {
      discardedStale++;
      continue;
    }

    // Apply localStorage fields onto the in-memory company so
    // patchToServer sends the user's pending edits.
    const savedSpi = snap.spi && snap.spi[code];
    if (savedSpi) {
      SPI_MUTABLE.forEach(k => {
        if (savedSpi[k] !== undefined) co[k] = savedSpi[k];
      });
    }
    const savedRa = snap.ra && snap.ra[code];
    if (savedRa && typeof RA !== 'undefined') {
      const r = RA.find(x => x.code === code);
      if (r) RA_MUTABLE.forEach(k => {
        if (savedRa[k] !== undefined) r[k] = savedRa[k];
      });
    }

    try {
      await patchToServer(co);
      pushed++;
    } catch (e) {
      const msg = (e && e.message) || String(e);
      if (/HTTP\s*409|conflict|diubah pengguna lain/i.test(msg)) {
        conflicts++;
      } else {
        failed++;
        failedCodes.add(code);
      }
    }
  }

  // Clear localStorage for pushed + discarded + conflict entries.
  // Keep only entries with a real network failure so they retry.
  if (failedCodes.size === 0) {
    clearStorage();
  } else {
    const filtered = { ts: new Date().toISOString(), ra: {}, spi: {} };
    failedCodes.forEach(c => {
      if (snap.ra && snap.ra[c])  filtered.ra[c]  = snap.ra[c];
      if (snap.spi && snap.spi[c]) filtered.spi[c] = snap.spi[c];
    });
    try { localStorage.setItem(LS_KEY, JSON.stringify(filtered)); } catch (_) {}
  }

  return { pushed, discardedStale, conflicts, failed };
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
/* ══════════════════════════════════════════════════
   SERVER PERSISTENCE — PATCH /api/company/:code
   Called after every saveEdit() to persist data
   permanently in PostgreSQL (survives refresh).
══════════════════════════════════════════════════ */

/* fetchWithRetry — retries 502/503/504 (transient Neon/PgBouncer hiccups)
   with exponential backoff up to ~18s total. Useful for Neon cold-starts
   where the first request can take several seconds before the DB instance
   wakes up. 408 (timeout) and network failures also retried.
   4xx other than these are NOT retried. */
async function fetchWithRetry(url, opts, attempts) {
  const RETRYABLE = new Set([408, 429, 502, 503, 504]);
  const BACKOFF = [500, 1500, 3000, 5000, 8000]; // total ≈ 18s across 5 attempts
  const max = attempts != null ? attempts : BACKOFF.length;
  let lastErr;
  for (let i = 0; i < max; i++) {
    try {
      const res = await fetch(url, opts);
      if (res.ok) return res;
      if (i < max - 1 && RETRYABLE.has(res.status)) {
        await new Promise(r => setTimeout(r, BACKOFF[i] || BACKOFF[BACKOFF.length-1]));
        continue;
      }
      return res; // non-retryable — let caller handle .ok=false
    } catch (e) {
      lastErr = e;
      if (i < max - 1) {
        await new Promise(r => setTimeout(r, BACKOFF[i] || BACKOFF[BACKOFF.length-1]));
        continue;
      }
    }
  }
  throw lastErr || new Error('fetchWithRetry: exhausted retries');
}

async function patchToServer(co) {
  if (!co || !co.code) return;

  // Build reapplyTargets array from co.reapplyByProd (or existing reapplyTargets)
  const reapplyTargets = co.reapplyByProd
    ? Object.entries(co.reapplyByProd).map(([product, targetMT]) => ({
        product, targetMT: targetMT || 0, submitted: false, submitDate: '', notes: ''
      }))
    : (co.reapplyTargets || []);

  // Build shipments payload (only lots with actual data)
  const shipPayload = {};
  if (co.shipments) {
    Object.entries(co.shipments).forEach(([prod, lots]) => {
      if (!lots || !lots.length) return;
      shipPayload[prod] = lots.map((l, i) => ({
        lotNo:        l.lotNo  || (i + 1),
        utilMT:       l.utilMT || 0,
        etaJKT:       l.etaJKT || '',
        note:         l.note   || '',
        realMT:       l.realMT || 0,
        pibDate:      l.pibDate || '',
        cargoArrived: l.cargoArrived || false,
      }));
    });
  }

  // Encode salesRevRequest + salesRevReqType into revNote for persistence
  let salesRevJson = null;
  if (co.salesRevRequest && Object.keys(co.salesRevRequest).length) {
    const envelope = Object.assign({}, co.salesRevRequest);
    if (co.salesRevReqType) envelope._revisionType = co.salesRevReqType;
    salesRevJson = JSON.stringify(envelope);
  }

  const body = {
    submit1:       co.submit1       != null ? co.submit1      : null,
    obtained:      co.obtained      != null ? co.obtained     : null,
    revType:       co.revType       || 'none',
    revNote:       salesRevJson || co.revNote || '',
    revSubmitDate: co.revSubmitDate || '',
    revStatus:     co.revStatus     || '',
    revMt:         co.revMT         || 0,
    remarks:       co.remarks       || '',
    spiRef:        co.spiRef        || '',
    statusUpdate:  co.statusUpdate  || '',
    pertekNo:      co.pertekNo      || '',
    spiNo:         co.spiNo         || '',
    utilizationMt: co.utilizationMT || 0,
    availableQuota:co.availableQuota != null ? co.availableQuota : null,
    updatedBy:     co.updatedBy     || '',
    updatedDate:   co.updatedDate   || '',
    shipments:     shipPayload,
    reapplyTargets,
    // Optimistic concurrency token — server rejects 409 if the row was
    // modified server-side after this timestamp (multi-user safety).
    _ifUpdatedAt:  co._updatedAt    || null,
  };

  const res = await fetchWithRetry(`/api/company/${encodeURIComponent(co.code)}`, {
    method:  'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });

  if (res.status === 409) {
    // Stale data — DB has been updated since this user last fetched.
    const err = await res.json().catch(() => ({}));
    const e = new Error(err.error || 'Data telah diubah pengguna lain — silakan refresh.');
    e.status = 409;
    e.currentUpdatedAt = err.currentUpdatedAt;
    throw e;
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  const result = await res.json().catch(() => ({}));
  // Refresh local concurrency token from server response so subsequent
  // saves don't trip the 409 check.
  if (result && result.updatedAt) co._updatedAt = result.updatedAt;
  // Also persist cycles array (Submit #1, Obtained #1, Obtained #2, etc.)
  if (co.cycles && co.cycles.length) {
    await patchCyclesToServer(co);
  }
  // Successful sync — drop this company's pending-buffer entry so it's
  // not re-pushed (potentially overwriting newer DB data) on next boot.
  if (typeof clearStorageForCode === 'function') clearStorageForCode(co.code);
  return result;
}

/* ── Patch cycles array to server (cycles table) ── */
async function patchCyclesToServer(co) {
  if (!co || !co.code || !Array.isArray(co.cycles)) return;
  // Only send cycles that have meaningful data (not empty shells)
  const payload = co.cycles.map(c => ({
    type:        c.type        || '',
    mt:          c.mt          != null ? c.mt : null,
    submitType:  c.submitType  || '',
    submitDate:  c.submitDate  || '',
    releaseType: c.releaseType || '',
    releaseDate: c.releaseDate || '',
    status:      c.status      || '',
    products:    c.products    || {},
    // Include extra date fields that our cycle inline editor writes
    pertekDate:  c.pertekDate  || '',
    spiDate:     c.spiDate     || '',
    _fromRevReq: c._fromRevReq || false,
  }));
  const res = await fetchWithRetry(`/api/company/${encodeURIComponent(co.code)}/cycles`, {
    method:  'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ cycles: payload }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

/* ── Also patch RA record if Operations updated realization ── */
async function patchRAToServer(co, ra) {
  if (!co || !co.code || !ra) return;
  const body = {
    ra: {
      berat:         ra.berat        || 0,
      obtained:      ra.obtained     || co.obtained || 0,
      cargoArrived:  ra.cargoArrived || false,
      realPct:       ra.realPct      || 0,
      utilPct:       ra.utilPct      != null ? ra.utilPct : null,
      arrivalDate:   ra.arrivalDate  || null,
      etaJKT:        ra.etaJKT       || null,
      reapplyEst:    ra.reapplyEst   || null,
      reapplyStage:  ra.reapplyStage || 1,
      reapplySubmitDate: ra.reapplySubmitDate || null,
      reapplyStatus: ra.reapplyStatus || null,
      target:        ra.target       != null ? ra.target : null,
      pertek:        ra.pertek       || null,
      spi:           ra.spi          || null,
      catatan:       ra.catatan      || null,
    }
  };
  await fetchWithRetry(`/api/company/${encodeURIComponent(co.code)}`, {
    method:  'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
}
/* ── nsShowToast: alias for showSaveToast used in 13-rev-mgmt.js ────────────
   nsShowToast is a notification-only toast (no timestamp) — shows a brief
   success/info message from revision management operations.                 */
function nsShowToast(msg) {
  const toast = document.getElementById('saveToast');
  if (!toast) return;
  const prev = toast.innerHTML;
  toast.innerHTML = `<span style="font-size:12px">${msg}</span>`;
  toast.classList.add('show');
  clearTimeout(toast._nsTimer);
  toast._nsTimer = setTimeout(() => {
    toast.classList.remove('show');
    toast.innerHTML = prev;
  }, 2200);
}
