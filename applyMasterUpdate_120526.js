/**
 * applyMasterUpdate_120526.js — one-off: sync cycles + cycle dates from the
 * 12-May "Quota Data Tracking" master into the DB.
 *   node applyMasterUpdate_120526.js           # DRY-RUN (prints plan, no write)
 *   node applyMasterUpdate_120526.js --apply   # COMMIT (one transaction)
 *
 * Buckets (all user-approved 2026-05-29):
 *   ① fill cycle dates where DB has TBA/doc-no/empty and file has a real date
 *   ② insert 11 new cycles (Submit #2 JKT/ADP/MSN + Revisions + IKM placeholder)
 *   ③ correct LCP/KAN/LSJ cycle dates + LCP Submit #2 mt (3000→2725)
 * Dates are WIB-correct (file stores T17:00:00Z = Jakarta midnight → +7h).
 * BDG/Revision #1 submit date in the source is 03-Dec-2026 (a future-dated typo,
 * release is Mar-2026) → intentionally left blank; flagged for source fix.
 */
const fs = require('fs'), path = require('path');
(function loadEnv(){let d=__dirname;while(d!==path.dirname(d)){const p=path.join(d,'.env');if(fs.existsSync(p)){require('dotenv').config({path:p});return;}d=path.dirname(d);}require('dotenv').config();})();
const XLSX = require('xlsx');
const { Pool } = require('pg');

const FILE  = process.env.MASTER_XLSX || 'C:/Users/arjuna.putranto/Downloads/00 IQ Dash - Quota Data 120526 (dashboard master data) (3).xlsx';
const APPLY = process.argv.includes('--apply');
const useSSL = process.env.PGSSLMODE !== 'disable';
const pool = new Pool({ host:process.env.PGHOST, database:process.env.PGDATABASE, user:process.env.PGUSER, password:process.env.PGPASSWORD, port:process.env.PGPORT?Number(process.env.PGPORT):undefined, ssl:useSSL?{rejectUnauthorized:false}:false });

// ── WIB date: file Date (…T17:00Z = Jakarta midnight) → 'DD/MM/YYYY'. ──
const wib = v => {
  if (v instanceof Date) { const d = new Date(v.getTime()+7*3600*1000);
    return String(d.getUTCDate()).padStart(2,'0')+'/'+String(d.getUTCMonth()+1).padStart(2,'0')+'/'+d.getUTCFullYear(); }
  const s = String(v||'').trim();
  return /^TBA$/i.test(s) ? 'TBA' : '';           // non-date strings → '' (or TBA)
};
const isDate = s => /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(String(s||'').trim());

// product column (4..28) → DB cycle_products name
const COL2PROD = {7:'BORDES ALLOY',8:'GI BORON',9:'GL BORON',10:'AS STEEL',13:'PPGL CARBON',22:'SHEETPILE',24:'SEAMLESS PIPE',25:'HOLLOW PIPE',26:'ERW PIPE OD≤140mm',27:'ERW PIPE OD>140mm'};

function parseFile() {
  const aoa = XLSX.utils.sheet_to_json(XLSX.readFile(FILE,{cellDates:true}).Sheets['Status Submisson'],{header:1,defval:'',raw:true});
  const map = {}; let cur=null, blanks=0;
  for (let r=3;r<aoa.length;r++){
    const row=aoa[r]||[];
    if(row.every(v=>String(v).trim()==='')){ if(++blanks>8) break; continue; } blanks=0;
    const comp=String(row[1]||'').trim(), status=String(row[2]||'').trim();
    if(comp) cur=comp;
    if(!cur||!status||!/^(Submit|Obtained|Revision)/i.test(status)) continue;
    const products={};
    for(const c of Object.keys(COL2PROD)){ const v=row[c]; if(typeof v==='number'&&v>0) products[COL2PROD[c]]=v; }
    map[cur+'|'+status]={ code:cur, ctype:status,
      mt:row[29], subType:String(row[32]||'').trim(), subDate:wib(row[33]),
      relType:String(row[34]||'').trim(), relDate:wib(row[35]), products };
  }
  return map;
}

(async()=>{
  const file = parseFile();
  const CORRECT = new Set(['LCP','KAN','LSJ']);          // ③ full date overwrite
  const NEW = ['MIN|Revision #1','JKT|Submit #2','GAS|Revision #1','SPA|Revision #1','ADP|Submit #2','MSN|Submit #2','MJU|Revision #2','BDG|Revision #1','BDG|Revision #2','GIS|Revision #1','IKM|Obtained #1'];
  const SUBMIT2_PRODUCTS = new Set(['JKT|Submit #2','ADP|Submit #2','MSN|Submit #2']);

  const { rows: dbCyc } = await pool.query(
    `SELECT DISTINCT ON (company_code,cycle_type) company_code,cycle_type,mt,submit_date,release_date
     FROM cycles ORDER BY company_code,cycle_type,sort_order`);
  const db = {}; dbCyc.forEach(r=>{ db[r.company_code+'|'+r.cycle_type]={ mt:r.mt, subDate:r.submit_date||'', relDate:r.release_date||'' }; });
  const { rows: maxRows } = await pool.query(`SELECT company_code, MAX(sort_order) mx FROM cycles GROUP BY company_code`);
  const maxSort = {}; maxRows.forEach(r=>maxSort[r.company_code]=Number(r.mx)||0);

  const updates=[], inserts=[];
  // ─ UPDATES (① fills + ③ corrections + LCP Submit#2 mt) ─
  for (const key of Object.keys(file)) {
    if (!db[key]) continue;                              // handled as insert below
    const f=file[key], d=db[key]; const code=f.code, ct=f.ctype;
    const full = CORRECT.has(code);
    let newSub=d.subDate, newRel=d.relDate, changed=false;
    if (isDate(f.subDate) && (full || !isDate(d.subDate)) && f.subDate!==d.subDate) { newSub=f.subDate; changed=true; }
    if (isDate(f.relDate) && (full || !isDate(d.relDate)) && f.relDate!==d.relDate) { newRel=f.relDate; changed=true; }
    let newMt=null;
    if (code==='LCP' && ct==='Submit #2') { const fm=Number(f.mt); if(fm>0 && fm!==Number(d.mt)){ newMt=fm; changed=true; } }
    if (changed) updates.push({ code, ct, from:{sub:d.subDate,rel:d.relDate,mt:d.mt}, to:{sub:newSub,rel:newRel,mt:newMt} });
  }
  // ─ INSERTS (② new cycles) ─
  for (const key of NEW) {
    const f=file[key]; if(!f){ console.log('⚠ NEW key missing in file:',key); continue; }
    let sub=f.subDate;
    if (key==='BDG|Revision #1') sub='';                 // future-dated typo → blank
    const mtNum = (f.mt===''||f.mt==null) ? null : Number(f.mt);
    inserts.push({ code:f.code, ct:f.ctype, mt:(mtNum!=null&&!isNaN(mtNum))?mtNum:null,
      subType:f.subType, subDate:sub, relType:f.relType, relDate:f.relDate,
      products: SUBMIT2_PRODUCTS.has(key)?f.products:{} });
  }

  console.log(`\n=== applyMasterUpdate ${APPLY?'[--APPLY]':'[DRY-RUN]'} ===`);
  console.log(`UPDATES: ${updates.length}   INSERTS: ${inserts.length}\n`);
  console.log('── UPDATES (cycle dates / mt) ──');
  updates.forEach(u=>console.log(`  ${u.code}/${u.ct}: sub ${u.from.sub||'∅'}→${u.to.sub||'∅'} · rel ${u.from.rel||'∅'}→${u.to.rel||'∅'}${u.to.mt!=null?` · mt ${u.from.mt}→${u.to.mt}`:''}`));
  console.log('\n── INSERTS (new cycles) ──');
  inserts.forEach(i=>console.log(`  ${i.code}/${i.ct}: mt=${i.mt} | ${i.subType} ${i.subDate||'∅'} | ${i.relType} ${i.relDate||'∅'}${Object.keys(i.products).length?' | products '+JSON.stringify(i.products):''}`));

  if (!APPLY) { console.log('\nDRY-RUN — no write. Re-run with --apply to commit.'); await pool.end(); return; }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const u of updates) {
      const sets=['submit_date=$1','release_date=$2']; const vals=[u.to.sub,u.to.rel];
      let sql=`UPDATE cycles SET submit_date=$1, release_date=$2`;
      if (u.to.mt!=null){ sql+=`, mt=$3`; vals.push(String(u.to.mt)); }
      sql+=` WHERE company_code=$${vals.length+1} AND cycle_type=$${vals.length+2}`;
      vals.push(u.code,u.ct);
      await client.query(sql, vals);
    }
    for (const i of inserts) {
      const so=(maxSort[i.code]||0)+1; maxSort[i.code]=so;
      const { rows } = await client.query(
        `INSERT INTO cycles (company_code,cycle_type,mt,submit_type,submit_date,release_type,release_date,status,sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'',$8) RETURNING id`,
        [i.code,i.ct,i.mt!=null?String(i.mt):null,i.subType,i.subDate,i.relType,i.relDate,so]);
      for (const [p,mt] of Object.entries(i.products))
        await client.query(`INSERT INTO cycle_products (cycle_id,product,mt) VALUES ($1,$2,$3)`,[rows[0].id,p,String(mt)]);
    }
    await client.query('COMMIT');
    console.log(`\n✅ COMMITTED — ${updates.length} updates, ${inserts.length} inserts.`);
  } catch(e){ await client.query('ROLLBACK'); console.error('❌ ROLLBACK:',e.message); process.exitCode=1; }
  finally { client.release(); await pool.end(); }
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
