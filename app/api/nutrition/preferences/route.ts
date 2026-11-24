import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'
import {
  detectDietaryConflicts,
  isValidDietaryApproach,
  isValidAllergenSeverity,
  type DietaryApproach,
} from '@/lib/nutrition/dietary-conflicts'

// ─── Serializer ───────────────────────────────────────────────────────────────

function serializePreference(
  pref: Awaited<ReturnType<typeof fetchPreference>>,
) {
  if (!pref) return null
  return {
    id: pref.id,
    approaches: pref.approaches,
    mealsPerDay: pref.mealsPerDay,
    snacksPerDay: pref.snacksPerDay,
    notes: pref.notes,
    allergens: pref.allergens.map(a => ({
      id: a.id,
      name: a.name,
      severity: a.severity,
      notes: a.notes,
    })),
    exclusions: pref.exclusions.map(e => ({
      id: e.id,
      ingredient: e.ingredient,
      reason: e.reason,
    })),
    createdAt: pref.createdAt,
    updatedAt: pref.updatedAt,
  }
}

async function fetchPreference(userId: string) {
  return prisma.dietaryPreference.findUnique({
    where: { userId },
    include: { allergens: true, exclusions: true },
  })
}

// ─── GET /api/nutrition/preferences ──────────────────────────────────────────

export async function GET(_req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const pref = await fetchPreference(user.id)
  return NextResponse.json({ preference: serializePreference(pref) })
}

// ─── PATCH /api/nutrition/preferences ────────────────────────────────────────
//
// Accepts a partial update. Any field omitted is left unchanged.
// Allergens and exclusions are REPLACED in full when provided — the caller
// must include the complete desired state, not just the delta.
//
// Body shape:
// {
//   approaches?: DietaryApproach[]
//   mealsPerDay?: number | null
//   snacksPerDay?: number | null
//   notes?: string | null
//   allergens?: Array<{ name: string; severity: AllergenSeverity; notes?: string | null }>
//   exclusions?: Array<{ ingredient: string; reason?: string | null }>
// }

export async function PATCH(req: NextRequest) {
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
    return NextResponse.json({ error: 'Request body must be an object' }, { status: 400 })
  }

  const input = body as Record<string, unknown>

  // ── Validate approaches ───────────────────────────────────────────────────
  if ('approaches' in input) {
    if (!Array.isArray(input.approaches)) {
      return NextResponse.json({ error: '"approaches" must be an array' }, { status: 400 })
    }
    const invalid = (input.approaches as unknown[]).filter(a => !isValidDietaryApproach(a))
    if (invalid.length > 0) {
      return NextResponse.json(
        { error: `Invalid dietary approaches: ${invalid.join(', ')}` },
        { status: 400 },
      )
    }
    const conflicts = detectDietaryConflicts(input.approaches as DietaryApproach[])
    if (conflicts.length > 0) {
      return NextResponse.json(
        { error: 'Conflicting dietary approaches', conflicts },
        { status: 422 },
      )
    }
  }

  // ── Validate mealsPerDay / snacksPerDay ───────────────────────────────────
  for (const key of ['mealsPerDay', 'snacksPerDay'] as const) {
    if (key in input && input[key] !== null) {
      const val = input[key]
      const min = key === 'snacksPerDay' ? 0 : 1
      if (typeof val !== 'number' || !Number.isInteger(val) || val < min || val > 20) {
        return NextResponse.json(
          { error: `"${key}" must be an integer between ${min} and 20, or null` },
          { status: 400 },
        )
      }
    }
  }

  // ── Validate notes ────────────────────────────────────────────────────────
  if ('notes' in input && input.notes !== null) {
    if (typeof input.notes !== 'string' || input.notes.length > 1000) {
      return NextResponse.json({ error: '"notes" must be a string ≤ 1000 chars, or null' }, { status: 400 })
    }
  }

  // ── Validate allergens ────────────────────────────────────────────────────
  if ('allergens' in input) {
    if (!Array.isArray(input.allergens)) {
      return NextResponse.json({ error: '"allergens" must be an array' }, { status: 400 })
    }
    for (const a of input.allergens as unknown[]) {
      if (typeof a !== 'object' || a === null) {
        return NextResponse.json({ error: 'Each allergen must be an object' }, { status: 400 })
      }
      const allergen = a as Record<string, unknown>
      if (typeof allergen.name !== 'string' || allergen.name.trim().length === 0) {
        return NextResponse.json({ error: 'Each allergen requires a non-empty "name"' }, { status: 400 })
      }
      if (!isValidAllergenSeverity(allergen.severity)) {
        return NextResponse.json(
          { error: `Invalid allergen severity "${allergen.severity}". Must be: allergy, intolerance, or dislike` },
          { status: 400 },
        )
      }
    }
  }

  // ── Validate exclusions ───────────────────────────────────────────────────
  if ('exclusions' in input) {
    if (!Array.isArray(input.exclusions)) {
      return NextResponse.json({ error: '"exclusions" must be an array' }, { status: 400 })
    }
    for (const e of input.exclusions as unknown[]) {
      if (typeof e !== 'object' || e === null) {
        return NextResponse.json({ error: 'Each exclusion must be an object' }, { status: 400 })
      }
      const excl = e as Record<string, unknown>
      if (typeof excl.ingredient !== 'string' || excl.ingredient.trim().length === 0) {
        return NextResponse.json({ error: 'Each exclusion requires a non-empty "ingredient"' }, { status: 400 })
      }
    }
  }

  // ── Upsert ────────────────────────────────────────────────────────────────
  // Uses atomic upsert (ON CONFLICT DO UPDATE) to avoid P2002 on simultaneous
  // first-time saves from the same user (e.g. rapid double-submit).
  const pref = await prisma.$transaction(async tx => {
    const topLevelUpdate: Record<string, unknown> = {}
    if ('approaches'   in input) topLevelUpdate.approaches   = input.approaches
    if ('mealsPerDay'  in input) topLevelUpdate.mealsPerDay  = input.mealsPerDay  ?? null
    if ('snacksPerDay' in input) topLevelUpdate.snacksPerDay = input.snacksPerDay ?? null
    if ('notes'        in input) topLevelUpdate.notes        = input.notes        ?? null

    const result = await tx.dietaryPreference.upsert({
      where:  { userId: user.id },
      create: {
        userId: user.id,
        approaches: (input.approaches as DietaryApproach[] | undefined) ?? [],
        mealsPerDay:  (input.mealsPerDay  as number | null | undefined) ?? null,
        snacksPerDay: (input.snacksPerDay as number | null | undefined) ?? null,
        notes:        (input.notes        as string | null | undefined) ?? null,
      },
      update: topLevelUpdate,
      select: { id: true },
    })
    const prefId = result.id

    // Replace allergens if provided
    if ('allergens' in input) {
      await tx.dietaryAllergen.deleteMany({ where: { dietaryPreferenceId: prefId } })
      const allergens = input.allergens as Array<{ name: string; severity: string; notes?: string | null }>
      if (allergens.length > 0) {
        await tx.dietaryAllergen.createMany({
          data: allergens.map(a => ({
            dietaryPreferenceId: prefId,
            name: a.name.trim().toLowerCase(),
            severity: a.severity as 'allergy' | 'intolerance' | 'dislike',
            notes: a.notes ?? null,
          })),
        })
      }
    }

    // Replace exclusions if provided
    if ('exclusions' in input) {
      await tx.dietaryExclusion.deleteMany({ where: { dietaryPreferenceId: prefId } })
      const exclusions = input.exclusions as Array<{ ingredient: string; reason?: string | null }>
      if (exclusions.length > 0) {
        await tx.dietaryExclusion.createMany({
          data: exclusions.map(e => ({
            dietaryPreferenceId: prefId,
            ingredient: e.ingredient.trim().toLowerCase(),
            reason: e.reason ?? null,
          })),
        })
      }
    }

    return tx.dietaryPreference.findUnique({
      where: { id: prefId },
      include: { allergens: true, exclusions: true },
    })
  })

  return NextResponse.json({ preference: serializePreference(pref) })
}
