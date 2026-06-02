/**
 * backfillUtilDates_120526.js — one-off: set shipment-lot dates from the
 * "Utilization (date)" rows in the (4) master, so the period filter (rule #3)
 * can attribute utilization to a date.
 *   node backfillUtilDates_120526.js          # DRY-RUN
 *   node backfillUtilDates_120526.js --apply  # COMMIT (one txn)
 * Per (company,product) the master gives ONE utilization date → applied to
 * every lot of that (company,product) as pib_date (WIB-correct, +7h). Lots whose
 * (company,product) has no master date are left untouched. Idempotent.
 */
const fs=require('fs'), path=require('path');
(function loadEnv(){let d=__dirname;while(d!==path.dirname(d)){const p=path.join(d,'.env');if(fs.existsSync(p)){require('dotenv').config({path:p});return;}d=path.dirname(d);}require('dotenv').config();})();
const XLSX=require('xlsx');
const { Pool }=require('pg');
const FILE=process.env.MASTER_XLSX||'C:/Users/arjuna.putranto/Downloads/00 IQ Dash - Quota Data 120526 (dashboard master data) (4).xlsx';
const APPLY=process.argv.includes('--apply');
const useSSL=process.env.PGSSLMODE!=='disable';
const pool=new Pool({host:process.env.PGHOST,database:process.env.PGDATABASE,user:process.env.PGUSER,password:process.env.PGPASSWORD,port:process.env.PGPORT?Number(process.env.PGPORT):undefined,ssl:useSSL?{rejectUnauthorized:false}:false});

const COL={7:'BORDES ALLOY',8:'GI BORON',9:'GL BORON',10:'AS STEEL',13:'PPGL CARBON',22:'SHEETPILE',24:'SEAMLESS PIPE',25:'HOLLOW PIPE',26:'ERW PIPE OD≤140mm',27:'ERW PIPE OD>140mm'};
const wib=v=>{ if(v instanceof Date){const d=new Date(v.getTime()+7*3600*1000);return String(d.getUTCDate()).padStart(2,'0')+'/'+String(d.getUTCMonth()+1).padStart(2,'0')+'/'+d.getUTCFullYear();} const s=String(v||'').trim(); return s&&!/^TBA$/i.test(s)?s:''; };

function parseDates(){
  const aoa=XLSX.utils.sheet_to_json(XLSX.readFile(FILE,{cellDates:true}).Sheets['Status Submisson'],{header:1,defval:'',raw:true});
  let cur=null,blanks=0; const out={}; // 'CODE|PRODUCT' -> date
  for(let r=3;r<aoa.length;r++){
    const row=aoa[r]||[];
    if(row.every(v=>String(v).trim()==='')){ if(++blanks>8)break; continue; } blanks=0;
    const comp=String(row[1]||'').trim(), st=String(row[2]||'').trim();
    if(comp)cur=comp; if(!cur)continue;
    if(/^Utilization\s*\(date\)/i.test(st)){
      for(const c in COL){ const d=wib(row[c]); if(d) out[cur+'|'+COL[c]]=d; }
    }
  }
  return out;
}

(async()=>{
  const dates=parseDates();
  const { rows:lots }=await pool.query(`SELECT company_code, product, COUNT(*) n, pib_date FROM company_shipments WHERE util_mt>0 GROUP BY company_code, product, pib_date`);
  // distinct (company,product) with util lots
  const { rows:cp }=await pool.query(`SELECT company_code, product, SUM(util_mt) mt, COUNT(*) lots, COUNT(*) FILTER (WHERE pib_date<>'') dated FROM company_shipments WHERE util_mt>0 GROUP BY company_code, product ORDER BY company_code, product`);

  const plan=[], noDate=[];
  for(const r of cp){
    const key=r.company_code+'|'+r.product; const d=dates[key];
    if(d) plan.push({ code:r.company_code, product:r.product, date:d, lots:Number(r.lots), mt:Math.round(Number(r.mt)) });
    else  noDate.push({ code:r.company_code, product:r.product, mt:Math.round(Number(r.mt)) });
  }
  console.log(`\n=== backfillUtilDates ${APPLY?'[--APPLY]':'[DRY-RUN]'} — ${path.basename(FILE)} ===`);
  console.log(`(company,product) util groups: ${cp.length} | with master date: ${plan.length} | still undated: ${noDate.length}\n`);
  console.log('── SET pib_date ──');
  plan.forEach(p=>console.log(`  ${p.code.padEnd(5)} ${p.product.padEnd(20)} → ${p.date}  (${p.lots} lot, ${p.mt} MT)`));
  console.log('\n── STILL UNDATED (no master date) ──');
  noDate.forEach(p=>console.log(`  ${p.code} ${p.product} (${p.mt} MT)`));
  const datedMt=plan.reduce((s,p)=>s+p.mt,0), undatedMt=noDate.reduce((s,p)=>s+p.mt,0);
  console.log(`\nUtilization now date-attributable: ${datedMt} MT | still undated: ${undatedMt} MT`);

  if(!APPLY){ console.log('\nDRY-RUN — no write. Re-run with --apply.'); await pool.end(); return; }
  const cl=await pool.connect();
  try{
    await cl.query('BEGIN'); let n=0;
    for(const p of plan){
      const r=await cl.query(`UPDATE company_shipments SET pib_date=$1, updated_at=NOW() WHERE company_code=$2 AND product=$3`,[p.date,p.code,p.product]);
      n+=r.rowCount;
    }
    await cl.query('COMMIT');
    console.log(`\n✅ COMMITTED — ${n} lot rows dated across ${plan.length} (company,product) groups.`);
  }catch(e){ await cl.query('ROLLBACK'); console.error('❌ ROLLBACK:',e.message); process.exitCode=1; }
  finally{ cl.release(); await pool.end(); }
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
