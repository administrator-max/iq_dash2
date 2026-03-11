/**
 * seed.js — Seeds all IQ Dash data into PostgreSQL.
 * Clears existing data and re-inserts from authoritative source arrays.
 * Run:  node seed.js
 */
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host:     process.env.PGHOST,
  database: process.env.PGDATABASE,
  user:     process.env.PGUSER,
  password: process.env.PGPASSWORD,
  ssl:      { rejectUnauthorized: false },
});

// ═══════════════════════════════════════════════════════════════════
// SOURCE DATA  (extracted verbatim from IQDash_update_100325.html)
// ═══════════════════════════════════════════════════════════════════

const SPI = [
  {code:'EMS',  group:'AB', submit1:8000,  obtained:1600, products:['SHEETPILE'],
   revType:'none', revNote:'', revSubmitDate:'', revStatus:'', revFrom:[], revTo:[], revMT:0,
   utilizationMT:1600, availableQuota:0,
   utilizationByProd:{"SHEETPILE": 1600}, availableByProd:{},
   remarks:'SUBMIT MOT 30/10/25', spiRef:'SPI TERBIT 7/11/25 · Target re-apply Early-April',
   cycles:[
     {type:'Submit #1',  mt:8000, products:{SHEETPILE:8000},  submitType:'Submit MOI', submitDate:'15/10/2025', releaseType:'PERTEK', releaseDate:'29/10/2025', status:''},
     {type:'Obtained #1',mt:1600, products:{SHEETPILE:1600},  submitType:'Submit MOT', submitDate:'30/10/2025', releaseType:'SPI',    releaseDate:'07/11/2025', status:'Target re-apply Early-April'},
   ]},
  {code:'HDP',  group:'AB', submit1:6000,  obtained:800,  products:['GL BORON'],
   revType:'active', revNote:'Submit #2: Additional GL BORON pending approval',
   revSubmitDate:'02/03/26', revStatus:'Menunggu Disposisi Kasi',
   revFrom:[{prod:'GL BORON',mt:800,label:'Obtained #1'}], revTo:[{prod:'GL BORON',mt:2200,label:'Submit #2 (Additional)'}], revMT:2200,
   utilizationMT:800, availableQuota:0,
   utilizationByProd:{"GL BORON": 800}, availableByProd:{},
   remarks:'SUBMIT MOT 30/10/25', spiRef:'SPI TERBIT 7/11/25 · Target re-apply End-Feb',
   cycles:[
     {type:'Submit #1',  mt:6000, products:{'GL BORON':6000}, submitType:'Submit MOI', submitDate:'16/10/2025', releaseType:'PERTEK', releaseDate:'29/10/2025', status:''},
     {type:'Obtained #1',mt:800,  products:{'GL BORON':800},  submitType:'Submit MOT', submitDate:'30/10/2025', releaseType:'SPI',    releaseDate:'07/11/2025', status:''},
     {type:'Submit #2',  mt:2200, products:{'GL BORON':2200}, submitType:'Submit MOI (Submit #2) Perubahan', submitDate:'25/02/2026', releaseType:'PERTEK Perubahan', releaseDate:'TBA', status:'Update 02/03/26 - Menunggu Disposisi Kasi'},
     {type:'Obtained #2',mt:'TBA',products:{'GL BORON':'TBA'},submitType:'Submit MOT (Submit #2) Perubahan', submitDate:'TBA', releaseType:'SPI Perubahan', releaseDate:'TBA', status:''},
   ]},
  {code:'AMP',  group:'AB', submit1:7000,  obtained:800,  products:['GL BORON','PPGL CARBON'],
   revType:'none', revNote:'', revSubmitDate:'', revStatus:'', revFrom:[], revTo:[], revMT:0,
   utilizationMT:800, availableQuota:0,
   utilizationByProd:{"GL BORON": 400, "PPGL CARBON": 400}, availableByProd:{"GL BORON": 0, "PPGL CARBON": 0},
   remarks:'SUBMIT MOT 4/11/25', spiRef:"SPI TERBIT 27/11/25 · Target re-apply April'26",
   cycles:[
     {type:'Submit #1',  mt:7000, products:{'GL BORON':6000,'PPGL CARBON':1000}, submitType:'Submit MOI', submitDate:'16/10/2025', releaseType:'PERTEK', releaseDate:'23/10/2025', status:''},
     {type:'Obtained #1',mt:800,  products:{'GL BORON':400,'PPGL CARBON':400},   submitType:'Submit MOT', submitDate:'04/11/2025', releaseType:'SPI',    releaseDate:'27/11/2025', status:"Target re-apply April'26"},
   ]},
  {code:'CGK',  group:'AB', submit1:6000,  obtained:800,  products:['GI BORON'],
   revType:'active', revSubmitDate:'02/03/26', revStatus:'Menunggu Disposisi Kasi',
   revNote:'Submit #2: Additional 2,200 MT GI BORON pending approval',
   revFrom:[{prod:'GI BORON',mt:800,label:'Obtained #1'}], revTo:[{prod:'GI BORON',mt:2200,label:'Submit #2 (Additional)'}], revMT:2200,
   utilizationMT:800, availableQuota:0,
   utilizationByProd:{"GI BORON": 800}, availableByProd:{},
   remarks:'SUBMIT MOI Perubahan 25/02/26', spiRef:'SPI TERBIT 7/11/25',
   cycles:[
     {type:'Submit #1',  mt:6000, products:{'GI BORON':6000}, submitType:'Submit MOI', submitDate:'16/10/2025', releaseType:'PERTEK', releaseDate:'29/10/2025', status:''},
     {type:'Obtained #1',mt:800,  products:{'GI BORON':800},  submitType:'Submit MOT', submitDate:'30/10/2025', releaseType:'SPI',    releaseDate:'07/11/2025', status:''},
     {type:'Submit #2',  mt:2200, products:{'GI BORON':2200}, submitType:'Submit MOI Perubahan (Submit #2)', submitDate:'25/02/2026', releaseType:'PERTEK Perubahan (Submit #2)', releaseDate:'TBA', status:'Update 02/03/26 - Menunggu Disposisi Kasi'},
     {type:'Obtained #2',mt:'TBA',products:{'GI BORON':'TBA'},submitType:'Submit MOT Perubahan (Submit #2)', submitDate:'TBA', releaseType:'SPI Perubahan (Submit #2)', releaseDate:'TBA', status:''},
   ]},
  {code:'GNG',  group:'AB', submit1:6000,  obtained:250,  products:['GL BORON'],
   revType:'active', revSubmitDate:'02/03/26', revStatus:'Menunggu Disposisi Kasi',
   revNote:'Submit #2: Additional 2,750 MT GL BORON pending approval',
   revFrom:[{prod:'GL BORON',mt:250,label:'Obtained #1'}], revTo:[{prod:'GL BORON',mt:2750,label:'Submit #2 (Additional)'}], revMT:2750,
   utilizationMT:250, availableQuota:0,
   utilizationByProd:{"GL BORON": 250}, availableByProd:{},
   remarks:'SUBMIT MOI Perubahan 25/02/26', spiRef:'SPI TERBIT 7/11/25',
   cycles:[
     {type:'Submit #1',  mt:6000, products:{'GL BORON':6000}, submitType:'Submit MOI', submitDate:'14/10/2025', releaseType:'PERTEK', releaseDate:'29/10/2025', status:''},
     {type:'Obtained #1',mt:250,  products:{'GL BORON':250},  submitType:'Submit MOT', submitDate:'30/10/2025', releaseType:'SPI',    releaseDate:'07/11/2025', status:''},
     {type:'Submit #2',  mt:2750, products:{'GL BORON':2750}, submitType:'Submit MOI Perubahan (Submit #2)', submitDate:'25/02/2026', releaseType:'PERTEK Perubahan (Submit #2)', releaseDate:'TBA', status:'Update 02/03/26 - Menunggu Disposisi Kasi'},
     {type:'Obtained #2',mt:'TBA',products:{'GL BORON':'TBA'},submitType:'Submit MOTP Perubahan (Submit #2)', submitDate:'TBA', releaseType:'SPI Perubahan (Submit #2)', releaseDate:'TBA', status:''},
   ]},
  {code:'MIN',  group:'AB', submit1:6000,  obtained:600,  products:['BORDES ALLOY'],
   revType:'none', revNote:'', revSubmitDate:'', revStatus:'', revFrom:[], revTo:[], revMT:0,
   utilizationMT:247, availableQuota:353,
   utilizationByProd:{"BORDES ALLOY": 247}, availableByProd:{"BORDES ALLOY": 353},
   remarks:'SUBMIT MOT 30/10/25', spiRef:'SPI TERBIT 7/11/25 · Target re-apply Early-March',
   cycles:[
     {type:'Submit #1',  mt:6000, products:{'BORDES ALLOY':6000}, submitType:'Submit MOI', submitDate:'15/10/2025', releaseType:'PERTEK', releaseDate:'29/10/2025', status:''},
     {type:'Obtained #1',mt:600,  products:{'BORDES ALLOY':600},  submitType:'Submit MOT', submitDate:'30/10/2025', releaseType:'SPI',    releaseDate:'07/11/2025', status:'Target re-apply Early-March'},
   ]},
  {code:'JKT',  group:'AB', submit1:6000,  obtained:300,  products:['GL BORON'],
   revType:'none', revNote:'', revSubmitDate:'', revStatus:'', revFrom:[], revTo:[], revMT:0,
   utilizationMT:300, availableQuota:0,
   utilizationByProd:{"GL BORON": 300}, availableByProd:{},
   remarks:'SUBMIT MOT 22/12/25', spiRef:'SPI TERBIT 09/01/26 · Target re-apply Mid-March',
   cycles:[
     {type:'Submit #1',  mt:6000, products:{'GL BORON':6000}, submitType:'Submit MOI', submitDate:'15/10/2025', releaseType:'PERTEK', releaseDate:'29/10/2025', status:''},
     {type:'Obtained #1',mt:300,  products:{'GL BORON':300},  submitType:'Submit MOT', submitDate:'22/12/2025', releaseType:'SPI',    releaseDate:'09/01/2026', status:'Target re-apply Mid March'},
   ]},
  {code:'BHG',  group:'AB', submit1:6000,  obtained:200,  products:['PPGL CARBON'],
   revType:'none', revNote:'', revSubmitDate:'', revStatus:'', revFrom:[], revTo:[], revMT:0,
   utilizationMT:200, availableQuota:0,
   utilizationByProd:{"PPGL CARBON": 200}, availableByProd:{},
   remarks:'SUBMIT MOT 5/11/25', spiRef:'SPI TERBIT 5/12/25 · Target re-apply End-April',
   cycles:[
     {type:'Submit #1',  mt:6000, products:{'PPGL CARBON':6000}, submitType:'Submit MOI', submitDate:'21/10/2025', releaseType:'PERTEK', releaseDate:'03/11/2025', status:''},
     {type:'Obtained #1',mt:200,  products:{'PPGL CARBON':200},  submitType:'Submit MOT', submitDate:'05/11/2025', releaseType:'SPI',    releaseDate:'05/12/2025', status:'Target re-apply End-April'},
   ]},
  {code:'NCT',  group:'AB', submit1:6000,  obtained:150,  products:['GI BORON'],
   revType:'none', revNote:'', revSubmitDate:'22/01/2026', revStatus:'✅ Done — Revision Cancelled · Original SPI Active', revFrom:[], revTo:[], revMT:0,
   utilizationMT:150, availableQuota:0,
   utilizationByProd:{"GI BORON": 150}, availableByProd:{"GI BORON": 0},
   remarks:'SPI TERBIT 5/12/25 · Revision submitted 22/01/26 — Cancelled, original SPI stands', spiRef:'✅ SPI TERBIT 05/12/25 · GI BORON 150 MT · Revision Cancelled · ETA JKT 30 Apr 2026',
   cycles:[
     {type:'Submit #1',  mt:6000, products:{'GI BORON':6000}, submitType:'Submit MOI', submitDate:'22/10/2025', releaseType:'PERTEK', releaseDate:'04/11/2025', status:''},
     {type:'Obtained #1',mt:150,  products:{'GI BORON':150},  submitType:'Submit MOT', submitDate:'05/11/2025', releaseType:'SPI',    releaseDate:'05/12/2025', status:'Revision cancelled — original product unchanged'},
   ]},
  {code:'BBB',  group:'AB', submit1:6000,  obtained:400,  products:['GL BORON'],
   revType:'none', revNote:'', revSubmitDate:'', revStatus:'', revFrom:[], revTo:[], revMT:0,
   utilizationMT:400, availableQuota:0,
   utilizationByProd:{"GL BORON": 400}, availableByProd:{},
   remarks:'SUBMIT MOT 3/12/25', spiRef:'SPI TERBIT 15/01/26 · Target re-apply Mid-March',
   cycles:[
     {type:'Submit #1',  mt:6000, products:{'GL BORON':6000}, submitType:'Submit MOI', submitDate:'21/10/2025', releaseType:'PERTEK', releaseDate:'11/11/2025', status:''},
     {type:'Obtained #1',mt:400,  products:{'GL BORON':400},  submitType:'Submit MOT', submitDate:'03/12/2025', releaseType:'SPI',    releaseDate:'15/01/2026', status:'Target re-apply Mid-March'},
   ]},
  {code:'GKL',  group:'AB', submit1:10000, obtained:2400, products:['GI BORON','ERW PIPE OD≤140mm','ERW PIPE OD>140mm'],
   revType:'none', revNote:'', revSubmitDate:'', revStatus:'', revFrom:[], revTo:[], revMT:0,
   utilizationMT:1940, availableQuota:460,
   utilizationByProd:{"GI BORON": 1100, "ERW PIPE OD≤140mm": 704, "ERW PIPE OD>140mm": 136}, availableByProd:{"GI BORON": 0, "ERW PIPE OD≤140mm": 96, "ERW PIPE OD>140mm": 364},
   realizationByProd:{"GI BORON": 0, "ERW PIPE OD≤140mm": 515.01, "ERW PIPE OD>140mm": 78.92},
   etaByProd:{"GI BORON": "ETA 18 Apr 26", "ERW PIPE OD≤140mm": "Done (06 Mar ✓)", "ERW PIPE OD>140mm": "Done (06 Mar ✓)"},
   arrivedByProd:{"GI BORON": false, "ERW PIPE OD≤140mm": true, "ERW PIPE OD>140mm": true},
   remarks:'SUBMIT MOT 26/11/25', spiRef:'SPI TERBIT 24/12/25 · GI BORON +100 MT util · ETA 31 May 2026',
   cycles:[
     {type:'Submit #1',  mt:10000,products:{'GI BORON':6000,'ERW PIPE OD≤140mm':3000,'ERW PIPE OD>140mm':1000}, submitType:'Submit MOI', submitDate:'15/10/2025', releaseType:'PERTEK', releaseDate:'11/11/2025', status:''},
     {type:'Obtained #1',mt:2400, products:{'GI BORON':1100,'ERW PIPE OD≤140mm':800, 'ERW PIPE OD>140mm':500},  submitType:'Submit MOT', submitDate:'26/11/2025', releaseType:'SPI',    releaseDate:'24/12/2025', status:'Target re-apply End-April'},
   ]},
  {code:'GAS',  group:'AB', submit1:6000,  obtained:200,  products:['BORDES ALLOY'],
   revType:'active', revSubmitDate:'20/01/26', revStatus:'Menunggu Disposisi Kasi',
   revNote:'Reallocation: 200 MT BORDES ALLOY → 130 MT BORDES ALLOY + 70 MT AS STEEL',
   revFrom:[{prod:'BORDES ALLOY',mt:200,label:'Original (total)'}],
   revTo:[{prod:'BORDES ALLOY',mt:130,label:'Retained'},{prod:'AS STEEL',mt:70,label:'Reallocated'}], revMT:70,
   utilizationMT:0, availableQuota:200,
   utilizationByProd:{}, availableByProd:{"BORDES ALLOY": 200},
   remarks:'SUBMIT MOI Perubahan 20/01/26', spiRef:'SPI TERBIT 09/01/26',
   cycles:[
     {type:'Submit #1',  mt:6000, products:{'BORDES ALLOY':6000}, submitType:'Submit MOI', submitDate:'27/10/2025', releaseType:'PERTEK', releaseDate:'11/11/2025', status:''},
     {type:'Obtained #1',mt:200,  products:{'BORDES ALLOY':200},  submitType:'Submit MOT', submitDate:'22/12/2025', releaseType:'SPI',    releaseDate:'09/01/2026', status:''},
     {type:'Revision #1',mt:-70,  products:{'BORDES ALLOY':70},   submitType:'Submit MOI Perubahan (Revision #1)', submitDate:'20/01/2026', releaseType:'PERTEK Perubahan (Revision #1)', releaseDate:'TBA', status:'Update 04/03/26 - Menunggu Disposisi Kasi'},
     {type:'Obtained (Revision #1)',mt:70,products:{'AS STEEL':70},submitType:'Submit MOT Perubahan (Revision #1)',submitDate:'TBA',releaseType:'SPI Perubahan (Revision #1)',releaseDate:'TBA',status:''},
   ]},
  {code:'KJK',  group:'AB', submit1:6000,  obtained:950,  products:['GL BORON'],
   revType:'none', revNote:'', revSubmitDate:'', revStatus:'', revFrom:[], revTo:[], revMT:0,
   utilizationMT:950, availableQuota:0,
   utilizationByProd:{"GL BORON": 950}, availableByProd:{},
   realizationByProd:{"GL BORON": 546.57}, etaByProd:{"GL BORON": "Done (06 Mar ✓)"}, arrivedByProd:{"GL BORON": true},
   remarks:'SUBMIT MOT 03/12/25', spiRef:'SPI TERBIT 31/12/25 · Target re-apply Mid-March',
   cycles:[
     {type:'Submit #1',  mt:6000, products:{'GL BORON':6000}, submitType:'Submit MOI', submitDate:'15/10/2025', releaseType:'PERTEK', releaseDate:'11/11/2025', status:''},
     {type:'Obtained #1',mt:950,  products:{'GL BORON':950},  submitType:'Submit MOT', submitDate:'03/12/2025', releaseType:'SPI',    releaseDate:'31/12/2025', status:'Target re-apply Mid-March'},
   ]},
  {code:'HKG',  group:'AB', submit1:6000,  obtained:750,  products:['GL BORON'],
   revType:'none', revNote:'', revSubmitDate:'', revStatus:'', revFrom:[], revTo:[], revMT:0,
   utilizationMT:750, availableQuota:0,
   utilizationByProd:{"GL BORON": 750}, availableByProd:{},
   realizationByProd:{"GL BORON": 249.94}, etaByProd:{"GL BORON": "Done (06 Mar ✓)"}, arrivedByProd:{"GL BORON": true},
   remarks:'SUBMIT MOT 03/12/25', spiRef:'SPI TERBIT 31/12/25 · Target re-apply Early-March',
   cycles:[
     {type:'Submit #1',  mt:6000, products:{'GL BORON':6000}, submitType:'Submit MOI', submitDate:'16/10/2025', releaseType:'PERTEK', releaseDate:'14/11/2025', status:''},
     {type:'Obtained #1',mt:750,  products:{'GL BORON':750},  submitType:'Submit MOT', submitDate:'03/12/2025', releaseType:'SPI',    releaseDate:'31/12/2025', status:'Target re-apply Early-March'},
   ]},
  {code:'SPA',  group:'CD', submit1:6000,  obtained:515,  products:['BORDES ALLOY'],
   revType:'none', revNote:'', revSubmitDate:'', revStatus:'', revFrom:[], revTo:[], revMT:0,
   utilizationMT:114, availableQuota:401,
   utilizationByProd:{"BORDES ALLOY": 114}, availableByProd:{"BORDES ALLOY": 401},
   remarks:'SUBMIT MOT 3/12/25', spiRef:'SPI TERBIT 13/01/26 · Target re-apply Early-March',
   cycles:[
     {type:'Submit #1',  mt:6000, products:{'BORDES ALLOY':6000}, submitType:'Submit MOI', submitDate:'27/10/2025', releaseType:'PERTEK', releaseDate:'11/11/2025', status:''},
     {type:'Obtained #1',mt:515,  products:{'BORDES ALLOY':515},  submitType:'Submit MOT', submitDate:'03/12/2025', releaseType:'SPI',    releaseDate:'13/01/2026', status:'Target re-apply Early-March'},
   ]},
  {code:'ADP',  group:'CD', submit1:6000,  obtained:250,  products:['GL BORON'],
   revType:'none', revNote:'', revSubmitDate:'', revStatus:'', revFrom:[], revTo:[], revMT:0,
   utilizationMT:250, availableQuota:0,
   utilizationByProd:{"GL BORON": 250}, availableByProd:{},
   remarks:'SUBMIT MOT 21/11/25', spiRef:'SPI TERBIT 16/12/25 · Target re-apply Mid-March',
   cycles:[
     {type:'Submit #1',  mt:6000, products:{'GL BORON':6000}, submitType:'Submit MOI', submitDate:'28/10/2025', releaseType:'PERTEK', releaseDate:'14/11/2025', status:''},
     {type:'Obtained #1',mt:250,  products:{'GL BORON':250},  submitType:'Submit MOT', submitDate:'21/11/2025', releaseType:'SPI',    releaseDate:'16/12/2025', status:'Target re-apply Mid-March'},
   ]},
  {code:'MSN',  group:'CD', submit1:6000,  obtained:150,  products:['GL BORON'],
   revType:'none', revNote:'', revSubmitDate:'', revStatus:'', revFrom:[], revTo:[], revMT:0,
   utilizationMT:150, availableQuota:0,
   utilizationByProd:{"GL BORON": 150}, availableByProd:{},
   remarks:'SUBMIT MOT 09/12/25', spiRef:'SPI TERBIT 06/01/26 · Target re-apply Early-March',
   cycles:[
     {type:'Submit #1',  mt:6000, products:{'GL BORON':6000}, submitType:'Submit MOI', submitDate:'28/10/2025', releaseType:'PERTEK', releaseDate:'13/11/2025', status:''},
     {type:'Obtained #1',mt:150,  products:{'GL BORON':150},  submitType:'Submit MOT', submitDate:'09/12/2025', releaseType:'SPI',    releaseDate:'06/01/2026', status:'Target re-apply Early-March'},
   ]},
  {code:'SPP',  group:'CD', submit1:6000,  obtained:250,  products:['GI BORON'],
   revType:'none', revNote:'', revSubmitDate:'13/01/2026', revStatus:'✅ Done — Revision Cancelled · Original SPI Active', revFrom:[], revTo:[], revMT:0,
   utilizationMT:250, availableQuota:0,
   utilizationByProd:{"GI BORON": 250}, availableByProd:{"GI BORON": 0},
   remarks:'SPI TERBIT 16/12/25 · Revision submitted 13/01/26 — Cancelled, original SPI stands', spiRef:'✅ SPI TERBIT 16/12/25 · GI BORON 250 MT · Revision Cancelled · ETA JKT 30 Apr 2026',
   cycles:[
     {type:'Submit #1',  mt:6000, products:{'GI BORON':6000}, submitType:'Submit MOI', submitDate:'29/10/2025', releaseType:'PERTEK', releaseDate:'13/11/2025', status:''},
     {type:'Obtained #1',mt:250,  products:{'GI BORON':250},  submitType:'Submit MOT', submitDate:'TBA',        releaseType:'SPI',    releaseDate:'16/12/2025', status:'Revision cancelled — original product unchanged'},
   ]},
  {code:'LCP',  group:'CD', submit1:6000,  obtained:275,  products:['GL BORON'],
   revType:'none', revNote:'', revSubmitDate:'', revStatus:'', revFrom:[], revTo:[], revMT:0,
   utilizationMT:275, availableQuota:0,
   utilizationByProd:{"GL BORON": 275}, availableByProd:{},
   remarks:'SUBMIT MOT 22/12/25', spiRef:"SPI TERBIT 09/01/26 · Target re-apply April'26",
   cycles:[
     {type:'Submit #1',  mt:6000, products:{'GL BORON':6000}, submitType:'Submit MOI', submitDate:'05/11/2025', releaseType:'PERTEK', releaseDate:'17/12/2025', status:''},
     {type:'Obtained #1',mt:275,  products:{'GL BORON':275},  submitType:'Submit MOT', submitDate:'22/12/2025', releaseType:'SPI',    releaseDate:'09/01/2026', status:"Target re-apply April'26"},
   ]},
  {code:'KAN',  group:'CD', submit1:6000,  obtained:80,   products:['GI BORON'],
   revType:'none', revNote:'', revSubmitDate:'', revStatus:'', revFrom:[], revTo:[], revMT:0,
   utilizationMT:80, availableQuota:0,
   utilizationByProd:{"GI BORON": 80}, availableByProd:{},
   remarks:'SUBMIT MOT 22/12/25', spiRef:"SPI TERBIT 09/01/26 · Target re-apply April'26",
   cycles:[
     {type:'Submit #1',  mt:6000, products:{'GI BORON':6000}, submitType:'Submit MOI', submitDate:'06/11/2025', releaseType:'PERTEK', releaseDate:'17/12/2025', status:''},
     {type:'Obtained #1',mt:80,   products:{'GI BORON':80},   submitType:'Submit MOT', submitDate:'22/12/2025', releaseType:'SPI',    releaseDate:'09/01/2026', status:"Target re-apply April'26"},
   ]},
  {code:'LSJ',  group:'CD', submit1:6000,  obtained:500,  products:['GI BORON'],
   revType:'none', revNote:'', revSubmitDate:'', revStatus:'', revFrom:[], revTo:[], revMT:0,
   utilizationMT:500, availableQuota:0,
   utilizationByProd:{"GI BORON": 500}, availableByProd:{},
   remarks:'SUBMIT MOT 22/12/25', spiRef:"SPI TERBIT 09/01/26 · Target re-apply April'26",
   cycles:[
     {type:'Submit #1',  mt:6000, products:{'GI BORON':6000}, submitType:'Submit MOI', submitDate:'06/11/2025', releaseType:'PERTEK', releaseDate:'17/12/2025', status:''},
     {type:'Obtained #1',mt:500,  products:{'GI BORON':500},  submitType:'Submit MOT', submitDate:'22/12/2025', releaseType:'SPI',    releaseDate:'09/01/2026', status:"Target re-apply April'26"},
   ]},
  {code:'SJH',  group:'AB', submit1:6000,  obtained:300,  products:['GL BORON'],
   revType:'none', revNote:'', revSubmitDate:'', revStatus:'', revFrom:[], revTo:[], revMT:0,
   utilizationMT:0, availableQuota:300,
   utilizationByProd:{}, availableByProd:{"GL BORON": 300},
   remarks:'SUBMIT MOT 12/12/25', spiRef:'SPI TERBIT 06/01/26 · Target re-apply Early-March',
   cycles:[
     {type:'Submit #1',  mt:6000, products:{'GL BORON':6000}, submitType:'Submit MOI', submitDate:'17/11/2025', releaseType:'PERTEK', releaseDate:'12/12/2025', status:''},
     {type:'Obtained #1',mt:300,  products:{'GL BORON':300},  submitType:'Submit MOT', submitDate:'12/12/2025', releaseType:'SPI',    releaseDate:'06/01/2026', status:'Target re-apply Early-March'},
   ]},
  {code:'BDG',  group:'AB', submit1:6000,  obtained:1000, products:['BORDES ALLOY'],
   revType:'active', revSubmitDate:'04/02/26', revStatus:'Menunggu Disposisi Kasi',
   revNote:'Reallocation: 1,000 MT BORDES ALLOY → 350 MT BORDES ALLOY + 650 MT GL BORON',
   revFrom:[{prod:'BORDES ALLOY',mt:1000,label:'Original (total)'}],
   revTo:[{prod:'BORDES ALLOY',mt:350,label:'Retained'},{prod:'GL BORON',mt:650,label:'Reallocated'}], revMT:650,
   utilizationMT:0, availableQuota:1000,
   utilizationByProd:{}, availableByProd:{"BORDES ALLOY": 1000},
   remarks:'SUBMIT MOI Perubahan 04/02/26', spiRef:'SPI TERBIT 13/01/26',
   cycles:[
     {type:'Submit #1',  mt:6000, products:{'BORDES ALLOY':6000}, submitType:'Submit MOI', submitDate:'13/11/2025', releaseType:'PERTEK', releaseDate:'22/12/2025', status:''},
     {type:'Obtained #1',mt:1000, products:{'BORDES ALLOY':1000}, submitType:'Submit MOT', submitDate:'23/12/2025', releaseType:'SPI',    releaseDate:'13/01/2026', status:''},
     {type:'Revision #1',mt:-650, products:{'BORDES ALLOY':650},  submitType:'Submit MOI Perubahan (Revision #1)', submitDate:'04/02/2026', releaseType:'PERTEK Perubahan (Revision #1)', releaseDate:'TBA', status:'Update 25/02/26 - Menunggu Disposisi Kasi'},
     {type:'Obtained (Revision #1)',mt:650,products:{'GL BORON':650},submitType:'Submit MOT Perubahan (Revision #1)',submitDate:'TBA',releaseType:'SPI Perubahan (Revision #1)',releaseDate:'TBA',status:''},
   ]},
  {code:'SGD',  group:'AB', submit1:6000,  obtained:2000, products:['SHEETPILE'],
   revType:'none', revNote:'', revSubmitDate:'', revStatus:'', revFrom:[], revTo:[], revMT:0,
   utilizationMT:2000, availableQuota:0,
   utilizationByProd:{"SHEETPILE": 2000}, availableByProd:{},
   realizationByProd:{"SHEETPILE": 492},
   etaByProd:{"SHEETPILE": "Partial Arrived · Remaining ETA 31 Mar 26"},
   arrivedByProd:{"SHEETPILE": false},
   remarks:'SUBMIT MOT 20/01/26', spiRef:'SPI TERBIT 28/01/26 · Target re-apply Early-March',
   cycles:[
     {type:'Submit #1',  mt:6000, products:{SHEETPILE:6000}, submitType:'Submit MOI', submitDate:'14/11/2025', releaseType:'PERTEK', releaseDate:'19/01/2026', status:''},
     {type:'Obtained #1',mt:2000, products:{SHEETPILE:2000}, submitType:'Submit MOT', submitDate:'20/01/2026', releaseType:'SPI',    releaseDate:'28/01/2026', status:'Target re-apply Early-March'},
   ]},
  {code:'BTS',  group:'AB', submit1:16000, obtained:6000, products:['BORDES ALLOY','AS STEEL','SHEETPILE','SEAMLESS PIPE'],
   revType:'complete', revSubmitDate:'07/11/25', revStatus:'PERTEK TERBIT 25/02/26',
   revNote:'Full Pertek issued 25/02/26 — 6,000 MT across 4 products',
   revFrom:[], revTo:[], revMT:0,
   utilizationMT:1203.2, availableQuota:4796.8,
   utilizationByProd:{"SHEETPILE": 1203.2}, availableByProd:{"BORDES ALLOY": 900, "AS STEEL": 900, "SHEETPILE": 1996.8, "SEAMLESS PIPE": 1000},
   remarks:'Penerimaan permohonan di Inatrade', spiRef:'PERTEK TERBIT 25/02/26',
   cycles:[
     {type:'Submit #1',  mt:16000,products:{'BORDES ALLOY':3000,'AS STEEL':2000,SHEETPILE:8000,'SEAMLESS PIPE':3000}, submitType:'Submit MOI', submitDate:'26/11/2025', releaseType:'PERTEK', releaseDate:'25/02/2026', status:''},
     {type:'Obtained #1',mt:6000, products:{'BORDES ALLOY':900,'AS STEEL':900,SHEETPILE:3200,'SEAMLESS PIPE':1000},  submitType:'Submit MOT', submitDate:'26/02/2026', releaseType:'SPI',    releaseDate:'TBA',        status:''},
   ]},
  {code:'SMS',  group:'AB', submit1:6000,  obtained:150,  products:['SHEETPILE'],
   revType:'complete', revSubmitDate:'27/02/26', revStatus:'PERTEK TERBIT 26/02/26 — SPI belum terbit',
   revNote:'PERTEK TERBIT 26/02/26 — SPI belum terbit', revFrom:[], revTo:[], revMT:0,
   utilizationMT:150, availableQuota:0,
   utilizationByProd:{"SHEETPILE": 150}, availableByProd:{},
   remarks:'SUBMIT MOT 27/02/26', spiRef:'PERTEK TERBIT 26/02/26',
   cycles:[
     {type:'Submit #1',  mt:6000, products:{SHEETPILE:6000}, submitType:'Submit MOI', submitDate:'14/11/2025', releaseType:'PERTEK', releaseDate:'26/02/2026', status:''},
     {type:'Obtained #1',mt:150,  products:{SHEETPILE:150},  submitType:'Submit MOT', submitDate:'27/02/2026', releaseType:'SPI',    releaseDate:'TBA',        status:''},
   ]},
  {code:'GIS',  group:'NORMATIF', submit1:6000, obtained:400, products:['SHEETPILE'],
   revType:'complete', revSubmitDate:'01/03/26',
   revStatus:'PERTEK TERBIT 01/03/26 — SPI belum terbit',
   revNote:'PERTEK TERBIT 01/03/26 — SPI belum terbit', revFrom:[], revTo:[], revMT:0,
   utilizationMT:400, availableQuota:0,
   utilizationByProd:{"SHEETPILE": 400}, availableByProd:{},
   remarks:'SUBMIT MOT TBA', spiRef:'PERTEK TERBIT 01/03/26',
   cycles:[
     {type:'Submit #1',         mt:6000, products:{SHEETPILE:6000}, submitType:'Submit MOI', submitDate:'27/10/2025', releaseType:'PERTEK', releaseDate:'01/03/2026', status:'PERTEK TERBIT 01/03/26'},
     {type:'Obtained #1',      mt:400,  products:{SHEETPILE:400},  submitType:'Submit MOT', submitDate:'TBA',        releaseType:'SPI',    releaseDate:'TBA',        status:'PERTEK Terbit: 01/03/26 · SPI: Not yet issued'},
   ]},
  {code:'DIOR', group:'CD', submit1:6000,  obtained:100,  products:['BORDES ALLOY'],
   revType:'none', revNote:'', revSubmitDate:'', revStatus:'', revFrom:[], revTo:[], revMT:0,
   utilizationMT:0, availableQuota:100,
   utilizationByProd:{}, availableByProd:{"BORDES ALLOY": 100},
   remarks:'SPI TERBIT 24/12/25', spiRef:'(Hold, waiting address changes)',
   cycles:[
     {type:'Submit #1',  mt:6000, products:{'BORDES ALLOY':6000}, submitType:'Submit MOI', submitDate:'05/11/2025', releaseType:'PERTEK', releaseDate:'03/12/2025', status:''},
     {type:'Obtained #1',mt:100,  products:{'BORDES ALLOY':100},  submitType:'Submit MOT', submitDate:'TBA',        releaseType:'SPI',    releaseDate:'TBA',        status:'(Hold, waiting address changes)'},
   ]},
  {code:'MJU',  group:'AB', submit1:6000,  obtained:200,  products:['BORDES ALLOY'],
   revType:'complete', revSubmitDate:'12/01/26', revStatus:'PERTEK Perubahan Terbit 04/02/26 — SPI Perubahan belum terbit',
   revNote:'Product change: BORDES ALLOY → Hollow Pipe (200 MT) — PERTEK Perubahan terbit 04/02/26, SPI Perubahan belum terbit',
   revFrom:[{prod:'BORDES ALLOY',mt:200,label:'Original'}], revTo:[{prod:'HOLLOW PIPE',mt:200,label:'Revised'}], revMT:200,
   utilizationMT:0, availableQuota:200,
   utilizationByProd:{}, availableByProd:{"BORDES ALLOY": 200},
   remarks:'SUBMIT MOI Perubahan 12/01/26', spiRef:'SPI TERBIT 05/01/26 (SPI Original) · SPI Perubahan belum terbit',
   cycles:[
     {type:'Submit #1',  mt:6000, products:{'BORDES ALLOY':6000}, submitType:'Submit MOI', submitDate:'17/11/2025', releaseType:'PERTEK', releaseDate:'03/12/2025', status:''},
     {type:'Obtained #1',mt:200,  products:{'BORDES ALLOY':200},  submitType:'Submit MOT', submitDate:'09/12/2025', releaseType:'SPI',    releaseDate:'05/01/2026', status:''},
     {type:'Revision #1',mt:-200, products:{'BORDES ALLOY':200},  submitType:'Submit MOI Perubahan (Revision #1)', submitDate:'12/01/2026', releaseType:'PERTEK Perubahan (Revision #1)', releaseDate:'04/02/2026', status:''},
     {type:'Obtained (Revision #1)',mt:200,products:{'HOLLOW PIPE':200},submitType:'Submit MOT Perubahan (Revision #1)',submitDate:'TBA',releaseType:'SPI Perubahan (Revision #1)',releaseDate:'TBA',status:'(Hold submit MOT, waiting Sales confirmation)'},
   ]},
];

const PENDING = [
  {code:'KARA', group:'CD', products:['GL BORON'], mt:6000, remarks:'SUBMIT MOI 05/11/25', status:'06/03/26 - Penerimaan permohonan Kemenperin', date:'06/03/26',
   cycles:[
     {type:'Submit #1',  mt:6000, products:{'GL BORON':6000}, submitType:'Submit MOI', submitDate:'05/11/2025', releaseType:'PERTEK', releaseDate:'TBA', status:'Update 06/03/26 - Penerimaan permohonan Kemenperin'},
     {type:'Obtained #1',mt:'TBA',products:{},                submitType:'Submit MOT', submitDate:'TBA',        releaseType:'SPI',    releaseDate:'TBA', status:''},
   ]},
  {code:'AADC', group:'CD', products:['GL BORON'], mt:3000, remarks:'SUBMIT MOI 02/02/26', status:'Permintaan kelengkapan data tambahan', date:'18/03/26',
   cycles:[
     {type:'Submit #1', mt:3000, products:{'GL BORON':3000}, submitType:'Submit MOI', submitDate:'02/02/2026', releaseType:'PERTEK', releaseDate:'TBA', status:'Update 18/03/26 - Permintaan kelengkapan data tambahan'},
     {type:'Obtained #1',mt:'TBA',products:{},               submitType:'Submit MOT', submitDate:'TBA',        releaseType:'SPI',    releaseDate:'TBA', status:''},
   ]},
  {code:'PPGL', group:'CD', products:['GL BORON'], mt:3000, remarks:'SUBMIT MOI 02/02/26', status:'Permintaan data tambahan', date:'12/02/26',
   cycles:[
     {type:'Submit #1', mt:3000, products:{'GL BORON':3000}, submitType:'Submit MOI', submitDate:'02/02/2026', releaseType:'PERTEK', releaseDate:'TBA', status:'Update 12/02/26 - Permintaan data tambahan'},
     {type:'Obtained #1',mt:'TBA',products:{},               submitType:'Submit MOT', submitDate:'TBA',        releaseType:'SPI',    releaseDate:'TBA', status:''},
   ]},
  {code:'SNSD', group:'CD', products:['GL BORON'], mt:3000, remarks:'SUBMIT MOI 02/02/26', status:'Permintaan kelengkapan data tambahan', date:'02/03/26',
   cycles:[
     {type:'Submit #1', mt:3000, products:{'GL BORON':3000}, submitType:'Submit MOI', submitDate:'02/02/2026', releaseType:'PERTEK', releaseDate:'TBA', status:'Update 02/03/26 - Permintaan kelengkapan data tambahan'},
     {type:'Obtained #1',mt:'TBA',products:{},               submitType:'Submit MOT', submitDate:'TBA',        releaseType:'SPI',    releaseDate:'TBA', status:''},
   ]},
];

const RA = [
  {code:'CGK', product:'GI',        berat:487.42, obtained:800,  cargoArrived:true,  realPct:0.609, utilPct:null, arrivalDate:'2026-02-23', etaJKT:'LOT 1 Done (23 Feb ✓) · LOT 2 ETA Early–Mid Mar', reapplyEst:'02 Mar 2026', reapplyStage:2, reapplyProduct:'GI Boron', reapplyNewTotal:3000, reapplyPrevObtained:800, reapplyAdditional:2200, reapplySubmitDate:'25/02/26', reapplyStatus:'Update 02/03/26 - Menunggu Disposisi Kasi', target:600,  pertek:'1051/ILMATE/PERTEK-SPI-U/X/2025',  spi:'04.PI-05.25.3510', catatan:'ARSEN 53 LOT 1 (487.42 MT arrived) · LOT 2 in shipment'},
  {code:'GNG', product:'GL BORON',  berat:242.50, obtained:250,  cargoArrived:true,  realPct:0.970, utilPct:null, arrivalDate:'2026-02-23', etaJKT:'Done (23 Feb ✓)',  reapplyEst:'02 Mar 2026', reapplyStage:2, reapplyProduct:'GL Boron', reapplyNewTotal:3000, reapplyPrevObtained:250, reapplyAdditional:2750, reapplySubmitDate:'25/02/26', reapplyStatus:'Update 02/03/26 - Menunggu Disposisi Kasi', target:250,  pertek:'1044/ILMATE/PERTEK-SPI-U/X/2025',  spi:'04.PI-05.25.3511', catatan:'KEWEI 64B'},
  {code:'HDP', product:'GL BORON',  berat:762.58, obtained:800,  cargoArrived:true,  realPct:0.953, utilPct:null, arrivalDate:'2026-02-23', etaJKT:'Done (23 Feb ✓)',  reapplyEst:'02 Mar 2026', reapplyStage:2, reapplyProduct:'GL Boron', reapplyNewTotal:3000, reapplyPrevObtained:800, reapplyAdditional:2200, reapplySubmitDate:'26/02/26', reapplyStatus:'Update 02/03/26 - Menunggu Disposisi Kasi', target:500,  pertek:'1052/ILMATE/PERTEK-SPI-U/X/2025',  spi:'04.PI-05.25.3505', catatan:'KEWEI 63'},
  {code:'MIN', product:'BORDES ALLOY', berat:246.70, obtained:600, cargoArrived:true,  realPct:0.411, utilPct:null, arrivalDate:'2026-02-24', etaJKT:'Done (24 Feb ✓)',  reapplyEst:'', reapplyStage:1, target:null, pertek:'1050/ILMATE/PERTEK-SPI-U/X/2025',  spi:'04.PI-05.25.3508', catatan:'ARSEN WP 01'},
  {code:'MSN', product:'GL',        berat:150,   obtained:150,  cargoArrived:false, realPct:0,     utilPct:1.000, arrivalDate:null, etaJKT:'07 Mar 26',  reapplyEst:'', reapplyStage:1, target:150,  pertek:'1085/ILMATE/PERTEK-SPI-U/XI/2025', spi:'04.PI-05.26.0273', catatan:'KEWEI 65G'},
  {code:'SJH', product:'GL',        berat:300,   obtained:300,  cargoArrived:false, realPct:0,     utilPct:1.000, arrivalDate:null, etaJKT:'07 Mar 26',  reapplyEst:'', reapplyStage:1, target:250,  pertek:'1161/ILMATE/PERTEK-SPI-U/XII/2025',spi:'04.PI-05.26.0011', catatan:'KEWEI 66'},
  {code:'ADP', product:'GL',        berat:250,   obtained:250,  cargoArrived:false, realPct:0,     utilPct:1.000, arrivalDate:null, etaJKT:'07 Mar 26',  reapplyEst:'', reapplyStage:1, target:150,  pertek:'1084/ILMATE/PERTEK-SPI-U/XI/2025', spi:'04.PI-05.25.3734', catatan:'KEWEI 65F'},
  {code:'BBB', product:'GL',        berat:400,   obtained:400,  cargoArrived:false, realPct:0,     utilPct:1.000, arrivalDate:null, etaJKT:'07 Mar 26',  reapplyEst:'', reapplyStage:1, target:300,  pertek:'1075/ILMATE/PERTEK-SPI-U/XI/2025', spi:'04.PI-05.26.0450', catatan:'KEWEI 65C'},
  {code:'JKT', product:'GL',        berat:300,   obtained:300,  cargoArrived:false, realPct:0,     utilPct:1.000, arrivalDate:null, etaJKT:'07 Mar 26',  reapplyEst:'', reapplyStage:1, target:250,  pertek:'1045/ILMATE/PERTEK-SPI-U/X/2025',  spi:'04.PI-05.26.0329', catatan:'KEWEI 65D'},
  {code:'LCP', product:'GL',        berat:275,   obtained:275,  cargoArrived:false, realPct:0,     utilPct:1.000, arrivalDate:null, etaJKT:'11 Apr 26',  reapplyEst:'', reapplyStage:1, target:200,  pertek:'1106/ILMATE/PERTEK-SPI-U/XI/2025', spi:'04.PI-05.25.3745', catatan:'KEWEI 65E'},
  {code:'AMP', product:'GL + PPGL', berat:800,   obtained:800,  cargoArrived:false, realPct:0,     utilPct:1.000, arrivalDate:null, etaJKT:'10 Apr 26',  reapplyEst:'', reapplyStage:1, target:600,  pertek:'1040/ILMATE/PERTEK-SPI-U/X/2025',  spi:'04.PI-05.25.3544', catatan:'KEWEI 65B / SSSC 12'},
  {code:'BHG', product:'PPGL',      berat:200,   obtained:200,  cargoArrived:false, realPct:0,     utilPct:1.000, arrivalDate:null, etaJKT:'10 Apr 26',  reapplyEst:'', reapplyStage:1, target:150,  pertek:'1057/ILMATE/PERTEK-SPI-U/XI/2025', spi:'04.PI-05.25.3600', catatan:'SSSC 12'},
  {code:'EMS', product:'SHEETPILE', berat:1599.2,obtained:1600, cargoArrived:false, realPct:0,     utilPct:0.999, arrivalDate:null, etaJKT:'31 Mar 26',  reapplyEst:'', reapplyStage:1, target:1200, pertek:'1046/ILMATE/PERTEK-SPI-U/X/2025',  spi:'04.PI-05.25.3512', catatan:'MLION #9'},
  {code:'KJK', product:'GL BORON',  berat:546.57, obtained:950, cargoArrived:true,  realPct:0.575, utilPct:null,  arrivalDate:'2026-03-06', etaJKT:'Done (06 Mar ✓)', reapplyEst:'', reapplyStage:1, target:700,  pertek:'1076/ILMATE/PERTEK-SPI-U/XI/2025', spi:'04.PI-05.25.3899', catatan:'KEWEI 64C / 65A'},
  {code:'HKG', product:'GL BORON',  berat:249.94, obtained:750, cargoArrived:true,  realPct:0.333, utilPct:null,  arrivalDate:'2026-03-06', etaJKT:'Done (06 Mar ✓)', reapplyEst:'', reapplyStage:1, target:500,  pertek:'1083/ILMATE/PERTEK-SPI-U/XI/2025', spi:'04.PI-05.25.3895', catatan:'KEWEI 64A'},
  {code:'SGD', product:'SHEETPILE', berat:2000,  obtained:2000, cargoArrived:false, realPct:0,     utilPct:1.000, arrivalDate:null, etaJKT:'492 MT Arrived · Remaining ETA 31 Mar 26', reapplyEst:'', reapplyStage:1, target:1400, pertek:'1046/ILMATE/PERTEK-SPI-U/X/2025',  spi:'04.PI-05.25.3512', catatan:'MLION #9'},
  {code:'GKL', product:'GI BORON + ERW PIPE', berat:593.93, obtained:2400, cargoArrived:true, realPct:0.247, utilPct:null, arrivalDate:'2026-03-06', etaJKT:'ERW Arrived (06 Mar ✓) · GI BORON ETA 18 Apr 26', reapplyEst:'', reapplyStage:1, target:800, pertek:'1073/ILMATE/PERTEK-SPI-U/XI/2025', spi:'04.PI-05.25.3797', catatan:'YOU FA #6,7,8 / ARSEN 54'},
  {code:'LSJ', product:'GI BORON',  berat:500,   obtained:500,  cargoArrived:false, realPct:0,     utilPct:1.000, arrivalDate:null, etaJKT:'30 Apr 2026', reapplyEst:'', reapplyStage:1, target:null, pertek:'1091/ILMATE/PERTEK-SPI-U/XI/2025', spi:'04.PI-05.25.3755', catatan:'In Shipment · ETA 30 Apr 2026'},
  {code:'KAN', product:'GI BORON',  berat:80,    obtained:80,   cargoArrived:false, realPct:0,     utilPct:1.000, arrivalDate:null, etaJKT:'30 Apr 2026', reapplyEst:'', reapplyStage:1, target:null, pertek:'1087/ILMATE/PERTEK-SPI-U/XI/2025', spi:'04.PI-05.26.0289', catatan:'In Shipment · ETA 30 Apr 2026'},
  {code:'NCT', product:'GI BORON',  berat:150,   obtained:150,  cargoArrived:false, realPct:0,     utilPct:1.000, arrivalDate:null, etaJKT:'30 Apr 2026', reapplyEst:'', reapplyStage:1, target:null, pertek:'1067/ILMATE/PERTEK-SPI-U/XI/2025', spi:'04.PI-05.25.3729', catatan:'In Shipment · ETA 30 Apr 2026'},
  {code:'SPP', product:'GI BORON',  berat:250,   obtained:250,  cargoArrived:false, realPct:0,     utilPct:1.000, arrivalDate:null, etaJKT:'30 Apr 2026', reapplyEst:'', reapplyStage:1, target:null, pertek:'1097/ILMATE/PERTEK-SPI-U/XI/2025', spi:'04.PI-05.25.3799', catatan:'In Shipment · ETA 30 Apr 2026'},
  {code:'SPA', product:'BORDES ALLOY', berat:114.5, obtained:515, cargoArrived:false, realPct:0, utilPct:0.222, arrivalDate:null, etaJKT:'07 Mar 26', reapplyEst:'', reapplyStage:1, target:null, pertek:'1079/ILMATE/PERTEK-SPI-U/XI/2025', spi:'04.PI-05.26.0407', catatan:'ARSEN WP 02'},
];

// ═══════════════════════════════════════════════════════════════════
// SEED FUNCTION
// ═══════════════════════════════════════════════════════════════════
async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    console.log('🧹 Clearing existing data…');
    // Clear in reverse dependency order
    const tables = [
      'company_reapply_targets','company_shipments','ra_records',
      'pending_meta','revision_changes','cycle_products','cycles',
      'company_product_stats','company_products','companies'
    ];
    for (const t of tables) {
      await client.query(`DELETE FROM ${t}`);
    }

    // ── Insert SPI companies ─────────────────────────────────────
    console.log(`📥 Seeding ${SPI.length} SPI companies…`);
    for (const co of SPI) {
      await client.query(
        `INSERT INTO companies
           (code, grp, section, submit1, obtained, utilization_mt, available_quota,
            rev_type, rev_note, rev_submit_date, rev_status, rev_mt,
            remarks, spi_ref)
         VALUES ($1,$2,'SPI',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [co.code, co.group, co.submit1||null, co.obtained||0,
         co.utilizationMT||0, co.availableQuota!=null?co.availableQuota:null,
         co.revType||'none', co.revNote||'', co.revSubmitDate||'', co.revStatus||'',
         co.revMT||0, co.remarks||'', co.spiRef||'']
      );

      // Products
      for (let i = 0; i < co.products.length; i++) {
        await client.query(
          `INSERT INTO company_products (company_code, product, sort_order) VALUES ($1,$2,$3)`,
          [co.code, co.products[i], i]
        );
      }

      // Per-product stats
      const allProds = new Set([
        ...Object.keys(co.utilizationByProd||{}),
        ...Object.keys(co.availableByProd||{}),
        ...Object.keys(co.realizationByProd||{}),
        ...Object.keys(co.etaByProd||{}),
      ]);
      for (const prod of allProds) {
        await client.query(
          `INSERT INTO company_product_stats
             (company_code, product, utilization_mt, available_mt, realization_mt, eta_jkt, arrived)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (company_code, product) DO UPDATE SET
             utilization_mt=EXCLUDED.utilization_mt,
             available_mt=EXCLUDED.available_mt,
             realization_mt=EXCLUDED.realization_mt,
             eta_jkt=EXCLUDED.eta_jkt,
             arrived=EXCLUDED.arrived`,
          [co.code, prod,
           co.utilizationByProd?.[prod]??null,
           co.availableByProd?.[prod]??null,
           co.realizationByProd?.[prod]??null,
           co.etaByProd?.[prod]||null,
           co.arrivedByProd?.[prod]??false]
        );
      }

      // Revision changes (from / to)
      for (let i = 0; i < (co.revFrom||[]).length; i++) {
        const f = co.revFrom[i];
        await client.query(
          `INSERT INTO revision_changes (company_code, direction, product, mt, label, sort_order)
           VALUES ($1,'from',$2,$3,$4,$5)`,
          [co.code, f.prod, f.mt||null, f.label||'', i]
        );
      }
      for (let i = 0; i < (co.revTo||[]).length; i++) {
        const t = co.revTo[i];
        await client.query(
          `INSERT INTO revision_changes (company_code, direction, product, mt, label, sort_order)
           VALUES ($1,'to',$2,$3,$4,$5)`,
          [co.code, t.prod, t.mt||null, t.label||'', i]
        );
      }

      // Cycles
      for (let ci = 0; ci < co.cycles.length; ci++) {
        const c = co.cycles[ci];
        const mtVal = typeof c.mt === 'number' ? String(c.mt) : c.mt||null;
        const cycRes = await client.query(
          `INSERT INTO cycles
             (company_code, cycle_type, mt, submit_type, submit_date,
              release_type, release_date, status, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
          [co.code, c.type, mtVal, c.submitType||'', c.submitDate||'',
           c.releaseType||'', c.releaseDate||'', c.status||'', ci]
        );
        const cycleId = cycRes.rows[0].id;
        // Cycle products
        for (const [prod, mt] of Object.entries(c.products||{})) {
          await client.query(
            `INSERT INTO cycle_products (cycle_id, product, mt) VALUES ($1,$2,$3)`,
            [cycleId, prod, typeof mt==='number'?String(mt):mt]
          );
        }
      }
    }

    // ── Insert PENDING companies ─────────────────────────────────
    console.log(`📥 Seeding ${PENDING.length} PENDING companies…`);
    for (const co of PENDING) {
      await client.query(
        `INSERT INTO companies
           (code, grp, section, submit1, obtained, utilization_mt, available_quota,
            rev_type, remarks)
         VALUES ($1,$2,'PENDING',null,0,0,null,'none',$3)`,
        [co.code, co.group, co.remarks||'']
      );

      // Pending meta
      await client.query(
        `INSERT INTO pending_meta (company_code, mt, status, date) VALUES ($1,$2,$3,$4)`,
        [co.code, co.mt||0, co.status||'', co.date||'']
      );

      // Products
      for (let i = 0; i < co.products.length; i++) {
        await client.query(
          `INSERT INTO company_products (company_code, product, sort_order) VALUES ($1,$2,$3)`,
          [co.code, co.products[i], i]
        );
      }

      // Cycles
      for (let ci = 0; ci < co.cycles.length; ci++) {
        const c = co.cycles[ci];
        const mtVal = typeof c.mt === 'number' ? String(c.mt) : c.mt||null;
        const cycRes = await client.query(
          `INSERT INTO cycles
             (company_code, cycle_type, mt, submit_type, submit_date,
              release_type, release_date, status, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
          [co.code, c.type, mtVal, c.submitType||'', c.submitDate||'',
           c.releaseType||'', c.releaseDate||'', c.status||'', ci]
        );
        const cycleId = cycRes.rows[0].id;
        for (const [prod, mt] of Object.entries(c.products||{})) {
          await client.query(
            `INSERT INTO cycle_products (cycle_id, product, mt) VALUES ($1,$2,$3)`,
            [cycleId, prod, typeof mt==='number'?String(mt):mt]
          );
        }
      }
    }

    // ── Insert RA records ────────────────────────────────────────
    console.log(`📥 Seeding ${RA.length} RA records…`);
    for (const r of RA) {
      await client.query(
        `INSERT INTO ra_records
           (company_code, product, berat, obtained, cargo_arrived, real_pct, util_pct,
            arrival_date, eta_jkt, reapply_est, reapply_stage, reapply_product,
            reapply_new_total, reapply_prev_obtained, reapply_additional,
            reapply_submit_date, reapply_status, target, pertek, spi, catatan)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
        [r.code, r.product||null, r.berat||0, r.obtained||0, r.cargoArrived||false,
         r.realPct||0, r.utilPct??null,
         r.arrivalDate||null, r.etaJKT||null, r.reapplyEst||null,
         r.reapplyStage||1, r.reapplyProduct||null,
         r.reapplyNewTotal||null, r.reapplyPrevObtained||null, r.reapplyAdditional||null,
         r.reapplySubmitDate||null, r.reapplyStatus||null,
         r.target??null, r.pertek||null, r.spi||null, r.catatan||null]
      );
    }

    await client.query('COMMIT');
    console.log('✅ Seed complete!');
    console.log(`   Companies (SPI):     ${SPI.length}`);
    console.log(`   Companies (PENDING): ${PENDING.length}`);
    console.log(`   RA records:          ${RA.length}`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Seed failed:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch(() => process.exit(1));