import XLSX from 'xlsx';
import fs from 'fs';

const path = 'C:\\Users\\dnikh\\Downloads\\x_attm_doms_doms_quotation_line_items (5).xlsx';
const buf = fs.readFileSync(path);
const wb = XLSX.read(buf, { type: 'buffer' });
const sh = wb.Sheets[wb.SheetNames[0]];
const raw = XLSX.utils.sheet_to_json(sh, { header: 1, defval: '' });
console.log('Sheet:', wb.SheetNames[0]);
console.log('Total rows (raw):', raw.length);
console.log('First row length:', raw[0]?.length);
console.log('\nFirst 4 rows (raw), first 25 cells:');
raw.slice(0, 4).forEach((row, i) => console.log('Row', i, ':', row.slice(0, 25)));

const rows = XLSX.utils.sheet_to_json(sh);
const keys = rows.length > 0 ? Object.keys(rows[0]) : [];
console.log('\nWhen first row = header, keys:', keys);

// Build from raw with row 0 as header
const headerRow = raw[0] || [];
const dataFromRaw = raw.slice(1).map(row => {
  const obj = {};
  headerRow.forEach((h, i) => {
    const key = h != null ? String(h).trim() : '';
    if (key) obj[key] = row[i];
  });
  return obj;
});
const firstDataKeys = dataFromRaw[0] ? Object.keys(dataFromRaw[0]) : [];
console.log('\nBuilt from raw (row0=header), first data row keys:', firstDataKeys);
const withPO = dataFromRaw.filter(r => r['Po Number'] != null && String(r['Po Number']).trim() !== '').length;
console.log('Rows with non-empty Po Number:', withPO);
console.log('Sample PO values:', [...new Set(dataFromRaw.slice(0, 100).map(r => r['Po Number']).filter(Boolean))].slice(0, 5));
