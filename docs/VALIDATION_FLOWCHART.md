# Invoice vs Quote / Rate Card – Validation Flowcharts

- **Mermaid flowcharts:** Use [mermaid.live](https://mermaid.live/) — paste one diagram at a time for a larger, readable view.
- **Sequence diagram:** Use [SequenceDiagram.org](https://sequencediagram.org/) — paste the code from the section below.

---

## 1. Overview (high-level, large font)

Paste this first for the big picture. Font size is set to 18px for readability.

```mermaid
%%{init: {'theme':'base', 'themeVariables': {'fontSize':'18px'}}}%%
flowchart LR
  A[Each ILI] --> B{Has PO?}
  B -->|No| RC[Rate Card]
  B -->|Yes| C{QLIs for PO?}
  C -->|No| RC
  C -->|Yes| D{IBX + site match?}
  D -->|No| RC
  D -->|Yes| E{Item code or desc match?}
  E -->|No| RC
  E -->|Yes| F[CUP from invoice start date]
  F --> G{Price / LLA / Qty OK?}
  G -->|No| H[Quote Failed]
  G -->|Yes| I[Quote Passed]
  RC --> J{Service date OK? RC row found?}
  J -->|No| K[Skipped]
  J -->|Yes| L{Price ≤ RC?}
  L -->|Yes| M[Rate Card Passed]
  L -->|No| N[Rate Card Failed]
```

---

## 2. Quote validation flow (detailed, large font)

Paste this **alone** in Mermaid Live for a clear, readable quote path. Use **View → Zoom in** in the browser if needed.

```mermaid
%%{init: {'theme':'base', 'themeVariables': {'fontSize':'18px'}}}%%
flowchart TB
  subgraph START[" "]
    A(["Start: For each ILI"])
  end

  subgraph PO["1. PO filter"]
    A --> B{ILI has PO?}
    B -->|No| TO_RC["→ For Rate Card"]
    B -->|Yes| D{QLIs for this PO?}
    D -->|No| TO_RC
    D -->|Yes| F[Filter QLIs by PO]
  end

  subgraph IBX["2. IBX filter"]
    F --> G{ILI has IBX?}
    G -->|No| TO_RC
    G -->|Yes| I{QLI site_id = ILI IBX?}
    I -->|No| TO_RC
    I -->|Yes| K[QLIs with matching site]
  end

  subgraph MATCH["3. Match QLI"]
    K --> L{Match by item code?}
    L -->|Yes| M[Pick best item-code match]
    L -->|No| N{Match by description? 3+ words}
    N -->|No| TO_RC
    N -->|Yes| P[Pick best description match]
    M --> Q[selectedQLI]
    P --> Q
  end

  subgraph CHECKS["4. Quote checks"]
    Q --> R{Zero charge?}
    R -->|Yes| S["Quote Passed - No charge"]
    R -->|No| T["CUP from invoice start date only"]
    T --> U{CUP valid?}
    U -->|No| TO_RC
    U -->|Yes| W{Unit price ≤ CUP × 1+tol?}
    W -->|No| X["Quote Failed - Unit price"]
    W -->|Yes| Y{LLA ≤ ELLA × 1+tol?}
    Y -->|No| Z["Quote Failed - LLA"]
    Y -->|Yes| AA{QLI has quantity?}
    AA -->|No| TO_RC
    AA -->|Yes| AC{Qty ≤ QLI qty × 1+tol?}
    AC -->|No| AD["Quote Failed - Quantity"]
    AC -->|Yes| AE["Quote Passed"]
  end

  S --> END(["End"])
  X --> END
  Z --> END
  AD --> END
  AE --> END
  TO_RC --> END
```

---

## 3. Rate card validation flow (detailed, large font)

Paste this **alone** in Mermaid Live for a clear, readable rate card path.

```mermaid
%%{init: {'theme':'base', 'themeVariables': {'fontSize':'18px'}}}%%
flowchart TB
  subgraph ENTRY["When For Rate Card"]
    RC["validateWithRateCard"]
  end

  subgraph PRE["Pre-checks"]
    RC --> RC1{service_start_date present?}
    RC1 -->|No| SKIP1["Skipped - No service date"]
    RC1 -->|Yes| RC2{In window 2025-04-01 to 2026-03-31?}
    RC2 -->|No| SKIP2["Skipped - Outside window"]
    RC2 -->|Yes| RC3[Unit price from ILI or LLA/Qty]
  end

  subgraph FIND["Find rate card row"]
    RC3 --> RC4[Loop categories in order]
    RC4 --> RC5{Description contains config key?}
    RC5 -->|No| RC4
    RC5 -->|Yes| RC6{Entry has subkey?}
    RC6 -->|No| RC7[Match: key + fields]
    RC6 -->|Yes| RC8{Description contains subkey?}
    RC8 -->|No| RC4
    RC8 -->|Yes| RC7
    RC7 --> RC9[Filter: sub_type, country, region, dates, IBX]
    RC9 --> RC10{Subkey in row u_subkeys?}
    RC10 -->|No| RC4
    RC10 -->|Yes| RC11[Skip ICB rows]
    RC11 --> RC12{Row field values in description?}
    RC12 -->|No| RC13[Next candidate]
    RC13 --> RC12
    RC12 -->|Yes| RC14[First matching row]
    RC14 --> RC15{Found row?}
    RC15 -->|No| SKIP3["Skipped - No row matched"]
    RC15 -->|Yes| RC16{Row ICB?}
    RC16 -->|Yes| SKIP4["Skipped - ICB"]
    RC16 -->|No| RC17[Smart Hands MRC? Skip]
    RC17 --> RC18[Get CUP from row by sub_type]
  end

  subgraph VAL["Price validation"]
    RC18 --> RC19{CUP found?}
    RC19 -->|No| SKIP5["Skipped - No price"]
    RC19 -->|Yes| RC20{Both zero?}
    RC20 -->|Yes| PASS1["Rate Card Passed - Zero"]
    RC20 -->|No| RC21{ILI price > CUP × 1+tol?}
    RC21 -->|Yes| FAIL["Rate Card Failed"]
    RC21 -->|No| PASS2["Rate Card Passed"]
  end

  SKIP1 --> END(["End"])
  SKIP2 --> END
  SKIP3 --> END
  SKIP4 --> END
  SKIP5 --> END
  PASS1 --> END
  PASS2 --> END
  FAIL --> END
```

---

## 4. Full detail (single diagram, large font)

One combined flowchart with 18px font. Paste in Mermaid Live and use **browser zoom** (Ctrl/Cmd +) if needed.

```mermaid
  %%{init: {'theme':'base', 'themeVariables': {'fontSize':'18px'}}}%%
  flowchart TB
    subgraph START[" "]
      A(["Start: For each ILI"])
    end

    subgraph PO_FILTER["1. PO filter"]
      A --> B{ILI has PO?}
      B -->|No| C["For Rate Card - No PO"]
      B -->|Yes| D{QLIs for PO?}
      D -->|No| E["For Rate Card - No PO"]
      D -->|Yes| F[Filter QLIs by PO]
    end

    subgraph IBX_FILTER["2. IBX filter"]
      F --> G{ILI has IBX?}
      G -->|No| H["For Rate Card - No IBX"]
      G -->|Yes| I{QLI site = ILI IBX?}
      I -->|No| J["For Rate Card - No site match"]
      I -->|Yes| K[QLIs by site]
    end

    subgraph MATCH_QLI["3. Match QLI"]
      K --> L{Item code match?}
      L -->|Yes| M[Best item-code QLI]
      L -->|No| N{Desc match 3+ words?}
      N -->|No| O["For Rate Card - No match"]
      N -->|Yes| P[Best desc QLI]
      M --> Q[selectedQLI]
      P --> Q
    end

    subgraph QUOTE_CHECKS["4. Quote validation"]
      Q --> R{Zero charge?}
      R -->|Yes| S["Quote Passed"]
      R -->|No| T["CUP from invoice file date only"]
      T --> U{CUP valid?}
      U -->|No| V["For Rate Card - No CUP"]
      U -->|Yes| W{Price ≤ CUP × 1+tol?}
      W -->|No| X["Quote Failed - Price"]
      W -->|Yes| Y{LLA ≤ ELLA × 1+tol?}
      Y -->|No| Z["Quote Failed - LLA"]
      Y -->|Yes| AA{QLI has qty?}
      AA -->|No| AB["For Rate Card - No qty"]
      AA -->|Yes| AC{Qty ≤ QLI qty × 1+tol?}
      AC -->|No| AD["Quote Failed - Qty"]
      AC -->|Yes| AE["Quote Passed"]
    end

    subgraph RATE_CARD["Rate card path"]
      C --> RC
      E --> RC
      H --> RC
      J --> RC
      O --> RC
      V --> RC
      AB --> RC
      RC["validateWithRateCard"]
      RC --> RC1{service_start_date?}
      RC1 -->|No| RS1[Skipped]
      RC1 -->|Yes| RC2{In date window?}
      RC2 -->|No| RS2[Skipped]
      RC2 -->|Yes| RC3[Loop categories; match key+subkey+fields]
      RC3 --> RC4{Found row?}
      RC4 -->|No| RS3[Skipped]
      RC4 -->|Yes| RC5{ICB?}
      RC5 -->|Yes| RS4[Skipped]
      RC5 -->|No| RC6[Get CUP from row]
      RC6 --> RC7{Price > CUP × 1+tol?}
      RC7 -->|Yes| RF[Rate Card Failed]
      RC7 -->|No| RP["Rate Card Passed"]
    end

    S --> END(["End"])
    X --> END
    Z --> END
    AD --> END
    AE --> END
    RS1 --> END
    RS2 --> END
    RS3 --> END
    RS4 --> END
    RP --> END
    RF --> END
```

---

## SequenceDiagram.org – validation flow (paste at [sequencediagram.org](https://sequencediagram.org/))

Copy the block below (no backticks) and paste it into the **source editor** at [SequenceDiagram.org](https://sequencediagram.org/). Use **View → Presentation Mode (Ctrl+M)** and **Zoom** for a readable view. Export via **Export Diagram** (PNG/SVG) or **URL to Share**.

```
title Invoice vs Quote / Rate Card Validation - For each ILI

participant Validator
participant Quote
participant RateCard

Validator->Validator: For each Invoice Line Item
Validator->Quote: Get QLIs by PO number

alt No PO on ILI or no QLIs for PO
  Validator->RateCard: Validate with Rate Card
  note over Validator,RateCard: For Rate Card path
else PO and QLIs exist
  Quote-->>Validator: QLIs
  Validator->Validator: Filter QLIs by IBX / site_id
  alt No IBX on ILI or no QLI with matching site
    Validator->RateCard: Validate with Rate Card
    note over Validator,RateCard: For Rate Card path
  else IBX and site match
    Validator->Validator: Match QLI by item code or description
    alt No item code or description match
      Validator->RateCard: Validate with Rate Card
      note over Validator,RateCard: For Rate Card path
    else QLI matched
      Validator->Validator: CUP from invoice start date only
      Validator->Validator: Check unit price vs CUP, LLA vs ELLA, qty vs quote qty
      alt Unit price or LLA or qty fails
        Validator->Validator: Quote Failed
      else All checks pass
        Validator->Validator: Quote Passed
      end
    end
  end
end

note over Validator,RateCard: Rate card path
Validator->RateCard: validateWithRateCard
activate RateCard
RateCard->RateCard: service_start_date in window?
alt No service date or outside window
  RateCard-->>Validator: Skipped
else In window
  RateCard->RateCard: Loop categories; match key + subkey + fields
  RateCard->RateCard: Filter rows: sub_type, country, region, dates, IBX
  RateCard->RateCard: First row with field values in description
  alt No row found or ICB
    RateCard-->>Validator: Skipped
    deactivate RateCard
  else Row found
    RateCard->RateCard: Get CUP from row
    RateCard-->>Validator: CUP
    deactivate RateCard
    Validator->Validator: ILI price vs CUP × 1+tolerance
    alt ILI price > CUP × 1+tol
      Validator->Validator: Rate Card Failed
    else
      Validator->Validator: Rate Card Passed
    end
  end
end
```

---

## Quote price validation – formulas image

**Option A – HTML (one-page image):**  
Open **`docs/quote-price-validation-formulas.html`** in a browser. Zoom if needed, then **screenshot** or **Print → Save as PDF** to get a single image with all formulas.

**Option B – Mermaid (export as PNG/SVG):**  
Paste the following into [mermaid.live](https://mermaid.live/) and export as image.

```mermaid
%%{init: {'theme':'base', 'themeVariables': {'fontSize':'16px'}}}%%
flowchart TB
  subgraph derived["Derived values"]
    F1["Unit Price = LLA ÷ Quantity<br/>when Unit Price missing"]
    F2["LLA = Unit Price × Quantity<br/>when LLA missing"]
  end

  subgraph cup["CUP - from invoice start date only"]
    C1["today &lt; invoice_start_date  ⇒  CUP = QLI Unit Price"]
    C2["today &lt; endInitial  ⇒  CUP = QLI Unit Price"]
    C3["today &lt; endFirstTerm  ⇒  CUP = QLI UP × 1+initialTermIncrement"]
    C4["today ≥ endFirstTerm  ⇒  CUP = QLI UP × 1+initialTermInc × 1+increment^numTerms"]
  end

  subgraph prorata["Prorata factor"]
    P1["days = max 0, till minus from in ms ÷ 86400000 + 1"]
    P2["PF = min 1, days ÷ daysInMonth"]
  end

  subgraph ella["ELLA"]
    E1["ELLA = CUP × Quantity × PF"]
  end

  subgraph checks["Pass conditions"]
    V1["Unit Price ≤ CUP × 1+tolerance"]
    V2["LLA ≤ ELLA × 1+tolerance"]
    V3["Quantity ≤ QLI Quantity × 1+qtyTolerance"]
  end

  F1 --> cup
  F2 --> cup
  cup --> prorata
  prorata --> ella
  ella --> checks
```

---

## CUP calculation (quote path) – detail

Invoice start date is taken **only from the invoice file** (ILI). Used in `getCUP(qli, ili, today)`:

| Condition (using ILI invoice_start_date) | CUP |
|----------------------------------------|-----|
| today &lt; invoice_start_date | QLI unit price |
| today &lt; invoice_start_date + initial_term | QLI unit price |
| today &lt; invoice_start_date + initial_term + term | QLI unit price × (1 + initialTermIncrement) |
| today ≥ invoice_start_date + initial_term + term | QLI unit price × (1 + initialTermIncrement) × (1 + increment)^num_completed_terms |

---

## Rate card category order (first match wins)

1. space_and_power  
2. power_install_nrc  
3. secure_cabinet_express  
4. cabinet_install_nrc  
5. interconnection  
6. smart_hands  
7. equinix_precision_time  

Rate card row is the **first** row that: matches category + sub_type + country + region + dates + IBX, is not ICB, and has every `fields` value present in charge_description.
