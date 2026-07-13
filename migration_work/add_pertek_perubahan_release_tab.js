// One-off: create the `pertek_perubahan_release` tab (idempotent).
// Run: node migration_work/add_pertek_perubahan_release_tab.js
const { google } = require('googleapis');
const SID = '13CQrRUXhfB2Ceq8p7HXPhx2Fj31DSN3AwvtuNKpg08o';
const TAB = 'pertek_perubahan_release';
const HEAD = ['code', 'release_date', 'updated_at'];

(async () => {
  const auth = new google.auth.GoogleAuth({ keyFile: 'service-account.json', scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  const sheets = google.sheets({ version: 'v4', auth });

  let meta = await sheets.spreadsheets.get({ spreadsheetId: SID });
  const has = t => meta.data.sheets.some(s => s.properties.title === t);
  if (!has(TAB)) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: SID, requestBody: { requests: [{ addSheet: { properties: { title: TAB } } }] } });
    meta = await sheets.spreadsheets.get({ spreadsheetId: SID });
    console.log('created tab', TAB);
  } else {
    console.log('tab already exists', TAB);
  }
  const id = {}; meta.data.sheets.forEach(s => id[s.properties.title] = s.properties.sheetId);

  // Header row (RAW; overwrites row 1 only).
  await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: SID, requestBody: { valueInputOption: 'RAW', data: [{ range: TAB + '!A1', values: [HEAD] }] } });

  // Freeze + bold header + company-code FK validation, matching addtabs.js style.
  await sheets.spreadsheets.batchUpdate({ spreadsheetId: SID, requestBody: { requests: [
    { updateSheetProperties: { properties: { sheetId: id[TAB], gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' } },
    { repeatCell: { range: { sheetId: id[TAB], startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { backgroundColor: { red: 0.12, green: 0.29, blue: 0.49 }, textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } } } }, fields: 'userEnteredFormat(backgroundColor,textFormat)' } },
    { setDataValidation: { range: { sheetId: id[TAB], startRowIndex: 1, endRowIndex: 2000, startColumnIndex: 0, endColumnIndex: 1 }, rule: { condition: { type: 'ONE_OF_RANGE', values: [{ userEnteredValue: '=Companies!$B$2:$B$1000' }] }, showCustomUi: true, strict: false } } },
  ] } });

  console.log('header + formatting applied. DONE.');
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
