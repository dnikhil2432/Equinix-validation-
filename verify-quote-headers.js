/**
 * One-off: verify Quote_Test.xlsx headers match what validationLogic.js expects.
 * No changes to project; run: node verify-quote-headers.js
 */
import XLSX from 'xlsx';
import fs from 'fs';

const path = 'C:\\Users\\dnikh\\Downloads\\equinix\\equinix\\csv-reader\\test-data\\Quotation Line Items 5.xlsx';
const expected = ['Po Number', 'Site Id', 'Item Code', 'Item Description', 'Changed Item Description', 'Quantity'];
const priceCols = ['OTC', 'MRC'];

try {
  const buf = fs.readFileSync(path);
  const wb = XLSX.read(buf, { type: 'buffer' });
  const sh = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sh);
  const keys = rows.length > 0 ? Object.keys(rows[0]) : [];

  console.log('File:', path);
  console.log('Sheet:', wb.SheetNames[0]);
  console.log('Row count:', rows.length);
  console.log('');
  console.log('Actual headers in file:', keys);
  console.log('');
  const missing = expected.filter((k) => !keys.includes(k));
  const hasPrice = priceCols.some((k) => keys.includes(k));
  console.log('Expected (required):', expected.join(', '));
  console.log('Missing required:', missing.length ? missing.join(', ') : 'None');
  console.log('Has OTC or MRC column:', hasPrice ? 'Yes' : 'No');
  if (rows[0]) {
    console.log('');
    console.log('First data row (sample):');
    Object.entries(rows[0]).forEach(([k, v]) => console.log('  ' + k + ':', String(v).slice(0, 60)));
  }
  console.log('');
  console.log('Verdict:', missing.length === 0 && hasPrice ? 'OK – quotation data structure is correct.' : 'Issue – fix missing/renamed columns.');
} catch (e) {
  console.error('Error:', e.message);
}
