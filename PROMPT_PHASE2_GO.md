# Phase 2 — GO (Logic Fix di Frontend, NO DB Writes)

> Lanjutan dari sesi crosscheck. Diagnosis kamu (balanced vs unbalanced revision_changes, GAS stale) sudah diapprove. Eksekusi Phase 2 sesuai rencana yang kamu ajukan, dengan TIGA syarat tambahan di bawah ini yang harus masuk ke implementasi.

---

## SYARAT IMPLEMENTASI WAJIB

### 1. Balance check pakai toleransi, BUKAN strict equality

NUMERIC dari PostgreSQL kalau diolah di JS bisa kena floating-point rounding error (mis. `515.5 - 515.5 === 1.1e-13`). Strict equality akan kadang miss-classify reallocation jadi re-apply tanpa warning.

Wajib pakai:

```js
const BALANCE_EPSILON = 0.01;  // 10 kg tolerance — di bawah batas signifikansi business
const sumFrom = revFromRows.reduce((s, r) => s + Number(r.mt || 0), 0);
const sumTo   = revToRows  .reduce((s, r) => s + Number(r.mt || 0), 0);
const isBalanced = Math.abs(sumFrom - sumTo) < BALANCE_EPSILON;
```

### 2. Komentar yang JUJUR di `getObtainedByProdAgg`

Heuristik balanced/unbalanced adalah pola empirik dari data hari ini, bukan kontrak schema. Future developer (atau kamu sendiri 6 bulan dari sekarang) harus tahu ini supaya tidak debugging buta saat angka mulai aneh. Tempel komentar ini persis di atas blok yang menerapkan revision_changes:

```js
// HEURISTIC: apply revision_changes ONLY when balanced (Σfrom ≈ Σto within
// BALANCE_EPSILON). Reasoning: balanced rows encode reallocations NOT yet
// reflected in cycles (per-product redistribution within same company, total
// preserved). Unbalanced rows encode re-apply increments ALREADY baked into
// cycle totals (applying them would double-count).
//
// This is an EMPIRICAL pattern derived from current data — NOT enforced by
// schema. If a future reallocation gets logged as unbalanced (or a re-apply
// as balanced), totals will silently diverge.
//
// Long-term fix: add an explicit `kind` ('reallocation' | 'reapply') column
// to revision_changes so the aggregator doesn't need to guess.
```

### 3. Verifikasi all-companies dengan tabel diff LENGKAP, bukan sekadar "no regression"

Setelah patch landed, jalankan script verifikasi (bisa one-off Node script di `/tmp` atau langsung di browser console) yang menghasilkan tabel berikut **untuk setiap perusahaan yang punya entri di revision_changes** (~16 from-rows worth, jadi ~16 perusahaan):

```
CODE | isBalanced | obtainedByProd BEFORE patch | obtainedByProd AFTER patch | Σ delta
-----|------------|---------------------------|---------------------------|--------
BDG  | TRUE       | {Bordes Alloy: 1000}       | {Bordes Alloy: 350, GL: 650} | 0
GAS  | TRUE       | {Bordes Alloy: 200}        | {Bordes: 130, AS: 70}       | 0
MJU  | TRUE       | {Bordes Alloy: 200}        | {Hollow Pipe: 200}          | 0
HDP  | FALSE      | {GL Boron: 2200}           | {GL Boron: 2200}            | 0 (unchanged)
CGK  | FALSE      | ...                        | ... (unchanged)             | 0
... (semua 16)
```

**Aturan validasi**:
- Yang balanced HARUS berubah pengelompokannya (saving record reallocation), tapi Σ MT per perusahaan harus tetap (delta = 0).
- Yang unbalanced HARUS identik before vs after (Σ delta = 0). Kalau ada perusahaan unbalanced yang nilainya bergeser, heuristik gagal — STOP, lapor, jangan commit.

## CHECKLIST OUTPUT YANG SAYA TUNGGU SEBELUM MERGE

Setelah selesai edit, jangan langsung suruh saya merge. Kirim ke chat:

1. **Output `git diff`** dari branch `fix/quota-aggregation-crosscheck` — minimal diff, harapan saya cuma `01-data.js` yang tersentuh, ~30–50 baris.
2. **Tabel verifikasi 16 perusahaan** sesuai format di Syarat #3.
3. **Tabel per-produk total** (10 produk) — DB output vs Excel reference, kolom delta. Setelah fix, semua harus match kecuali Bordes/AS/GI yang gap-nya disebabkan GAS stale (yang akan kita perbaiki di langkah berikutnya).
4. **Konfirmasi cache invalidation steps** untuk production deploy (Redis `iq:data:v1` flush + restart server kalau perlu).

## SETELAH OUTPUT DI ATAS DITERIMA

Saya akan review. Kalau OK, saya kasih GO terpisah untuk:
- Step berikutnya: usulan SQL fix untuk GAS (DELETE 2 row stale di revision_changes + INSERT 1 row `GI BORON 200`), dengan dry-run SELECT before/after. Saya yang putuskan execute-nya.
- Follow-up jangka panjang yang saya catat: (a) migrasi `company_product_stats.available_mt` ke generated column, (b) tambah `kind` column ke `revision_changes`. Keduanya schema change, dijadwalkan terpisah.

## BATASAN TEGAS DI FASE INI

- **TIDAK ADA tulis DB.** Tidak UPDATE, INSERT, DELETE di tabel apapun. Tidak `node importDb.js`.
- **TIDAK ada perubahan di `server.js`.** Server-side aggregator (`_buildDataPayload`) dibiarkan — patch hanya di frontend `01-data.js`. Konsekuensinya konsumer eksternal `/api/data` (kalau ada export tool / BI integration) masih dapat angka lama; sudah saya catat sebagai follow-up, jangan dikerjain sekarang.
- **TIDAK menyentuh file Excel** (sumber spreadsheet).
- **TIDAK mengubah `schema.sql`** atau migrasi apapun.
- **Kalau di tengah implementasi nemu data integrity issue baru** (misal cycle_products yang tidak konsisten dengan companies.obtained), STOP, lapor di chat, jangan coba auto-fix.

Mulai. Kirim diff + 3 tabel kalau sudah siap untuk review.
