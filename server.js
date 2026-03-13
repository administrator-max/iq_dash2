/**
 * server.js — IQ Dash Express API Server
 * Serves the static frontend and exposes REST endpoints
 * for all quota data backed by PostgreSQL (Neon).
 */
require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const { Pool } = require('pg');
const fs      = require('fs');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── DB Pool ──────────────────────────────────────────────────────
const pool = new Pool({
  host:     process.env.PGHOST,
  database: process.env.PGDATABASE,
  user:     process.env.PGUSER,
  password: process.env.PGPASSWORD,
  ssl:      { rejectUnauthorized: false },
  max:      10,
});

// ── Middleware ───────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ═══════════════════════════════════════════════════════════════════
// SCHEMA INIT  (PgBouncer-safe: one statement at a time)
// ═══════════════════════════════════════════════════════════════════
async function initDB() {
  const schemaPath = path.join(__dirname, 'schema.sql');
  if (!fs.existsSync(schemaPath)) {
    console.warn('⚠  schema.sql not found — skipping auto-init');
    return;
  }
  const client = await pool.connect();
  try {
    const sql = fs.readFileSync(schemaPath, 'utf8');
    const statements = sql
      .split(';')
      .map(s => s.replace(/--[^\n]*/g, '').trim())
      .filter(s => s.length > 0);
    for (const stmt of statements) {
      await client.query(stmt);
    }
    console.log('✅ DB schema ready');
  } catch (err) {
    console.error('❌ Schema init error:', err.message);
  } finally {
    client.release();
  }
}

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

/** Fetch all cycles (with products) for an array of company codes */
async function getCyclesFor(codes) {
  if (!codes.length) return {};
  const { rows: cRows } = await pool.query(
    `SELECT c.id, c.company_code, c.cycle_type, c.mt,
            c.submit_type, c.submit_date, c.release_type, c.release_date,
            c.status, c.sort_order
     FROM cycles c
     WHERE c.company_code = ANY($1)
     ORDER BY c.company_code, c.sort_order`, [codes]
  );
  const cycleIds = cRows.map(r => r.id);
  let cpMap = {};
  if (cycleIds.length) {
    const { rows: cpRows } = await pool.query(
      `SELECT cycle_id, product, mt FROM cycle_products WHERE cycle_id = ANY($1)`,
      [cycleIds]
    );
    cpRows.forEach(r => {
      if (!cpMap[r.cycle_id]) cpMap[r.cycle_id] = {};
      cpMap[r.cycle_id][r.product] = isNaN(r.mt) ? r.mt : Number(r.mt);
    });
  }
  const byCode = {};
  cRows.forEach(c => {
    if (!byCode[c.company_code]) byCode[c.company_code] = [];
    byCode[c.company_code].push({
      type:        c.cycle_type,
      mt:          isNaN(c.mt) ? c.mt : Number(c.mt),
      submitType:  c.submit_type,
      submitDate:  c.submit_date,
      releaseType: c.release_type,
      releaseDate: c.release_date,
      status:      c.status,
      products:    cpMap[c.id] || {},
    });
  });
  return byCode;
}

/** Build a full company JSON object from DB rows */
function buildCompanyObj(co, products, stats, revFrom, revTo, cycles, pendMeta, shipments, reapplyTargets) {
  const utilizationByProd = {};
  const availableByProd   = {};
  const realizationByProd = {};
  const etaByProd         = {};
  const arrivedByProd     = {};
  (stats || []).forEach(s => {
    if (s.utilization_mt != null) utilizationByProd[s.product] = Number(s.utilization_mt);
    if (s.available_mt   != null) availableByProd[s.product]   = Number(s.available_mt);
    if (s.realization_mt != null) realizationByProd[s.product] = Number(s.realization_mt);
    if (s.eta_jkt)                etaByProd[s.product]         = s.eta_jkt;
    arrivedByProd[s.product] = s.arrived || false;
  });

  const revFromArr = (revFrom || []).filter(r => r.direction === 'from').sort((a,b)=>a.sort_order-b.sort_order).map(r=>({prod:r.product,mt:r.mt?Number(r.mt):null,label:r.label}));
  const revToArr   = (revTo   || []).filter(r => r.direction === 'to'  ).sort((a,b)=>a.sort_order-b.sort_order).map(r=>({prod:r.product,mt:r.mt?Number(r.mt):null,label:r.label}));

  const obj = {
    code:           co.code,
    group:          co.grp,
    section:        co.section,
    products:       (products || []).sort((a,b)=>a.sort_order-b.sort_order).map(p=>p.product),
    submit1:        co.submit1  != null ? Number(co.submit1)  : null,
    obtained:       co.obtained != null ? Number(co.obtained) : 0,
    utilizationMT:  Number(co.utilization_mt) || 0,
    availableQuota: co.available_quota != null ? Number(co.available_quota) : null,
    revType:        co.rev_type     || 'none',
    revNote:        co.rev_note     || '',
    revSubmitDate:  co.rev_submit_date || '',
    revStatus:      co.rev_status   || '',
    revMT:          Number(co.rev_mt) || 0,
    revFrom:        revFromArr,
    revTo:          revToArr,
    remarks:        co.remarks      || '',
    spiRef:         co.spi_ref      || '',
    statusUpdate:   co.status_update|| '',
    pertekNo:       co.pertek_no    || '',
    spiNo:          co.spi_no       || '',
    updatedBy:      co.updated_by   || '',
    updatedDate:    co.updated_date || '',
    utilizationByProd,
    availableByProd,
    cycles:         cycles || [],
    shipments:      shipments || {},
    reapplyTargets: reapplyTargets || [],
  };
  if (Object.keys(realizationByProd).length) obj.realizationByProd = realizationByProd;
  if (Object.keys(etaByProd).length)         obj.etaByProd         = etaByProd;
  if (Object.keys(arrivedByProd).length)      obj.arrivedByProd     = arrivedByProd;
  if (co.section === 'PENDING' && pendMeta) {
    obj.mt      = Number(pendMeta.mt) || 0;
    obj.status  = pendMeta.status || '';
    obj.date    = pendMeta.date   || '';
  }
  return obj;
}

// ═══════════════════════════════════════════════════════════════════
// GET /api/data  — full dataset for frontend
// ═══════════════════════════════════════════════════════════════════
app.get('/api/data', async (req, res) => {
  try {
    const { rows: companies } = await pool.query(
      `SELECT * FROM companies ORDER BY section, code`
    );
    const codes = companies.map(c => c.code);
    if (!codes.length) return res.json({ spi: [], pending: [], ra: [] });

    const [
      { rows: products },
      { rows: stats },
      { rows: revChanges },
      { rows: pendMetas },
      { rows: raRows },
      { rows: shipRows },
      { rows: reapplyRows },
    ] = await Promise.all([
      pool.query(`SELECT * FROM company_products WHERE company_code = ANY($1) ORDER BY company_code, sort_order`, [codes]),
      pool.query(`SELECT * FROM company_product_stats WHERE company_code = ANY($1)`, [codes]),
      pool.query(`SELECT * FROM revision_changes WHERE company_code = ANY($1) ORDER BY company_code, direction, sort_order`, [codes]),
      pool.query(`SELECT * FROM pending_meta WHERE company_code = ANY($1)`, [codes]),
      pool.query(`SELECT * FROM ra_records WHERE company_code = ANY($1) ORDER BY company_code`, [codes]),
      pool.query(`SELECT * FROM company_shipments WHERE company_code = ANY($1) ORDER BY company_code, product, lot_no`, [codes]),
      pool.query(`SELECT * FROM company_reapply_targets WHERE company_code = ANY($1)`, [codes]),
    ]);

    const cyclesMap = await getCyclesFor(codes);

    // Group by code for fast lookup
    const byCode = (arr, key='company_code') => {
      const m = {};
      arr.forEach(r => { const k=r[key]; if(!m[k])m[k]=[]; m[k].push(r); });
      return m;
    };
    const prodMap    = byCode(products);
    const statsMap   = byCode(stats);
    const revMap     = byCode(revChanges);
    const pendMap    = {};
    pendMetas.forEach(p => pendMap[p.company_code] = p);
    const raMap      = byCode(raRows);
    const shipMap    = {}; // code → { product: [lot,...] }
    shipRows.forEach(s => {
      if (!shipMap[s.company_code]) shipMap[s.company_code] = {};
      if (!shipMap[s.company_code][s.product]) shipMap[s.company_code][s.product] = [];
      shipMap[s.company_code][s.product].push({
        lotNo:        s.lot_no,
        utilMT:       Number(s.util_mt)||0,
        etaJKT:       s.eta_jkt||'',
        note:         s.note||'',
        realMT:       Number(s.real_mt)||0,
        pibDate:      s.pib_date||'',
        cargoArrived: s.cargo_arrived||false,
      });
    });
    const reapplyMap = byCode(reapplyRows);

    const spi     = [];
    const pending = [];

    companies.forEach(co => {
      const obj = buildCompanyObj(
        co,
        prodMap[co.code],
        statsMap[co.code],
        revMap[co.code],
        revMap[co.code],
        cyclesMap[co.code],
        pendMap[co.code],
        shipMap[co.code] || {},
        reapplyRows.filter(r => r.company_code === co.code),
      );
      if (co.section === 'SPI')     spi.push(obj);
      else                          pending.push(obj);
    });

    // Build RA
    const ra = [];
    const processedCodes = new Set();
    raRows.forEach(r => {
      if (!processedCodes.has(r.company_code)) {
        processedCodes.add(r.company_code);
      }
      ra.push({
        code:                r.company_code,
        product:             r.product,
        berat:               Number(r.berat)||0,
        obtained:            Number(r.obtained)||0,
        cargoArrived:        r.cargo_arrived||false,
        realPct:             Number(r.real_pct)||0,
        utilPct:             r.util_pct!=null ? Number(r.util_pct) : null,
        arrivalDate:         r.arrival_date||null,
        etaJKT:              r.eta_jkt||null,
        reapplyEst:          r.reapply_est||'',
        reapplyStage:        Number(r.reapply_stage)||1,
        reapplyProduct:      r.reapply_product||null,
        reapplyNewTotal:     r.reapply_new_total!=null?Number(r.reapply_new_total):null,
        reapplyPrevObtained: r.reapply_prev_obtained!=null?Number(r.reapply_prev_obtained):null,
        reapplyAdditional:   r.reapply_additional!=null?Number(r.reapply_additional):null,
        reapplySubmitDate:   r.reapply_submit_date||null,
        reapplyStatus:       r.reapply_status||null,
        target:              r.target!=null?Number(r.target):null,
        pertek:              r.pertek||null,
        spi:                 r.spi||null,
        catatan:             r.catatan||null,
      });
    });

    res.json({ spi, pending, ra });
  } catch (err) {
    console.error('/api/data error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// PATCH /api/company/:code  — update editable fields
// ═══════════════════════════════════════════════════════════════════
app.patch('/api/company/:code', async (req, res) => {
  const { code } = req.params;
  const body = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Build dynamic SET clause — only update fields present in body
    const allowed = [
      'rev_type','rev_note','rev_submit_date','rev_status','rev_mt',
      'remarks','spi_ref','status_update','pertek_no','spi_no',
      'utilization_mt','available_quota','updated_by','updated_date',
      'submit1','obtained',
    ];
    const sets = []; const vals = []; let idx = 1;
    for (const f of allowed) {
      // camelCase → snake_case mapping
      const camel = f.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
      if (body[camel] !== undefined) {
        sets.push(`${f} = $${idx++}`);
        vals.push(body[camel]);
      } else if (body[f] !== undefined) {
        sets.push(`${f} = $${idx++}`);
        vals.push(body[f]);
      }
    }
    sets.push(`updated_at = NOW()`);
    if (sets.length > 1) {
      vals.push(code);
      await client.query(
        `UPDATE companies SET ${sets.join(', ')} WHERE code = $${idx}`,
        vals
      );
    }

    // Handle shipments upsert
    if (body.shipments) {
      // body.shipments = { product: [{ lotNo, utilMT, etaJKT, note, realMT, pibDate, cargoArrived }] }
      for (const [product, lots] of Object.entries(body.shipments)) {
        // Delete removed lots
        const lotNos = lots.map(l => l.lotNo);
        if (lotNos.length) {
          await client.query(
            `DELETE FROM company_shipments WHERE company_code=$1 AND product=$2 AND lot_no != ALL($3)`,
            [code, product, lotNos]
          );
        } else {
          await client.query(
            `DELETE FROM company_shipments WHERE company_code=$1 AND product=$2`,
            [code, product]
          );
        }
        for (const lot of lots) {
          await client.query(
            `INSERT INTO company_shipments
               (company_code, product, lot_no, util_mt, eta_jkt, note, real_mt, pib_date, cargo_arrived, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
             ON CONFLICT (company_code, product, lot_no) DO UPDATE SET
               util_mt=EXCLUDED.util_mt, eta_jkt=EXCLUDED.eta_jkt, note=EXCLUDED.note,
               real_mt=EXCLUDED.real_mt, pib_date=EXCLUDED.pib_date,
               cargo_arrived=EXCLUDED.cargo_arrived, updated_at=NOW()`,
            [code, product, lot.lotNo, lot.utilMT||0, lot.etaJKT||'',
             lot.note||'', lot.realMT||0, lot.pibDate||'', lot.cargoArrived||false]
          );
        }
      }
    }

    // Handle reapply targets
    if (body.reapplyTargets) {
      for (const t of body.reapplyTargets) {
        await client.query(
          `INSERT INTO company_reapply_targets
             (company_code, product, target_mt, submitted, submit_date, notes)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (company_code, product) DO UPDATE SET
             target_mt=EXCLUDED.target_mt, submitted=EXCLUDED.submitted,
             submit_date=EXCLUDED.submit_date, notes=EXCLUDED.notes`,
          [code, t.product, t.targetMT||null, t.submitted||false, t.submitDate||'', t.notes||'']
        );
      }
    }

    // Handle revision_changes (revFrom / revTo product change pairs)
    if (body.revFrom !== undefined || body.revTo !== undefined) {
      // Full replace: delete existing then re-insert
      await client.query(`DELETE FROM revision_changes WHERE company_code = $1`, [code]);
      const fromRows = body.revFrom || [];
      const toRows   = body.revTo   || [];
      for (let i = 0; i < fromRows.length; i++) {
        const f = fromRows[i];
        if (!f.prod) continue;
        await client.query(
          `INSERT INTO revision_changes (company_code, direction, product, mt, label, sort_order)
           VALUES ($1,'from',$2,$3,$4,$5)`,
          [code, f.prod, f.mt ?? null, f.label || '', i]
        );
      }
      for (let i = 0; i < toRows.length; i++) {
        const t = toRows[i];
        if (!t.prod) continue;
        await client.query(
          `INSERT INTO revision_changes (company_code, direction, product, mt, label, sort_order)
           VALUES ($1,'to',$2,$3,$4,$5)`,
          [code, t.prod, t.mt ?? null, t.label || '', i]
        );
      }
    }

    // Handle RA record update
    if (body.ra) {
      const r = body.ra;
      await client.query(
        `UPDATE ra_records SET
           berat=$1, obtained=$2, cargo_arrived=$3, real_pct=$4, util_pct=$5,
           arrival_date=$6, eta_jkt=$7, reapply_est=$8, reapply_stage=$9,
           reapply_submit_date=$10, reapply_status=$11, target=$12,
           pertek=$13, spi=$14, catatan=$15, updated_at=NOW()
         WHERE company_code=$16`,
        [r.berat, r.obtained, r.cargoArrived, r.realPct, r.utilPct??null,
         r.arrivalDate||null, r.etaJKT||null, r.reapplyEst||null, r.reapplyStage||1,
         r.reapplySubmitDate||null, r.reapplyStatus||null, r.target??null,
         r.pertek||null, r.spi||null, r.catatan||null, code]
      );
    }

    await client.query('COMMIT');
    res.json({ ok: true, code });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('PATCH /api/company/:code error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ═══════════════════════════════════════════════════════════════════
// PUT /api/company/:code/cycles  — replace all cycles for a company
// ═══════════════════════════════════════════════════════════════════
app.put('/api/company/:code/cycles', async (req, res) => {
  const { code } = req.params;
  const { cycles } = req.body;
  if (!Array.isArray(cycles)) return res.status(400).json({ error: 'cycles must be an array' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Delete existing cycles (cascade deletes cycle_products)
    await client.query(`DELETE FROM cycles WHERE company_code = $1`, [code]);
    // Re-insert
    for (let i = 0; i < cycles.length; i++) {
      const cy = cycles[i];
      const { rows } = await client.query(
        `INSERT INTO cycles
           (company_code, cycle_type, mt, submit_type, submit_date, release_type, release_date, status, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING id`,
        [code, cy.type, cy.mt != null ? String(cy.mt) : null,
         cy.submitType||null, cy.submitDate||null,
         cy.releaseType||null, cy.releaseDate||null,
         cy.status||'', i]
      );
      const cycleId = rows[0].id;
      // Insert per-product breakdown
      if (cy.products && typeof cy.products === 'object') {
        for (const [prod, mt] of Object.entries(cy.products)) {
          await client.query(
            `INSERT INTO cycle_products (cycle_id, product, mt) VALUES ($1,$2,$3)`,
            [cycleId, prod, mt != null ? String(mt) : null]
          );
        }
      }
    }
    await client.query('COMMIT');
    res.json({ ok: true, code, cycleCount: cycles.length });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('PUT /cycles error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});


// ═══════════════════════════════════════════════════════════════════
app.get('/api/company/:code', async (req, res) => {
  const { code } = req.params;
  try {
    const { rows } = await pool.query(`SELECT * FROM companies WHERE code=$1`, [code]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const co = rows[0];
    const [
      { rows: products },
      { rows: stats },
      { rows: revChanges },
      { rows: pendMetas },
      { rows: shipRows },
      { rows: reapplyRows },
    ] = await Promise.all([
      pool.query(`SELECT * FROM company_products WHERE company_code=$1 ORDER BY sort_order`, [code]),
      pool.query(`SELECT * FROM company_product_stats WHERE company_code=$1`, [code]),
      pool.query(`SELECT * FROM revision_changes WHERE company_code=$1 ORDER BY direction, sort_order`, [code]),
      pool.query(`SELECT * FROM pending_meta WHERE company_code=$1`, [code]),
      pool.query(`SELECT * FROM company_shipments WHERE company_code=$1 ORDER BY product, lot_no`, [code]),
      pool.query(`SELECT * FROM company_reapply_targets WHERE company_code=$1`, [code]),
    ]);
    const cyclesMap = await getCyclesFor([code]);
    const shipMap = {};
    shipRows.forEach(s => {
      if (!shipMap[s.product]) shipMap[s.product] = [];
      shipMap[s.product].push({lotNo:s.lot_no, utilMT:Number(s.util_mt)||0, etaJKT:s.eta_jkt||'', note:s.note||'', realMT:Number(s.real_mt)||0, pibDate:s.pib_date||'', cargoArrived:s.cargo_arrived||false});
    });
    const obj = buildCompanyObj(co, products, stats, revChanges, revChanges, cyclesMap[code], pendMetas[0], shipMap, reapplyRows);
    res.json(obj);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// GET /api/ra  — all RA records
// ═══════════════════════════════════════════════════════════════════
app.get('/api/ra', async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM ra_records ORDER BY company_code`);
    res.json(rows.map(r => ({
      code: r.company_code, product: r.product,
      berat: Number(r.berat)||0, obtained: Number(r.obtained)||0,
      cargoArrived: r.cargo_arrived, realPct: Number(r.real_pct)||0,
      utilPct: r.util_pct!=null?Number(r.util_pct):null,
      arrivalDate: r.arrival_date||null, etaJKT: r.eta_jkt||null,
      reapplyEst: r.reapply_est||'', reapplyStage: r.reapply_stage||1,
      reapplyProduct: r.reapply_product||null,
      target: r.target!=null?Number(r.target):null,
      pertek: r.pertek||null, spi: r.spi||null, catatan: r.catatan||null,
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/import  — trigger re-seed from code (dev/admin use) ──
app.post('/api/import', async (req, res) => {
  try {
    // Dynamic require so seed can be run independently
    delete require.cache[require.resolve('./seed.js')];
    // seed.js calls pool.end() which would crash the server, so we
    // instead expose the seed function inline — we just call it via shell
    res.json({ message: 'Run `node seed.js` on the server to re-seed data.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Health check ────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date() }));

// ── Fallback SPA ─────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start ────────────────────────────────────────────────────────
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 IQ Dash running on http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});