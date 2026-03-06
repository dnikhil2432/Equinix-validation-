import XLSX from 'xlsx';

const path = 'C:\\Users\\dnikh\\Downloads\\x_attm_doms_rate_card_data (3).xlsx';

try {
  const wb = XLSX.readFile(path);
  console.log('Sheet names:', wb.SheetNames);
  const sh = wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(sh, { header: 1, defval: '' });
  const headers = (data[0] || []).map((h, i) => ({ index: i, raw: String(h ?? ''), trimmed: String(h ?? '').trim() }));
  console.log('\n--- Column count:', headers.length);
  console.log('\n--- Headers (index, raw, trimmed):');
  headers.forEach(({ index, raw, trimmed }) => console.log(index + ':', JSON.stringify(raw), '=>', JSON.stringify(trimmed)));
  const asObj = XLSX.utils.sheet_to_json(sh);
  console.log('\n--- Keys from sheet_to_json (first row as keys):');
  if (asObj[0]) console.log(Object.keys(asObj[0]));
  console.log('\n--- First data row (sample values for first 20 keys):');
  if (asObj[0]) {
    const keys = Object.keys(asObj[0]);
    keys.slice(0, 20).forEach(k => console.log('  ', k, '=>', JSON.stringify(asObj[0][k])));
  }
  if (asObj[1]) {
    console.log('\n--- Second data row (first 20 keys):');
    const keys = Object.keys(asObj[0]);
    keys.slice(0, 20).forEach(k => console.log('  ', k, '=>', JSON.stringify(asObj[1][k])));
  }
} catch (e) {
  console.error('Error:', e.message);
}
