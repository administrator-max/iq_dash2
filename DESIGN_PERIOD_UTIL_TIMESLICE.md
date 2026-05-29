# DESIGN — Period-sliced per-product Utilization (NOT YET IMPLEMENTED)

Status: **design only** (requested 2026-05-29). Do not execute without sign-off — this
reverses the β-1 decision that the per-product aggregator reads `company_product_stats`
(util+avail) and never recomputes (see memory `project_quota_aggregation.md`).

## Goal
Make the period filter slice per-product **utilization** MT by date, the same way the PIB
realization detail now slices by `pib_date` (see `08-drawer.js openRealizationDetail`).
Today util/avail come from `company_product_stats` — a master snapshot with **no date
column** — so the filter can only include/exclude whole companies, never slice MT.

## Data reality (audit 2026-05-29)
- `company_shipments` lot `util_mt` is a faithful mirror of util: Σlots per company ≈
  `company_product_stats.utilization_mt` (total 17,810 vs 17,806; max per-co diff −3 MT).
- **BUT only 24/62 lots have `pib_date`.** 24 lots carrying **7,779 MT (~44% of util)** are
  undated, including 9 "Baseline — Excel reconciliation" lots (no real shipment detail).
- Slicing util by `pib_date` *today* would silently drop that 44% from any active period.
- `eta_jkt` exists on some undated lots but is free-text ("Jun 2026", "15 Juni 26") — needs
  `parseETA`/`fmtDateStd` tolerant parsing; lower confidence than `pib_date`.

## Prerequisite (blocking)
Backfill `pib_date` on the 24 undated util lots (list produced in the audit). Until then,
any time-slice is an undercount. Baseline reconciliation lots have no real date by nature →
see "undated handling" below.

## Proposed model
New client helper (parallel to `getObtainedByProdAgg`), used ONLY when `PERIOD.active`:

```
getUtilByProdInPeriod(co):
  result = {}
  for each product p, for each lot in co.shipments[p]:
     d = pDate(lot.pibDate) || parseETA(lot.etaJKT)   // pib first, eta fallback
     if UNDATED_POLICY applies (see below) OR inPd(d):
        result[canonicalProduct(p)] += lot.utilMT
  return result
```

- When `!PERIOD.active`: keep using `company_product_stats` util (unchanged, β-1 path).
- When `PERIOD.active`: cards/charts/AVQ use `getUtilByProdInPeriod`. Available becomes
  `obtained − util_in_period` (obtained itself stays stats-based / cycle-based).

### Undated-lot handling (pick one — needs user decision)
1. **Always-in-period** — undated/baseline lots count in every period. Safest for totals
   (no MT vanishes) but means "Jan 2026" still shows baseline MT. Recommended default.
2. **Excluded** — undated lots drop out when a period is active. Honest "only dated
   shipments" view, but undercounts by up to 44%. Needs a visible "X MT undated hidden" note.
3. **eta fallback then exclude** — try `pib_date`→`eta_jkt`; only truly date-less lots drop.

## Where it plugs in (client)
`19-init.js`: `buildAvqProdGrid`, `buildAvqProdChart`, `openProdCoPopup`, `buildAvqTable`
currently read `co.utilizationByProd` (stats). Swap to a resolver:
`const up = PERIOD.active ? getUtilByProdInPeriod(co) : (co.utilizationByProd||{})`.
Same swap anywhere per-product util is summed (`03-kpis` AVQ drill, `17-ou-chart`).
Company-level KPI util (`updateOverviewKPIs` totalUtilizedMT) would derive from the same
helper for consistency.

## Server vs client
Keep it **client-side** (shipments are already in the `/api/data` payload as
`co.shipments`). No schema change, no new endpoint. `company_product_stats` stays the
all-time source of truth; the dated path is a period-active overlay only.

## Risks / rollback
- Reverses β-1 → per-product numbers can diverge from the master snapshot when a period is
  active. Must be clearly labelled in-UI ("period-sliced by PIB date").
- Free-text `eta_jkt` parsing is fragile — gate behind option 3 only if backfill is partial.
- Rollback = delete the helper + restore the stats reads (one resolver line per call site).

## Recommended sequence
1. Backfill `pib_date` on the 24 undated lots (data entry).
2. Implement `getUtilByProdInPeriod` with undated-policy = **always-in-period** (option 1).
3. Swap the 5–6 per-product util read sites behind a `PERIOD.active` resolver.
4. Add the in-UI "period-sliced by PIB date" label + undated-MT note.
5. Verify Σ(period=All) per product == current stats values (regression guard).
