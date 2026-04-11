/**
 * Creates 3 test Excel files (50+ rows each) with positive and negative scenarios.
 * Includes quote validation and rate card validation scenarios.
 */
import XLSX from 'xlsx'
import fs from 'fs'

const outDir = './test-data'
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })

const baseCols = [
  'invoice_number', 'invoice_date', 'quantity', 'unit_price', 'line_level_amount',
  'po_number', 'IBX', 'renewal term', 'first_Price_increment_applicable_after',
  'description', 'item_code', 'country', 'region', 'invoice_start_date',
  'service_start_date', 'price_increase_percentage',
  'billing_from', 'billing_till'
]

function baseRow(overrides = {}) {
  const row = {}
  baseCols.forEach(c => { row[c] = '' })
  Object.assign(row, overrides)
  return row
}

// Last day of month for a given YYYY-MM-DD string
function lastDayOfMonth(dateStr) {
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return ''
  d.setMonth(d.getMonth() + 1)
  d.setDate(0)
  return d.toISOString().slice(0, 10)
}

// ---------- BASE (INVOICE) - 55 rows ----------
const baseRows = []
let rowNum = 1

const baseInvoiceStartDates = ['2025-01-01', '2025-02-15', '2025-04-01', '2025-05-10', '2025-06-01', '2025-08-01', '2025-09-15', '2025-11-01']
// 1-20: Positive (quote match) - PO001-PO005, various sites
for (let i = 1; i <= 20; i++) {
  const po = `PO00${(i % 5) + 1}`
  const sites = ['DA1', 'CH1', 'AM2', 'DA2', 'CH2']
  const qty = i % 2 === 0 ? 5 + (i % 4) : 1
  const up = i % 2 === 0 ? 10 : 100
  const startDate = baseInvoiceStartDates[i % baseInvoiceStartDates.length]
  const billingFrom = startDate
  const billingTill = lastDayOfMonth(startDate)
  baseRows.push(baseRow({
    invoice_number: `INV-${String(i).padStart(4, '0')}`,
    invoice_date: '2025-01-15',
    po_number: po,
    IBX: sites[i % 5],
    item_code: i % 2 === 0 ? 'SVC-001' : 'SVC-002',
    description: i % 2 === 0 ? 'Test Service Monthly' : 'Setup Fee',
    quantity: qty,
    unit_price: up,
    line_level_amount: qty * up,
    'renewal term': 12 + (i % 2) * 12,
    first_Price_increment_applicable_after: 5 + (i % 3),
    price_increase_percentage: 2 + (i % 4),
    invoice_start_date: startDate,
    service_start_date: startDate,
    billing_from: billingFrom,
    billing_till: billingTill,
    country: 'United States',
    region: 'Americas'
  }))
}

// 21-32: Negative (quote) - no PO match, wrong price, excess qty
for (let i = 21; i <= 32; i++) {
  const scenario = (i - 21) % 4
  if (scenario === 0) {
    baseRows.push(baseRow({
      invoice_number: `INV-${i}`,
      invoice_date: '2025-01-15',
      po_number: 'PO999',
      IBX: 'DA1',
      item_code: 'X',
      description: 'No Quote For This PO',
      quantity: 1,
      unit_price: 50,
      line_level_amount: 50,
      invoice_start_date: '2025-01-01',
      service_start_date: '2025-01-01',
      billing_from: '2025-01-01',
      billing_till: '2025-01-31',
      country: 'United States',
      region: 'Americas'
    }))
  } else if (scenario === 1) {
    baseRows.push(baseRow({
      invoice_number: `INV-${i}`,
      invoice_date: '2025-01-15',
      po_number: 'PO001',
      IBX: 'DA1',
      item_code: 'SVC-001',
      description: 'Test Service Monthly',
      quantity: 5,
      unit_price: 99,
      line_level_amount: 495,
      invoice_start_date: '2025-01-01',
      service_start_date: '2025-01-01',
      billing_from: '2025-01-01',
      billing_till: '2025-01-31',
      country: 'United States',
      region: 'Americas'
    }))
  } else if (scenario === 2) {
    baseRows.push(baseRow({
      invoice_number: `INV-${i}`,
      invoice_date: '2025-01-15',
      po_number: 'PO002',
      IBX: 'CH1',
      item_code: 'SVC-002',
      description: 'Setup Fee',
      quantity: 100,
      unit_price: 100,
      line_level_amount: 10000,
      invoice_start_date: '2025-01-01',
      service_start_date: '2025-01-01',
      billing_from: '2025-01-01',
      billing_till: '2025-01-31',
      country: 'United States',
      region: 'Americas'
    }))
  } else {
    baseRows.push(baseRow({
      invoice_number: `INV-${i}`,
      invoice_date: '2025-01-15',
      po_number: 'PO001',
      IBX: 'DA1',
      item_code: 'FREE',
      description: 'Zero charge',
      quantity: 1,
      unit_price: 0,
      line_level_amount: 0,
      invoice_start_date: '2025-01-01',
      service_start_date: '2025-01-01',
      billing_from: '2025-01-01',
      billing_till: '2025-01-31',
      country: 'United States',
      region: 'Americas'
    }))
  }
}

// 33-55: Rate card scenarios (no quote PO / OOS) - AC Power kVA, Smart Hands, Cabinet Installation, etc.
// Include descriptions that match rate card fields: u_minimum_cabinet_density (numeric 0-10), u_amps/u_volt, u_parameter1, u_goods_services_category
const rateCardDescriptions = [
  'AC Power 1.5 kVA',
  'Metered Power Charges 1.5 kVA',
  'Power Cord 1.5 kVA',
  'Smart Hands NRC',
  'Cabinet Installation',
  'Cage Installation',
  'Cross Connect Single-Mode Fiber',
  'Equinix Precision Time Standard NTP',
  'AC Circuit 30 208',
  'Metro Connect Protected',
  'Equinix Internet Access Standard Port',
  'DC Circuit 60 208'
]
for (let i = 33; i <= 55; i++) {
  const desc = rateCardDescriptions[(i - 33) % rateCardDescriptions.length]
  const isMissingServiceStart = i >= 52
  let up = i === 54 ? 0 : 200
  if (desc.indexOf('Power') !== -1 && desc.indexOf('Circuit') === -1) up = 12
  else if (desc.indexOf('Smart') !== -1) up = 150
  else if (desc.indexOf('AC Circuit') !== -1 || desc.indexOf('DC Circuit') !== -1) up = 500
  else if (desc.indexOf('Metro Connect') !== -1) up = 220
  else if (desc.indexOf('Equinix Internet Access') !== -1) up = 200
  const svcStart = isMissingServiceStart ? '' : '2025-06-01'
  const billingFrom = svcStart || ''
  const billingTill = svcStart ? lastDayOfMonth(svcStart) : ''
  baseRows.push(baseRow({
    invoice_number: `INV-${i}`,
    invoice_date: '2025-06-15',
    po_number: 'PO-RC',
    IBX: 'DA1',
    item_code: '',
    description: desc,
    quantity: 1,
    unit_price: up,
    line_level_amount: up,
    invoice_start_date: svcStart,
    service_start_date: svcStart,
    billing_from: billingFrom,
    billing_till: billingTill,
    country: 'United States',
    region: 'Americas'
  }))
}

// One row with price over rate card (fail rate card)
baseRows.push(baseRow({
  invoice_number: 'INV-56',
  invoice_date: '2025-06-15',
  po_number: 'PO-RC',
  IBX: 'DA1',
  description: 'AC Power kVA',
  quantity: 1,
  unit_price: 500,
  line_level_amount: 500,
  invoice_start_date: '2025-06-01',
  service_start_date: '2025-06-01',
  billing_from: '2025-06-01',
  billing_till: '2025-06-30',
  country: 'United States',
  region: 'Americas'
}))

const wsBase = XLSX.utils.json_to_sheet(baseRows)
const wbBase = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(wbBase, wsBase, 'Sheet1')
XLSX.writeFile(wbBase, `${outDir}/Base_Test_Invoice.xlsx`)
console.log('Created', `${outDir}/Base_Test_Invoice.xlsx`, baseRows.length, 'rows')

// ---------- QUOTE - 55+ rows ----------
const quoteRows = []
const quotePoSites = [
  { po: 'PO001', site: 'DA1' }, { po: 'PO001', site: 'DA1' },
  { po: 'PO002', site: 'CH1' }, { po: 'PO002', site: 'CH1' },
  { po: 'PO003', site: 'AM2' }, { po: 'PO003', site: 'AM2' },
  { po: 'PO004', site: 'DA2' }, { po: 'PO004', site: 'DA2' },
  { po: 'PO005', site: 'CH2' }, { po: 'PO005', site: 'CH2' }
]
const quoteInvoiceStartDates = ['2024-01-01', '2024-03-15', '2024-06-01', '2024-09-01', '2025-01-01', '2025-04-01', '2025-07-01', '2025-10-01']
for (let i = 0; i < 55; i++) {
  const { po, site } = quotePoSites[i % 10]
  const isRecurring = i % 2 === 0
  quoteRows.push({
    'Po Number': po,
    'site_id': site,
    'Item Code': isRecurring ? 'SVC-001' : 'SVC-002',
    'Item Description': isRecurring ? 'Test Service Monthly' : 'Setup Fee',
    'Changed Item Description': isRecurring ? 'Test Service Monthly' : 'Setup Fee One Time',
    'Quantity': isRecurring ? 10 : 2,
    'MRC': isRecurring ? 10 : '',
    'OTC': isRecurring ? '' : 100,
    'Invoice start date': quoteInvoiceStartDates[i % quoteInvoiceStartDates.length],
    'first_Price_increment_applicable_after': 5 + (i % 3),
    'renewal term': 12 + (i % 2) * 12,
    'price_increase_percentage': 2 + (i % 4)
  })
}

const wsQuote = XLSX.utils.json_to_sheet(quoteRows)
const wbQuote = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(wbQuote, wsQuote, 'Sheet1')
XLSX.writeFile(wbQuote, `${outDir}/Quote_Test.xlsx`)
console.log('Created', `${outDir}/Quote_Test.xlsx`, quoteRows.length, 'rows')

// ---------- RATE CARD - 55+ rows (includes realistic rows from x_attm_doms_rate_card_data style) ----------
const rcRows = []
const rcTypes = [
  { sub_type: 'Space & Power', price_field: 'u_pricekva', price: 12, density: 1.5 },
  { sub_type: 'Space & Power', price_field: 'u_pricekva', price: 15, density: 2.5 },
  { sub_type: 'Power Install NRC', price_field: 'u_rate', price: 500, amps: '30', volt: '208' },
  { sub_type: 'Power Install NRC', price_field: 'u_rate', price: 450, amps: '60', volt: '208' },
  { sub_type: 'Secure Cabinet Express', price_field: 'u_pricekva', price: 18, density: 1.5 },
  { sub_type: 'Cabinet Install NRC', price_field: 'u_nrc', price: 200 },
  { sub_type: 'Cabinet Install NRC', price_field: 'u_nrc', price: 250 },
  // Interconnection - Metro Connect (rate-card-types: Protected, Unprotected, Dual Diverse)
  { sub_type: 'Interconnection', price_field: 'u_nrc', price: 220, parameter1: 'Protected' },
  { sub_type: 'Interconnection', price_field: 'u_nrc', price: 190, parameter1: 'Unprotected' },
  { sub_type: 'Interconnection', price_field: 'u_nrc', price: 250, parameter1: 'Dual Diverse' },
  // Interconnection - Equinix Internet Access (Standard Port, Bandwidth Commit)
  { sub_type: 'Interconnection', price_field: 'u_nrc', price: 200, parameter1: 'Port', goods_services_category: 'Standard' },
  { sub_type: 'Interconnection', price_field: 'u_nrc', price: 180 },
  // Realistic Interconnection rows from x_attm_doms_rate_card_data (Goods or Services + Parameter1)
  { sub_type: 'Interconnection', price_field: 'u_nrc', price: 185, parameter1: '10G', goods_services_category: 'Fabric Port' },
  { sub_type: 'Interconnection', price_field: 'u_nrc', price: 165, parameter1: '1G', goods_services_category: 'Fabric Port' },
  { sub_type: 'Interconnection', price_field: 'u_nrc', price: 420, parameter1: '100G', goods_services_category: 'Fabric Port' },
  { sub_type: 'Interconnection', price_field: 'u_nrc', price: 120, parameter1: '50 Mbps', goods_services_category: 'Bandwidth Commit' },
  { sub_type: 'Interconnection', price_field: 'u_nrc', price: 140, parameter1: '100 Mbps', goods_services_category: 'Bandwidth Commit' },
  { sub_type: 'Interconnection', price_field: 'u_nrc', price: 160, parameter1: '200 Mbps', goods_services_category: 'Bandwidth Commit' },
  { sub_type: 'Interconnection', price_field: 'u_nrc', price: 180, parameter1: '1000 Mbps', goods_services_category: 'Bandwidth Commit' },
  { sub_type: 'Interconnection', price_field: 'u_nrc', price: 195, parameter1: '2000 Mbps', goods_services_category: 'Bandwidth Commit' },
  { sub_type: 'Interconnection', price_field: 'u_nrc', price: 210, parameter1: '10000 Mbps', goods_services_category: 'Bandwidth Commit' },
  { sub_type: 'Interconnection', price_field: 'u_nrc', price: 90, parameter1: '10 Mbps', goods_services_category: 'Bandwidth Commit' },
  { sub_type: 'Interconnection', price_field: 'u_nrc', price: 175, parameter1: 'Fiber (SM)', goods_services_category: 'Cross Connect' },
  { sub_type: 'Interconnection', price_field: 'u_nrc', price: 95, parameter1: 'Deinstall fee', goods_services_category: 'Cross Connect' },
  { sub_type: 'Interconnection', price_field: 'u_nrc', price: 130, parameter1: 'IPv4 16(/28)', goods_services_category: 'Additional IP Allocation' },
  { sub_type: 'Interconnection', price_field: 'u_nrc', price: 145, parameter1: 'IPv4 128(/25)', goods_services_category: 'Additional IP Allocation' },
  { sub_type: 'Interconnection', price_field: 'u_nrc', price: 150, parameter1: 'Advanced', goods_services_category: 'Cloud Router' },
  { sub_type: 'Interconnection', price_field: 'u_nrc', price: 155, parameter1: 'Standard', goods_services_category: 'Cloud Router' },
  { sub_type: 'Smart Hands', price_field: 'u_rate', price: 150 },
  { sub_type: 'Equinix Precision Time', price_field: 'u_std_ntp_non_red', price: 50, std_ptp: 60, ent_ntp: 80, ent_ptp: 90 }
]
const rateCardCols = ['u_rate_card_type', 'u_rate_card', 'u_rate_card_sub_type', 'u_country', 'u_region', 'u_effective_from', 'effective_till', 'u_icb_flag', 'u_all_ibx', 'u_ibxs', 'u_excluded_ibxs', 'u_pricekva', 'u_minimum_cabinet_density', 'u_rate', 'u_amps', 'u_volt', 'u_nrc', 'u_parameter1', 'u_goods_services_category', 'u_std_ntp_non_red', 'u_std_ptp_non_red', 'u_ent_ntp_non_red', 'u_ent_ptp_non_red', 'IBX']
function rcRow(overrides = {}) {
  const row = {}
  rateCardCols.forEach(c => { row[c] = '' })
  Object.assign(row, overrides)
  return row
}

const countries = ['United States', 'United States', 'United Kingdom']
const regions = ['Americas', 'Americas', 'EMEA']
for (let i = 0; i < 55; i++) {
  const rc = rcTypes[i % rcTypes.length]
  const row = rcRow({
    u_rate_card_type: 'Equinix',
    u_rate_card: rc.sub_type.includes('Power') ? 'Power' : rc.sub_type.includes('Cabinet') || rc.sub_type.includes('Secure') ? 'Space' : rc.sub_type === 'Interconnection' ? 'Interconnection' : 'Service',
    u_rate_card_sub_type: rc.sub_type,
    u_country: countries[i % 3],
    u_region: regions[i % 3],
    u_effective_from: '2025-04-01',
    effective_till: '2026-03-31',
    u_icb_flag: false,
    u_all_ibx: true,
    u_ibxs: '',
    u_excluded_ibxs: '',
    IBX: 'DA1'
  })
  if (rc.price_field === 'u_pricekva') {
    row.u_pricekva = rc.price
    row.u_minimum_cabinet_density = (rc.density != null && rc.density >= 0 && rc.density <= 10) ? rc.density : 1.5
  } else if (rc.price_field === 'u_rate') {
    row.u_rate = rc.price
  } else {
    row.u_nrc = rc.price
  }
  if (rc.sub_type === 'Power Install NRC') {
    row.u_amps = rc.amps || '30'
    row.u_volt = rc.volt || '208'
  }
  if (rc.sub_type === 'Interconnection' && (rc.parameter1 || rc.goods_services_category)) {
    if (rc.parameter1) row.u_parameter1 = rc.parameter1
    if (rc.goods_services_category) row.u_goods_services_category = rc.goods_services_category
  }
  if (rc.sub_type === 'Equinix Precision Time') {
    row.u_std_ntp_non_red = rc.price
    row.u_std_ptp_non_red = rc.std_ptp || 60
    row.u_ent_ntp_non_red = rc.ent_ntp || 80
    row.u_ent_ptp_non_red = rc.ent_ptp || 90
  }
  rcRows.push(row)
}

// 2 rows with ICB (should be skipped in rate card validation)
rcRows.push(rcRow({
  u_rate_card_type: 'Equinix',
  u_rate_card: 'Power',
  u_rate_card_sub_type: 'Space & Power',
  u_country: 'United States',
  u_region: 'Americas',
  u_effective_from: '2025-04-01',
  effective_till: '2026-03-31',
  u_pricekva: 10,
  u_minimum_cabinet_density: 1.5,
  u_icb_flag: true,
  u_all_ibx: true,
  u_excluded_ibxs: '',
  IBX: 'DA1'
}))
rcRows.push(rcRow({
  u_rate_card_type: 'Equinix',
  u_rate_card: 'Service',
  u_rate_card_sub_type: 'Smart Hands',
  u_country: 'United States',
  u_region: 'Americas',
  u_effective_from: '2025-04-01',
  effective_till: '2026-03-31',
  u_rate: 120,
  u_icb_flag: true,
  u_all_ibx: true,
  u_excluded_ibxs: '',
  IBX: 'DA1'
}))

const wsRc = XLSX.utils.json_to_sheet(rcRows)
const wbRc = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(wbRc, wsRc, 'Sheet1')
XLSX.writeFile(wbRc, `${outDir}/Rate_Card_Test.xlsx`)
console.log('Created', `${outDir}/Rate_Card_Test.xlsx`, rcRows.length, 'rows')

// ---------- RATE CARD (realistic structure matching x_attm_doms_rate_card_data columns) ----------
// Columns: Goods or Services, Parameter1, Minimum Cabinet Density (kVA), Parameter2, Customer Name, Rate Card Type, Effective Till, Order Placed Date, IBX, ICB Flag
const sourceStyleCols = ['Goods or Services', 'Parameter1', 'Minimum Cabinet Density (kVA)', 'Parameter2', 'Customer Name', 'Rate Card Type', 'Effective Till', 'Order Placed Date', 'IBX', 'ICB Flag']
const realisticGoodsParam1 = [
  { goods: 'Metro Connect', param1: '10G' },
  { goods: 'Metro Connect', param1: '1G' },
  { goods: 'Metro Connect', param1: '100G' },
  { goods: 'Equinix Fabric Port', param1: '10G' },
  { goods: 'Equinix Fabric Port', param1: '1G' },
  { goods: 'Equinix Fabric Port', param1: '100G' },
  { goods: 'Equinix Fabric Port  Unlimited Local Connections Package', param1: '1G' },
  { goods: 'Equinix Fabric Port  Unlimited Local Connections Package', param1: '10G' },
  { goods: 'Equinix Fabric Port  Unlimited Local Connections Package', param1: '100G' },
  { goods: 'Equinix Internet Access Bandwidth Commit', param1: '50 Mbps' },
  { goods: 'Equinix Internet Access Bandwidth Commit', param1: '100 Mbps' },
  { goods: 'Equinix Internet Access Bandwidth Commit', param1: '1000 Mbps' },
  { goods: 'Equinix Internet Access Bandwidth Commit', param1: '10000 Mbps' },
  { goods: 'Equinix Internet Access Bandwidth Commit', param1: '10 Mbps' },
  { goods: 'Equinix Internet Access Additional IP Allocation', param1: 'IPv4 128(/25)' },
  { goods: 'Equinix Internet Access Additional IP Allocation', param1: 'IPv4 16(/28)' },
  { goods: 'Equinix Internet Access Additional IP Allocation', param1: 'IPv4&6 16(/28)  /64' },
  { goods: 'Cross Connect', param1: 'Fiber (SM)' },
  { goods: 'Cross Connect', param1: 'Deinstall fee' },
  { goods: 'Internet Exchange Port', param1: '1G' },
  { goods: 'Internet Exchange Port', param1: '10G' },
  { goods: 'Internet Exchange Port', param1: '100G' },
  { goods: 'Fiber Connect', param1: 'Fiber (SM)' },
  { goods: 'Extended Cross Connect', param1: 'Fiber (SM)' },
  { goods: 'Extended Cross Connect  Remote', param1: 'Fiber (SM)' },
  { goods: 'Equinix Fabric Cloud Router', param1: 'Advanced' },
  { goods: 'Equinix Fabric Cloud Router', param1: 'Standard' },
  { goods: 'Equinix Fabric Unlimited Port Plus', param1: '10G' },
  { goods: 'Equinix Fabric Unlimited Port Plus', param1: '1G' },
  { goods: 'Extended Cross Connects', param1: 'Deinstall fee' }
]
const effectiveTillExcel = 46112 // 2026-03-31 as Excel serial
const rcRealisticRows = realisticGoodsParam1.map((r, i) => ({
  'Goods or Services': r.goods,
  'Parameter1': r.param1,
  'Minimum Cabinet Density (kVA)': '',
  'Parameter2': '',
  'Customer Name': '',
  'Rate Card Type': 'Interconnection',
  'Effective Till': effectiveTillExcel,
  'Order Placed Date': '',
  'IBX': i % 3 === 0 ? 'DA1' : i % 3 === 1 ? 'CH1' : 'AM2',
  'ICB Flag': false
}))
const wsRcRealistic = XLSX.utils.json_to_sheet(rcRealisticRows)
const wbRcRealistic = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(wbRcRealistic, wsRcRealistic, 'Page 1')
XLSX.writeFile(wbRcRealistic, `${outDir}/Rate_Card_Realistic_Structure.xlsx`)
console.log('Created', `${outDir}/Rate_Card_Realistic_Structure.xlsx`, rcRealisticRows.length, 'rows (source file column structure)')

console.log('\nDone. Test files:')
console.log('  - Base_Test_Invoice.xlsx: quote positive/negative + rate card scenarios (56 rows)')
console.log('  - Quote_Test.xlsx: quote line items for PO001-PO005 (55 rows)')
console.log('  - Rate_Card_Test.xlsx: rate card data with realistic Interconnection rows (app columns)')
console.log('  - Rate_Card_Realistic_Structure.xlsx: rate card in source file column structure (Goods or Services, Parameter1, Rate Card Type, Effective Till, etc.)')
console.log('Upload Base + Quote + Rate_Card_Test in Excel Validation to test validation.')
