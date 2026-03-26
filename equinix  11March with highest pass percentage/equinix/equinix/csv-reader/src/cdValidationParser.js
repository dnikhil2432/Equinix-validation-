/**
* Charge description matching using hierarchical tokens.json.
* tokens.json: { "Category": { "Sub-Category": { "Sub-Sub-Category": { ... } } } }
* Supports N levels of nesting — no code changes needed when JSON depth increases.
*
* parseSentence() returns:
*   level_matches  — Array<{ label, matches[] }> — ALL matches at every level (N levels)
*   path[]         — primary match per level  e.g. ["Interconnection","Cross Connect","Single-Mode Fiber",...]
*   category       — path[0]  (convenience alias only)
*   sub_category   — path[1]  (convenience alias only)
*   sub_sub_category — path[2] (convenience alias only)
*   NOTE: path[3], path[4]... and level_matches[3], level_matches[4]...
*         hold deeper levels automatically — no code change needed.
*
* Fixes:
*   FIX 1 — Root keys are LABELS (not searchable). Category inferred from sub-tree matches.
*   FIX 2 — ALL siblings captured at each level. Jaccard used per level.
*   FIX 3 — Values normalised to lowercase (case-insensitive exact match).
*   FIX 4 — Values anchored to deepest path phrase (key-aware exact match).
*   FIX 5 — keyMap: tree key lookup uses original casing, not description text casing.
*   Absent key rule — one side missing a level → no penalty.
*   Hard fail — both sides have values for same key but none agree → score = 0.
*/
import tokens from './data/tokens.json'
import valueTokens from './data/valueTokens.json'
 
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
 
function buildRegex(phrases) {
  if (!phrases || phrases.length === 0) return null
  const sorted = [...phrases].sort((a, b) => b.length - a.length)
  return new RegExp(sorted.map(escapeRegex).join('|'), 'gi')
}
 
/**
* Walk the token tree top-down and collect all matches at each level.
*
* FIX 1 — Root level:
*   Category names are LABELS, not searchable phrases in descriptions.
*   → Try every top-level category's sub-tree; pick the one with the deepest match.
*   → Category name is prepended as an inferred label.
*
* FIX 2 — Non-root level:
*   ALL matching siblings captured at each level (e.g. "Single-Mode Fiber" AND "UTP").
*   → Primary match (first found) drives descent into children.
*
* FIX 5 — keyMap:
*   Regex is case-insensitive (gi flag) so match text may differ in case from tree key.
*   A keyMap (lowercase → original key) ensures tree[primaryMatch] always resolves correctly.
*
* Returns Array<{ label: string, matches: string[] }>
*   label   = primary match at this level (original casing from tree)
*   matches = ALL siblings found at this level (original casing from tree)
*/
function findLevelMatches(sentence, tree, isRoot = true) {
  if (isRoot) {
    let bestLevels = []
    let bestCatName = null
 
    for (const [catName, subTree] of Object.entries(tree)) {
      const subLevels = findLevelMatches(sentence, subTree, false)
      if (subLevels.length > bestLevels.length) {
        bestLevels = subLevels
        bestCatName = catName
      }
    }
 
    if (!bestCatName) return []
    return [{ label: bestCatName, matches: [bestCatName] }, ...bestLevels]
  }
 
  const keys = Object.keys(tree)
  if (keys.length === 0) return []    // leaf node
 
  // FIX 5: map lowercase → original tree key
  // Needed because regex match returns text from description (may differ in case from tree key)
  const keyMap = {}
  for (const k of keys) keyMap[k.toLowerCase()] = k
 
  const regex = buildRegex(keys)
  if (!regex) return []
 
  const seen = new Set()
  const allMatches = []
  sentence.replace(regex, (match) => {
    // Resolve to original tree key — not the raw text from the description
    const origKey = keyMap[match.trim().toLowerCase()] ?? match
    const keyLower = origKey.toLowerCase()
    if (!seen.has(keyLower)) {
      seen.add(keyLower)
      allMatches.push(origKey)    // always stores tree's original casing
    }
    return match    // don't consume — children need to see the text too
  })
 
  if (allMatches.length === 0) return []
 
  const primaryMatch = allMatches[0]
  const primaryChildren = tree[primaryMatch] || {}    // safe: primaryMatch is now always a valid tree key
 
  const childLevels = findLevelMatches(sentence, primaryChildren, false)
 
  return [{ label: primaryMatch, matches: allMatches }, ...childLevels]
}
 
// ─── Value regexes (from valueTokens.json) ───────────────────────────────────
const positiveNumber = '\\d+(?:\\.\\d+)?(?:\\s*-\\s*\\d+(?:\\.\\d+)?)?'
const negativeNumber = '-\\d+(?:\\.\\d+)?(?:\\s*-\\s*-\\d+(?:\\.\\d+)?)?'
const anyNumber      = '-?\\d+(?:\\.\\d+)?(?:\\s*-\\s*-?\\d+(?:\\.\\d+)?)?'
 
function buildValueRegex(tokenList, numberPattern) {
  if (!tokenList || tokenList.length === 0) return null
  const tokenPattern = tokenList.map(escapeRegex).join('|')
  return new RegExp(`(${numberPattern})(\\s{0,2})(?:${tokenPattern})`, 'gi')
}
 
const positiveValueRegex = buildValueRegex(valueTokens.only_positive, positiveNumber)
const negativeValueRegex = buildValueRegex(valueTokens.only_negative, negativeNumber)
const anyValueRegex      = buildValueRegex(valueTokens.positive_or_negitive || [], anyNumber)

// Avoid treating sequence separators like "-TR -TR -1 Gbps" as negative bandwidth.
// In these cases, "-1" is a delimiter artifact, not a true negative numeric value.
const trPrefixedBandwidthRegex = /((?:-\s*TR\d*\b\s*)+)-\s*(\d+(?:\.\d+)?)\s*(ft|Mbps|Gbps|G|M|Core|kVA)\b/gi
 
// ─── Date / UUID regexes ─────────────────────────────────────────────────────
const dateRangeRegex  = /\b(\d{2}-[A-Z]{3}-\d{4}\s*-\s*\d{2}-[A-Z]{3}-\d{4}|\d{2}-\d{2}-\d{4}\s*(?:-|to)\s*\d{2}-\d{2}-\d{4}|\d{4}-\d{2}-\d{2}\s*(?:-|to)\s*\d{4}-\d{2}-\d{2})\b/g
const singleDateRegex = /\b(\d{2}-[A-Z]{3}-\d{4}|\d{2}-\d{2}-\d{4}|\d{4}-\d{2}-\d{2})\b/g
const uuidRegex       = /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}\b/g
 
/**
* Empty result helper — returns correct shape for any N-level depth.
* Named aliases (category, sub_category, sub_sub_category) are null.
* Deeper levels are accessed via path[N] and level_matches[N].
*/
function emptyResult() {
  return {
    level_matches: [],          // N-level — grows automatically with JSON depth
    path: [],                   // N-level — grows automatically with JSON depth
    category: null,             // path[0] alias
    sub_category: null,         // path[1] alias
    sub_sub_category: null,     // path[2] alias
    // path[3], path[4]... available when JSON has deeper nesting — no code change needed
    value_matches: [],
    anchored_value_matches: [],
    special_matches: [],
    not_contains: []
  }
}
 
/**
* Parse a charge description into hierarchical level matches + value matches.
*
* Named fields (category, sub_category, sub_sub_category) are ALIASES only.
* They always equal path[0], path[1], path[2].
* For deeper levels use path[3], path[4]... or level_matches[3].matches etc.
*/
export function parseSentence(sentence) {
  if (!sentence || typeof sentence !== 'string') {
    return emptyResult()
  }
 
  let remaining = String(sentence)

  // User-approved alias: treat "Network Cable Connection" as "Cross Connect" for CD matching.
  remaining = remaining.replace(/\bNetwork Cable Connection\b/gi, 'Cross Connect')

  // User-approved alias: treat "Equinix Fabric Local Virtual Connection" as "Equinix Fabric Virtual Connection" for CD matching.
  remaining = remaining.replace(/\bEquinix Fabric Local Virtual Connection\b/gi, 'Equinix Fabric Virtual Connection')

  // Normalize TR-separated bandwidth text before numeric extraction.
  // Example: "-TR -TR -1 Gbps" -> "-TR -TR 1 Gbps"
  remaining = remaining.replace(trPrefixedBandwidthRegex, (_, trPrefix, value, unit) => `${trPrefix}${value} ${unit}`)
 
  // ── Step 1: N-level hierarchical matching ─────────────────────────────────
  const level_matches = findLevelMatches(remaining, tokens)
 
  // path[N] = primary match at level N — works for any depth automatically
  const path = level_matches.map(l => l.label)
 
  // Convenience aliases for the 3 most common levels — deeper levels use path[N]
  const category         = path[0] ?? null    // path[0]
  const sub_category     = path[1] ?? null    // path[1]
  const sub_sub_category = path[2] ?? null    // path[2]
  // path[3], path[4]... automatically available for deeper JSON nesting
 
  // Remove ALL matched phrases (all siblings at all levels) from remaining
  for (const { matches } of level_matches) {
    for (const phrase of matches) {
      remaining = remaining.replace(new RegExp(escapeRegex(phrase), 'gi'), ' ')
    }
  }
 
  // Anchor key = deepest primary phrase (for value→key association)
  const anchorKey = path.length > 0 ? path[path.length - 1] : null
 
  // ── Step 2: Value matches (FIX 3: lowercase normalisation) ───────────────
  const rawValueMatches = new Set()
  function extract(regex) {
    if (!regex) return
    regex.lastIndex = 0
    remaining = remaining.replace(regex, (match) => {
      rawValueMatches.add(match.trim().toLowerCase())
      return ' '
    })
  }
  extract(positiveValueRegex)
  extract(negativeValueRegex)
  extract(anyValueRegex)
 
  const value_matches = [...rawValueMatches]
 
  // FIX 4: Anchor each value to deepest path phrase
  const anchored_value_matches = value_matches.map(value => ({ key: anchorKey, value }))
 
  // ── Step 3: Special matches (dates, UUIDs) ────────────────────────────────
  const special_matches = new Set()
  dateRangeRegex.lastIndex = 0
  remaining = remaining.replace(dateRangeRegex,  (m) => { special_matches.add(m); return ' ' })
  singleDateRegex.lastIndex = 0
  remaining = remaining.replace(singleDateRegex, (m) => { special_matches.add(m); return ' ' })
  uuidRegex.lastIndex = 0
  remaining = remaining.replace(uuidRegex,       (m) => { special_matches.add(m); return ' ' })
 
  // ── Step 4: Leftovers → not_contains ─────────────────────────────────────
  const not_contains = new Set()
  for (let token of remaining.split(/\s+/).filter(Boolean)) {
    token = token.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, '')
    if (!token || !/[a-zA-Z0-9]/.test(token)) continue
    not_contains.add(token)
  }
 
  return {
    level_matches,
    path,
    category,
    sub_category,
    sub_sub_category,
    value_matches,
    anchored_value_matches,
    special_matches: [...special_matches],
    not_contains:    [...not_contains]
  }
}
 
/**
* Jaccard similarity (0–100). Returns 100 when both sets are empty.
*/
export function calculateJaccardSimilarity(keysA, keysB) {
  const setA = new Set(keysA)
  const setB = new Set(keysB)
  if (setA.size === 0 && setB.size === 0) return 100
  let intersectionCount = 0
  for (const key of setA) {
    if (setB.has(key)) intersectionCount++
  }
  const unionCount = setA.size + setB.size - intersectionCount
  return Number(((intersectionCount / unionCount) * 100).toFixed(2))
}
 
/**
* N-level comparison using level_matches arrays.
* Works for any depth — loop iterates over however many levels exist.
*
* Weights: L1=40%, L2=35%, L3=15%, L4+=remaining 10% split equally.
* Per level:
*   Both absent        → full points
*   Both present       → Jaccard on sibling sets
*   One absent         → absent key rule (check value_matches)
*/
function levelMatchScore(levelMatchesA, levelMatchesB, vmA, vmB) {
  const maxLen = Math.max(levelMatchesA.length, levelMatchesB.length)
  if (maxLen === 0) return 100
 
  const baseWeights = [0.40, 0.35, 0.25]
  const extraLevels = Math.max(0, maxLen - baseWeights.length)
  const extraWeight = extraLevels > 0 ? 0.10 / extraLevels : 0
 
  const setVmA = new Set(vmA || [])
  const setVmB = new Set(vmB || [])
 
  let score = 0
  let totalWeight = 0
 
  for (let i = 0; i < maxLen; i++) {
    const levelA = levelMatchesA[i]
    const levelB = levelMatchesB[i]
    const w = i < baseWeights.length ? baseWeights[i] : extraWeight
    totalWeight += w
 
    const matchesA = levelA ? levelA.matches.map(m => m.toLowerCase()) : []
    const matchesB = levelB ? levelB.matches.map(m => m.toLowerCase()) : []
 
    if (matchesA.length === 0 && matchesB.length === 0) {
      score += w
 
    } else if (matchesA.length === 0 || matchesB.length === 0) {
      const presentMatches = matchesA.length > 0 ? matchesA : matchesB
      const absentSideVm   = matchesA.length === 0 ? setVmA : setVmB
      if (presentMatches.some(m => absentSideVm.has(m))) score += w
 
    } else {
      const jaccard = calculateJaccardSimilarity(matchesA, matchesB)
      score += (jaccard / 100) * w
    }
  }
 
  return totalWeight > 0 ? Number((score / totalWeight * 100).toFixed(2)) : 100
}
 
/**
* Key-anchored value comparison.
* Absent key rule: if one side has no values for a key → success.
* Hard fail: both sides have values for same key but none agree → hardFail = true.
*/
function compareAnchoredValues(avmA, avmB) {
  if (avmA.length === 0 && avmB.length === 0) return { score: 100, hardFail: false }
  if (avmA.length === 0 || avmB.length === 0) return { score: 100, hardFail: false }
 
  const groupA = {}
  for (const { key, value } of avmA) {
    const k = key ?? '__none__'
    if (!groupA[k]) groupA[k] = new Set()
    groupA[k].add(value)
  }
  const groupB = {}
  for (const { key, value } of avmB) {
    const k = key ?? '__none__'
    if (!groupB[k]) groupB[k] = new Set()
    groupB[k].add(value)
  }
 
  const allKeys = new Set([...Object.keys(groupA), ...Object.keys(groupB)])
  let score = 0
  let hardFail = false
  const total = allKeys.size
 
  for (const key of allKeys) {
    const valsA = groupA[key]
    const valsB = groupB[key]
    if (!valsA) {
      score++
    } else if (!valsB) {
      score++
    } else {
      const jaccard = calculateJaccardSimilarity([...valsA], [...valsB])
      if (jaccard === 0) hardFail = true
      score += jaccard / 100
    }
  }
 
  return {
    score: Number((score / total * 100).toFixed(2)),
    hardFail
  }
}
 
const CD_PASS_THRESHOLD = 60
 
/**
* N-level hierarchical CD similarity.
* Final score = 85% × levelMatchScore + 15% × anchoredValueScore.
* Returns { score, passes, parsedA, parsedB }.
*/
export function calculateCDSimilarity(iliDesc, qliDesc) {
  const parsedA = parseSentence(iliDesc)
  const parsedB = parseSentence(qliDesc)
 
  const sLevels = levelMatchScore(
    parsedA.level_matches, parsedB.level_matches,
    parsedA.value_matches, parsedB.value_matches
  )
 
  const { score: sValues, hardFail } = compareAnchoredValues(
    parsedA.anchored_value_matches,
    parsedB.anchored_value_matches
  )
 
  if (hardFail) {
    return { score: 0, passes: false, parsedA, parsedB }
  }
 
  const score  = Number((0.70 * sLevels + 0.30 * sValues).toFixed(2))
  const passes = score > CD_PASS_THRESHOLD
 
  return { score, passes, parsedA, parsedB }
}
 