// routes/shipments.js  –  Per-product per-lot shipment records
const router = require('express').Router();
const pool   = require('../db/pool');

/* GET /api/shipments/:code  –  all lots for a company */
router.get('/:code', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM shipments WHERE company_code = $1
       ORDER BY product, lot_number`,
      [req.params.code.toUpperCase()]
    );
    // Group by product → array of lots (mirrors JS shipments[product][lotIdx])
    const grouped = {};
    rows.forEach(r => {
      (grouped[r.product] = grouped[r.product] || []).push(r);
    });
    res.json(grouped);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* GET /api/shipments  –  all shipments (for charts) */
router.get('/', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT s.*, c.company_group AS "group"
       FROM shipments s JOIN companies c ON c.code = s.company_code
       ORDER BY s.company_code, s.product, s.lot_number`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* POST /api/shipments  –  add a new shipment lot
   Body: { company_code, product, lot_number, util_mt, eta_jkt } */
router.post('/', async (req, res) => {
  const { company_code, product, lot_number = 1, util_mt = 0, eta_jkt = null } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO shipments(company_code, product, lot_number, util_mt, eta_jkt)
       VALUES($1,$2,$3,$4,$5)
       ON CONFLICT(company_code, product, lot_number) DO UPDATE
         SET util_mt=EXCLUDED.util_mt, eta_jkt=EXCLUDED.eta_jkt, updated_at=NOW()
       RETURNING *`,
      [company_code.toUpperCase(), product, lot_number, util_mt, eta_jkt]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* PUT /api/shipments/:id  –  update a lot (ETA, arrived, realMT, pibDate)
   Body: { util_mt, eta_jkt, arrived, real_mt, pib_date } */
router.put('/:id', async (req, res) => {
  const { util_mt, eta_jkt, arrived, real_mt, pib_date } = req.body;
  try {
    const { rows, rowCount } = await pool.query(
      `UPDATE shipments SET
         util_mt    = COALESCE($2, util_mt),
         eta_jkt    = COALESCE($3, eta_jkt),
         arrived    = COALESCE($4, arrived),
         real_mt    = COALESCE($5, real_mt),
         pib_date   = COALESCE($6, pib_date),
         updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [req.params.id, util_mt, eta_jkt, arrived, real_mt, pib_date]
    );
    if (!rowCount) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* DELETE /api/shipments/:id */
router.delete('/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM shipments WHERE id = $1`, [req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Not found' });
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* PUT /api/shipments/:code/mark-arrived
   Body: { product, lot_number, real_mt, pib_date }
   Marks a lot as arrived, sets real_mt & pib_date */
router.put('/:code/mark-arrived', async (req, res) => {
  const { product, lot_number, real_mt, pib_date } = req.body;
  try {
    const { rows, rowCount } = await pool.query(
      `UPDATE shipments SET
         arrived  = TRUE,
         real_mt  = COALESCE($4, real_mt),
         pib_date = COALESCE($5, pib_date),
         updated_at = NOW()
       WHERE company_code=$1 AND product=$2 AND lot_number=$3
       RETURNING *`,
      [req.params.code.toUpperCase(), product, lot_number, real_mt, pib_date]
    );
    if (!rowCount) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;