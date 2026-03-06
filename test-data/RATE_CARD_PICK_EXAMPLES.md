# Rate Card Pick Examples (Test Data)

How the app picks **one** rate card row for an invoice line, using the test data in `test-data/`.

---

## Example 1: Metro Connect Protected

**Invoice line (e.g. row 42 in Base_Test_Invoice.xlsx)**

| Field              | Value            |
|--------------------|------------------|
| description        | Metro Connect Protected |
| IBX                | DA1              |
| country            | United States    |
| region             | Americas         |
| service_start_date | 2025-06-01       |
| unit_price         | 220              |

**How the rate card is picked**

1. **Category from charge description**  
   - Config: category `interconnection` has entry `key = "Metro Connect"`, `subkey = ["Protected","Unprotected","Dual Diverse"]`, `fields = ["u_parameter1"]`.  
   - Description contains key `"Metro Connect"` and subkey `"Protected"` → category = **Interconnection**, subkey = **Protected**, fields = **[u_parameter1]**.

2. **Candidates**  
   - All rate card rows where:  
     `u_rate_card_sub_type = "Interconnection"`,  
     country/region/dates match,  
     IBX applies (e.g. `u_all_ibx = true`),  
     and (for this config) `u_subkeys` would need to contain `"Protected"` if we filtered by subkey — for Metro Connect the config uses **fields**, not u_subkeys for the row filter in the same way; the row must have **u_parameter1** such that the description contains it.

3. **Field check**  
   - For each candidate, require: **charge_description** contains the value of **u_parameter1**.  
   - So we need a row with `u_parameter1 = "Protected"` (and matching country/region/dates/IBX).

4. **First matching row**  
   - In **Rate_Card_Test.xlsx** the first such row has **u_parameter1 = "Protected"**, **u_nrc = 220**.  
   - That row is **picked**. Unit price used for validation = **220**.  
   - Invoice unit_price 220 ≤ 220 × (1 + tolerance) → **Rate Card – Passed**.

---

## Example 2: Equinix Internet Access Standard Port

**Invoice line (e.g. row 43)**

| Field              | Value                               |
|--------------------|-------------------------------------|
| description        | Equinix Internet Access Standard Port |
| IBX                | DA1                                 |
| country            | United States                       |
| region             | Americas                            |
| service_start_date | 2025-06-01                          |
| unit_price         | 200                                 |

**How the rate card is picked**

1. **Category**  
   - Config: `interconnection` has entry `key = "Equinix Internet Access"`, no subkey, `fields = ["u_goods_services_category","u_parameter1"]`.  
   - Description contains `"Equinix Internet Access"` → category = **Interconnection**, fields = **[u_goods_services_category, u_parameter1]**.

2. **Candidates**  
   - All **Interconnection** rows that match country, region, dates, IBX.

3. **Field check**  
   - Charge description must contain **both**:  
     - value of **u_goods_services_category** (e.g. `"Standard"`),  
     - value of **u_parameter1** (e.g. `"Port"`).  
   - So we need a row with `u_goods_services_category = "Standard"` and `u_parameter1 = "Port"`.

4. **First matching row**  
   - In **Rate_Card_Test.xlsx** there is a row: **u_parameter1 = "Port"**, **u_goods_services_category = "Standard"**, **u_nrc = 200**.  
   - That row is **picked**. Unit price used = **200**.  
   - Invoice 200 ≤ 200 × (1 + tolerance) → **Rate Card – Passed**.

---

## Example 3: AC Power 1.5 kVA

**Invoice line (e.g. row 33)**

| Field              | Value            |
|--------------------|------------------|
| description        | AC Power 1.5 kVA |
| IBX                | DA1              |
| country            | United States    |
| region             | Americas         |
| service_start_date | 2025-06-01       |
| unit_price         | 12               |

**How the rate card is picked**

1. **Category**  
   - Config: category `space_and_power` has entry `key = "AC Power"`, `subkey = ["kVA"]`, `fields = ["u_minimum_cabinet_density"]`.  
   - Description contains `"AC Power"` and `"kVA"` → category = **Space & Power**, fields = **[u_minimum_cabinet_density]**.

2. **Candidates**  
   - All rate card rows with **u_rate_card_sub_type = "Space & Power"** and matching country, region, dates, IBX.

3. **Field check**  
   - Charge description must contain the value of **u_minimum_cabinet_density** (e.g. `"1.5"`).  
   - So we need a row with **u_minimum_cabinet_density = 1.5** (or string `"1.5"` that appears in "AC Power 1.5 kVA").

4. **First matching row**  
   - In **Rate_Card_Test.xlsx** the first **Space & Power** row with **u_minimum_cabinet_density = 1.5** has **u_pricekva = 12**.  
   - That row is **picked**. Unit price used = **12** (from u_pricekva).  
   - Invoice 12 ≤ 12 × (1 + tolerance) → **Rate Card – Passed**.

---

## Example 4: Cabinet Installation

**Invoice line (e.g. row 37)**

| Field              | Value               |
|--------------------|---------------------|
| description        | Cabinet Installation |
| IBX                | DA1                 |
| service_start_date | 2025-06-01          |
| unit_price         | 200                 |

**How the rate card is picked**

1. **Category**  
   - Config: `cabinet_install_nrc` has entry `key = "Cabinet Installation"`, no subkey, **fields = []**.  
   - Description contains `"Cabinet Installation"` → category = **Cabinet Install NRC**, no field check.

2. **Candidates**  
   - All rows with **u_rate_card_sub_type = "Cabinet Install NRC"** and matching country, region, dates, IBX.

3. **Field check**  
   - No fields → every candidate passes the “fields in description” check.

4. **First matching row**  
   - First **Cabinet Install NRC** row in **Rate_Card_Test.xlsx** (e.g. **u_nrc = 200**) is **picked**.  
   - Unit price used = **200**. Invoice 200 ≤ 200 × (1 + tolerance) → **Rate Card – Passed**.

---

## Example 5: AC Circuit 30 208 (Power Install NRC)

**Invoice line (e.g. row 41)**

| Field              | Value            |
|--------------------|------------------|
| description        | AC Circuit 30 208 |
| IBX                | DA1              |
| service_start_date | 2025-06-01       |
| unit_price         | 500              |

**How the rate card is picked**

1. **Category**  
   - Config: `power_install_nrc` has entry `key = "AC Circuit"`, no subkey, `fields = ["u_amps","u_volt"]`.  
   - Description contains `"AC Circuit"` → category = **Power Install NRC**, fields = **[u_amps, u_volt]**.

2. **Candidates**  
   - All rows with **u_rate_card_sub_type = "Power Install NRC"** and matching country, region, dates, IBX.

3. **Field check**  
   - Charge description must contain **u_amps** (e.g. `"30"`) and **u_volt** (e.g. `"208"`).  
   - So we need a row with **u_amps = "30"**, **u_volt = "208"**.

4. **First matching row**  
   - In **Rate_Card_Test.xlsx** the first **Power Install NRC** row with **u_amps = 30**, **u_volt = 208** has **u_rate = 500**.  
   - That row is **picked**. Unit price used = **500**.  
   - Invoice 500 ≤ 500 × (1 + tolerance) → **Rate Card – Passed**.

---

## Example 6: Fail case – AC Power kVA (row 56)

**Invoice line (row 56)**

| Field       | Value        |
|------------|--------------|
| description | AC Power kVA |
| unit_price  | 500          |

- Category is still **Space & Power** (key "AC Power", subkey "kVA").  
- **Field check**: description must contain **u_minimum_cabinet_density**. The first matching row has density **1.5**; "AC Power kVA" does **not** contain "1.5", so that row can be skipped. If another row has empty density it might match; otherwise no row matches.  
- If a row with density 1.5 is still chosen (e.g. because "1.5" is not required to appear in the description for this config in your code), then **u_pricekva = 12** is used.  
- Invoice **500** > 12 × (1 + tolerance) → **Rate Card – Failed** (invoice price exceeds rate card).

---

## Summary table (test data)

| Invoice description (sample)           | Category            | Key / subkey / fields used                    | Rate card row picked (concept)                          |
|----------------------------------------|---------------------|-----------------------------------------------|---------------------------------------------------------|
| Metro Connect Protected                | Interconnection     | Metro Connect, Protected, u_parameter1        | First row with u_parameter1=Protected, u_nrc=220        |
| Equinix Internet Access Standard Port | Interconnection     | Equinix Internet Access, u_goods_services_category, u_parameter1 | First row with Standard + Port, u_nrc=200       |
| AC Power 1.5 kVA                       | Space & Power       | AC Power, kVA, u_minimum_cabinet_density       | First row with density 1.5, u_pricekva=12              |
| Cabinet Installation                   | Cabinet Install NRC | Cabinet Installation, (no fields)             | First Cabinet Install NRC row, u_nrc=200                |
| AC Circuit 30 208                       | Power Install NRC   | AC Circuit, u_amps, u_volt                    | First row with amps 30, volt 208, u_rate=500            |
| Smart Hands NRC                         | Smart Hands         | Smart Hands, (no fields)                      | First Smart Hands row, u_rate=150                       |
| Cross Connect Single-Mode Fiber        | Interconnection     | Cross Connect, Single-Mode Fiber              | Row with u_subkeys containing "Single-Mode Fiber" (if any) |

The **order of rows in Rate_Card_Test.xlsx** matters: the **first** row that passes category + filters + field check is the one used for validation.
