/**
 * Read validation_results_2026-03-04_filtered.xlsx and print failed rows
 * with ILI/QLI descriptions and remarks to diagnose description matching.
 */
import XLSX from 'xlsx'

const PATH = 'C:\\Users\\dnikh\\Downloads\\validation_results_2026-03-04_filtered.xlsx'

function main() {
  const wb = XLSX.readFile(PATH)
  const ws = wb.Sheets[wb.SheetNames[0]]
  const data = XLSX.utils.sheet_to_json(ws)
  const cols = data[0] ? Object.keys(data[0]) : []

  const iliDescKey = cols.find(c => c === 'ILI Description') || cols.find(c => /ili.*desc/i.test(c))
  const qliDescKey = cols.find(c => c === 'QLI Description') || cols.find(c => /qli.*desc/i.test(c))
  const statusKey = cols.find(c => c === 'Status') || cols.find(c => /status/i.test(c))
  const stepKey = cols.find(c => c === 'Validation Step') || cols.find(c => /validation.*step/i.test(c))
  const remarksKey = cols.find(c => c === 'Remarks') || cols.find(c => /remark/i.test(c))
  const rowKey = cols.find(c => c === 'Row') || cols.find(c => c === 'row')

  const failed = data.filter(r => {
    const s = (statusKey && r[statusKey]) ? String(r[statusKey]).toLowerCase() : ''
    return s === 'failed'
  })

  console.log('Total rows:', data.length)
  console.log('Failed rows:', failed.length)
  console.log('Column keys used: ILI Desc=', iliDescKey, 'QLI Desc=', qliDescKey, 'Status=', statusKey, 'Step=', stepKey)
  console.log('\n--- Failed rows: ILI Description | QLI Description | Validation Step | Remarks ---\n')

  failed.forEach((r, i) => {
    const ili = iliDescKey ? String(r[iliDescKey] ?? '').trim() : ''
    const qli = qliDescKey ? String(r[qliDescKey] ?? '').trim() : ''
    const step = stepKey ? String(r[stepKey] ?? '') : ''
    const rem = remarksKey ? String(r[remarksKey] ?? '') : ''
    const row = rowKey ? r[rowKey] : i + 1
    console.log(`[${row}] Step: ${step}`)
    console.log(`  ILI:  ${ili.slice(0, 120)}${ili.length > 120 ? '...' : ''}`)
    console.log(`  QLI:  ${qli.slice(0, 120)}${qli.length > 120 ? '...' : ''}`)
    console.log(`  Remarks: ${rem.slice(0, 150)}${rem.length > 150 ? '...' : ''}`)
    console.log('')
  })
}

try { main() } catch (e) { console.error(e); process.exit(1) }
