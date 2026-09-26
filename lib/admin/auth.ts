import 'server-only'

/**
 * Returns true if userId is in the ADMIN_USER_IDS env var.
 * Consistent with the TRAINER_USER_IDS / PLUS_USER_IDS pattern in entitlements.ts.
 */
export function isAdmin(userId: string): boolean {
  const ids = (process.env.ADMIN_USER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean)
  return ids.includes(userId)
}
