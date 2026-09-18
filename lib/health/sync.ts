import 'server-only'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { HealthProvider, HealthActivityType, HealthMetricType } from '@prisma/client'
import type { HealthSyncPayload, InboundHealthActivity, InboundHealthMetric } from './types'
import { METRIC_UNITS } from './types'

export interface SyncResult {
  activitiesUpserted: number
  metricsUpserted:    number
  errors:             string[]
}

/**
 * Process a sync payload from a native health bridge.
 *
 * Dedup strategy:
 *   - Activities: upsert on (userId, provider, externalId) — non-null externalId only.
 *     Manual entries (externalId absent) are always inserted as new records.
 *   - Metrics: upsert on (userId, provider, metricType, recordedAt).
 *
 * Sync loop prevention:
 *   Records written back from Involved to a platform carry externalId "involved:<workoutId>".
 *   On re-import the upsert updates the existing row rather than creating a duplicate.
 */
export async function processSyncPayload(
  userId:  string,
  payload: HealthSyncPayload,
): Promise<SyncResult> {
  const result: SyncResult = { activitiesUpserted: 0, metricsUpserted: 0, errors: [] }
  const { provider, anchor } = payload

  for (const item of payload.activities ?? []) {
    try {
      await upsertActivity(userId, provider, item)
      result.activitiesUpserted++
    } catch (err) {
      result.errors.push(`activity ${item.externalId}: ${String(err)}`)
    }
  }

  for (const item of payload.metrics ?? []) {
    try {
      await upsertMetric(userId, provider, item)
      result.metricsUpserted++
    } catch (err) {
      result.errors.push(`metric ${item.metricType}@${item.recordedAt}: ${String(err)}`)
    }
  }

  await prisma.healthSyncCursor.upsert({
    where:  { userId_provider_dataType: { userId, provider: provider as HealthProvider, dataType: 'all' } },
    create: { userId, provider: provider as HealthProvider, dataType: 'all', lastSyncedAt: new Date(), lastAnchor: anchor ?? null },
    update: { lastSyncedAt: new Date(), lastAnchor: anchor ?? null },
  })

  return result
}

async function upsertActivity(
  userId:   string,
  provider: string,
  item:     InboundHealthActivity,
): Promise<void> {
  const p = provider as HealthProvider
  const at = item.activityType as HealthActivityType

  const base = {
    userId,
    provider:         p,
    activityType:     at,
    title:            item.title ?? null,
    startedAt:        new Date(item.startedAt),
    endedAt:          item.endedAt       ? new Date(item.endedAt)  : null,
    durationSeconds:  item.durationSeconds  ?? null,
    activeEnergyKcal: item.activeEnergyKcal ?? null,
    totalEnergyKcal:  item.totalEnergyKcal  ?? null,
    distanceM:        item.distanceM        ?? null,
    stepCount:        item.stepCount        ?? null,
    avgHeartRateBpm:  item.avgHeartRateBpm  ?? null,
    maxHeartRateBpm:  item.maxHeartRateBpm  ?? null,
    rawMetadataJson:  item.rawMetadata ? (item.rawMetadata as Prisma.InputJsonValue) : Prisma.DbNull,
    syncState:        'synced' as const,
    syncedAt:         new Date(),
  }

  if (item.externalId) {
    await prisma.healthActivity.upsert({
      where:  { userId_provider_externalId: { userId, provider: p, externalId: item.externalId } },
      create: { ...base, externalId: item.externalId },
      update: { ...base, externalId: item.externalId },
    })
  } else {
    await prisma.healthActivity.create({ data: { ...base, externalId: null } })
  }
}

async function upsertMetric(
  userId:   string,
  provider: string,
  item:     InboundHealthMetric,
): Promise<void> {
  const p  = provider as HealthProvider
  const mt = item.metricType as HealthMetricType
  const recordedAt = new Date(item.recordedAt)
  const unit = METRIC_UNITS[item.metricType]

  const data = {
    userId,
    provider:    p,
    metricType:  mt,
    value:       item.value,
    unit,
    recordedAt,
    periodStart: item.periodStart ? new Date(item.periodStart) : null,
    periodEnd:   item.periodEnd   ? new Date(item.periodEnd)   : null,
    externalId:  item.externalId ?? null,
    syncState:   'synced' as const,
    syncedAt:    new Date(),
  }

  await prisma.healthMetric.upsert({
    where:  { userId_provider_metricType_recordedAt: { userId, provider: p, metricType: mt, recordedAt } },
    create: data,
    update: data,
  })
}

/**
 * Build a write-back payload for an Involved workout so the native bridge
 * can record it in Apple Health / Health Connect.
 */
export function buildWriteBackPayload(workout: {
  id:              string
  title:           string
  startedAt:       Date | null
  completedAt:     Date | null
  durationSeconds: number | null
}): InboundHealthActivity | null {
  if (!workout.startedAt || !workout.completedAt) return null

  return {
    externalId:      `involved:${workout.id}`,
    activityType:    'strength_training',
    title:           workout.title,
    startedAt:       workout.startedAt.toISOString(),
    endedAt:         workout.completedAt.toISOString(),
    durationSeconds: workout.durationSeconds ?? undefined,
  }
}
