# CLAUDE.md — iq_dash (Import Quota Monitor)

## RULE: Change log wajib (setiap update)

Setiap kali ada **perubahan apa pun** pada sistem ini — deploy kode, koreksi data di
Google Sheets, perbaikan bug, penambahan fitur, atau perubahan konfigurasi — **WAJIB
menulis ke file log harian**:

```
logs/{YYYY-MM-DD}_log.md
```

- Satu file per tanggal (mis. `logs/2026-06-19_log.md`). Kalau file untuk tanggal itu
  belum ada → buat. Kalau sudah ada → **append** entri baru (jangan timpa).
- Setiap entri minimal berisi: **waktu**, **apa yang diubah**, **file/tab yang terdampak**,
  **ref commit + versi deploy** (kalau kode), dan **alasan singkat**.
- Tulis log **setelah** perubahan terpasang/terverifikasi (bukan rencana — yang benar-benar terjadi).
- Koreksi data Sheets juga tetap tercatat di tab `Change_Log` Sheets; file log harian
  ini adalah ringkasan tingkat-sesi yang bisa dibaca manusia.

Format entri yang disarankan:
```
## HH:MM WIB — <judul singkat>
- **Ubah:** ...
- **File/Tab:** ...
- **Commit/Deploy:** <hash> · Heroku vNN   (kosongkan kalau data-only)
- **Alasan:** ...
- **Verifikasi:** ...
```

## Konteks penting (jangan dilanggar)
- **Google Sheets = sumber kebenaran tunggal** (id `1t4MbpW…MYd0`, "Mater Data IQ Dash";
  sejak 2026-07-17 — menggantikan `13CQrR…g08o` "iq dash raw data"). Master xlsx stale; jangan
  menimpa Sheets dari xlsx. Koreksi via dashboard.
- **Obtained punya 2 jalur**: cycles (`canonicalObtained`, untuk KPI/total) vs stats
  (`getObtainedByProdAgg` = util+avail, untuk breakdown per-produk). Harus tetap sinkron;
  pakai endpoint `record-obtained` untuk mencatat obtained baru agar dua-duanya sejalan.
- **Utilisasi**: lot ber-`util_mt=0` (mis. lot realisasi) **tidak boleh** mengosongkan
  utilisasi (sudah di-fix). Jangan kembalikan.
- Deploy: `git push heroku main` (remote `heroku` → iq-dash). Origin GitHub: `origin`.
- Catatan teknis lengkap ada di memory Claude (`MEMORY.md`).
