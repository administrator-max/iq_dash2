// routes/spi.js  –  SPI records + cycles + revision detail
const router = require('express').Router();
const pool   = require('../db/pool');

/* ── helpers ── */
const parseDateOrNull = (d) => {
  if (!d || d === 'TBA') return null;
  // Accept DD/MM/YYYY or YYYY-MM-DD
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(d)) {
    const [dd, mm, yyyy] = d.split('/');
    return `${yyyy}-${mm}-${dd}`;
  }
  return d;
};

/* ─────────────────────────────────────────────────────────────
   GET /api/spi
   Returns all SPI records joined with cycles, products, revisions
────────────────────────────────────────────────────────────── */
router.get('/', async (_req, res) => {
  try {
    // SPI base records
    const { rows: spiRows } = await pool.query(`
      SELECT s.*,
             c.company_group AS "group",
             COALESCE(json_agg(DISTINCT cp.product) FILTER (WHERE cp.product IS NOT NULL), '[]') AS products
      FROM   spi_records s
      JOIN   companies c  ON c.code = s.company_code
      LEFT JOIN company_products cp ON cp.company_code = s.company_code
      GROUP BY s.company_code, c.company_group
      ORDER BY c.company_group, s.company_code
    `);

    // Attach cycles + cycle_products
    const codes = spiRows.map(r => r.company_code);
    if (!codes.length) return res.json([]);

    const { rows: cycleRows } = await pool.query(`
      SELECT cy.*, json_agg(
        json_build_object('product', cyp.product, 'mt', cyp.mt, 'mt_is_tba', cyp.mt_is_tba)
        ORDER BY cyp.product
      ) FILTER (WHERE cyp.id IS NOT NULL) AS products_detail
      FROM   cycles cy
      LEFT JOIN cycle_products cyp ON cyp.cycle_id = cy.id
      WHERE  cy.company_code = ANY($1)
      GROUP BY cy.id
      ORDER BY cy.company_code, cy.cycle_order
    `, [codes]);

    // Attach revision_changes
    const { rows: revRows } = await pool.query(`
      SELECT * FROM revision_changes WHERE company_code = ANY($1) ORDER BY id
    `, [codes]);

    // Attach per-product utilization
    const { rows: utilRows } = await pool.query(`
      SELECT * FROM spi_product_utilization WHERE company_code = ANY($1)
    `, [codes]);

    // Merge
    const cycleMap  = {};
    const revMap    = {};
    const utilMap   = {};

    cycleRows.forEach(c => {
      (cycleMap[c.company_code] = cycleMap[c.company_code] || []).push(c);
    });
    revRows.forEach(r => {
      (revMap[r.company_code] = revMap[r.company_code] || []).push(r);
    });
    utilRows.forEach(u => {
      utilMap[u.company_code] = utilMap[u.company_code] || {};
      if (u.utilization_mt > 0) utilMap[u.company_code].utilization = utilMap[u.company_code].utilization || {};
      if (u.available_mt   > 0) utilMap[u.company_code].available   = utilMap[u.company_code].available   || {};
      if (u.utilization_mt > 0) utilMap[u.company_code].utilization[u.product] = Number(u.utilization_mt);
      if (u.available_mt   > 0) utilMap[u.company_code].available[u.product]   = Number(u.available_mt);
    });

    const result = spiRows.map(s => ({
      ...s,
      cycles:              cycleMap[s.company_code]  || [],
      revfrom:             (revMap[s.company_code]   || []).filter(r => r.direction === 'from'),
      revto:               (revMap[s.company_code]   || []).filter(r => r.direction === 'to'),
      utilizationbyprod:   (utilMap[s.company_code] || {}).utilization || {},
      availablebyprod:     (utilMap[s.company_code] || {}).available   || {},
    }));

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

/* ─────────────────────────────────────────────────────────────
   GET /api/spi/:code  –  single SPI record
────────────────────────────────────────────────────────────── */
router.get('/:code', async (req, res) => {
  const code = req.params.code.toUpperCase();
  try {
    const { rows } = await pool.query(
      `SELECT s.*, c.company_group AS "group",
              COALESCE(json_agg(DISTINCT cp.product) FILTER (WHERE cp.product IS NOT NULL), '[]') AS products
       FROM   spi_records s
       JOIN   companies c  ON c.code = s.company_code
       LEFT JOIN company_products cp ON cp.company_code = s.company_code
       WHERE  s.company_code = $1
       GROUP BY s.company_code, c.company_group`,
      [code]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });

    const { rows: cycles } = await pool.query(
      `SELECT cy.*, json_agg(json_build_object('product',cyp.product,'mt',cyp.mt,'mt_is_tba',cyp.mt_is_tba) ORDER BY cyp.product)
       FILTER (WHERE cyp.id IS NOT NULL) AS products_detail
       FROM cycles cy LEFT JOIN cycle_products cyp ON cyp.cycle_id = cy.id
       WHERE cy.company_code = $1 GROUP BY cy.id ORDER BY cy.cycle_order`,
      [code]
    );
    const { rows: revs } = await pool.query(
      `SELECT * FROM revision_changes WHERE company_code=$1 ORDER BY id`, [code]
    );
    res.json({ ...rows[0], cycles, revFrom: revs.filter(r=>r.direction==='from'), revTo: revs.filter(r=>r.direction==='to') });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ─────────────────────────────────────────────────────────────
   PUT /api/spi/:code  –  update SPI record (mutable fields)
   Body: { spiRef, revType, revStatus, revNote, statusUpdate,
           spiNo, spiNoDate, pertekNo, remarks }
────────────────────────────────────────────────────────────── */
router.put('/:code', async (req, res) => {
  const code = req.params.code.toUpperCase();
  const {
    spi_ref, rev_type, rev_status, rev_note, status_update,
    spi_no, spi_no_date, pertek_no, remarks,
  } = req.body;
  try {
    const { rowCount } = await pool.query(
      `UPDATE spi_records SET
         spi_ref       = COALESCE($2, spi_ref),
         rev_type      = COALESCE($3, rev_type),
         rev_status    = COALESCE($4, rev_status),
         rev_note      = COALESCE($5, rev_note),
         status_update = COALESCE($6, status_update),
         spi_no        = COALESCE($7, spi_no),
         spi_no_date   = COALESCE($8, spi_no_date),
         pertek_no     = COALESCE($9, pertek_no),
         remarks       = COALESCE($10, remarks),
         updated_at    = NOW()
       WHERE company_code = $1`,
      [code, spi_ref, rev_type, rev_status, rev_note, status_update,
       spi_no, spi_no_date ? parseDateOrNull(spi_no_date) : undefined,
       pertek_no, remarks]
    );
    if (!rowCount) return res.status(404).json({ error: 'Not found' });
    res.json({ updated: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;