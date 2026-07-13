# PERTEK Perubahan Release-Date Gate — Design

**Date:** 2026-07-13
**Project:** iq_dash (Import Quota Monitor)
**Status:** Draft for review

## Problem

When a company's PERTEK (import permit) is being revised — a product split such as
PT MIN's **Wear Plate 600 MT → Wear Plate 246.80 MT + GI Alloy 353.20 MT** — the
dashboard already shows the *revised* split even though the revision is not yet
official. A revision only becomes official once its **PERTEK Perubahan release
(terbit) date** is entered. Until then the dashboard must keep showing the
**original PERTEK** and must NOT count the new product.

Concretely today: the "Available Quota — GI Alloy" breakdown lists **MIN with
353 MT obtained**, inflating GI Alloy's totals. It should instead show MIN under
its original product (Wear Plate) at the original quantity, and MIN should not
appear under GI Alloy at all — until the release date is entered.

This must apply to **all companies**, not only MIN.

## Root cause

`lib/quotaLedger.json` is the single source of truth for Obtained / Utilized /
Available (see `MEMORY.md` → `project_quota_ledger`). It is built by
`buildQuotaLedger.js`, which sums `Obtained #N + Revision #N` per HS code into an
**"effective (obtained incl. revisions)"** view (`_meta.view`) — it applies every
revision unconditionally and **drops the release-date / status column entirely**.

So the ledger has no way to know a revision is still pending. `server.js`
`applyLedger()` (~line 1199) then overrides the cycles/stats numbers with this
already-revised ledger, and every downstream KPI and the Available-Quota drill
(`public/js/03-kpis.js:414`) shows the split.

The cycles model *does* track pending vs released per revision, but that signal is
too unreliable to drive the gate: `revFrom`/`revTo` (from `revision_changes`)
reflect only seed/import data — the live "terbit" UI never writes that table — and
revision cycles store the PERTEK/SPI *number string* in `releaseDate`, not a date.
Therefore the gate needs its own explicit, auditable source, consistent with the
"ledger is a committed file" governance of this project.

## Design

### Overview

Add a **reversal gate** on top of the ledger. A committed list declares each
in-progress split (from-product, to-product, MT). At read time, `applyLedger`
reverses any split whose release date has not been entered — moving the MT back to
the original product, restoring the original PERTEK. Once the release date is
entered (persisted to a durable store, since Heroku's filesystem is ephemeral),
the reversal stops and the revised split shows exactly as it does today.

The reversal is **safe by construction**: only companies explicitly listed are
ever touched. An incomplete list just leaves the pre-existing (current) behavior
for the omitted companies — it never corrupts a company that isn't listed.

### Component 1 — Gate definitions: `lib/pendingRevisions.json` (committed)

Static, human-reviewed reversal math. One record per pending split:

```jsonc
{
  "MIN": {
    "from": "BORDES ALLOY",   // Wear Plate  · HS 7225.40.90
    "to":   "GI ALLOY",       //             · HS 7225.92.90
    "mt":   353               // MT to move back to `from` while pending
  }
  // ...other confirmed-pending companies (see "Pending company list" below)
}
```

- `from` / `to` are canonical ledger product names (must match
  `quotaLedger.json.products` values, e.g. `"BORDES ALLOY"`, `"GI ALLOY"`).
- `mt` is the whole-MT amount that moved from `from` to `to` in the revision
  (for MIN: the ledger has BORDES 247 + GI 353; `mt` = 353 restores BORDES to
  600). Util on the `to` side is expected to be 0 while pending; the reversal
  asserts this and logs a warning if not.

### Component 2 — Durable release-date store

Because Heroku dynos have an ephemeral filesystem, the release date entered via
the UI cannot live in the committed JSON. Store it in the existing durable
backend used by the app:

- **Postgres:** new table
  `pertek_perubahan_release (code TEXT PRIMARY KEY, release_date TEXT NOT NULL, updated_at TIMESTAMPTZ DEFAULT now())`.
- **Sheets tracking DB:** mirror tab `Pertek_Perubahan_Release` with columns
  `code | release_date | updated_at` (same read/write pattern as other tabs).

`server.js` loads this into a `releasedMap { code -> release_date }` during
`_buildDataPayload`. A `pendingRevisions.json` entry is considered **released**
(no reversal) iff `releasedMap[code]` is a non-empty date.

Once a split is permanently released and the master/ledger is rebuilt, the entry
is removed from `pendingRevisions.json` in a follow-up commit; the release-date
row can be left in place (harmless) or cleaned up.

### Component 3 — Reversal in `applyLedger` (`server.js`)

Inside `applyLedger(co, ent)`, after building `obtByProd` / `utilByProd` /
`availByProd`, apply reversal when the company has a pending, not-yet-released
entry:

```
def reverse(co):
  rev = pendingRevisions[co.code]
  if not rev: return
  if releasedMap[co.code] is a non-empty date: return   # released → show split
  from, to, mt = rev.from, rev.to, rev.mt
  # guard: `to` should be fully available (util 0) while pending
  if utilByProd[to] > 0: log warning, skip reversal (data inconsistent)
  # move MT back to `from`
  obtByProd[from]  += mt ; availByProd[from] += mt
  obtByProd[to]    -= mt ; availByProd[to]   -= mt
  if obtByProd[to] <= 0: delete obtByProd[to], utilByProd[to], availByProd[to]
  recompute co.obtained, co.utilizationMT, co.availableQuota, co.products,
            co._ledgerObtained, co._ledgerObtainedByProd from the maps
```

This runs for every company (SPI rows and synthesized ledger-only rows like IKM),
so the rule is uniform. All existing consumers (`canonicalObtained`,
`getObtainedByProdAgg`, the Available-Quota drill, the OU chart) read the adjusted
maps and totals with no client changes required for the numbers.

**MIN result after reversal:** BORDES ALLOY obtained 600 / util 247 / avail 353;
no GI ALLOY entry. GI Alloy's product-level total drops by 353 and MIN disappears
from the GI Alloy drill.

### Component 4 — Dashboard UI to enter the release date

On the company's revision panel (`public/js/13-rev-mgmt.js`), where a pending
company is already flagged "Menunggu PERTEK Perubahan", add:

- A read-only banner: "PERTEK Perubahan belum terbit — menampilkan PERTEK asal
  ({from} {origMT} MT)".
- A **"Tanggal Terbit PERTEK Perubahan"** date input + **Simpan** button →
  `POST /api/company/:code/pertek-perubahan-release` with `{ releaseDate }`.

The endpoint writes `releasedMap[code] = releaseDate` to the durable store,
invalidates the `/api/data` cache, and returns the updated company. On the next
data build the reversal for that company stops and the revised split shows. The
button only appears for companies present in `pendingRevisions.json` and not yet
released. (This deliberately does not entangle with the existing tangled
`rrMarkApproved` cycle-date write path.)

### Pending company list

**Decision (2026-07-13): seed `pendingRevisions.json` with `MIN` only.**

```jsonc
{ "MIN": { "from": "BORDES ALLOY", "to": "GI ALLOY", "mt": 353 } }
```

The mechanism is general: additional companies are added at any time by appending
a record to `lib/pendingRevisions.json` (and are un-gated by entering their release
date via the UI). Ledger-fingerprint candidates exist (SPA 401, BDG 350, SGD 500,
BHG 200, SMS 150; IKM 4150 is likely an *original* GI Alloy PERTEK, not a
Perubahan) but were **not** confirmed as genuinely pending, so they are excluded —
adding an already-released company would wrongly reverse its numbers. They get
added later as each is confirmed with its correct `from` product and `mt`.

## Error handling & edge cases

- **Company listed but absent from ledger:** skip (nothing to reverse), log info.
- **`to` product missing from ledger entry:** skip, log warning (definition stale).
- **`to` has util > 0 while pending:** skip reversal, log warning — indicates the
  split was already partly utilized (should not happen if truly pending); avoids
  producing negative available.
- **`mt` larger than `to` obtained:** clamp to `to` obtained, log warning.
- **Release date present but empty string / "TBA":** treated as NOT released.
- **Idempotency:** reversal is a pure function of ledger + definitions + release
  map, recomputed each build; no accumulation.

## Testing

- **Unit (reversal function):** MIN fixture (BORDES 247/247 + GI 353/0) →
  BORDES 600/247/353, no GI. Released MIN (release date set) → unchanged split.
  Guard cases: util>0 on `to`, missing `to`, mt>obtained, company not in ledger.
- **Integration (`/api/data`):** with MIN pending, GI Alloy product total is
  reduced by 353 and MIN not in GI Alloy breakdown; MIN under BORDES at 600.
  After `POST /pertek-perubahan-release`, MIN reappears under GI Alloy at 353.
- **Endpoint:** POST persists to durable store, invalidates cache, is idempotent.
- **Totals sanity:** company `obtained = Σ obtByProd`, `available = obtained −
  util`, no negative values, for every company after reversal.
- **Manual verification:** load the dashboard, open Available Quota → GI Alloy,
  confirm MIN gone and totals reduced by 353; enter a release date for MIN, refresh,
  confirm MIN returns at 353.

## Out of scope

- Rebuilding/reworking `buildQuotaLedger.js` to carry dates (the reversal gate
  sits on top of the existing ledger instead).
- Changing the existing `rrMarkApproved` / cycles date-write path.
- Auto-detecting pending revisions from cycles/`revision_changes` (unreliable;
  the explicit committed list is the source of truth).

## Governance

Per `iq_dash/CLAUDE.md`: on deploy, append an entry to
`logs/2026-07-13_log.md` (what changed, files/tabs, commit + Heroku version,
reason, verification). Update `MEMORY.md` with a pointer to the new gate mechanism
and its relationship to `project_quota_ledger`.
