/**
 * ServiceNow — Scripts - Background (or Fix Scripts)
 *
 * Tests EquinixILIQuoteValidation for one import without processing the full load.
 *
 * SET ONE of:
 *   IMPORT_SET_SYS_ID  = 32-char sys_id of sys_import_set
 *   IMPORT_SET_NUMBER  = Import Set "number" (e.g. ISET0001234) from the list view
 *
 * BATCH_ID is what ILI.batch_id actually stores (resolved automatically: sys_id first, then number).
 *
 * MAX_ROWS = 100 for a smoke test; increase or set to 0 for full batch (same as Transform OnComplete).
 */

(function runEquinixIliValidationTest() {
    var IMPORT_SET_SYS_ID = ''; // e.g. 'a1b2c3d4e5f6...'
    var IMPORT_SET_NUMBER = ''; // e.g. 'ISET0001234' — use if you do not have sys_id
    var MAX_ROWS = 100; // 0 = no limit (all rows for that batch_id)

    // --- resolve import set sys_id ---
    var importSetSysId = (IMPORT_SET_SYS_ID || '').trim();
    if (!importSetSysId && IMPORT_SET_NUMBER) {
        var is = new GlideRecord('sys_import_set');
        is.addQuery('number', IMPORT_SET_NUMBER);
        is.query();
        if (!is.next()) {
            gs.error('Equinix ILI test: no sys_import_set with number = ' + IMPORT_SET_NUMBER);
            return;
        }
        importSetSysId = is.getUniqueValue();
        gs.info('Equinix ILI test: resolved import set number ' + IMPORT_SET_NUMBER + ' -> sys_id ' + importSetSysId);
    }
        if (!importSetSysId) {
        gs.error('Equinix ILI test: set IMPORT_SET_SYS_ID or IMPORT_SET_NUMBER');
            return;
        }

    var ILI_TABLE = 'x_attm_doms_doc_intl_invoice_line_items';

    // --- resolve batch_id value for ILI query (batch_id may store sys_id or display number) ---
    var batchIdValue = importSetSysId;
    var probe = new GlideRecord(ILI_TABLE);
    probe.addQuery('batch_id', importSetSysId);
    probe.setLimit(1);
    probe.query();
    if (!probe.hasNext()) {
        var num = '';
        var is2 = new GlideRecord('sys_import_set');
        if (is2.get(importSetSysId)) {
            num = is2.getValue('number') || '';
        }
        if (num) {
            probe = new GlideRecord(ILI_TABLE);
            probe.addQuery('batch_id', num);
            probe.setLimit(1);
            probe.query();
            if (probe.hasNext()) {
                batchIdValue = num;
                gs.info('Equinix ILI test: ILI.batch_id uses Import Set number; using batch_id = ' + batchIdValue);
            }
        }
    }

    if (typeof EquinixILIQuoteValidation === 'undefined') {
        gs.error('Equinix ILI test: Script Include EquinixILIQuoteValidation not found');
            return;
        }

    var ga = new GlideAggregate(ILI_TABLE);
    ga.addQuery('batch_id', batchIdValue);
    ga.addAggregate('COUNT', '*');
    ga.query();
    var total = 0;
    if (ga.next()) {
        total = parseInt(ga.getAggregate('COUNT', '*'), 10) || 0;
    }
    gs.info('Equinix ILI test: ILI rows for batch_id match = ' + total);

    var limit = MAX_ROWS > 0 ? MAX_ROWS : null;
    if (limit) {
        gs.info('Equinix ILI test: validating first ' + limit + ' row(s) (order by sys_id)');
        } else {
        gs.info('Equinix ILI test: validating all rows for this batch');
    }

    var v = new EquinixILIQuoteValidation();
    v.validateBatch(batchIdValue, limit || 0);

    gs.info('Equinix ILI test: finished');
})();
