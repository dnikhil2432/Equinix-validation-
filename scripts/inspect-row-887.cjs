/**
 * Read row 887 ILI and matching QLIs - no validation import
 */
const XLSX = require('xlsx')

const basePath = './public/InvoiceFile/Equinix ATT Billing Data extracts Dec-25 3.xlsx'
const quotePath = './public/QuoteFile/quotation_data.xlsx'

const wb = XLSX.readFile(basePath)
const qb = XLSX.readFile(quotePath)
const baseData = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]])
const quoteData = XLSX.utils.sheet_to_json(qb.Sheets[qb.SheetNames[0]])

const getVal = (r, k) => {
  const v = r[k]
  return (v != null && v !== '') ? String(v).trim() : ''
}
const getNum = (r, k) => {
  const v = r[k]
  if (v == null || v === '') return NaN
  return parseFloat(String(v).replace(/[$,]/g, ''))
}

const ili = baseData[886]
const serial = getVal(ili, 'SERIAL_NUMBER') || getVal(ili, 'Serial Number') || ''
const ibx = getVal(ili, 'IBX') || ''

// Index QLIs by serial (same as validationLogic)
const bySerial = {}
quoteData.forEach(q => {
  const s = (getVal(q, 'Serial Number') || getVal(q, 'serial_number') || getVal(q, 'SERIAL_NUMBER') || '').trim().toUpperCase()
  if (!s) return
  if (!bySerial[s]) bySerial[s] = []
  bySerial[s].push(q)
})

const qlis = bySerial[serial.toUpperCase()] || []
// Filter by IBX/site
const qlisByIbx = qlis.filter(q => {
  const site = (getVal(q, 'Site Id') || getVal(q, 'site_id') || '').trim()
  if (!site) return false
  return site.toUpperCase().includes(ibx.toUpperCase()) || ibx.toUpperCase().includes(site.toUpperCase())
})

console.log('=== Row 887 ILI (Invoice Line Item) ===\n')
console.log('  UNIT_SELLING_PRICE:', getNum(ili, 'UNIT_SELLING_PRICE'))
console.log('  QUANTITY:', getNum(ili, 'QUANTITY'))
console.log('  LINE_LEVEL_AMOUNT:', getNum(ili, 'LINE_LEVEL_AMOUNT'))
console.log('  SERIAL_NUMBER:', serial)
console.log('  IBX:', ibx)
console.log('  DESCRIPTION:', (getVal(ili, 'DESCRIPTION') || '').slice(0, 80))

console.log('\n=== QLIs for this serial + IBX (' + qlisByIbx.length + ' matches) ===\n')
qlisByIbx.forEach((q, i) => {
  const mrc = getNum(q, 'MRC')
  const otc = getNum(q, 'OTC')
  const nrc = getNum(q, 'NRC')
  const up = getNum(q, 'UP')
  const qty = getNum(q, 'Quantity')
  const unitPrice = !isNaN(mrc) && mrc !== 0 ? mrc : (!isNaN(otc) && otc !== 0 ? otc : (!isNaN(nrc) ? nrc : up))
  console.log('  QLI', i + 1, ':')
  console.log('    Quantity:', qty)
  console.log('    MRC:', mrc, '| OTC:', otc, '| NRC:', nrc, '| UP:', up)
  console.log('    Unit price (MRC/OTC/NRC/UP):', unitPrice)
  console.log('    Item Description:', (getVal(q, 'Item Description') || '').slice(0, 60))
  console.log('    ---')
})

console.log('\n=== Unit price validation logic ===')
console.log('  ILI unit price must be <= CUP * (1 + 5%) to pass')
console.log('  CUP = Current Unit Price from QLI (date-based from getCUP)')
console.log('  If ILI UP > CUP*1.05 → FAIL (Unit price)')
console.log('  If ILI UP <= CUP*1.05 → unit price passes')
