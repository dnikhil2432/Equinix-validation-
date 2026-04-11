/**
 * Filter invoice file to only rows that have at least one QLI with matching PO.
 * Reads invoice and quote files, keeps only invoice rows whose PO appears in the quote file, saves to test-data.
 */
import XLSX from 'xlsx'
import { writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

const INVOICE_PATH = 'C:\\Users\\dnikh\\Downloads\\Equinix ATT Billing Data extracts Dec-25 1 (1).xlsx'
const QUOTE_PATH = 'C:\\Users\\dnikh\\Downloads\\x_attm_doms_doms_quotation_line_items (4).xlsx'
const TEST_DATA_DIR = join(__dirname, '..', 'test-data')
const OUT_FILENAME = 'Equinix_ATT_Billing_Dec25_invoice_PO_matched.xlsx'

function getValue(row, key) {
  if (!row || !key) return ''
  const val = row[key]
  return (val != null && val !== '') ? String(val).trim() : ''
}

function findPOKey(rows, variants) {
  if (!rows || rows.length === 0) return null
  const keys = Object.keys(rows[0] || {})
  for (const v of variants) {
    const found = keys.find(k => (k || '').trim() === v || (k || '').replace(/[\s_\-]/g, '').toLowerCase() === v.replace(/[\s_\-]/g, '').toLowerCase())
    if (found) return found
  }
  return keys.find(k => /po\s*number|po_number/i.test(k)) || null
}

function main() {
  const invWb = XLSX.readFile(INVOICE_PATH)
  const invSheetName = invWb.SheetNames[0]
  const invWs = invWb.Sheets[invSheetName]
  const invData = XLSX.utils.sheet_to_json(invWs)

  const quoteWb = XLSX.readFile(QUOTE_PATH)
  const quoteSheetName = quoteWb.SheetNames[0]
  const quoteWs = quoteWb.Sheets[quoteSheetName]
  const quoteData = XLSX.utils.sheet_to_json(quoteWs)

  const invPOKey = findPOKey(invData, ['PO_NUMBER', 'PO Number', 'Po Number', 'po_number'])
  const quotePOKey = findPOKey(quoteData, ['Po Number', 'PO Number', 'PO_NUMBER', 'po_number'])

  if (!invPOKey) {
    console.error('Invoice PO column not found. Columns:', Object.keys(invData[0] || {}))
    process.exit(1)
  }
  if (!quotePOKey) {
    console.error('Quote PO column not found. Columns:', Object.keys(quoteData[0] || {}))
    process.exit(1)
  }

  const quotePOs = new Set()
  for (const row of quoteData) {
    const po = getValue(row, quotePOKey)
    if (po) quotePOs.add(po.toUpperCase())
  }

  const filtered = invData.filter(row => {
    const po = getValue(row, invPOKey)
    return po && quotePOs.has(po.toUpperCase())
  })

  console.log('Invoice rows total:', invData.length)
  console.log('Unique POs in quote:', quotePOs.size)
  console.log('Invoice rows with matching PO:', filtered.length)
  console.log('Rows removed:', invData.length - filtered.length)

  const outWs = XLSX.utils.json_to_sheet(filtered)
  const outWb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(outWb, outWs, invSheetName || 'Sheet1')
  const outPath = join(TEST_DATA_DIR, OUT_FILENAME)
  XLSX.writeFile(outWb, outPath)
  console.log('Saved:', outPath)
}

main()
