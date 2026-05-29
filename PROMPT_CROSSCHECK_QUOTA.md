# Prompt — Crosscheck Quota Calculation & Fix Logic

> Paste isi di bawah ini ke Claude Code yang dibuka di direktori `iq_dash/`. Sudah berisi semua konteks yang dibutuhkan — Claude Code tidak perlu baca Excel sumbernya lagi.

---

## CONTEXT

Saya punya dua sumber data untuk Import Quota Monitor 2026:

1. **Spreadsheet master** ("Quota Obtained - Available 280526.xlsx", as of 2026-05-28) — ini ground truth manual yang dipakai management.
2. **Dashboard ini** (`iq_dash`, Node + PostgreSQL + Redis cache) yang menampilkan angka yang sama lewat `/api/data` + frontend `01-data.js`.

Saya CURIGA angka yang ditampilkan dashboard berbeda dari spreadsheet — kemungkinan besar bukan karena data DB-nya salah, tapi karena **logika agregasi** tidak menangani revisi quota dengan benar (revisi = pemindahan obtained MT dari satu produk ke produk lain pada perusahaan yang sama).

Tugas kamu:
1. **Crosscheck**: bandingkan output API `/api/data` dengan reference values di tabel di bawah.
2. **Diagnosa**: kalau ada divergensi, telusuri apakah penyebabnya di SQL query, di aggregator backend (`_buildDataPayload` di `server.js`), atau di helper frontend (`canonicalObtained` / `canonicalSubmitted` di `public/js/01-data.js`).
3. **Fix logikanya**, BUKAN datanya. Jangan UPDATE/INSERT/DELETE di tabel `companies`, `cycles`, `revision_changes`, `company_product_stats` untuk "menyamakan angka". Kalau data underlying memang sudah benar (revision_changes sudah ada record-nya), maka yang salah adalah cara kode menjumlahkan.
4. **Verifikasi**: jalankan API lagi setelah fix, pastikan match spreadsheet.

## REFERENCE VALUES (dari spreadsheet, NET setelah revisi, satuan MT)

Tab "All products (the correct one)" mengagregasi per produk. Yang harus muncul di `/api/data` (atau di summary frontend) setelah perhitungan benar:

| Product           | Obtained | Utilized | Available |
|-------------------|---------:|---------:|----------:|
| Sheet Pile        |    7,350 |    4,175 |     3,175 |
| Bordes Alloy      |    2,465 |      361 |     2,104 |
| AS Steel          |      900 |      195 |       705 |
| Seamless Pipe     |    1,000 |      800 |       200 |
| GL Boron          |    5,975 |    5,975 |         0 |
| PPGL Carbon       |      600 |      600 |         0 |
| GI Boron          |    3,800 |    3,800 |         0 |
| ERW Pipe OD>140   |      500 |       79 |       421 |
| ERW Pipe OD≤140   |      800 |    515.5 |     284.5 |
| Hollow Pipe       |      200 |        0 |       200 |
| **TOTAL**         |**23,590**|**16,500.5**|  **7,089.5** |

Catatan penting: angka Bordes Alloy / GL Boron / GI Boron / Hollow Pipe **sudah net setelah 3 revisi** ini:

- BDG: 650 MT dipindah dari `Bordes Alloy` → `GL Boron`
- GAS: 200 MT dipindah dari `Bordes Alloy` → `GI Boron`
- MJU: 200 MT dipindah dari `Bordes Alloy` → `Hollow Pipe`

Kalau dashboard masih menampilkan Bordes Alloy 3,515 MT (gross, sebelum revisi) berarti revisi belum dipotong dari obtained agregat. Sebaliknya kalau GL Boron muncul 5,325 (bukan 5,975) berarti tambahan dari revisi belum di-include.

## WORKFLOW YANG WAJIB KAMU IKUTI

### Fase 1 — Investigation only (read-only, JANGAN tulis ke DB)

1. Baca `schema.sql`, `server.js` (terutama `_buildDataPayload` ~line 714, `getCyclesFor` ~line 124), dan `public/js/01-data.js` (`loadData`, `canonicalObtained`, `canonicalSubmitted`).
2. Pahami pola revisi yang sudah ada di DB sebelum melangkah:
   - Run `SELECT direction, COUNT(*) FROM revision_changes GROUP BY direction` — lihat apakah `from`/`to` sudah terisi.
   - Run query untuk ambil sample revision_changes untuk BDG, GAS, MJU lalu inspect strukturnya.
   - Cek apakah ada cycle bertipe `Revision #N` / `Obtained (Revision #N)` untuk perusahaan-perusahaan ini.
3. Panggil API lokal (`curl http://localhost:3000/api/data | jq` — kalau server belum jalan, `npm start` dulu) dan agregasi per-produk dari payload-nya. Bandingkan dengan tabel reference di atas.
4. **Tulis hasil investigasi sebagai laporan di chat** sebelum menyentuh kode. Format:
   - Tabel diff: per produk, "DB says X, Excel says Y, delta = Z".
   - Hipotesis penyebab divergensi (mana yang lebih mungkin: data missing di `revision_changes`, atau aggregator tidak menjumlahkan revisi).
   - Rencana fix (file + fungsi + perubahan logika apa).
5. **STOP dan tunggu approval saya** sebelum lanjut ke fase 2.

### Fase 2 — Fix (setelah saya approve)

1. Buat branch git baru: `git checkout -b fix/quota-aggregation-crosscheck`.
2. Edit kode sesuai rencana — minimal diff, jaga kompatibilitas dengan caller lain.
3. Invalidate cache: `redis-cli DEL 'iq:data:v1'` kalau Redis dipakai; restart server kalau perlu untuk flush in-memory L1.
4. Jalankan API lagi, agregasi ulang, verifikasi match dengan tabel reference (toleransi 0.01 MT untuk pembulatan).
5. Print before/after table di chat.
6. **Kalau setelah fix kode ternyata ada record `revision_changes` yang memang missing di DB** (bukan bug aggregator, tapi data hilang), STOP dan tanya saya dulu sebelum INSERT — saya yang akan putuskan cara mencatatnya.

### Fase 3 — Safety net untuk DB write (kalau Fase 2 akhirnya membutuhkan tulis DB)

Setiap kali kamu tulis ke DB:
- Selalu di dalam `BEGIN ... COMMIT` transaction, dengan `ROLLBACK` di catch block.
- Print row count yang terdampak SEBELUM commit, minta konfirmasi saya.
- Jangan pakai `DELETE FROM ...` tanpa `WHERE`. Jangan pakai `TRUNCATE`.
- Jangan jalankan `node importDb.js` (itu DELETE-all → re-INSERT, terlalu berisiko untuk task ini).
- Pakai connection pooling dari `.env` yang sudah ada (`PGHOST`, `PGDATABASE`, dst).

## BATASAN TEGAS

- **JANGAN sentuh file Excel** (`Quota Obtained - Available 280526.xlsx`, `product.xlsx`, `company.xlsx`). Spreadsheet dianggap source of truth — saya akan rapikan formatnya terpisah.
- **JANGAN UPDATE `companies.obtained` / `available_quota` / `utilization_mt` secara manual** untuk "menyamakan dengan Excel". Kalau perlu update, harus melalui cycle/revision_change yang tepat sehingga audit trail tetap utuh.
- **JANGAN ubah skema** (`schema.sql`) kecuali absolut perlu dan kamu sudah jelaskan alasannya ke saya dulu.
- **JANGAN hapus / arsipkan `_backup_ui_2026-05-28/`** atau file di `.gitignore`.

## OUTPUT FINAL YANG SAYA HARAPKAN

1. Ringkasan diff (DB vs Excel) — sebelum fix.
2. Rencana fix + alasannya.
3. (Setelah approval) Diff kode (`git diff`).
4. Tabel verifikasi setelah fix: DB vs Excel, semua match dalam toleransi.
5. Catatan singkat apakah cache invalidation perlu di-trigger ulang di production saat deploy.

Mulai dari Fase 1. Laporkan dulu sebelum apa-apa.
