# Phase 3.3 — GO, dengan 2 klarifikasi yang harus masuk

> Diagnosis 3.2 bersih dan decisive. Lanjut ke 3.3 dengan dua hal yang harus eksplisit di output kamu, supaya rekomendasi nanti benar-benar evidence-backed.

---

## Klarifikasi #1 — Verifikasi Opsi α signal lebih konkret

Opsi α (logic gate) cuma viable kalau DB punya sinyal yang bisa dipakai aggregator untuk membedakan revisi yang SPI Perubahan terbit vs yang TBA. Jangan asumsi sinyal itu ada — **verify dengan SQL** dan tunjukkan hasilnya.

Sampel query yang saya harapkan kamu jalankan dan paste hasilnya:

```sql
-- 1) Apakah ada cycle row dengan pattern "SPI Perubahan" untuk perusahaan 
-- yang memang sudah SPI Perubahan terbit per master?
SELECT company_code, cycle_type, release_type, release_date, spi_date, status
FROM cycles
WHERE company_code IN ('BDG','GAS','MJU')
  AND (cycle_type ILIKE '%revision%' OR cycle_type ILIKE '%perubahan%' 
       OR release_type ILIKE '%spi%perubahan%' OR status ILIKE '%spi%terbit%')
ORDER BY company_code, sort_order;

-- 2) Cycle MIN — kalau gate kerja, MIN seharusnya NOT punya cycle 
-- yang menandakan SPI Perubahan terbit (atau status text-nya TBA).
SELECT company_code, cycle_type, release_type, release_date, spi_date, status
FROM cycles
WHERE company_code = 'MIN'
ORDER BY sort_order;

-- 3) Field lain di companies yang mungkin carrying revision lifecycle signal
SELECT code, rev_type, rev_status, rev_submit_date, spi_ref, status_update
FROM companies
WHERE code IN ('BDG','GAS','MJU','MIN');
```

Hasil yang saya harapkan untuk Opsi α layak diadopsi:
- BDG/GAS/MJU punya cycle row atau status text dengan SPI Perubahan + date filled (bukan TBA)
- MIN: tidak punya (atau TBA / kosong)

**Kalau sinyal itu tidak ada di mana-mana**, Opsi α mati — aggregator tidak bisa gating tanpa data baru. Itu akan force decision ke Opsi β atau γ. Lapor eksplisit.

## Klarifikasi #2 — Catat pattern manual-entry yang baru terungkap

Diagnosis kamu di 3.2 implicitly menunjukkan satu hal yang patut dicatat di tabel komparasi 3 opsi:

- Master punya **6 revisi total** dari 4 perusahaan (BDG Rev#1+#2, MJU Rev#1+#2, GAS Rev#1, MIN Rev#1)
- DB punya **4 revisi** di `revision_changes` (BDG Rev#1, MJU Rev#1, GAS Rev#1, MIN Rev#1)
- **BDG Rev#2 dan MJU Rev#2 tidak ada di DB** — keduanya SPI TBA, operator belum entry
- **MIN Rev#1 ada di DB** walaupun SPI TBA — outlier dari pola normal

Pattern: operator biasanya entry revisi ke DB **setelah SPI Perubahan terbit**, kecuali MIN yang masuk lebih awal (mungkin karena status "dikonfirmasi"). Ini berarti:
- Opsi α (gate aggregator): solve MIN, tapi tidak mengisi BDG Rev#2 / MJU Rev#2 ke DB. Future deploy butuh operator entry manual.
- Opsi β (refresh stats from master): solve MIN sebagai side-effect (utilization+available langsung benar), juga tidak mengisi revision_changes — tapi rev_changes jadi audit-only, tidak masalah.
- Opsi γ (full import): mengisi semua 6 revisi termasuk yang pending. Bisa berguna untuk operator visibility, atau bisa noisy.

Sebutkan trade-off ini di tabel komparasi.

## Yang harus muncul di output 3.3

1. **Hasil 3 query** di atas, raw output.
2. **Tabel komparasi 3 opsi** dengan kolom:
   - Files affected
   - Est. lines changed
   - DB writes (table + estimasi row count)
   - Blast radius
   - Reversibility (1–5)
   - Risiko utama
   - Apakah opsi ini mengisi BDG Rev#2 / MJU Rev#2 yang TBA?
   - Apakah opsi ini menyimpan util/avail di state 12-Mei (master) vs 28-Mei (DB)?
3. **Rekomendasi** dengan justifikasi 2–3 kalimat.
4. **Catatan** kalau Opsi α tidak viable karena tidak ada sinyal di DB.

## Batasan tetap

- READ-ONLY semua tugas 3.3.
- JANGAN edit code, JANGAN tulis DB.
- Boleh tulis script verifikasi di `/tmp` yang sifatnya read-only.

Setelah output di atas saya review dan approve rekomendasinya, baru saya kasih GO untuk Fase 4 (eksekusi). Saat itu juga akan diputuskan: GAS data fix dilakukan sebelum / sesudah / sebagai bagian dari pilihan opsi.

Mulai. Kirim hasil 3 query dulu sebelum tabel komparasi — kalau Opsi α mati di SQL, tabel akan saya minta ulang dengan format berbeda.
