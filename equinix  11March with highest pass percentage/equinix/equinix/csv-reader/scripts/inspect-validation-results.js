/**
 * Inspect validation results Excel: columns, sample rows, rate card rows and description matching.
 */
import XLSX from 'xlsx'

const PATH = 'C:\\Users\\dnikh\\Downloads\\validation_results_2026-03-03_filtered (1).xlsx'

function main() {
  const wb = XLSX.readFile(PATH)
  console.log('Sheets:', wb.SheetNames)
  const ws = wb.Sheets[wb.SheetNames[0]]
  const data = XLSX.utils.sheet_to_json(ws)
  console.log('Rows:', data.length)
  console.log('Columns:', data[0] ? Object.keys(data[0]) : [])

  const cols = data[0] ? Object.keys(data[0]) : []
  const hasDesc = cols.some(c => /description|Description|DESCRIPTION/i.test(c))
  const hasRemarks = cols.some(c => /remark/i.test(c))
  const hasStep = cols.some(c => /step|validation/i.test(c))
  const hasRc = cols.some(c => /rc_|rate.card|RC /i.test(c))
  console.log('\nRelevant column names (desc, remarks, step, rc):', {
    desc: cols.filter(c => /description|Description|DESCRIPTION/i.test(c)),
    remarks: cols.filter(c => /remark/i.test(c)),
    step: cols.filter(c => /step|validation/i.test(c)),
    rc: cols.filter(c => /rc_|rate|RC /i.test(c))
  })

  // Find exact key for ILI description and remarks
  const iliDescKey = cols.find(c => /^ILI.*[Dd]esc|^.*ili_description/i.test(c)) || cols.find(c => c === 'ILI Description' || c === 'ili_description')
  const remarksKey = cols.find(c => /[Rr]emarks/.test(c))
  const stepKey = cols.find(c => /[Vv]alidation [Ss]tep|validation_step/.test(c))
  const rcSubTypeKey = cols.find(c => /RC Sub Type|rc_u_rate_card_sub_type/.test(c))
  const rcGoodsKey = cols.find(c => /goods.services|RC u_goods|rc_u_goods/.test(c))

  console.log('\nKey for ILI desc:', iliDescKey)
  console.log('Key for remarks:', remarksKey)
  console.log('Key for validation step:', stepKey)
  console.log('Key for RC sub type:', rcSubTypeKey)

  const rcRows = data.filter(r => {
    const step = (stepKey && r[stepKey]) ? String(r[stepKey]) : ''
    return /rate.card|Rate Card/i.test(step)
  })
  console.log('\nRows with Rate Card in validation step:', rcRows.length)

  console.log('\n--- Sample of 15 Rate Card rows (description, step, remarks, RC Sub Type) ---')
  rcRows.slice(0, 15).forEach((r, i) => {
    const desc = iliDescKey ? (r[iliDescKey] ?? '') : (r['ILI Description'] ?? r['ili_description'] ?? '')
    const rem = remarksKey ? (r[remarksKey] ?? '') : ''
    const step = stepKey ? (r[stepKey] ?? '') : ''
    const rcSub = rcSubTypeKey ? (r[rcSubTypeKey] ?? '') : ''
    const rcGoods = rcGoodsKey ? (r[rcGoodsKey] ?? '') : ''
    console.log(`${i + 1}. Step: ${String(step).slice(0, 50)}`)
    console.log(`   ILI Desc: ${String(desc).slice(0, 70)}`)
    console.log(`   RC Sub Type: ${rcSub} | RC goods: ${String(rcGoods).slice(0, 30)}`)
    console.log(`   Remarks: ${String(rem).slice(0, 100)}`)
    console.log('')
  })

  // Count by validation step for rate card
  const stepCounts = {}
  rcRows.forEach(r => {
    const step = stepKey ? String(r[stepKey] || '') : ''
    stepCounts[step] = (stepCounts[step] || 0) + 1
  })
  console.log('--- Rate Card validation step counts ---')
  Object.entries(stepCounts).sort((a, b) => b[1] - a[1]).forEach(([s, c]) => console.log(' ', c, ':', s.slice(0, 60)))
}

main().catch(e => console.error(e))
