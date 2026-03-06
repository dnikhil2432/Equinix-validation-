/**
 * Web Worker: runs validation off the main thread so the UI stays responsive.
 */
import { runValidation } from './validationLogic.js'

self.onmessage = (e) => {
  try {
    const { baseData, quoteData, options } = e.data
    const result = runValidation(baseData, quoteData, options || {})
    self.postMessage({ result })
  } catch (err) {
    self.postMessage({ error: err?.message || String(err) })
  }
}
