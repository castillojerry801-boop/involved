import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'

function isFiniteInRange(val: unknown, min: number, max: number): boolean {
  return typeof val === 'number' && Number.isFinite(val) && val >= min && val <= max
}

// Used for control flow inside the serializable transaction — not a user-facing error.
class StaleTargetError extends Error {
  constructor() { super('stale_target') }
}

export async function GET(_req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const target = await prisma.nutritionTarget.findFirst({
    where: { userId: user.id },
    orderBy: { effectiveDate: 'desc' },
  })

  return NextResponse.json({ target: target ?? null })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 422 })
  }

  const b = body as Record<string, unknown>

  if (!isFiniteInRange(b.calories, 1, 15000))
    return NextResponse.json({ error: 'calories must be a number between 1 and 15000' }, { status: 422 })
  if (!isFiniteInRange(b.proteinG, 0, 2000))
    return NextResponse.json({ error: 'proteinG must be a number between 0 and 2000' }, { status: 422 })
  if (!isFiniteInRange(b.carbohydrateG, 0, 2000))
    return NextResponse.json({ error: 'carbohydrateG must be a number between 0 and 2000' }, { status: 422 })
  if (!isFiniteInRange(b.fatG, 0, 2000))
    return NextResponse.json({ error: 'fatG must be a number between 0 and 2000' }, { status: 422 })
  if (b.fiberG != null && !isFiniteInRange(b.fiberG, 0, 500))
    return NextResponse.json({ error: 'fiberG must be a number between 0 and 500' }, { status: 422 })
  if (b.sugarG != null && !isFiniteInRange(b.sugarG, 0, 2000))
    return NextResponse.json({ error: 'sugarG must be a number between 0 and 2000' }, { status: 422 })
  if (b.sodiumMg != null && !isFiniteInRange(b.sodiumMg, 0, 50000))
    return NextResponse.json({ error: 'sodiumMg must be a number between 0 and 50000' }, { status: 422 })

  // Determine whether a stale check is requested:
  //   - key absent         → GoalsEditor / no check (backwards compat)
  //   - key = string       → existing user: expect current record to have this ID
  //   - key = null         → first-time user: expect no record to exist yet
  //   - key = other type   → ignore (defensive)
  const hasStaleCheck = 'existingTargetId' in b &&
    (typeof b.existingTargetId === 'string' || b.existingTargetId === null)
  const expectedId = hasStaleCheck ? (b.existingTargetId as string | null) : undefined

  try {
    // SERIALIZABLE isolation makes the findFirst + create atomic: PostgreSQL will
    // detect if a concurrent write changes the result of our findFirst and abort
    // this transaction, causing Prisma to surface an error we catch below.
    const target = await prisma.$transaction(async (tx) => {
      if (hasStaleCheck) {
        const current = await tx.nutritionTarget.findFirst({
          where: { userId: user.id },
          orderBy: { effectiveDate: 'desc' },
          select: { id: true },
        })
        if ((current?.id ?? null) !== expectedId) {
          throw new StaleTargetError()
        }
      }

      return tx.nutritionTarget.create({
        data: {
          userId: user.id,
          effectiveDate: new Date(),
          calories: b.calories as number,
          proteinG: b.proteinG as number,
          carbohydrateG: b.carbohydrateG as number,
          fatG: b.fatG as number,
          fiberG: (b.fiberG as number | undefined) ?? null,
          sugarG: (b.sugarG as number | undefined) ?? null,
          sodiumMg: (b.sodiumMg as number | undefined) ?? null,
        },
      })
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

    return NextResponse.json({ target }, { status: 201 })
  } catch (e) {
    if (e instanceof StaleTargetError) {
      return NextResponse.json(
        { error: 'Your nutrition goals were updated after you opened this dialog. Close and try again.' },
        { status: 409 },
      )
    }
    // A Prisma serialization failure (P2034) means a concurrent write was detected.
    // Surface it as 409 so the client can prompt the user to retry.
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === 'P2034'
    ) {
      return NextResponse.json(
        { error: 'A concurrent update was detected. Close and try again.' },
        { status: 409 },
      )
    }
    throw e
  }
}
