import { parseDate } from '../src/rateCardValidation.js'

const FROM = '2025-04-01'
const TILL = '2026-03-31'

const from = parseDate(FROM)
const till = parseDate(TILL)
console.log('Window from:', from?.toISOString(), 'till:', till?.toISOString())

const serials = [45597, 45748, 45901, 45967, 45992]
for (const s of serials) {
  const d = parseDate(s)
  const inWindow = d && d.getTime() >= from.getTime() && d.getTime() <= till.getTime()
  console.log('Serial', s, '->', d?.toISOString?.()?.slice(0, 10), 'inWindow:', inWindow)
}
