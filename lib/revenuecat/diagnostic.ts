// DIAGNOSTIC — delete this file after the RC purchase blocker is identified.
// Usage: imported by app/(app)/plus/page.tsx diagnostic effect only.
import type { PurchasesOffering, PurchasesPackage } from '@revenuecat/purchases-capacitor'

export interface RcDiagnosticDeps {
  getUser: () => Promise<{ id: string; email?: string | null } | null>
  initialize: (userId: string) => Promise<void>
  getOfferings: () => Promise<{ current: PurchasesOffering | null }>
  testEmail: string
}

/**
 * Runs a step-by-step RC diagnostic and returns a short status string.
 * Returns null for users who are not the designated test account.
 * Never surfaces API keys, tokens, or personal identifiers.
 *
 * DIAGNOSTIC — remove this function (and the file) after the issue is identified.
 */
export async function runRcDiagnostic(deps: RcDiagnosticDeps): Promise<string | null> {
  const { getUser, initialize, getOfferings, testEmail } = deps

  const user = await getUser()
  if (!user) {
    // Stop chain — don't call getOfferings on an unconfigured SDK.
    return 'no-user: RC init skipped'
  }
  if (user.email !== testEmail) {
    return null // not the test account — show nothing
  }

  try {
    await initialize(user.id)
  } catch (err) {
    return `init-failed: ${err instanceof Error ? err.message : String(err)}`
  }

  let result: { current: PurchasesOffering | null }
  try {
    result = await getOfferings()
  } catch (err) {
    return `get-offerings-threw: ${err instanceof Error ? err.message : String(err)}`
  }

  if (!result.current) {
    return 'null-current: getOfferings() returned null — Apple products may not exist in App Store Connect'
  }

  const pkgs: PurchasesPackage[] = result.current.availablePackages
  if (pkgs.length === 0) {
    return `zero-pkgs: offering "${result.current.identifier}" has 0 packages — StoreKit products not found in ASC`
  }

  const summary = pkgs
    .map(p => `${p.packageType}:${p.product.identifier}`)
    .join(' | ')
  return `ok: ${pkgs.length} pkg(s) — ${summary}`
}
