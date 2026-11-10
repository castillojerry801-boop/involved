import 'server-only'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyRevenueCatSignature } from '@/lib/revenuecat/webhook-auth'
import { processWebhookEvent } from '@/lib/revenuecat/webhook'
import { reconcileSubscriberFromRC } from '@/lib/revenuecat/reconcile'
import type { RCWebhookPayload } from '@/lib/revenuecat/webhook-types'

// Stale-processing threshold: reclaim rows stuck in 'processing' for > 5 minutes
const STALE_PROCESSING_MS = 5 * 60 * 1000

export async function POST(req: NextRequest): Promise<Response> {
  // 1. Read raw body for signature verification
  const rawBody = await req.text()

  // 2. Verify signature (HMAC + Authorization header when both env vars are set)
  const signatureHeader = req.headers.get('x-revenuecat-webhook-signature')
  const authHeader      = req.headers.get('authorization')

  if (!verifyRevenueCatSignature(rawBody, signatureHeader, authHeader)) {
    return Response.json({ error: 'invalid_signature' }, { status: 401 })
  }

  // 3. Parse payload
  let payload: RCWebhookPayload
  try {
    payload = JSON.parse(rawBody) as RCWebhookPayload
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }

  const event = payload.event
  if (!event?.id || !event?.type) {
    return Response.json({ error: 'missing_event_fields' }, { status: 400 })
  }

  const eventId   = event.id
  const eventType = event.type

  // 4. Idempotent dedup — attempt to claim this event for processing
  let claimed = false
  try {
    await prisma.webhookEvent.create({
      data: {
        eventId,
        eventType,
        appUserId:  event.app_user_id ?? null,
        status:     'processing',
        rawPayload: JSON.parse(rawBody) as object,
      },
    })
    claimed = true
  } catch (createErr: unknown) {
    // Unique constraint violation — event already seen
    const isUniqueViolation = isPrismaUniqueViolation(createErr)
    if (!isUniqueViolation) throw createErr

    const existing = await prisma.webhookEvent.findUnique({ where: { eventId } })
    if (!existing) {
      // Extremely rare: insert failed but row vanished — treat as OK
      return Response.json({ ok: true }, { status: 200 })
    }

    if (existing.status === 'completed' || existing.status === 'skipped') {
      return Response.json({ ok: true }, { status: 200 })
    }

    if (existing.status === 'processing') {
      const ageMs = Date.now() - existing.createdAt.getTime()
      if (ageMs < STALE_PROCESSING_MS) {
        // Another instance is actively processing — yield
        return Response.json({ ok: true }, { status: 200 })
      }
      // Stale — atomically reclaim via CAS on (eventId, status='processing')
      const { count } = await prisma.webhookEvent.updateMany({
        where: { eventId, status: 'processing' },
        data:  { updatedAt: new Date() },
      })
      if (count === 0) {
        // Race lost (another instance reclaimed first or completed)
        return Response.json({ ok: true }, { status: 200 })
      }
      claimed = true
    }

    if (existing.status === 'error') {
      // Retry: reclaim from error state
      const { count } = await prisma.webhookEvent.updateMany({
        where: { eventId, status: 'error' },
        data:  { status: 'processing', updatedAt: new Date() },
      })
      if (count === 0) return Response.json({ ok: true }, { status: 200 })
      claimed = true
    }
  }

  if (!claimed) {
    return Response.json({ ok: true }, { status: 200 })
  }

  // 5. Process the event
  try {
    // RC secret key is required for subscriber reconciliation.
    // If unconfigured, mark as error (retriable) so RC retries once configured.
    const rcSecretKey = process.env.REVENUECAT_SECRET_KEY
    if (!rcSecretKey) throw new Error('rc_not_configured')

    // Build the reconcile function for this request's environment context.
    // Injected into processWebhookEvent to decouple RC API calls from
    // business logic and keep the handler unit-testable.
    const reconcileFn = (userId: string) =>
      reconcileSubscriberFromRC({
        userId,
        rcSecretKey,
        isProduction: process.env.NODE_ENV === 'production',
        acceptSandbox: process.env.REVENUECAT_ACCEPT_SANDBOX === 'true',
      })

    await processWebhookEvent(payload, reconcileFn)

    await prisma.webhookEvent.update({
      where: { eventId },
      data:  { status: 'completed' },
    })

    return Response.json({ ok: true }, { status: 200 })
  } catch (err: unknown) {
    const note = err instanceof Error ? err.message : String(err)

    // Non-retriable conditions: mark as 'skipped' and return 200 so RC does
    // not back-off and retry indefinitely.
    //   anonymous_user_rejected  — RC anonymous ID; will never have a Supabase UUID
    //   invalid_user_id_format   — malformed app_user_id; structural, not transient
    //   skipped:*                — intentional skip (unsupported store, rc_client_error,
    //                             no_rc_record when treated as skip)
    //
    // Note: rc_api_unavailable and rc_not_configured are NOT in this list.
    // They are retriable — RC will retry and eventually succeed once the
    // transient error or misconfiguration is resolved.
    const nonRetriable =
      note === 'anonymous_user_rejected' ||
      note === 'invalid_user_id_format'  ||
      note.startsWith('skipped:')

    await prisma.webhookEvent.update({
      where: { eventId },
      data:  {
        status:      nonRetriable ? 'skipped' : 'error',
        outcomeNote: note.slice(0, 500),
      },
    }).catch(() => null)

    if (nonRetriable) {
      return Response.json({ ok: true }, { status: 200 })
    }

    // Return 500 to trigger RC retry (rc_api_unavailable, rc_not_configured, etc.)
    return Response.json({ error: 'processing_failed' }, { status: 500 })
  }
}

function isPrismaUniqueViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  const e = err as Record<string, unknown>
  return e['code'] === 'P2002'
}
