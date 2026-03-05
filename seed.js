// seed.js — Seeds all data from IQDash HTML into PostgreSQL
// Run: node seed.js
require('dotenv').config();
const pool = require('./db/pool');

// ── helper: parse DD/MM/YYYY or TBA → DATE or null ──────────
function pd(d) {
  if (!d || d === 'TBA' || d === '') return null;
  // DD/MM/YYYY
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(d)) {
    const [dd, mm, yyyy] = d.split('/');
    return `${yyyy}-${mm}-${dd}`;
  }
  // DD/MM/YY  e.g. "22/01/26" → "2026-01-22"
  if (/^\d{2}\/\d{2}\/\d{2}$/.test(d)) {
    const [dd, mm, yy] = d.split('/');
    return `20${yy}-${mm}-${dd}`;
  }
  return d;
}
function isTBA(d) { return !d || d === 'TBA' || d === ''; }

// ════════════════════════════════════════════════════════════
//  SPI DATA  (from let SPI = [...] in HTML)
// ════════════════════════════════════════════════════════════
const SPI = [
  { code:'EMS',  group:'AB',       submit1:8000,  obtained:1600, products:['SHEETPILE'],
    revType:'none', revNote:'', revSubmitDate:'', revStatus:'', revFrom:[], revTo:[], revMT:0,
    utilizationMT:1600, availableQuota:0,
    utilizationByProd:{'SHEETPILE':1600}, availableByProd:{},
    remarks:'SUBMIT MOT 30/10/25', spiRef:'SPI TERBIT 7/11/25 · Target re-apply Early-April',
    cycles:[
      {type:'Submit #1',  mt:8000, products:{SHEETPILE:8000},  submitType:'Submit MOI',   submitDate:'15/10/2025', releaseType:'PERTEK', releaseDate:'29/10/2025', status:''},
      {type:'Obtained #1',mt:1600, products:{SHEETPILE:1600},  submitType:'Submit MOT',   submitDate:'30/10/2025', releaseType:'SPI',    releaseDate:'07/11/2025', status:'Target re-apply Early-April'},
    ]},
  { code:'HDP',  group:'AB',       submit1:6000,  obtained:800,  products:['GL BORON'],
    revType:'active', revNote:'Submit #2: Additional GL BORON pending approval',
    revSubmitDate:'02/03/26', revStatus:'Menunggu Disposisi Kasi', revFrom:[], revTo:[], revMT:0,
    utilizationMT:800, availableQuota:0,
    utilizationByProd:{'GL BORON':800}, availableByProd:{},
    remarks:'SUBMIT MOT 30/10/25', spiRef:'SPI TERBIT 7/11/25 · Target re-apply End-Feb',
    cycles:[
      {type:'Submit #1',  mt:6000, products:{'GL BORON':6000}, submitType:'Submit MOI',                       submitDate:'16/10/2025', releaseType:'PERTEK',           releaseDate:'29/10/2025', status:''},
      {type:'Obtained #1',mt:800,  products:{'GL BORON':800},  submitType:'Submit MOT',                       submitDate:'30/10/2025', releaseType:'SPI',              releaseDate:'07/11/2025', status:''},
      {type:'Submit #2',  mt:2200, products:{'GL BORON':2200}, submitType:'Submit MOI (Submit #2) Perubahan', submitDate:'25/02/2026', releaseType:'PERTEK Perubahan', releaseDate:'TBA',        status:'Update 02/03/26 - Menunggu Disposisi Kasi'},
      {type:'Obtained #2',mt:null, products:{'GL BORON':null}, submitType:'Submit MOT (Submit #2) Perubahan', submitDate:'TBA',        releaseType:'SPI Perubahan',    releaseDate:'TBA',        status:''},
    ]},
  { code:'AMP',  group:'AB',       submit1:7000,  obtained:800,  products:['GL BORON','PPGL CARBON'],
    revType:'none', revNote:'', revSubmitDate:'', revStatus:'', revFrom:[], revTo:[], revMT:0,
    utilizationMT:800, availableQuota:0,
    utilizationByProd:{'GL BORON':400,'PPGL CARBON':400}, availableByProd:{},
    remarks:'SUBMIT MOT 4/11/25', spiRef:"SPI TERBIT 27/11/25 · Target re-apply April'26",
    cycles:[
      {type:'Submit #1',  mt:7000, products:{'GL BORON':6000,'PPGL CARBON':1000}, submitType:'Submit MOI', submitDate:'16/10/2025', releaseType:'PERTEK', releaseDate:'23/10/2025', status:''},
      {type:'Obtained #1',mt:800,  products:{'GL BORON':400,'PPGL CARBON':400},   submitType:'Submit MOT', submitDate:'04/11/2025', releaseType:'SPI',    releaseDate:'27/11/2025', status:"Target re-apply April'26"},
    ]},
  { code:'CGK',  group:'AB',       submit1:6000,  obtained:800,  products:['GI BORON'],
    revType:'active', revSubmitDate:'02/03/26', revStatus:'Menunggu Disposisi Kasi',
    revNote:'Submit #2: Additional 2,200 MT GI BORON pending approval',
    revFrom:[{prod:'GI BORON',mt:800,label:'Obtained #1'}], revTo:[{prod:'GI BORON',mt:2200,label:'Submit #2 (Additional)'}], revMT:2200,
    utilizationMT:800, availableQuota:0,
    utilizationByProd:{'GI BORON':800}, availableByProd:{},
    remarks:'SUBMIT MOI Perubahan 25/02/26', spiRef:'SPI TERBIT 7/11/25',
    cycles:[
      {type:'Submit #1',  mt:6000, products:{'GI BORON':6000}, submitType:'Submit MOI',                              submitDate:'16/10/2025', releaseType:'PERTEK',                         releaseDate:'29/10/2025', status:''},
      {type:'Obtained #1',mt:800,  products:{'GI BORON':800},  submitType:'Submit MOT',                              submitDate:'30/10/2025', releaseType:'SPI',                            releaseDate:'07/11/2025', status:''},
      {type:'Submit #2',  mt:2200, products:{'GI BORON':2200}, submitType:'Submit MOI Perubahan (Submit #2)',         submitDate:'25/02/2026', releaseType:'PERTEK Perubahan (Submit #2)',    releaseDate:'TBA',        status:'Update 02/03/26 - Menunggu Disposisi Kasi'},
      {type:'Obtained #2',mt:null, products:{'GI BORON':null}, submitType:'Submit MOT Perubahan (Submit #2)',         submitDate:'TBA',        releaseType:'SPI Perubahan (Submit #2)',       releaseDate:'TBA',        status:''},
    ]},
  { code:'GNG',  group:'AB',       submit1:6000,  obtained:250,  products:['GL BORON'],
    revType:'active', revSubmitDate:'02/03/26', revStatus:'Menunggu Disposisi Kasi',
    revNote:'Submit #2: Additional 2,750 MT GL BORON pending approval',
    revFrom:[{prod:'GL BORON',mt:250,label:'Obtained #1'}], revTo:[{prod:'GL BORON',mt:2750,label:'Submit #2 (Additional)'}], revMT:2750,
    utilizationMT:250, availableQuota:0,
    utilizationByProd:{'GL BORON':250}, availableByProd:{},
    remarks:'SUBMIT MOI Perubahan 25/02/26', spiRef:'SPI TERBIT 7/11/25',
    cycles:[
      {type:'Submit #1',  mt:6000, products:{'GL BORON':6000}, submitType:'Submit MOI',                        submitDate:'14/10/2025', releaseType:'PERTEK',                       releaseDate:'29/10/2025', status:''},
      {type:'Obtained #1',mt:250,  products:{'GL BORON':250},  submitType:'Submit MOT',                        submitDate:'30/10/2025', releaseType:'SPI',                          releaseDate:'07/11/2025', status:''},
      {type:'Submit #2',  mt:2750, products:{'GL BORON':2750}, submitType:'Submit MOI Perubahan (Submit #2)',   submitDate:'25/02/2026', releaseType:'PERTEK Perubahan (Submit #2)', releaseDate:'TBA',        status:'Update 02/03/26 - Menunggu Disposisi Kasi'},
      {type:'Obtained #2',mt:null, products:{'GL BORON':null}, submitType:'Submit MOTP Perubahan (Submit #2)',  submitDate:'TBA',        releaseType:'SPI Perubahan (Submit #2)',     releaseDate:'TBA',        status:''},
    ]},
  { code:'MIN',  group:'AB',       submit1:6000,  obtained:600,  products:['BORDES ALLOY'],
    revType:'none', revNote:'', revSubmitDate:'', revStatus:'', revFrom:[], revTo:[], revMT:0,
    utilizationMT:247, availableQuota:353,
    utilizationByProd:{'BORDES ALLOY':247}, availableByProd:{'BORDES ALLOY':353},
    remarks:'SUBMIT MOT 30/10/25', spiRef:'SPI TERBIT 7/11/25 · Target re-apply Early-March',
    cycles:[
      {type:'Submit #1',  mt:6000, products:{'BORDES ALLOY':6000}, submitType:'Submit MOI', submitDate:'15/10/2025', releaseType:'PERTEK', releaseDate:'29/10/2025', status:''},
      {type:'Obtained #1',mt:600,  products:{'BORDES ALLOY':600},  submitType:'Submit MOT', submitDate:'30/10/2025', releaseType:'SPI',    releaseDate:'07/11/2025', status:'Target re-apply Early-March'},
    ]},
  { code:'JKT',  group:'AB',       submit1:6000,  obtained:300,  products:['GL BORON'],
    revType:'none', revNote:'', revSubmitDate:'', revStatus:'', revFrom:[], revTo:[], revMT:0,
    utilizationMT:300, availableQuota:0,
    utilizationByProd:{'GL BORON':300}, availableByProd:{},
    remarks:'SUBMIT MOT 22/12/25', spiRef:'SPI TERBIT 09/01/26 · Target re-apply Mid-March',
    cycles:[
      {type:'Submit #1',  mt:6000, products:{'GL BORON':6000}, submitType:'Submit MOI', submitDate:'15/10/2025', releaseType:'PERTEK', releaseDate:'29/10/2025', status:''},
      {type:'Obtained #1',mt:300,  products:{'GL BORON':300},  submitType:'Submit MOT', submitDate:'22/12/2025', releaseType:'SPI',    releaseDate:'09/01/2026', status:'Target re-apply Mid March'},
    ]},
  { code:'BHG',  group:'AB',       submit1:6000,  obtained:200,  products:['PPGL CARBON'],
    revType:'none', revNote:'', revSubmitDate:'', revStatus:'', revFrom:[], revTo:[], revMT:0,
    utilizationMT:200, availableQuota:0,
    utilizationByProd:{'PPGL CARBON':200}, availableByProd:{},
    remarks:'SUBMIT MOT 5/11/25', spiRef:'SPI TERBIT 5/12/25 · Target re-apply End-April',
    cycles:[
      {type:'Submit #1',  mt:6000, products:{'PPGL CARBON':6000}, submitType:'Submit MOI', submitDate:'21/10/2025', releaseType:'PERTEK', releaseDate:'03/11/2025', status:''},
      {type:'Obtained #1',mt:200,  products:{'PPGL CARBON':200},  submitType:'Submit MOT', submitDate:'05/11/2025', releaseType:'SPI',    releaseDate:'05/12/2025', status:'Target re-apply End-April'},
    ]},
  { code:'NCT',  group:'AB',       submit1:6000,  obtained:150,  products:['GI BORON'],
    revType:'active', revSubmitDate:'22/01/26', revStatus:'Menunggu Disposisi Kasi',
    revNote:'Product change: GI BORON → GL BORON (150 MT)',
    revFrom:[{prod:'GI BORON',mt:150,label:'Original'}], revTo:[{prod:'GL BORON',mt:150,label:'Revised'}], revMT:150,
    utilizationMT:0, availableQuota:150,
    utilizationByProd:{}, availableByProd:{'GI BORON':150},
    remarks:'SUBMIT MOT Perubahan 22/1/26', spiRef:'SPI TERBIT 5/12/25',
    cycles:[
      {type:'Submit #1',              mt:6000, products:{'GI BORON':6000},  submitType:'Submit MOI',                             submitDate:'22/10/2025', releaseType:'PERTEK',                          releaseDate:'04/11/2025', status:''},
      {type:'Obtained #1',            mt:150,  products:{'GI BORON':150},   submitType:'Submit MOT',                             submitDate:'05/11/2025', releaseType:'SPI',                             releaseDate:'05/12/2025', status:''},
      {type:'Revision #1',            mt:-150, products:{'GI BORON':150},   submitType:'Submit MOI Perubahan (Revision #1)',      submitDate:'22/01/2026', releaseType:'PERTEK Perubahan (Revision #1)',  releaseDate:'TBA',        status:'Update 26/02/26 - Menunggu Disposisi Kasi'},
      {type:'Obtained (Revision #1)', mt:150,  products:{'GL BORON':150},   submitType:'Submit MOT Perubahan (Revision #1)',      submitDate:'TBA',        releaseType:'SPI Perubahan (Revision #1)',     releaseDate:'TBA',        status:''},
    ]},
  { code:'BBB',  group:'AB',       submit1:6000,  obtained:400,  products:['GL BORON'],
    revType:'none', revNote:'', revSubmitDate:'', revStatus:'', revFrom:[], revTo:[], revMT:0,
    utilizationMT:400, availableQuota:0,
    utilizationByProd:{'GL BORON':400}, availableByProd:{},
    remarks:'SUBMIT MOT 3/12/25', spiRef:'SPI TERBIT 15/01/26 · Target re-apply Mid-March',
    cycles:[
      {type:'Submit #1',  mt:6000, products:{'GL BORON':6000}, submitType:'Submit MOI', submitDate:'21/10/2025', releaseType:'PERTEK', releaseDate:'11/11/2025', status:''},
      {type:'Obtained #1',mt:400,  products:{'GL BORON':400},  submitType:'Submit MOT', submitDate:'03/12/2025', releaseType:'SPI',    releaseDate:'15/01/2026', status:'Target re-apply Mid-March'},
    ]},
  { code:'GKL',  group:'AB',       submit1:10000, obtained:2400, products:['GI BORON','ERW PIPE OD≤140mm','ERW PIPE OD>140mm'],
    revType:'none', revNote:'', revSubmitDate:'', revStatus:'', revFrom:[], revTo:[], revMT:0,
    utilizationMT:1840, availableQuota:560,
    utilizationByProd:{'GI BORON':1000,'ERW PIPE OD≤140mm':704,'ERW PIPE OD>140mm':136},
    availableByProd:{'GI BORON':100,'ERW PIPE OD≤140mm':96,'ERW PIPE OD>140mm':364},
    remarks:'SUBMIT MOT 26/11/25', spiRef:'SPI TERBIT 24/12/25 · Target re-apply End-April',
    cycles:[
      {type:'Submit #1',  mt:10000,products:{'GI BORON':6000,'ERW PIPE OD≤140mm':3000,'ERW PIPE OD>140mm':1000}, submitType:'Submit MOI', submitDate:'15/10/2025', releaseType:'PERTEK', releaseDate:'11/11/2025', status:''},
      {type:'Obtained #1',mt:2400, products:{'GI BORON':1100,'ERW PIPE OD≤140mm':800, 'ERW PIPE OD>140mm':500},  submitType:'Submit MOT', submitDate:'26/11/2025', releaseType:'SPI',    releaseDate:'24/12/2025', status:'Target re-apply End-April'},
    ]},
  { code:'GAS',  group:'AB',       submit1:6000,  obtained:200,  products:['BORDES ALLOY'],
    revType:'active', revSubmitDate:'20/01/26', revStatus:'Menunggu Disposisi Kasi',
    revNote:'Reallocation: 200 MT BORDES ALLOY → 130 MT BORDES ALLOY + 70 MT AS STEEL',
    revFrom:[{prod:'BORDES ALLOY',mt:200,label:'Original (total)'}],
    revTo:[{prod:'BORDES ALLOY',mt:130,label:'Retained'},{prod:'AS STEEL',mt:70,label:'Reallocated'}], revMT:70,
    utilizationMT:0, availableQuota:200,
    utilizationByProd:{}, availableByProd:{'BORDES ALLOY':200},
    remarks:'SUBMIT MOI Perubahan 20/01/26', spiRef:'SPI TERBIT 09/01/26',
    cycles:[
      {type:'Submit #1',              mt:6000, products:{'BORDES ALLOY':6000}, submitType:'Submit MOI',                        submitDate:'27/10/2025', releaseType:'PERTEK',                         releaseDate:'11/11/2025', status:''},
      {type:'Obtained #1',            mt:200,  products:{'BORDES ALLOY':200},  submitType:'Submit MOT',                        submitDate:'22/12/2025', releaseType:'SPI',                            releaseDate:'09/01/2026', status:''},
      {type:'Revision #1',            mt:-70,  products:{'BORDES ALLOY':70},   submitType:'Submit MOI Perubahan (Revision #1)', submitDate:'20/01/2026', releaseType:'PERTEK Perubahan (Revision #1)', releaseDate:'TBA',        status:'Update 04/03/26 - Menunggu Disposisi Kasi'},
      {type:'Obtained (Revision #1)', mt:70,   products:{'AS STEEL':70},       submitType:'Submit MOT Perubahan (Revision #1)', submitDate:'TBA',        releaseType:'SPI Perubahan (Revision #1)',    releaseDate:'TBA',        status:''},
    ]},
  { code:'KJK',  group:'AB',       submit1:6000,  obtained:950,  products:['GL BORON'],
    revType:'none', revNote:'', revSubmitDate:'', revStatus:'', revFrom:[], revTo:[], revMT:0,
    utilizationMT:950, availableQuota:0,
    utilizationByProd:{'GL BORON':950}, availableByProd:{},
    remarks:'SUBMIT MOT 03/12/25', spiRef:'SPI TERBIT 31/12/25 · Target re-apply Mid-March',
    cycles:[
      {type:'Submit #1',  mt:6000, products:{'GL BORON':6000}, submitType:'Submit MOI', submitDate:'15/10/2025', releaseType:'PERTEK', releaseDate:'11/11/2025', status:''},
      {type:'Obtained #1',mt:950,  products:{'GL BORON':950},  submitType:'Submit MOT', submitDate:'03/12/2025', releaseType:'SPI',    releaseDate:'31/12/2025', status:'Target re-apply Mid-March'},
    ]},
  { code:'HKG',  group:'AB',       submit1:6000,  obtained:750,  products:['GL BORON'],
    revType:'none', revNote:'', revSubmitDate:'', revStatus:'', revFrom:[], revTo:[], revMT:0,
    utilizationMT:750, availableQuota:0,
    utilizationByProd:{'GL BORON':750}, availableByProd:{},
    remarks:'SUBMIT MOT 03/12/25', spiRef:'SPI TERBIT 31/12/25 · Target re-apply Early-March',
    cycles:[
      {type:'Submit #1',  mt:6000, products:{'GL BORON':6000}, submitType:'Submit MOI', submitDate:'16/10/2025', releaseType:'PERTEK', releaseDate:'14/11/2025', status:''},
      {type:'Obtained #1',mt:750,  products:{'GL BORON':750},  submitType:'Submit MOT', submitDate:'03/12/2025', releaseType:'SPI',    releaseDate:'31/12/2025', status:'Target re-apply Early-March'},
    ]},
  { code:'SPA',  group:'CD',       submit1:6000,  obtained:515,  products:['BORDES ALLOY'],
    revType:'none', revNote:'', revSubmitDate:'', revStatus:'', revFrom:[], revTo:[], revMT:0,
    utilizationMT:114, availableQuota:401,
    utilizationByProd:{'BORDES ALLOY':114}, availableByProd:{'BORDES ALLOY':401},
    remarks:'SUBMIT MOT 3/12/25', spiRef:'SPI TERBIT 13/01/26 · Target re-apply Early-March',
    cycles:[
      {type:'Submit #1',  mt:6000, products:{'BORDES ALLOY':6000}, submitType:'Submit MOI', submitDate:'27/10/2025', releaseType:'PERTEK', releaseDate:'11/11/2025', status:''},
      {type:'Obtained #1',mt:515,  products:{'BORDES ALLOY':515},  submitType:'Submit MOT', submitDate:'03/12/2025', releaseType:'SPI',    releaseDate:'13/01/2026', status:'Target re-apply Early-March'},
    ]},
  { code:'ADP',  group:'CD',       submit1:6000,  obtained:250,  products:['GL BORON'],
    revType:'none', revNote:'', revSubmitDate:'', revStatus:'', revFrom:[], revTo:[], revMT:0,
    utilizationMT:250, availableQuota:0,
    utilizationByProd:{'GL BORON':250}, availableByProd:{},
    remarks:'SUBMIT MOT 21/11/25', spiRef:'SPI TERBIT 16/12/25 · Target re-apply Mid-March',
    cycles:[
      {type:'Submit #1',  mt:6000, products:{'GL BORON':6000}, submitType:'Submit MOI', submitDate:'28/10/2025', releaseType:'PERTEK', releaseDate:'14/11/2025', status:''},
      {type:'Obtained #1',mt:250,  products:{'GL BORON':250},  submitType:'Submit MOT', submitDate:'21/11/2025', releaseType:'SPI',    releaseDate:'16/12/2025', status:'Target re-apply Mid-March'},
    ]},
  { code:'MSN',  group:'CD',       submit1:6000,  obtained:150,  products:['GL BORON'],
    revType:'none', revNote:'', revSubmitDate:'', revStatus:'', revFrom:[], revTo:[], revMT:0,
    utilizationMT:150, availableQuota:0,
    utilizationByProd:{'GL BORON':150}, availableByProd:{},
    remarks:'SUBMIT MOT 09/12/25', spiRef:'SPI TERBIT 06/01/26 · Target re-apply Early-March',
    cycles:[
      {type:'Submit #1',  mt:6000, products:{'GL BORON':6000}, submitType:'Submit MOI', submitDate:'28/10/2025', releaseType:'PERTEK', releaseDate:'13/11/2025', status:''},
      {type:'Obtained #1',mt:150,  products:{'GL BORON':150},  submitType:'Submit MOT', submitDate:'09/12/2025', releaseType:'SPI',    releaseDate:'06/01/2026', status:'Target re-apply Early-March'},
    ]},
  { code:'SPP',  group:'CD',       submit1:6000,  obtained:250,  products:['GI BORON'],
    revType:'active', revSubmitDate:'13/01/26', revStatus:'Menunggu Persetujuan Direktur',
    revNote:'Product change: GI BORON → SHEETPILE (250 MT)',
    revFrom:[{prod:'GI BORON',mt:250,label:'Original'}], revTo:[{prod:'SHEETPILE',mt:250,label:'Revised'}], revMT:250,
    utilizationMT:0, availableQuota:250,
    utilizationByProd:{}, availableByProd:{'GI BORON':250},
    remarks:'SUBMIT MOI Perubahan 13/01/26', spiRef:'SPI TERBIT 16/12/25',
    cycles:[
      {type:'Submit #1',              mt:6000, products:{'GI BORON':6000},   submitType:'Submit MOI',                        submitDate:'29/10/2025', releaseType:'PERTEK',                         releaseDate:'13/11/2025', status:''},
      {type:'Obtained #1',            mt:250,  products:{'GI BORON':250},    submitType:'Submit MOT',                        submitDate:'21/11/2025', releaseType:'SPI',                            releaseDate:'16/12/2025', status:''},
      {type:'Revision #1',            mt:-250, products:{'GI BORON':250},    submitType:'Submit MOI Perubahan (Revision #1)', submitDate:'13/01/2026', releaseType:'PERTEK Perubahan (Revision #1)', releaseDate:'TBA',        status:'Update 04/03/26 - Menunggu Persetujuan Direktur'},
      {type:'Obtained (Revision #1)', mt:250,  products:{SHEETPILE:250},     submitType:'Submit MOT Perubahan (Revision #1)', submitDate:'TBA',        releaseType:'SPI Perubahan (Revision #1)',    releaseDate:'TBA',        status:''},
    ]},
  { code:'LCP',  group:'CD',       submit1:6000,  obtained:275,  products:['GL BORON'],
    revType:'none', revNote:'', revSubmitDate:'', revStatus:'', revFrom:[], revTo:[], revMT:0,
    utilizationMT:275, availableQuota:0,
    utilizationByProd:{'GL BORON':275}, availableByProd:{},
    remarks:'SUBMIT MOT 21/11/25', spiRef:'SPI TERBIT 16/12/25 · Target re-apply Mid-March',
    cycles:[
      {type:'Submit #1',  mt:6000, products:{'GL BORON':6000}, submitType:'Submit MOI', submitDate:'23/10/2025', releaseType:'PERTEK', releaseDate:'18/11/2025', status:''},
      {type:'Obtained #1',mt:275,  products:{'GL BORON':275},  submitType:'Submit MOT', submitDate:'21/11/2025', releaseType:'SPI',    releaseDate:'16/12/2025', status:'Target re-apply Mid-March'},
    ]},
  { code:'KAN',  group:'CD',       submit1:6000,  obtained:80,   products:['GI BORON'],
    revType:'active', revSubmitDate:'20/01/26', revStatus:'Menunggu Disposisi Kasi',
    revNote:'Product change: GI BORON → AS STEEL (80 MT)',
    revFrom:[{prod:'GI BORON',mt:80,label:'Original'}], revTo:[{prod:'AS STEEL',mt:80,label:'Revised'}], revMT:80,
    utilizationMT:0, availableQuota:80,
    utilizationByProd:{}, availableByProd:{'GI BORON':80},
    remarks:'SUBMIT MOI Perubahan 20/01/26', spiRef:'SPI TERBIT 05/01/26',
    cycles:[
      {type:'Submit #1',              mt:6000, products:{'GI BORON':6000},  submitType:'Submit MOI',                        submitDate:'23/10/2025', releaseType:'PERTEK',                         releaseDate:'18/11/2025', status:''},
      {type:'Obtained #1',            mt:80,   products:{'GI BORON':80},    submitType:'Submit MOT',                        submitDate:'09/12/2025', releaseType:'SPI',                            releaseDate:'05/01/2026', status:''},
      {type:'Revision #1',            mt:-80,  products:{'GI BORON':80},    submitType:'Submit MOI Perubahan (Revision #1)', submitDate:'20/01/2026', releaseType:'PERTEK Perubahan (Revision #1)', releaseDate:'TBA',        status:'Update 02/03/26 - Menunggu Disposisi Kasi'},
      {type:'Obtained (Revision #1)', mt:80,   products:{'AS STEEL':80},    submitType:'Submit MOT Perubahan (Revision #1)', submitDate:'TBA',        releaseType:'SPI Perubahan (Revision #1)',    releaseDate:'TBA',        status:''},
    ]},
  { code:'LSJ',  group:'AB',       submit1:6000,  obtained:500,  products:['GI BORON'],
    revType:'active', revSubmitDate:'22/01/26', revStatus:'Menunggu Disposisi Kasubdit',
    revNote:'Product change: GI BORON → GL BORON (500 MT)',
    revFrom:[{prod:'GI BORON',mt:500,label:'Original'}], revTo:[{prod:'GL BORON',mt:500,label:'Revised'}], revMT:500,
    utilizationMT:0, availableQuota:500,
    utilizationByProd:{}, availableByProd:{'GI BORON':500},
    remarks:'SUBMIT MOI Perubahan 22/01/26', spiRef:'SPI TERBIT 16/12/25',
    cycles:[
      {type:'Submit #1',              mt:6000, products:{'GI BORON':6000},  submitType:'Submit MOI',                        submitDate:'16/10/2025', releaseType:'PERTEK',                         releaseDate:'18/11/2025', status:''},
      {type:'Obtained #1',            mt:500,  products:{'GI BORON':500},   submitType:'Submit MOT',                        submitDate:'21/11/2025', releaseType:'SPI',                            releaseDate:'16/12/2025', status:''},
      {type:'Revision #1',            mt:-500, products:{'GI BORON':500},   submitType:'Submit MOI Perubahan (Revision #1)', submitDate:'22/01/2026', releaseType:'PERTEK Perubahan (Revision #1)', releaseDate:'TBA',        status:'Update 04/03/26 - Menunggu Disposisi Kasubdit'},
      {type:'Obtained (Revision #1)', mt:500,  products:{'GL BORON':500},   submitType:'Submit MOT Perubahan (Revision #1)', submitDate:'TBA',        releaseType:'SPI Perubahan (Revision #1)',    releaseDate:'TBA',        status:''},
    ]},
  { code:'DIOR', group:'CD',       submit1:6000,  obtained:100,  products:['BORDES ALLOY'],
    revType:'complete', revSubmitDate:'05/11/25', revStatus:'PERTEK TERBIT 3/12/25',
    revNote:'PERTEK TERBIT 3/12/25 — SPI belum terbit', revFrom:[], revTo:[], revMT:0,
    utilizationMT:0, availableQuota:100,
    utilizationByProd:{}, availableByProd:{'BORDES ALLOY':100},
    remarks:'SUBMIT MOI 05/11/25', spiRef:'PERTEK TERBIT 3/12/25',
    cycles:[
      {type:'Submit #1',  mt:6000, products:{'BORDES ALLOY':6000}, submitType:'Submit MOI', submitDate:'05/11/2025', releaseType:'PERTEK', releaseDate:'03/12/2025', status:''},
      {type:'Obtained #1',mt:100,  products:{'BORDES ALLOY':100},  submitType:'Submit MOT', submitDate:'TBA',        releaseType:'SPI',    releaseDate:'TBA',        status:'(Hold, waiting address changes)'},
    ]},
  { code:'MJU',  group:'AB',       submit1:6000,  obtained:200,  products:['BORDES ALLOY'],
    revType:'complete', revSubmitDate:'12/01/26', revStatus:'PERTEK Perubahan Terbit 04/02/26 — SPI Perubahan belum terbit',
    revNote:'Product change: BORDES ALLOY → Hollow Pipe (200 MT) — PERTEK Perubahan terbit 04/02/26',
    revFrom:[{prod:'BORDES ALLOY',mt:200,label:'Original'}], revTo:[{prod:'HOLLOW PIPE',mt:200,label:'Revised'}], revMT:200,
    utilizationMT:0, availableQuota:200,
    utilizationByProd:{}, availableByProd:{'BORDES ALLOY':200},
    remarks:'SUBMIT MOI Perubahan 12/01/26', spiRef:'SPI TERBIT 05/01/26 (SPI Original)',
    cycles:[
      {type:'Submit #1',              mt:6000, products:{'BORDES ALLOY':6000},  submitType:'Submit MOI',                        submitDate:'17/11/2025', releaseType:'PERTEK',                         releaseDate:'03/12/2025', status:''},
      {type:'Obtained #1',            mt:200,  products:{'BORDES ALLOY':200},   submitType:'Submit MOT',                        submitDate:'09/12/2025', releaseType:'SPI',                            releaseDate:'05/01/2026', status:''},
      {type:'Revision #1',            mt:-200, products:{'BORDES ALLOY':200},   submitType:'Submit MOI Perubahan (Revision #1)', submitDate:'12/01/2026', releaseType:'PERTEK Perubahan (Revision #1)', releaseDate:'04/02/2026', status:''},
      {type:'Obtained (Revision #1)', mt:200,  products:{'HOLLOW PIPE':200},    submitType:'Submit MOT Perubahan (Revision #1)', submitDate:'TBA',        releaseType:'SPI Perubahan (Revision #1)',    releaseDate:'TBA',        status:'(Hold submit MOT, waiting Sales confirmation)'},
    ]},
  { code:'SJH',  group:'AB',       submit1:6000,  obtained:300,  products:['GL BORON'],
    revType:'none', revNote:'', revSubmitDate:'', revStatus:'', revFrom:[], revTo:[], revMT:0,
    utilizationMT:0, availableQuota:300,
    utilizationByProd:{}, availableByProd:{'GL BORON':300},
    remarks:'SUBMIT MOT 12/12/25', spiRef:'SPI TERBIT 06/01/26 · Target re-apply Early-March',
    cycles:[
      {type:'Submit #1',  mt:6000, products:{'GL BORON':6000}, submitType:'Submit MOI', submitDate:'17/11/2025', releaseType:'PERTEK', releaseDate:'12/12/2025', status:''},
      {type:'Obtained #1',mt:300,  products:{'GL BORON':300},  submitType:'Submit MOT', submitDate:'12/12/2025', releaseType:'SPI',    releaseDate:'06/01/2026', status:'Target re-apply Early-March'},
    ]},
  { code:'BDG',  group:'AB',       submit1:6000,  obtained:1000, products:['BORDES ALLOY'],
    revType:'active', revSubmitDate:'04/02/26', revStatus:'Menunggu Disposisi Kasi',
    revNote:'Reallocation: 1,000 MT BORDES ALLOY → 350 MT BORDES ALLOY + 650 MT GL BORON',
    revFrom:[{prod:'BORDES ALLOY',mt:1000,label:'Original (total)'}],
    revTo:[{prod:'BORDES ALLOY',mt:350,label:'Retained'},{prod:'GL BORON',mt:650,label:'Reallocated'}], revMT:650,
    utilizationMT:0, availableQuota:1000,
    utilizationByProd:{}, availableByProd:{'BORDES ALLOY':1000},
    remarks:'SUBMIT MOI Perubahan 04/02/26', spiRef:'SPI TERBIT 13/01/26',
    cycles:[
      {type:'Submit #1',              mt:6000, products:{'BORDES ALLOY':6000},  submitType:'Submit MOI',                        submitDate:'13/11/2025', releaseType:'PERTEK',                         releaseDate:'22/12/2025', status:''},
      {type:'Obtained #1',            mt:1000, products:{'BORDES ALLOY':1000},  submitType:'Submit MOT',                        submitDate:'23/12/2025', releaseType:'SPI',                            releaseDate:'13/01/2026', status:''},
      {type:'Revision #1',            mt:-650, products:{'BORDES ALLOY':650},   submitType:'Submit MOI Perubahan (Revision #1)', submitDate:'04/02/2026', releaseType:'PERTEK Perubahan (Revision #1)', releaseDate:'TBA',        status:'Update 25/02/26 - Menunggu Disposisi Kasi'},
      {type:'Obtained (Revision #1)', mt:650,  products:{'GL BORON':650},       submitType:'Submit MOT Perubahan (Revision #1)', submitDate:'TBA',        releaseType:'SPI Perubahan (Revision #1)',    releaseDate:'TBA',        status:''},
    ]},
  { code:'SGD',  group:'AB',       submit1:6000,  obtained:2000, products:['SHEETPILE'],
    revType:'none', revNote:'', revSubmitDate:'', revStatus:'', revFrom:[], revTo:[], revMT:0,
    utilizationMT:1508, availableQuota:492,
    utilizationByProd:{SHEETPILE:1508}, availableByProd:{SHEETPILE:492},
    remarks:'SUBMIT MOT 20/01/26', spiRef:'SPI TERBIT 28/01/26 · Target re-apply Early-March',
    cycles:[
      {type:'Submit #1',  mt:6000, products:{SHEETPILE:6000}, submitType:'Submit MOI', submitDate:'14/11/2025', releaseType:'PERTEK', releaseDate:'19/01/2026', status:''},
      {type:'Obtained #1',mt:2000, products:{SHEETPILE:2000}, submitType:'Submit MOT', submitDate:'20/01/2026', releaseType:'SPI',    releaseDate:'28/01/2026', status:'Target re-apply Early-March'},
    ]},
  { code:'BTS',  group:'AB',       submit1:16000, obtained:6000, products:['BORDES ALLOY','AS STEEL','SHEETPILE','SEAMLESS PIPE'],
    revType:'complete', revSubmitDate:'07/11/25', revStatus:'PERTEK TERBIT 25/02/26',
    revNote:'Full Pertek issued 25/02/26 — 6,000 MT across 4 products', revFrom:[], revTo:[], revMT:0,
    utilizationMT:0, availableQuota:6000,
    utilizationByProd:{}, availableByProd:{'BORDES ALLOY':900,'AS STEEL':900,SHEETPILE:3200,'SEAMLESS PIPE':1000},
    remarks:'Penerimaan permohonan di Inatrade', spiRef:'PERTEK TERBIT 25/02/26',
    cycles:[
      {type:'Submit #1',  mt:16000,products:{'BORDES ALLOY':3000,'AS STEEL':2000,SHEETPILE:8000,'SEAMLESS PIPE':3000}, submitType:'Submit MOI', submitDate:'26/11/2025', releaseType:'PERTEK', releaseDate:'25/02/2026', status:''},
      {type:'Obtained #1',mt:6000, products:{'BORDES ALLOY':900,'AS STEEL':900,SHEETPILE:3200,'SEAMLESS PIPE':1000},   submitType:'Submit MOT', submitDate:'26/02/2026', releaseType:'SPI',    releaseDate:'TBA',        status:''},
    ]},
  { code:'SMS',  group:'AB',       submit1:6000,  obtained:150,  products:['SHEETPILE'],
    revType:'complete', revSubmitDate:'27/02/26', revStatus:'PERTEK TERBIT 26/02/26 — SPI belum terbit',
    revNote:'PERTEK TERBIT 26/02/26 — SPI belum terbit', revFrom:[], revTo:[], revMT:0,
    utilizationMT:0, availableQuota:150,
    utilizationByProd:{}, availableByProd:{SHEETPILE:150},
    remarks:'SUBMIT MOT 27/02/26', spiRef:'PERTEK TERBIT 26/02/26',
    cycles:[
      {type:'Submit #1',  mt:6000, products:{SHEETPILE:6000}, submitType:'Submit MOI', submitDate:'14/11/2025', releaseType:'PERTEK', releaseDate:'26/02/2026', status:''},
      {type:'Obtained #1',mt:150,  products:{SHEETPILE:150},  submitType:'Submit MOT', submitDate:'27/02/2026', releaseType:'SPI',    releaseDate:'TBA',        status:''},
    ]},
  { code:'GIS',  group:'NORMATIF', submit1:6000,  obtained:400,  products:['SHEETPILE'],
    revType:'complete', revSubmitDate:'01/03/26', revStatus:'PERTEK TERBIT 01/03/26 — SPI belum terbit',
    revNote:'PERTEK TERBIT 01/03/26 — SPI belum terbit', revFrom:[], revTo:[], revMT:0,
    utilizationMT:0, availableQuota:400,
    utilizationByProd:{}, availableByProd:{SHEETPILE:400},
    remarks:'SUBMIT MOT TBA', spiRef:'PERTEK TERBIT 01/03/26',
    cycles:[
      {type:'Submit #1',  mt:6000, products:{SHEETPILE:6000}, submitType:'Submit MOI', submitDate:'27/10/2025', releaseType:'PERTEK', releaseDate:'01/03/2026', status:'PERTEK TERBIT 01/03/26'},
      {type:'Obtained #1',mt:400,  products:{SHEETPILE:400},  submitType:'Submit MOT', submitDate:'TBA',        releaseType:'SPI',    releaseDate:'TBA',        status:'PERTEK Terbit: 01/03/26 · SPI: Not yet issued'},
    ]},
];

// ════════════════════════════════════════════════════════════
//  RA DATA  (from let RA = [...] in HTML)
// ════════════════════════════════════════════════════════════
const RA = [
  { code:'CGK', product:'GI',          berat:487.42, obtained:800,
    cargoArrived:true,  realPct:0.609, utilPct:null, arrivalDate:'2026-02-23',
    etaJKT:'LOT 1 Done (23 Feb ✓) · LOT 2 ETA Early–Mid Mar', reapplyEst:'02 Mar 2026',
    reapplyStage:2, reapplyProduct:'GI Boron', reapplyNewTotal:3000,
    reapplyPrevObtained:800, reapplyAdditional:2200,
    reapplySubmitDate:'25/02/26', reapplyStatus:'Update 02/03/26 - Menunggu Disposisi Kasi',
    target:600, pertek:'1051/ILMATE/PERTEK-SPI-U/X/2025', spi:'04.PI-05.25.3510',
    catatan:'ARSEN 53 LOT 1 (487.42 MT arrived) · LOT 2 in shipment (ETA Early–Mid Mar)' },
  { code:'GNG', product:'GL',          berat:242.5,  obtained:250,
    cargoArrived:true,  realPct:0.970, utilPct:null, arrivalDate:'2026-02-23',
    etaJKT:'Done (23 Feb ✓)', reapplyEst:'02 Mar 2026',
    reapplyStage:2, reapplyProduct:'GL Boron', reapplyNewTotal:3000,
    reapplyPrevObtained:250, reapplyAdditional:2750,
    reapplySubmitDate:'25/02/26', reapplyStatus:'Update 02/03/26 - Menunggu Disposisi Kasi',
    target:250, pertek:'1044/ILMATE/PERTEK-SPI-U/X/2025', spi:'04.PI-05.25.3511', catatan:'KEWEI 64B' },
  { code:'HDP', product:'GL',          berat:762.6,  obtained:800,
    cargoArrived:true,  realPct:0.953, utilPct:null, arrivalDate:'2026-02-23',
    etaJKT:'Done (23 Feb ✓)', reapplyEst:'02 Mar 2026',
    reapplyStage:2, reapplyProduct:'GL Boron', reapplyNewTotal:3000,
    reapplyPrevObtained:800, reapplyAdditional:2200,
    reapplySubmitDate:'26/02/26', reapplyStatus:'Update 02/03/26 - Menunggu Disposisi Kasi',
    target:500, pertek:'1052/ILMATE/PERTEK-SPI-U/X/2025', spi:'04.PI-05.25.3505', catatan:'KEWEI 63' },
  { code:'MIN', product:'BORDES ALLOY',berat:246.7,  obtained:600,
    cargoArrived:true,  realPct:0.411, utilPct:null, arrivalDate:'2026-02-24',
    etaJKT:'Done (24 Feb ✓)', reapplyEst:'',
    reapplyStage:null, reapplyProduct:null, reapplyNewTotal:null,
    reapplyPrevObtained:null, reapplyAdditional:null, reapplySubmitDate:null, reapplyStatus:null,
    target:null, pertek:'1050/ILMATE/PERTEK-SPI-U/X/2025', spi:'04.PI-05.25.3508', catatan:'ARSEN WP 01' },
  { code:'MSN', product:'GL',          berat:150,    obtained:150,
    cargoArrived:false, realPct:0,     utilPct:1.000, arrivalDate:null,
    etaJKT:'07 Mar 26', reapplyEst:'',
    reapplyStage:null, reapplyProduct:null, reapplyNewTotal:null,
    reapplyPrevObtained:null, reapplyAdditional:null, reapplySubmitDate:null, reapplyStatus:null,
    target:150, pertek:'1085/ILMATE/PERTEK-SPI-U/XI/2025', spi:'04.PI-05.26.0273', catatan:'KEWEI 65G' },
  { code:'SJH', product:'GL',          berat:300,    obtained:300,
    cargoArrived:false, realPct:0,     utilPct:1.000, arrivalDate:null,
    etaJKT:'07 Mar 26', reapplyEst:'',
    reapplyStage:null, reapplyProduct:null, reapplyNewTotal:null,
    reapplyPrevObtained:null, reapplyAdditional:null, reapplySubmitDate:null, reapplyStatus:null,
    target:250, pertek:'1161/ILMATE/PERTEK-SPI-U/XII/2025', spi:'04.PI-05.26.0011', catatan:'KEWEI 66' },
  { code:'ADP', product:'GL',          berat:250,    obtained:250,
    cargoArrived:false, realPct:0,     utilPct:1.000, arrivalDate:null,
    etaJKT:'07 Mar 26', reapplyEst:'',
    reapplyStage:null, reapplyProduct:null, reapplyNewTotal:null,
    reapplyPrevObtained:null, reapplyAdditional:null, reapplySubmitDate:null, reapplyStatus:null,
    target:150, pertek:'1084/ILMATE/PERTEK-SPI-U/XI/2025', spi:'04.PI-05.25.3734', catatan:'KEWEI 65F' },
  { code:'BBB', product:'GL',          berat:400,    obtained:400,
    cargoArrived:false, realPct:0,     utilPct:1.000, arrivalDate:null,
    etaJKT:'07 Mar 26', reapplyEst:'',
    reapplyStage:null, reapplyProduct:null, reapplyNewTotal:null,
    reapplyPrevObtained:null, reapplyAdditional:null, reapplySubmitDate:null, reapplyStatus:null,
    target:300, pertek:'1075/ILMATE/PERTEK-SPI-U/XI/2025', spi:'04.PI-05.26.0450', catatan:'KEWEI 65C' },
  { code:'JKT', product:'GL',          berat:300,    obtained:300,
    cargoArrived:false, realPct:0,     utilPct:1.000, arrivalDate:null,
    etaJKT:'07 Mar 26', reapplyEst:'',
    reapplyStage:null, reapplyProduct:null, reapplyNewTotal:null,
    reapplyPrevObtained:null, reapplyAdditional:null, reapplySubmitDate:null, reapplyStatus:null,
    target:250, pertek:'1045/ILMATE/PERTEK-SPI-U/X/2025', spi:'04.PI-05.26.0329', catatan:'KEWEI 65D' },
  { code:'LCP', product:'GL',          berat:275,    obtained:275,
    cargoArrived:false, realPct:0,     utilPct:1.000, arrivalDate:null,
    etaJKT:'11 Apr 26', reapplyEst:'',
    reapplyStage:null, reapplyProduct:null, reapplyNewTotal:null,
    reapplyPrevObtained:null, reapplyAdditional:null, reapplySubmitDate:null, reapplyStatus:null,
    target:200, pertek:'1106/ILMATE/PERTEK-SPI-U/XI/2025', spi:'04.PI-05.25.3745', catatan:'KEWEI 65E' },
  { code:'AMP', product:'GL + PPGL',   berat:800,    obtained:800,
    cargoArrived:false, realPct:0,     utilPct:1.000, arrivalDate:null,
    etaJKT:'10 Apr 26', reapplyEst:'',
    reapplyStage:null, reapplyProduct:null, reapplyNewTotal:null,
    reapplyPrevObtained:null, reapplyAdditional:null, reapplySubmitDate:null, reapplyStatus:null,
    target:600, pertek:'1040/ILMATE/PERTEK-SPI-U/X/2025', spi:'04.PI-05.25.3544', catatan:'KEWEI 65B / SSSC 12' },
  { code:'BHG', product:'PPGL',        berat:200,    obtained:200,
    cargoArrived:false, realPct:0,     utilPct:1.000, arrivalDate:null,
    etaJKT:'10 Apr 26', reapplyEst:'',
    reapplyStage:null, reapplyProduct:null, reapplyNewTotal:null,
    reapplyPrevObtained:null, reapplyAdditional:null, reapplySubmitDate:null, reapplyStatus:null,
    target:150, pertek:'1057/ILMATE/PERTEK-SPI-U/XI/2025', spi:'04.PI-05.25.3600', catatan:'SSSC 12' },
  { code:'EMS', product:'SHEETPILE',   berat:1599.2, obtained:1600,
    cargoArrived:false, realPct:0,     utilPct:0.999, arrivalDate:null,
    etaJKT:'31 Mar 26', reapplyEst:'',
    reapplyStage:null, reapplyProduct:null, reapplyNewTotal:null,
    reapplyPrevObtained:null, reapplyAdditional:null, reapplySubmitDate:null, reapplyStatus:null,
    target:1200, pertek:'1046/ILMATE/PERTEK-SPI-U/X/2025', spi:'04.PI-05.25.3512', catatan:'MLION #9' },
  { code:'KJK', product:'GL',          berat:946.6,  obtained:950,
    cargoArrived:false, realPct:0,     utilPct:0.996, arrivalDate:null,
    etaJKT:'07 Mar 26', reapplyEst:'',
    reapplyStage:null, reapplyProduct:null, reapplyNewTotal:null,
    reapplyPrevObtained:null, reapplyAdditional:null, reapplySubmitDate:null, reapplyStatus:null,
    target:700, pertek:'1076/ILMATE/PERTEK-SPI-U/XI/2025', spi:'04.PI-05.25.3899', catatan:'KEWEI 64C / 65A' },
  { code:'HKG', product:'GL',          berat:744.4,  obtained:750,
    cargoArrived:false, realPct:0,     utilPct:0.993, arrivalDate:null,
    etaJKT:'13 Mar 26', reapplyEst:'',
    reapplyStage:null, reapplyProduct:null, reapplyNewTotal:null,
    reapplyPrevObtained:null, reapplyAdditional:null, reapplySubmitDate:null, reapplyStatus:null,
    target:500, pertek:'1083/ILMATE/PERTEK-SPI-U/XI/2025', spi:'04.PI-05.25.3895', catatan:'KEWEI 64A' },
  { code:'SGD', product:'SHEETPILE',   berat:1507.5, obtained:2000,
    cargoArrived:false, realPct:0,     utilPct:0.754, arrivalDate:null,
    etaJKT:'31 Mar 26', reapplyEst:'',
    reapplyStage:null, reapplyProduct:null, reapplyNewTotal:null,
    reapplyPrevObtained:null, reapplyAdditional:null, reapplySubmitDate:null, reapplyStatus:null,
    target:1400, pertek:'1046/ILMATE/PERTEK-SPI-U/X/2025', spi:'04.PI-05.25.3512', catatan:'MLION #9' },
  { code:'GKL', product:'GI BORON + ERW PIPE', berat:1637.3, obtained:2400,
    cargoArrived:false, realPct:0,     utilPct:0.682, arrivalDate:null,
    etaJKT:'18 Apr 26', reapplyEst:'',
    reapplyStage:null, reapplyProduct:null, reapplyNewTotal:null,
    reapplyPrevObtained:null, reapplyAdditional:null, reapplySubmitDate:null, reapplyStatus:null,
    target:800, pertek:'1073/ILMATE/PERTEK-SPI-U/XI/2025', spi:'04.PI-05.25.3797', catatan:'YOU FA #6,7,8 / ARSEN 54' },
  { code:'SPA', product:'BORDES ALLOY',berat:114.5,  obtained:515,
    cargoArrived:false, realPct:0,     utilPct:0.222, arrivalDate:null,
    etaJKT:'07 Mar 26', reapplyEst:'',
    reapplyStage:null, reapplyProduct:null, reapplyNewTotal:null,
    reapplyPrevObtained:null, reapplyAdditional:null, reapplySubmitDate:null, reapplyStatus:null,
    target:null, pertek:'1079/ILMATE/PERTEK-SPI-U/XI/2025', spi:'04.PI-05.26.0407', catatan:'ARSEN WP 02' },
];

// ════════════════════════════════════════════════════════════
//  PENDING DATA
// ════════════════════════════════════════════════════════════
const PENDING = [
  { code:'KARA', group:'CD', products:['HRC/HRPO ALLOY'], mt:6000,
    remarks:'SUBMIT MOI 05/11/25', status:'Permintaan kelengkapan data tambahan', date:'19/11/25',
    cycles:[
      {type:'Submit #1',  mt:6000, products:{'HRC/HRPO ALLOY':6000}, submitType:'Submit MOI', submitDate:'05/11/2025', releaseType:'PERTEK', releaseDate:'TBA', status:'Update 19/11/25 - Permintaan kelengkapan data tambahan'},
      {type:'Obtained #1',mt:null, products:{},                      submitType:'Submit MOT', submitDate:'TBA',        releaseType:'SPI',    releaseDate:'TBA', status:''},
    ]},
  { code:'AADC', group:'CD', products:['GL BORON'],       mt:3000,
    remarks:'SUBMIT MOI 02/02/26', status:'Permintaan kelengkapan data tambahan', date:'18/03/26',
    cycles:[
      {type:'Submit (Process)',mt:3000,products:{'GL BORON':3000},   submitType:'Submit MOI', submitDate:'02/02/2026', releaseType:'PERTEK', releaseDate:'TBA', status:'Update 18/03/26 - Permintaan kelengkapan data tambahan'},
      {type:'Obtained #1',    mt:null, products:{},                  submitType:'Submit MOT', submitDate:'TBA',        releaseType:'SPI',    releaseDate:'TBA', status:''},
    ]},
  { code:'PPGL', group:'CD', products:['GL BORON'],       mt:3000,
    remarks:'SUBMIT MOI 02/02/26', status:'Permintaan data tambahan', date:'12/02/26',
    cycles:[
      {type:'Submit (Process)',mt:3000,products:{'GL BORON':3000},   submitType:'Submit MOI', submitDate:'02/02/2026', releaseType:'PERTEK', releaseDate:'TBA', status:'Update 12/02/26 - Permintaan data tambahan'},
      {type:'Obtained #1',    mt:null, products:{},                  submitType:'Submit MOT', submitDate:'TBA',        releaseType:'SPI',    releaseDate:'TBA', status:''},
    ]},
  { code:'SNSD', group:'CD', products:['GL BORON'],       mt:3000,
    remarks:'SUBMIT MOI 02/02/26', status:'Permintaan kelengkapan data tambahan', date:'02/03/26',
    cycles:[
      {type:'Submit (Process)',mt:3000,products:{'GL BORON':3000},   submitType:'Submit MOI', submitDate:'02/02/2026', releaseType:'PERTEK', releaseDate:'TBA', status:'Update 02/03/26 - Permintaan kelengkapan data tambahan'},
      {type:'Obtained #1',    mt:null, products:{},                  submitType:'Submit MOT', submitDate:'TBA',        releaseType:'SPI',    releaseDate:'TBA', status:''},
    ]},
];

// ════════════════════════════════════════════════════════════
//  SEED FUNCTION
// ════════════════════════════════════════════════════════════
async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    console.log('🌱 Starting seed...\n');

    // ── 1. Clear existing data (order matters for FK) ────────
    await client.query(`
      TRUNCATE audit_log, reapply_targets, shipments,
               ra_records, pending_companies,
               cycle_products, cycles, revision_changes,
               spi_product_utilization, spi_records,
               company_products, companies
      RESTART IDENTITY CASCADE
    `);
    console.log('🧹 Cleared all tables');

    // ── 2. Insert SPI companies ──────────────────────────────
    for (const co of SPI) {
      // companies
      await client.query(
        `INSERT INTO companies(code, company_group, status_type) VALUES($1,$2,'spi')`,
        [co.code, co.group]
      );
      // company_products
      for (const p of co.products) {
        await client.query(
          `INSERT INTO company_products(company_code, product) VALUES($1,$2)`,
          [co.code, p]
        );
      }
      // spi_records
      await client.query(
        `INSERT INTO spi_records(company_code, submit1_mt, obtained_mt, utilization_mt,
           available_quota, rev_type, rev_note, rev_submit_date, rev_status, rev_mt, remarks, spi_ref)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [co.code, co.submit1, co.obtained, co.utilizationMT, co.availableQuota,
         co.revType || 'none', co.revNote || null,
         pd(co.revSubmitDate), co.revStatus || null, co.revMT || 0,
         co.remarks || null, co.spiRef || null]
      );
      // spi_product_utilization
      const allProds = new Set([
        ...Object.keys(co.utilizationByProd || {}),
        ...Object.keys(co.availableByProd   || {}),
      ]);
      for (const p of allProds) {
        await client.query(
          `INSERT INTO spi_product_utilization(company_code, product, utilization_mt, available_mt)
           VALUES($1,$2,$3,$4)`,
          [co.code, p,
           co.utilizationByProd[p] || 0,
           co.availableByProd[p]   || 0]
        );
      }
      // revision_changes
      for (const r of (co.revFrom || [])) {
        await client.query(
          `INSERT INTO revision_changes(company_code, direction, product, mt, label)
           VALUES($1,'from',$2,$3,$4)`,
          [co.code, r.prod, r.mt || null, r.label || null]
        );
      }
      for (const r of (co.revTo || [])) {
        await client.query(
          `INSERT INTO revision_changes(company_code, direction, product, mt, label)
           VALUES($1,'to',$2,$3,$4)`,
          [co.code, r.prod, r.mt || null, r.label || null]
        );
      }
      // cycles + cycle_products
      for (let i = 0; i < co.cycles.length; i++) {
        const cy = co.cycles[i];
        const mtVal  = (cy.mt === null || isTBA(String(cy.mt))) ? null : cy.mt;
        const mtTBA  = cy.mt === null || isTBA(String(cy.mt));
        const { rows: cyRows } = await client.query(
          `INSERT INTO cycles(company_code, cycle_order, cycle_type, mt, mt_is_tba,
             submit_type, submit_date, submit_date_tba,
             release_type, release_date, release_date_tba, status)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
          [co.code, i + 1, cy.type, mtVal, mtTBA,
           cy.submitType  || null, pd(cy.submitDate),  isTBA(cy.submitDate),
           cy.releaseType || null, pd(cy.releaseDate), isTBA(cy.releaseDate),
           cy.status || null]
        );
        const cycleId = cyRows[0].id;
        for (const [prod, pmt] of Object.entries(cy.products || {})) {
          const pmtVal = (pmt === null || isTBA(String(pmt))) ? null : pmt;
          await client.query(
            `INSERT INTO cycle_products(cycle_id, product, mt, mt_is_tba)
             VALUES($1,$2,$3,$4)`,
            [cycleId, prod, pmtVal, pmtVal === null]
          );
        }
      }
    }
    console.log(`✅ Inserted ${SPI.length} SPI companies`);

    // ── 3. Insert PENDING companies ──────────────────────────
    for (const co of PENDING) {
      await client.query(
        `INSERT INTO companies(code, company_group, status_type) VALUES($1,$2,'pending')`,
        [co.code, co.group]
      );
      for (const p of co.products) {
        await client.query(
          `INSERT INTO company_products(company_code, product) VALUES($1,$2)`,
          [co.code, p]
        );
      }
      await client.query(
        `INSERT INTO pending_companies(company_code, mt_requested, remarks, status, status_date)
         VALUES($1,$2,$3,$4,$5)`,
        [co.code, co.mt, co.remarks || null, co.status || null, pd(co.date)]
      );
      for (let i = 0; i < co.cycles.length; i++) {
        const cy = co.cycles[i];
        const mtVal = (cy.mt === null || isTBA(String(cy.mt))) ? null : cy.mt;
        const { rows: cyRows } = await client.query(
          `INSERT INTO cycles(company_code, cycle_order, cycle_type, mt, mt_is_tba,
             submit_type, submit_date, submit_date_tba,
             release_type, release_date, release_date_tba, status)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
          [co.code, i + 1, cy.type, mtVal, mtVal === null,
           cy.submitType  || null, pd(cy.submitDate),  isTBA(cy.submitDate),
           cy.releaseType || null, pd(cy.releaseDate), isTBA(cy.releaseDate),
           cy.status || null]
        );
        const cycleId = cyRows[0].id;
        for (const [prod, pmt] of Object.entries(cy.products || {})) {
          const pmtVal = (pmt === null || isTBA(String(pmt))) ? null : pmt;
          await client.query(
            `INSERT INTO cycle_products(cycle_id, product, mt, mt_is_tba) VALUES($1,$2,$3,$4)`,
            [cycleId, prod, pmtVal, pmtVal === null]
          );
        }
      }
    }
    console.log(`✅ Inserted ${PENDING.length} PENDING companies`);

    // ── 4. Insert RA records ─────────────────────────────────
    for (const r of RA) {
      await client.query(
        `INSERT INTO ra_records(
           company_code, product, berat, obtained_mt, cargo_arrived,
           real_pct, util_pct, arrival_date, eta_jkt, reapply_est,
           reapply_stage, reapply_product, reapply_new_total,
           reapply_prev_obtained, reapply_additional,
           reapply_submit_date, reapply_status,
           target_mt, pertek, spi, catatan)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
        [r.code, r.product, r.berat, r.obtained, r.cargoArrived,
         r.realPct, r.utilPct ?? null, r.arrivalDate || null, r.etaJKT || null, r.reapplyEst || null,
         r.reapplyStage || null, r.reapplyProduct || null, r.reapplyNewTotal || null,
         r.reapplyPrevObtained || null, r.reapplyAdditional || null,
         pd(r.reapplySubmitDate), r.reapplyStatus || null,
         r.target || null, r.pertek || null, r.spi || null, r.catatan || null]
      );
    }
    console.log(`✅ Inserted ${RA.length} RA records`);

    await client.query('COMMIT');
    console.log('\n🎉 Seed complete!');

    // ── 5. Summary ───────────────────────────────────────────
    const counts = await Promise.all([
      client.query('SELECT COUNT(*) FROM companies'),
      client.query('SELECT COUNT(*) FROM spi_records'),
      client.query('SELECT COUNT(*) FROM ra_records'),
      client.query('SELECT COUNT(*) FROM cycles'),
      client.query('SELECT COUNT(*) FROM shipments'),
      client.query('SELECT COUNT(*) FROM pending_companies'),
    ]);
    console.log('\n📊 Row counts:');
    console.log('  companies:       ', counts[0].rows[0].count);
    console.log('  spi_records:     ', counts[1].rows[0].count);
    console.log('  ra_records:      ', counts[2].rows[0].count);
    console.log('  cycles:          ', counts[3].rows[0].count);
    console.log('  shipments:       ', counts[4].rows[0].count);
    console.log('  pending_companies:', counts[5].rows[0].count);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n❌ Seed failed:', err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();