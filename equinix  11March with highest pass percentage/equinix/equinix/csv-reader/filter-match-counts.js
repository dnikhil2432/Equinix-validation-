/**
 * Count how many invoice rows pass each filter stage against quotation data.
 * Run: node filter-match-counts.js
 */
import XLSX from 'xlsx'
import fs from 'fs'
import { indexQuotesByPO, getQLISiteId, getQLIProductCode, runValidation } from './src/validationLogic.js'

const invoicePath = 'C:\\Users\\dnikh\\Downloads\\ATT AR Data Extract SEP-25 1.xlsx'
const quotePath = 'C:\\Users\\dnikh\\Downloads\\x_attm_doms_doms_quotation_line_items (5).xlsx'

function getValue(row, key) {
  if (!row || !key) return ''
  const val = row[key]
  return (val != null && val !== '') ? String(val).trim() : ''
}

function normalizeText(text) {
  if (!text || text === '' || text === null || text === undefined) return ''
  return text.toString()
    .replace(/[^a-zA-Z0-9]/g, '')
    .replace(/[\s,]+/g, ' ')
    .trim()
    .toLowerCase()
}

function normalizeSheetKeys(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return rows
  return rows.map(row => {
    const out = {}
    for (const [k, v] of Object.entries(row)) {
      out[k != null ? String(k).trim() : ''] = v
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

function loadSheet(path) {
  const buf = fs.readFileSync(path)
  const wb = XLSX.read(buf, { type: 'buffer' })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  return normalizeSheetKeys(sheetToJsonWithHeaderRow(sheet))
}

console.log('Loading invoice:', invoicePath)
const baseData = loadSheet(invoicePath)
console.log('Loading quote:', quotePath)
const quoteData = loadSheet(quotePath)

const byPO = indexQuotesByPO(quoteData)

let afterPO = 0      // ILI has PO and at least one QLI for that PO
let afterIBX = 0     // after PO, and at least one QLI has matching Site Id / IBX
let afterItemCode = 0 // after IBX, and at least one QLI has item code match (normalizeText, includes)

for (const ili of baseData) {
  const po = getValue(ili, 'PO_NUMBER')
  const poTrimmed = po ? String(po).trim() : ''
  if (!poTrimmed) continue

  const key = poTrimmed.toUpperCase()
  const qlis = byPO[key] || []
  if (qlis.length === 0) continue

  afterPO++

  const ibx = getValue(ili, 'IBX')
  const ibxTrimmed = ibx ? String(ibx).trim() : ''
  if (!ibxTrimmed) continue

  const qlisByIbx = qlis.filter(qli => {
    const qliSite = getQLISiteId(qli)
    const siteTrimmed = qliSite ? String(qliSite).trim() : ''
    if (!siteTrimmed) return false
    return siteTrimmed.toUpperCase().includes(ibxTrimmed.toUpperCase()) ||
           ibxTrimmed.toUpperCase().includes(siteTrimmed.toUpperCase())
  })
  if (qlisByIbx.length === 0) continue

  afterIBX++

  const itemCode = getValue(ili, 'PRODUCT_CODE')
  const ni = normalizeText(itemCode)
  const hasItemCodeMatch = qlisByIbx.some(qli => {
    const qliProductCode = getQLIProductCode(qli)
    if (!itemCode || !qliProductCode) return false
    const nq = normalizeText(qliProductCode)
    return ni.includes(nq) || nq.includes(ni)
  })
  if (hasItemCodeMatch) afterItemCode++
}

console.log('\n--- Match counts with quotation data (filters applied in order) ---')
console.log('  Total invoice rows:                    ', baseData.length)
console.log('  After PO filter (qli for this PO):     ', afterPO)
console.log('  After IBX/site filter (site matches):  ', afterIBX)
console.log('  After item code filter (code match):   ', afterItemCode)
console.log('\n  (Rows that pass all three can then go to price/quantity validation;')
console.log('   rows that pass PO+IBX but not item code fall back to description match.)')

// Run full validation and see how the "afterItemCode" rows are classified
const result = runValidation(baseData, quoteData, { priceTolerance: 0.05, qtyTolerance: 0.2 })
const results = result.validationResults || []

// Re-identify row indices that have item-code match (1-based row number)
const itemCodeMatchRows = new Set()
for (let i = 0; i < baseData.length; i++) {
  const ili = baseData[i]
  const po = getValue(ili, 'PO_NUMBER')
  if (!po || !po.trim()) continue
  const qlis = byPO[po.trim().toUpperCase()] || []
  if (qlis.length === 0) continue
  const ibx = getValue(ili, 'IBX')
  if (!ibx || !ibx.trim()) continue
  const qlisByIbx = qlis.filter(qli => {
    const site = getQLISiteId(qli)
    if (!site || !site.trim()) return false
    return site.toUpperCase().includes(ibx.trim().toUpperCase()) || ibx.trim().toUpperCase().includes(site.toUpperCase())
  })
  if (qlisByIbx.length === 0) continue
  const itemCode = getValue(ili, 'PRODUCT_CODE')
  const ni = normalizeText(itemCode)
  const hasMatch = qlisByIbx.some(qli => {
    const qc = getQLIProductCode(qli)
    if (!itemCode || !qc) return false
    const nq = normalizeText(qc)
    return ni.includes(nq) || nq.includes(ni)
  })
  if (hasMatch) itemCodeMatchRows.add(i + 1)
}

let passed = 0, failed = 0, skipped = 0
const skippedReasons = {}
for (const r of results) {
  if (!itemCodeMatchRows.has(r.row)) continue
  if (r.validation_result === 'Passed') passed++
  else if (r.validation_result === 'Failed') failed++
  else {
    skipped++
    const step = r.validation_step || '(empty)'
    skippedReasons[step] = (skippedReasons[step] || 0) + 1
  }
}

console.log('\n--- Of the ' + afterItemCode + ' rows with item-code match (all 3 filters) ---')
console.log('  Passed:    ', passed)
console.log('  Failed:    ', failed)
console.log('  Skipped:   ', skipped, '(no CUP / no quote qty / etc.)')
console.log('  Skipped breakdown:', skippedReasons)
