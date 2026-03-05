-- ============================================================
--  Import Quota Monitor 2026 — PostgreSQL Schema
--  Target: Neon (neondb) · ap-southeast-1
--  Generated from IQDash_shipment_updated_050326__new_.html
-- ============================================================

-- ── 1. COMPANIES ────────────────────────────────────────────
-- Master list of all companies (SPI + PENDING)
CREATE TABLE IF NOT EXISTS companies (
  code          VARCHAR(10)  PRIMARY KEY,          -- e.g. 'EMS', 'HDP', 'KARA'
  company_group VARCHAR(20)  NOT NULL,             -- 'AB' | 'CD' | 'NORMATIF'
  status_type   VARCHAR(10)  NOT NULL DEFAULT 'spi', -- 'spi' | 'pending'
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── 2. COMPANY_PRODUCTS ─────────────────────────────────────
-- One company can hold multiple products (e.g. GKL has 3)
CREATE TABLE IF NOT EXISTS company_products (
  id           SERIAL       PRIMARY KEY,
  company_code VARCHAR(10)  NOT NULL REFERENCES companies(code) ON DELETE CASCADE,
  product      VARCHAR(60)  NOT NULL,  -- 'GL BORON' | 'GI BORON' | 'SHEETPILE' | etc.
  UNIQUE (company_code, product)
);

-- ── 3. SPI_RECORDS ──────────────────────────────────────────
-- Core SPI financial / quota record (one row per company)
CREATE TABLE IF NOT EXISTS spi_records (
  company_code      VARCHAR(10)  PRIMARY KEY REFERENCES companies(code) ON DELETE CASCADE,
  submit1_mt        NUMERIC(12,2) NOT NULL DEFAULT 0,   -- original submission MT to MOI
  obtained_mt       NUMERIC(12,2) NOT NULL DEFAULT 0,   -- total PERTEK obtained MT
  utilization_mt    NUMERIC(12,2) NOT NULL DEFAULT 0,   -- total sold/allocated MT
  available_quota   NUMERIC(12,2) NOT NULL DEFAULT 0,   -- obtained − utilization
  rev_type          VARCHAR(20)  NOT NULL DEFAULT 'none', -- 'none'|'active'|'complete'|'revpending'
  rev_note          TEXT,
  rev_submit_date   DATE,
  rev_status        VARCHAR(200),
  rev_mt            NUMERIC(12,2) DEFAULT 0,
  remarks           TEXT,
  spi_ref           TEXT,
  spi_no            VARCHAR(100),
  spi_no_date       DATE,
  pertek_no         VARCHAR(100),
  status_update     TEXT,
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── 4. SPI_PRODUCT_UTILIZATION ──────────────────────────────
-- Per-product utilization breakdown (utilizationByProd JSON flattened)
CREATE TABLE IF NOT EXISTS spi_product_utilization (
  id              SERIAL       PRIMARY KEY,
  company_code    VARCHAR(10)  NOT NULL REFERENCES companies(code) ON DELETE CASCADE,
  product         VARCHAR(60)  NOT NULL,
  utilization_mt  NUMERIC(12,2) NOT NULL DEFAULT 0,
  available_mt    NUMERIC(12,2) NOT NULL DEFAULT 0,
  UNIQUE (company_code, product)
);

-- ── 5. REVISION_CHANGES ─────────────────────────────────────
-- Stores revFrom / revTo arrays (product change detail)
CREATE TABLE IF NOT EXISTS revision_changes (
  id            SERIAL      PRIMARY KEY,
  company_code  VARCHAR(10) NOT NULL REFERENCES companies(code) ON DELETE CASCADE,
  direction     VARCHAR(5)  NOT NULL CHECK (direction IN ('from','to')),
  product       VARCHAR(60) NOT NULL,
  mt            NUMERIC(12,2),
  label         VARCHAR(100)
);

-- ── 6. CYCLES ───────────────────────────────────────────────
-- Every submission/obtained/revision cycle per company
-- Maps the `cycles[]` array in the JS data
CREATE TABLE IF NOT EXISTS cycles (
  id              SERIAL       PRIMARY KEY,
  company_code    VARCHAR(10)  NOT NULL REFERENCES companies(code) ON DELETE CASCADE,
  cycle_order     SMALLINT     NOT NULL,            -- 1,2,3… for ordering
  cycle_type      VARCHAR(80)  NOT NULL,            -- 'Submit #1' | 'Obtained #1' | 'Revision #1' | etc.
  mt              NUMERIC(12,2),                    -- NULL when 'TBA'
  mt_is_tba       BOOLEAN      NOT NULL DEFAULT FALSE,
  submit_type     VARCHAR(120),                     -- 'Submit MOI' | 'Submit MOT' | etc.
  submit_date     DATE,
  submit_date_tba BOOLEAN      NOT NULL DEFAULT FALSE,
  release_type    VARCHAR(120),                     -- 'PERTEK' | 'SPI' | 'PERTEK Perubahan' | etc.
  release_date    DATE,
  release_date_tba BOOLEAN     NOT NULL DEFAULT FALSE,
  status          TEXT,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── 7. CYCLE_PRODUCTS ───────────────────────────────────────
-- Per-product MT breakdown inside each cycle (products:{} object)
CREATE TABLE IF NOT EXISTS cycle_products (
  id            SERIAL       PRIMARY KEY,
  cycle_id      INTEGER      NOT NULL REFERENCES cycles(id) ON DELETE CASCADE,
  product       VARCHAR(60)  NOT NULL,
  mt            NUMERIC(12,2),
  mt_is_tba     BOOLEAN      NOT NULL DEFAULT FALSE
);

-- ── 8. RA_RECORDS ───────────────────────────────────────────
-- Re-Apply / Realization data (the `RA` array)
CREATE TABLE IF NOT EXISTS ra_records (
  company_code          VARCHAR(10)  PRIMARY KEY REFERENCES companies(code) ON DELETE CASCADE,
  product               VARCHAR(80),                    -- short label e.g. 'GL', 'GI', 'SHEETPILE'
  berat                 NUMERIC(12,2) NOT NULL DEFAULT 0,  -- allocated/realized tonnage
  obtained_mt           NUMERIC(12,2) NOT NULL DEFAULT 0,
  cargo_arrived         BOOLEAN      NOT NULL DEFAULT FALSE,
  real_pct              NUMERIC(6,4)  NOT NULL DEFAULT 0,  -- e.g. 0.9530
  util_pct              NUMERIC(6,4),                     -- NULL when cargo arrived
  arrival_date          DATE,
  eta_jkt               VARCHAR(200),
  reapply_est           VARCHAR(80),
  reapply_stage         SMALLINT,                          -- NULL | 2
  reapply_product       VARCHAR(80),
  reapply_new_total     NUMERIC(12,2),
  reapply_prev_obtained NUMERIC(12,2),
  reapply_additional    NUMERIC(12,2),
  reapply_submit_date   DATE,
  reapply_status        TEXT,
  target_mt             NUMERIC(12,2),
  pertek                VARCHAR(120),
  spi                   VARCHAR(80),
  catatan               TEXT,
  pib_release_date      DATE,
  updated_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── 9. SHIPMENTS ────────────────────────────────────────────
-- Per-product, per-lot shipment records (shipments:{} nested object)
-- shipments[product][lotIndex] → { utilMT, etaJKT, arrived, realMT, pibDate }
CREATE TABLE IF NOT EXISTS shipments (
  id              SERIAL       PRIMARY KEY,
  company_code    VARCHAR(10)  NOT NULL REFERENCES companies(code) ON DELETE CASCADE,
  product         VARCHAR(60)  NOT NULL,
  lot_number      SMALLINT     NOT NULL DEFAULT 1,
  util_mt         NUMERIC(12,2) NOT NULL DEFAULT 0,    -- sales allocation for this lot
  eta_jkt         VARCHAR(100),                        -- e.g. '07 Mar 26'
  arrived         BOOLEAN      NOT NULL DEFAULT FALSE,
  real_mt         NUMERIC(12,2) NOT NULL DEFAULT 0,    -- realization MT (ops confirms)
  pib_date        DATE,                                -- PIB Release Date
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (company_code, product, lot_number)
);

-- ── 10. PENDING_COMPANIES ───────────────────────────────────
-- Companies still awaiting MoI approval (PENDING array)
CREATE TABLE IF NOT EXISTS pending_companies (
  company_code    VARCHAR(10)  PRIMARY KEY REFERENCES companies(code) ON DELETE CASCADE,
  mt_requested    NUMERIC(12,2) NOT NULL DEFAULT 0,
  remarks         TEXT,
  status          TEXT,
  status_date     DATE,
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── 11. REAPPLY_TARGETS ─────────────────────────────────────
-- Per-product re-apply target MT (reapplyProdTableWrap form)
CREATE TABLE IF NOT EXISTS reapply_targets (
  id              SERIAL       PRIMARY KEY,
  company_code    VARCHAR(10)  NOT NULL REFERENCES companies(code) ON DELETE CASCADE,
  product         VARCHAR(60)  NOT NULL,
  target_mt       NUMERIC(12,2) NOT NULL DEFAULT 0,
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (company_code, product)
);

-- ── 12. AUDIT_LOG ───────────────────────────────────────────
-- Tracks every save event (mirrors manualSave / saveToStorage)
CREATE TABLE IF NOT EXISTS audit_log (
  id              SERIAL       PRIMARY KEY,
  company_code    VARCHAR(10),
  action          VARCHAR(80)  NOT NULL,  -- 'SAVE' | 'RESET' | 'IMPORT' | 'UPDATE_SHIPMENT'
  payload         JSONB,
  performed_by    VARCHAR(80),
  performed_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── INDEXES ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_cycles_company          ON cycles(company_code);
CREATE INDEX IF NOT EXISTS idx_cycle_products_cycle    ON cycle_products(cycle_id);
CREATE INDEX IF NOT EXISTS idx_shipments_company       ON shipments(company_code);
CREATE INDEX IF NOT EXISTS idx_spi_product_util_co     ON spi_product_utilization(company_code);
CREATE INDEX IF NOT EXISTS idx_revision_changes_co     ON revision_changes(company_code);
CREATE INDEX IF NOT EXISTS idx_reapply_targets_co      ON reapply_targets(company_code);
CREATE INDEX IF NOT EXISTS idx_audit_log_company       ON audit_log(company_code);
CREATE INDEX IF NOT EXISTS idx_audit_log_performed_at  ON audit_log(performed_at DESC);

-- ── UPDATED_AT TRIGGER ───────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN 
  NEW.updated_at = NOW(); 
  RETURN NEW; 
END;
$$;

DO $$ DECLARE t TEXT;
BEGIN
  FOR t IN VALUES ('spi_records'),('ra_records'),('shipments'),
                  ('pending_companies'),('reapply_targets'),('companies')
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_upd_%I ON %I', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_upd_%I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
      t, t
    );
  END LOOP;
END $$;