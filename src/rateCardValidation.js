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
const RC_GOODS_SERVICES_VARIANTS = ['u_goods_services', 'u_goods_services_category', 'goods_services', 'Goods Services', 'Goods or Services', 'Goods or Services Category']
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
* IBX filter (mirrors completeQuery/determineIBXQuery): rate card row must apply to ILI's IBX.
* - u_all_ibx = false: u_ibxs must contain ILI IBX (comma-separated list or single value).
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
    const list = ibxs.split(',').map(s => s.trim().toUpperCase())
    return list.includes(iliIbx.toUpperCase())
  }
  const excluded = getValue(rcRow, RC_EXCLUDED_IBXS_VARIANTS)
  if (!excluded) return true
  const excludedList = excluded.split(',').map(s => s.trim().toUpperCase())
  return !excludedList.includes(iliIbx.toUpperCase())
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
*/
function preFilterRateCardByIliAttributes(rateCardData, ili, serviceStartDate) {
  const country = getIliCountry(ili)
  const region = getIliRegion(ili)
  const iliIbx = getIliIbx(ili)
  const iliCurr = getIliCurr(ili)
  const iliCategory = getIliCategory(ili)

  return (rateCardData || []).filter(rc => {
    const rcCurrency = getValue(rc, RC_CURRENCY_VARIANTS)
    if (iliCurr && rcCurrency && String(rcCurrency).trim().toUpperCase() !== String(iliCurr).trim().toUpperCase()) return false
    const rcRateCardType = getValue(rc, RC_RATE_CARD_TYPE_VARIANTS)
    if (iliCategory && rcRateCardType && String(rcRateCardType).trim().toUpperCase() !== String(iliCategory).trim().toUpperCase()) return false
    const rcCountry = getValue(rc, RC_COUNTRY_VARIANTS)
    if (country && rcCountry && rcCountry !== country) return false
    const rcRegion = getValue(rc, RC_REGION_VARIANTS)
    if (region && rcRegion && rcRegion !== region) return false
    const effFrom = parseDate(getValue(rc, RC_EFFECTIVE_FROM_VARIANTS))
    const effTill = parseDate(getValue(rc, RC_EFFECTIVE_TILL_VARIANTS))
    if (effFrom && serviceStartDate < effFrom) return false
    if (effTill && serviceStartDate >= effTill) return false
    if (!rateCardAppliesToIbx(rc, iliIbx)) return false
    return true
  })
}

/**
* Find rate card by matching charge_description against rate-card-types.json (configArray).
* First pre-filters RC by u_currency/CURR, Rate_card_type/CATEGORY, country, region, dates, IBX.
* Then categories evaluated in CATEGORY_ORDER (charge desc match); key + subkey required when defined.
*/
function findRateCard(ili, rateCardData, configArray) {
  const serviceStart = getIliServiceStart(ili)
  if (!serviceStart) return null
  const serviceStartDate = parseDate(serviceStart)
  if (!serviceStartDate) return null

  const chargeDesc = getIliChargeDesc(ili)
  const preFiltered = preFilterRateCardByIliAttributes(rateCardData, ili, serviceStartDate)

  for (let t = 0; t < CATEGORY_ORDER.length; t++) {
    const categoryKey = CATEGORY_ORDER[t]
    const entries = getCategoryEntries(configArray, categoryKey)
    if (entries.length === 0) continue

    const match = matchChargeDescriptionToCategory(chargeDesc, entries)
    if (!match) continue
    if (match.ambiguous) continue

    const meta = CATEGORY_META[categoryKey]
    if (!meta) continue
    const subType = meta.subType

    const matchedSubkey = match.subkey
    const matchedKey = (match.key || '').trim()
    const candidates = preFiltered.filter(rc => {
      const rcSub = getValue(rc, RC_SUB_TYPE_VARIANTS)
      if (rcSub !== subType) return false
      const rcGoodsServices = getValue(rc, RC_GOODS_SERVICES_VARIANTS)
      if (rcGoodsServices && matchedSubkey) {
        const goodsServicesList = rcGoodsServices.split(',').map(s => s.trim().toLowerCase())
        const matchedLower = String(matchedSubkey).trim().toLowerCase()
        if (!goodsServicesList.includes(matchedLower)) return false
      }
      if (matchedKey) {
        const rcGS = getValue(rc, RC_GOODS_SERVICES_VARIANTS)
        if (rcGS) {
          const rcGSLower = rcGS.toLowerCase()
          const keyLower = matchedKey.toLowerCase()
          if (!rcGSLower.includes(keyLower)) return false
        }
      }
      return true
    })
 
    const fieldArr = match.fields || []
    for (let c = 0; c < candidates.length; c++) {
      const rc = candidates[c]
      if (getValue(rc, RC_ICB_FLAG_VARIANTS).toLowerCase() === 'true') continue
      if (!checkExactRateCardEntry(rc, chargeDesc, fieldArr)) continue
      return { rc, subType, matchedSubkey: matchedSubkey || null, match: { keyObj: match.keyObj } }
    }
  }
  return null
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
*/
export function validateWithRateCard(ili, rateCardData, configArray, options = {}) {
  const priceTolerance = options.priceTolerance != null ? options.priceTolerance : 0.05
 
  const serviceStart = getIliServiceStart(ili)
  if (!serviceStart) {
    return {
      result: 'skipped',
      remarks: 'Out-of-Scope Item. Service Start Date is missing. This Line Item will be handled manually. Validation has been skipped.'
    }
  }
  const serviceStartDate = parseDate(serviceStart)
  if (!serviceStartDate) {
    return {
      result: 'skipped',
      remarks: 'Out-of-Scope Item. Service Start Date is invalid. This Line Item will be handled manually. Validation has been skipped.'
    }
  }
  const effectiveWindow = getEffectiveWindowFromRateCard(rateCardData)
  const windowFromDisplay = effectiveWindow ? effectiveWindow.fromDisplay : EFFECTIVE_FROM_FALLBACK
  const windowTillDisplay = effectiveWindow ? effectiveWindow.tillDisplay : EFFECTIVE_TILL_FALLBACK
  if (!isServiceStartInEffectiveWindow(serviceStart, effectiveWindow)) {
    const interpretedDate = serviceStartDate ? serviceStartDate.toISOString().slice(0, 10) : ''
    const dateDisplay = interpretedDate ? `${serviceStart} (${interpretedDate})` : String(serviceStart)
    return {
      result: 'skipped',
      remarks: `Out-of-Scope Item. Service Start Date ${dateDisplay} does not fall within the rate card effective window (${windowFromDisplay} to ${windowTillDisplay}). This Line Item will be handled manually. Validation has been skipped.`
    }
  }
 
  let invPrice = getNumeric(ili, ['unit_price', ' UNIT_SELLING_PRICE ', 'UNIT_SELLING_PRICE', 'unit_selling_price', 'Unit Price'])
  const lla = getNumeric(ili, ['line_level_amount', ' LINE_LEVEL_AMOUNT ', 'LINE_LEVEL_AMOUNT', 'lla', 'Line Level Amount'])
  const qty = getNumeric(ili, ['quantity', 'QUANTITY', 'Quantity'])
  if ((isNaN(invPrice) || invPrice === 0) && !isNaN(lla) && qty > 0) {
    invPrice = lla / qty
  }
  if (isNaN(invPrice)) invPrice = 0
 
  const found = findRateCard(ili, rateCardData, configArray)
  if (!found) {
    return {
      result: 'skipped',
      remarks: 'Out-of-Scope Item. This line item is not a part of the contract; and no rate card reference is available to validate the price. Validation has been skipped due to missing rate card information. This Line item will be handled manually.'
    }
  }
 
  const { rc, subType } = found
  const chargeDesc = getIliChargeDesc(ili)
  const cup = getRateCardUnitPrice(rc, subType, chargeDesc)
 
  const rcFields = {
    rc_u_rate_card_type: getValue(rc, RC_RATE_CARD_TYPE_VARIANTS),
    rc_u_rate_card: getValue(rc, RC_RATE_CARD_VARIANTS),
    rc_u_rate_card_sub_type: subType || getValue(rc, RC_SUB_TYPE_VARIANTS),
    rc_u_goods_services: getValue(rc, RC_GOODS_SERVICES_VARIANTS),
    rc_u_effective_from: getValue(rc, RC_EFFECTIVE_FROM_VARIANTS),
    rc_effective_till: getValue(rc, RC_EFFECTIVE_TILL_VARIANTS),
    rc_u_country: getValue(rc, RC_COUNTRY_VARIANTS),
    rc_u_region: getValue(rc, RC_REGION_VARIANTS),
    rc_unit_price_used: isNaN(cup) ? '' : cup,
    rc_u_pricekva: getValue(rc, RC_PRICE_KVA_VARIANTS) ? (getNumeric(rc, RC_PRICE_KVA_VARIANTS) || '') : '',
    rc_u_rate: getValue(rc, RC_RATE_VARIANTS) ? (getNumeric(rc, RC_RATE_VARIANTS) || '') : '',
    rc_u_nrc: getValue(rc, RC_NRC_VARIANTS) ? (getNumeric(rc, RC_NRC_VARIANTS) || '') : '',
    rc_u_minimum_cabinet_density: getValue(rc, RC_MIN_CABINET_DENSITY_VARIANTS),
    rc_u_parameter1: getValue(rc, RC_PARAMETER1_VARIANTS),
    rc_u_goods_services_category: getValue(rc, RC_GOODS_SERVICES_VARIANTS),
    rc_u_amps: getRcValue(rc, 'u_amps'),
    rc_u_volt: getRcValue(rc, 'u_volt'),
    rc_u_icb_flag: getValue(rc, RC_ICB_FLAG_VARIANTS)
  }

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