// Unicode fraction map: character → [numerator, denominator]
const UNICODE_FRACTIONS: Record<string, [number, number]> = {
  '½': [1, 2],
  '⅓': [1, 3],
  '⅔': [2, 3],
  '¼': [1, 4],
  '¾': [3, 4],
  '⅕': [1, 5],
  '⅖': [2, 5],
  '⅗': [3, 5],
  '⅘': [4, 5],
  '⅙': [1, 6],
  '⅚': [5, 6],
  '⅛': [1, 8],
  '⅜': [3, 8],
  '⅝': [5, 8],
  '⅞': [7, 8],
}

// Reverse map: decimal value → display string (for formatQuantity)
// Built from UNICODE_FRACTIONS so no duplication.
const FRACTION_DISPLAY: Array<{ value: number; display: string }> = Object.entries(
  UNICODE_FRACTIONS,
).map(([char, [n, d]]) => ({ value: n / d, display: char }))

// Parses a quantity string to a positive number, or null if invalid.
// Supports:
//   Integers:      "2" → 2
//   Decimals:      "1.5" → 1.5
//   Fractions:     "1/2" → 0.5, "3/4" → 0.75
//   Mixed numbers: "1 1/2" → 1.5, "2 3/4" → 2.75
//   Unicode fracs: "½" → 0.5, "¼" → 0.25, "¾" → 0.75, "⅓" → 0.333, "⅔" → 0.667
//                  "1½" → 1.5, "2⅓" → 2.333
//   Handles leading/trailing whitespace.
//   Returns null for empty, negative, zero, or unparseable input.
export function parseQuantity(input: string): number | null {
  const s = input.trim()
  if (!s) return null

  // Build a regex that matches any unicode fraction character
  const unicodePattern = Object.keys(UNICODE_FRACTIONS).join('')

  // Try: whole number + unicode fraction (e.g. "1½", "2⅓")
  const mixedUnicodeRe = new RegExp(`^(\\d+)([${unicodePattern}])$`)
  const mixedUnicodeMatch = s.match(mixedUnicodeRe)
  if (mixedUnicodeMatch) {
    const whole = parseInt(mixedUnicodeMatch[1], 10)
    const frac = UNICODE_FRACTIONS[mixedUnicodeMatch[2]]
    if (frac) {
      const value = whole + frac[0] / frac[1]
      return value > 0 ? value : null
    }
  }

  // Try: standalone unicode fraction (e.g. "½", "¾")
  if (s.length === 1 && UNICODE_FRACTIONS[s]) {
    const [n, d] = UNICODE_FRACTIONS[s]
    const value = n / d
    return value > 0 ? value : null
  }

  // Try: mixed number with slash fraction (e.g. "1 1/2", "2 3/4")
  const mixedSlashRe = /^(\d+)\s+(\d+)\/(\d+)$/
  const mixedSlashMatch = s.match(mixedSlashRe)
  if (mixedSlashMatch) {
    const whole = parseInt(mixedSlashMatch[1], 10)
    const num = parseInt(mixedSlashMatch[2], 10)
    const den = parseInt(mixedSlashMatch[3], 10)
    if (den === 0) return null
    const value = whole + num / den
    return value > 0 ? value : null
  }

  // Try: plain fraction (e.g. "1/2", "3/4")
  const fractionRe = /^(\d+)\/(\d+)$/
  const fractionMatch = s.match(fractionRe)
  if (fractionMatch) {
    const num = parseInt(fractionMatch[1], 10)
    const den = parseInt(fractionMatch[2], 10)
    if (den === 0) return null
    const value = num / den
    return value > 0 ? value : null
  }

  // Try: numeric (integer or decimal)
  const numeric = parseFloat(s)
  if (!Number.isFinite(numeric) || numeric <= 0) return null
  // Reject inputs with non-numeric trailing characters beyond a valid number
  // e.g. "1.5abc" should fail
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null
  return numeric
}

// Formats a number as a concise display string.
// e.g. 0.5 → "½", 0.25 → "¼", 1.5 → "1½", 2.333... → "2⅓"
// Falls back to decimal for numbers with no clean fraction equivalent.
// Used for display; never used in calculations.
export function formatQuantity(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return String(value)

  const whole = Math.floor(value)
  const frac = value - whole

  if (frac < 1e-9) {
    // Whole number
    return String(whole)
  }

  // Find a matching unicode fraction within floating point tolerance
  const TOLERANCE = 0.001
  for (const { value: fracValue, display } of FRACTION_DISPLAY) {
    if (Math.abs(frac - fracValue) < TOLERANCE) {
      return whole > 0 ? `${whole}${display}` : display
    }
  }

  // No clean fraction — fall back to decimal with trailing zero removal
  const fixed = value.toFixed(2)
  return fixed.replace(/\.?0+$/, '')
}
