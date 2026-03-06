import { useState, useMemo, useEffect, memo, useRef, useDeferredValue, startTransition } from 'react'
import * as XLSX from 'xlsx'
import { runValidation as runValidationLogic } from './validationLogic'
import { formatDateForDisplay } from './rateCardValidation.js'
import './ExcelValidation.css'

// Outcome matches expected: P+Passed or F+Failed counts as pass
function outcomeMatchedExpected(r) {
  const raw = String(r.expected_result ?? '').trim().toUpperCase()
  const exp = raw.slice(0, 1) // P or F (handles "P", "F", "Pass", "Failed", etc.)
  const status = r.validation_result
  if (exp !== 'P' && exp !== 'F') return false // no expected value
  return (exp === 'P' && status === 'Passed') || (exp === 'F' && status === 'Failed')
}
function isQLIValidation(row) {
  const step = (row.validation_step || '')
  return step.startsWith('Quote - Passed') || step.startsWith('Quote - Failed')
}
function isRCValidation(row) {
  return (row.validation_step || '').includes('Rate Card')
}

// Column order and labels for Excel export (all UI columns so download is complete and reviewable without lag)
const EXPORT_COLUMNS = [
  ['row', 'Row'],
  ['serial_number', 'Serial Number'],
  ['line_number', 'Line Number'],
  ['trx_number', 'TRX / Invoice Number'],
  ['ili_number', 'ILI Number'],
  ['qli_number', 'QLI Number'],
  ['po_number', 'ILI PO Number'],
  ['qli_po_number', 'QLI PO Number'],
  ['qli_currency', 'QLI Currency'],
  ['ibx', 'ILI IBX'],
  ['ili_business_unit', 'ILI Business Unit'],
  ['ili_curr', 'ILI CURR'],
  ['ili_category', 'ILI Category'],
  ['ili_charge_type', 'ILI Charge Type'],
  ['qli_site_id', 'QLI Site ID'],
  ['ili_item_code', 'Invoice Item Code'],
  ['qli_item_code', 'Quote Item Code'],
  ['quantity', 'ILI Quantity'],
  ['qli_quantity', 'QLI Quantity'],
  ['unit_price', 'ILI Unit Price'],
  ['qli_unit_price', 'QLI Unit Price'],
  ['effective_lla', 'LLA (effective)'],
  ['lla_calculated', 'LLA calculated'],
  ['ella', 'ELLA'],
  ['ili_description', 'ILI Description'],
  ['qli_description', 'QLI Description'],
  ['ili_desc_tokens', 'ILI Desc Tokens'],
  ['qli_desc_tokens', 'QLI Desc Tokens'],
  ['desc_match_percentage', 'Desc Match %'],
  ['ili_invoice_start_date', 'ILI Invoice Start Date'],
  ['qli_invoice_start_date', 'QLI Invoice Start Date'],
  ['ili_renewal_term', 'ILI Renewal Term'],
  ['qli_renewal_term', 'QLI Renewal Term'],
  ['ili_first_Price_increment_applicable_after', 'ILI First Price Inc After'],
  ['qli_first_Price_increment_applicable_after', 'QLI First Price Inc After'],
  ['ili_price_increase_percentage', 'ILI Price Inc %'],
  ['qli_price_increase_percentage', 'QLI Price Inc %'],
  ['ili_billing_from', 'ILI Billing From'],
  ['ili_billing_till', 'ILI Billing Till'],
  ['prorata_factor', 'Prorata Factor'],
  ['rc_u_rate_card_sub_type', 'RC Sub Type'],
  ['rc_u_effective_from', 'RC Effective From'],
  ['rc_effective_till', 'RC Effective Till'],
  ['rc_u_country', 'RC Country'],
  ['rc_u_region', 'RC Region'],
  ['rc_unit_price_used', 'RC Unit Price Used'],
  ['rc_u_pricekva', 'RC u_pricekva'],
  ['rc_u_rate', 'RC u_rate'],
  ['rc_u_nrc', 'RC u_nrc'],
  ['rc_u_minimum_cabinet_density', 'RC Cabinet Density'],
  ['rc_u_parameter1', 'RC u_parameter1'],
  ['rc_u_goods_services_category', 'RC u_goods_services_category'],
  ['rc_u_amps', 'RC u_amps'],
  ['rc_u_volt', 'RC u_volt'],
  ['rc_u_icb_flag', 'RC ICB Flag'],
  ['expected_result', 'Expected Result'],
  ['validation_result', 'Status'],
  ['validation_step', 'Validation Step'],
  ['remarks', 'Remarks']
]

const DATE_EXPORT_KEYS = new Set(['ili_invoice_start_date', 'qli_invoice_start_date', 'ili_billing_from', 'ili_billing_till', 'rc_u_effective_from', 'rc_effective_till'])

function rowToExportRow(result) {
  const out = {}
  for (const [key, label] of EXPORT_COLUMNS) {
    let v = result[key]
    if (v === undefined || v === null) v = ''
    else if (typeof v === 'number' && isNaN(v)) v = ''
    else if (key === 'lla_calculated') v = v ? 'Yes' : ''
    else if (DATE_EXPORT_KEYS.has(key) && v !== '') v = formatDateForDisplay(v) || v
    out[label] = v
  }
  return out
}

// Single result row - memoized; only re-render when row identity or key display fields change
const ResultRow = memo(function ResultRow({ result }) {
  const fmtNum = (n) => (n !== undefined && !isNaN(n) ? n : '-')
  return (
    <tr className={`result-row ${(result.validation_result || '').toLowerCase().replace(/\s+/g, '-')}`}>
      <td>{result.row}</td>
      <td>{result.ili_number ?? '-'}</td>
      <td>{result.qli_number ?? '-'}</td>
      <td>{result.po_number ?? '-'}</td>
      <td>{result.qli_po_number ?? '-'}</td>
      <td>{result.qli_currency ?? '-'}</td>
      <td>{result.ibx ?? '-'}</td>
      <td>{result.ili_business_unit ?? '-'}</td>
      <td>{result.ili_curr ?? '-'}</td>
      <td>{result.ili_category ?? '-'}</td>
      <td>{result.ili_charge_type ?? '-'}</td>
      <td>{result.qli_site_id ?? '-'}</td>
      <td>{result.ili_item_code ?? '-'}</td>
      <td>{result.qli_item_code ?? '-'}</td>
      <td className="qty-cell">{fmtNum(result.quantity)}</td>
      <td className="qty-cell">{fmtNum(result.qli_quantity)}</td>
      <td className="price-cell">{result.unit_price !== undefined && !isNaN(result.unit_price) ? `$${Number(result.unit_price).toFixed(2)}` : '-'}</td>
      <td className="price-cell">{result.qli_unit_price !== undefined && result.qli_unit_price !== '' && !isNaN(Number(result.qli_unit_price)) ? `$${Number(result.qli_unit_price).toFixed(2)}` : '-'}</td>
      <td className="price-cell">{result.effective_lla !== undefined && !isNaN(result.effective_lla) ? `$${Number(result.effective_lla).toFixed(2)}` : '-'}</td>
      <td>{result.lla_calculated ? 'Yes' : '-'}</td>
      <td className="price-cell">{result.ella !== undefined && !isNaN(result.ella) ? `$${Number(result.ella).toFixed(2)}` : '-'}</td>
      <td className="desc-cell">{result.ili_description ?? '-'}</td>
      <td className="desc-cell">{result.qli_description ?? '-'}</td>
      <td className="desc-cell tokens-cell">{result.ili_desc_tokens ?? '-'}</td>
      <td className="desc-cell tokens-cell">{result.qli_desc_tokens ?? '-'}</td>
      <td className="qty-cell">{result.desc_match_percentage !== undefined && result.desc_match_percentage !== '' ? `${result.desc_match_percentage}%` : '-'}</td>
      <td>{formatDateForDisplay(result.ili_invoice_start_date) || '-'}</td>
      <td>{formatDateForDisplay(result.qli_invoice_start_date) || '-'}</td>
      <td>{result.ili_renewal_term ?? '-'}</td>
      <td>{result.qli_renewal_term ?? '-'}</td>
      <td>{result.ili_first_Price_increment_applicable_after ?? '-'}</td>
      <td>{result.qli_first_Price_increment_applicable_after ?? '-'}</td>
      <td>{result.ili_price_increase_percentage ?? '-'}</td>
      <td>{result.qli_price_increase_percentage ?? '-'}</td>
      <td>{formatDateForDisplay(result.ili_billing_from) || '-'}</td>
      <td>{formatDateForDisplay(result.ili_billing_till) || '-'}</td>
      <td>{result.prorata_factor !== undefined && !isNaN(result.prorata_factor) ? Number(result.prorata_factor).toFixed(4) : '-'}</td>
      <td>{result.rc_u_rate_card_sub_type ?? '-'}</td>
      <td>{formatDateForDisplay(result.rc_u_effective_from) || '-'}</td>
      <td>{formatDateForDisplay(result.rc_effective_till) || '-'}</td>
      <td>{result.rc_u_country ?? '-'}</td>
      <td>{result.rc_u_region ?? '-'}</td>
      <td className="price-cell">{result.rc_unit_price_used !== undefined && result.rc_unit_price_used !== '' && !isNaN(Number(result.rc_unit_price_used)) ? `$${Number(result.rc_unit_price_used).toFixed(2)}` : '-'}</td>
      <td className="price-cell">{result.rc_u_pricekva !== undefined && result.rc_u_pricekva !== '' && !isNaN(Number(result.rc_u_pricekva)) ? `$${Number(result.rc_u_pricekva).toFixed(2)}` : '-'}</td>
      <td className="price-cell">{result.rc_u_rate !== undefined && result.rc_u_rate !== '' && !isNaN(Number(result.rc_u_rate)) ? `$${Number(result.rc_u_rate).toFixed(2)}` : '-'}</td>
      <td className="price-cell">{result.rc_u_nrc !== undefined && result.rc_u_nrc !== '' && !isNaN(Number(result.rc_u_nrc)) ? `$${Number(result.rc_u_nrc).toFixed(2)}` : '-'}</td>
      <td>{result.rc_u_minimum_cabinet_density ?? '-'}</td>
      <td>{result.rc_u_parameter1 ?? '-'}</td>
      <td>{result.rc_u_goods_services_category ?? '-'}</td>
      <td>{result.rc_u_amps ?? '-'}</td>
      <td>{result.rc_u_volt ?? '-'}</td>
      <td>{result.rc_u_icb_flag ?? '-'}</td>
      <td>{result.expected_result ?? '-'}</td>
      <td>
        <span className={`status-badge ${(result.validation_result || '').toLowerCase().replace(/\s+/g, '-')}`}>
          {result.validation_result}
        </span>
      </td>
      <td className="validation-step-cell">{result.validation_step ?? '-'}</td>
      <td className="remarks-cell">{result.remarks}</td>
    </tr>
  )
}, (prev, next) => prev?.row === next?.row)

const PAGE_SIZES = [50, 100, 200, 500]
const DEFAULT_PAGE_SIZE = 50

// Validation Results Component - Total / Passed / Failed + 5 status boxes
function ValidationResults({ results }) {
  const [filterStatus, setFilterStatus] = useState('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [remarksFilter, setRemarksFilter] = useState('')
  const [debouncedRemarksFilter, setDebouncedRemarksFilter] = useState('')
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchTerm), 200)
    return () => clearTimeout(t)
  }, [searchTerm])

  useEffect(() => {
    const t = setTimeout(() => setDebouncedRemarksFilter(remarksFilter), 200)
    return () => clearTimeout(t)
  }, [remarksFilter])

  const summaryCounts = useMemo(() => {
    const rows = results.validationResults || []
    let passedMatch = 0
    let failedMatch = 0
    for (const r of rows) {
      if (outcomeMatchedExpected(r)) passedMatch++
      else failedMatch++
    }
    return { passedMatch, failedMatch }
  }, [results.validationResults])

  const statusCounts = useMemo(() => {
    const rows = results.validationResults || []
    let qliSuccess = 0
    let qliFailed = 0
    let movedToRc = 0
    let rcSuccess = 0
    let rcFailed = 0
    for (const r of rows) {
      const qli = isQLIValidation(r)
      const rc = isRCValidation(r)
      const status = r.validation_result
      if (qli) {
        if (status === 'Passed') qliSuccess++
        else qliFailed++
      }
      if (rc) {
        movedToRc++
        if (status === 'Passed') rcSuccess++
        else rcFailed++
      }
    }
    return { qliSuccess, qliFailed, movedToRc, rcSuccess, rcFailed }
  }, [results.validationResults])

  const filteredResults = useMemo(() => {
    let filtered = results.validationResults
    if (filterStatus === 'Passed') {
      filtered = filtered.filter(r => outcomeMatchedExpected(r))
    } else if (filterStatus === 'Failed') {
      filtered = filtered.filter(r => !outcomeMatchedExpected(r))
    } else if (filterStatus === 'qli-success') {
      filtered = filtered.filter(r => isQLIValidation(r) && r.validation_result === 'Passed')
    } else if (filterStatus === 'qli-failed') {
      filtered = filtered.filter(r => isQLIValidation(r) && r.validation_result === 'Failed')
    } else if (filterStatus === 'moved-rc') {
      filtered = filtered.filter(r => isRCValidation(r))
    } else if (filterStatus === 'rc-success') {
      filtered = filtered.filter(r => isRCValidation(r) && r.validation_result === 'Passed')
    } else if (filterStatus === 'rc-failed') {
      filtered = filtered.filter(r => isRCValidation(r) && r.validation_result === 'Failed')
    }
    if (debouncedSearch) {
      const search = debouncedSearch.toLowerCase()
      filtered = filtered.filter(r =>
        (r.serial_number || '').toString().toLowerCase().includes(search) ||
        (r.line_number || '').toString().toLowerCase().includes(search) ||
        (r.trx_number || '').toString().toLowerCase().includes(search) ||
        (r.ili_number || '').toString().toLowerCase().includes(search) ||
        (r.qli_number || '').toString().toLowerCase().includes(search) ||
        (r.po_number || '').toString().toLowerCase().includes(search) ||
        (r.qli_po_number || '').toString().toLowerCase().includes(search) ||
        (r.qli_currency || '').toString().toLowerCase().includes(search) ||
        (r.ibx || '').toString().toLowerCase().includes(search) ||
        (r.ili_business_unit || '').toString().toLowerCase().includes(search) ||
        (r.ili_curr || '').toString().toLowerCase().includes(search) ||
        (r.ili_category || '').toString().toLowerCase().includes(search) ||
        (r.ili_charge_type || '').toString().toLowerCase().includes(search) ||
        (r.qli_site_id || '').toString().toLowerCase().includes(search) ||
        (r.ili_description || '').toString().toLowerCase().includes(search) ||
        (r.qli_description || '').toString().toLowerCase().includes(search) ||
        (r.ili_invoice_start_date || '').toString().toLowerCase().includes(search) ||
        (r.qli_invoice_start_date || '').toString().toLowerCase().includes(search) ||
        (r.ili_renewal_term || '').toString().toLowerCase().includes(search) ||
        (r.qli_renewal_term || '').toString().toLowerCase().includes(search) ||
        (r.rc_u_rate_card_sub_type || '').toString().toLowerCase().includes(search) ||
        (r.rc_u_country || '').toString().toLowerCase().includes(search) ||
        (r.rc_u_region || '').toString().toLowerCase().includes(search) ||
        (r.rc_u_parameter1 || '').toString().toLowerCase().includes(search) ||
        (r.rc_u_goods_services_category || '').toString().toLowerCase().includes(search) ||
        (r.rc_u_amps || '').toString().toLowerCase().includes(search) ||
        (r.rc_u_volt || '').toString().toLowerCase().includes(search) ||
        (r.remarks || '').toString().toLowerCase().includes(search) ||
        (r.validation_step || '').toString().toLowerCase().includes(search) ||
        (r.ili_billing_from || '').toString().toLowerCase().includes(search) ||
        (r.ili_billing_till || '').toString().toLowerCase().includes(search) ||
        (r.effective_lla != null ? String(r.effective_lla) : '').toLowerCase().includes(search) ||
        (r.ella != null ? String(r.ella) : '').toLowerCase().includes(search)
      )
    }
    if (debouncedRemarksFilter) {
      const rm = debouncedRemarksFilter.toLowerCase()
      filtered = filtered.filter(r => (r.remarks || '').toString().toLowerCase().includes(rm))
    }
    return filtered
  }, [results.validationResults, filterStatus, debouncedSearch, debouncedRemarksFilter])

  const totalFiltered = filteredResults.length
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize))
  const paginatedResults = useMemo(
    () => filteredResults.slice(page * pageSize, (page + 1) * pageSize),
    [filteredResults, page, pageSize]
  )

  useEffect(() => {
    setPage(0)
  }, [filterStatus, debouncedSearch, debouncedRemarksFilter])

  useEffect(() => {
    const maxPage = Math.max(0, Math.ceil(totalFiltered / pageSize) - 1)
    if (page > maxPage) setPage(maxPage)
  }, [totalFiltered, pageSize, page])

  const exportResults = (exportFiltered = false) => {
    const data = exportFiltered ? filteredResults : (results.validationResults || [])
    const exportData = data.map(rowToExportRow)
    const headers = EXPORT_COLUMNS.map(([, label]) => label)
    const worksheet = XLSX.utils.json_to_sheet(exportData, { header: headers })
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Validation Results')
    const suffix = exportFiltered ? '_filtered' : ''
    XLSX.writeFile(workbook, `validation_results_${new Date().toISOString().split('T')[0]}${suffix}.xlsx`)
  }

  return (
    <div className="results-section">
      <h2>Validation Results</h2>
      <div className="results-summary-grid">
        <div className="summary-card total">
          <div className="summary-icon">📊</div>
          <div className="summary-content">
            <span className="summary-label">Total Lines</span>
            <span className="summary-value">{results.totalLines}</span>
          </div>
        </div>
        <div className="summary-card passed">
          <div className="summary-icon">✅</div>
          <div className="summary-content">
            <span className="summary-label">Passed</span>
            <span className="summary-value">{summaryCounts.passedMatch}</span>
          </div>
        </div>
        <div className="summary-card failed">
          <div className="summary-icon">❌</div>
          <div className="summary-content">
            <span className="summary-label">Failed</span>
            <span className="summary-value">{summaryCounts.failedMatch}</span>
          </div>
        </div>
      </div>
      <div className="results-status-grid">
        <div className="status-card qli-success">
          <div className="status-icon">✓</div>
          <div className="status-content">
            <span className="status-label">QLI Validation Success</span>
            <span className="status-value">{statusCounts.qliSuccess}</span>
          </div>
        </div>
        <div className="status-card qli-failed">
          <div className="status-icon">✗</div>
          <div className="status-content">
            <span className="status-label">QLI Validation Failed</span>
            <span className="status-value">{statusCounts.qliFailed}</span>
          </div>
        </div>
        <div className="status-card moved-rc">
          <div className="status-icon">→</div>
          <div className="status-content">
            <span className="status-label">Moved to RC Validation</span>
            <span className="status-value">{statusCounts.movedToRc}</span>
          </div>
        </div>
        <div className="status-card rc-success">
          <div className="status-icon">✓</div>
          <div className="status-content">
            <span className="status-label">RC Validation Success</span>
            <span className="status-value">{statusCounts.rcSuccess}</span>
          </div>
        </div>
        <div className="status-card rc-failed">
          <div className="status-icon">✗</div>
          <div className="status-content">
            <span className="status-label">RC Validation Failed</span>
            <span className="status-value">{statusCounts.rcFailed}</span>
          </div>
        </div>
      </div>

      <div className="results-controls">
        <div className="filter-group">
          <label>Filter by Status:</label>
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="status-filter">
            <option value="all">All Results ({results.totalLines})</option>
            <option value="Passed">Passed ({summaryCounts.passedMatch})</option>
            <option value="Failed">Failed ({summaryCounts.failedMatch})</option>
            <option value="qli-success">QLI Validation Success ({statusCounts.qliSuccess})</option>
            <option value="qli-failed">QLI Validation Failed ({statusCounts.qliFailed})</option>
            <option value="moved-rc">Moved to RC Validation ({statusCounts.movedToRc})</option>
            <option value="rc-success">RC Validation Success ({statusCounts.rcSuccess})</option>
            <option value="rc-failed">RC Validation Failed ({statusCounts.rcFailed})</option>
          </select>
        </div>
        <div className="search-group">
          <input
            type="text"
            placeholder="Search by PO, IBX, Site ID, Description..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="results-search"
          />
        </div>
        <div className="search-group remarks-filter-group">
          <label htmlFor="remarks-filter">Filter by Remarks:</label>
          <input
            id="remarks-filter"
            type="text"
            placeholder="e.g. Service Start Date, rate card, No match..."
            value={remarksFilter}
            onChange={(e) => setRemarksFilter(e.target.value)}
            className="results-search remarks-filter"
          />
        </div>
        <div className="export-group">
          <button onClick={exportResults} className="export-results-btn">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Download full results (all columns)
          </button>
          <button onClick={() => exportResults(true)} className="export-filtered-btn" title="Export currently filtered rows with all columns">
            Download current view
          </button>
        </div>
      </div>

      <div className="results-table-container">
        <div className="results-table-header-row">
          <p className="showing-results">
            Showing {totalFiltered === 0 ? 0 : page * pageSize + 1}–{Math.min((page + 1) * pageSize, totalFiltered)} of {totalFiltered} (filtered from {results.totalLines})
          </p>
          <div className="pagination-controls">
            <label className="page-size-label">
              Rows per page:
              <select
                value={pageSize}
                onChange={(e) => { setPageSize(Number(e.target.value)); setPage(0) }}
                className="page-size-select"
              >
                {PAGE_SIZES.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="pagination-btn"
              aria-label="Previous page"
            >
              Previous
            </button>
            <span className="pagination-page">Page {page + 1} of {totalPages}</span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="pagination-btn"
              aria-label="Next page"
            >
              Next
            </button>
          </div>
        </div>
        <div className="results-table-wrapper">
          <table className="results-table">
            <thead>
              <tr>
                <th>Row</th>
                <th>ILI Number</th>
                <th>QLI Number</th>
                <th>ILI PO Number</th>
                <th>QLI PO Number</th>
                <th>QLI Currency</th>
                <th>ILI IBX</th>
                <th>ILI Business Unit</th>
                <th>ILI CURR</th>
                <th>ILI Category</th>
                <th>ILI Charge Type</th>
                <th>QLI Site ID</th>
                <th>Invoice Item Code</th>
                <th>Quote Item Code</th>
                <th>ILI Quantity</th>
                <th>QLI Quantity</th>
                <th>ILI Unit Price</th>
                <th>QLI Unit Price</th>
                <th>LLA (effective)</th>
                <th>LLA calculated</th>
                <th>ELLA</th>
                <th>ILI Description</th>
                <th>QLI Description</th>
                <th>ILI Desc Tokens</th>
                <th>QLI Desc Tokens</th>
                <th>Desc Match %</th>
                <th>ILI Invoice Start Date</th>
                <th>QLI Invoice Start Date</th>
                <th>ILI Renewal Term</th>
                <th>QLI Renewal Term</th>
                <th>ILI First Price Inc After</th>
                <th>QLI First Price Inc After</th>
                <th>ILI Price Inc %</th>
                <th>QLI Price Inc %</th>
                <th>ILI Billing From</th>
                <th>ILI Billing Till</th>
                <th>Prorata Factor</th>
                <th>RC Sub Type</th>
                <th>RC Effective From</th>
                <th>RC Effective Till</th>
                <th>RC Country</th>
                <th>RC Region</th>
                <th>RC Unit Price Used</th>
                <th>RC u_pricekva</th>
                <th>RC u_rate</th>
                <th>RC u_nrc</th>
                <th>RC Cabinet Density</th>
                <th>RC u_parameter1</th>
                <th>RC u_goods_services_category</th>
                <th>RC u_amps</th>
                <th>RC u_volt</th>
                <th>RC ICB Flag</th>
                <th>Expected Result</th>
                <th>Status</th>
                <th>Validation Step</th>
                <th>Remarks</th>
              </tr>
            </thead>
            <tbody>
              {paginatedResults.map((result) => (
                <ResultRow key={result.row} result={result} />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {totalFiltered === 0 && (
        <div className="no-results">
          <p>No results match your filters</p>
        </div>
      )}
    </div>
  )
}

function ExcelValidation() {
  const [baseFile, setBaseFile] = useState(null)
  const [quoteFile, setQuoteFile] = useState(null)
  const [rateCardFile, setRateCardFile] = useState(null)
  const [baseData, setBaseData] = useState(null)
  const [quoteData, setQuoteData] = useState(null)
  const [rateCardData, setRateCardData] = useState(null)
  const [rateCardConfig, setRateCardConfig] = useState(null)
  const [loading, setLoading] = useState(false)
  const [validationResults, setValidationResults] = useState(null)
  const [validationRunning, setValidationRunning] = useState(false)
  const [validationProgress, setValidationProgress] = useState(0)
  const [priceTolerance, setPriceTolerance] = useState(5)
  const [qtyTolerance, setQtyTolerance] = useState(20)
  const deferredValidationResults = useDeferredValue(validationResults)

  useEffect(() => {
    fetch('/rate-card-types.json')
      .then(res => res.ok ? res.json() : null)
      .then(data => setRateCardConfig(Array.isArray(data) ? data : null))
      .catch(() => setRateCardConfig(null))
  }, [])

  // Normalize column headers: trim leading/trailing spaces so " UNIT_SELLING_PRICE " matches expected "UNIT_SELLING_PRICE"
  const normalizeSheetKeys = (rows) => {
    if (!Array.isArray(rows) || rows.length === 0) return rows
    return rows.map(row => {
      const out = {}
      for (const [k, v] of Object.entries(row)) {
        const key = k != null ? String(k).trim() : ''
        out[key] = v
      }
      return out
    })
  }

  // Build rows from raw arrays using first row as header (avoids losing columns when sheet has merged cells or empty header cells)
  const sheetToJsonWithHeaderRow = (worksheet) => {
    const raw = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' })
    if (!raw.length) return []
    const headerRow = raw[0].map(h => (h != null ? String(h).trim() : ''))
    const data = raw.slice(1).map(row => {
      const obj = {}
      headerRow.forEach((h, i) => {
        if (h) obj[h] = row[i]
      })
      return obj
    })
    return data
  }

  // Rate card: make duplicate headers unique (e.g. "IBX", "IBX" -> "IBX", "IBX (2)") so no columns are lost
  const sheetToJsonRateCardWithUniqueHeaders = (worksheet) => {
    const raw = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' })
    if (!raw.length) return []
    const headerRow = raw[0].map(h => (h != null ? String(h).trim() : ''))
    const seen = new Map()
    const uniqueHeaders = headerRow.map((h, i) => {
      if (!h) return `Column_${i}`
      const count = (seen.get(h) || 0) + 1
      seen.set(h, count)
      return count === 1 ? h : `${h} (${count})`
    })
    const data = raw.slice(1).map(row => {
      const obj = {}
      uniqueHeaders.forEach((key, i) => {
        obj[key] = row[i]
      })
      return obj
    })
    return data
  }

  const handleFileUpload = (file, fileType) => {
    if (!file) return
    setLoading(true)
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const workbook = XLSX.read(e.target.result, { type: 'binary' })
        const sheetName = workbook.SheetNames[0]
        const worksheet = workbook.Sheets[sheetName]
        let jsonData = XLSX.utils.sheet_to_json(worksheet)
        const defaultKeys = jsonData.length > 0 ? Object.keys(jsonData[0] || {}) : []
        const raw = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' })
        const firstRowLen = (raw[0] || []).length
        const firstRowFilled = (raw[0] || []).filter(c => c != null && String(c).trim() !== '').length
        if (fileType === 'ratecard') {
          jsonData = sheetToJsonRateCardWithUniqueHeaders(worksheet)
        } else if (firstRowLen >= 5 && firstRowFilled > defaultKeys.length) {
          jsonData = sheetToJsonWithHeaderRow(worksheet)
        }
        jsonData = normalizeSheetKeys(jsonData)
        const fileInfo = {
          name: file.name,
          sheets: workbook.SheetNames,
          selectedSheet: sheetName,
          rowCount: jsonData.length,
          columns: jsonData.length > 0 ? Object.keys(jsonData[0]) : [],
          data: jsonData,
          workbook
        }
        if (fileType === 'base') {
          setBaseFile(fileInfo)
          setBaseData(jsonData)
        } else if (fileType === 'quote') {
          setQuoteFile(fileInfo)
          setQuoteData(jsonData)
        } else {
          setRateCardFile(fileInfo)
          setRateCardData(jsonData)
        }
        setLoading(false)
      } catch (error) {
        console.error('Error reading file:', error)
        alert('Error reading file: ' + error.message)
        setLoading(false)
      }
    }
    reader.readAsBinaryString(file)
  }

  const clearFile = (fileType) => {
    if (fileType === 'base') {
      setBaseFile(null)
      setBaseData(null)
    } else if (fileType === 'quote') {
      setQuoteFile(null)
      setQuoteData(null)
    } else {
      setRateCardFile(null)
      setRateCardData(null)
    }
    setValidationResults(null)
  }

  const clearAll = () => {
    setBaseFile(null)
    setQuoteFile(null)
    setRateCardFile(null)
    setBaseData(null)
    setQuoteData(null)
    setRateCardData(null)
    setValidationResults(null)
  }

  const allFilesUploaded = baseFile && quoteFile

  const workerRef = useRef(null)
  const getWorker = () => {
    if (workerRef.current) return workerRef.current
    try {
      workerRef.current = new Worker(new URL('./validation.worker.js', import.meta.url), { type: 'module' })
    } catch (_) {
      return null
    }
    return workerRef.current
  }

  const runValidation = async () => {
    if (!baseData || !quoteData) {
      alert('Please upload both Base File (Invoice) and Quote File before running validation.')
      return
    }
    setValidationRunning(true)
    setValidationProgress(0)
    let config = rateCardConfig
    if (!config && rateCardData) {
      try {
        const res = await fetch('/rate-card-types.json')
        if (res.ok) config = await res.json()
      } catch (_) {}
    }
    const priceTol = (priceTolerance || 0) / 100
    const qtyTol = (qtyTolerance || 0) / 100
    const options = {
      priceTolerance: priceTol,
      qtyTolerance: qtyTol,
      rateCardData: rateCardData || undefined,
      rateCardConfig: Array.isArray(config) ? config : undefined
    }

    const worker = getWorker()
    if (worker) {
      worker.onmessage = (e) => {
        if (e.data.error) {
          alert('Error during validation: ' + e.data.error)
        } else {
          startTransition(() => {
            setValidationResults(e.data.result)
          })
        }
        setValidationRunning(false)
        setValidationProgress(100)
      }
      worker.onerror = () => {
        runValidationOnMainThread()
      }
      worker.postMessage({ baseData, quoteData, options })
    } else {
      runValidationOnMainThread()
    }

    function runValidationOnMainThread() {
      try {
        const result = runValidationLogic(baseData, quoteData, options)
        startTransition(() => {
          setValidationResults(result)
        })
      } catch (error) {
        console.error('Validation error:', error)
        alert('Error during validation: ' + error.message)
      }
      setValidationRunning(false)
      setValidationProgress(100)
    }
  }

  return (
    <div className="excel-validation-container">
      <header className="validation-header">
        <h1>Invoice vs Quote Validation</h1>
        <p>Two files: Base (Invoice line items) and Quote (Quote line items). Validate by PO, IBX, product/charge, price, and quantity.</p>
      </header>

      <div className="info-banner">
        <div className="info-icon">ℹ️</div>
        <div className="info-content">
          <strong>Quick Guide:</strong>
          <ul>
            <li><strong>Base File (Invoice):</strong> Book1-style with TRX_NUMBER, LINE_NUMBER, SERIAL_NUMBER, PO_NUMBER, IBX, ITEM_NUMBER/PRODUCT_CODE, DESCRIPTION, QUANTITY, UNIT_SELLING_PRICE, LINE_LEVEL_AMOUNT. Optional: BILLING_FROM, BILLING_TILL.</li>
            <li><strong>Quote File:</strong> Po Number, Site ID/IBX, Item Code, Item Description, Changed Item Description, Quantity, Unit Price (OTC/MRC). Optional: service_start_date, initial_term, term, Initial_term_Increment, Increment, contract_period_in_months.</li>
          </ul>
          <p className="tip">Outcomes: <strong>Passed</strong> (all match), <strong>Failed</strong> (e.g. price/quantity anomaly), <strong>Skipped</strong> (no QLIs or no matching QLI).</p>
          <p className="tip">Optional <strong>Rate Card File</strong>: Upload to validate <strong>Skipped</strong> lines against rate card (Space &amp; Power, Power Install NRC, Secure Cabinet Express, etc.). Uses same price tolerance. Config: <code>public/rate-card-types.json</code>.</p>
        </div>
      </div>

      <div className="upload-section-grid two-files">
        <div className="upload-card main-file">
          <div className="upload-card-header">
            <h3><span className="file-icon">📄</span> Base File (Invoice Line Items)</h3>
          </div>
          {!baseFile ? (
            <label className="upload-area">
              <input type="file" accept=".xlsx,.xls" onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0], 'base')} className="file-input-hidden" />
              <div className="upload-placeholder">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
                <p className="upload-text">Click to upload Base Excel file (e.g. Book1 test 2)</p>
                <p className="upload-hint">.xlsx / .xls</p>
              </div>
            </label>
          ) : (
            <div className="file-info">
              <div className="file-details">
                <p className="file-name"><strong>{baseFile.name}</strong></p>
                <div className="file-stats">
                  <span className="stat-badge">📊 {baseFile.rowCount.toLocaleString()} rows</span>
                  <span className="stat-badge">📋 {baseFile.columns.length} columns</span>
                </div>
                <div className="column-preview">
                  <strong>Columns:</strong>
                  <div className="column-tags">
                    {baseFile.columns.slice(0, 6).map((col, idx) => <span key={idx} className="column-tag">{col}</span>)}
                    {baseFile.columns.length > 6 && <span className="column-tag more">+{baseFile.columns.length - 6} more</span>}
                  </div>
                </div>
              </div>
              <button onClick={() => clearFile('base')} className="clear-btn">Remove</button>
            </div>
          )}
        </div>

        <div className="upload-card ref-file">
          <div className="upload-card-header">
            <h3><span className="file-icon">📘</span> Quote File (Quote Line Items)</h3>
          </div>
          {!quoteFile ? (
            <label className="upload-area">
              <input type="file" accept=".xlsx,.xls" onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0], 'quote')} className="file-input-hidden" />
              <div className="upload-placeholder">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
                <p className="upload-text">Click to upload Quote Excel file</p>
                <p className="upload-hint">.xlsx / .xls</p>
              </div>
            </label>
          ) : (
            <div className="file-info">
              <div className="file-details">
                <p className="file-name"><strong>{quoteFile.name}</strong></p>
                <div className="file-stats">
                  <span className="stat-badge">📊 {quoteFile.rowCount.toLocaleString()} rows</span>
                  <span className="stat-badge">📋 {quoteFile.columns.length} columns</span>
                </div>
                <div className="column-preview">
                  <strong>Columns:</strong>
                  <div className="column-tags">
                    {quoteFile.columns.slice(0, 6).map((col, idx) => <span key={idx} className="column-tag">{col}</span>)}
                    {quoteFile.columns.length > 6 && <span className="column-tag more">+{quoteFile.columns.length - 6} more</span>}
                  </div>
                </div>
              </div>
              <button onClick={() => clearFile('quote')} className="clear-btn">Remove</button>
            </div>
          )}
        </div>

        <div className="upload-card ref-file rate-card">
          <div className="upload-card-header">
            <h3><span className="file-icon">📋</span> Rate Card File (Optional)</h3>
          </div>
          {!rateCardFile ? (
            <label className="upload-area">
              <input type="file" accept=".xlsx,.xls" onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0], 'ratecard')} className="file-input-hidden" />
              <div className="upload-placeholder">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
                <p className="upload-text">Click to upload Rate Card Excel (optional)</p>
                <p className="upload-hint">Validates &quot;For Rate Card&quot; lines</p>
              </div>
            </label>
          ) : (
            <div className="file-info">
              <div className="file-details">
                <p className="file-name"><strong>{rateCardFile.name}</strong></p>
                <div className="file-stats">
                  <span className="stat-badge">📊 {rateCardFile.rowCount.toLocaleString()} rows</span>
                  <span className="stat-badge">📋 {rateCardFile.columns.length} columns</span>
                </div>
              </div>
              <button onClick={() => clearFile('ratecard')} className="clear-btn">Remove</button>
            </div>
          )}
        </div>
      </div>

      {allFilesUploaded && (
        <>
          <div className="tolerance-section">
            <h4>Tolerance Settings</h4>
            <div className="tolerance-inputs">
              <label>
                Price tolerance (%): <input type="number" min="0" max="100" step="0.5" value={priceTolerance} onChange={(e) => setPriceTolerance(Number(e.target.value) || 0)} />
              </label>
              <label>
                Quantity tolerance (%): <input type="number" min="0" max="100" step="1" value={qtyTolerance} onChange={(e) => setQtyTolerance(Number(e.target.value) || 0)} />
              </label>
            </div>
            <p className="tolerance-hint">E.g. 5% price tolerance: invoice unit price can be up to CUP × 1.05. 20% quantity: invoice qty can be up to quote qty × 1.20.</p>
          </div>

          {validationRunning && (
            <div className="progress-section">
              <div className="progress-info"><span>Processing validation...</span><span className="progress-percent">{validationProgress}%</span></div>
              <div className="progress-bar-container"><div className="progress-bar" style={{ width: `${validationProgress}%` }}></div></div>
            </div>
          )}

          <div className="action-section">
            <button onClick={runValidation} className="validate-btn" disabled={validationRunning}>
              {validationRunning ? <><span className="spinner-small"></span> Running Validation... {validationProgress}%</> : <>Run Validation</>}
            </button>
            <button onClick={clearAll} className="clear-all-btn">Clear All Files</button>
          </div>
        </>
      )}

      {validationResults && validationResults.status === 'completed' && (
        <ValidationResults results={deferredValidationResults} />
      )}

      {loading && (
        <div className="loading-overlay">
          <div className="spinner"></div>
          <p>Loading file...</p>
        </div>
      )}
    </div>
  )
}

export default ExcelValidation
