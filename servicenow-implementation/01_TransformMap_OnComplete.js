/**
 * Transform Map — OnComplete script
 *
 * Merged with your existing flow: InvoiceDataTransformUtils.validateQuotes, report event,
 * spreadsheet thread handling, plus EquinixILIQuoteValidation.validateBatch.
 *
 * Prerequisites:
 * - ILI.batch_id populated with Import Set sys_id (same as importSetId below).
 * - Script Includes: InvoiceDataTransformUtils, EquinixILIQuoteValidation
 * - Optional CD matching: system properties x_attm_doms.cd_tokens_json and cd_value_tokens_json (see 04_System_Properties_CD_tokens.txt)
 */

(function runTransformScript(source, map, log, target /* undefined onStart */) {
    var importSetId = source.getValue('sys_import_set');

    new InvoiceDataTransformUtils().validateQuotes(importSetId);

    if (typeof EquinixILIQuoteValidation !== 'undefined') {
        new EquinixILIQuoteValidation().validateBatch(importSetId);
    } else {
        gs.error('EquinixILIQuoteValidation Script Include not found. Import set: ' + importSetId);
    }

    gs.eventQueue('x_attm_doms.equinix_invoice_reports_gene', source, source.sys_import_set.toString(), '');

    var hugeDataPropery = gs.getProperty('x_attm_doms.Allow The Spreadsheets to Process through Thread Mechanism');

    if (hugeDataPropery == 'true') {
        var data_source = new GlideRecord('sys_data_source');
        data_source.addQuery('name', 'CONTAINS', 'sheet_thread_Equinix_inv_line_item_Part_');
        data_source.addQuery('name', 'DOES NOT CONTAIN', source.sys_import_set.data_source.name);
        data_source.addEncodedQuery('name>' + source.sys_import_set.data_source.name.toString());
        data_source.addQuery('sys_created_on', '>', gs.hoursAgo(4));
        data_source.orderBy('name');
        data_source.query();
        if (data_source.next()) {
            gs.eventQueue('x_attm_doms.spread_sheet_data_for_invent', null, data_source.name.toString(), 'Trigger Thread Processing For Equinix Line Items');
        }
    }
})(source, map, log, target);
