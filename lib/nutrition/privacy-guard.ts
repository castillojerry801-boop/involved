// Heuristic detection of obviously sensitive or personally identifying content
// that should not be forwarded to external food databases.
//
// Patterns cover the most realistic accidental-paste scenarios (email, formatted
// phone, SSN, credit card, structured medical record labels).  Space-only phone
// separators are intentionally excluded to prevent false positives on nutritional
// amount sequences such as "500 mg 25 mcg 1000 IU".
//
// Detection is best-effort; coverage of every possible sensitive phrase is not
// guaranteed by design.

const SENSITIVE_PATTERNS: RegExp[] = [
  // Email address — @ with domain
  /[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/i,

  // US phone with parentheses: (555) 555-5555
  /\(\d{3}\)\s*\d{3}[\s.\-]\d{4}/,

  // US phone with dot or dash separators only: 555-555-5555, 555.555.5555
  /\b\d{3}[.\-]\d{3}[.\-]\d{4}\b/,

  // International phone starting with +: +1-555-555-5555, +44 20 7946 0958
  /\+\d{1,3}[\s\-\.]\d{2,4}[\s\-\.]\d{3,4}[\s\-\.]\d{3,4}/,

  // Social Security Number with dashes only: 123-45-6789
  // (space separators excluded — see module comment above)
  /\b\d{3}-\d{2}-\d{4}\b/,

  // Credit card with spaces or dashes: 4111 1111 1111 1111 / 4111-1111-1111-1111
  /\b\d{4}[\s\-]\d{4}[\s\-]\d{4}[\s\-]\d{4}\b/,

  // Structured medical record labels: "Patient ID: 123", "MRN: 456", "DOB: ..."
  /\b(patient\s*id|medical\s+record\s*#?|mrn|date\s+of\s+birth|dob)\s*[:=#]/i,
]

export const PRIVACY_REJECTION_MESSAGE =
  'Please search using only a food or product name.'

/** Returns true if the query contains patterns associated with personal identifiers. */
export function isSensitiveQuery(query: string): boolean {
  return SENSITIVE_PATTERNS.some(p => p.test(query))
}
