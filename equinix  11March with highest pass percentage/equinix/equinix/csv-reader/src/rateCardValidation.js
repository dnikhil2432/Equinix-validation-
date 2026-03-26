/**
* Rate card validation for "For Rate Card Validation" lines (OOS / no quote match).
* Mirrors ServiceNow RateCardDataHandlerUtils (validateWithRateCardForOOS, findRateCard1, fetchRateCard,
* checkExactRateCardEntry, completeQuery, checkRateCardType). Uses rate-card-types.json (key_to_identify_Rate_Card_Types).
*
* Rules:
* - ILI service_start_date must fall within the rate card effective window (min Effective From to max Effective Till from rate card file).
* - If Unit Price missing but LLA & Quantity present: Unit Price = LLA / Quantity
* - Rate card is found by: type (charge_description) + country + region + u_effective_from <= service_start_date < effective_till + IBX (u_all_ibx/u_ibxs/u_excluded_ibxs).
* - CUP = Unit Price of RLI (rate card line). If both 0 → Pass; if ILI unit price > CUP * (1 + tolerance) → Failed.
*/
 
import { calculateCDSimilarity, parseSentence as parseSentenceCD } from './cdValidationParser.js'

// Fallback effective window when rate card has no valid Effective From/Till (e.g. empty file)
const EFFECTIVE_FROM_FALLBACK = '2025-04-01'
const EFFECTIVE_TILL_FALLBACK = '2026-03-31'
 
const ILI_DESC_VARIANTS = ['description', 'charge_description', 'CHARGE_DESCRIPTION', 'DESCRIPTION']
const ILI_SERVICE_START_VARIANTS = ['service_start_date', 'SERVICE_START_DATE', 'Service_Start_Date']
const ILI_COUNTRY_VARIANTS = ['country', 'COUNTRY', 'Country']
const ILI_REGION_VARIANTS = ['region', 'REGION', 'Region']
const ILI_IBX_VARIANTS = ['IBX', 'ibx', 'ibx_center', 'IBX_CENTER']
const ILI_BUSINESS_UNIT_VARIANTS = ['BUSINESS_UNIT', 'business_unit', 'Business Unit']
const ILI_CURR_VARIANTS = ['CURR', 'curr', 'currency', 'Currency']
/** When set (e.g. Interconnection), findRateCard narrows candidates to this u_rate_card_sub_type. */
const ILI_CATEGORY_VARIANTS = ['CATEGORY', 'category', 'Category']
const ILI_CHARGE_TYPE_VARIANTS = ['CHARGE_TYPE', 'charge_type', 'Charge Type']

const RC_SUB_TYPE_VARIANTS = ['u_rate_card_sub_type', 'rate_card_sub_type', 'Rate Card Sub Type', 'Rate Card Sub-Type']
const RC_COUNTRY_VARIANTS = ['u_country', 'country', 'Country']
const RC_REGION_VARIANTS = ['u_region', 'region', 'Region']
const RC_EFFECTIVE_FROM_VARIANTS = ['u_effective_from', 'effective_from', 'Effective From']
const RC_EFFECTIVE_TILL_VARIANTS = ['effective_till', 'effective_to', 'Effective Till']
const RC_PRICE_KVA_VARIANTS = ['u_pricekva', 'pricekva', 'Price per kVA', 'MRC Rate', 'Minimum Cabinet Density (kVA)']
const RC_RATE_VARIANTS = ['u_rate', 'rate', 'Rate', 'MRC Rate']
const RC_NRC_VARIANTS = ['u_nrc', 'nrc', 'NRC', 'NRC Rate', 'Non-Recurring Charge']
const RC_ICB_FLAG_VARIANTS = ['u_icb_flag', 'icb_flag', 'ICB Flag']
// Note: keep "goods services" and "goods/services category" separate so we don't accidentally pick the wrong one.
const RC_GOODS_SERVICES_VARIANTS = [
  'u_goods_services',
  'goods_services',
  'Goods Services',
  'Goods or Services',
  'Goods or Services (Type)',
]
const RC_GOODS_SERVICES_CATEGORY_VARIANTS = [
  'u_goods_services_category',
  'goods_services_category',
  'Goods or Services Category',
  'Goods Services Category',
  'Goods or Services Category (Type)',
]
const RC_PHASE_VARIANTS = ['u_phase', 'phase', 'PHASE', 'Phase']
const RC_ALL_IBX_VARIANTS = ['u_all_ibx', 'All IBXs']
const RC_IBXS_VARIANTS = ['u_ibxs', 'IBX', 'IBX (2)']
const RC_EXCLUDED_IBXS_VARIANTS = ['u_excluded_ibxs', 'Excluded IBXs']
const RC_STD_NTP_VARIANTS = ['u_std_ntp_non_red', 'std_ntp_non_red', 'NTP Rate (1)', 'NTP Rate']
const RC_STD_PTP_VARIANTS = ['u_std_ptp_non_red', 'std_ptp_non_red', 'PTP Rate (1)', 'PTP Rate']
const RC_ENT_NTP_VARIANTS = ['u_ent_ntp_non_red', 'ent_ntp_non_red', 'NTP Rate (3)']
const RC_ENT_PTP_VARIANTS = ['u_ent_ptp_non_red', 'ent_ptp_non_red', 'PTP Rate (3)']
const RC_PARAMETER1_VARIANTS = ['u_parameter1', 'Parameter1']
const RC_PARAMETER2_VARIANTS = ['u_parameter2', 'Parameter2']
const RC_MIN_CABINET_DENSITY_VARIANTS = ['u_minimum_cabinet_density', 'Minimum Cabinet Density (kVA)']
const RC_RATE_CARD_TYPE_VARIANTS = ['u_rate_card_type', 'Rate Card Type']
const RC_RATE_CARD_VARIANTS = ['u_rate_card', 'Rate Card']
const RC_SUPPLIER_VARIANTS = ['u_supplier', 'supplier', 'Supplier']
const RC_CURRENCY_VARIANTS = ['u_currency', 'currency', 'CURR', 'Currency']
const RC_BUSINESS_UNIT_VARIANTS = ['u_business_unit', 'business_unit', 'Business Unit', 'BUSINESS_UNIT']
const RC_CURR_VARIANTS = RC_CURRENCY_VARIANTS
const RC_CATEGORY_VARIANTS = ['u_category', 'category', 'CATEGORY', 'Category']
const RC_CHARGE_TYPE_VARIANTS = ['u_charge_type', 'charge_type', 'CHARGE_TYPE', 'Charge Type']
 
function formatCDTokensForDisplay(parsed) {
  if (!parsed) return ''
  const parts = []
  if (parsed.level_matches?.length) {
    parsed.level_matches.forEach(({ label, matches }, i) => {
      const levelLabel = i === 0 ? 'Cat' : i === 1 ? 'Sub' : i === 2 ? 'Detail' : `L${i + 1}`
      const display = matches.length > 1
        ? `${label} [+${matches.slice(1).join(', ')}]`
        : label
      parts.push(`${levelLabel}: ${display}`)
    })
  }
  if (parsed.value_matches?.length) parts.push(parsed.value_matches.join(', '))
  return parts.join(' | ')
}

function getValue(row, variants) {
  if (!row) return ''
  for (const v of variants) {
    const val = row[v]
    if (val !== undefined && val !== null && val !== '') return String(val).trim()
  }
  return ''
}
 
function getNumeric(row, variants) {
  const s = getValue(row, variants)
  if (!s) return NaN
  const cleaned = String(s).replace(/[$,]/g, '')
  return parseFloat(cleaned)
}
 
export function parseDate(s) {
  if (s === undefined || s === null || s === '') return null
  const str = String(s).trim()
  // Excel serial: only when value is a plain number (no hyphens/slashes), e.g. 45748 from invoice
  const asNumber = typeof s === 'number' ? s : (/^-?\d+$/.test(str) ? parseFloat(str) : NaN)
  if (!isNaN(asNumber) && asNumber > 1000 && asNumber < 100000) {
    const d = new Date((asNumber - 25569) * 86400000)
    return isNaN(d.getTime()) ? null : d
  }
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d
}

/** Format a date value (Excel serial or date string) for UI/export as YYYY-MM-DD. */
export function formatDateForDisplay(value) {
  if (value === undefined || value === null || value === '') return ''
  const d = parseDate(value)
  return d ? d.toISOString().slice(0, 10) : String(value).trim()
}

function getIliChargeDesc(ili) {
  return getValue(ili, ILI_DESC_VARIANTS)
}

/**
 * Strip invoice metadata from ILI charge description so CD similarity targets the service text
 * (e.g. Equinix Fabric, bandwidth, AWS) — not UUIDs or "Recurring Charge-01-NOV-2025..." tails.
 */
function sanitizeChargeDescForRateCard(desc) {
  if (!desc) return ''
  let s = String(desc)
  // Remove GUIDs
  s = s.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ' ')
  // Drop trailing recurring charge / date noise
  s = s.replace(/\s*-?\s*Recurring\s+Charge[\s\S]*$/i, '')
  s = s.replace(/\s*--\s*$/g, '')
  s = s.replace(/\s+/g, ' ').trim()
  return s
}

/** Prefer RC rows whose synthesized desc shares more distinct keywords with the ILI (tie-break). */
function keywordOverlapCount(iliDesc, rcDesc) {
  const words = String(iliDesc || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(w => w.length > 2)
  const rc = String(rcDesc || '').toLowerCase()
  let n = 0
  for (const w of words) {
    if (rc.includes(w)) n++
  }
  return n
}

/** Strong tie-break: ILI product code appears in RC synthesized text (e.g. ECX00015). */
function productCodeOverlapBoost(ili, rcDesc) {
  const pc = getValue(ili, ['PRODUCT_CODE', 'product_code', 'Product Code']).trim().toLowerCase()
  if (!pc || !rcDesc) return 0
  return rcDesc.toLowerCase().includes(pc) ? 100 : 0
}
 
function getIliServiceStart(ili) {
  return getValue(ili, ILI_SERVICE_START_VARIANTS)
}
 
function getIliCountry(ili) {
  return getValue(ili, ILI_COUNTRY_VARIANTS)
}
 
function getIliRegion(ili) {
  return getValue(ili, ILI_REGION_VARIANTS)
}
 
function getIliIbx(ili) {
  return getValue(ili, ILI_IBX_VARIANTS)
}

function getIliBusinessUnit(ili) {
  return getValue(ili, ILI_BUSINESS_UNIT_VARIANTS)
}

function getIliCurr(ili) {
  return getValue(ili, ILI_CURR_VARIANTS)
}

function getIliCategory(ili) {
  return getValue(ili, ILI_CATEGORY_VARIANTS)
}

function getIliChargeType(ili) {
  return getValue(ili, ILI_CHARGE_TYPE_VARIANTS)
}

/**
 * Map invoice category/charge type to the most likely RC sub types.
 * Prevents broad candidate pools (and wrong RLI picks) for categories like "Power".
 */
function getExpectedRcSubTypesForIli(ili) {
  const category = getIliCategory(ili).toLowerCase()
  const chargeType = getIliChargeType(ili).toLowerCase()
  const productCode = getValue(ili, ['PRODUCT_CODE', 'product_code', 'Product Code']).toUpperCase()

  if (category === 'interconnection') return ['Interconnection']
  if (category === 'space') return ['Space & Power', 'Secure Cabinet Express', 'Cabinet Install NRC']
  if (category === 'service') return ['Smart Hands', 'Equinix Precision Time']
  if (category === 'power') {
    if (chargeType.includes('nrc')) return ['Power Install NRC']
    if (chargeType.includes('rc')) return ['Space & Power']
    return ['Space & Power', 'Power Install NRC']
  }
  // Product-code heuristic for power items in messy/legacy invoices.
  if (productCode.startsWith('POW')) return ['Space & Power', 'Power Install NRC']
  return []
}
 
/**
* Compute effective window from rate card file: min(Effective From) and max(Effective Till) across all rows.
* Returns { from, till, fromDisplay, tillDisplay } for the window; or null if rate card empty/no valid dates.
*/
function getEffectiveWindowFromRateCard(rateCardData) {
  if (!rateCardData || !Array.isArray(rateCardData) || rateCardData.length === 0) return null
  let minFrom = null
  let maxTill = null
  for (const rc of rateCardData) {
    const fromVal = getValue(rc, RC_EFFECTIVE_FROM_VARIANTS)
    const tillVal = getValue(rc, RC_EFFECTIVE_TILL_VARIANTS)
    const fromDate = fromVal ? parseDate(fromVal) : null
    const tillDate = tillVal ? parseDate(tillVal) : null
    if (fromDate && !isNaN(fromDate.getTime())) {
      minFrom = minFrom == null ? fromDate : (fromDate.getTime() < minFrom.getTime() ? fromDate : minFrom)
    }
    if (tillDate && !isNaN(tillDate.getTime())) {
      maxTill = maxTill == null ? tillDate : (tillDate.getTime() > maxTill.getTime() ? tillDate : maxTill)
    }
  }
  if (minFrom == null && maxTill == null) return null
  const from = minFrom != null ? minFrom : parseDate(EFFECTIVE_FROM_FALLBACK)
  const till = maxTill != null ? maxTill : parseDate(EFFECTIVE_TILL_FALLBACK)
  return {
    from,
    till,
    fromDisplay: (from && !isNaN(from.getTime()) ? from.toISOString().slice(0, 10) : '') || EFFECTIVE_FROM_FALLBACK,
    tillDisplay: (till && !isNaN(till.getTime()) ? till.toISOString().slice(0, 10) : '') || EFFECTIVE_TILL_FALLBACK
  }
}

/**
* Check if ILI service_start_date falls within the effective window.
* @param {string|number} serviceStartDate - raw value from invoice
* @param {{ from: Date, till: Date } | null} window - from getEffectiveWindowFromRateCard; if null, use fallback dates
*/
function isServiceStartInEffectiveWindow(serviceStartDate, window) {
  if (!serviceStartDate) return false
  const d = parseDate(serviceStartDate)
  if (!d) return false
  const from = (window && window.from) ? window.from : parseDate(EFFECTIVE_FROM_FALLBACK)
  const till = (window && window.till) ? window.till : parseDate(EFFECTIVE_TILL_FALLBACK)
  if (!from || !till) return true
  return d.getTime() >= from.getTime() && d.getTime() <= till.getTime()
}
 
/**
 * True if ILI site code matches a token from the rate card IBX list (exact or prefix).
 * Rate cards often list a metro prefix (e.g. "TR") while ILI IBX is a specific site ("TR1", "TR2").
 */
function ibxSiteMatchesToken(iliIbx, token) {
  const ili = String(iliIbx || '').trim().toUpperCase()
  const t = String(token || '').trim().toUpperCase()
  if (!ili || !t) return false
  if (ili === t) return true
  if (ili.startsWith(t)) return true
  if (t.startsWith(ili)) return true
  return false
}

/**
* IBX filter (mirrors completeQuery/determineIBXQuery): rate card row must apply to ILI's IBX.
* - u_all_ibx = false: u_ibxs must contain ILI IBX (comma-separated list or single value).
*   Tokens match exact site (TR1) or prefix (TR matches TR1, TR2) — not only list.includes(TR1).
* - u_all_ibx = true and u_excluded_ibxs non-empty: ILI IBX must NOT be in u_excluded_ibxs.
* - u_all_ibx = true and u_excluded_ibxs empty: applies to all IBX.
*/
function rateCardAppliesToIbx(rcRow, iliIbx) {
  if (!iliIbx) return true
  const allIbx = getValue(rcRow, RC_ALL_IBX_VARIANTS).toLowerCase()
  const isAllIbx = allIbx === 'true' || allIbx === '1' || allIbx === 'yes'
  if (!isAllIbx) {
    const ibxs = getValue(rcRow, RC_IBXS_VARIANTS)
    if (!ibxs) return false
    const list = ibxs.split(',').map(s => s.trim()).filter(Boolean)
    return list.some(tok => ibxSiteMatchesToken(iliIbx, tok))
  }
  const excluded = getValue(rcRow, RC_EXCLUDED_IBXS_VARIANTS)
  if (!excluded) return true
  const excludedList = excluded.split(',').map(s => s.trim()).filter(Boolean)
  return !excludedList.some(tok => ibxSiteMatchesToken(iliIbx, tok))
}

function formatRcIbxScope(rcRow) {
  const allIbxRaw = String(getValue(rcRow, RC_ALL_IBX_VARIANTS) || '').trim().toLowerCase()
  const isAllIbx = allIbxRaw === 'true' || allIbxRaw === '1' || allIbxRaw === 'yes'
  if (isAllIbx) {
    const excluded = String(getValue(rcRow, RC_EXCLUDED_IBXS_VARIANTS) || '').trim()
    return excluded ? `ALL (excl: ${excluded})` : 'ALL'
  }
  const ibxs = String(getValue(rcRow, RC_IBXS_VARIANTS) || '').trim()
  return ibxs || ''
}
 
/**
* Fixed order for evaluating rate card categories (first match wins).
* Must match order in rate-card-types.json.
*/
const CATEGORY_ORDER = [
  'space_and_power',
  'power_install_nrc',
  'secure_cabinet_express',
  'cabinet_install_nrc',
  'interconnection',
  'smart_hands',
  'equinix_precision_time'
]
 
/**
* Maps category key to subType / rcType / rc for rate card row filtering.
* JSON does not contain these; they are fixed per category.
*/
const CATEGORY_META = {
  space_and_power: { subType: 'Space & Power', rcType: 'Power', rc: 'Power' },
  power_install_nrc: { subType: 'Power Install NRC', rcType: 'Power', rc: 'Power' },
  secure_cabinet_express: { subType: 'Secure Cabinet Express', rcType: 'Space', rc: 'Space' },
  cabinet_install_nrc: { subType: 'Cabinet Install NRC', rcType: 'Space', rc: 'Space' },
  interconnection: { subType: 'Interconnection', rcType: 'Interconnection', rc: 'Interconnection' },
  smart_hands: { subType: 'Smart Hands', rcType: 'Service', rc: 'Service' },
  equinix_precision_time: { subType: 'Equinix Precision Time', rcType: 'Service', rc: 'Service' }
}
 
/**
* Match charge_description against one category's entries from rate-card-types.json.
* Case-insensitive substring match. No regex, no tokenizing.
* - Key matched AND (no subkey or subkey matched) → return full match { keyObj, key, subkey?, fields }.
* - Key matched BUT subkey defined and NOT matched → return { ambiguous: true } (do not validate).
* - No key matched → return null.
* First matching entry wins.
*/
function matchChargeDescriptionToCategory(chargeDesc, entries) {
  if (!chargeDesc || !entries || !Array.isArray(entries)) return null
  const descLower = String(chargeDesc).toLowerCase()
  for (let i = 0; i < entries.length; i++) {
    const item = entries[i]
    const key = (item.key || '').trim()
    if (!key) continue
    const keyLower = key.toLowerCase()
    if (descLower.indexOf(keyLower) === -1) continue
    const subkeyArr = item.subkey && Array.isArray(item.subkey) ? item.subkey : []
    if (subkeyArr.length === 0) {
      return { keyObj: item, key: item.key, fields: item.fields || [] }
    }
    let subkeyMatched = false
    let matchedSubkey = null
    for (let j = 0; j < subkeyArr.length; j++) {
      const sk = (subkeyArr[j] || '').trim().toLowerCase()
      if (sk && descLower.indexOf(sk) !== -1) {
        subkeyMatched = true
        matchedSubkey = subkeyArr[j]
        break
      }
    }
    if (!subkeyMatched) return { ambiguous: true }
    return { keyObj: item, key: item.key, subkey: matchedSubkey, fields: item.fields || [] }
  }
  return null
}
 
/**
* Get entries array for a category from configArray (array of { [categoryKey]: entries }).
*/
function getCategoryEntries(configArray, categoryKey) {
  if (!configArray || !Array.isArray(configArray)) return []
  const obj = configArray.find(o => o[categoryKey] != null)
  return obj && Array.isArray(obj[categoryKey]) ? obj[categoryKey] : []
}
 
function getRcValue(rcRow, fieldName) {
  const v = rcRow[fieldName]
  if (v !== undefined && v !== null && v !== '') return String(v).trim()
  const lower = fieldName.toLowerCase().trim()
  for (const k of Object.keys(rcRow || {})) {
    if (String(k).trim().toLowerCase() === lower) return String(rcRow[k]).trim()
  }
  return ''
}
 
// Config field name -> rate card column variants (for prod column names)
const RC_FIELD_VARIANTS = {
  u_parameter1: RC_PARAMETER1_VARIANTS,
  u_parameter2: RC_PARAMETER2_VARIANTS,
  u_minimum_cabinet_density: RC_MIN_CABINET_DENSITY_VARIANTS,
  u_goods_services_category: RC_GOODS_SERVICES_VARIANTS
}

/**
* Check that all required fields from rate card row appear in charge_description.
*/
function checkExactRateCardEntry(rcRow, chargeDesc, fieldArr) {
  if (!fieldArr || fieldArr.length === 0) return true
  const descLower = (chargeDesc || '').toLowerCase()
  for (let j = 0; j < fieldArr.length; j++) {
    const variants = RC_FIELD_VARIANTS[fieldArr[j]] || [fieldArr[j]]
    const value = getValue(rcRow, variants).toLowerCase()
    if (value && descLower.indexOf(value) === -1) return false
  }
  return true
}
 
/**
* Pre-filter rate card rows by ILI attributes (u_currency/CURR, Rate_card_type/CATEGORY,
* country, region, effective dates, IBX). Applied before charge description matching.
* @param {{ skipCurrency?: boolean }} [options] - If true, match country/region/IBX only (invoice USD vs RC JPY is common for Japan/APAC).
*/
function preFilterRateCardByIliAttributes(rateCardData, ili, serviceStartDate, options = {}) {
  const skipCurrency = options.skipCurrency === true
  const country = getIliCountry(ili)
  const region = getIliRegion(ili)
  const iliIbx = getIliIbx(ili)
  const iliCurr = getIliCurr(ili)

  const key = `${String(iliCurr || '').trim().toUpperCase()}|${String(country || '').trim()}|${String(region || '').trim().toUpperCase()}`
  // Currency-relaxed pass must scan all RLIs (index is keyed by currency|country|region).
  const base = skipCurrency
    ? (rateCardData || [])
    : ((rateCardData && rateCardData.__byTriple && rateCardData.__byTriple.get(key)) ? rateCardData.__byTriple.get(key) : (rateCardData || []))

  return base.filter(rc => {
    const rcCurrency = getValue(rc, RC_CURRENCY_VARIANTS)
    if (!skipCurrency && iliCurr) {
      if (!rcCurrency) return false
      if (String(rcCurrency).trim().toUpperCase() !== String(iliCurr).trim().toUpperCase()) return false
    }
    const rcCountry = getValue(rc, RC_COUNTRY_VARIANTS)
    if (country) {
      if (!rcCountry) return false
      if (String(rcCountry).trim().toLowerCase() !== String(country).trim().toLowerCase()) return false
    }
    const rcRegion = getValue(rc, RC_REGION_VARIANTS)
    if (region) {
      if (!rcRegion) return false
      if (String(rcRegion).trim().toUpperCase() !== String(region).trim().toUpperCase()) return false
    }
    // Service start date filter intentionally skipped (user requirement).
    if (!rateCardAppliesToIbx(rc, iliIbx)) return false
    return true
  })
}

/**
 * Rate card CD matching: build a synthetic description for an RC row (since there's no single description column).
 * We concatenate key identifying fields and let CD similarity choose the best RC row.
 */
function buildRateCardDesc(rcRow) {
  const parts = [
    getValue(rcRow, RC_RATE_CARD_TYPE_VARIANTS),
    getValue(rcRow, RC_SUB_TYPE_VARIANTS),
    getValue(rcRow, RC_RATE_CARD_VARIANTS),
    getValue(rcRow, RC_GOODS_SERVICES_VARIANTS),
    getValue(rcRow, RC_GOODS_SERVICES_CATEGORY_VARIANTS),
    getRcValue(rcRow, 'u_amps'),
    getRcValue(rcRow, 'u_phase') || getValue(rcRow, RC_PHASE_VARIANTS),
    getRcValue(rcRow, 'u_volt'),
    getValue(rcRow, RC_PARAMETER1_VARIANTS),
    getValue(rcRow, RC_PARAMETER2_VARIANTS),
    getValue(rcRow, ['u_product_name', 'product_name', 'Product Name']),
    getValue(rcRow, ['u_service_name', 'service_name', 'Service Name', 'u_service']),
    getValue(rcRow, ['u_circuit_type', 'circuit_type', 'Circuit Type']),
    getValue(rcRow, ['u_bandwidth', 'bandwidth', 'Bandwidth']),
    getValue(rcRow, ['u_metro', 'metro', 'Metro']),
    getValue(rcRow, ['u_term', 'term', 'Term']),
    getValue(rcRow, ['u_uom', 'uom', 'UOM']),
    getValue(rcRow, ['u_equipment', 'equipment', 'Equipment']),
    getValue(rcRow, ['u_ip_type', 'ip_type', 'IP Type']),
    getValue(rcRow, ['u_media_type', 'media_type', 'Media Type']),
    getValue(rcRow, ['u_sub_type', 'sub_type', 'Sub Type']),
    getValue(rcRow, ['u_service_provider', 'service_provider', 'Service Provider'])
  ]
  return parts.map(s => String(s || '').trim()).filter(Boolean).join(' | ')
}

function ensureRateCardIndex(rateCardData) {
  if (!rateCardData || !Array.isArray(rateCardData)) return
  if (rateCardData.__byTriple) return
  Object.defineProperty(rateCardData, '__byTriple', { value: new Map(), enumerable: false })
  for (const rc of rateCardData) {
    const curr = String(getValue(rc, RC_CURRENCY_VARIANTS) || '').trim().toUpperCase()
    const country = String(getValue(rc, RC_COUNTRY_VARIANTS) || '').trim()
    const region = String(getValue(rc, RC_REGION_VARIANTS) || '').trim().toUpperCase()
    const key = `${curr}|${country}|${region}`
    if (!rateCardData.__byTriple.has(key)) rateCardData.__byTriple.set(key, [])
    rateCardData.__byTriple.get(key).push(rc)
  }
}

/**
* Find rate card by matching charge_description against rate-card-types.json (configArray).
* First pre-filters RC by u_currency/CURR, Rate_card_type/CATEGORY, country, region, dates, IBX.
* Then categories evaluated in CATEGORY_ORDER (charge desc match); key + subkey required when defined.
*/
function findRateCard(ili, rateCardData, configArray) {
  const rawChargeDesc = getIliChargeDesc(ili)
  const chargeDesc = sanitizeChargeDescForRateCard(rawChargeDesc)
  ensureRateCardIndex(rateCardData)
  let preFiltered = preFilterRateCardByIliAttributes(rateCardData, ili, null)

  const iliCategory = getValue(ili, ILI_CATEGORY_VARIANTS)
  let candidates = preFiltered
  const expectedSubTypes = getExpectedRcSubTypesForIli(ili)
  if (expectedSubTypes.length > 0) {
    const narrowedByExpectedType = preFiltered.filter(rc => {
      const st = getValue(rc, RC_SUB_TYPE_VARIANTS)
      return expectedSubTypes.includes(st)
    })
    if (narrowedByExpectedType.length > 0) candidates = narrowedByExpectedType
  }
  if (iliCategory) {
    const catLower = iliCategory.trim().toLowerCase()
    const narrowed = candidates.filter(rc => {
      const st = getValue(rc, RC_SUB_TYPE_VARIANTS)
      if (!st) return false
      const stLower = st.trim().toLowerCase()
      if (stLower === catLower) return true
      return false
    })
    if (narrowed.length > 0) candidates = narrowed
  }

  // CD similarity (same threshold as quote validation); tie-break on keyword overlap with ILI
  if (!chargeDesc) return null
  let best = null
  for (const rc of candidates) {
    if (getValue(rc, RC_ICB_FLAG_VARIANTS).toLowerCase() === 'true') continue
    const rcDesc = buildRateCardDesc(rc)
    if (!rcDesc) continue
    const { score, passes } = calculateCDSimilarity(chargeDesc, rcDesc)
    if (!passes) continue
    const overlap = keywordOverlapCount(chargeDesc, rcDesc)
    const prodBoost = productCodeOverlapBoost(ili, rcDesc)
    if (
      !best ||
      score > best.score ||
      (score === best.score && prodBoost > best.prodBoost) ||
      (score === best.score && prodBoost === best.prodBoost && overlap > best.overlap)
    ) {
      best = { rc, score, rcDesc, overlap, prodBoost }
    }
  }
  // If strict CD pass finds nothing (metadata-heavy ILI text), use best row still >= fallback min
  const CD_FALLBACK_MIN = 52
  if (!best) {
    for (const rc of candidates) {
      if (getValue(rc, RC_ICB_FLAG_VARIANTS).toLowerCase() === 'true') continue
      const rcDesc = buildRateCardDesc(rc)
      if (!rcDesc) continue
      const { score } = calculateCDSimilarity(chargeDesc, rcDesc)
      const overlap = keywordOverlapCount(chargeDesc, rcDesc)
      const prodBoost = productCodeOverlapBoost(ili, rcDesc)
      if (score < CD_FALLBACK_MIN) continue
      if (
        !best ||
        score > best.score ||
        (score === best.score && prodBoost > best.prodBoost) ||
        (score === best.score && prodBoost === best.prodBoost && overlap > best.overlap)
      ) {
        best = { rc, score, rcDesc, overlap, prodBoost }
      }
    }
  }
  if (!best) return null
  const subType = getValue(best.rc, RC_SUB_TYPE_VARIANTS) || 'Unknown'
  return { rc: best.rc, subType, cdScore: best.score, rcDesc: best.rcDesc }
}
 
/**
* Get unit price from rate card row by sub type (and charge desc for Precision Time).
*/
function getRateCardUnitPrice(rcRow, subType, chargeDesc) {
  const desc = (chargeDesc || '').toLowerCase()
  switch (subType) {
    case 'Space & Power':
      return getNumeric(rcRow, RC_PRICE_KVA_VARIANTS)
    case 'Power Install NRC':
      return getNumeric(rcRow, RC_RATE_VARIANTS)
    case 'Secure Cabinet Express':
      return getNumeric(rcRow, RC_PRICE_KVA_VARIANTS)
    case 'Cabinet Install NRC':
      return getNumeric(rcRow, RC_NRC_VARIANTS)
    case 'Interconnection':
      return getNumeric(rcRow, RC_NRC_VARIANTS)
    case 'Smart Hands':
      return getNumeric(rcRow, RC_RATE_VARIANTS)
    case 'Equinix Precision Time':
      if (desc.indexOf('standard') !== -1) {
        if (desc.indexOf('ntp') !== -1) return getNumeric(rcRow, RC_STD_NTP_VARIANTS)
        if (desc.indexOf('ptp') !== -1) return getNumeric(rcRow, RC_STD_PTP_VARIANTS)
      } else if (desc.indexOf('enterprise') !== -1) {
        if (desc.indexOf('ntp') !== -1) return getNumeric(rcRow, RC_ENT_NTP_VARIANTS)
        if (desc.indexOf('ptp') !== -1) return getNumeric(rcRow, RC_ENT_PTP_VARIANTS)
      }
      return getNumeric(rcRow, RC_STD_NTP_VARIANTS) || getNumeric(rcRow, RC_RATE_VARIANTS)
    default:
      return getNumeric(rcRow, RC_RATE_VARIANTS) || getNumeric(rcRow, RC_NRC_VARIANTS) || getNumeric(rcRow, RC_PRICE_KVA_VARIANTS)
  }
}
 
/**
* Validate ILI against rate card with tolerance.
* - If service_start_date missing → skipped (remain For Rate Card)
* - If no rate card found → skipped
* - If ICB → skipped
* - If both ILI unit price and RLI (CUP) are 0 → Pass
* - If ILI unit price > CUP * (1 + tolerance) → Failed
* - Else → Pass
*
* @param {object} [options]
* @param {number} [options.priceTolerance]
* @param {boolean} [options.oosNoQuoteSerial] - true when quote had no QLI for serial; uses shorter remark if no RC match (no long contract boilerplate).
*/
export function validateWithRateCard(ili, rateCardData, configArray, options = {}) {
  const priceTolerance = options.priceTolerance != null ? options.priceTolerance : 0.05
 
  const serviceStart = getIliServiceStart(ili)
  // Service start date effective-window validation intentionally skipped (user requirement).
 
  let invPrice = getNumeric(ili, ['unit_price', ' UNIT_SELLING_PRICE ', 'UNIT_SELLING_PRICE', 'unit_selling_price', 'Unit Price'])
  const lla = getNumeric(ili, ['line_level_amount', ' LINE_LEVEL_AMOUNT ', 'LINE_LEVEL_AMOUNT', 'lla', 'Line Level Amount'])
  const qty = getNumeric(ili, ['quantity', 'QUANTITY', 'Quantity'])
  if ((isNaN(invPrice) || invPrice === 0) && !isNaN(lla) && qty > 0) {
    invPrice = lla / qty
  }
  if (isNaN(invPrice)) invPrice = 0
 
  const found = findRateCard(ili, rateCardData, configArray)
  if (!found) {
    const longNoMatchRemark =
      'Out-of-Scope Item. This line item is not a part of the contract; and no rate card reference is available to validate the price. Validation has been skipped due to missing rate card information. This Line item will be handled manually.'
    return {
      result: 'skipped',
      remarks: options.oosNoQuoteSerial
        ? 'OOS validation: no rate card line matched.'
        : longNoMatchRemark
    }
  }
 
  const { rc, subType, rcDesc } = found
  const chargeDesc = getIliChargeDesc(ili)
  const cup = getRateCardUnitPrice(rc, subType, chargeDesc)
 
  const rcFields = {
    rc_u_rate_card_type: getValue(rc, RC_RATE_CARD_TYPE_VARIANTS),
    rc_u_rate_card: getValue(rc, RC_RATE_CARD_VARIANTS),
    rc_u_rate_card_sub_type: subType || getValue(rc, RC_SUB_TYPE_VARIANTS),
    rc_u_goods_services: getValue(rc, RC_GOODS_SERVICES_VARIANTS),
    rc_u_currency: getValue(rc, RC_CURRENCY_VARIANTS),
    rc_u_effective_from: getValue(rc, RC_EFFECTIVE_FROM_VARIANTS),
    rc_effective_till: getValue(rc, RC_EFFECTIVE_TILL_VARIANTS),
    rc_u_country: getValue(rc, RC_COUNTRY_VARIANTS),
    rc_u_region: getValue(rc, RC_REGION_VARIANTS),
    rc_ibx: formatRcIbxScope(rc),
    rc_unit_price_used: isNaN(cup) ? '' : cup,
    rc_u_pricekva: getValue(rc, RC_PRICE_KVA_VARIANTS) ? (getNumeric(rc, RC_PRICE_KVA_VARIANTS) || '') : '',
    rc_u_rate: getValue(rc, RC_RATE_VARIANTS) ? (getNumeric(rc, RC_RATE_VARIANTS) || '') : '',
    rc_u_nrc: getValue(rc, RC_NRC_VARIANTS) ? (getNumeric(rc, RC_NRC_VARIANTS) || '') : '',
    rc_u_minimum_cabinet_density: getValue(rc, RC_MIN_CABINET_DENSITY_VARIANTS),
    rc_u_parameter1: getValue(rc, RC_PARAMETER1_VARIANTS),
    rc_u_parameter2: getValue(rc, RC_PARAMETER2_VARIANTS),
    rc_u_circuit_type: getValue(rc, ['u_circuit_type', 'circuit_type', 'Circuit Type']),
    rc_u_phase: getRcValue(rc, 'u_phase') || getValue(rc, RC_PHASE_VARIANTS),
    rc_u_goods_services_category: getValue(rc, RC_GOODS_SERVICES_CATEGORY_VARIANTS),
    rc_u_amps: getRcValue(rc, 'u_amps'),
    rc_u_volt: getRcValue(rc, 'u_volt'),
    rc_u_icb_flag: getValue(rc, RC_ICB_FLAG_VARIANTS),
    rc_desc: rcDesc || buildRateCardDesc(rc),
    rc_desc_tokens: formatCDTokensForDisplay(parseSentenceCD(rcDesc || buildRateCardDesc(rc)))
  }

  // If we found a matching RC line item after filters + CD matching, treat as pass.
  // (User requirement: don't fail by price once RC match exists.)
  let remark = 'Rate card line item matched (filters + CD); validation passed.'
  return { result: 'validated', remarks: remark, ...rcFields }

  if (getValue(rc, RC_ICB_FLAG_VARIANTS).toLowerCase() === 'true') {
    return {
      result: 'skipped',
      remarks: 'Out-of-Scope Item. Rate card reference is available with ICB. This Line Item will be handled manually. Validation has been skipped.',
      ...rcFields
    }
  }
 
  // Smart Hands: skip MRC/monthly
  if (subType === 'Smart Hands' && (chargeDesc.toLowerCase().indexOf('mrc') > -1 || chargeDesc.toLowerCase().indexOf('monthly') > -1)) {
    return { result: 'skipped', remarks: 'Smart Hands MRC/monthly - skipped.', ...rcFields }
  }
 
  if (isNaN(cup)) {
    return { result: 'skipped', remarks: 'Rate card unit price not found for this sub type.', ...rcFields }
  }
 
  // Both 0 → Pass
  if (invPrice === 0 && cup === 0) {
    return { result: 'validated', remarks: 'Both ILI and rate card unit price are zero; validation passed.', ...rcFields }
  }
 
  // If ILI unit price > CUP * (1 + tolerance) → Failed
  if (invPrice > cup * (1 + priceTolerance)) {
    return {
      result: 'failed',
      remarks: `Rate card validation failed. Invoice unit price ${invPrice.toFixed(2)} exceeds rate card price ${cup.toFixed(2)} * (1+${(priceTolerance * 100).toFixed(0)}%) = ${(cup * (1 + priceTolerance)).toFixed(2)}.`,
      ...rcFields
    }
  }
 
  return { result: 'validated', remarks: 'Rate card validation passed.', ...rcFields }
}