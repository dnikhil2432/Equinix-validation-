/**
 * List invoice columns and SERVICE_START_DATE (or similar) values; check which fall in rate card window.
 */
import XLSX from 'xlsx'

const INVOICE_PATH = 'C:\\Users\\dnikh\\Downloads\\Equinix ATT Billing Data extracts Dec-25.xlsx'

// Rate card window: 2025-04-01 to 2026-03-31
const WINDOW_FROM = new Date(2025, 3, 1)   // April 1 2025
const WINDOW_TILL = new Date(2026, 2, 31)  // March 31 2026

// Standard Excel serial to JS Date: serial 1 = 1900-01-01, 25569 ≈ 1970-01-01
function excelSerialToDate(serial) {
  if (serial == null || serial === '' || isNaN(serial)) return null
  const n = typeof serial === 'number' ? serial : parseFloat(String(serial).replace(/[$,]/g, ''))
  if (n > 1000 && n < 100000) {
    return new Date((n - 25569) * 86400000)
  }
  return new Date(serial)
}

function main() {
  const wb = XLSX.readFile(INVOICE_PATH)
  const ws = wb.Sheets[wb.SheetNames[0]]
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
  const headers = (raw[0] || []).map(h => (h != null ? String(h).trim() : ''))
  console.log('All invoice columns:', headers)
  const idx = headers.findIndex(h => /service|start|date/i.test(h))
  const colName = idx >= 0 ? headers[idx] : null
  console.log('Service start date column index:', idx, 'name:', colName)

  const data = XLSX.utils.sheet_to_json(ws)
  const key = data[0] && Object.keys(data[0]).find(k => /service|start|date/i.test(k))
  console.log('Key from sheet_to_json that matches service/start/date:', key)

  const values = []
  for (let i = 0; i < Math.min(500, data.length); i++) {
    const row = data[i]
    const v = key ? row[key] : (colName != null ? row[colName] : null)
    if (v !== undefined && v !== null && v !== '') values.push({ row: i + 1, raw: v, type: typeof v })
  }
  console.log('\nSample SERVICE_START_DATE values (first 20):', values.slice(0, 20))

  const withDate = values.map(({ row, raw }) => {
    const d = excelSerialToDate(raw)
    const inWindow = d && d.getTime() >= WINDOW_FROM.getTime() && d.getTime() <= WINDOW_TILL.getTime()
    return { row, raw, date: d ? d.toISOString().slice(0, 10) : null, inWindow }
  })
  const inWindow = withDate.filter(x => x.inWindow)
  console.log('\nIn-window (2025-04-01 to 2026-03-31) count in first 500 rows:', inWindow.length)
  if (inWindow.length > 0) console.log('Sample in-window:', inWindow.slice(0, 5))
}

main()
