/**
 * importMasterStats.js — β-1: refresh company_product_stats (utilization_mt +
 * available_mt) from the authoritative master file. Per-product net obtained
 * is then `util + avail`, so the dashboard aggregator no longer needs to apply
 * revision_changes (those become UI-only — see 08-drawer.js / 13-rev-mgmt.js).
 *
 * Source of truth: master xlsx (Utilization (MT) + Available (MT) rows per company).
 *
 * Run:
 *   node importMasterStats.js            # DRY-RUN (default): prints delta, no write
 *   node importMasterStats.js --apply    # COMMIT the UPSERT (one transaction)
 *   MASTER_XLSX=/path/file.xlsx node importMasterStats.js
 *
 * Idempotent. One BEGIN…COMMIT, ROLLBACK on error.
 */
const fs = require('fs'), path = require('path');
(function loadEnvUpwards(){let d=__dirname;while(d!==path.dirname(d)){const p=path.join(d,'.env');if(fs.existsSync(p)){require('dotenv').config({path:p});return;}d=path.dirname(d);}require('dotenv').config();})();
const XLSX = require('xlsx');
const { Pool } = require('pg');

const MASTER = process.env.MASTER_XLSX || path.join(__dirname, 'master_data_120526.xlsx');
const APPLY  = process.argv.includes('--apply');
const EPS = 0.01;

// master product column index -> exact company_product_stats.product name
const DB_TO_COL = {
  'BORDES ALLOY':7, 'GI BORON':8, 'GL BORON':9, 'AS STEEL':10, 'PPGL CARBON':13,
  'SHEETPILE':22, 'SEAMLESS PIPE':24, 'HOLLOW PIPE':25,
  'ERW PIPE OD≤140mm':26, 'ERW PIPE OD>140mm':27,
};
const COL_TO_DB = Object.fromEntries(Object.entries(DB_TO_COL).map(([k,v])=>[v,k]));

const useSSL = process.env.PGSSLMODE !== 'disable';
const pool = new Pool({ host:process.env.PGHOST, database:process.env.PGDATABASE, user:process.env.PGUSER, password:process.env.PGPASSWORD, port:process.env.PGPORT?Number(process.env.PGPORT):undefined, ssl:useSSL?{rejectUnauthorized:false}:false });

function parseMaster(){
  const aoa = XLSX.utils.sheet_to_json(XLSX.readFile(MASTER,{cellDates:true}).Sheets['Status Submisson'],{header:1,defval:'',raw:true});
  const stats={}; let cur=null, es=0;
  for(let r=3;r<aoa.length;r++){
    const row=aoa[r]||[]; const no=row[0],comp=String(row[1]||'').trim(),st=String(row[2]||'').trim();
    if(row.every(v=>String(v).trim()==='')){ if(++es>8&&cur)break; continue; } es=0;
    if(comp&&(typeof no==='number'||/^\d+$/.test(String(no)))){ cur=comp; if(!stats[cur])stats[cur]={util:{},avail:{}}; }
    if(!cur||!st) continue;
    const tgt = /^Utilization/i.test(st) ? 'util' : /^Available/i.test(st) ? 'avail' : null;
    if(!tgt) continue;
    for(let c=4;c<=28;c++){ const v=row[c]; if(typeof v==='number'&&COL_TO_DB[c]) stats[cur][tgt][COL_TO_DB[c]]=v; }
  }
  return stats;
}

(async()=>{
  const master = parseMaster();
  const { rows: dbRows } = await pool.query(`SELECT id, company_code, product, utilization_mt, available_mt FROM company_product_stats ORDER BY company_code, product`);
  const f=n=>Math.round((Number(n)||0)*100)/100;

  const changes=[]; const inserts=[]; const unmapped=[];
  // existing rows -> compute target from master (default 0 when master silent)
  for(const r of dbRows){
    if(!(r.product in DB_TO_COL)){ unmapped.push(r); continue; }
    const m = master[r.company_code] || {util:{},avail:{}};
    const tu = f(m.util[r.product]||0), ta = f(m.avail[r.product]||0);
    const cu = f(r.utilization_mt), ca = f(r.available_mt);
    if(Math.abs(tu-cu)>EPS || Math.abs(ta-ca)>EPS) changes.push({code:r.company_code,product:r.product,cu,tu,ca,ta,du:f(tu-cu),da:f(ta-ca)});
  }
  // master pairs not present in DB (nonzero) -> would be inserted
  const dbKey=new Set(dbRows.map(r=>r.company_code+'|'+r.product));
  for(const [code,s] of Object.entries(master)){
    for(const prod of Object.keys(DB_TO_COL)){
      const u=f(s.util[prod]||0), a=f(s.avail[prod]||0);
      if((Math.abs(u)>EPS||Math.abs(a)>EPS) && !dbKey.has(code+'|'+prod)) inserts.push({code,product:prod,u,a});
    }
  }

  console.log(`\n=== importMasterStats ${APPLY?'[--APPLY]':'[DRY-RUN]'} — master: ${path.basename(MASTER)} ===`);
  console.log(`DB rows: ${dbRows.length} | changes: ${changes.length} | new inserts: ${inserts.length} | unmapped DB rows: ${unmapped.length}`);
  console.log('\nCODE   PRODUCT                util(cur→new)        avail(cur→new)        Δutil   Δavail');
  for(const c of changes){
    const flag=(c.code!=='SMS'&&(Math.abs(c.du)>5||Math.abs(c.da)>5))?'  <-- >5MT outside SMS':'';
    console.log(`${c.code.padEnd(6)} ${c.product.padEnd(20)} ${(c.cu+'→'+c.tu).padEnd(20)} ${(c.ca+'→'+c.ta).padEnd(20)} ${String(c.du).padStart(7)} ${String(c.da).padStart(7)}${flag}`);
  }
  if(inserts.length){ console.log('\nNEW INSERTS (master pair absent in DB):'); inserts.forEach(i=>console.log(`  ${i.code} ${i.product} util=${i.u} avail=${i.a}`)); }
  if(unmapped.length){ console.log('\nUNMAPPED DB rows (left untouched):'); unmapped.forEach(r=>console.log(`  ${r.company_code} ${r.product}`)); }

  const utilChanges=changes.filter(c=>Math.abs(c.du)>EPS);
  const availChanges=changes.filter(c=>Math.abs(c.da)>EPS);
  const bigOutsideSMS=changes.filter(c=>c.code!=='SMS'&&(Math.abs(c.du)>5||Math.abs(c.da)>5));
  console.log(`\nSUMMARY: util-rows changed=${utilChanges.length}, avail-rows changed=${availChanges.length}, >5MT-outside-SMS=${bigOutsideSMS.length}`);

  if(!APPLY){ console.log('\nDRY-RUN — no write. Re-run with --apply to commit.'); await pool.end(); return; }

  const client = await pool.connect();
  try{
    await client.query('BEGIN');
    let n=0;
    for(const [code,s] of Object.entries(master)){
      for(const prod of Object.keys(DB_TO_COL)){
        const u=f(s.util[prod]||0), a=f(s.avail[prod]||0);
        const key=code+'|'+prod;
        if(!dbKey.has(key) && Math.abs(u)<EPS && Math.abs(a)<EPS) continue; // don't create empty rows
        const r=await client.query(
          `INSERT INTO company_product_stats (company_code, product, utilization_mt, available_mt)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (company_code, product) DO UPDATE SET utilization_mt=EXCLUDED.utilization_mt, available_mt=EXCLUDED.available_mt`,
          [code, prod, u, a]);
        n+=r.rowCount;
      }
    }
    await client.query('COMMIT');
    console.log(`\n✅ COMMITTED — ${n} upserts.`);
  }catch(e){ await client.query('ROLLBACK'); console.error('❌ ROLLBACK:',e.message); process.exitCode=1; }
  finally{ client.release(); await pool.end(); }
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
