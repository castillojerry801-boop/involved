import 'server-only'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import type { HealthActivityType } from '@prisma/client'
import { activityTypesCompatible } from '@/lib/health/classify'

const MAX_BATCH = 200

interface IncomingActivity {
  externalId: string
  provider: 'apple_health'
  activityType: string
  title: string
  startedAt: string
  endedAt: string
  durationSeconds: number
  distanceMeters: number | null
  activeEnergyKcal: number | null
  totalEnergyKcal: number | null
  avgHeartRate: number | null
  maxHeartRate: number | null
  sourceApp: string
}

const VALID_ACTIVITY_TYPES = new Set([
  'strength_training', 'running', 'cycling', 'walking', 'swimming',
  'hiking', 'yoga', 'hiit', 'rowing', 'other',
  'functional_strength', 'elliptical', 'stair_climbing', 'cross_training',
])

function toActivityType(raw: string): HealthActivityType {
  return (VALID_ACTIVITY_TYPES.has(raw) ? raw : 'other') as HealthActivityType
}

const RECONCILE_WINDOW_MS = 10 * 60 * 1000  // ±10 min — same threshold as linkOrCreateHealthActivity

/**
 * After an apple_health row is upserted, look for a matching `manual` projection
 * row that Involved created while waiting for HealthKit to sync.  When found, the
 * apple_health row takes ownership of involvedWorkoutId and the manual row is removed.
 *
 * The $transaction ensures no window where both rows simultaneously hold the same
 * involvedWorkoutId (violating the @unique constraint).
 */
async function reconcileManualRow(userId: string, ahExternalId: string): Promise<void> {
  const ahRow = await prisma.healthActivity.findUnique({
    where: { userId_provider_externalId: { userId, provider: 'apple_health', externalId: ahExternalId } },
    select: { id: true, activityType: true, startedAt: true, durationSeconds: true, involvedWorkoutId: true },
  })
  if (!ahRow || ahRow.involvedWorkoutId) return  // Not found or already linked

  const manualRow = await prisma.healthActivity.findFirst({
    where: {
      userId,
      provider: 'manual',
      involvedWorkoutId: { not: null },
      startedAt: {
        gte: new Date(ahRow.startedAt.getTime() - RECONCILE_WINDOW_MS),
        lte: new Date(ahRow.startedAt.getTime() + RECONCILE_WINDOW_MS),
      },
    },
    select: { id: true, involvedWorkoutId: true, activityType: true, durationSeconds: true },
  })
  if (!manualRow) return

  if (!activityTypesCompatible(ahRow.activityType, manualRow.activityType as HealthActivityType)) return

  const ahDur     = ahRow.durationSeconds
  const manualDur = manualRow.durationSeconds
  if (ahDur && manualDur) {
    const ratio = Math.abs(ahDur - manualDur) / Math.max(ahDur, manualDur)
    if (ratio > 0.5) return
  }

  // Delete the manual projection first (releases the involvedWorkoutId unique slot),
  // then link the apple_health row. Both steps must succeed or neither does.
  await prisma.$transaction([
    prisma.healthActivity.delete({ where: { id: manualRow.id } }),
    prisma.healthActivity.update({
      where: { id: ahRow.id },
      data:  { involvedWorkoutId: manualRow.involvedWorkoutId },
    }),
  ])
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const activities: IncomingActivity[] = (body.activities ?? []).slice(0, MAX_BATCH)

  if (activities.length === 0) {
    return Response.json({ synced: 0 })
  }

  let synced = 0
  const errors: string[] = []

  for (const act of activities) {
    try {
      await prisma.healthActivity.upsert({
        where: {
          userId_provider_externalId: {
            userId: user.id,
            provider: 'apple_health',
            externalId: act.externalId,
          },
        },
        create: {
          userId: user.id,
          provider: 'apple_health',
          externalId: act.externalId,
          activityType: toActivityType(act.activityType),
          title: act.title,
          startedAt: new Date(act.startedAt),
          endedAt: new Date(act.endedAt),
          durationSeconds: act.durationSeconds,
          distanceM: act.distanceMeters,
          activeEnergyKcal: act.activeEnergyKcal,
          totalEnergyKcal: act.totalEnergyKcal,
          avgHeartRateBpm: act.avgHeartRate,
          maxHeartRateBpm: act.maxHeartRate,
          syncState: 'synced',
        },
        update: {
          activityType: toActivityType(act.activityType),
          title: act.title,
          endedAt: new Date(act.endedAt),
          durationSeconds: act.durationSeconds,
          distanceM: act.distanceMeters,
          activeEnergyKcal: act.activeEnergyKcal,
          totalEnergyKcal: act.totalEnergyKcal,
          avgHeartRateBpm: act.avgHeartRate,
          maxHeartRateBpm: act.maxHeartRate,
          syncedAt: new Date(),
        },
      })
      synced++

      // Reconcile: if an Involved manual projection row already exists for this session,
      // transfer involvedWorkoutId to the apple_health row and delete the projection.
      // The Workout source record is NOT touched — only the disposable manual row is removed.
      await reconcileManualRow(user.id, act.externalId).catch(err =>
        console.error('[unified-activity] reconciliation failed', act.externalId, err)
      )
    } catch (err) {
      errors.push(act.externalId)
    }
  }

  // Advance the workout sync cursor to the most recent startedAt in this batch
  const latest = activities.reduce<string | null>((max, a) =>
    max === null || a.startedAt > max ? a.startedAt : max, null)

  if (latest) {
    await prisma.healthSyncCursor.upsert({
      where: {
        userId_provider_dataType: {
          userId: user.id,
          provider: 'apple_health',
          dataType: 'workout',
        },
      },
      create: {
        userId: user.id,
        provider: 'apple_health',
        dataType: 'workout',
        lastSyncedAt: new Date(latest),
      },
      update: {
        lastSyncedAt: new Date(latest),
      },
    })
  }

  return Response.json({ synced, errors: errors.length > 0 ? errors : undefined })
}
