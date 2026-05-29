# Phase 2 — Refinement: Add revType Gate + Cache-bust Bump

> Lanjutan setelah review. Tabel verifikasi kamu solid, tapi temuan MIN bukan "your call decision" — itu bug konsistensi di heuristik. Berikut perbaikan + tambahan kecil sebelum merge.

---

## RATIONALE

MIN punya `revType='active'` ("Revision Request dikonfirmasi", belum PERTEK Terbit). Modul UI lain — `04-charts.js` `revisionStatus()` + `05-tables-spi.js` `buildRevList()` — secara eksplisit memperlakukan `revType='active'` sebagai **"Under Revision"** (pending, belum live).

Konsekuensi tanpa gate: dashboard sekarang internally inconsistent. UI list bilang "MIN's revision pending"; aggregator yang sudah kamu patch bilang "MIN's revision sudah diterapkan ke per-product split". Spreadsheet match dengan policy pertama (`complete` only) karena itu memang aturan resmi business.

Yang BDG/GAS/MJU bisa apply benar karena `revType='complete'`. MIN salah karena `revType='active'`. Gate `revType === 'complete'` menangkap kasus ini, dan semua kasus sejenis future-proof.

---

## SYARAT IMPLEMENTASI

### 1. Tambah revType gate di `getObtainedByProdAgg`

Letakkan **sebelum** balance check, supaya pending revisions di-skip tanpa overhead:

```js
// Only apply revision_changes when the revision is LIVE (revType='complete').
// revType='active' = pending PERTEK; the new allocation isn't real yet, and
// applying it here would contradict the rest of the dashboard (revisionStatus
// classifies these as "Under Revision"). Spreadsheet policy also: only
// completed revisions count in per-product totals.
if (co.revType !== 'complete') {
  // skip revision_changes application — fall back to gross obtainedByProd
  // (from cycles), unchanged.
  return /* whatever existing return path skips the rev block */;
}

// existing balance check (with BALANCE_EPSILON) continues here
```

Sesuaikan dengan struktur fungsi yang sebenarnya — kalau bukan `return`, gunakan flow control yang setara (skip block, lanjut ke return akhir).

### 2. Update HEURISTIC comment yang sudah kamu tulis

Tambahkan paragraf baru di blok komentar heuristik untuk menjelaskan gate ini:

```js
// GATE: revType='complete' required. Pending revisions (revType='active')
// are NOT applied — they're shown as "Under Revision" elsewhere in the UI
// and their new allocation isn't legally real until PERTEK Terbit. Applying
// them here would double-claim the same MT across two states.
```

### 3. Include cache-bust di commit yang sama

Edit `public/index.html` line 1526:
```html
<script defer src="/js/01-data.js?v=14"></script>
```
Menjadi:
```html
<script defer src="/js/01-data.js?v=15"></script>
```

Satu file tambahan di PR, tapi menyatukan code change + deploy hint. Reviewer tidak perlu ingat dua-duanya.

---

## VERIFIKASI ULANG — WAJIB

Re-run script verifikasi 13 perusahaan dengan **kolom `revType` tambahan**:

```
CODE | revType  | isBalanced | BEFORE | AFTER | Σ delta
-----|----------|------------|--------|-------|--------
BDG  | complete | TRUE       | ...    | ...   | 0   ← still applied
GAS  | ?        | TRUE       | ...    | ...   | 0
MJU  | complete | TRUE       | ...    | ...   | 0   ← still applied
MIN  | active   | TRUE       | ...    | unchanged | 0  ← NOW SKIPPED
... (semua 13)
```

**Aturan validasi setelah gate**:
- Balanced + `complete` → applied (BDG/MJU pasti masuk; GAS tergantung revType-nya, sebutkan eksplisit di output)
- Balanced + `active` → **skipped**, byte-identical before vs after
- Unbalanced (apapun revType) → tetap byte-identical
- Per-product total: MIN gap (Bordes +353/GI −353 atau yang relevan) harus **hilang**

**Kalau GAS punya `revType='active'`**: dia juga akan ter-skip dengan gate ini. Itu konsisten dan tidak masalah — gap GAS sekarang akan murni "revision tidak diapply, perlu data fix sendiri". Sebutkan dengan jelas di laporan.

**Kalau ditemukan perusahaan balanced + active selain MIN/GAS**: regress tabel verifikasinya, jangan asumsikan hanya MIN.

---

## HASIL YANG SAYA HARAPKAN

Setelah gate landed dan verifikasi ulang:

1. `git diff` updated (tambahan ~5 baris di `01-data.js` untuk gate + comment, 1 baris di `index.html`).
2. Tabel 13 perusahaan dengan kolom `revType` baru.
3. Tabel per-produk total — DB vs Excel. Yang saya harapkan:
   - 8/10 produk match exact (GL Boron, Hollow Pipe, sisanya yang sudah match sebelumnya **plus** Bordes +247 yang sekarang kembali karena MIN tidak diapply)
   - GAS gap tetap muncul (Bordes/AS/GI) — itu sisa kerja terakhir, perlu data fix
4. Konfirmasi: tidak ada perusahaan unbalanced yang ter-regress, tidak ada balanced+active lain yang ikut ter-skip secara mengejutkan.

---

## BATASAN TEGAS (TIDAK BERUBAH)

- Tetap **TIDAK ADA tulis DB.** Gate ini logic-only.
- Tetap **TIDAK menyentuh `server.js`.**
- Tetap **TIDAK ubah `schema.sql`.**
- **TIDAK menyentuh file Excel.**
- Kalau menemukan inkonsistensi data baru lagi, STOP dan lapor — jangan auto-fix.

Setelah output di atas saya review dan OK, baru kita lanjut ke proposal SQL fix untuk GAS (satu transaksi kecil dengan dry-run SELECT before/after). Itu fase berikutnya.

Mulai.
