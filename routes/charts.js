// routes/charts.js  –  All chart data endpoints
// Covers every Chart.js canvas in IQDash:
//   buildPipeline        → GET /api/charts/pipeline
//   buildProductDonut    → GET /api/charts/product-donut
//   buildTopCo           → GET /api/charts/top-companies
//   buildCmpChart        → GET /api/charts/quota-comparison
//   buildGauge           → GET /api/charts/realization-gauge
//   buildUtilChart       → GET /api/charts/utilization-bar
//   buildAvailableQuota  → GET /api/charts/available-quota
//   buildLeadTimeAnalytics → GET /api/charts/lead-time
//   Overview KPIs        → GET /api/charts/overview-kpis

const router = require('express').Router();
const pool   = require('../db/pool');

/* ═══════════════════════════════════════════════════════════
   1. OVERVIEW KPI CARDS
   Returns: totalSubmit, totalObtained, totalUtilization,
            totalAvailable, totalCompanies, spiCount,
            pendingCount, revisionActiveCount
═══════════════════════════════════════════════════════════ */
router.get('/overview-kpis', async (req, res) => {
  try {
    const { from, to } = req.query;

    const dateFilter = buildCycleDateFilter(from, to, 'cy');

    const { rows } = await pool.query(`
      SELECT
        COUNT(DISTINCT s.company_code)                       AS total_companies,
        SUM(s.submit1_mt)                                    AS total_submit,
        SUM(s.obtained_mt)                                   AS total_obtained,
        SUM(s.utilization_mt)                                AS total_utilization,
        SUM(s.available_quota)                               AS total_available,
        COUNT(*) FILTER (WHERE s.rev_type = 'active')        AS revision_active_count,
        COUNT(*) FILTER (WHERE s.rev_type = 'complete')      AS revision_complete_count
      FROM spi_records s
      ${dateFilter.where ? 'WHERE ' + dateFilter.where : ''}
    `, dateFilter.params);

    const { rows: pending } = await pool.query(
      `SELECT COUNT(*) AS cnt FROM pending_companies`
    );

    const { rows: eligRows } = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE r.real_pct >= 0.6 AND r.cargo_arrived AND r.reapply_stage IS DISTINCT FROM 2) AS eligible,
        COUNT(*) FILTER (WHERE r.reapply_stage = 2)                                                          AS reapply_submitted,
        COUNT(*) FILTER (WHERE NOT r.cargo_arrived)                                                          AS in_shipment,
        COUNT(*) FILTER (WHERE r.cargo_arrived AND r.real_pct < 0.6)                                        AS below_threshold
      FROM ra_records r
    `);

    res.json({
      ...rows[0],
      pending_count: Number(pending[0].cnt),
      ...eligRows[0],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

/* ═══════════════════════════════════════════════════════════
   2. PIPELINE CHART  (buildPipeline)
   Horizontal funnel: Submit MOI → PERTEK Terbit → SPI Issued → Re-Apply
   Returns: stages with total_mt and company_count
═══════════════════════════════════════════════════════════ */
router.get('/pipeline', async (req, res) => {
  try {
    const { from, to } = req.query;
    const { rows } = await pool.query(`
      SELECT
        SUM(s.submit1_mt)                                         AS submit_moi_mt,
        COUNT(s.company_code)                                     AS submit_moi_count,
        SUM(s.obtained_mt)                                        AS pertek_obtained_mt,
        COUNT(s.company_code) FILTER (WHERE s.obtained_mt > 0)   AS pertek_obtained_count,
        (SELECT SUM(s2.obtained_mt) FROM spi_records s2
         WHERE EXISTS (
           SELECT 1 FROM cycles cy2
           WHERE cy2.company_code = s2.company_code
             AND cy2.release_type ILIKE '%SPI%' AND cy2.release_date IS NOT NULL
         ))                                                        AS spi_issued_mt,
        (SELECT COUNT(DISTINCT s2.company_code) FROM spi_records s2
         WHERE EXISTS (
           SELECT 1 FROM cycles cy2
           WHERE cy2.company_code = s2.company_code
             AND cy2.release_type ILIKE '%SPI%' AND cy2.release_date IS NOT NULL
         ))                                                        AS spi_issued_count
      FROM spi_records s
    `);

    const { rows: raRows } = await pool.query(`
      SELECT SUM(r.berat) AS reapply_mt, COUNT(*) AS reapply_count
      FROM ra_records r
      WHERE r.reapply_stage = 2
    `);

    const { rows: pendRows } = await pool.query(
      `SELECT SUM(mt_requested) AS pending_mt, COUNT(*) AS pending_count FROM pending_companies`
    );

    res.json({
      stages: [
        { label: 'Submit MOI',       mt: rows[0].submit_moi_mt,      count: rows[0].submit_moi_count },
        { label: 'PERTEK Obtained',  mt: rows[0].pertek_obtained_mt, count: rows[0].pertek_obtained_count },
        { label: 'SPI Issued',       mt: rows[0].spi_issued_mt,      count: rows[0].spi_issued_count },
        { label: 'Re-Apply Submitted', mt: raRows[0].reapply_mt,     count: raRows[0].reapply_count },
      ],
      pending: { mt: pendRows[0].pending_mt, count: pendRows[0].pending_count },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ═══════════════════════════════════════════════════════════
   3. PRODUCT DONUT  (buildProductDonut)
   Returns: per-product total obtained MT + contributing companies
═══════════════════════════════════════════════════════════ */
router.get('/product-donut', async (req, res) => {
  try {
    const { from, to } = req.query;
    const { rows } = await pool.query(`
      SELECT
        cp.product,
        SUM(s.obtained_mt)                                          AS obtained_mt,
        COUNT(DISTINCT s.company_code)                              AS company_count,
        json_agg(DISTINCT s.company_code ORDER BY s.company_code)   AS companies
      FROM company_products cp
      JOIN spi_records s ON s.company_code = cp.company_code
      GROUP BY cp.product
      ORDER BY obtained_mt DESC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ═══════════════════════════════════════════════════════════
   4. TOP COMPANIES  (buildTopCo)
   Returns: companies sorted by obtained_mt desc, top 10
═══════════════════════════════════════════════════════════ */
router.get('/top-companies', async (req, res) => {
  try {
    const limit = Number(req.query.limit) || 10;
    const { rows } = await pool.query(`
      SELECT
        s.company_code,
        c.company_group,
        s.obtained_mt,
        s.utilization_mt,
        s.available_quota,
        COALESCE(json_agg(DISTINCT cp.product) FILTER (WHERE cp.product IS NOT NULL), '[]') AS products,
        ROUND(s.utilization_mt / NULLIF(s.obtained_mt,0) * 100, 1) AS util_pct
      FROM spi_records s
      JOIN companies c ON c.code = s.company_code
      LEFT JOIN company_products cp ON cp.company_code = s.company_code
      GROUP BY s.company_code, c.company_group, s.obtained_mt, s.utilization_mt, s.available_quota
      ORDER BY s.obtained_mt DESC
      LIMIT $1
    `, [limit]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ═══════════════════════════════════════════════════════════
   5. QUOTA COMPARISON  (buildCmpChart)
   Returns: per-company comparison of submit1 vs obtained
═══════════════════════════════════════════════════════════ */
router.get('/quota-comparison', async (req, res) => {
  try {
    const { group } = req.query;   // optional: 'AB' | 'CD' | 'NORMATIF'
    const params = [];
    let where = '';
    if (group) { params.push(group); where = `WHERE c.company_group = $1`; }

    const { rows } = await pool.query(`
      SELECT
        s.company_code,
        c.company_group,
        s.submit1_mt,
        s.obtained_mt,
        s.utilization_mt,
        s.available_quota,
        ROUND(s.obtained_mt / NULLIF(s.submit1_mt,0) * 100, 1) AS approval_rate_pct,
        COALESCE(json_agg(DISTINCT cp.product) FILTER (WHERE cp.product IS NOT NULL), '[]') AS products
      FROM spi_records s
      JOIN companies c ON c.code = s.company_code
      LEFT JOIN company_products cp ON cp.company_code = s.company_code
      ${where}
      GROUP BY s.company_code, c.company_group, s.submit1_mt, s.obtained_mt, s.utilization_mt, s.available_quota
      ORDER BY c.company_group, s.company_code
    `, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ═══════════════════════════════════════════════════════════
   6. REALIZATION GAUGE  (buildGauge)
   Returns: avg realization %, total realized MT, remaining MT,
            count by eligibility band
═══════════════════════════════════════════════════════════ */
router.get('/realization-gauge', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        ROUND(AVG(r.real_pct) FILTER (WHERE r.cargo_arrived) * 100, 1) AS avg_real_pct,
        SUM(r.berat)          FILTER (WHERE r.cargo_arrived)            AS total_realized_mt,
        SUM(r.obtained_mt - r.berat) FILTER (WHERE r.cargo_arrived)    AS remaining_mt,
        COUNT(*) FILTER (WHERE r.real_pct >= 0.6 AND r.cargo_arrived AND r.reapply_stage IS DISTINCT FROM 2) AS eligible_count,
        COUNT(*) FILTER (WHERE r.reapply_stage = 2)                                                          AS reapply_submitted_count,
        COUNT(*) FILTER (WHERE NOT r.cargo_arrived)                                                          AS in_shipment_count,
        COUNT(*) FILTER (WHERE r.cargo_arrived AND r.real_pct < 0.6)                                        AS below_threshold_count
      FROM ra_records r
    `);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ═══════════════════════════════════════════════════════════
   7. UTILIZATION BAR CHART  (buildUtilChart)
   Returns: per-company realPct + utilPct + cargoArrived flag
═══════════════════════════════════════════════════════════ */
router.get('/utilization-bar', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        r.company_code,
        c.company_group,
        r.product,
        r.berat,
        r.obtained_mt,
        r.cargo_arrived,
        r.real_pct,
        r.util_pct,
        r.eta_jkt,
        r.reapply_stage,
        CASE
          WHEN r.real_pct >= 0.6 AND r.cargo_arrived AND r.reapply_stage IS DISTINCT FROM 2 THEN 'eligible'
          WHEN r.reapply_stage = 2 THEN 'reapply_submitted'
          WHEN NOT r.cargo_arrived THEN 'in_shipment'
          ELSE 'below_threshold'
        END AS eligibility
      FROM ra_records r
      JOIN companies c ON c.code = r.company_code
      ORDER BY r.real_pct DESC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ═══════════════════════════════════════════════════════════
   8. AVAILABLE QUOTA BAR CHART  (buildAvailableQuota)
   Returns: per-company per-product obtained / utilized / available
═══════════════════════════════════════════════════════════ */
router.get('/available-quota', async (req, res) => {
  try {
    const { product } = req.query;  // optional product filter
    const params = [];
    let productWhere = '';
    if (product) { params.push(product); productWhere = `AND u.product = $1`; }

    const { rows } = await pool.query(`
      SELECT
        u.company_code,
        c.company_group,
        u.product,
        u.available_mt,
        u.utilization_mt,
        s.obtained_mt,
        ROUND(u.utilization_mt / NULLIF(s.obtained_mt, 0) * 100, 1) AS util_pct
      FROM spi_product_utilization u
      JOIN spi_records s ON s.company_code = u.company_code
      JOIN companies c   ON c.code = u.company_code
      WHERE s.obtained_mt > 0
        ${productWhere}
      ORDER BY u.available_mt DESC
    `, params);

    const { rows: totals } = await pool.query(`
      SELECT
        SUM(u.available_mt)    AS total_available,
        SUM(u.utilization_mt)  AS total_utilized,
        COUNT(DISTINCT u.company_code) AS company_count
      FROM spi_product_utilization u
      WHERE u.available_mt > 0
    `);

    res.json({ rows, totals: totals[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ═══════════════════════════════════════════════════════════
   9. LEAD TIME ANALYTICS  (buildLeadTimeAnalytics)
   Returns: per-company lead times for each cycle step
   submit_moi → pertek_release → submit_mot → spi_release
═══════════════════════════════════════════════════════════ */
router.get('/lead-time', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      WITH submit_cycles AS (
        SELECT
          cy.company_code,
          cy.cycle_order,
          cy.cycle_type,
          cy.submit_date  AS submit_moi_date,
          cy.release_date AS pertek_date,
          cy.release_date - cy.submit_date AS moi_to_pertek_days
        FROM cycles cy
        WHERE cy.cycle_type ILIKE 'Submit #%' AND NOT cy.submit_date_tba AND NOT cy.release_date_tba
      ),
      obtained_cycles AS (
        SELECT
          cy.company_code,
          cy.cycle_order,
          cy.submit_date  AS submit_mot_date,
          cy.release_date AS spi_date,
          cy.release_date - cy.submit_date AS mot_to_spi_days
        FROM cycles cy
        WHERE cy.cycle_type ILIKE 'Obtained #%' AND NOT cy.submit_date_tba AND NOT cy.release_date_tba
      )
      SELECT
        sc.company_code,
        c.company_group,
        sc.submit_moi_date,
        sc.pertek_date,
        sc.moi_to_pertek_days,
        oc.submit_mot_date,
        oc.spi_date,
        oc.mot_to_spi_days,
        sc.pertek_date - sc.submit_moi_date + oc.spi_date - oc.submit_mot_date AS total_lead_days
      FROM submit_cycles sc
      JOIN obtained_cycles oc
        ON oc.company_code = sc.company_code
       AND oc.cycle_order = sc.cycle_order + 1
      JOIN companies c ON c.code = sc.company_code
      ORDER BY sc.company_code, sc.cycle_order
    `);

    const { rows: stats } = await pool.query(`
      WITH lead AS (
        SELECT
          sc.submit_date,
          sc.release_date                       AS pertek_date,
          oc.submit_date                        AS mot_date,
          oc.release_date                       AS spi_date,
          (sc.release_date - sc.submit_date)    AS moi_to_pertek,
          (oc.release_date - oc.submit_date)    AS mot_to_spi
        FROM cycles sc
        JOIN cycles oc
          ON oc.company_code = sc.company_code
         AND oc.cycle_order  = sc.cycle_order + 1
        WHERE sc.cycle_type ILIKE 'Submit #%'
          AND oc.cycle_type ILIKE 'Obtained #%'
          AND NOT sc.submit_date_tba AND NOT sc.release_date_tba
          AND NOT oc.submit_date_tba AND NOT oc.release_date_tba
      )
      SELECT
        ROUND(AVG(moi_to_pertek), 1) AS avg_moi_to_pertek_days,
        ROUND(AVG(mot_to_spi),    1) AS avg_mot_to_spi_days,
        MIN(moi_to_pertek)           AS min_moi_to_pertek,
        MAX(moi_to_pertek)           AS max_moi_to_pertek,
        MIN(mot_to_spi)              AS min_mot_to_spi,
        MAX(mot_to_spi)              AS max_mot_to_spi
      FROM lead
    `);

    res.json({ rows, stats: stats[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ═══════════════════════════════════════════════════════════
   10. OBTAINED DRILL-DOWN  (openObtainedDrill modal)
   Returns: per-cycle obtained rows with PERTEK Terbit date
═══════════════════════════════════════════════════════════ */
router.get('/obtained-drill', async (req, res) => {
  try {
    const { from, to } = req.query;
    const params = [];
    let dateWhere = '';
    if (from && to) {
      params.push(from, to);
      dateWhere = `AND pertek_submit.release_date BETWEEN $1 AND $2`;
    }

    const { rows } = await pool.query(`
      SELECT
        obt.company_code,
        c.company_group,
        obt.cycle_type,
        obt.mt,
        obt.mt_is_tba,
        obt.submit_date  AS submit_mot_date,
        obt.release_date AS spi_terbit_date,
        pertek_submit.release_date AS pertek_terbit_date,
        obt.status
      FROM cycles obt
      JOIN companies c ON c.code = obt.company_code
      LEFT JOIN cycles pertek_submit
        ON pertek_submit.company_code = obt.company_code
       AND pertek_submit.cycle_order  = obt.cycle_order - 1
       AND pertek_submit.release_type ILIKE '%PERTEK%'
      WHERE obt.cycle_type ILIKE 'Obtained #%'
        ${dateWhere}
      ORDER BY pertek_submit.release_date ASC NULLS LAST, obt.company_code
    `, params);

    const totals = rows.reduce((s, r) => {
      if (!r.mt_is_tba && r.mt) s.total_mt += Number(r.mt);
      return s;
    }, { total_mt: 0 });
    totals.company_count = new Set(rows.map(r => r.company_code)).size;
    totals.cycle_count   = rows.length;

    res.json({ rows, totals });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── helper: date-range join/where fragments ── */
function buildCycleDateFilter(from, to, alias = 'cy') {
  if (!from || !to) return { join: '', where: '', params: [] };
  return {
    join:   '',
    where:  `EXISTS (
               SELECT 1 FROM cycles ${alias}
               WHERE  ${alias}.company_code = s.company_code
                 AND (${alias}.submit_date  BETWEEN $1::date AND $2::date
                   OR ${alias}.release_date BETWEEN $1::date AND $2::date)
             )`,
    params: [from, to],
  };
}

module.exports = router;