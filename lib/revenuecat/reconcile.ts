import 'server-only'
import { prisma } from '@/lib/prisma'
import { getUserEntitlement } from '@/lib/subscription/entitlements'
import type { Entitlement } from '@/lib/subscription/entitlements'
import type { BillingSource } from '@prisma/client'

// ─── RC Subscriber REST API shapes ───────────────────────────────────────────
// Source: https://www.revenuecat.com/docs/api-v1#tag/Customers/operation/subscribers

export interface RCSubscriberSubscription {
  expires_date: string | null
  purchase_date: string | null
  original_purchase_date: string | null
  store: string
  unsubscribe_detected_at: string | null
  billing_issues_detected_at: string | null
  // Present for Android paused subscriptions when the subscription is paused.
  // Not documented in the public REST API spec; treated as optional.
  auto_resume_date?: string | null
  is_sandbox: boolean
  original_transaction_id?: string | null
  product_identifier?: string | null
}

export interface RCSubscriberResponse {
  subscriber: {
    subscriptions: Record<string, RCSubscriberSubscription>
  }
}

// ─── Public types ─────────────────────────────────────────────────────────────

export interface ReconcileResult {
  status: 'ok' | 'no_rc_record' | 'rc_error'
  entitlement?: Entitlement
  retriable?: boolean
}

export interface ReconcileOptions {
  userId: string
  rcSecretKey: string
  isProduction: boolean
  acceptSandbox: boolean
  acceptTestStore?: boolean
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Map an RC store name to our internal BillingSource enum.
 * Returns null for unsupported stores (AMAZON, PROMOTIONAL, etc.).
 * Exported so the webhook handler can use the same mapping.
 */
export function rcStoreToSource(store: string): BillingSource | null {
  switch (store.toUpperCase()) {
    case 'APP_STORE':
    case 'MAC_APP_STORE':
      return 'apple'
    case 'PLAY_STORE':
      return 'google'
    case 'STRIPE':
      return 'stripe'
    case 'TEST':
      // RC sandbox simulator. Mapped to its own billing source so test purchases
      // never collide with real Apple/Google rows on the same user.
      return 'rc_test'
    default:
      return null
  }
}

export interface SubscriptionEntry {
  sub: RCSubscriberSubscription
  productId: string
  isActive: boolean
  expiresAt: Date | null
}

/**
 * Select the most authoritative subscription per billing source from an RC
 * subscriber API response.
 *
 * Selection priority (per billing source):
 *   1. Active over expired — an active subscription always wins.
 *   2. Among same status, the one with the later expires_date wins.
 *
 * This prevents an expired monthly subscription from overwriting an active
 * annual subscription, regardless of which webhook arrived first or last.
 * Exported for unit testing.
 */
export function selectBestBySource(
  subscriptions: Record<string, RCSubscriberSubscription>,
  opts: { isProduction: boolean; acceptSandbox: boolean; acceptTestStore?: boolean },
): Map<BillingSource, SubscriptionEntry> {
  const now = new Date()
  const best = new Map<BillingSource, SubscriptionEntry>()

  for (const [productId, sub] of Object.entries(subscriptions)) {
    const billingSource = rcStoreToSource(sub.store)
    if (!billingSource) continue
    if (sub.is_sandbox && opts.isProduction && !opts.acceptSandbox) continue
    // TEST store requires an explicit opt-in separate from acceptSandbox.
    // This prevents REVENUECAT_ACCEPT_SANDBOX=true from accidentally granting
    // rc_test entitlements in production.
    if (billingSource === 'rc_test' && !opts.acceptTestStore) continue

    const expiresAt = sub.expires_date ? new Date(sub.expires_date) : null
    const isActive = expiresAt ? expiresAt > now : false

    const existing = best.get(billingSource)
    if (!existing) {
      best.set(billingSource, { sub, productId, isActive, expiresAt })
      continue
    }

    if (isActive && !existing.isActive) {
      best.set(billingSource, { sub, productId, isActive, expiresAt })
      continue
    }

    if (
      isActive === existing.isActive &&
      expiresAt && existing.expiresAt &&
      expiresAt > existing.expiresAt
    ) {
      best.set(billingSource, { sub, productId, isActive, expiresAt })
    }
  }

  return best
}

// ─── Core reconciliation function ────────────────────────────────────────────

/**
 * Fetch the customer's current subscription state from the RC REST API and
 * reconcile local UserSubscription rows.
 *
 * This is RC's recommended approach for authoritative state management.
 * Rather than relying on webhook event fields (which carry ordering, timing,
 * and multi-product risks), we always retrieve current RC state after any
 * subscription event and use it as the single source of truth.
 *
 * Key properties:
 *   - App Store early renewals are handled correctly: purchased_at_ms can
 *     precede event_timestamp_ms on App Store; because we read current state
 *     from RC rather than comparing timestamps, this never causes a block.
 *   - Multi-product safety: selectBestBySource ensures the most privileged
 *     (active, then latest-expiry) subscription wins per billing source.
 *   - Manual/promotional rows are never touched (not present in RC REST API).
 *   - Rows for billing sources absent from the RC response are left unchanged
 *     (conservative: only update what RC explicitly reports).
 *   - If RC returns 5xx or a network error, we report rc_error/retriable=true
 *     so the caller can return 500 for RC to retry.
 *   - If RC returns 404 (no subscriber record), we report no_rc_record.
 *     Callers should skip gracefully — there is nothing to reconcile.
 *
 * lastEventTimestampMs is set to the reconciliation wall-clock time (not any
 * RC timestamp). Its purpose is now "last reconciled at" metadata for
 * debugging and cache-invalidation use, not event ordering.
 */
export async function reconcileSubscriberFromRC(
  opts: ReconcileOptions,
): Promise<ReconcileResult> {
  const { userId, rcSecretKey, isProduction, acceptSandbox, acceptTestStore } = opts

  // fetchedAt is captured BEFORE the RC request. It serves two purposes:
  //   1. "last reconciled at" metadata stored on each subscription row.
  //   2. CAS ordering guard: a reconcile that started LATER has a higher
  //      fetchedAt. The updateMany WHERE clause (`lastEventTimestampMs < fetchedAt`)
  //      prevents an older in-flight reconcile (lower fetchedAt, possibly carrying
  //      stale RC state) from overwriting a row already confirmed by a newer one.
  const fetchedAt = BigInt(Date.now())

  // ── Fetch from RC REST API ───────────────────────────────────────────────
  let rcData: RCSubscriberResponse
  try {
    const res = await fetch(
      `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`,
      {
        headers: {
          Authorization: `Bearer ${rcSecretKey}`,
          'Content-Type': 'application/json',
        },
        // Always fetch fresh — no CDN or Next.js caching
        cache: 'no-store',
      },
    )

    if (res.status === 404) {
      return { status: 'no_rc_record' }
    }

    if (!res.ok) {
      console.error('[reconcile] RC API error', res.status, userId.slice(0, 8))
      return { status: 'rc_error', retriable: true }
    }

    rcData = (await res.json()) as RCSubscriberResponse
  } catch (err) {
    console.error('[reconcile] RC fetch failed', err)
    return { status: 'rc_error', retriable: true }
  }

  // ── Select best subscription per billing source ──────────────────────────
  const subscriptions = rcData.subscriber?.subscriptions ?? {}
  const best = selectBestBySource(subscriptions, { isProduction, acceptSandbox, acceptTestStore })

  // ── Write subscription rows with CAS ordering guard ──────────────────────
  for (const [billingSource, { sub, productId, isActive, expiresAt }] of best.entries()) {
    const purchasedAt = sub.purchase_date ? new Date(sub.purchase_date) : null
    const isCanceling = !!sub.unsubscribe_detected_at && isActive
    const isBillingIssue = !!sub.billing_issues_detected_at && isActive
    const isPaused = !!sub.auto_resume_date && !isActive

    const status: 'active' | 'expired' | 'paused' = isPaused
      ? 'paused'
      : isActive
        ? 'active'
        : 'expired'

    const rowData = {
      tier:                   isActive || isPaused ? ('plus' as const) : ('free' as const),
      status,
      externalSubscriptionId: sub.original_transaction_id ?? null,
      externalPriceId:        productId,
      currentPeriodStart:     purchasedAt,
      currentPeriodEnd:       expiresAt,
      cancelAtPeriodEnd:      isCanceling,
      billingIssueDetectedAt: isBillingIssue ? new Date(sub.billing_issues_detected_at!) : null,
      lastEventTimestampMs:   fetchedAt,
    }

    // Attempt CAS-guarded update: only proceeds if no row exists OR the existing
    // row's lastEventTimestampMs is older than our fetchedAt. A concurrent reconcile
    // that started after us will have a higher fetchedAt and will correctly win.
    const { count } = await prisma.userSubscription.updateMany({
      where: {
        userId,
        billingSource,
        OR: [
          { lastEventTimestampMs: null },
          { lastEventTimestampMs: { lt: fetchedAt } },
        ],
      },
      data: rowData,
    })

    if (count > 0) continue  // Updated an existing row — done ✓

    // count=0: either no row exists, or the existing row already has a newer
    // lastEventTimestampMs (a more recent concurrent reconcile beat us).
    // Determine which case we are in.
    const existing = await prisma.userSubscription.findFirst({
      where:  { userId, billingSource },
      select: { id: true },
    })

    if (existing) continue  // Row exists with a newer timestamp — ours is stale, skip ✓

    // Row does not exist — create it.
    try {
      await prisma.userSubscription.create({
        data: { userId, billingSource, ...rowData },
      })
    } catch (createErr) {
      // P2002: a concurrent reconcile created the row between our findFirst and
      // create calls. That process had the same (or newer) RC-authoritative state.
      if (!isPrismaUniqueViolation(createErr)) throw createErr
    }
  }

  // ── Recalculate entitlement ──────────────────────────────────────────────
  const entitlement = await getUserEntitlement(userId)

  await prisma.profile.update({
    where: { id: userId },
    data:  { subscriptionTier: entitlement.tier },
  }).catch(() => null)

  return { status: 'ok', entitlement }
}

function isPrismaUniqueViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  return (err as Record<string, unknown>)['code'] === 'P2002'
}
