import 'server-only'
import { prisma } from '@/lib/prisma'

// ─── Types ────────────────────────────────────────────────────────────────────

export type ResolveRefResult =
  | { ok: true;  token: string }
  | { ok: false; reason: 'not_found' | 'expired' | 'db_error' }

// ─── Store ────────────────────────────────────────────────────────────────────
// Write a new ref row and return its opaque UUID. The full signed token is
// stored server-side; V only ever receives the UUID.
// After writing, lazily delete expired rows for the same user so the table
// does not accumulate unbounded stale entries (fire-and-forget, never throws).

export async function storeMealCalculationRef(
  userId:    string,
  token:     string,
  expiresAt: Date,
): Promise<string> {
  const ref = await prisma.mealCalculationRef.create({
    data: { userId, token, expiresAt },
    select: { id: true },
  })
  prisma.mealCalculationRef
    .deleteMany({ where: { userId, expiresAt: { lt: new Date() } } })
    .catch(() => {})
  return ref.id
}

// ─── Resolve ──────────────────────────────────────────────────────────────────
// Look up a ref by its opaque UUID, verifying authenticated ownership and expiry.
// Cross-user access returns 'not_found' (same as a missing row) to prevent
// leaking whether a given UUID exists.
// Any database failure returns 'db_error' without surfacing the exception.

export async function resolveMealCalculationRef(
  refId:  string,
  userId: string,
): Promise<ResolveRefResult> {
  try {
    const ref = await prisma.mealCalculationRef.findUnique({
      where:  { id: refId },
      select: { userId: true, token: true, expiresAt: true },
    })
    if (!ref || ref.userId !== userId) return { ok: false, reason: 'not_found' }
    if (ref.expiresAt < new Date())    return { ok: false, reason: 'expired' }
    return { ok: true, token: ref.token }
  } catch {
    return { ok: false, reason: 'db_error' }
  }
}
