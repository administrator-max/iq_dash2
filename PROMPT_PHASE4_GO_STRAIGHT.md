# Phase 4 — GO Step 1–7 straight through (self-validate, single report)

GO. Audit clean, scope confirmed SMS-only. Eksekusi semua step berikut **tanpa stop di antara**. Validate sendiri pakai pass/fail criteria di Step 7. Lapor sekali di akhir.

---

## Step 1 — Backup
```bash
mkdir -p backups && TS=$(date -u +%Y%m%dT%H%M%SZ)
pg_dump -t company_product_stats -t revision_changes \
  -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE" --no-owner \
  > "backups/pre_beta1_${TS}.sql"
```
Kalau pg_dump tidak ada: fallback `psql -c "COPY (SELECT * FROM company_product_stats) TO STDOUT WITH CSV HEADER" > backups/cps_${TS}.csv` (idem untuk revision_changes). Wajib backup berhasil sebelum lanjut. Print row count + first 3 lines untuk verify.

## Step 2 — Branch + atomic code commit
```bash
git checkout -b fix/master-import-quota-aggregation
```

Edit ATOMIC (satu commit):

**a. New `importMasterStats.js`** — parse master, UPSERT `company_product_stats` (util_mt + available_mt). Wajib:
- Pakai `loadEnvUpwards()` (sama pola dengan importer lain)
- One BEGIN…COMMIT, ROLLBACK on error
- Flags: `--dry-run` (default print only) + `--apply` (commit)
- Output: tabel before/after dengan delta per produk per perusahaan, highlight yang berubah

**b. `server.js` KPI_RECONCILE** — SMS entry: `util:150→0, avail:0→150`. Update total comment `16,500.5 → 16,350.5`.

**c. `public/js/01-data.js`** — refactor `getObtainedByProdAgg`: replace revision_changes balanced-only block dengan langsung baca `company_product_stats`:
```js
// obtainedByProd[p] = util[p] + avail[p]
// availableByProd[p] = avail[p]
```
Update komentar HEURISTIC: `revision_changes` no longer used by aggregator (UI dependency only — 08-drawer.js + 13-rev-mgmt.js).

**d. `public/index.html`** — bump `01-data.js?v=14` → `?v=16`.

Commit: `fix(quota): import util+avail from master, simplify aggregator (β-1)`

## Step 3 — GAS revision_changes fix
```sql
BEGIN;
DELETE FROM revision_changes
 WHERE company_code='GAS' AND direction='to' AND product IN ('BORDES ALLOY','AS STEEL');
INSERT INTO revision_changes (company_code, direction, product, mt, label, sort_order)
VALUES ('GAS','to','GI BORON',200,'',0);
-- self-check: 'to' rows untuk GAS sekarang harus exactly 1 row {GI BORON, 200}
SELECT direction, product, mt FROM revision_changes WHERE company_code='GAS' ORDER BY direction, product;
COMMIT;
```
Self-validate: row count `to` = 1, product='GI BORON', mt=200. Kalau gagal → ROLLBACK + lapor error, jangan lanjut.

## Step 4 — Stats refresh
```bash
node importMasterStats.js --dry-run     # inspect output sendiri
node importMasterStats.js --apply       # commit kalau dry-run wajar
```
Self-validate: SMS Sheet Pile rows util:150→0, avail:0→150. Total rows changed: ~minimal (yang lain seharusnya identik). Kalau ada perubahan tak terduga di luar SMS yang signifikan (>5 MT delta per row), STOP dan lapor sebelum --apply.

## Step 5 — Cache flush + restart
```bash
redis-cli -u "$REDIS_URL" --scan --pattern 'iq:*' | xargs -r redis-cli -u "$REDIS_URL" DEL
# Restart server (Procfile-style atau pm2/systemctl sesuai env)
```

## Step 6 — Verification (self-validate, gating)

Tulis script `/tmp/verify_beta1.js` yang:
1. Query DB → agregat util+avail per produk via `company_product_stats`
2. Parse `master_data_120526.xlsx` → master util+avail per produk
3. Diff per produk, tolerance 0.01 MT

Plus API spot-check:
```bash
curl -s http://localhost:3000/api/data | jq '.spi[]|select(.code=="GAS")|{revFrom,revTo,obtainedByProd,availableByProd}'
curl -s http://localhost:3000/api/data | jq '.spi[]|select(.code=="SMS")|{obtainedByProd,availableByProd}'
```

**Pass criteria (semua harus true):**
- 10/10 produk DB ↔ master delta < 0.01 MT
- GAS API: `revTo = {GI BORON: 200}`, `obtainedByProd = {GI BORON: 200}`, `availableByProd = {GI BORON: 0}`
- SMS API: `obtainedByProd = {SHEETPILE: 150}` (atau canonical name), `availableByProd = {SHEETPILE: 150}`, util = 0
- Total Utilization card = 16,350.5 (bukan 16,500.5)

**Kalau ada yang gagal**: lapor eksplisit produk/perusahaan mana yang divergen, dan **JANGAN merge**. Restore dari backup kalau bug fundamental.

## Step 7 — Single final report

Kirim sekali ke chat:
1. `git diff` (commit Step 2)
2. Tabel verifikasi 10 produk (DB vs master, delta column)
3. API spot-check GAS + SMS (paste raw)
4. Pass/Fail status dengan reasoning kalau ada fail
5. Backup file path
6. Branch siap merge atau perlu fix lanjutan

Tidak perlu stop sebelum Step 7 kecuali safety gate trip (dry-run anomali besar di Step 4, atau verifikasi gagal di Step 6).

Mulai dari Step 1.
