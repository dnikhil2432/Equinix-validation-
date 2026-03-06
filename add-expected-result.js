/**
 * Adds expected_result column to Base_Test_Invoice.xlsx:
 * P = Passed validation, F = Failed validation (including Skipped/no match).
 */
import XLSX from 'xlsx'
import fs from 'fs'
import { runValidation } from './src/validationLogic.js'

const testDataDir = './test-data'
const basePath = `${testDataDir}/Base_Test_Invoice.xlsx`
const quotePath = `${testDataDir}/Quote_Test.xlsx`
const rateCardPath = `${testDataDir}/Rate_Card_Test.xlsx`
const configPath = './public/rate-card-types.json'

function sheetToJson(path) {
  const buf = fs.readFileSync(path)
  const wb = XLSX.read(buf, { type: 'buffer' })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  return XLSX.utils.sheet_to_json(sheet)
}

const baseData = sheetToJson(basePath)
const quoteData = sheetToJson(quotePath)
const rateCardData = sheetToJson(rateCardPath)
const rateCardConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'))

const result = runValidation(baseData, quoteData, {
  priceTolerance: 0.05,
  qtyTolerance: 0.2,
  rateCardData,
  rateCardConfig
})

function toExpectedResult(validationResult) {
  return validationResult === 'Passed' ? 'P' : 'F'
}

for (let i = 0; i < baseData.length; i++) {
  const vr = result.validationResults[i]?.validation_result ?? 'Skipped'
  baseData[i].expected_result = toExpectedResult(vr)
}

const ws = XLSX.utils.json_to_sheet(baseData)
const wb = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
XLSX.writeFile(wb, basePath)

console.log('Added expected_result to', basePath)
console.log('  Total:', result.totalLines, '| P:', result.passedCount, '| F:', result.failedCount + (result.totalLines - result.passedCount - result.failedCount))
