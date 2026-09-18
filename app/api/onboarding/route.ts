import 'server-only'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { Prisma, type FitnessLevel } from '@prisma/client'

interface OnboardingBody {
  displayName:   string
  fitnessLevel:  FitnessLevel
  goalType:      string
  goalTitle:     string
  equipment:     string[]
  weeklyWorkouts: number
  weightKg?:     number
  heightCm?:     number
}

const VALID_FITNESS_LEVELS = new Set<FitnessLevel>(['beginner', 'intermediate', 'advanced'])
const VALID_GOAL_TYPES = new Set(['strength', 'body_comp', 'endurance', 'habit', 'custom', 'event'])

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as OnboardingBody

  if (!body.displayName?.trim()) return Response.json({ error: 'displayName required' }, { status: 400 })
  if (!VALID_FITNESS_LEVELS.has(body.fitnessLevel)) return Response.json({ error: 'invalid fitnessLevel' }, { status: 400 })
  if (!body.goalTitle?.trim()) return Response.json({ error: 'goalTitle required' }, { status: 400 })

  const goalType = VALID_GOAL_TYPES.has(body.goalType) ? body.goalType : 'custom'
  const weeklyWorkouts = Math.max(1, Math.min(7, Math.round(body.weeklyWorkouts ?? 3)))

  await Promise.all([
    // 1. Update profile
    prisma.profile.update({
      where: { id: user.id },
      data: {
        displayName:  body.displayName.trim(),
        fitnessLevel: body.fitnessLevel,
        weightKg:     body.weightKg   ?? null,
        heightCm:     body.heightCm   ?? null,
      },
    }),

    // 2. Create primary goal
    prisma.goal.create({
      data: {
        userId: user.id,
        type:   goalType as 'strength' | 'body_comp' | 'endurance' | 'habit' | 'custom' | 'event',
        title:  body.goalTitle.trim(),
        status: 'active',
      },
    }),

    // 3. Set weekly workout target
    prisma.weeklyTarget.upsert({
      where:  { userId_targetType: { userId: user.id, targetType: 'workouts_per_week' } },
      create: { userId: user.id, targetType: 'workouts_per_week', targetValue: weeklyWorkouts },
      update: { targetValue: weeklyWorkouts },
    }),
  ])

  // 4. Create equipment profile (only if equipment selected)
  if (body.equipment?.length > 0) {
    await prisma.equipmentProfile.create({
      data: {
        userId:  user.id,
        name:     'My gym',
        isActive: true,
        items: {
          create: body.equipment.map((eq, i) => ({
            equipment:        eq,
            sortOrder:        i,
            availableWeights: Prisma.DbNull,
          })),
        },
      },
    })
  }

  return Response.json({ ok: true })
}

// GET: check if current user has completed onboarding
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const profile = await prisma.profile.findUnique({
    where:  { id: user.id },
    select: { fitnessLevel: true, displayName: true },
  })

  const complete = !!profile?.fitnessLevel
  return Response.json({ complete })
}
