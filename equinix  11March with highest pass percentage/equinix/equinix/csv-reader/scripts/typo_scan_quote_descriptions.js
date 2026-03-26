import fs from 'fs'
import XLSX from 'xlsx'

function collectPhrases(obj, out) {
  if (!obj || typeof obj !== 'object') return
  for (const k of Object.keys(obj)) {
    out.add(k)
    collectPhrases(obj[k], out)
  }
}

function levenshtein(a, b) {
  if (a === b) return 0
  const m = a.length
  const n = b.length
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))
  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      )
    }
  }
  return dp[m][n]
}

function buildVocabulary(tokensJsonPath) {
  const tokens = JSON.parse(fs.readFileSync(tokensJsonPath, 'utf8'))
  const phrases = new Set()
  collectPhrases(tokens, phrases)

  const wordSet = new Set()
  for (const p of phrases) {
    for (const w of String(p).split(/[^A-Za-z]+/).filter(Boolean)) {
      wordSet.add(w.toLowerCase())
    }
  }

  // Extra domain words that appear often but may not be in tokens.json
  for (const w of [
    'equinix', 'fabric', 'virtual', 'local', 'connection', 'cross', 'connect',
    'aws', 'direct', 'capacity', 'recurring', 'charge', 'network', 'cable',
    'metro', 'remote', 'global', 'router', 'port', 'installation', 'fee',
    'expressroute', 'express', 'route', 'azure'
  ]) wordSet.add(w)

  return { wordSet, dict: [...wordSet] }
}

function suggest(word, dict) {
  let best = null
  let bestD = 99
  for (const cand of dict) {
    const d = levenshtein(word, cand)
    if (d < bestD) {
      bestD = d
      best = cand
      if (bestD === 1) break
    }
  }
  return bestD <= 2 ? { best, dist: bestD } : null
}

function main() {
  const xlsxPath = process.argv[2]
  const tokensJsonPath = process.argv[3]
  if (!xlsxPath || !tokensJsonPath) {
    console.error('Usage: node typo_scan_quote_descriptions.js <quotation_data.xlsx> <tokens.json>')
    process.exit(2)
  }

  const { wordSet, dict } = buildVocabulary(tokensJsonPath)

  const stop = new Set([
    'the', 'and', 'for', 'with', 'from', 'to', 'of', 'in', 'on', 'at', 'by', 'a', 'an', 'or', 'as', 'is', 'are',
    'gbps', 'mbps', 'nrc', 'mrc', 'otc', 'tr'
  ])

  const wb = XLSX.readFile(xlsxPath, { cellDates: false })

  let totalRows = 0
  const typoCounts = new Map()
  const examples = new Map()
  const sheetInfo = []

  for (const sh of wb.SheetNames) {
    const ws = wb.Sheets[sh]
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' })
    if (!rows.length) continue

    const cols = Object.keys(rows[0] ?? {})
    const descCols = cols.filter((c) => /desc/i.test(String(c)))
    if (!descCols.length) continue

    sheetInfo.push({ sheet: sh, descCols, rows: rows.length })

    for (const r of rows) {
      totalRows++
      for (const c of descCols) {
        const txt = String(r[c] ?? '')
        if (!txt) continue

        const words = txt
          .split(/[^A-Za-z]+/)
          .filter(Boolean)
          .map((w) => w.toLowerCase())

        for (const w of words) {
          if (w.length < 5) continue
          if (stop.has(w)) continue
          if (wordSet.has(w)) continue

          const s = suggest(w, dict)
          if (!s) continue

          const key = `${w}->${s.best}`
          typoCounts.set(key, (typoCounts.get(key) ?? 0) + 1)
          if (!examples.has(key)) examples.set(key, txt.slice(0, 220))
        }
      }
    }
  }

  const top = [...typoCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 50)

  console.log('Sheets with description columns:')
  for (const s of sheetInfo) {
    console.log(`- ${s.sheet}: descCols=[${s.descCols.join(', ')}] rows=${s.rows}`)
  }
  console.log('')
  console.log('Total rows scanned (rows in sheets that have a desc column):', totalRows)
  console.log('')
  console.log('Top suspected typos (word -> suggestion):')
  for (const [k, count] of top) {
    const [from, to] = k.split('->')
    console.log(`- ${from} -> ${to} (count ${count}) example: ${examples.get(k)}`)
  }
}

main()

