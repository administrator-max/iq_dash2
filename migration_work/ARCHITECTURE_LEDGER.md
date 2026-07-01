# IQ Dash — Arsitektur Ledger (fix permanen "data selalu kacau")

Status: **Fase 1–4 LIVE (Heroku v99). Obtained/Util/Available diturunkan dari ledger.**
Tanggal: 2026-07-01

## Akar masalah (kenapa selalu kacau)
Fakta yang sama disimpan di **banyak tempat** dan dipelihara terpisah → **drift**:
- Obtained: `cycles` (canonicalObtained) **vs** `stats` (util+avail) — hasil beda.
- Utilization: `stats` **vs** `lots`.
- Realized: dulu RA berat **vs** lot **vs** PIB → **sudah disatukan ke PIB (Option A, `166e915`)** dan stabil sejak itu.
- Available: **disimpan**, bukan diturunkan → drift dari obtained−util.
- Produk: HS sama, nama beda (GL BORON↔GL ALLOY, GI BORON↔GI ALLOY, SHEETPILE↔SHEET PILE) → breakdown pecah/dobel. Bahkan cycles vs `d.products` di iq_dash sendiri tak konsisten.

Setiap "rekonstruksi" memperbaiki angka, bukan struktur → kacau lagi.

## Prinsip fix permanen
**Satu ledger append-only per fakta, di-key HS, semua agregat DIHITUNG saat baca (tak disimpan).**
Model referensi = Neon `quota_monitoring` (Program A). Pola sama sudah terbukti di Realized (Option A) → tidak drift lagi.

| Ledger (append-only: HS + tanggal + sumber) | Agregat (derived, tak disimpan) |
|---|---|
| `obtained_ledger` (tiap Obtained/Revisi SPI = 1 baris bertanda) | Obtained = Σ (bisa "original" vs "effective") |
| `utilization_ledger` | Utilized = Σ |
| `realization_ledger` (= tabel `realizations`, sudah ada + Option A) | Realized = Σ |
| `products` (hs_code → 1 nama kanonik, dari Neon `tbl_product`) | **Available = Obtained − Utilized** (selalu turunan) |

**Kenapa berhenti kacau:** tak ada duplikat → tak ada drift · Available mustahil tak konsisten · kunci HS → tak ada split nama · append-only → edit/import tak merusak fakta lama, tiap angka punya sumber+tanggal (= history) · import = tambah baris idempoten, bukan timpa.

## Yang sudah dibangun (preview, di `migration_work/ledger_seed/`)
1. **`products.json`** — 25 HS↔nama kanonik dari Neon `tbl_product`.
2. **`obtained_ledger.json`** — 69 baris dari master "(6)", 33 company, di-key HS.
   - **Verifikasi:** derived Obtained = **33.730** (= target). IKM ikut (GI 4150 + SHEETPILE 1750 + SEAMLESS 2100 = 8000).

### Temuan penting: "Obtained" punya 2 view sah (ledger menyajikan keduanya)
| View | Definisi | GI (7225.92.90) | Cocok target? |
|---|---|---|---|
| **Original** | Σ Obtained #N (grant awal, tanpa revisi) | 8.450 | ✅ = tabel target user |
| **Effective** | Σ Obtained + Revisi (setelah reassign antar-HS) | 9.904 | = yang mem-backing realisasi (mis. BDG GL 650) |

Grand total 33.730 sama. **Keputusan bisnis (user):** angka headline Obtained pakai **Original** (sesuai target) atau **Effective** (konsisten dgn realisasi), atau tampilkan dua-duanya. Ledger mendukung semua tanpa ubah data.

## Migrasi bertahap (tiap fase verifiable)
- [x] **Fase 1** — Registry HS↔nama kanonik (`products.json`).
- [x] **Fase 2** — `obtained_ledger` seed dari master (derived Obtained = 33.730). *(preview)*
- [ ] **Fase 2b** — enrich nomor/tanggal SPI ke tiap baris obtained (dari cycles yang cocok per-HS).
- [ ] **Fase 3** — `utilization_ledger` (target 18.346) + `realization_ledger` sudah ada (15.438).
- [ ] **Fase 4** — dashboard hitung Obtained/Util/Available dari ledger (pola Option A). Pensiunkan cycles-obtained & stats duplikat.
- [ ] **Fase 5** — verifikasi vs master (33.730 / 18.346 / 15.384) + realisasi; hapus store lama.

## Catatan
- Neon Program A: **schema+mapping emas, DATA basi** (obtained 22.470, terakhir ~Mei 2026, tanpa IKM). Dipakai untuk mapping HS + acuan model, **bukan** sumber data.
- Belum ada tulisan ke produksi. Seed ini artefak review.
