// routes/companies.js  –  GET/POST/PUT companies
const router = require('express').Router();
const pool   = require('../db/pool');

/* GET /api/companies  –  all companies with group + type */
router.get('/', async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT c.code, c.company_group, c.status_type,
             COALESCE(json_agg(cp.product ORDER BY cp.product) FILTER (WHERE cp.product IS NOT NULL), '[]') AS products
      FROM   companies c
      LEFT JOIN company_products cp ON cp.company_code = c.code
      GROUP BY c.code, c.company_group, c.status_type
      ORDER BY c.company_group, c.code
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

/* GET /api/companies/:code */
router.get('/:code', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.code, c.company_group, c.status_type,
              COALESCE(json_agg(cp.product ORDER BY cp.product) FILTER (WHERE cp.product IS NOT NULL), '[]') AS products
       FROM   companies c
       LEFT JOIN company_products cp ON cp.company_code = c.code
       WHERE  c.code = $1
       GROUP BY c.code, c.company_group, c.status_type`,
      [req.params.code.toUpperCase()]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* POST /api/companies  –  create new company */
router.post('/', async (req, res) => {
  const { code, company_group, status_type = 'spi', products = [] } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO companies(code, company_group, status_type)
       VALUES($1, $2, $3) ON CONFLICT(code) DO NOTHING`,
      [code.toUpperCase(), company_group, status_type]
    );
    for (const p of products) {
      await client.query(
        `INSERT INTO company_products(company_code, product)
         VALUES($1,$2) ON CONFLICT DO NOTHING`,
        [code.toUpperCase(), p]
      );
    }
    await client.query('COMMIT');
    res.status(201).json({ code });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;