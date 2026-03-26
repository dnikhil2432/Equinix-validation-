/**
 * Inspect invoice/base Excel file: headers, column names, and sample values for numeric columns.
 * Run: node inspect-invoice.js
 */
import XLSX from 'xlsx';
import fs from 'fs';

const path = 'C:\\Users\\dnikh\\Downloads\\ATT AR Data Extract SEP-25 1.xlsx';

// Base file columns the app looks for (validationLogic / ExcelValidation)
const BASE_COLUMNS = [
  'PO_NUMBER', 'IBX', 'PRODUCT_CODE', 'DESCRIPTION', 'QUANTITY',
  'UNIT_SELLING_PRICE', 'LINE_LEVEL_AMOUNT', 'SERIAL_NUMBER', 'LINE_NUMBER',
  'TRX_NUMBER', 'invoice_number', 'Invoice Number', 'RECURRING_CHARGE_FROM_DATE',
  'RECURRING_CHARGE_TO_DATE', 'SERVICE_START_DATE', 'RENEWAL_TERM',
  'FIRST_PRICE_INC_APP_AFTER', 'PRICE_INCREASE_PERCENTAGE'
];

function inspect(pathToFile) {
  try {
    const buf = fs.readFileSync(pathToFile);
    const wb = XLSX.read(buf, { type: 'buffer', cellNF: true });
    const sh = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sh, { raw: false, defval: '' });
    const keys = rows.length > 0 ? Object.keys(rows[0]) : [];

    console.log('File:', pathToFile);
    console.log('Sheet:', wb.SheetNames[0]);
    console.log('Row count:', rows.length);
    console.log('\n--- All column headers (exact as in file) ---');
    keys.forEach((k, i) => console.log(`  ${i + 1}. "${k}"`));

    console.log('\n--- Expected base columns vs file ---');
    for (const col of BASE_COLUMNS) {
      const found = keys.includes(col);
      const similar = keys.filter(k => k.toUpperCase().replace(/\s+/g, '_').includes(col.replace(/_/g, '')) || col.replace(/_/g, ' ').toLowerCase().split('_').every(part => k.toLowerCase().includes(part)));
      console.log(`  ${col}: ${found ? 'YES' : 'NO'}${!found && similar.length ? '  (similar: ' + similar.join(', ') + ')' : ''}`);
    }

    // Raw first row to see types
    if (rows.length > 0) {
      console.log('\n--- First row: raw values and types (key columns) ---');
      const r = rows[0];
      for (const key of keys) {
        const v = r[key];
        const typ = v === null || v === undefined ? 'null' : typeof v;
        const preview = String(v).slice(0, 50);
        if (/PRICE|AMOUNT|QUANTITY|quantity|amount|price/i.test(key))
          console.log(`  "${key}": type=${typ}, value=${JSON.stringify(preview)}`);
      }
      console.log('\n--- Sample first 3 rows: UNIT_SELLING_PRICE, LINE_LEVEL_AMOUNT, QUANTITY (any case) ---');
      const priceKey = keys.find(k => /unit.*sell|selling.*price/i.test(k));
      const llaKey = keys.find(k => /line.*level.*amount|line_level_amount/i.test(k));
      const qtyKey = keys.find(k => /^quantity$/i.test(k));
      console.log('  Detected price column:', priceKey || '(none)');
      console.log('  Detected LLA column:', llaKey || '(none)');
      console.log('  Detected quantity column:', qtyKey || '(none)');
      for (let i = 0; i < Math.min(3, rows.length); i++) {
        const row = rows[i];
        console.log(`  Row ${i + 1}: price=${row[priceKey] ?? row['UNIT_SELLING_PRICE']}, lla=${row[llaKey] ?? row['LINE_LEVEL_AMOUNT']}, qty=${row[qtyKey] ?? row['QUANTITY']}`);
      }
    }
  } catch (e) {
    console.error('Error:', e.message);
  }
}

inspect(path);
