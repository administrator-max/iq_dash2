// routes/save.js  –  Bulk save endpoint (mirrors saveToStorage JS logic)
// POST /api/save  –  Upserts mutable RA + SPI fields in one transaction
const router = require('express').Router();
const pool   = require('../db/pool');

/*
  Body shape (mirrors quotaDashboard_v1 localStorage format):
  {
    ts: ISO string,
    ra: {
      "CGK": { berat, realPct, utilPct, cargoArrived, arrivalDate,
               etaJKT, pibReleaseDate, reapplyEst, reapplySubmitted, target }
    },
    spi: {
      "HDP": { spiRef, remarks, revType, revStatus, revNote, statusUpdate }
    },
    shipments: {
      "CGK": {
        "GL BORON": [
          { lot_number, util_mt, eta_jkt, arrived, real_mt, pib_date }
        ]
      }
    },
    performed_by: "username or role string"
  }
*/
router.post('/', async (req, res) => {
  const { ra = {}, spi = {}, shipments = {}, performed_by = 'dashboard', ts } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── Update RA records ─────────────────────────────────────
    for (const [code, fields] of Object.entries(ra)) {
      await client.query(
        `UPDATE ra_records SET
           berat            = COALESCE($2, berat),
           real_pct         = COALESCE($3, real_pct),
           util_pct         = COALESCE($4, util_pct),
           cargo_arrived    = COALESCE($5, cargo_arrived),
           arrival_date     = COALESCE($6::date, arrival_date),
           eta_jkt          = COALESCE($7, eta_jkt),
           pib_release_date = COALESCE($8::date, pib_release_date),
           reapply_est      = COALESCE($9, reapply_est),
           reapply_stage    = COALESCE($10, reapply_stage),
           target_mt        = COALESCE($11, target_mt),
           updated_at       = NOW()
         WHERE company_code = $1`,
        [
          code.toUpperCase(),
          fields.berat        ?? null,
          fields.realPct      ?? null,
          fields.utilPct      ?? null,
          fields.cargoArrived ?? null,
          parseDate(fields.arrivalDate),
          fields.etaJKT       ?? null,
          parseDate(fields.pibReleaseDate),
          fields.reapplyEst   ?? null,
          fields.reapplyStage ?? (fields.reapplySubmitted ? 2 : null),
          fields.target       ?? null,
        ]
      );
    }

    // ── Update SPI records ────────────────────────────────────
    for (const [code, fields] of Object.entries(spi)) {
      await client.query(
        `UPDATE spi_records SET
           spi_ref       = COALESCE($2, spi_ref),
           remarks       = COALESCE($3, remarks),
           rev_type      = COALESCE($4, rev_type),
           rev_status    = COALESCE($5, rev_status),
           rev_note      = COALESCE($6, rev_note),
           status_update = COALESCE($7, status_update),
           updated_at    = NOW()
         WHERE company_code = $1`,
        [
          code.toUpperCase(),
          fields.spiRef      ?? null,
          fields.remarks     ?? null,
          fields.revType     ?? null,
          fields.revStatus   ?? null,
          fields.revNote     ?? null,
          fields.statusUpdate ?? null,
        ]
      );
    }

    // ── Upsert Shipment lots ──────────────────────────────────
    for (const [code, productMap] of Object.entries(shipments)) {
      for (const [product, lots] of Object.entries(productMap)) {
        for (const lot of lots) {
          await client.query(
            `INSERT INTO shipments(company_code, product, lot_number, util_mt, eta_jkt, arrived, real_mt, pib_date)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8::date)
             ON CONFLICT(company_code, product, lot_number) DO UPDATE SET
               util_mt    = EXCLUDED.util_mt,
               eta_jkt    = EXCLUDED.eta_jkt,
               arrived    = EXCLUDED.arrived,
               real_mt    = EXCLUDED.real_mt,
               pib_date   = EXCLUDED.pib_date,
               updated_at = NOW()`,
            [
              code.toUpperCase(),
              product,
              lot.lot || lot.lot_number || 1,
              lot.utilMT  || lot.util_mt  || 0,
              lot.etaJKT  || lot.eta_jkt  || null,
              lot.arrived || false,
              lot.realMT  || lot.real_mt  || 0,
              parseDate(lot.pibDate || lot.pib_date),
            ]
          );
        }
      }
    }

    // ── Audit log ─────────────────────────────────────────────
    await client.query(
      `INSERT INTO audit_log(action, payload, performed_by)
       VALUES('SAVE', $1, $2)`,
      [
        JSON.stringify({ ra_codes: Object.keys(ra), spi_codes: Object.keys(spi) }),
        performed_by,
      ]
    );

    await client.query('COMMIT');
    res.json({ saved: true, ts: new Date().toISOString() });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Save error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

/* GET /api/save/status  –  mirrors updateStorageStatus() */
router.get('/status', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT performed_at, payload->>'ra_codes' AS ra_codes
       FROM audit_log WHERE action='SAVE'
       ORDER BY performed_at DESC LIMIT 1`
    );
    if (!rows.length) return res.json({ saved: false });
    res.json({
      saved: true,
      last_saved: rows[0].performed_at,
      ra_codes: rows[0].ra_codes,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── helper ── */
function parseDate(val) {
  if (!val || val === 'TBA') return null;
  // DD/MM/YYYY → YYYY-MM-DD
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(val)) {
    const [d, m, y] = val.split('/');
    return `${y}-${m}-${d}`;
  }
  return val;
}

module.exports = router;