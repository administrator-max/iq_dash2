-- ══════════════════════════════════════════════════════════════════
-- IQ DASH — PostgreSQL Schema
-- Import Quota Monitor 2026
-- ══════════════════════════════════════════════════════════════════

-- ── Companies (SPI or PENDING section, plus group) ──────────────
CREATE TABLE IF NOT EXISTS companies (
  code            TEXT PRIMARY KEY,
  grp             TEXT NOT NULL,                -- 'AB','CD','NORMATIF'
  section         TEXT NOT NULL DEFAULT 'SPI',  -- 'SPI' | 'PENDING'
  submit1         NUMERIC,
  obtained        NUMERIC DEFAULT 0,
  utilization_mt  NUMERIC DEFAULT 0,
  available_quota NUMERIC,
  rev_type        TEXT DEFAULT 'none',          -- 'none'|'active'|'complete'
  rev_note        TEXT DEFAULT '',
  rev_submit_date TEXT DEFAULT '',
  rev_status      TEXT DEFAULT '',
  rev_mt          NUMERIC DEFAULT 0,
  remarks         TEXT DEFAULT '',
  spi_ref         TEXT DEFAULT '',
  status_update   TEXT DEFAULT '',
  pertek_no       TEXT DEFAULT '',
  spi_no          TEXT DEFAULT '',
  updated_by      TEXT DEFAULT '',
  updated_date    TEXT DEFAULT '',
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── Company products list ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS company_products (
  id          SERIAL PRIMARY KEY,
  company_code TEXT NOT NULL REFERENCES companies(code) ON DELETE CASCADE,
  product     TEXT NOT NULL,
  sort_order  INT  DEFAULT 0
);

-- ── Cycles (Submit / Obtained / Revision per company) ────────────
CREATE TABLE IF NOT EXISTS cycles (
  id            SERIAL PRIMARY KEY,
  company_code  TEXT NOT NULL REFERENCES companies(code) ON DELETE CASCADE,
  cycle_type    TEXT NOT NULL,    -- e.g. 'Submit #1','Obtained #1','Revision #1'
  mt            TEXT,             -- numeric or 'TBA'
  submit_type   TEXT,
  submit_date   TEXT,
  release_type  TEXT,
  release_date  TEXT,
  status        TEXT DEFAULT '',
  sort_order    INT  DEFAULT 0
);

-- ── Cycle products (per-product MT breakdown per cycle) ───────────
CREATE TABLE IF NOT EXISTS cycle_products (
  id          SERIAL PRIMARY KEY,
  cycle_id    INT  NOT NULL REFERENCES cycles(id) ON DELETE CASCADE,
  product     TEXT NOT NULL,
  mt          TEXT             -- numeric or 'TBA'
);

-- ── Revision FROM/TO product change pairs ─────────────────────────
CREATE TABLE IF NOT EXISTS revision_changes (
  id            SERIAL PRIMARY KEY,
  company_code  TEXT NOT NULL REFERENCES companies(code) ON DELETE CASCADE,
  direction     TEXT NOT NULL,  -- 'from' | 'to'
  product       TEXT NOT NULL,
  mt            NUMERIC,
  label         TEXT DEFAULT '',
  sort_order    INT DEFAULT 0
);

-- ── Per-product utilization / available quota breakdowns ──────────
CREATE TABLE IF NOT EXISTS company_product_stats (
  id              SERIAL PRIMARY KEY,
  company_code    TEXT NOT NULL REFERENCES companies(code) ON DELETE CASCADE,
  product         TEXT NOT NULL,
  utilization_mt  NUMERIC DEFAULT 0,
  available_mt    NUMERIC,
  realization_mt  NUMERIC,
  eta_jkt         TEXT,
  arrived         BOOLEAN DEFAULT FALSE,
  UNIQUE (company_code, product)
);

-- ── RA (Re-Apply / Realization) records ──────────────────────────
CREATE TABLE IF NOT EXISTS ra_records (
  id                   SERIAL PRIMARY KEY,
  company_code         TEXT NOT NULL REFERENCES companies(code) ON DELETE CASCADE,
  product              TEXT,
  berat                NUMERIC DEFAULT 0,
  obtained             NUMERIC DEFAULT 0,
  cargo_arrived        BOOLEAN DEFAULT FALSE,
  real_pct             NUMERIC DEFAULT 0,
  util_pct             NUMERIC,
  arrival_date         DATE,
  eta_jkt              TEXT,
  reapply_est          TEXT,
  reapply_stage        INT DEFAULT 1,           -- 1=normal, 2=submitted
  reapply_product      TEXT,
  reapply_new_total    NUMERIC,
  reapply_prev_obtained NUMERIC,
  reapply_additional   NUMERIC,
  reapply_submit_date  TEXT,
  reapply_status       TEXT,
  target               NUMERIC,
  pertek               TEXT,
  spi                  TEXT,
  catatan              TEXT,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

-- ── Pending company extra fields ─────────────────────────────────
CREATE TABLE IF NOT EXISTS pending_meta (
  company_code TEXT PRIMARY KEY REFERENCES companies(code) ON DELETE CASCADE,
  mt           NUMERIC DEFAULT 0,
  status       TEXT DEFAULT '',
  date         TEXT DEFAULT ''
);

-- ── Shipment lots (Sales / Ops per product per company) ──────────
CREATE TABLE IF NOT EXISTS company_shipments (
  id            SERIAL PRIMARY KEY,
  company_code  TEXT NOT NULL REFERENCES companies(code) ON DELETE CASCADE,
  product       TEXT NOT NULL,
  lot_no        INT  NOT NULL,
  util_mt       NUMERIC DEFAULT 0,
  eta_jkt       TEXT DEFAULT '',
  note          TEXT DEFAULT '',
  real_mt       NUMERIC DEFAULT 0,
  pib_date      TEXT DEFAULT '',
  cargo_arrived BOOLEAN DEFAULT FALSE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_code, product, lot_no)
);

-- ── Re-apply targets per company ─────────────────────────────────
CREATE TABLE IF NOT EXISTS company_reapply_targets (
  id            SERIAL PRIMARY KEY,
  company_code  TEXT NOT NULL REFERENCES companies(code) ON DELETE CASCADE,
  product       TEXT NOT NULL,
  target_mt     NUMERIC,
  submitted     BOOLEAN DEFAULT FALSE,
  submit_date   TEXT DEFAULT '',
  notes         TEXT DEFAULT '',
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_code, product)
);

-- ── Indexes for fast lookups ──────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_cycles_company        ON cycles(company_code);
CREATE INDEX IF NOT EXISTS idx_cycle_products_cycle  ON cycle_products(cycle_id);
CREATE INDEX IF NOT EXISTS idx_ra_company            ON ra_records(company_code);
CREATE INDEX IF NOT EXISTS idx_company_products_co   ON company_products(company_code);
CREATE INDEX IF NOT EXISTS idx_company_stats_co      ON company_product_stats(company_code);
CREATE INDEX IF NOT EXISTS idx_shipments_co          ON company_shipments(company_code);