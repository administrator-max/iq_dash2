# Phase 4 — Execute β-1 (with KPI_RECONCILE pre-audit)

> Rekomendasi β-1 di Phase 3.3 part 2 saya approve. Tapi sebelum eksekusi, ada satu langkah audit prep yang krusial — penemuan KPI_RECONCILE hardcoded di server.js itu red flag. Saya butuh konfirmasi cakupan dulu sebelum touch code.

---

## STEP 0 — KPI_RECONCILE pre-audit (read-only, STOP setelah ini)

Audit **SEMUA entries** di `KPI_RECONCILE` (`server.js`) terhadap master file. Output yang saya harapkan:

```
Company | KPI_RECONCILE entry             | Master (util / avail per product)  | Match?
--------|--------------------------------|-----------------------------------|-------
SMS     | {util:150, avail:0}            | SHEETPILE util:0 / avail:150      | ✗ stale
... (semua entries lainnya)
```

Sebutkan eksplisit:
- Berapa total entry di KPI_RECONCILE
- Berapa yang match master, berapa yang diverge
- Untuk yang diverge: dampak per produk (mis. "GKL entry stale → ERW Pipe util 79 should be 92, +13 MT")
- Apakah ada entry yang merujuk perusahaan yang **tidak ada di master sama sekali** (orphan)

**STOP setelah ini. Kirim audit table ke chat. Tunggu GO saya untuk lanjut.**

Kalau audit menemukan >1 stale entry, scope Phase 4 berubah dan kita perlu diskusi prioritas dulu. Kalau cuma SMS, lanjut Step 1.

---

## STEP 1 — Backup (setelah saya GO)

```bash
# Timestamp-based backup, simpan ke iq_dash/backups/ (gitignore'd or add to gitignore)
mkdir -p backups
TS=$(date -u +%Y%m%dT%H%M%SZ)
pg_dump -t company_product_stats -t revision_changes \
  -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE" \
  > "backups/pre_beta1_${TS}.sql"
```

Plus dump specific rows (GAS revision_changes + SMS company_product_stats) sebagai sanity reference dalam file terpisah. Print row counts + first lines untuk konfirmasi backup berhasil.

---

## STEP 2 — Branch baru + atomic code changes (satu commit)

`git checkout -b fix/master-import-quota-aggregation` (jangan reuse `fix/quota-aggregation-crosscheck` — opsi β-1 cukup different dari Phase 2 patch sehingga ganti branch lebih clean).

Edit dalam satu commit (atomic, supaya code state selalu konsisten):

1. **New file `importMasterStats.js`** di root:
   - Parse `master_data_120526.xlsx` (path env-overridable, default to root)
   - Per company: hitung utilization_mt + available_mt per produk dari Utilization + Available rows di master
   - UPSERT ke `company_product_stats` dalam satu `BEGIN…COMMIT`
   - Dry-run mode (default): print before/after SELECT, JANGAN COMMIT
   - Live mode (`--apply`): COMMIT
   - ROLLBACK on error
   - Print row count + delta summary per produk

2. **`server.js`**: update KPI_RECONCILE entry untuk SMS (dan entry lain yang ditemukan stale di Step 0, kalau saya approve scope-nya). Update comment total `16,500.5 → 16,350.5`.

3. **`public/js/01-data.js`**:
   - Refactor `getObtainedByProdAgg(co)`: replace revision_changes balanced-only block dengan `obtainedByProd[p] = Number(util[p] || 0) + Number(avail[p] || 0)` per produk, sourced dari `company_product_stats` yang ada di payload.
   - `availableByProd` derivation tetap (Σ obtained_net − util) — atau, lebih simpel, langsung `availableByProd[p] = Number(avail[p] || 0)` karena sekarang stats itu authoritative.
   - Update komentar HEURISTIC sebelumnya — ganti penjelasan jadi: "Per-product net = utilization + available from company_product_stats, sourced from master file via importMasterStats.js. revision_changes no longer used by aggregator (UI dependency only, see 08-drawer.js + 13-rev-mgmt.js)."

4. **`public/index.html`**: bump `01-data.js?v=14` → `?v=16` (skip 15 karena Phase 2 patch tidak di-deploy).

Commit message contoh: `fix(quota): import util+avail from master, simplify aggregator (β-1)`

---

## STEP 3 — GAS revision_changes fix (separate txn, after Step 2 committed)

Dry-run dulu:
```sql
-- BEFORE
SELECT id, direction, product, mt FROM revision_changes
WHERE company_code = 'GAS' ORDER BY id;
```

Eksekusi (transaction):
```sql
BEGIN;
-- DELETE 2 stale 'to' rows
DELETE FROM revision_changes
WHERE company_code = 'GAS' AND direction = 'to' AND product IN ('BORDES ALLOY','AS STEEL');
-- INSERT correct 'to' row
INSERT INTO revision_changes (company_code, direction, product, mt, label, sort_order)
VALUES ('GAS', 'to', 'GI BORON', 200, '', 0);
-- AFTER check
SELECT id, direction, product, mt FROM revision_changes
WHERE company_code = 'GAS' ORDER BY id;
-- inspect output, then either COMMIT or ROLLBACK
```

Print row counts before COMMIT. Pause for my confirmation di chat sebelum execute COMMIT.

---

## STEP 4 — Stats refresh dari master

```bash
node importMasterStats.js                 # dry-run first
# inspect dry-run output (~50 rows affected, SMS sheetpile util 150→0 etc.)
node importMasterStats.js --apply         # commit setelah saya OK
```

Print delta summary: berapa row changed, mana yang material (Sheet Pile SMS 150→0, dan lainnya kalau ada).

---

## STEP 5 — Cache flush + server restart

```bash
redis-cli -u "$REDIS_URL" DEL iq:data:v1
redis-cli -u "$REDIS_URL" DEL iq:realizations:summary:v1
# atau, kalau ada banyak: redis-cli ... --scan --pattern 'iq:*' | xargs redis-cli DEL
```

Restart server (Procfile: `web: node server.js`). Confirm log shows `[cache] redis connected` + `✅ DB schema ready`.

---

## STEP 6 — Verification

Re-run crosscheck script (yang sudah dipakai di Phase 3.1) dan output table baru:

| Product | DB (after β-1) | Master | Δ |
|---|--:|--:|--:|
| Sheet Pile | ? | 7,350 / 4,025 / 3,325 | should = 0 |
| (semua 10 produk) | ... | | should = 0 |

Plus spot-check via API:
```bash
curl -s http://localhost:3000/api/data | jq '.spi[] | select(.code=="GAS") | {code, revFrom, revTo, obtainedByProd, availableByProd}'
```
Expected: GAS `revTo` = `{GI BORON: 200}`, obtainedByProd = `{GI BORON: 200}`, availableByProd = `{GI BORON: 0}`.

Plus spot-check drawer rendering manually di browser untuk GAS dan SMS.

---

## STEP 7 — Report

Kirim ke chat:
1. `git diff` final dari commit di Step 2
2. Tabel verifikasi 10 produk + master
3. Sample GAS API response
4. Confirmation cache flush + restart sukses

Setelah saya review dan OK, baru merge ke main.

---

## BATASAN

- Step 0 **read-only saja**. STOP setelah audit, tunggu GO.
- Step 1–7 baru jalan setelah saya GO.
- Setiap DB write dalam transaksi dengan ROLLBACK on error.
- Branch baru, JANGAN delete `fix/quota-aggregation-crosscheck` (arsip Phase 2 patch).
- JANGAN sentuh file Excel master.

Mulai dari Step 0.
