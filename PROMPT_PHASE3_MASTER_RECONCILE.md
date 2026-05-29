# Phase 3 — Crosscheck Against Authoritative Master File + Propose Path

> Setelah Phase 2 patch landed (balanced-only di branch `fix/quota-aggregation-crosscheck`), saya temukan file master yang lebih lengkap dan up-to-date dari spreadsheet ringkasan 28-Mei yang dipakai untuk verifikasi sebelumnya. File ini mengubah pemahaman tentang struktur revisi. Saya butuh kamu (1) verifikasi DB terhadap master ini, (2) propose architectural path berdasarkan bukti.

---

## SETUP — file location

User akan letakkan file ini di root project:
```
iq_dash/master_data_120526.xlsx
```

Kalau belum ada, minta user copy-kan dari `00 IQ Dash - Quota Data 120526 (dashboard master data) (1).xlsx` ke `iq_dash/master_data_120526.xlsx` sebelum mulai.

File: 1 sheet ("Status Submisson"), 37 columns, 34 perusahaan.

## YANG SUDAH SAYA PAHAMI DARI FILE INI (jangan investigasi ulang, validasi saja)

### 1. Struktur per perusahaan = multi-row lifecycle
Setiap perusahaan punya beberapa row, satu per fase:
- `Submit #N` — original submission MT per produk
- `Obtained #N` — MT aktual yang dapat (jauh lebih kecil dari Submit)
- `Revision #N` — reallocation antar produk (signed deltas, sum = 0)
- `Utilization (MT)` — MT yang sudah dipakai per produk
- `Available (MT)` — MT sisa per produk

### 2. Revisi pakai signed deltas
Contoh GAS Revision #1:
- BORDES ALLOY: `-200`
- GI BORON: `+200`
- JUMLAH (MT): `0`

Ini encoding yang BERBEDA dari DB `revision_changes` (yang pakai `direction='from'/'to'` dengan nilai positif). Master = source of truth, encoding ini benar.

### 3. Setiap revisi punya 4-stage lifecycle
- Submit MOI Perubahan → date
- PERTEK Perubahan → date (atau TBA)
- Submit MOT Perubahan → date
- SPI Perubahan → date (atau TBA)

**Aturan apply yang dipakai master**: revisi live (counted dalam per-product totals) **HANYA setelah SPI Perubahan TERBIT** — bukan PERTEK saja, bukan "dikonfirmasi" saja. Ini bisa dibaca dari kolom "Release" dan "Date" pada row revisi + Utilization row + Status text.

### 4. Multi-revisi per perusahaan = realistic
Contoh:
- **BDG**: Rev #1 `-650 Bordes / +650 GL Boron` (SPI Terbit 21/04/26 → APPLIED), Rev #2 `-350 Bordes / +350 GI Boron` (SPI Date TBA → NOT APPLIED). Master Available row mengkonfirmasi: Bordes 350, GL 0, GI 0.
- **MJU**: Rev #1 `-200 Bordes / +200 Hollow` (SPI Terbit 06-MAY-26 → APPLIED), Rev #2 `+200 HRC / -200 Hollow` (PERTEK TBA → NOT APPLIED). Master Available: Hollow 200, HRC 0.
- **MIN**: Rev #1 `-353 Bordes / +353 GI Boron` (PERTEK Date TBA → NOT APPLIED). Master Available: Bordes 353, GI 0.
- **GAS**: Rev #1 `-200 Bordes / +200 GI Boron` (SPI Terbit 27/04/26 → APPLIED). Master Available: Bordes 0, GI 0.

### 5. Net per-product per perusahaan = Utilization + Available
Karena master sudah merepresentasikan post-revision state di Utilization + Available row, **net obtained per produk per perusahaan = utilization + available** untuk produk itu.

Validasi quick:
- BDG: Utilization GL 650, Available Bordes 350. Net = Bordes 350, GL 650. Total 1000 = Obtained #1 ✓
- MIN: Utilization Bordes 247, Available Bordes 353. Net = Bordes 600. Total 600 = Obtained #1 ✓

Ini insight penting: kalau `company_product_stats.utilization_mt` dan `.available_mt` di-isi sesuai master, **aggregator tidak perlu touch revision_changes sama sekali**.

---

## TUGAS

### Fase 3.1 — Validasi pemahaman saya (15–20 menit)

Tulis Node script read-only di `/tmp` yang:
1. Parse `master_data_120526.xlsx` ke struktur normalized (one record per company-cycle-product).
2. Print summary: total perusahaan, distinct status types, distinct produk yang muncul.
3. Untuk **BDG, MJU, MIN, GAS** (4 perusahaan revision yang sudah kita debat), print:
   - All cycle rows + amounts
   - Lifecycle status (apa Submit/PERTEK/SPI dates-nya)
   - Computed net per produk = utilization + available
4. Compute global aggregate per produk dari master: Σ (utilization + available) across all companies per product.
5. Output dalam format markdown table.

**Stop here, kirim ke chat.** Saya konfirmasi 4 perusahaan + total agregat match dengan reference 28-May (Sheet Pile 7350, Bordes 2465, AS 900, dst.). Kalau master + 28-May konsisten → pemahaman saya benar, lanjut ke 3.2. Kalau divergen → ada nuansa baru, lapor.

### Fase 3.2 — Cross-check DB vs Master (read-only)

Setelah 3.1 OK, jalankan API lokal (atau langsung query DB) dan bandingkan:
1. Per company per product: master's net (util + avail) vs DB's current obtained-per-product (setelah Phase 2 patch).
2. Identifikasi semua perusahaan yang divergen dan kategorikan penyebab:
   - **A**: DB pakai data lama / belum di-update sejak master direvisi → data refresh issue
   - **B**: DB punya revision_changes yang tidak match master (mis. GAS destination salah) → data correction issue
   - **C**: DB aggregator tidak gating revisi dengan SPI lifecycle → logic issue (yang sudah kita coba di Phase 2)
   - **D**: Kombinasi A+B+C

Hasil: tabel divergensi per perusahaan + kategori penyebab.

### Fase 3.3 — Propose architectural path (kasih saya bukti, bukan opini)

Berdasarkan hasil 3.2, evaluasi **TIGA opsi konkret** dan rekomendasikan satu dengan justifikasi:

**Opsi α — Logic gate via cycle lookup** (extend Phase 2 patch)
- Di aggregator, untuk setiap balanced revision_change, cek apakah ada cycle row dengan type matching pattern "SPI Perubahan" + date filled (bukan TBA) untuk perusahaan + period itu. Apply hanya kalau ya.
- Pro: cuma 1 file diubah (`01-data.js`), reversible.
- Con: butuh DB punya cycle row "SPI Perubahan" dengan date. Verify dulu dari sample query — apakah BDG/GAS/MJU yang sudah applied punya cycle row SPI Perubahan dengan date filled di `cycles` table?

**Opsi β — Refresh `company_product_stats` from master, simplify aggregator**
- Tulis script `node importMasterStats.js` yang baca master, hitung utilization + available per company per product, UPSERT ke `company_product_stats`. (One transaction, ROLLBACK on error.)
- Aggregator: hapus revision_changes logic dari `getObtainedByProdAgg`, ganti dengan `Σ (util + avail)` per product per company dari `company_product_stats`.
- Pro: aggregator jauh lebih simpel, drift kategori bug hilang, satu sumber data canonical.
- Con: butuh DB write (UPSERT statistik). Tabel `revision_changes` jadi audit-only (tidak dibaca aggregator).

**Opsi γ — Full master import (refresh semua quota tables)**
- Tulis full importer: master file → `companies`, `cycles`, `cycle_products`, `revision_changes`, `company_product_stats`. DELETE existing rows + re-INSERT.
- Pro: DB ↔ master 1:1, semua hal historical preserved.
- Con: blast radius besar (semua quota tables). Risiko data loss kalau ada DB-only data yang tidak ada di master. Butuh approval terpisah.

**Yang saya harapkan kamu deliver di akhir Fase 3.3**:
1. Tabel komparasi 3 opsi: scope, files affected, est. lines changed, blast radius, reversibility.
2. Verifikasi sample DB query untuk Opsi α (apakah signal SPI Perubahan ada di cycles table sekarang).
3. Rekomendasi salah satu dengan justifikasi 2–3 kalimat.

**STOP sebelum implementasi.** Tunggu saya approve rekomendasinya baru lanjut ke Fase 4 (eksekusi).

---

## BATASAN

- **READ-ONLY semua tugas di Phase 3.** Boleh `SELECT`, boleh parse Excel, JANGAN `UPDATE/INSERT/DELETE` di DB. JANGAN edit code (selain script di `/tmp` yang read-only / parsing).
- **Branch `fix/quota-aggregation-crosscheck` tetap berdiri, JANGAN merge JANGAN delete.** Patch Phase 2 tetap valid sebagai baseline.
- **JANGAN sentuh file Excel master.**
- **JANGAN ubah schema atau buat migration.**

## OUTPUT YANG SAYA TUNGGU

Tiga pesan berurutan ke chat:
1. (akhir 3.1) Konfirmasi parsing + 4-company detail + global aggregate.
2. (akhir 3.2) Tabel divergensi DB vs master + kategorisasi penyebab.
3. (akhir 3.3) 3-options comparison + verifikasi Opsi α signal + rekomendasi + justifikasi.

Setelah saya OK rekomendasinya, baru kasih saya prompt untuk Fase 4 (eksekusi rekomendasi).

Mulai.
