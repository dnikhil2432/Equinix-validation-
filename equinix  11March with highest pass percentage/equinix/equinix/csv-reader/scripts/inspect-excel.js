import XLSX from 'xlsx';

const invoicePath = 'C:\\Users\\dnikh\\Downloads\\Vendor Invoice.xlsx';
const quotePath = 'C:\\Users\\dnikh\\Downloads\\Quotation Line Items.xlsx';

function inspect(path, label) {
  try {
    const wb = XLSX.readFile(path);
    const sh = wb.Sheets[wb.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(sh, { header: 1, defval: '' });
    console.log('\n=== ' + label + ' ===');
    console.log('Headers:', JSON.stringify(data[0]));
    console.log('Row 2:', JSON.stringify((data[1] || []).slice(0, 25)));
    if (data[2]) console.log('Row 3:', JSON.stringify((data[2] || []).slice(0, 25)));
    // Also show as key-value from sheet_to_json with headers (first row as keys)
    const asObj = XLSX.utils.sheet_to_json(sh);
    if (asObj[0]) console.log('Keys in first data row:', Object.keys(asObj[0]));
  } catch (e) {
    console.log(label + ' error:', e.message);
  }
}

inspect(invoicePath, 'Vendor Invoice.xlsx');
inspect(quotePath, 'Quotation Line Items.xlsx');
