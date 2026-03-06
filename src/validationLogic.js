/**
 * Validation logic for Invoice Line Items (ILI) vs Quote Line Items (QLI).
 * Two-file mode: Base file (Invoice) + Quote file (QLI).
 * Charge description matching uses CD Validation (tokens.json + valueTokens.json): parseSentence + Jaccard on contains and value_matches.
 */
import { validateWithRateCard, formatDateForDisplay } from './rateCardValidation.js'
import { calculateCDSimilarity, parseSentence as parseSentenceCD } from './cdValidationParser.js'


const QLI_PO_VARIANTS = "Po Number"
const QLI_SITE_VARIANTS = "Site Id"
const QLI_PRODUCT_CODE_VARIANTS = "Item Code"
const QLI_CHARGE_DESC_VARIANTS = "Item Description"
const QLI_CHANGE_DESC_VARIANTS = "Changed Item Description"
const QLI_QTY_VARIANTS = "Quantity"
const QLI_UNIT_PRICE_VARIANTS = ['OTC', 'MRC']
const QLI_CURRENCY_VARIANTS = ['Currency', 'currency', 'CURR']

/** Get expected result from base row (invoice). Reads "Expected Match" column (Y→P, N→F) and displays as P/F in UI. */
function getExpectedResultFromBaseRow(row) {
  if (!row || typeof row !== 'object') return ''
  let raw = ''
  for (const key in row) {
    const normalized = key.replace(/[\s_\-]/g, '').toLowerCase()
    if (normalized === 'expectedmatch') {
      const val = row[key]
      if (val != null && val !== '') {
        raw = ('' + val).trim()
      }
      break
    }
  }
  if (!raw) return ''
  const first = raw[0]?.toUpperCase()
  return first === 'Y' ? 'P' : first === 'N' ? 'F' : ''
}

function getValue(row, key) {
  if (!row || key == null) return ''
  if (Array.isArray(key)) {
    for (const k of key) {
      const v = getValue(row, k)
      if (v !== '') return v
    }
    return ''
  }
  const val = row[key]
  return (val != null && val !== '') ? String(val).trim() : ''
}

function getNumeric(row, key) {
  if (!row || key == null) return NaN
  if (Array.isArray(key)) {
    for (const k of key) {
      const v = getNumeric(row, k)
      if (!isNaN(v)) return v
    }
    return NaN
  }
  const val = row[key]
  if (val == null || val === '') return NaN
  const cleaned = String(val).replace(/[$,]/g, '')
  return parseFloat(cleaned)
}

function parseDate(s) {
  if (!s) return null
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d
}

function normalizeText(text) {
  if (!text || text === '' || text === null || text === undefined) return ''
  return text.toString()
    .replace(/[^a-zA-Z0-9]/g, '')
    .replace(/[\s,]+/g, ' ')
    .trim()
    .toLowerCase()
}

/**
 * Quote description matching: CD Validation (tokens.json + valueTokens.json).
 * parseSentence extracts key phrases (contains) and value matches (e.g. "10 Gbps", "55 kVA").
 * Similarity = (Jaccard(contains) + Jaccard(value_matches)) / 2; pass if >= 80.
 */

/** Format parsed CD tokens for UI display (contains + value_matches). */
function formatCDTokensForDisplay(parsed) {
  if (!parsed || (!parsed.contains?.length && !parsed.value_matches?.length)) return ''
  const parts = []
  if (parsed.contains?.length) parts.push([...parsed.contains].join(', '))
  if (parsed.value_matches?.length) parts.push([...parsed.value_matches].join(', '))
  return parts.join('; ')
}

function descriptionMatchScore(iliDesc, qliDesc) {
  if (!qliDesc || String(qliDesc).trim().length < 2) return { passes: false, matchCount: 0 }
  const s1 = String(iliDesc ?? '').trim()
  const s2 = String(qliDesc ?? '').trim()
  if (!s1 || !s2) return { passes: false, matchCount: 0 }
  const { score, passes } = calculateCDSimilarity(s1, s2)
  return { passes, matchCount: score }
}

/**
 * Get all string values from a row that could be descriptions (for fallback when header is unknown).
 * Skips empty, pure numbers, and very short values.
 */
function getPossibleDescValuesFromRow(row) {
  if (!row || typeof row !== 'object') return []
  const out = []
  for (const val of Object.values(row)) {
    const s = val != null ? String(val).trim() : ''
    if (s.length < 3) continue
    if (/^\d+([.,]\d+)?$/.test(s.replace(/[$,\s]/g, ''))) continue
    out.push(s)
  }
  return [...new Set(out)]
}

/**
 * Score QLI description(s) against ILI description using product-core + significant-word matching.
 * Returns { passes, matchCount }: passes if best score passes; matchCount = best score (0–100).
 */
function getDescMatchScore(iliDesc, qliChargeDesc, qliChangeDesc) {
  let bestMatchCount = 0
  let passes = false
  function scoreOne(qliDesc) {
    if (!qliDesc) return { passes: false, matchCount: 0 }
    return descriptionMatchScore(iliDesc, qliDesc)
  }
  const charge = scoreOne(qliChargeDesc)
  const change = scoreOne(qliChangeDesc)
  if (charge.matchCount > bestMatchCount) {
    bestMatchCount = charge.matchCount
    passes = charge.passes
  }
  if (change.matchCount > bestMatchCount) {
    bestMatchCount = change.matchCount
    passes = change.passes
  }
  return { passes, matchCount: bestMatchCount }
}

/**
 * Current Unit Price (CUP) of QLI based on date rules.
 * Uses invoice_date from the base/invoice file (ILI) as the reference date; invoice start from ILI; initialTermMonths from ILI; initialTermIncrement from QLI.
 * If invoice_date < invoice_start_date: use Unit Price (assumption: same as initial).
 * If invoice_date < invoice_start_date + initial_term: CUP = Unit Price of QLI
 * If (invoice_date >= invoice_start_date + initial_term) AND (invoice_date < invoice_start_date + initial_term + term): CUP = Unit Price * (1+initialTermIncrement)
 * If invoice_date >= invoice_start_date + initial_term + term: CUP = Unit Price * (1+initialTermIncrement) * (1+Increment)^num_completed_terms
 */
function getCUP(quoteItem, ili) {
  const unitPrice = getNumeric(quoteItem, QLI_UNIT_PRICE_VARIANTS)
  if (!(unitPrice > 0)) return NaN

  const invoiceDate = parseDate(getValue(ili, "RECURRING_CHARGE_TO_DATE"))
  const serviceStart = parseDate(getValue(ili, "SERVICE_START_DATE"))
  if (!serviceStart || !invoiceDate) return Math.round(unitPrice * 100) / 100

  const initialTermMonthsRaw = getNumeric(ili, "FIRST_PRICE_INC_APP_AFTER")
  const renewalTermMonthsRaw = getNumeric(ili, "RENEWAL_TERM")
  const incrementPctRaw = getNumeric(ili, "PRICE_INCREASE_PERCENTAGE")

  const initialTermMonths = initialTermMonthsRaw > 0 ? initialTermMonthsRaw : 12
  const renewalTermMonths = renewalTermMonthsRaw > 0 ? renewalTermMonthsRaw : 12
  const incrementRate = (incrementPctRaw || 0) / 100

  let result

  if (invoiceDate < serviceStart) {
    result = unitPrice
  } else {
    const endInitial = addMonths(serviceStart, initialTermMonths)

    if (invoiceDate < endInitial) {
      result = unitPrice
    } else {
      const endFirstRenewal = addMonths(endInitial, renewalTermMonths)

      if (invoiceDate < endFirstRenewal) {
        result = unitPrice * (1 + incrementRate)
      } else {
        const completedTerms = getCompletedTerms(invoiceDate, endInitial, renewalTermMonths)
        result = unitPrice * Math.pow(1 + incrementRate, completedTerms + 1)
      }
    }
  }
  return result > 0 ? Math.round(result * 100) / 100 : NaN
}

function getCompletedTerms(invoiceDate, endInitial, termMonths) {
  if (!invoiceDate || !endInitial || termMonths <= 0) return 0
  if (invoiceDate < endInitial) return 0

  // Calculate total month difference
  const yearDiff = invoiceDate.getFullYear() - endInitial.getFullYear()
  const monthDiff = invoiceDate.getMonth() - endInitial.getMonth()
  let totalMonths = yearDiff * 12 + monthDiff

  // Adjust if day-of-month hasn't been reached yet
  if (invoiceDate.getDate() < endInitial.getDate()) {
    totalMonths -= 1
  }

  return Math.floor(totalMonths / termMonths)
}

function addMonths(date, months) {
  const d = new Date(date)
  d.setMonth(d.getMonth() + months)
  return d
}

/**
 * Prorata factor: (billing_till - billing_from) / total_days_in_month.
 * Returns 1 if billing_from/billing_till missing or invalid.
 */
export function getPF(ili, billingFrom, billingTill) {
  const from = parseDate(billingFrom) || parseDate(getValue(ili, "RECURRING_CHARGE_FROM_DATE"))
  const till = parseDate(billingTill) || parseDate(getValue(ili, "RECURRING_CHARGE_TO_DATE"))
  if (!from || !till) return 1
  const daysInMonth = new Date(from.getFullYear(), from.getMonth() + 1, 0).getDate()
  const days = Math.max(0, (till - from) / (24 * 60 * 60 * 1000)) + 1
  return Math.min(1, days / daysInMonth)
}

/**
 * Get PO number for an ILI (from line or invoice mapping). In 2-file mode, PO is on the line.
 */
export function getQLIPO(qli) {
  return getValue(qli, QLI_PO_VARIANTS)
}

export function getQLISiteId(qli) {
  const v = getValue(qli, QLI_SITE_VARIANTS)
  if (v) return v
  return getValue(qli, 'site_id')
}

export function getQLIProductCode(qli) {
  return getValue(qli, QLI_PRODUCT_CODE_VARIANTS)
}

export function getQLIChargeDesc(qli) {
  return getValue(qli, QLI_CHARGE_DESC_VARIANTS)
}

export function getQLIChangeDesc(qli) {
  return getValue(qli, QLI_CHANGE_DESC_VARIANTS)
}

export function getQLIQuantity(qli) {
  return getNumeric(qli, QLI_QTY_VARIANTS)
}

/**
 * Index quote data by PO for fast lookup.
 * Excludes QLI rows where both MRC and OTC are empty (such rows are not used for validation).
 */
export function indexQuotesByPO(quoteData) {
  const byPO = {}
  for (const row of quoteData || []) {
    const po = getValue(row, "Po Number")
    if (!po) continue
    const otc = getNumeric(row, 'OTC')
    const mrc = getNumeric(row, 'MRC')
    // Exclude rows that have no usable quote unit price:
    // - both MRC and OTC missing, OR
    // - both MRC and OTC are 0 (or <= 0)
    const hasOtc = !isNaN(otc) && otc > 0
    const hasMrc = !isNaN(mrc) && mrc > 0
    if (!hasOtc && !hasMrc) continue
    const key = po.toUpperCase()
    if (!byPO[key]) byPO[key] = []
    byPO[key].push(row)
  }
  return byPO
}

/**
 * Single ILI validation against a list of QLIs (already filtered by PO; PO filter is never skipped in caller).
 * IBX filter is mandatory and never skipped: ILI must have IBX and QLIs must match site_id.
 * Flow: 1) Filter by IBX/site_id (required) → if ILI has no IBX or no matching QLIs, rate card. 2) Item code or description: prefer item-code match; if found, use that QLI for unit price validation; else use best description match. 3) Unit price (and LLA, quantity) validation.
 * Returns { result, remarks, matchedQLI, validationStep }.
 * result: 'validated' | 'failed' | null (send to rate card validation)
 * validationStep: which step passed/failed (e.g. 'Quote - Passed', 'Quote - Failed (Unit price)').
 */
export function validateILIAgainstQLIs(ili, qlis, options) {
  const {
    priceTolerance = 0.05,
    qtyTolerance = 0.20,
    today = new Date()
  } = options || {}

  const ibx = getValue(ili, "IBX") || ''
  const itemCode = getValue(ili, "PRODUCT_CODE") || ''
  const chargeDesc = getValue(ili, "DESCRIPTION") || ''
  let quantity = getNumeric(ili, "QUANTITY")
  let unitPrice = getNumeric(ili, "UNIT_SELLING_PRICE")
  let lla = getNumeric(ili, "LINE_LEVEL_AMOUNT")
  

  if (isNaN(quantity)) quantity = 0
  if (isNaN(unitPrice)) unitPrice = NaN
  if (isNaN(lla)) lla = NaN

  // If Unit Price missing but LLA & Quantity present: Unit Price = LLA / Quantity (skip when both are zero)
  if ((isNaN(unitPrice) || unitPrice === 0) && !isNaN(lla) && quantity > 0 && lla !== 0) {
    unitPrice = lla / quantity
  }

  let llaCalculated = false
  // Edge case: if LLA is empty or 0 but unit price is present and not 0, derive LLA = unit_price * quantity
  if ((lla === 0 || isNaN(lla)) && !isNaN(unitPrice) && unitPrice !== 0 && quantity > 0) {
    lla = unitPrice * quantity
    llaCalculated = true
  }

  // --- IBX filter (mandatory, never skipped): ILI must have IBX; QLI site_id must match ILI IBX ---
  const ibxTrimmed = ibx != null ? String(ibx).trim() : ''
  if (!ibxTrimmed) {
    return { result: null, remarks: 'ILI has no IBX; cannot match quote by site.', matchedQLI: null, validationStep: 'Quote - No match (No IBX on ILI)' }
  }

  const qlisByIbx = (qlis || []).filter(qli => {
    const qliSite = getQLISiteId(qli)
    const siteTrimmed = qliSite != null ? String(qliSite).trim() : ''
    if (!siteTrimmed) return false
    return siteTrimmed.toUpperCase().includes(ibxTrimmed.toUpperCase())||ibxTrimmed.toUpperCase().includes(siteTrimmed.toUpperCase())
  })

  if (qlisByIbx.length === 0) {
    return { result: null, remarks: 'No QLI with matching site_id/IBX for this PO.', matchedQLI: null, validationStep: 'Quote - No match (No IBX/site_id)' }
  }

  // --- Currency filter (before charge description): only QLIs whose currency matches ILI CURR ---
  const iliCurr = getValue(ili, ['CURR', 'curr', 'currency'])
  const iliCurrNorm = iliCurr != null ? String(iliCurr).trim().toUpperCase() : ''
  let qlisForMatch = qlisByIbx
  if (iliCurrNorm) {
    qlisForMatch = qlisByIbx.filter(qli => {
      const qliCurr = getValue(qli, QLI_CURRENCY_VARIANTS)
      const qliCurrNorm = qliCurr != null ? String(qliCurr).trim().toUpperCase() : ''
      return qliCurrNorm === iliCurrNorm
    })
  }
  if (qlisForMatch.length === 0) {
    return { result: null, remarks: 'No QLI with matching currency (CURR) for this PO/IBX.', matchedQLI: null, validationStep: 'Quote - No match (Currency)' }
  }

  // --- Item code match: collect QLIs that match by item code (with description match count for tie-break) ---
  const itemCodeMatches = []
  for (const qli of qlisForMatch) {
    const qliProductCode = getQLIProductCode(qli)
    if (!itemCode || !qliProductCode) continue
    const ni = normalizeText(itemCode)
    const nq = normalizeText(qliProductCode)
    if (ni.includes(nq) || nq.includes(ni)) {
      const descScore = getDescMatchScore(chargeDesc, getQLIChargeDesc(qli), getQLIChangeDesc(qli))
      itemCodeMatches.push({ qli, matchCount: descScore.matchCount })
    }
  }

  // Run price/LLA/quantity validation for one QLI; returns result object.
  function validateWithQLI(qli) {
    if (unitPrice === 0 && lla === 0 ||unitPrice==''&& lla==''||isNaN(unitPrice)&&isNaN(lla)) {
      return { result: 'validated', remarks: 'Unit Price and LLA are zero; no charge.', matchedQLI: qli, validationStep: 'Quote - Passed (No charge)', effectiveLla: 0, llaCalculated, ella: NaN }
    }
    const cup = getCUP(qli, ili)
    const cup_within_tolerance_raw = cup * (1 + priceTolerance)
    const cup_within_tolerance = Math.round(cup_within_tolerance_raw * 100) / 100
    if (isNaN(cup) || cup <= 0) {
      return { result: 'failed', remarks: 'No valid quote unit price (CUP) for date.', matchedQLI: qli, validationStep: 'Quote - Failed (No CUP)', effectiveLla: lla, llaCalculated, ella: NaN }
    }
    const pf = getPF(ili)
    // Before comparing: if PF < 1, normalize unit price and LLA so that PF * (1/PF) = 1 (full-period equivalent)
    const normFactor = pf > 0 && pf < 1 ? 1 / pf : 1
    const unitPriceForCompare = normFactor === 1 ? unitPrice : (isNaN(unitPrice) ? unitPrice : unitPrice * normFactor)
    const llaForCompare = normFactor === 1 ? lla : (isNaN(lla) ? lla : lla * normFactor)
    if (unitPriceForCompare > cup_within_tolerance) {
      const ella = cup * quantity * pf
      return { result: 'failed', remarks: `Unit price ${unitPrice.toFixed(2)} exceeds CUP*(1+tolerance)=${cup_within_tolerance}`, matchedQLI: qli, validationStep: 'Quote - Failed (Unit price)', effectiveLla: lla, llaCalculated, ella }
    }
    const qtyILI = quantity
    const ella = cup * qtyILI * pf
    if (!isNaN(llaForCompare) && llaForCompare > ella * (1 + priceTolerance)) {
      return { result: 'failed', remarks: `LLA ${lla.toFixed(2)} exceeds ELLA*(1+tolerance)=${(ella * (1 + priceTolerance)).toFixed(2)}`, matchedQLI: qli, validationStep: 'Quote - Failed (LLA)', effectiveLla: lla, llaCalculated, ella }
    }
    const qliQty = getQLIQuantity(qli)
    if (isNaN(qliQty) || qliQty <= 0) {
      return { result: 'failed', remarks: 'No quote quantity on matched QLI.', matchedQLI: qli, validationStep: 'Quote - Failed (No quote quantity)', effectiveLla: lla, llaCalculated, ella }
    }
    if (qtyILI > qliQty * (1 + qtyTolerance)) {
      return { result: 'failed', remarks: `Quantity ${qtyILI} exceeds quote quantity ${qliQty} * (1+${(qtyTolerance * 100).toFixed(0)}%)`, matchedQLI: qli, validationStep: 'Quote - Failed (Quantity)', effectiveLla: lla, llaCalculated, ella }
    }
    return { result: 'validated', remarks: 'All validations passed.', matchedQLI: qli, validationStep: 'Quote - Passed', effectiveLla: lla, llaCalculated, ella }
  }

  let selectedQLI = null
  if (itemCodeMatches.length > 0) {
    // Use item-code match: take the one with best description match count for tie-break
    let best = itemCodeMatches[0]
    for (let i = 1; i < itemCodeMatches.length; i++) {
      if (itemCodeMatches[i].matchCount > best.matchCount) best = itemCodeMatches[i]
    }
    // In quotation validation desc match must be > 60% else ILI goes to rate card validation
    if (best.matchCount > 90) {
      selectedQLI = best.qli
    }
  } else {
    // No item-code match: use filtered list by PO, IBX and currency (qlisForMatch). If ILI has no item code, do charge description matching only with QLI rows that have empty item code.
    if (!itemCode || String(itemCode).trim() === '') {
      const qlisWithEmptyItemCode = qlisForMatch.filter(qli => {
        const qc = getQLIProductCode(qli)
        return !qc || String(qc).trim() === ''
      })
      const descCandidates = []
      for (const qli of qlisWithEmptyItemCode) {
        const qliChargeDesc = getQLIChargeDesc(qli)
        const qliChangeDesc = getQLIChangeDesc(qli)
        let descScore = getDescMatchScore(chargeDesc, qliChargeDesc, qliChangeDesc)
        if (!descScore.passes && chargeDesc && !qliChargeDesc && !qliChangeDesc) {
          const possibleDescs = getPossibleDescValuesFromRow(qli)
          let bestFallback = { passes: false, matchCount: 0 }
          for (const candidate of possibleDescs) {
            const s = getDescMatchScore(chargeDesc, candidate, '')
            if (s.passes && s.matchCount > bestFallback.matchCount) bestFallback = s
          }
          if (bestFallback.passes) descScore = bestFallback
        }
        if (!descScore.passes) continue
        descCandidates.push({ qli, matchCount: descScore.matchCount })
      }
      if (descCandidates.length > 0) {
        let best = descCandidates[0]
        for (let i = 1; i < descCandidates.length; i++) {
          if (descCandidates[i].matchCount > best.matchCount) best = descCandidates[i]
        }
        selectedQLI = best.qli
      }
    }
  }

  if (!selectedQLI) {
    return { result: null, remarks: 'No QLI matched by item code or description (when ILI has no item code, only QLIs with empty item code are considered).', matchedQLI: null, validationStep: 'Quote - No match (Item code/description)' }
  }

  const qli = selectedQLI
  return validateWithQLI(qli)
}

/**
 * Full validation flow for each ILI:
 * PO and IBX filters are mandatory and must never be skipped.
 * 1) PO filter: ILI must have a PO; filter QLIs by PO number (match ILI PO). If ILI has no PO or no QLIs → For Rate Card Validation.
 * 2) IBX filter: ILI must have an IBX; filter those QLIs by IBX/site_id (ILI IBX must match QLI site_id). If ILI has no IBX or no matching QLIs → For Rate Card Validation.
 * 3) Item code or description: prefer item-code match; if a QLI matches by item code, use it for unit price validation; else use best description match (min n-1 words). If no match → For Rate Card Validation.
 * 4) Unit price (and LLA, quantity) validation on the selected QLI.
 * If result is "For Rate Card Validation" and rateCardData + rateCardConfig provided, run rate card validation.
 * Returns array of { row, serial_number, line_number, trx_number, po_number, ibx, validation_result, remarks, ... }
 */
export function runValidation(baseData, quoteData, options = {}) {
  const results = []
  const byPO = indexQuotesByPO(quoteData)
  let passedCount = 0
  let failedCount = 0
  let rateCardCount = 0

  for (let i = 0; i < (baseData || []).length; i++) {
    const ili = baseData[i]
    const rowNumber = i + 1
    const po = getValue(ili, "PO_NUMBER")
    const poTrimmed = po != null ? String(po).trim() : ''

    const serialNumber = getValue(ili, ['SERIAL_NUMBER', 'serial_number'])
    const lineNumber = getValue(ili, ['LINE_NUMBER', 'line_number'])
    const trxNumber = getValue(ili, ['invoice_number', 'TRX_NUMBER', 'trx_number', 'Invoice Number'])

    const iliDesc = getValue(ili, "DESCRIPTION") || ''
    const baseResult = {
      row: rowNumber,
      serial_number: serialNumber,
      line_number: lineNumber,
      trx_number: trxNumber,
      po_number: po,
      ibx: getValue(ili, "IBX"),
      ili_number: getValue(ili, ['ILI Number', 'ili number', 'ILI_NUMBER', 'Line Number', 'LINE_NUMBER']),
      qli_number: '',
      ili_business_unit: getValue(ili, ['BUSINESS_UNIT', 'business_unit']),
      ili_curr: getValue(ili, ['CURR', 'curr', 'currency']),
      ili_category: getValue(ili, ['CATEGORY', 'category']),
      ili_charge_type: getValue(ili, ['CHARGE_TYPE', 'charge_type']),
      ili_item_code: getValue(ili, "PRODUCT_CODE") || '',
      unit_price: getNumeric(ili, "UNIT_SELLING_PRICE"),
      quantity: getNumeric(ili, "QUANTITY"),
      lla: getNumeric(ili, "LINE_LEVEL_AMOUNT"),
      ili_description: iliDesc,
      ili_desc_tokens: formatCDTokensForDisplay(parseSentenceCD(iliDesc)),
      qli_desc_tokens: '',
      desc_match_percentage: '',
      // check from down (dates formatted for display: Excel serial -> YYYY-MM-DD)
      ili_invoice_start_date: formatDateForDisplay(getValue(ili, "SERVICE_START_DATE")),
      ili_renewal_term: getValue(ili, "RENEWAL_TERM"),
      ili_first_Price_increment_applicable_after: getValue(ili, "FIRST_PRICE_INC_APP_AFTER"),
      ili_price_increase_percentage: getValue(ili, "PRICE_INCREASE_PERCENTAGE"),
      ili_billing_from: formatDateForDisplay(getValue(ili, "RECURRING_CHARGE_FROM_DATE")),
      ili_billing_till: formatDateForDisplay(getValue(ili, "RECURRING_CHARGE_TO_DATE")),
      prorata_factor: getPF(ili),
      expected_result: getExpectedResultFromBaseRow(ili),
      validation_result: '',
      validation_step: '',
      remarks: ''
    }
    const rawLla = baseResult.lla
    const up = baseResult.unit_price
    const qty = baseResult.quantity
    if ((rawLla === 0 || rawLla === undefined || isNaN(rawLla)) && !isNaN(up) && up !== 0 && qty > 0) {
      baseResult.effective_lla = up * qty
      baseResult.lla_calculated = true
    } else {
      baseResult.effective_lla = rawLla
      baseResult.lla_calculated = false
    }

    // PO filter (mandatory, never skipped): ILI must have a PO to attempt quote validation
    if (!poTrimmed) {
      baseResult.validation_result = 'Skipped'
      baseResult.validation_step = 'Quote - No match (No PO on ILI)'
      baseResult.remarks = 'ILI has no PO number; cannot match quote by PO.'
      rateCardCount++
      results.push(baseResult)
      continue
    }

    const key = poTrimmed.toUpperCase()
    const qlis = byPO[key] || []

    // PO filter (mandatory): no QLIs with this PO → rate card
    if (qlis.length === 0) {
      baseResult.validation_result = 'Skipped'
      baseResult.validation_step = 'Quote - No match (No PO)'
      baseResult.remarks = 'No matching quote line items for this PO number.'
      rateCardCount++
      results.push(baseResult)
      continue
    }

    const { result, remarks, matchedQLI, validationStep, effectiveLla, llaCalculated, ella } = validateILIAgainstQLIs(ili, qlis, options)
    baseResult.remarks = remarks
    baseResult.validation_step = validationStep || ''
    if (effectiveLla !== undefined) {
      baseResult.effective_lla = effectiveLla
      baseResult.lla_calculated = llaCalculated === true
    }
    if (ella !== undefined && !isNaN(ella)) baseResult.ella = ella
    if (matchedQLI) {
      baseResult.qli_number = getValue(matchedQLI, ['Number', 'QLI_NUMBER', 'Line Number', 'line_number'])
      baseResult.qli_po_number = getValue(matchedQLI, "Po Number")
      baseResult.qli_currency = getValue(matchedQLI, QLI_CURRENCY_VARIANTS)
      baseResult.qli_site_id = getQLISiteId(matchedQLI)
      baseResult.qli_item_code = getQLIProductCode(matchedQLI)
      baseResult.qli_quantity = getQLIQuantity(matchedQLI)
      baseResult.qli_unit_price = getNumeric(matchedQLI, QLI_UNIT_PRICE_VARIANTS)
      baseResult.qli_description = getQLIChargeDesc(matchedQLI)
      const qliDescForTokens = baseResult.qli_description || ''
      baseResult.qli_desc_tokens = formatCDTokensForDisplay(parseSentenceCD(qliDescForTokens))
      const descScore = getDescMatchScore(baseResult.ili_description, getQLIChargeDesc(matchedQLI), getQLIChangeDesc(matchedQLI))
      baseResult.desc_match_percentage = descScore.matchCount !== undefined && descScore.matchCount !== '' ? descScore.matchCount : ''
      baseResult.qli_invoice_start_date = formatDateForDisplay(getValue(matchedQLI, "Invoice start date"))
      baseResult.qli_renewal_term = getValue(matchedQLI, "renewal term")
      baseResult.qli_first_Price_increment_applicable_after = getValue(matchedQLI, "first_Price_increment_applicable_after")
      baseResult.qli_price_increase_percentage = getValue(matchedQLI, "price_increase_percentage")
    }

    if (result === 'validated') {
      baseResult.validation_result = 'Passed'
      passedCount++
    } else if (result === 'failed') {
      baseResult.validation_result = 'Failed'
      failedCount++
    } else {
      baseResult.validation_result = 'Skipped'
      baseResult.validation_step = baseResult.validation_step || 'Quote - No match'
      baseResult.remarks = baseResult.remarks || 'No QLI matched (IBX/product/charge/price/quantity).'
      rateCardCount++
    }
    results.push(baseResult)
  }

  // Rate card validation: for each "For Rate Card Validation" line, if rate card data and config provided, validate
  const rateCardData = options.rateCardData
  const rateCardConfig = options.rateCardConfig
  if (rateCardData && rateCardConfig && Array.isArray(rateCardConfig) && rateCardConfig.length > 0) {
    for (let i = 0; i < results.length; i++) {
      if (results[i].validation_result !== 'Skipped') continue
      const ili = baseData[i]
      const rcResult = validateWithRateCard(ili, rateCardData, rateCardConfig, {
        priceTolerance: options.priceTolerance != null ? options.priceTolerance : 0.05
      })
      results[i].remarks = rcResult.remarks
      if (rcResult.result === 'validated') {
        results[i].validation_result = 'Passed'
        results[i].validation_step = 'Rate Card - Passed'
        rateCardCount--
        passedCount++
      } else if (rcResult.result === 'failed') {
        results[i].validation_result = 'Failed'
        results[i].validation_step = 'Rate Card - Failed'
        rateCardCount--
        failedCount++
      } else {
        results[i].validation_step = 'Rate Card - No match / Skipped'
      }
      if (rcResult.rc_u_rate_card_sub_type !== undefined) results[i].rc_u_rate_card_sub_type = rcResult.rc_u_rate_card_sub_type
      if (rcResult.rc_u_rate_card_type !== undefined) results[i].rc_u_rate_card_type = rcResult.rc_u_rate_card_type
      if (rcResult.rc_u_rate_card !== undefined) results[i].rc_u_rate_card = rcResult.rc_u_rate_card
      if (rcResult.rc_u_effective_from !== undefined) results[i].rc_u_effective_from = formatDateForDisplay(rcResult.rc_u_effective_from)
      if (rcResult.rc_effective_till !== undefined) results[i].rc_effective_till = formatDateForDisplay(rcResult.rc_effective_till)
      if (rcResult.rc_u_country !== undefined) results[i].rc_u_country = rcResult.rc_u_country
      if (rcResult.rc_u_region !== undefined) results[i].rc_u_region = rcResult.rc_u_region
      if (rcResult.rc_unit_price_used !== undefined && rcResult.rc_unit_price_used !== '') results[i].rc_unit_price_used = rcResult.rc_unit_price_used
      if (rcResult.rc_u_pricekva !== undefined && rcResult.rc_u_pricekva !== '') results[i].rc_u_pricekva = rcResult.rc_u_pricekva
      if (rcResult.rc_u_rate !== undefined && rcResult.rc_u_rate !== '') results[i].rc_u_rate = rcResult.rc_u_rate
      if (rcResult.rc_u_nrc !== undefined && rcResult.rc_u_nrc !== '') results[i].rc_u_nrc = rcResult.rc_u_nrc
      if (rcResult.rc_u_minimum_cabinet_density !== undefined) results[i].rc_u_minimum_cabinet_density = rcResult.rc_u_minimum_cabinet_density
      if (rcResult.rc_u_parameter1 !== undefined) results[i].rc_u_parameter1 = rcResult.rc_u_parameter1
      if (rcResult.rc_u_goods_services_category !== undefined) results[i].rc_u_goods_services_category = rcResult.rc_u_goods_services_category
      if (rcResult.rc_u_amps !== undefined) results[i].rc_u_amps = rcResult.rc_u_amps
      if (rcResult.rc_u_volt !== undefined) results[i].rc_u_volt = rcResult.rc_u_volt
      if (rcResult.rc_u_icb_flag !== undefined) results[i].rc_u_icb_flag = rcResult.rc_u_icb_flag
      // skipped: remains "Skipped"
    }
  }

  // Treat any remaining Skipped as Failed (no separate Skipped count in UI)
  for (let i = 0; i < results.length; i++) {
    if (results[i].validation_result === 'Skipped') {
      results[i].validation_result = 'Failed'
      failedCount++
    }
  }

  return {
    status: 'completed',
    totalLines: (baseData || []).length,
    passedCount,
    failedCount,
    validationResults: results,
    timestamp: new Date().toISOString()
  }
}
