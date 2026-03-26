/**
 * Run validation and print row 887 ILI + QLI values
 */
import XLSX from 'xlsx'
import { runValidation } from '../src/validationLogic.js'

const basePath = './public/InvoiceFile/Equinix ATT Billing Data extracts Dec-25 3.xlsx'
const quotePath = './public/QuoteFile/quotation_data.xlsx'

const wb = XLSX.readFile(basePath)
const qb = XLSX.readFile(quotePath)
const baseData = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]])
const quoteData = XLSX.utils.sheet_to_json(qb.Sheets[qb.SheetNames[0]])

const result = runValidation(baseData, quoteData, { priceTolerance: 0.05, qtyTolerance: 0.20 })
const row887 = result.validationResults.find(r => r.row === 887)

if (row887) {
  console.log('=== Row 887 Validation Result ===\n')
  console.log('--- ILI (Invoice) ---')
  console.log('  unit_price (UNIT_SELLING_PRICE):', row887.unit_price)
  console.log('  quantity:', row887.quantity)
  console.log('  lla (LINE_LEVEL_AMOUNT):', row887.lla)
  console.log('  serial_number:', row887.serial_number)
  console.log('  ibx:', row887.ibx)
  console.log('  ili_description:', (row887.ili_description || '').slice(0, 70))
  console.log('\n--- QLI (Quote) Matched ---')
  console.log('  qli_unit_price:', row887.qli_unit_price)
  console.log('  qli_cup (CUP used for validation):', row887.qli_cup)
  console.log('  qli_quantity:', row887.qli_quantity)
  console.log('  qli_description:', (row887.qli_description || '').slice(0, 70))
  console.log('\n--- Validation ---')
  console.log('  validation_result:', row887.validation_result)
  console.log('  validation_step:', row887.validation_step)
  console.log('  remarks:', row887.remarks)
  console.log('\n--- Unit Price Check ---')
  const cup = row887.qli_cup
  const up = row887.unit_price
  const cupWithTol = cup != null && !isNaN(cup) ? (cup * 1.05).toFixed(2) : 'N/A'
  console.log('  ILI unit price:', up)
  console.log('  QLI CUP:', cup)
  console.log('  CUP * (1 + 5%):', cupWithTol)
  console.log('  Passes if ILI UP <= CUP*1.05:', up != null && cup != null ? (up <= cup * 1.05 ? 'YES' : 'NO') : 'N/A')
} else {
  console.log('Row 887 not found in results')
}
