/**
 * Script Include — Name: EquinixILIQuoteValidation
 * Client callable: false
 *
 * ILI vs QLI validation (serial → IBX → currency → qty sign → charge type → item code + description → CUP/PF/price/LLA/qty).
 *
 * Parity with csv-reader/src/validationLogic.js + src/cdValidationParser.js:
 * CD final score = 0.70*levelMatchScore + 0.30*anchoredValueScore; pass if score > 60.
 * Charge description (CD) matching matches cdValidationParser when these system properties are set:
 *   x_attm_doms.cd_tokens_json        — paste contents of tokens.json
 *   x_attm_doms.cd_value_tokens_json  — paste contents of valueTokens.json
 * If either is missing/invalid, description match falls back to word Jaccard (score > 60).
 *
 * See 04_System_Properties_CD_tokens.txt for setup.
 */

var EquinixILIQuoteValidation = Class.create();
EquinixILIQuoteValidation.prototype = {
    initialize: function () {
        this.CONFIG = {
            ILI_TABLE: 'x_attm_doms_doc_intl_invoice_line_items',
            QLI_TABLE: 'x_attm_doms_doms_quotation_line_items'
        };
        this.priceTolerance = 0.05;
        this.qtyTolerance = 0.20;
        // Currency filter is optional (per your requirement). Keep it OFF by default.
        // Currency will still be written to remarks for visibility.
        this.useCurrencyFilter = false;
        this.useIbxFilter = true;
        this.DESC_PASS_THRESHOLD = 60;
        this.CD_PASS_THRESHOLD = 60;
        this._cdTokensReady = false;
        this._cdTokens = null;
        this._cdValueTokens = null;
        this._cdPositiveRegex = null;
        this._cdNegativeRegex = null;
        this._cdAnyValueRegex = null;
        this._cdParseCache = {};
        this._cdParseCacheCount = 0;
        this._CD_PARSE_CACHE_MAX = 2000;
    },

    _ensureCDTokens: function () {
        if (this._cdTokensReady) {
            return;
        }
        this._cdTokensReady = true;
        var tJson = gs.getProperty('x_attm_doms.cd_tokens_json', '');
        var vJson = gs.getProperty('x_attm_doms.cd_value_tokens_json', '');
        if (!tJson || !vJson) {
            return;
        }
        try {
            this._cdTokens = JSON.parse(tJson);
            this._cdValueTokens = JSON.parse(vJson);
        } catch (e1) {
            gs.error('EquinixILIQuoteValidation: CD JSON parse failed: ' + e1);
            this._cdTokens = null;
            this._cdValueTokens = null;
            return;
        }
        this._cdBuildValueRegexes();
    },

    _cdEscapeRegex: function (str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    },

    _cdBuildRegex: function (phrases) {
        if (!phrases || phrases.length === 0) {
            return null;
        }
        var sorted = phrases.slice().sort(function (a, b) {
            return b.length - a.length;
        });
        var parts = [];
        var i;
        for (i = 0; i < sorted.length; i++) {
            parts.push(this._cdEscapeRegex(sorted[i]));
        }
        return new RegExp(parts.join('|'), 'gi');
    },

    _cdBuildValueRegexes: function () {
        var vt = this._cdValueTokens || {};
        var pos = vt.only_positive || [];
        var neg = vt.only_negative || [];
        var any = vt.positive_or_negitive || vt.positive_or_negative || [];
        var posNum = '\\d+(?:\\.\\d+)?(?:\\s*-\\s*\\d+(?:\\.\\d+)?)?';
        var negNum = '-\\d+(?:\\.\\d+)?(?:\\s*-\\s*-\\d+(?:\\.\\d+)?)?';
        var anyNum = '-?\\d+(?:\\.\\d+)?(?:\\s*-\\s*-?\\d+(?:\\.\\d+)?)?';
        this._cdPositiveRegex = this._cdBuildValueRegexHelper(pos, posNum);
        this._cdNegativeRegex = this._cdBuildValueRegexHelper(neg, negNum);
        this._cdAnyValueRegex = this._cdBuildValueRegexHelper(any, anyNum);
    },

    _cdBuildValueRegexHelper: function (tokenList, numberPattern) {
        if (!tokenList || tokenList.length === 0) {
            return null;
        }
        var tokenPattern = [];
        var i;
        for (i = 0; i < tokenList.length; i++) {
            tokenPattern.push(this._cdEscapeRegex(tokenList[i]));
        }
        return new RegExp('(' + numberPattern + ')(\\s{0,2})(?:' + tokenPattern.join('|') + ')', 'gi');
    },

    _cdFindLevelMatches: function (sentence, tree, isRoot) {
        if (isRoot === undefined) {
            isRoot = true;
        }
        if (isRoot) {
            var bestLevels = [];
            var bestCatName = null;
            for (var catName in tree) {
                if (!tree.hasOwnProperty(catName)) {
                    continue;
                }
                var subTree = tree[catName];
                var subLevels = this._cdFindLevelMatches(sentence, subTree, false);
                if (subLevels.length > bestLevels.length) {
                    bestLevels = subLevels;
                    bestCatName = catName;
                }
            }
            if (!bestCatName) {
                return [];
            }
            return [{ label: bestCatName, matches: [bestCatName] }].concat(bestLevels);
        }
        var keys = [];
        for (var k in tree) {
            if (tree.hasOwnProperty(k)) {
                keys.push(k);
            }
        }
        if (keys.length === 0) {
            return [];
        }
        var keyMap = {};
        for (var j = 0; j < keys.length; j++) {
            keyMap[keys[j].toLowerCase()] = keys[j];
        }
        var regex = this._cdBuildRegex(keys);
        if (!regex) {
            return [];
        }
        var seen = {};
        var allMatches = [];
        sentence.replace(regex, function (match) {
            var origKey = keyMap[match.trim().toLowerCase()] || match;
            var keyLower = origKey.toLowerCase();
            if (!seen[keyLower]) {
                seen[keyLower] = true;
                allMatches.push(origKey);
            }
            return match;
        });
        if (allMatches.length === 0) {
            return [];
        }
        var primaryMatch = allMatches[0];
        var primaryChildren = tree[primaryMatch] || {};
        var childLevels = this._cdFindLevelMatches(sentence, primaryChildren, false);
        return [{ label: primaryMatch, matches: allMatches }].concat(childLevels);
    },

    _cdEmptyParseResult: function () {
        return {
            level_matches: [],
            path: [],
            value_matches: [],
            anchored_value_matches: [],
            special_matches: [],
            not_contains: []
        };
    },

    _cdParseSentence: function (sentence) {
        if (!sentence || typeof sentence !== 'string') {
            return this._cdEmptyParseResult();
        }
        if (this._cdParseCache[sentence]) {
            return this._cdParseCache[sentence];
        }
        var remaining = String(sentence);
        remaining = remaining.replace(/\bNetwork Cable Connection\b/gi, 'Cross Connect');
        remaining = remaining.replace(/\bEquinix Fabric Local Virtual Connection\b/gi, 'Equinix Fabric Virtual Connection');
        remaining = remaining.replace(/\bEquinix Fabric Remote Virtual Connection\b/gi, 'Equinix Fabric Virtual Connection');
        var trPrefixedBandwidthRegex = /((?:-\s*TR\d*\b\s*)+)-\s*(\d+(?:\.\d+)?)\s*(ft|Mbps|Gbps|G|M|Core|kVA)\b/gi;
        remaining = remaining.replace(trPrefixedBandwidthRegex, function (_, trPrefix, value, unit) {
            return trPrefix + value + ' ' + unit;
        });

        var level_matches = this._cdFindLevelMatches(remaining, this._cdTokens, true);
        var path = [];
        var lm;
        for (lm = 0; lm < level_matches.length; lm++) {
            path.push(level_matches[lm].label);
        }
        var phraseIdx;
        var phraseJ;
        for (lm = 0; lm < level_matches.length; lm++) {
            var matches = level_matches[lm].matches;
            for (phraseIdx = 0; phraseIdx < matches.length; phraseIdx++) {
                var phrase = matches[phraseIdx];
                remaining = remaining.replace(new RegExp(this._cdEscapeRegex(phrase), 'gi'), ' ');
            }
        }
        var anchorKey = path.length > 0 ? path[path.length - 1] : null;

        var rawValueMatches = {};
        var extract = function (regex, rem) {
            if (!regex) {
                return rem;
            }
            regex.lastIndex = 0;
            return rem.replace(regex, function (match) {
                rawValueMatches[match.trim().toLowerCase()] = true;
                return ' ';
            });
        };
        remaining = extract.call(this, this._cdPositiveRegex, remaining);
        remaining = extract.call(this, this._cdNegativeRegex, remaining);
        remaining = extract.call(this, this._cdAnyValueRegex, remaining);

        var value_matches = [];
        for (var vm in rawValueMatches) {
            if (rawValueMatches.hasOwnProperty(vm)) {
                value_matches.push(vm);
            }
        }
        var anchored_value_matches = [];
        for (phraseJ = 0; phraseJ < value_matches.length; phraseJ++) {
            anchored_value_matches.push({ key: anchorKey, value: value_matches[phraseJ] });
        }

        var dateRangeRegex = /\b(\d{2}-[A-Z]{3}-\d{4}\s*-\s*\d{2}-[A-Z]{3}-\d{4}|\d{2}-\d{2}-\d{4}\s*(?:-|to)\s*\d{2}-\d{2}-\d{4}|\d{4}-\d{2}-\d{2}\s*(?:-|to)\s*\d{4}-\d{2}-\d{2})\b/g;
        var singleDateRegex = /\b(\d{2}-[A-Z]{3}-\d{4}|\d{2}-\d{2}-\d{4}|\d{4}-\d{2}-\d{2})\b/g;
        var uuidRegex = /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}\b/g;
        var special_matches = [];
        remaining = remaining.replace(dateRangeRegex, function (m) {
            special_matches.push(m);
            return ' ';
        });
        remaining = remaining.replace(singleDateRegex, function (m) {
            special_matches.push(m);
            return ' ';
        });
        remaining = remaining.replace(uuidRegex, function (m) {
            special_matches.push(m);
            return ' ';
        });

        var not_contains = [];
        var splitTok = remaining.split(/\s+/);
        for (var ti = 0; ti < splitTok.length; ti++) {
            var token = splitTok[ti];
            if (!token) {
                continue;
            }
            token = token.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, '');
            if (!token || !/[a-zA-Z0-9]/.test(token)) {
                continue;
            }
            not_contains.push(token);
        }

        var result = {
            level_matches: level_matches,
            path: path,
            value_matches: value_matches,
            anchored_value_matches: anchored_value_matches,
            special_matches: special_matches,
            not_contains: not_contains
        };
        this._cdParseCache[sentence] = result;
        this._cdParseCacheCount++;
        if (this._cdParseCacheCount > this._CD_PARSE_CACHE_MAX) {
            this._cdParseCache = {};
            this._cdParseCacheCount = 1;
            this._cdParseCache[sentence] = result;
        }
        return result;
    },

    _cdCalculateJaccardSimilarity: function (keysA, keysB) {
        var setA = {};
        var setB = {};
        var i;
        for (i = 0; i < keysA.length; i++) {
            setA[keysA[i]] = true;
        }
        for (i = 0; i < keysB.length; i++) {
            setB[keysB[i]] = true;
        }
        var ua = 0;
        var ub = 0;
        var k;
        for (k in setA) {
            if (setA.hasOwnProperty(k)) {
                ua++;
            }
        }
        for (k in setB) {
            if (setB.hasOwnProperty(k)) {
                ub++;
            }
        }
        if (ua === 0 && ub === 0) {
            return 100;
        }
        var inter = 0;
        for (k in setA) {
            if (setA.hasOwnProperty(k) && setB[k]) {
                inter++;
            }
        }
        return Number((((inter / (ua + ub - inter)) * 100)).toFixed(2));
    },

    _cdLevelMatchScore: function (levelMatchesA, levelMatchesB, vmA, vmB) {
        var maxLen = Math.max(levelMatchesA.length, levelMatchesB.length);
        if (maxLen === 0) {
            return 100;
        }
        var baseWeights = [0.40, 0.35, 0.25];
        var extraLevels = Math.max(0, maxLen - baseWeights.length);
        var extraWeight = extraLevels > 0 ? 0.10 / extraLevels : 0;

        var setVmA = {};
        var setVmB = {};
        var vi;
        if (vmA) {
            for (vi = 0; vi < vmA.length; vi++) {
                setVmA[vmA[vi]] = true;
            }
        }
        if (vmB) {
            for (vi = 0; vi < vmB.length; vi++) {
                setVmB[vmB[vi]] = true;
            }
        }

        var score = 0;
        var totalWeight = 0;
        var i;
        for (i = 0; i < maxLen; i++) {
            var levelA = levelMatchesA[i];
            var levelB = levelMatchesB[i];
            var w = i < baseWeights.length ? baseWeights[i] : extraWeight;
            totalWeight += w;

            var matchesA = [];
            var matchesB = [];
            if (levelA) {
                for (var ma = 0; ma < levelA.matches.length; ma++) {
                    matchesA.push(levelA.matches[ma].toLowerCase());
                }
            }
            if (levelB) {
                for (var mb = 0; mb < levelB.matches.length; mb++) {
                    matchesB.push(levelB.matches[mb].toLowerCase());
                }
            }

            if (matchesA.length === 0 && matchesB.length === 0) {
                score += w;
            } else if (matchesA.length === 0 || matchesB.length === 0) {
                var presentMatches = matchesA.length > 0 ? matchesA : matchesB;
                var absentSideVm = matchesA.length === 0 ? setVmA : setVmB;
                var found = false;
                var pm;
                for (pm = 0; pm < presentMatches.length; pm++) {
                    if (absentSideVm[presentMatches[pm]]) {
                        found = true;
                        break;
                    }
                }
                if (found) {
                    score += w;
                }
            } else {
                var jaccard = this._cdCalculateJaccardSimilarity(matchesA, matchesB);
                score += (jaccard / 100) * w;
            }
        }
        return totalWeight > 0 ? Number(((score / totalWeight) * 100).toFixed(2)) : 100;
    },

    /** Invoice vs quote: "200 mbps" vs "1 - 200 mbps" → same canonical bandwidth for anchored Jaccard. */
    _cdCanonicalAnchoredValue: function (v) {
        var t = String(v != null ? v : '').trim().toLowerCase();
        if (!t) {
            return t;
        }
        var re = /(\d+(?:\.\d+)?)\s*(ft|mbps|gbps|g\b|m\b|core|kva)\b/gi;
        var matches = [];
        var m;
        while ((m = re.exec(t)) !== null) {
            matches.push(m);
        }
        if (matches.length === 0) {
            return t;
        }
        var last = matches[matches.length - 1];
        return last[1] + ' ' + last[2].toLowerCase();
    },

    _cdCompareAnchoredValues: function (avmA, avmB) {
        if (avmA.length === 0 && avmB.length === 0) {
            return { score: 100, hardFail: false };
        }
        if (avmA.length === 0 || avmB.length === 0) {
            return { score: 100, hardFail: false };
        }

        var groupA = {};
        var i;
        for (i = 0; i < avmA.length; i++) {
            var ka = avmA[i].key != null ? avmA[i].key : '__none__';
            var va = this._cdCanonicalAnchoredValue(avmA[i].value);
            if (!groupA[ka]) {
                groupA[ka] = {};
            }
            groupA[ka][va] = true;
        }
        var groupB = {};
        for (i = 0; i < avmB.length; i++) {
            var kb = avmB[i].key != null ? avmB[i].key : '__none__';
            var vb = this._cdCanonicalAnchoredValue(avmB[i].value);
            if (!groupB[kb]) {
                groupB[kb] = {};
            }
            groupB[kb][vb] = true;
        }

        var allKeys = {};
        for (var ak in groupA) {
            if (groupA.hasOwnProperty(ak)) {
                allKeys[ak] = true;
            }
        }
        for (var bk in groupB) {
            if (groupB.hasOwnProperty(bk)) {
                allKeys[bk] = true;
            }
        }
        var total = 0;
        for (var tk in allKeys) {
            if (allKeys.hasOwnProperty(tk)) {
                total++;
            }
        }
        if (total === 0) {
            return { score: 100, hardFail: false };
        }

        var score = 0;
        for (var key in allKeys) {
            if (!allKeys.hasOwnProperty(key)) {
                continue;
            }
            var valsA = groupA[key];
            var valsB = groupB[key];
            if (!valsA) {
                score++;
            } else if (!valsB) {
                score++;
            } else {
                var arrA = [];
                var arrB = [];
                var va;
                for (va in valsA) {
                    if (valsA.hasOwnProperty(va)) {
                        arrA.push(va);
                    }
                }
                for (va in valsB) {
                    if (valsB.hasOwnProperty(va)) {
                        arrB.push(va);
                    }
                }
                var jaccard = this._cdCalculateJaccardSimilarity(arrA, arrB);
                score += jaccard / 100;
            }
        }
        return {
            score: Number(((score / total) * 100).toFixed(2)),
            hardFail: false
        };
    },

    _cdCalculateSimilarity: function (iliDesc, qliDesc) {
        // Normalize common synonym phrases before CD tokenization.
        var a = iliDesc || '';
        var b = qliDesc || '';
        a = String(a).replace(/\bequinix\s+fabric\s+local\s+virtual\s+connection\b/gi, 'Equinix Fabric Virtual Connection');
        b = String(b).replace(/\bequinix\s+fabric\s+local\s+virtual\s+connection\b/gi, 'Equinix Fabric Virtual Connection');
        a = String(a).replace(/\bequinix\s+fabric\s+remote\s+virtual\s+connection\b/gi, 'Equinix Fabric Virtual Connection');
        b = String(b).replace(/\bequinix\s+fabric\s+remote\s+virtual\s+connection\b/gi, 'Equinix Fabric Virtual Connection');

        var parsedA = this._cdParseSentence(a);
        var parsedB = this._cdParseSentence(b);

        var sLevels = this._cdLevelMatchScore(
            parsedA.level_matches,
            parsedB.level_matches,
            parsedA.value_matches,
            parsedB.value_matches
        );

        var cmp = this._cdCompareAnchoredValues(parsedA.anchored_value_matches, parsedB.anchored_value_matches);

        // Matches cdValidationParser.js calculateCDSimilarity (70% levels + 30% anchored)
        var score = Number((0.70 * sLevels + 0.30 * cmp.score).toFixed(2));
        var passes = score > this.CD_PASS_THRESHOLD;
        return { score: score, passes: passes, matchCount: score };
    },

    /**
     * @param importSetSysIdOrBatchId Value stored on ILI.batch_id (usually Import Set sys_id; may be number per your transform).
     * @param maxRows Optional. If set (e.g. 100), only that many ILI rows are processed (ordered by sys_id). QLI index is built for serials in those rows only.
     */
    validateBatch: function (importSetSysIdOrBatchId, maxRows) {
        this._ensureCDTokens();
        if (!importSetSysIdOrBatchId) {
            return;
        }
        var serials = this._collectSerialsForBatch(importSetSysIdOrBatchId, maxRows);
        var bySerial = this._loadQLIsBySerial(serials);
        var iliGr = new GlideRecord(this.CONFIG.ILI_TABLE);
        iliGr.addQuery('batch_id', importSetSysIdOrBatchId);
        iliGr.orderBy('sys_id');
        if (maxRows && maxRows > 0) {
            iliGr.setLimit(maxRows);
        }
        iliGr.query();
        while (iliGr.next()) {
            try {
                this._validateOneIli(iliGr, bySerial);
            } catch (ex) {
                gs.error('EquinixILIQuoteValidation row ' + iliGr.getUniqueValue() + ': ' + ex);
            }
        }
    },

    _collectSerialsForBatch: function (importSetSysIdOrBatchId, maxRows) {
        var map = {};
        var gr = new GlideRecord(this.CONFIG.ILI_TABLE);
        gr.addQuery('batch_id', importSetSysIdOrBatchId);
        gr.orderBy('sys_id');
        if (maxRows && maxRows > 0) {
            gr.setLimit(maxRows);
        }
        gr.query();
        while (gr.next()) {
            var s = (gr.getValue('serial_num') || '').trim();
            if (s) {
                map[s.toUpperCase()] = true;
            }
        }
        var out = [];
        for (var k in map) {
            if (map.hasOwnProperty(k)) {
                out.push(k);
            }
        }
        return out;
    },

    _loadQLIsBySerial: function (serialKeysUpper) {
        var bySerial = {};
        if (!serialKeysUpper || serialKeysUpper.length === 0) {
            return bySerial;
        }
        var chunk = 800;
        var c;
        for (c = 0; c < serialKeysUpper.length; c += chunk) {
            var part = [];
            var i;
            var end = c + chunk;
            if (end > serialKeysUpper.length) {
                end = serialKeysUpper.length;
            }
            for (i = c; i < end; i++) {
                part.push(serialKeysUpper[i]);
            }
            var gr = new GlideRecord(this.CONFIG.QLI_TABLE);
            gr.addQuery('serial_number', 'IN', part);
            gr.query();
            while (gr.next()) {
                var sn = (gr.getValue('serial_number') || '').trim().toUpperCase();
                if (!sn) {
                    continue;
                }
                if (!bySerial[sn]) {
                    bySerial[sn] = [];
                }
                bySerial[sn].push(this._qliFromGr(gr));
            }
        }
        return bySerial;
    },

    _qliFromGr: function (gr) {
        return {
            sys_id: gr.getUniqueValue(),
            number: gr.getValue('number'),
            serial_number: gr.getValue('serial_number'),
            site_id: gr.getValue('site_id'),
            currency: gr.getValue('currency'),
            item_code: gr.getValue('item_code'),
            item_description: gr.getValue('item_description'),
            changed_description: gr.getValue('changed_description'),
            quantity: this._num(gr, 'quantity'),
            mrc: this._num(gr, 'mrc'),
            otc: this._num(gr, 'otc'),
            start_date: gr.getValue('start_date'),
            charge_type: gr.getValue('charge_typ0'),
            line_item_charge_type: gr.getValue('line_item_charge_type'),
            // Optional totals for CUP fallback (match validationLogic getQLIUnitPriceFromTotal column names on your QLI table)
            line_item_total_amount: this._num(gr, 'line_item_total_amount'),
            line_item_total_mrc: this._num(gr, 'line_item_total_mrc'),
            line_item_total_otc_nrc_value: this._num(gr, 'line_item_total_otc_nrc_value')
        };
    },

    _iliFromGr: function (gr) {
        return {
            sys_id: gr.getUniqueValue(),
            vendor_invoice_display: gr.getDisplayValue('vendor_invoice') || '',
            serial_num: (gr.getValue('serial_num') || '').trim(),
            ibx_center: (gr.getValue('ibx_center') || '').trim(),
            item_code: (gr.getValue('item_code') || '').trim(),
            charge_description: gr.getValue('charge_description') || '',
            quantity: this._num(gr, 'quantity'),
            unit_price: this._num(gr, 'unit_price'),
            total_price: this._num(gr, 'total_price'),
            service_start_date: gr.getValue('service_start_date'),
            service_end_date: gr.getValue('service_end_date'),
            invoice_date: gr.getValue('invoice_date'),
            recurring_charge_from_date: gr.getValue('recurring_charge_from_date'),
            recurring_charge_to_date: gr.getValue('recurring_charge_to_date'),
            first_price_increase_applicable_after: this._num(gr, 'first_price_increase_applicable_after'),
            renewal_term: this._num(gr, 'renewal_term'),
            price_increase_percentage: this._num(gr, 'price_increase_percentage'),
            invoice_currency: (gr.getValue('invoice_currency') || '').trim(),
            charge_type: (gr.getValue('charge_type') || '').trim()
        };
    },

    _num: function (gr, field) {
        var v = gr.getValue(field);
        if (v === null || v === '') {
            return NaN;
        }
        var n = parseFloat(('' + v).replace(/[$,]/g, ''));
        return isNaN(n) ? NaN : n;
    },

    _validateOneIli: function (iliGr, bySerial) {
        var ili = this._iliFromGr(iliGr);
        var gr = iliGr;

        gr.setValue('tdr_validation_result', 'Skipped');
        gr.setValue('equinix_validation_remarks', '');

        var serialKey = (ili.serial_num || '').toUpperCase();
        if (!serialKey) {
            gr.setValue('equinix_validation_remarks', 'Quote - No match (No Serial on ILI) | ILI has no Serial number; cannot match quote by Serial.');
            gr.update();
            return;
        }

        var qlis = bySerial[serialKey] || [];
        if (qlis.length === 0) {
            gr.setValue('equinix_validation_remarks', 'Quote - No match (No QLI for Serial) | No matching quote line items for this Serial number.');
            gr.update();
            return;
        }

        var res = this._validateILIAgainstQLIs(ili, qlis);
        if (res.result === 'validated') {
            gr.setValue('tdr_validation_result', 'Validation Passed');
        } else if (res.result === 'failed') {
            gr.setValue('tdr_validation_result', 'Validation Failed');
        } else {
            gr.setValue('tdr_validation_result', 'Skipped');
        }
        var step = res.validationStep || (res.result === 'validated' ? 'Quote - Passed' : res.result === 'failed' ? 'Quote - Failed' : 'Quote - No match');
        var msg = res.remarks || '';
        var out = step;
        if (msg) out += ' | ' + msg;
        if (res.matchedQli && res.matchedQli.number) out += ' | Matched QLI: ' + res.matchedQli.number;
        if (res.matchedQli) {
            var iliCurr = (ili.invoice_currency || '').trim();
            var qliCurr = (res.matchedQli.currency || '').trim();
            if (iliCurr || qliCurr) {
                out += ' | CURR ILI=' + (iliCurr || 'N/A') + ', QLI=' + (qliCurr || 'N/A');
            }
        }
        gr.setValue('equinix_validation_remarks', out);
        gr.update();
    },

    _normalizeText: function (t) {
        if (!t) {
            return '';
        }
        return ('' + t).replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    },

    _tokenize: function (s) {
        var out = [];
        var parts = ('' + s).toLowerCase().split(/[^a-z0-9]+/);
        var i;
        for (i = 0; i < parts.length; i++) {
            if (parts[i].length > 2) {
                out.push(parts[i]);
            }
        }
        return out;
    },

    _jaccardWordScore: function (a, b) {
        var ta = this._tokenize(a);
        var tb = this._tokenize(b);
        var setA = {};
        var setB = {};
        var i;
        for (i = 0; i < ta.length; i++) {
            setA[ta[i]] = true;
        }
        for (i = 0; i < tb.length; i++) {
            setB[tb[i]] = true;
        }
        var inter = 0;
        var k;
        for (k in setA) {
            if (setA.hasOwnProperty(k) && setB[k]) {
                inter++;
            }
        }
        var ua = 0;
        var ub = 0;
        for (k in setA) {
            if (setA.hasOwnProperty(k)) {
                ua++;
            }
        }
        for (k in setB) {
            if (setB.hasOwnProperty(k)) {
                ub++;
            }
        }
        var union = ua + ub - inter;
        if (union === 0) {
            return 100;
        }
        return (inter / union) * 100;
    },

    _descMatchScore: function (iliDesc, chargeDesc, changeDesc) {
        var best = 0;
        var passes = false;
        if (this._cdTokens && this._cdValueTokens) {
            if (chargeDesc) {
                var c1 = this._cdCalculateSimilarity(iliDesc, chargeDesc);
                if (c1.matchCount > best) {
                    best = c1.matchCount;
                    passes = c1.passes;
                }
            }
            if (changeDesc) {
                var c2 = this._cdCalculateSimilarity(iliDesc, changeDesc);
                if (c2.matchCount > best) {
                    best = c2.matchCount;
                    passes = c2.passes;
                }
            }
            return { passes: passes, matchCount: best };
        }
        if (chargeDesc) {
            var s = this._jaccardWordScore(iliDesc, chargeDesc);
            if (s > best) {
                best = s;
            }
        }
        if (changeDesc) {
            var s2 = this._jaccardWordScore(iliDesc, changeDesc);
            if (s2 > best) {
                best = s2;
            }
        }
        passes = best > this.DESC_PASS_THRESHOLD;
        return { passes: passes, matchCount: best };
    },

    /**
     * Fallback unit price from total ÷ qty (validationLogic.js getQLIUnitPriceFromTotal).
     */
    _getQLIUnitPriceFromTotal: function (qli) {
        var qty = qli.quantity;
        if (isNaN(qty) || qty === 0) {
            return { price: NaN, source: null };
        }
        var cols = ['line_item_total_amount', 'line_item_total_mrc', 'line_item_total_otc_nrc_value'];
        for (var ci = 0; ci < cols.length; ci++) {
            var col = cols[ci];
            var total = qli[col];
            if (typeof total !== 'number' || isNaN(total)) {
                total = parseFloat(('' + total).replace(/[$,]/g, ''));
            }
            if (!isNaN(total) && total !== 0) {
                return { price: total / qty, source: col };
            }
        }
        return { price: NaN, source: null };
    },

    _getQLIUnitPrice: function (qli) {
        var mrc = qli.mrc;
        var otc = qli.otc;
        if (!isNaN(mrc) && mrc !== 0) {
            return mrc;
        }
        if (!isNaN(otc) && otc !== 0) {
            return otc;
        }
        return NaN;
    },

    /** Tie-break: lowest |CUP| wins; mirrors validationLogic (CUP else raw OTC/MRC else total/qty). */
    _tieBreakCupMagnitude: function (qli, ili) {
        var cup = this._getCUP(qli, ili);
        if (!isNaN(cup) && cup !== 0) {
            return Math.abs(cup);
        }
        var raw = this._getQLIUnitPrice(qli);
        if (!isNaN(raw) && raw !== 0) {
            return Math.abs(raw);
        }
        var fb = this._getQLIUnitPriceFromTotal(qli);
        if (!isNaN(fb.price) && fb.price !== 0) {
            return Math.abs(fb.price);
        }
        return Infinity;
    },

    _getPossibleDescValuesFromRow: function (row) {
        if (!row || typeof row !== 'object') {
            return [];
        }
        var out = [];
        var keys = Object.keys(row);
        var i;
        for (i = 0; i < keys.length; i++) {
            var val = row[keys[i]];
            var s = val != null ? ('' + val).trim() : '';
            if (s.length < 3) {
                continue;
            }
            if (/^\d+([.,]\d+)?$/.test(s.replace(/[$,\s]/g, ''))) {
                continue;
            }
            out.push(s);
        }
        var seen = {};
        var uniq = [];
        for (i = 0; i < out.length; i++) {
            if (!seen[out[i]]) {
                seen[out[i]] = true;
                uniq.push(out[i]);
            }
        }
        return uniq;
    },

    _descMatchScoreForQli: function (iliDesc, qli) {
        var chargeDesc = qli.item_description || '';
        var changeDesc = qli.changed_description || '';
        var ds = this._descMatchScore(iliDesc, chargeDesc, changeDesc);
        if (!ds.passes && iliDesc && !chargeDesc && !changeDesc) {
            var possible = this._getPossibleDescValuesFromRow(qli);
            var best = { passes: false, matchCount: 0 };
            var pi;
            for (pi = 0; pi < possible.length; pi++) {
                var s = this._descMatchScore(iliDesc, possible[pi], '');
                if (s.passes && s.matchCount > best.matchCount) {
                    best = s;
                }
            }
            if (best.passes) {
                return best;
            }
        }
        return ds;
    },

    _parseGdt: function (v) {
        if (!v) {
            return null;
        }
        var s = '' + v;
        var gd = new GlideDate();
        if (gd.setValue(s)) {
            var gdt = new GlideDateTime();
            gdt.setValue(gd);
            return gdt;
        }
        var gdt2 = new GlideDateTime();
        gdt2.setDisplayValue(s);
        return gdt2;
    },

    _addMonthsGdt: function (gdt, months) {
        var d = new GlideDateTime();
        d.setValue(gdt);
        d.addMonthsUTC(months);
        return d;
    },

    _getCompletedTerms: function (invoiceGdt, endInitialGdt, termMonths) {
        if (!invoiceGdt || !endInitialGdt || termMonths <= 0) {
            return 0;
        }
        if (invoiceGdt.before(endInitialGdt)) {
            return 0;
        }
        var yDiff = invoiceGdt.getYearUTC() - endInitialGdt.getYearUTC();
        var mDiff = invoiceGdt.getMonthUTC() - endInitialGdt.getMonthUTC();
        var totalMonths = yDiff * 12 + mDiff;
        if (invoiceGdt.getDayOfMonthUTC() < endInitialGdt.getDayOfMonthUTC()) {
            totalMonths -= 1;
        }
        return Math.floor(totalMonths / termMonths);
    },

    _getCUP: function (qli, ili) {
        var rawUnit = this._getQLIUnitPrice(qli);
        if (isNaN(rawUnit) || rawUnit === 0) {
            var fb = this._getQLIUnitPriceFromTotal(qli);
            if (!isNaN(fb.price) && fb.price !== 0) {
                rawUnit = fb.price;
            } else {
                return NaN;
            }
        }
        var unitPrice = Math.abs(rawUnit);

        var invoiceGdt = this._parseGdt(ili.recurring_charge_to_date);
        var qliStartGdt = this._parseGdt(qli.start_date);
        var iliStartGdt = this._parseGdt(ili.service_start_date);
        var serviceStartGdt = qliStartGdt || iliStartGdt;

        if (!invoiceGdt || !serviceStartGdt) {
            var cupMag0 = Math.round(unitPrice * 100) / 100;
            return qli.quantity < 0 ? -cupMag0 : cupMag0;
        }

        var initialM = ili.first_price_increase_applicable_after > 0 ? ili.first_price_increase_applicable_after : 12;
        var renewalM = ili.renewal_term > 0 ? ili.renewal_term : 12;
        // Matches validationLogic: (incrementPctRaw || 3) / 100 — NaN/0 → 3%
        var incRaw = ili.price_increase_percentage;
        var incPct = (isNaN(incRaw) ? 3 : (incRaw || 3)) / 100;

        var result;
        if (invoiceGdt.before(serviceStartGdt)) {
            result = unitPrice;
        } else {
            var endInitialGdt = this._addMonthsGdt(serviceStartGdt, initialM);
            if (invoiceGdt.before(endInitialGdt)) {
                result = unitPrice;
            } else {
                var endFirstRenGdt = this._addMonthsGdt(endInitialGdt, renewalM);
                if (invoiceGdt.before(endFirstRenGdt)) {
                    result = unitPrice * (1 + incPct);
                } else {
                    var completed = this._getCompletedTerms(invoiceGdt, endInitialGdt, renewalM);
                    result = unitPrice * Math.pow(1 + incPct, completed + 1);
                }
            }
        }
        var mag = result > 0 ? Math.round(result * 100) / 100 : NaN;
        if (isNaN(mag)) {
            return NaN;
        }
        return qli.quantity < 0 ? -mag : mag;
    },

    _getPF: function (ili) {
        var fromGdt = this._parseGdt(ili.recurring_charge_from_date);
        var tillGdt = this._parseGdt(ili.recurring_charge_to_date);
        if (!fromGdt || !tillGdt) {
            return 1;
        }
        var msDay = 86400000;
        var days = Math.max(0, (tillGdt.getNumericValue() - fromGdt.getNumericValue()) / msDay) + 1;

        var fromDate = new Date(fromGdt.getNumericValue());
        var daysInMonth = new Date(fromDate.getFullYear(), fromDate.getMonth() + 1, 0).getDate();
        var pf = days / daysInMonth;
        return pf > 1 ? 1 : pf;
    },

    /** DD-MMM-YYYY parsed as UTC (validationLogic parseDdMmmYyyyUTC). */
    _parseDdMmmYyyyUTC: function (s) {
        var m = /^(\d{1,2})-([A-Z]{3})-(\d{4})$/i.exec(('' + (s || '')).trim());
        if (!m) {
            return null;
        }
        var day = Number(m[1]);
        var mon = String(m[2]).toUpperCase();
        var year = Number(m[3]);
        var monthMap = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
        var monthIdx = monthMap[mon];
        if (monthIdx === undefined || !isFinite(day) || !isFinite(year)) {
            return null;
        }
        return new Date(Date.UTC(year, monthIdx, day));
    },

    /** Prorated recurring charge segment in QLI item_description (validationLogic computePFQLI). */
    _computePFQLI: function (qliDesc) {
        var desc = '' + (qliDesc || '');
        var re = /Prorated\s+Recurring\s+Charge-\s*([0-9]{1,2}-[A-Z]{3}-[0-9]{4})(?:\s*-\s*([0-9]{1,2}-[A-Z]{3}-[0-9]{4}))?/i;
        var m = re.exec(desc);
        if (!m) {
            return 1;
        }
        var fromD = this._parseDdMmmYyyyUTC(m[1]);
        if (!fromD) {
            return 1;
        }
        var fromYear = fromD.getUTCFullYear();
        var fromMonth = fromD.getUTCMonth();
        var daysInMonth = new Date(Date.UTC(fromYear, fromMonth + 1, 0)).getUTCDate();
        var toD = m[2] ? this._parseDdMmmYyyyUTC(m[2]) : new Date(Date.UTC(fromYear, fromMonth + 1, 0));
        if (!toD) {
            return 1;
        }
        var msPerDay = 24 * 60 * 60 * 1000;
        var daysInRange = Math.max(0, (toD.getTime() - fromD.getTime()) / msPerDay) + 1;
        return Math.min(1, daysInRange / daysInMonth);
    },

    _validateILIAgainstQLIs: function (ili, qlis) {
        var self = this;
        var ii;
        var qty = ili.quantity;
        if (isNaN(qty)) {
            qty = 0;
        }
        var unitPrice = ili.unit_price;
        var lla = ili.total_price;
        if (isNaN(unitPrice) && !isNaN(lla) && qty > 0 && lla !== 0) {
            unitPrice = lla / qty;
        }
        if ((lla === 0 || isNaN(lla)) && !isNaN(unitPrice) && unitPrice !== 0 && qty > 0) {
            lla = unitPrice * qty;
        }

        if (qty !== 0 && !isNaN(qty)) {
            var qtyPos = qty > 0;
            if (!isNaN(unitPrice) && unitPrice !== 0 && (unitPrice > 0) !== qtyPos) {
                unitPrice = -unitPrice;
            }
            if (!isNaN(lla) && lla !== 0 && (lla > 0) !== qtyPos) {
                lla = -lla;
            }
        }

        var ibx = ili.ibx_center || '';
        var chargeDesc = ili.charge_description || '';

        if (self.useIbxFilter) {
            if (!ibx) {
                return { result: null, remarks: 'ILI has no IBX; cannot match quote by site.', matchedQli: null, validationStep: 'Quote - No match (No IBX on ILI)' };
            }
            var qlisIbx = [];
            for (ii = 0; ii < qlis.length; ii++) {
                var qx = qlis[ii];
                var site = (qx.site_id || '').trim();
                if (!site) {
                    continue;
                }
                var iu = ibx.toUpperCase();
                var su = site.toUpperCase();
                if (su.indexOf(iu) >= 0 || iu.indexOf(su) >= 0) {
                    qlisIbx.push(qx);
                }
            }
            qlis = qlisIbx;
            if (qlis.length === 0) {
                return { result: null, remarks: 'No QLI with matching site_id/IBX for this serial.', matchedQli: null, validationStep: 'Quote - No match (No IBX/site_id)' };
            }
        }

        if (self.useCurrencyFilter) {
            var ic = (ili.invoice_currency || '').toUpperCase();
            if (ic) {
                var qlisCur = [];
                for (ii = 0; ii < qlis.length; ii++) {
                    var qc = qlis[ii];
                    if (((qc.currency || '').trim().toUpperCase()) === ic) {
                        qlisCur.push(qc);
                    }
                }
                qlis = qlisCur;
                if (qlis.length === 0) {
                    return { result: null, remarks: 'No QLI with matching currency for this serial/IBX.', matchedQli: null, validationStep: 'Quote - No match (Currency)' };
                }
            }
        }

        if (qty > 0) {
            var qlisPos = [];
            for (ii = 0; ii < qlis.length; ii++) {
                var qp = qlis[ii];
                if (!isNaN(qp.quantity) && qp.quantity > 0) {
                    qlisPos.push(qp);
                }
            }
            qlis = qlisPos;
            if (qlis.length === 0) {
                return { result: null, remarks: 'ILI quantity is positive; no QLI with positive quantity for this serial/IBX.', matchedQli: null, validationStep: 'Quote - No match (Quantity sign)' };
            }
        } else if (qty < 0) {
            var qlisNeg = [];
            for (ii = 0; ii < qlis.length; ii++) {
                var qn = qlis[ii];
                if (!isNaN(qn.quantity) && qn.quantity < 0) {
                    qlisNeg.push(qn);
                }
            }
            qlis = qlisNeg;
            if (qlis.length === 0) {
                return { result: null, remarks: 'ILI quantity is negative; no QLI with negative quantity for this serial/IBX.', matchedQli: null, validationStep: 'Quote - No match (Quantity sign)' };
            }
        }

        var ct = (ili.charge_type || '').toUpperCase();
        if (ct) {
            var iliRe = ct === 'RC' || ct === 'MRC';
            var iliNrc = ct === 'NRC' || ct === 'OTC';
            if (iliRe || iliNrc) {
                var qlisCt = [];
                for (ii = 0; ii < qlis.length; ii++) {
                    var qct = qlis[ii];
                    var qctU = ((qct.line_item_charge_type || qct.charge_type) || '').toUpperCase();
                    if (iliRe && (qctU === 'MRC' || qctU === 'RC')) {
                        qlisCt.push(qct);
                    } else if (iliNrc && (qctU === 'NRC' || qctU === 'OTC')) {
                        qlisCt.push(qct);
                    }
                }
                if (qlisCt.length > 0) {
                    qlis = qlisCt;
                }
            }
        }

        var iliCodeNorm = self._normalizeText(ili.item_code);
        var selected = null;

        if (iliCodeNorm) {
            var anyItemCodeMatch = false;
            var cand = [];
            for (ii = 0; ii < qlis.length; ii++) {
                var q = qlis[ii];
                var qcNorm = self._normalizeText(q.item_code);
                if (!qcNorm) {
                    continue;
                }
                if (qcNorm.indexOf(iliCodeNorm) < 0 && iliCodeNorm.indexOf(qcNorm) < 0) {
                    continue;
                }
                anyItemCodeMatch = true;
                var ds = self._descMatchScoreForQli(chargeDesc, q);
                if (!ds.passes) {
                    continue;
                }
                cand.push({ qli: q, matchCount: ds.matchCount });
            }
            if (cand.length > 0) {
                cand.sort(function (a, b) {
                    if (b.matchCount !== a.matchCount) {
                        return b.matchCount - a.matchCount;
                    }
                    return self._tieBreakCupMagnitude(a.qli, ili) - self._tieBreakCupMagnitude(b.qli, ili);
                });
                selected = cand[0].qli;
            } else if (!anyItemCodeMatch) {
                return { result: null, remarks: 'No quote line with a matching item code for this serial/IBX.', matchedQli: null, validationStep: 'Quote - No match (Item code)' };
            } else {
                return { result: null, remarks: 'Item code matched, but charge description similarity was below 60% for every candidate.', matchedQli: null, validationStep: 'Quote - No match (Description)' };
            }
        } else {
            var qlisEmptyCode = [];
            for (ii = 0; ii < qlis.length; ii++) {
                if (!self._normalizeText(qlis[ii].item_code)) {
                    qlisEmptyCode.push(qlis[ii]);
                }
            }
            qlis = qlisEmptyCode;
            if (qlis.length === 0) {
                return { result: null, remarks: 'ILI has no item code; no quote line with empty item code for this serial/IBX.', matchedQli: null, validationStep: 'Quote - No match (Item code)' };
            }
            var cand2 = [];
            for (ii = 0; ii < qlis.length; ii++) {
                var q2 = qlis[ii];
                var ds2 = self._descMatchScoreForQli(chargeDesc, q2);
                if (!ds2.passes) {
                    continue;
                }
                cand2.push({ qli: q2, matchCount: ds2.matchCount });
            }
            if (cand2.length === 0) {
                return { result: null, remarks: 'No quote line reached 60% charge description similarity (CD match).', matchedQli: null, validationStep: 'Quote - No match (Description)' };
            }
            cand2.sort(function (a, b) {
                if (b.matchCount !== a.matchCount) {
                    return b.matchCount - a.matchCount;
                }
                return self._tieBreakCupMagnitude(a.qli, ili) - self._tieBreakCupMagnitude(b.qli, ili);
            });
            selected = cand2[0].qli;
        }

        return this._validateWithQLI(ili, selected);
    },

    _validateWithQLI: function (ili, qli) {
        var qty = ili.quantity;
        var unitPrice = ili.unit_price;
        var lla = ili.total_price;
        var llaCalculated = false;
        if (isNaN(qty)) {
            qty = 0;
        }
        if (isNaN(unitPrice) && !isNaN(lla) && qty > 0 && lla !== 0) {
            unitPrice = lla / qty;
        }
        if ((lla === 0 || isNaN(lla)) && !isNaN(unitPrice) && unitPrice !== 0 && qty > 0) {
            lla = unitPrice * qty;
            llaCalculated = true;
        }

        if (qty !== 0 && !isNaN(qty)) {
            var qtyPos2 = qty > 0;
            if (!isNaN(unitPrice) && unitPrice !== 0 && (unitPrice > 0) !== qtyPos2) {
                unitPrice = -unitPrice;
            }
            if (!isNaN(lla) && lla !== 0 && (lla > 0) !== qtyPos2) {
                lla = -lla;
            }
        }

        if (unitPrice === 0 && lla === 0) {
            return { result: 'validated', remarks: 'Unit Price and LLA are zero; no charge.', matchedQli: qli, validationStep: 'Quote - Passed (No charge)', llaCalculated: false };
        }
        if (isNaN(unitPrice) && isNaN(lla)) {
            return { result: 'failed', remarks: 'Cannot validate: ILI unit price and LLA are missing or invalid.', matchedQli: qli, validationStep: 'Quote - Failed (Unit price)', llaCalculated: llaCalculated };
        }

        var cup = this._getCUP(qli, ili);
        var effectiveCup = cup;
        var fallbackUnitPrice = NaN;
        var fallbackUnitPriceSource = null;
        if (isNaN(cup) || cup === 0) {
            var fallback = this._getQLIUnitPriceFromTotal(qli);
            if (!isNaN(fallback.price) && fallback.price !== 0) {
                effectiveCup = fallback.price;
                fallbackUnitPrice = fallback.price;
                fallbackUnitPriceSource = fallback.source;
            }
        }

        var qliDescForPf = qli.item_description || '';
        var pfQLI = this._computePFQLI(qliDescForPf);
        var normFactorQLI = pfQLI > 0 && pfQLI < 1 ? 1 / pfQLI : 1;
        effectiveCup = effectiveCup * normFactorQLI;

        var priceTolerance = this.priceTolerance;
        var qtyTolerance = this.qtyTolerance;
        var signedPriceTolerance = priceTolerance;
        var unitPriceThresholdRaw = effectiveCup * (1 + signedPriceTolerance);
        var unitPriceThreshold = Math.round(unitPriceThresholdRaw * 100) / 100;

        if (isNaN(effectiveCup) || effectiveCup === 0) {
            return { result: 'failed', remarks: 'No valid quote unit price (CUP) for date.', matchedQli: qli, validationStep: 'Quote - Failed (No CUP)', llaCalculated: llaCalculated };
        }

        var fallbackNote = fallbackUnitPriceSource ? (' (QLI unit price derived from ' + fallbackUnitPriceSource + ' / Quantity)') : '';

        var pf = this._getPF(ili);
        var normFactor = pf > 0 && pf < 1 ? 1 / pf : 1;
        var unitPriceForCompare = normFactor === 1 ? unitPrice : (isNaN(unitPrice) ? unitPrice : unitPrice * normFactor);
        var llaForCompare = normFactor === 1 ? lla : (isNaN(lla) ? lla : lla * normFactor);

        var unitPriceMissingOrInvalid = (isNaN(unitPriceForCompare) || unitPriceForCompare == null) && !isNaN(effectiveCup) && effectiveCup !== 0;
        var unitPriceExceedsTolerance = !isNaN(unitPriceForCompare) && Math.abs(unitPriceForCompare) > Math.abs(unitPriceThreshold);

        if (unitPriceExceedsTolerance || unitPriceMissingOrInvalid) {
            var qliQtyEarly = qli.quantity;
            var qliExtended = effectiveCup * qliQtyEarly;
            var iliQtyOne = qty === 1;
            var canTryExtended = iliQtyOne && !isNaN(qliQtyEarly) && qliQtyEarly !== 0 && !isNaN(lla) && lla !== 0;
            var extendedCoversLla = canTryExtended && qliExtended >= lla;
            if (extendedCoversLla) {
                return {
                    result: 'validated',
                    remarks: 'All validations passed.' + fallbackNote + '\nEither quantity or unit price is wrong in QLI (passed: QLI computed unit price × QLI quantity covers ILI LLA).',
                    matchedQli: qli,
                    validationStep: 'Quote - Passed (QLI CUP×qty covers ILI LLA)',
                    llaCalculated: llaCalculated
                };
            }
            var upDisplay = !isNaN(unitPrice) ? unitPrice.toFixed(2) : 'N/A';
            var remarks = unitPriceMissingOrInvalid
                ? ('Cannot validate: ILI unit price missing or invalid. QLI CUP=' + unitPriceThreshold.toFixed(2) + fallbackNote)
                : ('Unit price ' + upDisplay + ' exceeds CUP*(1+tolerance)=' + unitPriceThreshold + fallbackNote);
            return { result: 'failed', remarks: remarks, matchedQli: qli, validationStep: 'Quote - Failed (Unit price)', llaCalculated: llaCalculated };
        }

        var finalizePass = function (validationStep, remarks, qliQtyForMsg) {
            var upDisplay = !isNaN(unitPrice) ? unitPrice.toFixed(2) : 'N/A';
            var qQtyDisplay = qliQtyForMsg !== undefined ? qliQtyForMsg : qli.quantity;
            if (!isNaN(unitPriceForCompare) && Math.abs(unitPriceForCompare) > Math.abs(unitPriceThreshold)) {
                return {
                    result: 'failed',
                    remarks: 'Unit price ' + upDisplay + ' exceeds CUP*(1+tolerance)=' + unitPriceThreshold + fallbackNote,
                    matchedQli: qli,
                    validationStep: 'Quote - Failed (Unit price)',
                    llaCalculated: llaCalculated
                };
            }
            return {
                result: 'validated',
                remarks: remarks,
                matchedQli: qli,
                validationStep: validationStep,
                llaCalculated: llaCalculated,
                qliQty: qQtyDisplay
            };
        };

        // LLA vs ELLA intentionally disabled (validationLogic.js)
        var qtyILI = qty;
        var qliQty = qli.quantity;
        if (isNaN(qliQty) || qliQty === 0) {
            return finalizePass('Quote - Passed (No quote quantity)', 'No quote quantity on matched QLI.' + fallbackNote, qliQty);
        }
        if (Math.abs(qtyILI) > Math.abs(qliQty) * (1 + qtyTolerance)) {
            return finalizePass(
                'Quote - Passed (Qty mismatch)',
                'All validations passed (Quantity mismatch: ILI qty ' + qtyILI + ' exceeds QLI qty ' + qliQty + ' * (1+' + (qtyTolerance * 100).toFixed(0) + '%))' + fallbackNote,
                qliQty
            );
        }
        return finalizePass('Quote - Passed', 'All validations passed.' + fallbackNote, qliQty);
    },

    type: 'EquinixILIQuoteValidation'
};
