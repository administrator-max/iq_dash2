# Phase 3.3 part 2 — β vs γ comparison (REVISED setelah koreksi reference)

> Update penting sebelum kamu lanjut: ada koreksi material di reference values yang saya kasih dari awal. Ini mengubah karakterisasi salah satu sub-opsi. Baca dulu, baru evaluate.

---

## KOREKSI REFERENCE — ini penting

Saya baca header summary (hardcoded value M3) di sheet `Sheet Pile` file 28-Mei sebagai authoritative, padahal yang authoritative adalah sum per-company (`M11 = SUM(M6:M10)`). Keduanya tidak konsisten dalam file itu sendiri — header stale, sum benar.

**Reference value Sheet Pile yang BENAR (per master + per-company sum di 28-Mei):**

| Product | Obtained | **Utilization** | **Available** |
|---|--:|--:|--:|
| Sheet Pile | 7,350 | **4,025** | **3,325** |

Bukan 4,175 / 3,175 seperti yang saya kasih sebelumnya. Sembilan produk lainnya (Bordes Alloy, AS Steel, Seamless, GL Boron, PPGL Carbon, GI Boron, ERW×2, Hollow Pipe) di reference saya semula sudah benar — verify ulang lewat master file untuk pastikan, tapi probably no further corrections needed.

**Implikasi: DB saat ini menampilkan Sheet Pile util = 4,175 — itu BUG, bukan data current.** Bukan customs entry tambahan antara 12 Mei dan 28 Mei. Master 12-Mei dan per-company sum di 28-Mei semua agree: 4,025. DB over-counting 150 MT entah dari mana (kemungkinan: import historic dari header xlsx stale, atau double-count di realizations table).

**Verifikasi yang saya minta**: jalankan SQL untuk audit ini eksplisit, sebelum lanjut ke tabel komparasi.

```sql
-- Q1: Sum utilization per produk dari DB
SELECT product, SUM(utilization_mt)::numeric AS db_util
FROM company_product_stats
WHERE product IN ('SHEETPILE','Sheet Pile','BORDES ALLOY','GL BORON','GI BORON',
                  'AS STEEL','SEAMLESS PIPE','PPGL CARBON','HOLLOW PIPE',
                  'ERW PIPE OD≤140mm','ERW PIPE OD>140mm')
GROUP BY product
ORDER BY product;

-- Q2: Per-company Sheet Pile breakdown di DB — cari source 150 MT extra
SELECT company_code, utilization_mt, available_mt
FROM company_product_stats
WHERE product ILIKE '%sheet%pile%' OR product = 'SHEETPILE'
ORDER BY company_code;
```

Hasil yang saya harapkan: DB Sheet Pile util breakdown akan match master (BTS 425, GIS 0, EMS 1,600, SGD 2,000, SMS 0) kecuali ada satu perusahaan dengan 150 MT extra, atau ada perusahaan extra di luar 5 itu. Cari sumbernya dan flag.

Sebut juga: apakah `utilization_mt` di-derive dari `realizations` table (PIB customs), atau dari import import xlsx, atau di-edit manual via dashboard? Cek code path-nya sekali — itu menentukan apakah bug ini self-correcting saat next import atau permanent.

---

## NUANSA TETAP: `revision_changes` punya UI dependency

`revision_changes` **tidak hanya dipakai aggregator**. UI components membaca data revisi dari sana untuk display:
- `08-drawer.js` — drawer side panel per company
- `13-rev-mgmt.js` — halaman revision management

Konsekuensinya: **GAS data fix wajib terlepas dari pilihan β atau γ**, untuk konsistensi UI (drawer akan menampilkan `Bordes 200 → Bordes 130 + AS Steel 70` yang salah kalau tidak diperbaiki).

Verify: konfirmasi grep result dari kedua file itu (atau endpoint yang serve `revisionChanges` ke frontend), tunjukkan output di laporan.

---

## TRADE-OFF YANG SUDAH BERUBAH KARENA KOREKSI

Saya rangkum impact koreksi ke 4 sub-opsi yang saya minta kamu evaluate. Tabel ini **input** kamu, bukan output — tugas kamu validate dan isi detail.

| Opsi | Karakterisasi awal (sebelum koreksi) | Karakterisasi setelah koreksi |
|------|-------------------------------------|------------------------------|
| **β-1 overwrite** | "Destructive — clobber data customs real" | **Actually FIX bug Sheet Pile 150 MT** |
| **β-2 merge-max** | "Safer, no regression" | **Actively preserves DB bug 150 MT** (karena DB > master di Sheet Pile, MAX akan ambil yang salah) |
| **γ-1 selective MIN+GAS** | Konservatif, blast minimal | Bug Sheet Pile tetap, hanya MIN+GAS yang fix |
| **γ-2 full import** | High blast tapi DB ↔ master 1:1 | Fix semua termasuk Sheet Pile, blast besar |

β-1 yang awalnya saya frame sebagai berisiko sekarang adalah kandidat paling tepat secara teknis. Tapi **jangan langsung commit ke β-1** — verify dulu via SQL di atas, baru evaluate.

---

## YANG SAYA MAU KAMU EVALUASI — 4 SUB-OPSI

### β-1: Overwrite dari master
Script `node importMasterStats.js` baca master, UPSERT `company_product_stats.utilization_mt` + `.available_mt` overwrite. Aggregator: hapus revision_changes logic, ganti `Σ(util+avail)` per product per company. Plus fix GAS `revision_changes` data terpisah.

### β-2: Merge-max
Sama, tapi `new_util = MAX(master_util, current_db_util)`. Asumsi util only goes up. Dengan koreksi Sheet Pile: asumsi ini **gagal** untuk Sheet Pile (DB 4,175 > master 4,025, MAX akan ambil 4,175 yang salah).

### γ-1: Selective full import (hanya MIN + GAS)
DELETE + re-INSERT dari master untuk 2 perusahaan saja. Aggregator tetap Phase 2 patch. Sheet Pile bug tidak terpegang.

### γ-2: Full master import (34 perusahaan)
DELETE + INSERT semua quota tables dari master. Aggregator bisa lanjut Phase 2 atau simplify ke util+avail (pilihan terpisah).

---

## TABEL KOMPARASI YANG SAYA HARAPKAN

| Aspect | β-1 | β-2 | γ-1 | γ-2 |
|--------|-----|-----|-----|-----|
| Files affected (FE + BE + scripts) | ? | ? | ? | ? |
| Est. lines changed (excl. comments) | ? | ? | ? | ? |
| DB writes (tables + estimated row count) | ? | ? | ? | ? |
| Blast radius (1=narrow, 5=wide) | ? | ? | ? | ? |
| Reversibility (rollback 1=easy, 5=hard) | ? | ? | ? | ? |
| **Fixes Sheet Pile 150 MT bug?** | ✓ | ✗ (preserves) | ✗ | ✓ |
| **Fixes MIN issue (not-yet-live revision)?** | ✓ side-effect | ✓ side-effect | ✓ data import | ✓ data import |
| **Fixes GAS issue (wrong destination)?** | partial + needs rev_changes fix | partial + needs rev_changes fix | ✓ inherent | ✓ inherent |
| `revision_changes` table jadi audit-only? | ya | ya | tidak | depends |
| Operator re-import cadence required? | tiap master update | tiap master update | tidak | tiap master update |
| Resiko utama | util di state master 12-Mei sampai re-import | preserves 150 MT bug | bug Sheet Pile + future divergence | blast radius, schema mungkin perlu adjust |
| Includes GAS rev_changes fix as sub-step? | wajib | wajib | inherent | inherent |

Tambahkan baris untuk Opsi α (dead-end) — kolom-kolomnya N/A, alasan kegagalan singkat — untuk audit trail.

---

## OUTPUT YANG SAYA HARAPKAN

1. **Hasil 2 query SQL** di atas, raw — konfirmasi Sheet Pile bug magnitude dan lokasi.
2. **Hasil verifikasi UI dependency** (grep `08-drawer.js`, `13-rev-mgmt.js`, dan endpoint yang serve `revisionChanges`).
3. **Tabel komparasi 4 opsi** lengkap.
4. **Rekomendasi salah satu** dengan justifikasi 3–5 kalimat, sebutkan eksplisit kenapa **bukan** 3 yang lainnya.
5. **Plan eksekusi singkat** untuk opsi yang direkomendasikan: urutan langkah, transaksi safety, verification steps. Belum kode, baru rencana.

---

## VERIFIKASI ULANG REFERENCE LAINNYA — saya ingatkan

Saya sudah salah baca satu kolom. Don't trust angka reference yang saya kasih sebelumnya — re-verify lewat master file dulu untuk 9 produk lainnya. Pakai master sebagai authoritative source (per-company sum, not header). Kalau ada lagi yang divergen dari yang saya kasih sebelumnya, flag eksplisit.

---

## BATASAN TETAP

- READ-ONLY semua langkah di Phase 3.3 — TIDAK ada tulis DB, TIDAK ada edit code (kecuali script `/tmp` untuk verifikasi read-only).
- JANGAN merge branch `fix/quota-aggregation-crosscheck`, JANGAN delete.

Setelah saya review tabel + rekomendasi, baru saya kasih GO untuk Fase 4. Saat itu juga akan ditentukan urutan GAS data fix relatif terhadap opsi utama.

Mulai. Kirim hasil SQL + UI dependency dulu sebelum tabel komparasi — kalau hasilnya mengejutkan, mungkin scope decision-nya perlu re-frame.
