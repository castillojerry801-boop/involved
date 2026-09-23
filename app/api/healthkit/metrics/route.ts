import 'server-only'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import type { HealthMetricType } from '@prisma/client'

const MAX_BATCH = 200

const VALID_METRIC_TYPES = new Set<string>([
  'steps', 'active_energy_kcal', 'resting_energy_kcal',
  'heart_rate_avg_bpm', 'heart_rate_max_bpm', 'heart_rate_resting_bpm',
  'distance_m', 'body_weight_kg', 'body_fat_pct',
  'sleep_duration_s', 'vo2_max', 'hrv_ms', 'stand_hours', 'flights_climbed',
])

interface IncomingMetric {
  externalId: string
  provider: 'apple_health'
  metricType: string
  value: number
  unit: string
  recordedAt: string
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const metrics: IncomingMetric[] = (body.metrics ?? []).slice(0, MAX_BATCH)

  if (metrics.length === 0) {
    return Response.json({ synced: 0 })
  }

  // Filter out unknown metric types
  const valid = metrics.filter((m) => VALID_METRIC_TYPES.has(m.metricType))

  let synced = 0
  const errors: string[] = []

  for (const metric of valid) {
    try {
      await prisma.healthMetric.upsert({
        where: {
          userId_provider_metricType_recordedAt: {
            userId: user.id,
            provider: 'apple_health',
            metricType: metric.metricType as HealthMetricType,
            recordedAt: new Date(metric.recordedAt),
          },
        },
        create: {
          userId: user.id,
          provider: 'apple_health',
          externalId: metric.externalId,
          metricType: metric.metricType as HealthMetricType,
          value: metric.value,
          unit: metric.unit,
          recordedAt: new Date(metric.recordedAt),
          syncState: 'synced',
        },
        update: {
          value: metric.value,
          unit: metric.unit,
          syncedAt: new Date(),
        },
      })
      synced++
    } catch {
      errors.push(metric.externalId)
    }
  }

  return Response.json({ synced, errors: errors.length > 0 ? errors : undefined })
}
