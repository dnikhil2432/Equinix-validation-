import { useState, useMemo } from 'react'
import * as XLSX from 'xlsx'
import Papa from 'papaparse'
import {
  useReactTable,
  getCoreRowModel,
  getPaginationRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  flexRender,
} from '@tanstack/react-table'
import './DataViewer.css'

// --- Invoice consolidation: unique key and column variants ---
const INVOICE_KEY_COLUMNS = [
  'TRX_NUMBER',
  'BILLING_AGREEMENT',
  'SERIAL_NUMBER',
  'RECURRING_CHARGE_FROM_DATE',
  'RECURRING_CHARGE_TO_DATE',
]

const QUANTITY_VARIANTS = ['QUANTITY', 'quantity', 'Quantity', 'QTY', 'qty']
const UNIT_SELLING_PRICE_VARIANTS = ['UNIT_SELLING_PRICE', 'unit_selling_price', 'Unit Selling Price', 'UNIT_PRICE', 'unit_price']
const LLA_VARIANTS = ['LINE_LEVEL_AMOUNT', 'line_level_amount', 'Line Level Amount', 'LLA', 'lla', 'ELLA', 'ella', 'EFFECTIVE_LLA', 'effective_lla']
const CHARGE_TYPE_VARIANTS = ['CHARGE_TYPE', 'charge_type', 'Charge Type', 'CHARGE_TYPE_ILI', 'charge_type_ili']

function normalizeKeyName(name) {
  return String(name ?? '')
    .replace(/\s+/g, '_')
    .toLowerCase()
}

function findColumnKey(headerKeys, variants) {
  const normalized = headerKeys.map((k) => ({ original: k, norm: normalizeKeyName(k) }))
  for (const v of variants) {
    const vNorm = normalizeKeyName(v)
    const found = normalized.find(({ norm }) => norm === vNorm)
    if (found) return found.original
  }
  return null
}

function getNum(row, colKey) {
  if (!row || colKey == null) return NaN
  const val = row[colKey]
  if (val == null || val === '') return NaN
  const cleaned = String(val).replace(/[$,]/g, '')
  return parseFloat(cleaned)
}

function getStr(row, colKey) {
  if (!row || colKey == null) return ''
  const val = row[colKey]
  return val != null && val !== '' ? String(val).trim() : ''
}

function getCompositeKey(row, keyCols) {
  return keyCols.map((col) => String(row[col] ?? '').trim()).join('|')
}

function mergeTwoRows(row1, row2, colKeys) {
  const { quantity: qtyKey, unit_selling_price: priceKey, lla: llaKey, charge_type: chargeKey } = colKeys
  const qty1 = getNum(row1, qtyKey)
  const qty2 = getNum(row2, qtyKey)
  const price1 = getNum(row1, priceKey)
  const price2 = getNum(row2, priceKey)
  const lla1 = getNum(row1, llaKey)
  const lla2 = getNum(row2, llaKey)
  const absQty1 = Math.abs(qty1)
  const absQty2 = Math.abs(qty2)

  const sign1 = qty1 >= 0 ? 1 : -1
  const sign2 = qty2 >= 0 ? 1 : -1
  const adjustedPrice1 = sign1 * (isNaN(price1) ? 0 : price1)
  const adjustedPrice2 = sign2 * (isNaN(price2) ? 0 : price2)
  const consolidatedPrice = adjustedPrice1 + adjustedPrice2
  const consolidatedLla = (isNaN(lla1) ? 0 : lla1) + (isNaN(lla2) ? 0 : lla2)
  const baseRow = qty1 >= 0 ? { ...row1 } : { ...row2 }
  const consolidatedQty = absQty1

  baseRow[qtyKey] = consolidatedQty
  baseRow[priceKey] = consolidatedPrice
  if (llaKey) baseRow[llaKey] = consolidatedLla
  if (chargeKey) {
    baseRow[chargeKey] = getStr(qty1 >= 0 ? row1 : row2, chargeKey)
  }
  return baseRow
}

function analyzeInvoiceConsolidation(rawData) {
  if (!rawData || rawData.length === 0) return { exceptionRows: [], consolidatedRows: [], keyColumnNames: null, columnKeys: null }

  const headerKeys = Object.keys(rawData[0] || {})
  const keyColumnNames = INVOICE_KEY_COLUMNS.map((k) => {
    const norm = normalizeKeyName(k)
    const found = headerKeys.find((h) => normalizeKeyName(h) === norm)
    return found || null
  })
  if (keyColumnNames.some((k) => !k)) {
    return { exceptionRows: [], consolidatedRows: [], keyColumnNames: null, columnKeys: null }
  }

  const qtyKey = findColumnKey(headerKeys, QUANTITY_VARIANTS)
  const priceKey = findColumnKey(headerKeys, UNIT_SELLING_PRICE_VARIANTS)
  let llaKey = findColumnKey(headerKeys, LLA_VARIANTS)
  if (!llaKey) {
    const fallback = headerKeys.find((k) => {
      const n = normalizeKeyName(k)
      return n.includes('line_level') || n === 'lla'
    })
    if (fallback) llaKey = fallback
  }
  const chargeKey = findColumnKey(headerKeys, CHARGE_TYPE_VARIANTS)
  const columnKeys = { quantity: qtyKey, unit_selling_price: priceKey, lla: llaKey, charge_type: chargeKey }

  const groups = new Map()
  rawData.forEach((row, index) => {
    const key = getCompositeKey(row, keyColumnNames)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push({ row, index })
  })

  const exceptionRows = []
  const consolidatedRows = []

  groups.forEach((entries) => {
    const rows = entries.map((e) => e.row)
    if (rows.length >= 3) {
      exceptionRows.push(...rows)
      return
    }
    if (rows.length === 2) {
      const qty1 = getNum(rows[0], qtyKey)
      const qty2 = getNum(rows[1], qtyKey)
      const abs1 = Math.abs(qty1)
      const abs2 = Math.abs(qty2)
      if (abs1 !== abs2) {
        exceptionRows.push(...rows)
        return
      }
      consolidatedRows.push(mergeTwoRows(rows[0], rows[1], columnKeys))
      return
    }
    consolidatedRows.push(rows[0])
  })

  return {
    exceptionRows,
    consolidatedRows,
    keyColumnNames,
    columnKeys,
  }
}

function downloadAsCSV(rows, columns, filename) {
  if (rows.length === 0) return
  const header = columns.join(',')
  const csvRows = rows.map((row) =>
    columns
      .map((col) => {
        const value = row[col]
        if (value === null || value === undefined) return ''
        const s = String(value)
        if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`
        return s
      })
      .join(',')
  )
  const csv = `${header}\n${csvRows.join('\n')}`
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = filename
  link.style.visibility = 'hidden'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(link.href)
}

function downloadAsExcel(rows, columns, filename) {
  if (rows.length === 0) return
  const wsData = [columns, ...rows.map((row) => columns.map((c) => row[c] ?? ''))]
  const ws = XLSX.utils.aoa_to_sheet(wsData)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  XLSX.writeFile(wb, filename)
}

// Column Filter Component
function ColumnFilter({ column }) {
  const columnFilterValue = column.getFilterValue()

  return (
    <input
      type="text"
      value={(columnFilterValue ?? '')}
      onChange={(e) => column.setFilterValue(e.target.value)}
      placeholder={`Filter...`}
      className="column-filter-input"
      onClick={(e) => e.stopPropagation()}
    />
  )
}

function DataViewer() {
  const [data, setData] = useState([])
  const [columns, setColumns] = useState([])
  const [fileName, setFileName] = useState('')
  const [globalFilter, setGlobalFilter] = useState('')
  const [columnFilters, setColumnFilters] = useState([])
  const [sorting, setSorting] = useState([])
  const [loading, setLoading] = useState(false)
  const [filterMode, setFilterMode] = useState('all') // 'all', 'duplicates', 'unique'
  const [duplicateStats, setDuplicateStats] = useState(null)
  const [invoiceConsolidation, setInvoiceConsolidation] = useState(null)

  // Analyze duplicates based on primary key columns
  const analyzeDuplicates = (rawData) => {
    const primaryKeys = ['SERIAL_NUMBER', 'TRX_NUMBER', 'LINE_NUMBER']
    
    // Check if all primary key columns exist
    const sampleRow = rawData[0] || {}
    const missingKeys = primaryKeys.filter(key => !(key in sampleRow))
    
    if (missingKeys.length > 0) {
      console.warn('Missing primary key columns:', missingKeys)
    }

    // Create a map to track duplicates and store first occurrence
    const keyMap = new Map()
    const duplicateGroups = []
    
    rawData.forEach((row, index) => {
      // Create composite key from primary key columns
      const compositeKey = primaryKeys
        .map(key => String(row[key] || '').trim())
        .join('|')
      
      if (keyMap.has(compositeKey)) {
        // This is a duplicate - increment count
        const existing = keyMap.get(compositeKey)
        existing.count++
        existing.indices.push(index)
      } else {
        // First occurrence - store it
        keyMap.set(compositeKey, {
          row: row,
          count: 1,
          indices: [index],
          compositeKey: compositeKey
        })
      }
    })

    // Identify duplicate groups and create deduplicated data
    let totalDuplicates = 0
    let duplicateGroupCount = 0
    const deduplicatedData = []
    
    keyMap.forEach((value, key) => {
      // Add the first occurrence with count
      const enrichedRow = {
        ...value.row,
        _isDuplicate: value.count > 1,
        _duplicateCount: value.count,
        _duplicateGroup: value.count > 1 ? key : null,
        _rowIndex: value.indices[0],
        _totalOccurrences: value.count
      }
      deduplicatedData.push(enrichedRow)
      
      // Track statistics
      if (value.count > 1) {
        duplicateGroupCount++
        totalDuplicates += value.count
        duplicateGroups.push({
          key,
          count: value.count,
          indices: value.indices
        })
      }
    })

    return {
      enrichedData: deduplicatedData,
      stats: {
        totalRecords: rawData.length,
        uniqueRecords: keyMap.size,
        duplicateRecords: totalDuplicates,
        duplicateGroups: duplicateGroupCount,
        duplicateGroupDetails: duplicateGroups.sort((a, b) => b.count - a.count)
      }
    }
  }

  const handleFileUpload = (event) => {
    const file = event.target.files[0]
    if (!file) return

    setLoading(true)
    setFileName(file.name)
    setFilterMode('all')
    const reader = new FileReader()

    reader.onload = (e) => {
      try {
        const fileExtension = file.name.split('.').pop().toLowerCase()

        if (fileExtension === 'csv') {
          // Parse CSV
          Papa.parse(e.target.result, {
            header: true,
            skipEmptyLines: true,
            complete: (results) => {
              if (results.data.length > 0) {
                const rawData = results.data
                const consolidation = analyzeInvoiceConsolidation(rawData)
                const headerKeys = Object.keys(rawData[0]).filter((k) => !k.startsWith('_'))

                if (consolidation.keyColumnNames) {
                  setInvoiceConsolidation({
                    exceptionRows: consolidation.exceptionRows,
                    consolidatedRows: consolidation.consolidatedRows,
                  })
                  setDuplicateStats(null)
                  const cols = headerKeys.map((key) => ({
                    accessorKey: key,
                    header: key,
                    cell: (info) => info.getValue(),
                    enableColumnFilter: true,
                    enableSorting: true,
                  }))
                  setColumns(cols)
                  setData(consolidation.consolidatedRows)
                } else {
                  setInvoiceConsolidation(null)
                  const { enrichedData, stats } = analyzeDuplicates(rawData)
                  const cols = Object.keys(rawData[0]).map((key) => ({
                    accessorKey: key,
                    header: key,
                    cell: (info) => info.getValue(),
                    enableColumnFilter: true,
                    enableSorting: true,
                  }))
                  cols.unshift({
                    accessorKey: '_duplicateCount',
                    header: 'Occurrence Count',
                    enableColumnFilter: true,
                    enableSorting: true,
                    cell: (info) => {
                      const count = info.getValue()
                      return count > 1 ? (
                        <span style={{ background: '#ff4444', color: 'white', padding: '6px 12px', borderRadius: '6px', fontWeight: 'bold', fontSize: '0.95rem', display: 'inline-block', minWidth: '40px', textAlign: 'center' }}>{count}</span>
                      ) : (
                        <span style={{ color: '#4caf50', fontWeight: '600', fontSize: '0.95rem' }}>{count}</span>
                      )
                    },
                  })
                  setColumns(cols)
                  setData(enrichedData)
                  setDuplicateStats(stats)
                }
              }
              setLoading(false)
            },
            error: (error) => {
              console.error('CSV parsing error:', error)
              alert('Error parsing CSV file')
              setLoading(false)
            },
          })
        } else if (['xlsx', 'xls'].includes(fileExtension)) {
          // Parse Excel
          const workbook = XLSX.read(e.target.result, { type: 'binary' })
          const sheetName = workbook.SheetNames[0]
          const worksheet = workbook.Sheets[sheetName]
          const jsonData = XLSX.utils.sheet_to_json(worksheet)

          if (jsonData.length > 0) {
            const rawData = jsonData
            const consolidation = analyzeInvoiceConsolidation(rawData)
            const headerKeys = Object.keys(rawData[0]).filter((k) => !k.startsWith('_'))

            if (consolidation.keyColumnNames) {
              setInvoiceConsolidation({
                exceptionRows: consolidation.exceptionRows,
                consolidatedRows: consolidation.consolidatedRows,
              })
              setDuplicateStats(null)
              const cols = headerKeys.map((key) => ({
                accessorKey: key,
                header: key,
                cell: (info) => info.getValue(),
                enableColumnFilter: true,
                enableSorting: true,
              }))
              setColumns(cols)
              setData(consolidation.consolidatedRows)
            } else {
              setInvoiceConsolidation(null)
              const { enrichedData, stats } = analyzeDuplicates(rawData)
              const cols = Object.keys(rawData[0]).map((key) => ({
                accessorKey: key,
                header: key,
                cell: (info) => info.getValue(),
                enableColumnFilter: true,
                enableSorting: true,
              }))
              cols.unshift({
                accessorKey: '_duplicateCount',
                header: 'Occurrence Count',
                enableColumnFilter: true,
                enableSorting: true,
                cell: (info) => {
                  const count = info.getValue()
                  return count > 1 ? (
                    <span style={{ background: '#ff4444', color: 'white', padding: '6px 12px', borderRadius: '6px', fontWeight: 'bold', fontSize: '0.95rem', display: 'inline-block', minWidth: '40px', textAlign: 'center' }}>{count}</span>
                  ) : (
                    <span style={{ color: '#4caf50', fontWeight: '600', fontSize: '0.95rem' }}>{count}</span>
                  )
                },
              })
              setColumns(cols)
              setData(enrichedData)
              setDuplicateStats(stats)
            }
          }
          setLoading(false)
        } else {
          alert('Please upload a CSV or Excel file')
          setLoading(false)
        }
      } catch (error) {
        console.error('File parsing error:', error)
        alert('Error parsing file')
        setLoading(false)
      }
    }

    if (file.name.endsWith('.csv')) {
      reader.readAsText(file)
    } else {
      reader.readAsBinaryString(file)
    }
  }

  // Filter data based on selected mode
  const filteredData = useMemo(() => {
    if (filterMode === 'duplicates') {
      // Show only records that have duplicates (count > 1)
      return data.filter(row => row._duplicateCount > 1)
    } else if (filterMode === 'unique') {
      // Show only records that are unique (count = 1)
      return data.filter(row => row._duplicateCount === 1)
    }
    return data
  }, [data, filterMode])

  const exportColumns = useMemo(
    () => columns.map((col) => col.accessorKey).filter((key) => !key.startsWith('_')),
    [columns]
  )

  const downloadExceptionFile = () => {
    if (!invoiceConsolidation || invoiceConsolidation.exceptionRows.length === 0) return
    const base = fileName ? fileName.replace(/\.[^.]+$/, '') : 'invoice'
    const ext = fileName && /\.(xlsx|xls)$/i.test(fileName) ? (fileName.endsWith('.xls') ? 'xls' : 'xlsx') : 'csv'
    const name = `${base}_exception.${ext}`
    if (ext === 'csv') {
      downloadAsCSV(invoiceConsolidation.exceptionRows, exportColumns, name)
    } else {
      downloadAsExcel(invoiceConsolidation.exceptionRows, exportColumns, name)
    }
  }

  const downloadConsolidatedFile = () => {
    if (!invoiceConsolidation || invoiceConsolidation.consolidatedRows.length === 0) return
    const base = fileName ? fileName.replace(/\.[^.]+$/, '') : 'invoice'
    const ext = fileName && /\.(xlsx|xls)$/i.test(fileName) ? (fileName.endsWith('.xls') ? 'xls' : 'xlsx') : 'csv'
    const name = `${base}_consolidated.${ext}`
    if (ext === 'csv') {
      downloadAsCSV(invoiceConsolidation.consolidatedRows, exportColumns, name)
    } else {
      downloadAsExcel(invoiceConsolidation.consolidatedRows, exportColumns, name)
    }
  }

  // Export data to CSV (for non-invoice / legacy duplicate view)
  const exportToCSV = () => {
    if (filteredData.length === 0) return
    const filterLabel = filterMode === 'duplicates' ? 'duplicates' : filterMode === 'unique' ? 'unique' : 'all'
    const base = fileName ? fileName.replace(/\.[^.]+$/, '') : 'export'
    downloadAsCSV(filteredData, exportColumns, `${base}_${filterLabel}.csv`)
  }

  const table = useReactTable({
    data: filteredData,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    state: {
      globalFilter,
      columnFilters,
      sorting,
    },
    onGlobalFilterChange: setGlobalFilter,
    onColumnFiltersChange: setColumnFilters,
    onSortingChange: setSorting,
    initialState: {
      pagination: {
        pageSize: 50,
      },
    },
  })

  return (
    <div className="app-container">
      <header className="header">
        <h1>CSV / Excel Data Viewer</h1>
        <p>Upload your CSV or Excel file to view data in a table</p>
      </header>

      <div className="upload-section">
        <label htmlFor="file-upload" className="file-upload-label">
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          Choose File
        </label>
        <input
          id="file-upload"
          type="file"
          accept=".csv,.xlsx,.xls"
          onChange={handleFileUpload}
          className="file-input"
        />
        {fileName && <span className="file-name">{fileName}</span>}
      </div>

      {loading && (
        <div className="loading">
          <div className="spinner"></div>
          <p>Loading data...</p>
        </div>
      )}

      {!loading && data.length > 0 && (
        <>
          {invoiceConsolidation ? (
            <>
              <div className="duplicate-analysis">
                <h2>Invoice consolidation</h2>
                <p className="analysis-subtitle">
                  Unique key: TRX_NUMBER, BILLING_AGREEMENT, SERIAL_NUMBER, RECURRING_CHARGE_FROM_DATE, RECURRING_CHARGE_TO_DATE
                  <br />
                  Table shows <strong>consolidated</strong> rows (1 or 2 line items per key; 2 lines merged when same |quantity|). Exception rows (3+ per key or 2 with different |quantity|) can be downloaded below.
                </p>
                <div className="stats-grid">
                  <div className="stat-card">
                    <div className="stat-icon">📋</div>
                    <div className="stat-content">
                      <span className="stat-label">Consolidated rows</span>
                      <span className="stat-value">{invoiceConsolidation.consolidatedRows.length.toLocaleString()}</span>
                    </div>
                  </div>
                  <div className="stat-card duplicate">
                    <div className="stat-icon">⚠️</div>
                    <div className="stat-content">
                      <span className="stat-label">Exception rows</span>
                      <span className="stat-value">{invoiceConsolidation.exceptionRows.length.toLocaleString()}</span>
                    </div>
                  </div>
                </div>
                <div className="filter-controls" style={{ marginTop: '1rem' }}>
                  <button
                    type="button"
                    className="export-btn"
                    onClick={downloadConsolidatedFile}
                    disabled={invoiceConsolidation.consolidatedRows.length === 0}
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                    Download consolidated file
                  </button>
                  <button
                    type="button"
                    className="export-btn"
                    onClick={downloadExceptionFile}
                    disabled={invoiceConsolidation.exceptionRows.length === 0}
                    style={{ marginLeft: '0.75rem' }}
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                    Download exception file
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="duplicate-analysis">
                <h2>Duplicate Analysis (Showing Deduplicated Data)</h2>
                <p className="analysis-subtitle">
                  Primary Key: SERIAL_NUMBER + TRX_NUMBER + LINE_NUMBER
                  <br />
                  <strong>Note:</strong> Invoice key columns not found. Each unique primary key combination is shown once with its occurrence count.
                </p>
                <div className="stats-grid">
                  <div className="stat-card">
                    <div className="stat-icon">📊</div>
                    <div className="stat-content">
                      <span className="stat-label">Total Records</span>
                      <span className="stat-value">{duplicateStats?.totalRecords.toLocaleString()}</span>
                    </div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-icon">✅</div>
                    <div className="stat-content">
                      <span className="stat-label">Unique Records</span>
                      <span className="stat-value">{duplicateStats?.uniqueRecords.toLocaleString()}</span>
                    </div>
                  </div>
                  <div className="stat-card duplicate">
                    <div className="stat-icon">🔄</div>
                    <div className="stat-content">
                      <span className="stat-label">Duplicate Records</span>
                      <span className="stat-value">{duplicateStats?.duplicateRecords.toLocaleString()}</span>
                    </div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-icon">📦</div>
                    <div className="stat-content">
                      <span className="stat-label">Duplicate Groups</span>
                      <span className="stat-value">{duplicateStats?.duplicateGroups.toLocaleString()}</span>
                    </div>
                  </div>
                </div>
                {duplicateStats?.duplicateGroups > 0 && (
                  <div className="duplicate-summary">
                    <h3>Top 5 Duplicate Groups</h3>
                    <div className="duplicate-groups">
                      {duplicateStats.duplicateGroupDetails.slice(0, 5).map((group, idx) => (
                        <div key={idx} className="duplicate-group-item">
                          <span className="group-rank">#{idx + 1}</span>
                          <span className="group-count">{group.count} occurrences</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div className="filter-controls">
                <div className="filter-buttons">
                  <button
                    className={`filter-btn ${filterMode === 'all' ? 'active' : ''}`}
                    onClick={() => setFilterMode('all')}
                  >
                    All Unique Keys ({data.length.toLocaleString()})
                  </button>
                  <button
                    className={`filter-btn ${filterMode === 'duplicates' ? 'active' : ''}`}
                    onClick={() => setFilterMode('duplicates')}
                  >
                    Has Duplicates ({duplicateStats?.duplicateGroups.toLocaleString()})
                  </button>
                  <button
                    className={`filter-btn ${filterMode === 'unique' ? 'active' : ''}`}
                    onClick={() => setFilterMode('unique')}
                  >
                    No Duplicates ({(duplicateStats?.uniqueRecords - duplicateStats?.duplicateGroups).toLocaleString()})
                  </button>
                </div>
                <button type="button" className="export-btn" onClick={exportToCSV}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  Export {filterMode === 'all' ? 'All' : filterMode === 'duplicates' ? 'Duplicates' : 'Unique'} to CSV
                </button>
              </div>
            </>
          )}

          <div className="stats-bar">
            <div className="stat">
              <span className="stat-label">{invoiceConsolidation ? 'Showing consolidated rows:' : 'Showing Unique Keys:'}</span>
              <span className="stat-value">{filteredData.length.toLocaleString()}</span>
            </div>
            {(globalFilter || columnFilters.length > 0) && (
              <>
                <div className="stat highlight">
                  <span className="stat-label">After Filters:</span>
                  <span className="stat-value">
                    {table.getFilteredRowModel().rows.length.toLocaleString()}
                  </span>
                </div>
                <div className="stat">
                  <span className="stat-label">Active Filters:</span>
                  <span className="stat-value">
                    {(globalFilter ? 1 : 0) + columnFilters.length}
                  </span>
                </div>
              </>
            )}
          </div>

          <div className="controls">
            <div className="search-section">
              <input
                type="text"
                placeholder="Search across all columns..."
                value={globalFilter ?? ''}
                onChange={(e) => setGlobalFilter(e.target.value)}
                className="search-input"
              />
              {(globalFilter || columnFilters.length > 0) && (
                <button
                  onClick={() => {
                    setGlobalFilter('')
                    setColumnFilters([])
                  }}
                  className="clear-filters-btn"
                  title="Clear all filters"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                  Clear Filters
                </button>
              )}
            </div>
            
            <select
              value={table.getState().pagination.pageSize}
              onChange={(e) => {
                table.setPageSize(Number(e.target.value))
              }}
              className="page-size-select"
            >
              {[25, 50, 100, 250, 500].map((pageSize) => (
                <option key={pageSize} value={pageSize}>
                  Show {pageSize} rows
                </option>
              ))}
            </select>
          </div>

          <div className="table-container">
            <table className="data-table">
              <thead>
                {table.getHeaderGroups().map((headerGroup) => (
                  <tr key={headerGroup.id}>
                    {headerGroup.headers.map((header) => (
                      <th key={header.id}>
                        <div className="header-content">
                          <div
                            className={header.column.getCanSort() ? 'header-label sortable' : 'header-label'}
                            onClick={header.column.getToggleSortingHandler()}
                          >
                            {flexRender(
                              header.column.columnDef.header,
                              header.getContext()
                            )}
                            {header.column.getCanSort() && (
                              <span className="sort-indicator">
                                {header.column.getIsSorted() === 'asc' ? ' 🔼' : 
                                 header.column.getIsSorted() === 'desc' ? ' 🔽' : 
                                 ' ⇅'}
                              </span>
                            )}
                          </div>
                          {header.column.getCanFilter() && (
                            <ColumnFilter column={header.column} />
                          )}
                        </div>
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody>
                {table.getRowModel().rows.map((row) => {
                  const count = row.original._duplicateCount
                  const hasDuplicates = count > 1
                  return (
                    <tr 
                      key={row.id} 
                      className={hasDuplicates ? 'duplicate-row' : ''}
                      title={hasDuplicates ? `This primary key combination appears ${count} times in the original data` : 'This primary key combination appears only once'}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <td key={cell.id}>
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext()
                          )}
                        </td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="pagination">
            <button
              onClick={() => table.setPageIndex(0)}
              disabled={!table.getCanPreviousPage()}
              className="pagination-btn"
            >
              {'<<'}
            </button>
            <button
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
              className="pagination-btn"
            >
              {'<'}
            </button>
            <span className="pagination-info">
              Page{' '}
              <strong>
                {table.getState().pagination.pageIndex + 1} of{' '}
                {table.getPageCount()}
              </strong>
            </span>
            <button
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
              className="pagination-btn"
            >
              {'>'}
            </button>
            <button
              onClick={() => table.setPageIndex(table.getPageCount() - 1)}
              disabled={!table.getCanNextPage()}
              className="pagination-btn"
            >
              {'>>'}
            </button>
            <span className="pagination-info">
              | Go to page:
              <input
                type="number"
                min="1"
                max={table.getPageCount()}
                defaultValue={table.getState().pagination.pageIndex + 1}
                onChange={(e) => {
                  const page = e.target.value ? Number(e.target.value) - 1 : 0
                  table.setPageIndex(page)
                }}
                className="page-input"
              />
            </span>
          </div>
        </>
      )}

      {!loading && data.length === 0 && (
        <div className="empty-state">
          <svg
            width="64"
            height="64"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
            <polyline points="10 9 9 9 8 9" />
          </svg>
          <h2>No Data Loaded</h2>
          <p>Upload a CSV or Excel file to get started</p>
        </div>
      )}
    </div>
  )
}

export default DataViewer
