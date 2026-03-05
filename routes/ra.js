// routes/ra.js  –  Re-Apply / Realization records (RA array)
const router = require('express').Router();
const pool   = require('../db/pool');

/* GET /api/ra  –  all RA records */
router.get('/', async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT r.*,
             c.company_group AS "group",
             COALESCE(json_agg(cp.product ORDER BY cp.product)
               FILTER (WHERE cp.product IS NOT NULL), '[]') AS products
      FROM   ra_records r
      JOIN   companies c  ON c.code = r.company_code
      LEFT JOIN company_products cp ON cp.company_code = r.company_code
      GROUP BY r.company_code, c.company_group
      ORDER BY r.cargo_arrived DESC, r.real_pct DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

/* GET /api/ra/:code */
router.get('/:code', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT r.*, c.company_group AS "group"
       FROM ra_records r JOIN companies c ON c.code = r.company_code
       WHERE r.company_code = $1`,
      [req.params.code.toUpperCase()]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* PUT /api/ra/:code  –  mutable fields: berat, realPct, utilPct,
                         cargoArrived, arrivalDate, etaJKT,
                         pibReleaseDate, reapplyEst, reapplySubmitted, target */
router.put('/:code', async (req, res) => {
  const code = req.params.code.toUpperCase();
  const {
    berat, real_pct, util_pct, cargo_arrived,
    arrival_date, eta_jkt, pib_release_date,
    reapply_est, reapply_stage, target_mt, catatan,
    reapply_status,
  } = req.body;

  try {
    const { rowCount } = await pool.query(
      `UPDATE ra_records SET
         berat              = COALESCE($2,  berat),
         real_pct           = COALESCE($3,  real_pct),
         util_pct           = COALESCE($4,  util_pct),
         cargo_arrived      = COALESCE($5,  cargo_arrived),
         arrival_date       = COALESCE($6,  arrival_date),
         eta_jkt            = COALESCE($7,  eta_jkt),
         pib_release_date   = COALESCE($8,  pib_release_date),
         reapply_est        = COALESCE($9,  reapply_est),
         reapply_stage      = COALESCE($10, reapply_stage),
         target_mt          = COALESCE($11, target_mt),
         catatan            = COALESCE($12, catatan),
         reapply_status     = COALESCE($13, reapply_status),
         updated_at         = NOW()
       WHERE company_code = $1`,
      [code, berat, real_pct, util_pct, cargo_arrived,
       arrival_date, eta_jkt, pib_release_date,
       reapply_est, reapply_stage, target_mt, catatan, reapply_status]
    );
    if (!rowCount) return res.status(404).json({ error: 'Not found' });
    res.json({ updated: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;