import 'server-only'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { assertTrainerClientAccess } from '@/lib/subscription/entitlements'

type Params = { params: Promise<{ clientId: string }> }

/**
 * GET /api/trainer/clients/[clientId]
 * Full client detail view for an authorized trainer.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { clientId } = await params

  try {
    await assertTrainerClientAccess(user.id, clientId)
  } catch {
    return Response.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

  try {
    const [
      profile,
      goals,
      recentWorkouts,
      personalRecords,
      assignedPrograms,
      trainerTargets,
      trainerNotes,
      pendingDrafts,
      complianceWorkouts,
    ] = await Promise.all([
      prisma.profile.findUnique({
        where:  { id: clientId },
        select: {
          id: true, displayName: true, avatarUrl: true,
          fitnessLevel: true, heightCm: true, weightKg: true,
          subscriptionTier: true, createdAt: true,
        },
      }),

      prisma.goal.findMany({
        where:   { userId: clientId, status: 'active' },
        orderBy: { createdAt: 'desc' },
        take:    10,
      }),

      prisma.workout.findMany({
        where:   { userId: clientId },
        orderBy: { scheduledDate: 'desc' },
        take:    20,
        include: {
          exercises: {
            include: {
              sets: { where: { completed: true }, select: { id: true } },
            },
          },
        },
      }),

      prisma.personalRecord.findMany({
        where:   { userId: clientId },
        orderBy: { achievedAt: 'desc' },
        take:    10,
      }),

      prisma.program.findMany({
        where:   { userId: clientId, trainerCreatedById: user.id },
        include: { days: { orderBy: { sortOrder: 'asc' } } },
        orderBy: { createdAt: 'desc' },
      }),

      prisma.trainerClientTarget.findMany({
        where:   { trainerId: user.id, clientId },
        orderBy: { effectiveDate: 'desc' },
      }),

      prisma.trainerNote.findMany({
        where:   { trainerId: user.id, clientId },
        orderBy: { createdAt: 'desc' },
        take:    20,
      }),

      prisma.vTrainerDraft.count({
        where: { trainerId: user.id, clientId, status: 'pending' },
      }),

      // Workouts assigned by this trainer in the last 30 days that are due (scheduled in the past)
      prisma.workout.findMany({
        where: {
          userId: clientId,
          assignedById: user.id,
          scheduledDate: { gte: thirtyDaysAgo, lte: new Date() },
        },
        select: { id: true, status: true, completedAt: true },
      }),
    ])

    const completedCount = complianceWorkouts.filter(
      w => w.status === 'completed' || w.completedAt != null
    ).length

    return Response.json({
      profile,
      goals,
      recentWorkouts: recentWorkouts.map(w => ({
        ...w,
        totalSets: w.exercises.reduce((n, ex) => n + ex.sets.length, 0),
      })),
      personalRecords,
      assignedPrograms,
      trainerTargets,
      trainerNotes,
      pendingDrafts,
      compliance: { total: complianceWorkouts.length, completed: completedCount },
    })
  } catch {
    return Response.json({ error: 'Failed to load client detail' }, { status: 500 })
  }
}
