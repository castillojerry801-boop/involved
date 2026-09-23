import 'server-only'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import type { HealthActivityType } from '@prisma/client'

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
