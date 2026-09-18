import 'server-only'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { getUserEntitlement } from '@/lib/subscription/entitlements'

/**
 * GET /api/trainer/clients
 * Returns the trainer's authorized client roster with summary data.
 */
export async function GET(_req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const ent = await getUserEntitlement(user.id)
  if (!ent.isTrainer) return Response.json({ error: 'Trainer subscription required' }, { status: 403 })

  const weekStart = new Date()
  weekStart.setDate(weekStart.getDate() - weekStart.getDay())
  weekStart.setHours(0, 0, 0, 0)

  try {
    const relationships = await prisma.trainerClientRelationship.findMany({
      where:   { trainerId: user.id, status: 'active', revokedAt: null },
      include: {
        client: {
          select: {
            id:              true,
            displayName:     true,
            avatarUrl:       true,
            fitnessLevel:    true,
            goals:           { where: { status: 'active' }, select: { type: true, title: true }, take: 3 },
            workouts:        {
              where:   { status: 'completed' },
              orderBy: { completedAt: 'desc' },
              take:    1,
              select:  { completedAt: true, title: true },
            },
            personalRecords: {
              orderBy: { achievedAt: 'desc' },
              take:    1,
              select:  { exerciseId: true, metric: true, value: true, unit: true, achievedAt: true },
            },
            weeklyTargets:   { where: { targetType: 'workouts_per_week' }, select: { targetValue: true } },
          },
        },
      },
      orderBy: { acceptedAt: 'asc' },
    })

    // Fetch per-client counts in parallel
    const summaries = await Promise.all(
      relationships.map(async rel => {
        const clientId = rel.clientId
        const [workoutsThisWeek, missedThisWeek] = await Promise.all([
          prisma.workout.count({
            where: { userId: clientId, status: 'completed', completedAt: { gte: weekStart } },
          }),
          prisma.workout.count({
            where: { userId: clientId, status: 'skipped', scheduledDate: { gte: weekStart } },
          }),
        ])

        return {
          relationshipId:   rel.id,
          clientId,
          displayName:      rel.client.displayName,
          avatarUrl:        rel.client.avatarUrl,
          fitnessLevel:     rel.client.fitnessLevel,
          joinedAt:         rel.acceptedAt,
          goals:            rel.client.goals,
          lastWorkout:      rel.client.workouts[0]
            ? { date: rel.client.workouts[0].completedAt!.toISOString().slice(0, 10), title: rel.client.workouts[0].title }
            : null,
          latestPR:         rel.client.personalRecords[0] ?? null,
          weeklyTarget:     rel.client.weeklyTargets[0]?.targetValue ?? null,
          workoutsThisWeek,
          missedThisWeek,
        }
      })
    )

    return Response.json({ clients: summaries })
  } catch {
    return Response.json({ error: 'Failed to load clients' }, { status: 500 })
  }
}
