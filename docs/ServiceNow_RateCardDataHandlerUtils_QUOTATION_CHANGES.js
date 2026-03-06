/**
 * ServiceNow Script Include: RateCardDataHandlerUtils
 * QUOTATION-ONLY CHANGES – align with CSV-reader tool validation logic.
 * Replace only these functions in your existing Script Include; leave all other functions unchanged.
 *
 * Logic applied:
 * - PO filter + IBX/site filter (unchanged).
 * - Match QLI: prefer item code (normalized, either-direction include); else description (≥3 words).
 * - CUP from invoice line's invoice start date only (not quote).
 * - Prorata factor from billing_from/billing_till.
 * - Pass: unit price ≤ CUP×(1+tolerance), LLA ≤ ELLA×(1+tolerance), quantity ≤ QLI qty×(1+qtyTolerance).
 *
 * Business Rule: Ensure inv_price is set before calling (e.g. var inv_price = getUnitPrice(current); then quantityAndPriceForNonOOSCheck(current, inv_price);).
 */

// ========== HELPERS (add these inside the prototype, before verifyQuoteLine) ==========

_getWords: function(text) {
    if (!text) return [];
    var s = text.toString().replace(/[^a-zA-Z0-9]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
    return s ? s.split(' ') : [];
},

_normalizeText: function(text) {
    if (!text) return '';
    return text.toString().replace(/[^a-zA-Z0-9]/g, '').replace(/[\s,]+/g, ' ').trim().toLowerCase();
},

_getDescMatchScore: function(iliDesc, qliChargeDesc, qliChangeDesc) {
    var wordsIli = this._getWords(iliDesc);
    var bestMatchCount = 0;
    var passes = false;
    var self = this;

    function scoreOne(qliDesc) {
        if (!qliDesc) return { passes: false, matchCount: 0 };
        var wordsQli = self._getWords(qliDesc);
        if (wordsQli.length === 0) return { passes: false, matchCount: 0 };
        var qliInIli = 0, iliInQli = 0;
        for (var q = 0; q < wordsQli.length; q++) {
            if (wordsIli.indexOf(wordsQli[q]) >= 0) qliInIli++;
        }
        for (var i = 0; i < wordsIli.length; i++) {
            if (wordsQli.indexOf(wordsIli[i]) >= 0) iliInQli++;
        }
        var matchCount = Math.max(qliInIli, iliInQli);
        return { passes: matchCount >= 3, matchCount: matchCount };
    }

    var charge = scoreOne(qliChargeDesc);
    if (charge.passes && charge.matchCount >= bestMatchCount) {
        bestMatchCount = charge.matchCount;
        passes = true;
    }
    var change = scoreOne(qliChangeDesc);
    if (change.passes && change.matchCount >= bestMatchCount) {
        bestMatchCount = change.matchCount;
        passes = true;
    }
    return { passes: passes, matchCount: bestMatchCount };
},

/**
 * CUP from invoice line's invoice start date only (not quote).
 * Uses: QLI unit price (MRC/OTC), QLI renewal_term, price_increase_percentage; ILI invoice_start_date, first_Price_increment_applicable_after.
 */
_getCUP: function(quoteItemGr, lineItemGr, today) {
    var unitPrice = this.getQuotePrice(quoteItemGr);
    if (isNaN(unitPrice) || unitPrice <= 0) return NaN;

    var invStartStr = lineItemGr.getValue('invoice_start_date') || lineItemGr.getValue('billing_from') || lineItemGr.getValue('service_start_date');
    var serviceStart = this._parseDate(invStartStr);
    if (!serviceStart) return unitPrice;

    var initialTerm = 12;
    var incMonths = parseFloat(lineItemGr.getValue('first_Price_increment_applicable_after') || lineItemGr.getValue('first_price_increment_applicable_after') || '12', 10);
    if (!isNaN(incMonths) && incMonths > 0) initialTerm = incMonths;

    var term = 12;
    var termMonths = parseFloat(quoteItemGr.getValue('renewal_term') || '12', 10);
    if (!isNaN(termMonths) && termMonths > 0) term = termMonths;

    var initialTermIncrement = parseFloat(quoteItemGr.getValue('price_increase_percentage') || '0', 10) / 100 || 0;
    var increment = initialTermIncrement;

    var endInitial = this._addMonths(serviceStart, initialTerm);
    var endFirstTerm = this._addMonths(endInitial, term);

    if (today.getTime() < serviceStart.getTime()) return unitPrice;
    if (today.getTime() < endInitial.getTime()) return unitPrice;
    if (today.getTime() < endFirstTerm.getTime()) return unitPrice * (1 + initialTermIncrement);

    var numCompletedTerms = Math.floor((today.getTime() - endInitial.getTime()) / (term * 30.44 * 24 * 60 * 60 * 1000)) || 0;
    return unitPrice * (1 + initialTermIncrement) * Math.pow(1 + increment, numCompletedTerms);
},

_parseDate: function(s) {
    if (!s) return null;
    var d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
},

_addMonths: function(d, months) {
    var x = new Date(d.getTime());
    x.setMonth(x.getMonth() + months);
    return x;
},

/**
 * Prorata factor from billing_from/billing_till on line item.
 */
_getPF: function(lineItemGr) {
    var fromStr = lineItemGr.getValue('billing_from') || lineItemGr.getValue('invoice_start_date');
    var tillStr = lineItemGr.getValue('billing_till');
    var from = this._parseDate(fromStr);
    var till = this._parseDate(tillStr);
    if (!from || !till) return 1;
    var daysInMonth = new Date(from.getFullYear(), from.getMonth() + 1, 0).getDate();
    var days = Math.max(0, (till.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)) + 1;
    return Math.min(1, days / daysInMonth);
},

// ========== REPLACED: verifyQuoteLine ==========

verifyQuoteLine: function(lineItem, callingFlag) {
    var quoteLineItem = new GlideRecord('x_attm_doms_doms_quotation_line_items');
    quoteLineItem.addQuery('site_id', lineItem.getValue('ibx_center'));
    quoteLineItem.addQuery('quotation.po_number', lineItem.vendor_invoice.getDisplayValue('po_number').toString());
    var mrcQuery = quoteLineItem.addQuery('mrc', '!=', '');
    mrcQuery.addCondition('mrc', '!=', '-');
    mrcQuery.addCondition('mrc', '!=', '--');
    var otcQuery = mrcQuery.addOrCondition('otc', '!=', '');
    otcQuery.addCondition('otc', '!=', '-');
    otcQuery.addCondition('otc', '!=', '--');
    quoteLineItem.query();

    if (!quoteLineItem.hasNext()) {
        return 'false';
    }

    var line_item_charge_desc = this._normalizeText(lineItem.getValue('charge_description'));
    var line_item_item_code = this._normalizeText(lineItem.getValue('item_code'));

    var itemCodeMatches = [];
    var descCandidates = [];
    var qliList = [];
    while (quoteLineItem.next()) {
        var qliChargeDesc = quoteLineItem.getValue('item_description') || '';
        var qliChangeDesc = quoteLineItem.getValue('changed_item_description') || '';
        var quote_item_item_code = this._normalizeText(quoteLineItem.getValue('item_code'));

        if (line_item_item_code && quote_item_item_code) {
            var ni = line_item_item_code;
            var nq = quote_item_item_code;
            if (ni.indexOf(nq) >= 0 || nq.indexOf(ni) >= 0) {
                var descScore = this._getDescMatchScore(lineItem.getValue('charge_description'), qliChargeDesc, qliChangeDesc);
                itemCodeMatches.push({ sysId: quoteLineItem.getUniqueValue(), matchCount: descScore.matchCount });
            }
        }

        var descScore = this._getDescMatchScore(lineItem.getValue('charge_description'), qliChargeDesc, qliChangeDesc);
        if (descScore.passes) {
            descCandidates.push({ sysId: quoteLineItem.getUniqueValue(), matchCount: descScore.matchCount });
        }
    }

    var selectedSysId = null;
    if (itemCodeMatches.length > 0) {
        var best = itemCodeMatches[0];
        for (var i = 1; i < itemCodeMatches.length; i++) {
            if (itemCodeMatches[i].matchCount > best.matchCount) best = itemCodeMatches[i];
        }
        selectedSysId = best.sysId;
    } else if (descCandidates.length > 0) {
        var bestDesc = descCandidates[0];
        for (var j = 1; j < descCandidates.length; j++) {
            if (descCandidates[j].matchCount > bestDesc.matchCount) bestDesc = descCandidates[j];
        }
        selectedSysId = bestDesc.sysId;
    }

    if (!selectedSysId) {
        return 'false';
    }

    if (!callingFlag) {
        return 'true';
    }
    var out = new GlideRecord('x_attm_doms_doms_quotation_line_items');
    if (out.get(selectedSysId)) {
        return out;
    }
    return 'false';
},

// ========== REPLACED: quantityAndPriceForNonOOSCheck ==========

quantityAndPriceForNonOOSCheck: function(lineItem, inv_price) {
    var related_quote_item = this.verifyQuoteLine(lineItem, 'QuantityCheck');

    if (related_quote_item === 'false' || related_quote_item === 'true' || !related_quote_item || !related_quote_item.isValid()) {
        lineItem.setValue('tdr_validation_result', 'Skipped');
        lineItem.setValue('equinix_validation_remarks', 'Price Validation Comment: No quote item data is available for this line item to perform TDR-based price validation. Validation has not been performed and price validation is skipped.');
        lineItem.update();
        return;
    }

    var quantity = parseFloat(lineItem.getValue('quantity') || '0', 10);
    var lla = parseFloat((lineItem.getValue('line_level_amount') || '').toString().replace(/[^0-9.-]/g, ''), 10);
    var unitPrice = inv_price;
    if (typeof unitPrice === 'string') unitPrice = parseFloat(unitPrice.toString().replace(/[^0-9.]/g, '')) || 0;
    if (isNaN(unitPrice)) unitPrice = 0;

    if ((unitPrice === 0 || isNaN(unitPrice)) && !isNaN(lla) && quantity > 0 && lla !== 0) {
        unitPrice = lla / quantity;
    }
    if ((lla === 0 || isNaN(lla)) && !isNaN(unitPrice) && unitPrice !== 0 && quantity > 0) {
        lla = unitPrice * quantity;
    }

    if (unitPrice === 0 && lla === 0) {
        lineItem.setValue('tdr_validation_result', 'Validation Passed');
        lineItem.setValue('equinix_validation_remarks', 'Price Validation Comment: Unit Price and LLA are zero; no charge. Validation passed.');
        lineItem.update();
        return;
    }

    var today = new Date();
    var cup = this._getCUP(related_quote_item, lineItem, today);
    if (isNaN(cup) || cup <= 0) {
        lineItem.setValue('tdr_validation_result', 'Skipped');
        lineItem.setValue('equinix_validation_remarks', 'Price Validation Comment: No valid quote unit price (CUP) for date. Validation has not been performed and price validation is skipped.');
        lineItem.update();
        return;
    }

    var priceTolerance = 0.05;
    var qtyTolerance = 0.20;

    if (unitPrice > cup * (1 + priceTolerance)) {
        lineItem.setValue('tdr_validation_result', 'Validation Failed');
        lineItem.setValue('equinix_validation_remarks', 'Price Validation Comment: Unit price ' + unitPrice.toFixed(2) + ' exceeds CUP*(1+tolerance)=' + (cup * (1 + priceTolerance)).toFixed(2) + '.');
        lineItem.setValue('u_out_of_scope_item', true);
        this.updateInvoiceEligibilityToManual(lineItem);
        lineItem.update();
        return;
    }

    var pf = this._getPF(lineItem);
    var ella = cup * quantity * pf;
    if (!isNaN(lla) && lla > ella * (1 + priceTolerance)) {
        lineItem.setValue('tdr_validation_result', 'Validation Failed');
        lineItem.setValue('equinix_validation_remarks', 'Price Validation Comment: LLA ' + lla.toFixed(2) + ' exceeds ELLA*(1+tolerance)=' + (ella * (1 + priceTolerance)).toFixed(2) + '.');
        lineItem.setValue('u_out_of_scope_item', true);
        this.updateInvoiceEligibilityToManual(lineItem);
        lineItem.update();
        return;
    }

    var qliQty = parseFloat(related_quote_item.getValue('quantity') || '0', 10);
    if (isNaN(qliQty) || qliQty <= 0) {
        lineItem.setValue('tdr_validation_result', 'Skipped');
        lineItem.setValue('equinix_validation_remarks', 'Price Validation Comment: No quote quantity on matched quote line. Validation has not been performed and price validation is skipped.');
        lineItem.update();
        return;
    }

    if (quantity > qliQty * (1 + qtyTolerance)) {
        lineItem.setValue('tdr_validation_result', 'Validation Failed');
        lineItem.setValue('equinix_validation_remarks', 'Price Validation Comment: Quantity ' + quantity + ' exceeds quote quantity ' + qliQty + ' * (1+' + (qtyTolerance * 100) + '%).');
        lineItem.setValue('u_out_of_scope_item', true);
        this.updateInvoiceEligibilityToManual(lineItem);
        lineItem.update();
        return;
    }

    lineItem.setValue('tdr_validation_result', 'Validation Passed');
    lineItem.setValue('equinix_validation_remarks', 'Price Validation Comment: Validation passed as the price, LLA and quantity for this line item match the quote within tolerance.');
    lineItem.update();
},
