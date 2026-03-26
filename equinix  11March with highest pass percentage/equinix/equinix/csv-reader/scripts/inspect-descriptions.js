/**
 * Inspect invoice and quote descriptions to design a better matching algorithm.
 */
import XLSX from 'xlsx'

const INVOICE_PATH = 'C:\\Users\\dnikh\\Downloads\\Equinix ATT Billing Data extracts Dec-25 1 (1).xlsx'
const QUOTE_PATH = 'C:\\Users\\dnikh\\Downloads\\x_attm_doms_doms_quotation_line_items (5).xlsx'

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

function main() {
  const invWb = XLSX.readFile(INVOICE_PATH)
  const invWs = invWb.Sheets[invWb.SheetNames[0]]
  let invData = XLSX.utils.sheet_to_json(invWs)
  invData = normalizeSheetKeys(invData)

  const quoteWb = XLSX.readFile(QUOTE_PATH)
  const quoteWs = quoteWb.Sheets[quoteWb.SheetNames[0]]
  let quoteData = XLSX.utils.sheet_to_json(quoteWs)
  quoteData = normalizeSheetKeys(quoteData)

  const invDescKey = Object.keys(invData[0] || {}).find(k => /description|DESCRIPTION/i.test(k))
  const quoteDescKey = Object.keys(quoteData[0] || {}).find(k => /item description|Item Description/i.test(k))
  const quoteChangeKey = Object.keys(quoteData[0] || {}).find(k => /changed item description/i.test(k))

  console.log('Invoice desc column:', invDescKey)
  console.log('Quote Item Description column:', quoteDescKey)
  console.log('Quote Changed Item Description column:', quoteChangeKey)

  const invDescs = []
  const seenInv = new Set()
  for (const row of invData.slice(0, 2000)) {
    const d = row[invDescKey]
    const s = d != null ? String(d).trim() : ''
    if (s && s.length > 5 && !seenInv.has(s)) {
      seenInv.add(s)
      invDescs.push(s)
    }
  }
  console.log('\n--- Unique invoice descriptions (sample, first 50) ---')
  invDescs.slice(0, 50).forEach((d, i) => console.log(`${i + 1}. ${d}`))

  const quoteDescs = []
  const seenQuote = new Set()
  for (const row of quoteData) {
    const d = row[quoteDescKey] || row[quoteChangeKey]
    const s = d != null ? String(d).trim() : ''
    if (s && s.length > 5 && !seenQuote.has(s)) {
      seenQuote.add(s)
      quoteDescs.push(s)
    }
  }
  console.log('\n--- Unique quote descriptions (sample, first 80) ---')
  quoteDescs.slice(0, 80).forEach((d, i) => console.log(`${i + 1}. ${d}`))

  console.log('\n--- Invoice description patterns (first 30 full) ---')
  invDescs.slice(0, 30).forEach(d => console.log(d))

  console.log('\n--- Quote description patterns (first 30 full) ---')
  quoteDescs.slice(0, 30).forEach(d => console.log(d))
}

main().catch(e => console.error(e))
