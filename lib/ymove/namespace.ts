import 'server-only'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const YMV_PREFIX = 'ymv:'

/**
 * Parse a ymv:-namespaced ID and return the bare YMove UUID.
 * Returns null when the prefix is absent or the UUID format is invalid.
 */
export function parseYmvId(id: string): string | null {
  if (!id.startsWith(YMV_PREFIX)) return null
  const uuid = id.slice(YMV_PREFIX.length)
  return UUID_RE.test(uuid) ? uuid : null
}

/** Wrap a bare YMove UUID in the ymv: namespace. */
export function formatYmvId(ymoveId: string): string {
  return `${YMV_PREFIX}${ymoveId}`
}

/** Returns true when the string is a valid ymv:-namespaced exercise ID. */
export function isYmvId(id: string): boolean {
  return parseYmvId(id) !== null
}
