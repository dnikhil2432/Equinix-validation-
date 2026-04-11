/**
 * Script Action — "equinix line item transform scripts" (or your record name)
 *
 * Event name: x_attm_doms.invoice based validation
 *
 * Parameters (from gs.eventQueue or event registration):
 *   event.parm1 = Import Set sys_id (sys_import_set)
 *   event.parm2 = Data source id (optional; use if you extend logic)
 *
 * Use this when validation is triggered by event instead of (or in addition to) Transform OnComplete.
 * Your Transform OnComplete already calls EquinixILIQuoteValidation directly; this action is for
 * the same validation when fired from the invoice-based validation event.
 */

(function onEvent(/* GlideRecord */ event) {
    var importSetId = event.parm1;
    var datasourceId = event.parm2;

    if (!importSetId) {
        gs.error('x_attm_doms.invoice based validation: missing parm1 (import set sys_id)');
        return;
    }

    // Optional: existing utilities (uncomment if needed here instead of only in OnComplete)
    // var equinixUtils = new EquinixTransformAutomationUtils();
    // equinixUtils.onAfter_inventoryUpdate(importSetId);
    // new InvoiceDataTransformUtils().validateQuotes(importSetId);

    if (typeof EquinixILIQuoteValidation !== 'undefined') {
        new EquinixILIQuoteValidation().validateBatch(importSetId);
    } else {
        gs.error('EquinixILIQuoteValidation Script Include not found. Import set: ' + importSetId);
    }

    // equinixUtils.onCompletereportseGeneration(importSetId, datasourceId);
    // equinixUtils.onAfterTDRValidations(importSetId);
    // equinixUtils.onCompleteTDRValidationReport(importSetId, datasourceId);
})();
