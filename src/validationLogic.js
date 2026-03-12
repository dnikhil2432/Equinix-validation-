/**
 * Validation logic for Invoice Line Items (ILI) vs Quote Line Items (QLI).
 * Two-file mode: Base file (Invoice) + Quote file (QLI).
 * Charge description matching uses CD Validation (tokens.json + valueTokens.json): parseSentence + Jaccard on contains and value_matches.
 */
import { validateWithRateCard, formatDateForDisplay, parseDate } from './rateCardValidation.js'
import { calculateCDSimilarity, parseSentence as parseSentenceCD } from './cdValidationParser.js'


const QLI_PO_VARIANTS = "Po Number"
const QLI_SERIAL_VARIANTS = ['Serial Number', 'serial_number', 'SERIAL_NUMBER']
const QLI_SITE_VARIANTS = "Site Id"
const QLI_PRODUCT_CODE_VARIANTS = "Item Code"
const QLI_CHARGE_DESC_VARIANTS = "Item Description"
const QLI_CHANGE_DESC_VARIANTS = "Changed Item Description"
const QLI_QTY_VARIANTS = "Quantity"
const QLI_UNIT_PRICE_VARIANTS = ['OTC', 'MRC','NRC','UP']
const QLI_TOTAL_FALLBACK_COLS = ['line_item_total_amount', 'line_item_total_mrc', 'line_item_total_otc_nrc_value']
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
/** QLI column name variants for line-level service start date (used for CUP). */
const QLI_SERVICE_START_VARIANTS = ['line_item_service_start_date', 'Line Item Service Start Date', 'line item service start date']

function getCUP(quoteItem, ili) {
  const rawUnitPrice = getNumeric(quoteItem, QLI_UNIT_PRICE_VARIANTS)
  if (rawUnitPrice === 0 || isNaN(rawUnitPrice)) return NaN
  const unitPrice = Math.abs(rawUnitPrice)

  const invoiceDate = parseDate(getValue(ili, "RECURRING_CHARGE_TO_DATE"))
  const qliServiceStartVal = getValue(quoteItem, QLI_SERVICE_START_VARIANTS)
  const serviceStart = parseDate(qliServiceStartVal) || parseDate(getValue(ili, "SERVICE_START_DATE"))
  if (!serviceStart || !invoiceDate) {
    const cupMagnitude = Math.round(unitPrice * 100) / 100
    const qliQty = getQLIQuantity(quoteItem)
    return qliQty < 0 ? -cupMagnitude : cupMagnitude
  }

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
  const cupMagnitude = result > 0 ? Math.round(result * 100) / 100 : NaN
  if (isNaN(cupMagnitude)) return NaN
  const qliQty = getQLIQuantity(quoteItem)
  return qliQty < 0 ? -cupMagnitude : cupMagnitude
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
 * Fallback QLI unit price: if standard price columns (OTC/MRC/NRC/UP) are missing,
 * derive unit price from total amount columns divided by quantity.
 * Tries columns in order: line_item_total_amount → line_item_total_mrc → line_item_total_otc_nrc_value.
 * Returns { price, source } or { price: NaN, source: null } if not derivable.
 */
function getQLIUnitPriceFromTotal(qli) {
  const qty = getQLIQuantity(qli)
  if (isNaN(qty) || qty === 0) return { price: NaN, source: null }
  for (const col of QLI_TOTAL_FALLBACK_COLS) {
    const total = getNumeric(qli, col)
    if (!isNaN(total) && total !== 0) {
      return { price: total / qty, source: col }
    }
  }
  return { price: NaN, source: null }
}

/** Get serial from QLI row (tries known variants, then any key matching /serial/i). */
function getQLISerial(row) {
  if (!row || typeof row !== 'object') return ''
  const byVariants = getValue(row, QLI_SERIAL_VARIANTS)
  if (byVariants) return byVariants
  for (const key of Object.keys(row)) {
    if (/serial/i.test(String(key).replace(/[\s_-]/g, ''))) {
      const v = row[key]
      if (v != null && v !== '') return String(v).trim()
    }
  }
  return ''
}

/**
 * Index quote data by Serial Number for fast lookup (used by runValidation).
 * Includes every QLI row that has a serial (no MRC/OTC filter at index time).
 * Previously we skipped rows with both MRC and OTC ≤ 0, which dropped ~3k QLI rows
 * and caused ~10k+ ILI lines to show "No QLI for Serial" even when the serial existed
 * on the quote with no positive MRC/OTC. Price/CUP validation still runs later and
 * can fail there if the matched QLI has no valid unit price.
 */
export function indexQuotesBySerialNumber(quoteData) {
  const bySerial = {}
  for (const row of quoteData || []) {
    const serial = getQLISerial(row)
    if (!serial || String(serial).trim() === '') continue
    const key = String(serial).trim().toUpperCase()
    if (!bySerial[key]) bySerial[key] = []
    bySerial[key].push(row)
  }
  return bySerial
}

/** @deprecated Use indexQuotesBySerialNumber for validation. Index by PO for legacy scripts. */
/** One-line + detail for UI/export when quote validation did not complete (skipped at a stage). */
function setQuoteSkipReason(baseResult, validationStep, remarks) {
  const step = validationStep != null ? String(validationStep).trim() : ''
  const rem = remarks != null ? String(remarks).trim() : ''
  if (!step && !rem) return
  baseResult.quote_skip_stage = step || 'Quote - No match'
  baseResult.quote_skip_reason = rem ? `${step || 'Quote skipped'}\n${rem}` : step
}

export function indexQuotesByPO(quoteData) {
  const byPO = {}
  for (const row of quoteData || []) {
    const po = getValue(row, "Po Number")
    if (!po) continue
    const otc = getNumeric(row, 'OTC')
    const mrc = getNumeric(row, 'MRC')
    const hasOtc = !isNaN(otc) && otc > 0
    const hasMrc = !isNaN(mrc) && mrc > 0
    if (!hasOtc && !hasMrc) continue
    const key = String(po).trim().toUpperCase()
    if (!byPO[key]) byPO[key] = []
    byPO[key].push(row)
  }
  return byPO
}

/**
 * Single ILI validation against a list of QLIs (already filtered by Serial number in caller).
 * IBX filter applied (currency filter commented out); then description match only (no item code). Unit price/LLA/qty validation.
 * Returns { result, remarks, matchedQLI, validationStep }.
 * result: 'validated' | 'failed' | null (send to rate card validation)
 */
export function validateILIAgainstQLIs(ili, qlis, options) {
  const {
    priceTolerance = 0.05,
    qtyTolerance = 0.20,
    today = new Date()
  } = options || {}

  const ibx = getValue(ili, "IBX") || ''
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

  // Keep unit price and LLA same sign as quantity (ILI) before validation
  if (quantity !== 0 && !isNaN(quantity)) {
    const qtyPositive = quantity > 0
    if (!isNaN(unitPrice) && unitPrice !== 0 && (unitPrice > 0) !== qtyPositive) unitPrice = -unitPrice
    if (!isNaN(lla) && lla !== 0 && (lla > 0) !== qtyPositive) lla = -lla
  }

  // --- IBX filter (mandatory): ILI must have IBX; QLI site_id must match ILI IBX ---
  const ibxTrimmed = ibx != null ? String(ibx).trim() : ''
  if (!ibxTrimmed) {
    return { result: null, remarks: 'ILI has no IBX; cannot match quote by site.', matchedQLI: null, validationStep: 'Quote - No match (No IBX on ILI)' }
  }

  const qlisByIbx = (qlis || []).filter(qli => {
    const qliSite = getQLISiteId(qli)
    const siteTrimmed = qliSite != null ? String(qliSite).trim() : ''
    if (!siteTrimmed) return false
    return siteTrimmed.toUpperCase().includes(ibxTrimmed.toUpperCase()) || ibxTrimmed.toUpperCase().includes(siteTrimmed.toUpperCase())
  })

  if (qlisByIbx.length === 0) {
    return { result: null, remarks: 'No QLI with matching site_id/IBX for this serial.', matchedQLI: null, validationStep: 'Quote - No match (No IBX/site_id)' }
  }

  // --- Currency filter (COMMENTED OUT for now): only QLIs whose currency matches ILI CURR ---
  // const iliCurr = getValue(ili, ['CURR', 'curr', 'currency'])
  // const iliCurrNorm = iliCurr != null ? String(iliCurr).trim().toUpperCase() : ''
  // let qlisForMatch = qlisByIbx
  // if (iliCurrNorm) {
  //   qlisForMatch = qlisByIbx.filter(qli => {
  //     const qliCurr = getValue(qli, QLI_CURRENCY_VARIANTS)
  //     const qliCurrNorm = qliCurr != null ? String(qliCurr).trim().toUpperCase() : ''
  //     return qliCurrNorm === iliCurrNorm
  //   })
  // }
  // if (qlisForMatch.length === 0) {
  //   return { result: null, remarks: 'No QLI with matching currency (CURR) for this serial/IBX.', matchedQLI: null, validationStep: 'Quote - No match (Currency)' }
  // }

  // With currency filter off: use QLIs that passed IBX for further matching
  let qlisForMatch = qlisByIbx

  // Quantity sign filter: if ILI quantity is negative, only validate against QLIs with negative quantity.
  // (Requested: negative ILI → negative QLI)
  if (quantity < 0) {
    qlisForMatch = qlisForMatch.filter(qli => {
      const q = getQLIQuantity(qli)
      return !isNaN(q) && q < 0
    })
    if (qlisForMatch.length === 0) {
      return { result: null, remarks: 'ILI quantity is negative; no QLI with negative quantity for this serial/IBX.', matchedQLI: null, validationStep: 'Quote - No match (Quantity sign)' }
    }
  }

  // --- Item code + description matching ---
  const iliItemCodeRaw = getValue(ili, "PRODUCT_CODE") || ''
  const iliItemCodeNorm = normalizeText(iliItemCodeRaw)

  // 3a. Item-code match (ILI has item code): require BOTH item-code match AND description ≥ 60%
  if (iliItemCodeNorm) {
    const itemCodeCandidates = []
    for (const qli of qlisForMatch) {
      const qliCodeRaw = getQLIProductCode(qli)
      const qliCodeNorm = normalizeText(qliCodeRaw)
      if (!qliCodeNorm) continue
      if (!qliCodeNorm.includes(iliItemCodeNorm) && !iliItemCodeNorm.includes(qliCodeNorm)) continue
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
      // Strict: only include if description match is ≥ 60%
      if (!descScore.passes) continue
      itemCodeCandidates.push({ qli, matchCount: descScore.matchCount != null ? descScore.matchCount : 0 })
    }
    if (itemCodeCandidates.length > 0) {
      let best = itemCodeCandidates[0]
      for (let i = 1; i < itemCodeCandidates.length; i++) {
        if (itemCodeCandidates[i].matchCount > best.matchCount) best = itemCodeCandidates[i]
      }
      return validateWithQLI(best.qli)
    }
    return { result: null, remarks: 'No QLI matched by item code with description ≥ 60% for this serial/IBX.', matchedQLI: null, validationStep: 'Quote - No match (Item code/description)' }
  }

  // 3b. ILI has no item code – description-only, but only against QLIs that also have empty item code
  qlisForMatch = qlisForMatch.filter(qli => {
    const qliCodeNorm = normalizeText(getQLIProductCode(qli))
    return !qliCodeNorm
  })
  if (qlisForMatch.length === 0) {
    return { result: null, remarks: 'ILI has no item code and no QLI with empty item code for this serial/IBX.', matchedQLI: null, validationStep: 'Quote - No match (Item code/description)' }
  }

  // --- Description match (no item code, or both sides empty item code): pick best QLI by CD similarity > 60% ---
  const descCandidates = []
  for (const qli of qlisForMatch) {
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

  let selectedQLI = null
  if (descCandidates.length > 0) {
    let best = descCandidates[0]
    for (let i = 1; i < descCandidates.length; i++) {
      if (descCandidates[i].matchCount > best.matchCount) best = descCandidates[i]
    }
    selectedQLI = best.qli
  }

  if (!selectedQLI) {
    return { result: null, remarks: 'No QLI matched by description (CD similarity > 60% required).', matchedQLI: null, validationStep: 'Quote - No match (Description)' }
  }

  // Run price/LLA/quantity validation for one QLI; returns result object.
  function validateWithQLI(qli) {
    if (unitPrice === 0 && lla === 0 ||unitPrice==''&& lla==''||isNaN(unitPrice)&&isNaN(lla)) {
      return { result: 'validated', remarks: 'Unit Price and LLA are zero; no charge.', matchedQLI: qli, validationStep: 'Quote - Passed (No charge)', effectiveLla: 0, llaCalculated, ella: NaN, cup: NaN, fallbackUnitPrice: NaN, fallbackUnitPriceSource: null }
    }
    const cup = getCUP(qli, ili)

    // Fallback: if no unit price from standard columns (OTC/MRC/NRC/UP), derive from total / quantity
    let effectiveCup = cup
    let fallbackUnitPrice = NaN
    let fallbackUnitPriceSource = null
    if (isNaN(cup) || cup === 0) {
      const fallback = getQLIUnitPriceFromTotal(qli)
      if (!isNaN(fallback.price) && fallback.price !== 0) {
        effectiveCup = fallback.price
        fallbackUnitPrice = fallback.price
        fallbackUnitPriceSource = fallback.source
      }
    }

    const cup_within_tolerance_raw = effectiveCup * (1 + priceTolerance)
    const cup_within_tolerance = Math.round(cup_within_tolerance_raw * 100) / 100
    if (isNaN(effectiveCup) || effectiveCup === 0) {
      return { result: 'failed', remarks: 'No valid quote unit price (CUP) for date.', matchedQLI: qli, validationStep: 'Quote - Failed (No CUP)', effectiveLla: lla, llaCalculated, ella: NaN, cup: effectiveCup, fallbackUnitPrice, fallbackUnitPriceSource }
    }

    const fallbackNote = fallbackUnitPriceSource ? ` (QLI unit price derived from ${fallbackUnitPriceSource} / Quantity)` : ''

    const pf = getPF(ili)
    // Before comparing: if PF < 1, normalize unit price and LLA so that PF * (1/PF) = 1 (full-period equivalent)
    const normFactor = pf > 0 && pf < 1 ? 1 / pf : 1
    const unitPriceForCompare = normFactor === 1 ? unitPrice : (isNaN(unitPrice) ? unitPrice : unitPrice * normFactor)
    const llaForCompare = normFactor === 1 ? lla : (isNaN(lla) ? lla : lla * normFactor)
    const unitPriceExceedsTolerance = effectiveCup > 0
      ? unitPriceForCompare > cup_within_tolerance
      : unitPriceForCompare > cup_within_tolerance
    if (unitPriceExceedsTolerance) {
      const ella = effectiveCup * quantity * pf
      const upDisplay = !isNaN(unitPrice) ? unitPrice.toFixed(2) : 'N/A'
      return { result: 'failed', remarks: `Unit price ${upDisplay} exceeds CUP*(1+tolerance)=${cup_within_tolerance}${fallbackNote}`, matchedQLI: qli, validationStep: 'Quote - Failed (Unit price)', effectiveLla: lla, llaCalculated, ella, cup: effectiveCup, fallbackUnitPrice, fallbackUnitPriceSource }
    }
    const qtyILI = quantity
    if (qtyILI<0){
      var priceTolerance=-1*priceTolerance;
    }
    // Signed comparison only: ELLA same sign as CUP (and qty). For negative qty we compare -15 vs -14.58, never |15| vs |14.58|.
    const ella = effectiveCup * Math.abs(qtyILI) * pf
    const ellaTol = ella * (1 + priceTolerance)
    const llaExceedsElla = qtyILI > 0
      ? llaForCompare > ellaTol
      : llaForCompare > ellaTol
    if (!isNaN(llaForCompare) && llaExceedsElla) {
      const msg = qtyILI < 0
        ? `LLA ${lla.toFixed(2)} is more negative than allowed ELLA*(1+tolerance)=${(ellaTol).toFixed(2)}${fallbackNote}`
        : `LLA ${lla.toFixed(2)} exceeds ELLA*(1+tolerance)=${(ellaTol).toFixed(2)}${fallbackNote}`
      return { result: 'failed', remarks: msg, matchedQLI: qli, validationStep: 'Quote - Failed (LLA)', effectiveLla: lla, llaCalculated, ella, cup: effectiveCup, fallbackUnitPrice, fallbackUnitPriceSource }
    }
    const qliQty = getQLIQuantity(qli)
    if (isNaN(qliQty) || qliQty === 0) {
      return { result: 'validated', remarks: `No quote quantity on matched QLI.${fallbackNote}`, matchedQLI: qli, validationStep: 'Quote - Passed (No quote quantity)', effectiveLla: lla, llaCalculated, ella, cup: effectiveCup, fallbackUnitPrice, fallbackUnitPriceSource }
    }
    const qtyExceedsQuote = Math.abs(qtyILI) > Math.abs(qliQty) * (1 + qtyTolerance)
    if (qtyExceedsQuote) {
      return { result: 'validated', remarks: `All validations passed (Quantity mismatch: ILI qty ${qtyILI} exceeds QLI qty ${qliQty} * (1+${(qtyTolerance * 100).toFixed(0)}%))${fallbackNote}`, matchedQLI: qli, validationStep: 'Quote - Passed (Qty mismatch)', effectiveLla: lla, llaCalculated, ella, cup: effectiveCup, fallbackUnitPrice, fallbackUnitPriceSource }
    }
    return { result: 'validated', remarks: `All validations passed.${fallbackNote}`, matchedQLI: qli, validationStep: 'Quote - Passed', effectiveLla: lla, llaCalculated, ella, cup: effectiveCup, fallbackUnitPrice, fallbackUnitPriceSource }
  }

  const qli = selectedQLI
  return validateWithQLI(qli)
}

/**
 * Full validation flow for each ILI:
 * 1) Serial number filter: ILI must have a Serial number; index QLIs by Serial (QLI Serial = ILI Serial). If ILI has no Serial or no QLIs for that Serial → For Rate Card Validation.
 * 2) IBX filter: ILI must have IBX; QLI Site Id must match ILI IBX. If no match → For Rate Card Validation.
 * 3) Currency filter: (COMMENTED OUT) formerly only QLIs whose currency matches ILI CURR.
 * 4) Description match only (no item code): pick best QLI by CD similarity > 60%. If no match → For Rate Card Validation.
 * 5) Unit price (and LLA, quantity) validation on the selected QLI.
 * If result is "For Rate Card Validation" and rateCardData + rateCardConfig provided, run rate card validation.
 * Returns array of { row, serial_number, line_number, trx_number, po_number, ibx, validation_result, remarks, ... }
 */
export function runValidation(baseData, quoteData, options = {}) {
  const results = []
  const bySerial = indexQuotesBySerialNumber(quoteData)
  let passedCount = 0
  let failedCount = 0
  let rateCardCount = 0

  for (let i = 0; i < (baseData || []).length; i++) {
    const ili = baseData[i]
    const rowNumber = i + 1
    const po = getValue(ili, "PO_NUMBER")
    const serialNumber = getValue(ili, ['SERIAL_NUMBER', 'serial_number'])
    const serialTrimmed = serialNumber != null ? String(serialNumber).trim() : ''
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

    // Serial number filter (mandatory): ILI must have a serial number to attempt quote validation
    if (!serialTrimmed) {
      baseResult.validation_result = 'Skipped'
      baseResult.validation_step = 'Quote - No match (No Serial on ILI)'
      baseResult.remarks = 'ILI has no Serial number; cannot match quote by Serial.'
      setQuoteSkipReason(baseResult, baseResult.validation_step, baseResult.remarks)
      rateCardCount++
      results.push(baseResult)
      continue
    }

    const key = serialTrimmed.toUpperCase()
    const qlis = bySerial[key] || []

    // Serial filter: no QLIs for this serial → rate card
    if (qlis.length === 0) {
      baseResult.validation_result = 'Skipped'
      baseResult.validation_step = 'Quote - No match (No QLI for Serial)'
      baseResult.remarks = 'No matching quote line items for this Serial number.'
      setQuoteSkipReason(baseResult, baseResult.validation_step, baseResult.remarks)
      rateCardCount++
      results.push(baseResult)
      continue
    }

    const { result, remarks, matchedQLI, validationStep, effectiveLla, llaCalculated, ella, cup, fallbackUnitPrice, fallbackUnitPriceSource } = validateILIAgainstQLIs(ili, qlis, options)
    baseResult.remarks = remarks
    baseResult.validation_step = validationStep || ''
    if (effectiveLla !== undefined) {
      baseResult.effective_lla = effectiveLla
      baseResult.lla_calculated = llaCalculated === true
    }
    if (ella !== undefined && !isNaN(ella)) baseResult.ella = ella
    if (cup !== undefined && !isNaN(cup)) baseResult.qli_cup = cup
    if (matchedQLI) {
      baseResult.qli_number = getValue(matchedQLI, ['Number', 'QLI_NUMBER', 'Line Number', 'line_number'])
      baseResult.qli_serial_number = getQLISerial(matchedQLI)
      baseResult.qli_po_number = getValue(matchedQLI, "Po Number")
      baseResult.qli_currency = getValue(matchedQLI, QLI_CURRENCY_VARIANTS)
      baseResult.qli_site_id = getQLISiteId(matchedQLI)
      baseResult.qli_item_code = getQLIProductCode(matchedQLI)
      baseResult.qli_quantity = getQLIQuantity(matchedQLI)
      // Use fallback-derived unit price for display when standard columns had no price
      const standardUnitPrice = getNumeric(matchedQLI, QLI_UNIT_PRICE_VARIANTS)
      baseResult.qli_unit_price = (!isNaN(standardUnitPrice) && standardUnitPrice !== 0)
        ? standardUnitPrice
        : (!isNaN(fallbackUnitPrice) ? fallbackUnitPrice : standardUnitPrice)
      if (!isNaN(fallbackUnitPrice) && fallbackUnitPriceSource) {
        baseResult.qli_unit_price_source = `Derived from ${fallbackUnitPriceSource} / Quantity`
      }
      baseResult.qli_description = getQLIChargeDesc(matchedQLI)
      const qliDescForTokens = baseResult.qli_description || ''
      baseResult.qli_desc_tokens = formatCDTokensForDisplay(parseSentenceCD(qliDescForTokens))
      const descScore = getDescMatchScore(baseResult.ili_description, getQLIChargeDesc(matchedQLI), getQLIChangeDesc(matchedQLI))
      baseResult.desc_match_percentage = descScore.matchCount !== undefined && descScore.matchCount !== '' ? descScore.matchCount : ''
      baseResult.qli_invoice_start_date = formatDateForDisplay(getValue(matchedQLI, "Invoice start date"))
      baseResult.qli_line_item_service_start_date = formatDateForDisplay(getValue(matchedQLI, QLI_SERVICE_START_VARIANTS))
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
      setQuoteSkipReason(baseResult, baseResult.validation_step, baseResult.remarks)
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
      // Preserve quote-skip remarks (why quote validation was skipped); append rate card outcome
      const quoteSkipRemarks = (results[i].remarks || '').trim()
      const rcRemarks = (rcResult.remarks || '').trim()
      if (quoteSkipRemarks && rcRemarks) {
        results[i].remarks = `${quoteSkipRemarks}\n— Rate card: ${rcRemarks}`
      } else {
        results[i].remarks = rcRemarks || quoteSkipRemarks
      }
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
        const prevStage = results[i].quote_skip_stage || ''
        const prevReason = results[i].quote_skip_reason || ''
        if (prevStage || prevReason) {
          results[i].quote_skip_reason = prevReason ? `${prevReason}\n— Then rate card: ${rcResult.remarks || 'No match'}` : `— Rate card: ${rcResult.remarks || 'No match'}`
        }
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
      // Ensure quote skip stage/reason is set so UI still shows why quote was skipped
      if (!results[i].quote_skip_reason && (results[i].validation_step || '').includes('Quote - No match')) {
        setQuoteSkipReason(results[i], results[i].validation_step, results[i].remarks)
      }
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
