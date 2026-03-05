// routes/pending.js  –  Pending company records
const router = require('express').Router();
const pool   = require('../db/pool');

/* GET /api/pending */
router.get('/', async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT p.*, c.company_group AS "group",
             COALESCE(json_agg(cp.product ORDER BY cp.product)
               FILTER (WHERE cp.product IS NOT NULL), '[]') AS products,
             COALESCE(
               (SELECT json_agg(
                  json_build_object(
                    'company_code',    cy.company_code,
                    'cycle_order',     cy.cycle_order,
                    'cycle_type',      cy.cycle_type,
                    'mt',              cy.mt,
                    'mt_is_tba',       cy.mt_is_tba,
                    'submit_type',     cy.submit_type,
                    'submit_date',     cy.submit_date,
                    'submit_date_tba', cy.submit_date_tba,
                    'release_type',    cy.release_type,
                    'release_date',    cy.release_date,
                    'release_date_tba',cy.release_date_tba,
                    'status',          cy.status,
                    'products_detail', (
                      SELECT json_agg(json_build_object(
                        'product',    cyp.product,
                        'mt',         cyp.mt,
                        'mt_is_tba',  cyp.mt_is_tba
                      ))
                      FROM cycle_products cyp WHERE cyp.cycle_id = cy.id
                    )
                  ) ORDER BY cy.cycle_order
                )
                FROM cycles cy WHERE cy.company_code = p.company_code), '[]'
             ) AS cycles
      FROM   pending_companies p
      JOIN   companies c  ON c.code = p.company_code
      LEFT JOIN company_products cp ON cp.company_code = p.company_code
      GROUP BY p.company_code, c.company_group
      ORDER BY c.company_group, p.company_code
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* PUT /api/pending/:code  –  update status / remarks */
router.put('/:code', async (req, res) => {
  const { status, remarks, status_date } = req.body;
  try {
    const { rowCount } = await pool.query(
      `UPDATE pending_companies
       SET status=$2, remarks=$3, status_date=$4, updated_at=NOW()
       WHERE company_code=$1`,
      [req.params.code.toUpperCase(), status, remarks, status_date || null]
    );
    if (!rowCount) return res.status(404).json({ error: 'Not found' });
    res.json({ updated: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;