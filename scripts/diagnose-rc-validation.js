/**
 * Diagnose why no rate card validations pass. Loads prod invoice, quote, rate card;
 * runs validation and logs counts + sample remarks for rate card attempts.
 */
import XLSX from 'xlsx'
import { readFileSync } from 'fs'
import { runValidation } from '../src/validationLogic.js'
import { validateWithRateCard } from '../src/rateCardValidation.js'

const INVOICE_PATH = 'C:\\Users\\dnikh\\Downloads\\Equinix ATT Billing Data extracts Dec-25.xlsx'
const QUOTE_PATH = 'C:\\Users\\dnikh\\Downloads\\x_attm_doms_doms_quotation_line_items (5).xlsx'
const RATE_CARD_PATH = 'C:\\Users\\dnikh\\Downloads\\x_attm_doms_rate_card_data (4).xlsx'
const RATE_CARD_CONFIG_PATH = new URL('../public/rate-card-types.json', import.meta.url)

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

function sheetToJsonWithHeaderRow(worksheet) {
  const raw = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' })
  if (!raw.length) return []
  const headerRow = raw[0].map(h => (h != null ? String(h).trim() : ''))
  return raw.slice(1).map(row => {
    const obj = {}
    headerRow.forEach((h, i) => { if (h) obj[h] = row[i] })
    return obj
  })
}

function sheetToJsonRateCardWithUniqueHeaders(worksheet) {
  const raw = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' })
  if (!raw.length) return []
  const headerRow = raw[0].map(h => (h != null ? String(h).trim() : ''))
  const seen = new Map()
  const uniqueHeaders = headerRow.map((h, i) => {
    if (!h) return `Column_${i}`
    const count = (seen.get(h) || 0) + 1
    seen.set(h, count)
    return count === 1 ? h : `${h} (${count})`
  })
  return raw.slice(1).map(row => {
    const obj = {}
    uniqueHeaders.forEach((key, i) => { obj[key] = row[i] })
    return obj
  })
}

function loadSheet(path, options = {}) {
  const wb = XLSX.readFile(path)
  const ws = wb.Sheets[wb.SheetNames[0]]
  if (options.rateCard) {
    return normalizeSheetKeys(sheetToJsonRateCardWithUniqueHeaders(ws))
  }
  let data = XLSX.utils.sheet_to_json(ws)
  const defaultKeys = data.length > 0 ? Object.keys(data[0] || {}) : []
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
  const firstRowLen = (raw[0] || []).length
  const firstRowFilled = (raw[0] || []).filter(c => c != null && String(c).trim() !== '').length
  if (firstRowLen >= 5 && firstRowFilled > defaultKeys.length) {
    data = sheetToJsonWithHeaderRow(ws)
  }
  return normalizeSheetKeys(data)
}

function main() {
  console.log('Loading files...')
  const invoiceData = loadSheet(INVOICE_PATH)
  const quoteData = loadSheet(QUOTE_PATH)
  const rateCardData = loadSheet(RATE_CARD_PATH, { rateCard: true })
  const rateCardConfig = JSON.parse(readFileSync(RATE_CARD_CONFIG_PATH, 'utf8'))

  console.log('Invoice rows:', invoiceData.length, '| Columns (first 15):', Object.keys(invoiceData[0] || {}).slice(0, 15))
  console.log('Quote rows:', quoteData.length, '| Columns (first 12):', Object.keys(quoteData[0] || {}).slice(0, 12))
  console.log('Rate card rows:', rateCardData.length, '| Columns (first 15):', Object.keys(rateCardData[0] || {}).slice(0, 15))

  // Sample invoice row keys and key rate-card fields
  const firstInv = invoiceData[0] || {}
  console.log('\n--- Invoice first row (sample) ---')
  console.log('  PO_NUMBER:', firstInv['PO_NUMBER'] ?? firstInv['Po Number'] ?? '(key not found)')
  console.log('  IBX:', firstInv['IBX'] ?? '(key not found)')
  console.log('  DESCRIPTION:', (firstInv['DESCRIPTION'] || firstInv['Description'] || '').toString().slice(0, 60))
  console.log('  SERVICE_START_DATE:', firstInv['SERVICE_START_DATE'] ?? firstInv['Service Start Date'] ?? '(key not found)')
  console.log('  COUNTRY:', firstInv['COUNTRY'] ?? firstInv['Country'] ?? '(key not found)')
  console.log('  REGION:', firstInv['REGION'] ?? firstInv['Region'] ?? '(key not found)')

  console.log('\n--- Running full validation ---')
  const outcome = runValidation(invoiceData, quoteData, {
    rateCardData,
    rateCardConfig: Array.isArray(rateCardConfig) ? rateCardConfig : [rateCardConfig],
    priceTolerance: 0.05
  })

  const results = outcome.validationResults || []
  const skippedBeforeRc = results.filter(r => r.validation_result === 'Skipped' || r.validation_step?.includes('Rate Card'))
  const passed = results.filter(r => r.validation_result === 'Passed' && r.validation_step?.includes('Rate Card'))
  const failedRc = results.filter(r => r.validation_result === 'Failed' && r.validation_step?.includes('Rate Card'))
  const noMatchSkipped = results.filter(r => r.validation_step === 'Rate Card - No match / Skipped')

  console.log('Total lines:', outcome.totalLines)
  console.log('Passed (quote):', results.filter(r => r.validation_result === 'Passed' && !r.validation_step?.includes('Rate Card')).length)
  console.log('Failed (quote):', results.filter(r => r.validation_result === 'Failed' && !r.validation_step?.includes('Rate Card')).length)
  console.log('Skipped (for rate card) before RC:', results.filter(r => r.validation_result === 'Skipped').length)
  console.log('Rate Card - Passed:', passed.length)
  console.log('Rate Card - Failed:', failedRc.length)
  console.log('Rate Card - No match / Skipped:', noMatchSkipped.length)

  // Group remarks for "Rate Card - No match / Skipped" to see why
  const skippedIndices = results
    .map((r, i) => (r.validation_step === 'Rate Card - No match / Skipped' ? i : -1))
    .filter(i => i >= 0)
  const remarkCounts = {}
  skippedIndices.forEach(i => {
    const rem = (results[i].remarks || '').trim() || '(empty)'
    remarkCounts[rem] = (remarkCounts[rem] || 0) + 1
  })
  console.log('\n--- Rate Card "No match / Skipped" remarks (counts) ---')
  Object.entries(remarkCounts).sort((a, b) => b[1] - a[1]).forEach(([rem, count]) => console.log('  ', count, ':', rem.slice(0, 120)))

  // For first 3 Skipped lines, run validateWithRateCard manually and log result
  const forRcIndices = results
    .map((r, i) => (r.validation_result === 'Skipped' ? i : -1))
    .filter(i => i >= 0)
  console.log('\n--- Sample validateWithRateCard for first 3 "For Rate Card" lines ---')
  for (let idx = 0; idx < Math.min(3, forRcIndices.length); idx++) {
    const i = forRcIndices[idx]
    const ili = invoiceData[i]
    const res = validateWithRateCard(ili, rateCardData, rateCardConfig, { priceTolerance: 0.05 })
    console.log('  Row', i + 1, '| result:', res.result, '| remarks:', (res.remarks || '').slice(0, 150))
    console.log('    desc:', (ili?.DESCRIPTION || ili?.Description || '').toString().slice(0, 60))
    console.log('    service_start:', ili?.SERVICE_START_DATE ?? ili?.['Service Start Date'])
    console.log('    country/region:', ili?.COUNTRY ?? ili?.Country, '/', ili?.REGION ?? ili?.Region)
    console.log('    IBX:', ili?.IBX)
  }
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
