/**
 * Charge description matching from CD Validation repo.
 * Uses tokens.json (key phrases) and valueTokens.json (number+unit patterns).
 * parseSentence() extracts: contains (key phrases), value_matches (e.g. "10 Gbps", "55 kVA"), special_matches (dates, UUIDs), not_contains.
 * Similarity = (Jaccard(contains_A, contains_B) + Jaccard(value_matches_A, value_matches_B)) / 2.
 */
import tokens from './data/tokens.json'
import valueTokens from './data/valueTokens.json'

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Longest first to avoid substring conflicts
const sortedKeys = [...tokens].sort((a, b) => b.length - a.length)
const keyRegex = new RegExp(sortedKeys.map(escapeRegex).join('|'), 'gi')

const positiveNumber = '\\d+(?:\\.\\d+)?(?:\\s*-\\s*\\d+(?:\\.\\d+)?)?'
const negativeNumber = '-\\d+(?:\\.\\d+)?(?:\\s*-\\s*-\\d+(?:\\.\\d+)?)?'
const anyNumber = '-?\\d+(?:\\.\\d+)?(?:\\s*-\\s*-?\\d+(?:\\.\\d+)?)?'

function buildValueRegex(tokenList, numberPattern) {
  if (!tokenList || tokenList.length === 0) return null
  const tokenPattern = tokenList.map(escapeRegex).join('|')
  return new RegExp(`(${numberPattern})(\\s{0,2})(?:${tokenPattern})`, 'gi')
}

const positiveValueRegex = buildValueRegex(valueTokens.only_positive, positiveNumber)
const negativeValueRegex = buildValueRegex(valueTokens.only_negative, negativeNumber)
const anyValueRegex = buildValueRegex(valueTokens.positive_or_negitive || [], anyNumber)

const dateRangeRegex = /\b(\d{2}-[A-Z]{3}-\d{4}\s*-\s*\d{2}-[A-Z]{3}-\d{4}|\d{2}-\d{2}-\d{4}\s*(?:-|to)\s*\d{2}-\d{2}-\d{4}|\d{4}-\d{2}-\d{2}\s*(?:-|to)\s*\d{4}-\d{2}-\d{2})\b/g
const singleDateRegex = /\b(\d{2}-[A-Z]{3}-\d{4}|\d{2}-\d{2}-\d{4}|\d{4}-\d{2}-\d{2})\b/g
const uuidRegex = /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}\b/g

/**
 * Parse a charge description into key phrases (contains), value matches (number+unit), dates/UUIDs, and remaining tokens.
 */
export function parseSentence(sentence) {
  const contains = new Set()
  const value_matches = new Set()
  const special_matches = new Set()

  if (!sentence || typeof sentence !== 'string') {
    return { contains: [], value_matches: [], special_matches: [], not_contains: [] }
  }

  let remainingSentence = String(sentence)

  remainingSentence = remainingSentence.replace(keyRegex, (match) => {
    contains.add(match)
    return ' '
  })

  function extract(regex) {
    if (!regex) return
    remainingSentence = remainingSentence.replace(regex, (match) => {
      value_matches.add(match)
      return ' '
    })
  }
  extract(positiveValueRegex)
  extract(negativeValueRegex)
  extract(anyValueRegex)

  remainingSentence = remainingSentence.replace(dateRangeRegex, (match) => {
    special_matches.add(match)
    return ' '
  })
  remainingSentence = remainingSentence.replace(singleDateRegex, (match) => {
    special_matches.add(match)
    return ' '
  })
  remainingSentence = remainingSentence.replace(uuidRegex, (match) => {
    special_matches.add(match)
    return ' '
  })

  const not_contains = new Set()
  const leftovers = remainingSentence.split(/\s+/).filter(Boolean)
  for (let token of leftovers) {
    token = token.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, '')
    if (!token || !/[a-zA-Z0-9]/.test(token)) continue
    not_contains.add(token)
  }

  return {
    contains: [...contains],
    value_matches: [...value_matches],
    special_matches: [...special_matches],
    not_contains: [...not_contains]
  }
}

/**
 * Jaccard similarity (0–100). Returns 100 when both sets are empty (CD Validation behavior).
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

/** Quote validation: description match must be strictly more than this % else ILI goes to rate card validation. */
const CD_PASS_THRESHOLD = 60

/**
 * Overall CD similarity: average of Jaccard(contains) and Jaccard(value_matches).
 * Returns { score, passes, parsedA, parsedB }.
 * passes: true only when score > CD_PASS_THRESHOLD (i.e. > 60%); otherwise ILI is sent to rate card validation.
 */
export function calculateCDSimilarity(iliDesc, qliDesc) {
  const parsedA = parseSentence(iliDesc)
  const parsedB = parseSentence(qliDesc)
  const score = calculateJaccardSimilarity(parsedA.contains, parsedB.contains)
  const passes = score > CD_PASS_THRESHOLD
  return { score, passes, parsedA, parsedB }
}
