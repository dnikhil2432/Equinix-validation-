/**
 * Diagnose prod invoice vs quote: why 1450 expected quote-validated vs 1075 actual.
 * Run: node diagnose-prod-run.js
 */
import XLSX from 'xlsx'
import fs from 'fs'
import { runValidation } from './src/validationLogic.js'

const invoicePath = 'C:\\Users\\dnikh\\Downloads\\ATT AR Data Extract SEP-25 1.xlsx'
const quotePath = 'C:\\Users\\dnikh\\Downloads\\x_attm_doms_doms_quotation_line_items (5).xlsx'

function normalizeSheetKeys(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return rows
  return rows.map(row => {
    const out = {}
    for (const [k, v] of Object.entries(row)) {
      const key = k != null ? String(k).trim() : ''
      out[key] = v
    }
    return out
  })
}

function sheetToJsonWithHeaderRow(sheet) {
  const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })
  if (!raw.length) return []
  const headerRow = raw[0].map(h => (h != null ? String(h).trim() : ''))
  return raw.slice(1).map(row => {
    const obj = {}
    headerRow.forEach((h, i) => { if (h) obj[h] = row[i] })
    return obj
  })
}

function sheetToJson(path, useRawHeader = false) {
  const buf = fs.readFileSync(path)
  const wb = XLSX.read(buf, { type: 'buffer' })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  let rows = useRawHeader ? sheetToJsonWithHeaderRow(sheet) : XLSX.utils.sheet_to_json(sheet)
  return normalizeSheetKeys(rows)
}

console.log('Loading invoice:', invoicePath)
const baseData = sheetToJson(invoicePath, true)
console.log('  Rows:', baseData.length)

console.log('Loading quote:', quotePath)
const quoteData = sheetToJson(quotePath, true)
console.log('  Rows:', quoteData.length)
console.log('  Quote columns (first row):', quoteData[0] ? Object.keys(quoteData[0]) : [])

// Run without rate card so we only see quote vs skipped
const result = runValidation(baseData, quoteData, {
  priceTolerance: 0.05,
  qtyTolerance: 0.2
})

const rows = result.validationResults || []

// Count by validation_step
const byStep = {}
for (const r of rows) {
  const step = r.validation_step || '(empty)'
  byStep[step] = (byStep[step] || 0) + 1
}

// Quote-validated = Passed or Failed where step starts with "Quote -"
const quoteValidated = rows.filter(r =>
  r.validation_result === 'Passed' || r.validation_result === 'Failed'
)
const quotePassed = rows.filter(r => r.validation_result === 'Passed')
const quoteFailed = rows.filter(r => r.validation_result === 'Failed')
const skipped = rows.filter(r => r.validation_result === 'Skipped')

console.log('\n--- Summary ---')
console.log('  Total invoice lines:', result.totalLines)
console.log('  Validated with Quote (Passed + Failed):', quoteValidated.length)
console.log('    Passed:', quotePassed.length)
console.log('    Failed:', quoteFailed.length)
console.log('  Skipped (no quote match / sent to rate card):', skipped.length)

console.log('\n--- Breakdown of Skipped (why no quote validation) ---')
const skippedSteps = {}
for (const r of skipped) {
  const step = r.validation_step || '(empty)'
  skippedSteps[step] = (skippedSteps[step] || 0) + 1
}
Object.entries(skippedSteps).sort((a, b) => b[1] - a[1]).forEach(([step, count]) => {
  console.log(`  ${count}: ${step}`)
})

console.log('\n--- Sample Skipped rows (first 8) ---')
skipped.slice(0, 8).forEach((r, i) => {
  console.log(`  ${i + 1}. Row ${r.row} | PO: ${r.po_number ?? '(blank)'} | IBX: ${r.ibx ?? '(blank)'} | Step: ${r.validation_step} | ${(r.remarks || '').slice(0, 60)}`)
})

// Unique POs in invoice vs in quote
const invoicePOs = new Set()
const quotePOs = new Set()
function getPo(row, key) {
  const v = row[key]
  if (v == null || v === '') return null
  return String(v).trim().toUpperCase()
}
baseData.forEach(r => {
  const po = getPo(r, 'PO_NUMBER')
  if (po) invoicePOs.add(po)
})
quoteData.forEach(r => {
  const po = getPo(r, 'Po Number')
  if (po) quotePOs.add(po)
})
const invoiceOnlyPOs = [...invoicePOs].filter(po => !quotePOs.has(po))
const quoteOnlyPOs = [...quotePOs].filter(po => !invoicePOs.has(po))
console.log('\n--- PO coverage ---')
console.log('  Unique POs in invoice:', invoicePOs.size)
console.log('  Unique POs in quote:', quotePOs.size)
console.log('  POs in invoice but NOT in quote:', invoiceOnlyPOs.length)
if (invoiceOnlyPOs.length > 0 && invoiceOnlyPOs.length <= 20) {
  console.log('    ', invoiceOnlyPOs.slice(0, 20).join(', '))
} else if (invoiceOnlyPOs.length > 20) {
  console.log('    (first 20):', invoiceOnlyPOs.slice(0, 20).join(', '))
}

const invoiceRowsWithPOInQuote = baseData.filter(r => quotePOs.has(getPo(r, 'PO_NUMBER'))).length
console.log('\n--- Quote-eligible (invoice rows whose PO exists in quote) ---')
console.log('  Count:', invoiceRowsWithPOInQuote)
console.log('  (If your research says 1450 should be validated with quote, compare with Validated-with-Quote count above.)')

console.log('\nDone.')
