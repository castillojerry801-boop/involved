import 'server-only'
import { prisma } from '@/lib/prisma'
import { getUserEntitlement } from '@/lib/subscription/entitlements'
import { rcStoreToSource } from './reconcile'
import type { ReconcileResult } from './reconcile'
import type { RCTransferEvent, RCWebhookPayload } from './webhook-types'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function refreshProfileTier(userId: string): Promise<void> {
  try {
    const entitlement = await getUserEntitlement(userId)
    await prisma.profile.update({
      where: { id: userId },
      data:  { subscriptionTier: entitlement.tier },
    })
  } catch {
    // Non-fatal: profile may not exist (e.g., deleted account)
  }
}

async function handleTransfer(
  e: RCTransferEvent,
  reconcileFn: (userId: string) => Promise<ReconcileResult>,
): Promise<void> {
  const newUserId = e.app_user_id
  const oldUserId = e.transferred_from?.[0] ?? null

  if (!UUID_REGEX.test(newUserId)) return

  const billingSource = rcStoreToSource(e.store)
  if (!billingSource) return

  // Directly revoke the old owner's subscription for this billing source.
  // We do not reconcile the old owner via RC here because RC's REST API may
  // still reflect them as the owner during the brief TRANSFER processing window
  // (eventual consistency). The TRANSFER event is an explicit authoritative
  // instruction to revoke — we act on it immediately without waiting for RC
  // REST state to catch up.
  //
  // externalSubscriptionId filter: only revoke the specific subscription that was
  // transferred. If the old owner's row currently holds a different subscription
  // (e.g., they later purchased a new plan on the same billing source), that row
  // must not be touched — only the transferred subscription should be revoked.
  if (oldUserId && UUID_REGEX.test(oldUserId)) {
    await prisma.userSubscription.updateMany({
      where: {
        userId: oldUserId,
        billingSource,
        ...(e.original_transaction_id ? { externalSubscriptionId: e.original_transaction_id } : {}),
      },
      data: {
        status:               'canceled',
        cancelAtPeriodEnd:    false,
        lastEventTimestampMs: BigInt(Date.now()),
      },
    })
    await refreshProfileTier(oldUserId)
  }

  // Reconcile the new owner from the RC REST API.
  // RC will show them as the current owner; reconcile sets the subscription row
  // and refreshes their Profile.subscriptionTier.
  const result = await reconcileFn(newUserId)
  if (result.status === 'rc_error' && result.retriable) {
    throw new Error('rc_api_unavailable')
  }
}

/**
 * Process a RevenueCat webhook event using authoritative RC state reconciliation.
 *
 * RC's recommended pattern (from their webhook documentation):
 *   "We recommend calling the GET /subscribers REST API endpoint after receiving
 *   any webhook. That way, the customer's information is always in the same
 *   format and is easily synced to your database."
 *
 * This eliminates the following classes of bugs that exist when processing
 * webhook event fields directly:
 *
 *   1. App Store early-renewal timing: Apple charges up to 24 hours before the
 *      billing period starts, so purchased_at_ms (period start) can be later
 *      than event_timestamp_ms (when payment was collected). Any timestamp-based
 *      ordering floor using purchase_date would incorrectly block this event.
 *
 *   2. Multi-product cross-contamination: a RENEWAL for transaction txn_A arriving
 *      while the row holds txn_B would overwrite the row with wrong state if
 *      processing relied on event fields directly (the additive path had no
 *      isWrongSubscription guard). With reconcile, bestBySource always picks the
 *      most authoritative subscription from RC's current view.
 *
 *   3. Late webhook delivery ordering: RC retries webhooks for up to 24 hours.
 *      A CANCELLATION delivered hours after an UNCANCELLATION would have
 *      overwritten the user's restored access with the old event fields.
 *      With reconcile, the RC REST API reflects current state regardless of
 *      which event was delivered first.
 *
 * The reconcileFn is injected by the caller to decouple RC API access from
 * business logic, keeping this function unit-testable without HTTP mocking.
 *
 * Throws on retriable errors. Returns normally on success (including no-ops).
 * Throws with 'skipped:' prefix for non-retriable skip conditions.
 */
export async function processWebhookEvent(
  payload: RCWebhookPayload,
  reconcileFn: (userId: string) => Promise<ReconcileResult>,
): Promise<void> {
  const e = payload.event
  const userId = e.app_user_id

  // TRANSFER validates its own user IDs inside handleTransfer.
  // All other event types require a valid Supabase UUID as app_user_id.
  if (e.type !== 'TRANSFER') {
    if (!userId || userId.startsWith('$RCAnonymousID:')) {
      throw new Error('anonymous_user_rejected')
    }
    if (!UUID_REGEX.test(userId)) {
      throw new Error('invalid_user_id_format')
    }
  }

  // Sandbox guard — SANDBOX events must not affect production entitlements
  if (
    e.environment === 'SANDBOX' &&
    process.env.NODE_ENV === 'production' &&
    process.env.REVENUECAT_ACCEPT_SANDBOX !== 'true'
  ) {
    return
  }

  const billingSource = rcStoreToSource(e.store)

  switch (e.type) {
    case 'TRANSFER': {
      await handleTransfer(e as RCTransferEvent, reconcileFn)
      return
    }

    // ── Intentional no-ops ───────────────────────────────────────────────
    // These event types carry no subscription state change that requires
    // reconciliation. We acknowledge them (200) without updating any rows.
    case 'TEST':
    case 'NON_SUBSCRIPTION_PURCHASE':
    case 'SUBSCRIBER_ALIAS':
    case 'INVOICE_ISSUANCE': {
      return
    }

    // ── Subscription state events ────────────────────────────────────────
    // All remaining types — INITIAL_PURCHASE, RENEWAL, CANCELLATION,
    // EXPIRATION, BILLING_ISSUE, UNCANCELLATION, SUBSCRIPTION_PAUSED,
    // SUBSCRIPTION_EXTENDED, REFUND_REVERSED, PRODUCT_CHANGE — trigger
    // a full RC REST API reconciliation.
    //
    // PRODUCT_CHANGE is included because RC "may or may not" fire separate
    // EXPIRATION + INITIAL_PURCHASE events, so proactive reconciliation
    // ensures current state is always applied.
    default: {
      if (!billingSource) throw new Error(`skipped:unsupported_store:${e.store}`)

      const result = await reconcileFn(userId)

      if (result.status === 'rc_error') {
        // retriable=true (RC 5xx / network): throw so the route returns 500,
        // triggering RC's retry mechanism.
        if (result.retriable) throw new Error('rc_api_unavailable')
        // retriable=false (RC client error, misconfiguration): skip to avoid
        // infinite retry loops.
        throw new Error('skipped:rc_client_error')
      }

      if (result.status === 'no_rc_record') {
        // For additive events (purchase/restore): RC must have a subscriber record
        // when it sends us these webhooks. A 404 response signals RC eventual-
        // consistency lag — the event was generated before the subscriber record
        // became visible via the REST API. Throw as retriable so RC retries; the
        // subscriber record will exist on the next attempt and the user gets their
        // entitlement confirmed.
        const isAdditive = (
          e.type === 'INITIAL_PURCHASE' ||
          e.type === 'RENEWAL'          ||
          e.type === 'REFUND_REVERSED'  ||
          e.type === 'UNCANCELLATION'
        )
        if (isAdditive) throw new Error('rc_api_unavailable')

        // For destructive events (expire/cancel/pause/change): a 404 means the
        // subscriber record is gone. The subscription is effectively lost —
        // skip gracefully. There is nothing to reconcile.
        return
      }

      return
    }
  }
}
