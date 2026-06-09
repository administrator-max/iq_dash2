# Implementation Log — Program B full swap Neon → Google Sheets

**Tanggal:** 09/06/2026 · **Branch/worktree:** claude/pensive-kapitsa-469583
**Sheet (DB):** https://docs.google.com/spreadsheets/d/13CQrRUXhfB2Ceq8p7HXPhx2Fj31DSN3AwvtuNKpg08o

## 1. Scope
Menjadikan Google Sheet sebagai data store Program B (ganti Neon), migrasi data A+B (tagged), dan memastikan Program B bisa menjawab 8 pertanyaan analitik + pertanyaan realisasi langsung dari Sheet.

## 2. File diubah / dibuat (di worktree)
- **`lib/sheetsStore.js`** (baru) — loader Sheet→memory (cached, TTL) + write helpers (appendRows, rewriteTable, logChange). Header tab = nama kolom DB → map 1:1. Coercion: ''→null, TRUE/FALSE→bool, numeric tetap string (parity pg NUMERIC). Service-account dicari walk-up.
- **`lib/insights.js`** (baru) — analitik murni (source-agnostic) menjawab Q1–Q8 + realisasi.
- **`server.js`** (diubah) — dispatch `DATA_SOURCE=sheets`:
  - const dispatch + `loadAnalyticsTables()`.
  - `getCyclesForSheets()` (replikasi DISTINCT ON dedup + join cycle_products).
  - `_buildDataPayload()` fetch di-branch (sheets vs neon); assembly + `buildCompanyObj` dipakai ulang (tak berubah).
  - `/api/realizations` + `/api/realizations/summary` reads di-branch.
  - **`/api/insights`** + **`/api/insights/:q`** (baru).
  - Writes sheets: `/api/realizations` (bulk), `/api/realizations/single`, `DELETE /api/realizations/:id`, `PATCH /api/company/:code` (scalar) — append/rewrite + Change_Log.
  - Guard 501: `POST /api/company`, `PATCH /api/company/:code/cycles` (belum diport).
  - Boot: sheets mode skip initDB, warm store.
- Scripts data: `migration_work/build_full.js`, `push_full.js` (rebuild Sheet faithful mirror). Lihat juga `IMPLEMENTATION_LOG_MIGRATION.md` (dir utama) untuk detail migrasi data.

## 3. Database/table dianalisis
- Program B (Neon ep-summer-moon): 14 tabel → di-mirror verbatim ke Sheet (kolom asli + source_program=B).
- Program A (Neon ep-floral-unit): dipakai sebagai pengaya history → realizations (149), status_history (pertek 108 + spi 28), utilization_lots (util_detail 32, punya tanggal), companies (7 A-only). source_program=A.

## 4. Google Sheet dimodifikasi
Dibangun ulang jadi DB mirror: tabs `companies(41) company_directory products product_aliases company_products company_product_stats cycles(130) cycle_products(140) revision_changes(35) company_shipments company_reapply_targets ra_records pending_meta realizations(285) status_history(396) utilization_lots(92) Status_Master Change_Log` + README + Schema.

## 5. Real vs mock
Semua real (B Neon + A Neon). Tidak ada dummy. Catatan: baris realizations sumber A tidak punya `id` (history) → tidak bisa di-DELETE via API by-id (acceptable). Status_history A = data status asli (nomor PERTEK/SPI real).

## 6. Command validasi
- `node --check server.js lib/sheetsStore.js lib/insights.js` → OK.
- Boot: `NODE_PATH=<real>/node_modules DATA_SOURCE=sheets PORT=4010 node server.js` → listening + store warmed.
- `migration_work/probe.js` (reads/insights), `probe_write.js` (insert/read/patch/delete), `verify_write.js` (Change_Log + persistence).

## 7. Hasil validasi (DATA_SOURCE=sheets, X-Data-Source: sheets)
- `/api/data`: spi=39 pending=2 ra=22 products=25 (dibangun dari Sheet). ✅
- Q1 obtained: year 13.115 / month 450 / week 450 MT (20 cycle TBA). ✅
- Q2 EMS: lastStage "Obtained #2", status "SPI Perubahan TERBIT…". ✅
- Q3: GL ALLOY 25.700, GI ALLOY 10.353,5, SHEET PILE 7.350 (canonical merged). ✅
- Q4: avg 60,2 hari · tercepat CGK 22 hari. ✅
- Q5 GL BORON: sisa 500 MT / 15 company. ✅  Q6: 15 company. ✅
- Q7 CGK: 5 event util bertanggal (incl A). ✅
- Q8 GI ALLOY: 6 reallocation from→to. ✅
- Realisasi: totalRealized 25.289,58 MT; per company/produk/periode; vsObtained %. ✅
- Realization summary: 31 PIB / 285 lines. ✅
- **Write path**: insert realization id=138 → read-back → summary 285→286 → company PATCH → delete → 285. Change_Log mencatat insert/patch/delete. ✅ (data uji sudah dibersihkan, AMP remarks dipulihkan).

## 8. Write swap LENGKAP + TBA handling (lanjutan 09/06/2026)
- **`POST /api/company`** (create) → diport ke sheets: append companies + company_products + pending_meta + seed cycle Submit #1 (release_date BLANK = pending) + cycle_products + Change_Log.
- **`PATCH /api/company/:code/cycles`** (cycle editor) → diport: rewrite cycles + cycle_products untuk company itu, id baru auto-increment, **TBA→blank** (norm), + Change_Log.
- **TBA rule**: tanggal `TBA` disimpan kosong (blank=pending). `lib/insights.js` Q1 kini punya bucket `pendingObtainedCycles`/`pendingObtainedMT` (obtained tanpa tanggal = pending, tidak masuk periode).
- Semua write endpoint kini sheets-backed (realisasi bulk/single/delete, company scalar+nested via cycles editor, create company). Tidak ada lagi 501.

## 9. Browser validation (Claude-in-Chrome, localhost:4020, DATA_SOURCE=sheets)
- Dashboard render penuh dari Sheet: KPI (Obtained 24.690, Available 6.830), tanpa console error.
- **Chart bekerja**: "Obtained vs Utilization" (bar+garis Obtained, hover tooltip per company), "Lead Time per Cycle" (stacked 37d/13d/19d, end-to-end 60d, tabel date-detail), tab "Utilization & Realization" (KPI Realization % 14,5% + tabel monitoring per produk).
- **Input system + data record TERUJI via UI**: Input Data → Super Admin → pilih company → isi PERTEK No → Save & Refresh → tersimpan ke Sheet (cycles ZTEST: pertek_date=15/06/2026, status "PERTEK TERBIT"); badge PERTEK&SPI 39→40, Available 6.830→7.430 otomatis. Obtained #1 TBA tampil "pending".
- Data uji (ZTEST + Change_Log) sudah dibersihkan; companies kembali 41.

## 9b. Test FILTER PERIODE (browser, DATA_SOURCE=sheets) — semua halaman terpengaruh ✅
Filter periode = client-side atas payload `/api/data` (kini dari Sheet). Engine: `filteredSPI()/filteredRA()/filteredPending()` di `02-period-filter.js`; semua render (`03-kpis`, `04-charts`, `05-tables-spi`, `06-tables-util-ra`, `07-tables-main`, `15-leadtime`, `17-ou-chart`) memakai getter ter-filter. Rule = company-level (company tampil bila ADA cycle dalam range).
Diuji preset **Nov 2025** (vs All Time):
- **Overview**: Submitted 260.025→58.000 (8 co), Obtained 24.090→7.070 (14 co), Utilized 27→1, Realized 8→—, Available 6.830→22.440; chart bar dim out-of-period. Banner "Periode aktif: Nov 2025 · 28 SPI · 0 Pending · 21 Realization".
- **PERTEK & SPI**: list & summary scoped (company-level), 12 Completed / 14 Under Revision.
- **Utilization & Realization**: Obtained→7.070, Utilized→750, Realization% 14,5%→50,5%; AADC (aktivitas Apr-2026) hilang dari list.
- **Available Quota**: Available 6.830→6.320, Obtained→7.070, Companies w/Quota 13; breakdown chart re-render.
- **All Companies**: tabel scoped (AADC hilang di Nov-2025, muncul lagi di All Time); chip Revision 19→16.
- Mode filter (Submit+Release / Submit only / Release only) + custom range + Reset semua jalan. **0 console error.**
- Catatan kecil (kosmetik, bukan bug data): badge nav ("All Companies 41", "PERTEK & SPI 39") & tombol chip "All" menampilkan grand-total, bukan angka ter-filter; data tabel/KPI/chart tetap ter-filter benar.

## 10. Badge filter + Neon decoupling (lanjutan 09/06/2026)
**Badge ikut ter-filter** (`public/js/03-kpis.js`): `pillMAll/pillMSPI/pillMPending` + `navCountSPI/navCountAll` kini pakai `filteredSPI()/filteredPending()` (sebelumnya pakai global `SPI/PENDING` → grand-total, dan di-overwrite setelah renderMain). Verified browser: All Time 39/41 → Nov 2025 **28/28**; chip All-Companies All 41→28, Issued 39→28, Pending 2→0, Revision 19→16. 0 console error.

**Benar-benar lepas dari Neon** (semua jalur runtime sheets-mode tidak menyentuh Neon):
- `GET /api/company/:code` → di-branch ke store (companies+products+stats+rev+pending+shipments+reapply + getCyclesForSheets). Verified: AMP 2 cycles, shipments, obtained 800.
- `GET /api/ra` → di-branch ke store (22 records). Verified.
- **Boot**: pool warmup (`SELECT 1`) di-skip saat sheets → log "🔥 Pool warmed" hilang; tidak ada koneksi Neon sama sekali.
- `PATCH /api/company/:code` **nested penuh** diport (`patchCompanySheets`): scalar + products + pending_meta + shipments (+`recomputeUtilizationFromLots` ekuivalen) + reapplyTargets + ra. Verified: PATCH shipments(+10) → recompute → restore OK.
- `POST /api/import` tidak menyentuh DB (hanya pesan). `/healthz` & `/health` tanpa DB.
- Realizations sumber A `id` di-backfill (149 baris → id 137..286) → DELETE by-id via UI kini bisa.

## 11. Known limitations (tersisa, inheren)
1. Sheets bukan store transaksional — `patchCompanySheets`/cycle-editor pakai rewrite full-tab per save (bukan atomic). Aman untuk 1 editor; write konkuren tinggi bisa race. Mitigasi opsional: locking/row-index.
2. Optimistic-concurrency token (`_ifUpdatedAt` → 409) hanya aktif di Neon path; di sheets belum dicek (last-write-wins).

## 12d. KEPUTUSAN FINAL: Neon dilepas sepenuhnya, pure Sheets (09/06/2026)
Atas permintaan ("gak usah staging, langsung merge & push, lepaskan neon sepenuhnya"):
- **Default `DATA_SOURCE=sheets`** (server.js) — tanpa env apa pun, app jalan di Google Sheets.
- **Pool Neon di-stub** saat `!ANY_NEON`: `pool.query→{rows:[]}`, `pool.connect→throw` → boot reconcile IIFE & query nyasar TIDAK pernah membuka koneksi Postgres. Kode Neon tetap ada tapi inert.
- Boot log: `default=sheets · Neon detached — Postgres pool is inert · Skipping initDB · (tanpa Pool warmed)`. `/api/data` → X-Data-Source: sheets, 41 company. **Nol koneksi Neon.**
- Staging TIDAK diaktifkan (env `STAGING_*` tak di-set → `STAGING_ENABLED=false`). Infra subdomain tetap ada (dormant) tapi `STAGING_SETUP.md` dihapus.
- `app.json` disederhanakan untuk pure-sheets (GOOGLE_SERVICE_ACCOUNT_JSON wajib di Heroku).
- Deploy: merge `claude/pensive-kapitsa-469583` → `main`, push `origin` + `heroku`. Heroku WAJIB punya config var `GOOGLE_SERVICE_ACCOUNT_JSON` (+ `SHEETS_DB_ID`, `DATA_SOURCE=sheets`).

## 12b. (catatan) Infra subdomain (dormant, tidak dipakai)
Data source jadi **per-request** berdasarkan hostname (bukan global saat boot):
- `server.js`: `AsyncLocalStorage` (`_srcCtx`) + middleware set konteks per request; `inSheets()` ganti `useSheets`. `hostUsesSheets(req)` baca `Host`/`x-forwarded-host`.
- Env: `DATA_SOURCE=neon` (default/prod), `STAGING_HOST_PREFIX=staging.`, `STAGING_DATA_SOURCE=sheets` (atau `STAGING_HOSTS=` daftar exact). `STAGING_ENABLED` aktif hanya bila salah satu env staging di-set.
- Boot warm pakai flag agregat `ANY_NEON`/`ANY_SHEETS` (warm pool & initDB hanya bila Neon aktif; warm store bila Sheets aktif).
- **Cache di-namespace per source** (`dcache`, prefix `n::`/`s::`) → prod & staging tak saling mencemari cache (termasuk prefix-invalidation realization list). Backward-compatible: tanpa staging, key tetap polos.
- `lib/sheetsStore.js`: kredensial dari `GOOGLE_SERVICE_ACCOUNT_JSON`/`GOOGLE_SA_JSON` env (un-escape `\n`) → tak perlu file di Heroku; fallback ke `GOOGLE_SA_KEYFILE`/walk-up.
- Artifacts: `app.json`, `STAGING_SETUP.md` (runbook deploy + DNS), referensi env.

Verifikasi lokal (DATA_SOURCE=neon, STAGING_HOST_PREFIX=staging., STAGING_DATA_SOURCE=sheets):
- `Host: app.*` → **X-Data-Source: neon**, 34 company (Neon B).
- `Host: staging.*` → **X-Data-Source: sheets**, 41 company (Sheet).
- Re-hit: staging tetap 41, prod tetap 34 → **cache terisolasi**. Insights jalan di kedua host.
- Pure-neon default (tanpa env staging): X-Data-Source neon, 34 — **tak ada regresi**.
- Auth env-cred: `GOOGLE_SERVICE_ACCOUNT_JSON` → store baca 41 company (tanpa file).

Yang KAMU jalankan (saya tak punya akses Heroku/DNS): `git push heroku`, `heroku config:set` (env di atas), `heroku domains:add staging.<domain>` + CNAME DNS. Detail di `STAGING_SETUP.md`.

## 12c. TODO berikutnya
- Pindah `service-account.json`/`SHEETS_DB_ID`/`DATA_SOURCE=sheets` ke `.env`/`GOOGLE_SA_KEYFILE` (sekarang keyfile via walk-up).
- Row-index tracking di store (update sel spesifik, hindari rewrite full-tab) + cek `_ifUpdatedAt` di sheets path.
