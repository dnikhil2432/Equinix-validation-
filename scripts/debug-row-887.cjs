/**
 * Debug row 887 - run validation and trace
 */
const XLSX = require('xlsx')
const path = require('path')

// Dynamic import for ESM module
async function main() {
  const { runValidation, validateILIAgainstQLIs, indexQuotesBySerialNumber } = await import('../src/validationLogic.js')

  const basePath = path.join(__dirname, '../public/InvoiceFile/Equinix ATT Billing Data extracts Dec-25 3.xlsx')
  const quotePath = path.join(__dirname, '../public/QuoteFile/quotation_data.xlsx')

  const wb = XLSX.readFile(basePath)
  const qb = XLSX.readFile(quotePath)
  const baseData = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]])
  const quoteData = XLSX.utils.sheet_to_json(qb.Sheets[qb.SheetNames[0]])

  const ili = baseData[886]
  const bySerial = indexQuotesBySerialNumber(quoteData)
  const serial = (ili.SERIAL_NUMBER || ili['Serial Number'] || '').toString().trim()
  const qlis = bySerial[serial.toUpperCase()] || []

  console.log('Row 887 ILI:')
  console.log('  UNIT_SELLING_PRICE:', ili.UNIT_SELLING_PRICE, ili['Unit Selling Price'])
  console.log('  QUANTITY:', ili.QUANTITY)
  console.log('  SERIAL:', serial)
  console.log('  QLIs for serial:', qlis.length)
  console.log('')

  const result = validateILIAgainstQLIs(ili, qlis, { priceTolerance: 0.05, qtyTolerance: 0.20 })

  console.log('validateILIAgainstQLIs result:', result.result)
  console.log('validationStep:', result.validationStep)
  console.log('remarks:', result.remarks)
  if (result.matchedQLI) {
    const q = result.matchedQLI
    console.log('Matched QLI MRC:', q.MRC, 'Quantity:', q.Quantity)
  }

  console.log('\n--- Full runValidation row 887 ---')
  const fullResult = runValidation(baseData, quoteData, { priceTolerance: 0.05, qtyTolerance: 0.20 })
  const r887 = fullResult.validationResults.find(r => r.row === 887)
  if (r887) {
    console.log('validation_result:', r887.validation_result)
    console.log('validation_step:', r887.validation_step)
    console.log('unit_price:', r887.unit_price)
    console.log('qli_cup:', r887.qli_cup)
    console.log('qli_unit_price:', r887.qli_unit_price)
    console.log('remarks:', r887.remarks)
  }
}

main().catch(e => console.error(e))
