# Quote Extraction Review for AI Team

## Context
I reviewed the file below to understand why quote validation quality is low after push to DOMS.

- Source file: `C:\Users\Nikhil D\Downloads\x_attm_doms_doms_quotation_line_items.csv`
- Total records reviewed: `28,207`

This note is intentionally written in plain business language so it can be shared directly.

---

## What we observed

### 1) Serial number is not being pushed
- Column: `serial_number`
- Empty in `28,207 / 28,207` rows (`100.00%`)
- Impact: serial-based line matching cannot happen.

### 2) Start date is not flowing
- Column: `start_date`
- Empty in `28,207 / 28,207` rows (`100.00%`)
- Impact: date-dependent pricing logic cannot be applied correctly.

### 3) PO numbers are empty in many quote line items
- Column: `quotation.po_number`
- Empty in `25,448 / 28,207` rows (`90.22%`)
- Impact: quote-to-invoice linkage becomes weak and unstable.

### 4) MRC and OTC are empty
- Columns: `mrc`, `otc`
- `mrc` empty in `28,207 / 28,207` rows (`100.00%`)
- `otc` empty in `28,207 / 28,207` rows (`100.00%`)
- Impact: expected commercial value is missing for almost all lines.

### 5) Quantity has non-numeric values in some cases
- Column: `quantity`
- Non-numeric values in `35` rows (`0.12%`)
- Examples include text values such as `100GB`, `1000Mbps`, `up to 5000`.
- Impact: validation logic that expects numeric quantity can misclassify these rows.

### 6) Wrong data is flowing in item code
- Column: `item_code`
- Suspicious value patterns found in `1,553` rows.
- Example pattern: PO numbers appearing inside `item_code` (e.g., `PO3000253641`).
- Impact: item-code-based matching becomes noisy and unreliable.

### 7) Description fields are not flowing
- Columns: `item_description`, `changed_item_description`, `service_description`
- All three are empty in `28,207 / 28,207` rows (`100.00%`)
- Impact: description similarity matching cannot work.

### 8) More than 60% of records are missing site_id
- Column: `site_id`
- Empty in `18,547 / 28,207` rows (`65.75%`)
- Impact: site-based filtering and matching significantly degrade.

---

## Examples from the sheet

### Serial number missing
- Row `2`: `serial_number` = empty
- Row `30`: `serial_number` = empty
- Row `1147`: `serial_number` = empty

### Start date missing
- Row `2`: `start_date` = empty
- Row `33`: `start_date` = empty
- Row `2475`: `start_date` = empty

### PO number empty
- Row `2`: `quotation.po_number` = empty, `quotation` = `QUOTE0005919`
- Row `3`: `quotation.po_number` = empty, `quotation` = `QUOTE0005919`
- Row `6`: `quotation.po_number` = empty, `quotation` = `QUOTE0005919`

### MRC and OTC empty
- Row `2`: `mrc` = empty, `otc` = empty
- Row `30`: `mrc` = empty, `otc` = empty
- Row `1147`: `mrc` = empty, `otc` = empty

### Non-numeric quantity
- Row `51`: `quantity` = `100GB`
- Row `1380`: `quantity` = `1000Mbps`
- Row `2466`: `quantity` = `up to 5000`
- Row `2475`: `quantity` = `up to 1500`

### Item code contains wrong/vague values
- Row `1138`: `item_code` = `PO3000253641`
- Row `1146`: `item_code` = `PO3000253827`
- Row `1198`: `item_code` = `PO3000253838`

### Description fields missing
- Row `2`: `item_description`, `changed_item_description`, `service_description` are all empty
- Row `30`: same pattern (all empty)
- Row `1147`: same pattern (all empty)

### Site ID missing
- Row `13`: `site_id` = empty
- Row `18`: `site_id` = empty
- Row `22`: `site_id` = empty

---

## Closing note
This is not just a header-name mismatch issue.  
Most required columns exist in schema, but values are not being populated in the extracted output.  
Because of that, quote validation in DOMS is expected to underperform until extraction quality is corrected for the critical fields above.

