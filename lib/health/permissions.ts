import 'server-only'
import { prisma } from '@/lib/prisma'
import type { HealthProvider } from './types'

// Data types that Involved requests from health platforms.
// Each maps to what must be declared in native entitlements.
export const HEALTH_DATA_TYPES = {
  workouts:        'workouts',
  steps:           'steps',
  active_energy:   'active_energy',
  heart_rate:      'heart_rate',
  body_weight:     'body_weight',
  distance:        'distance',
  body_fat:        'body_fat',
} as const

export type HealthDataType = keyof typeof HEALTH_DATA_TYPES

// Minimum permissions needed for each Involved feature.
// Only request what is actually used.
export const REQUIRED_PERMISSIONS: Record<string, HealthDataType[]> = {
  activity_dashboard: ['workouts', 'steps', 'active_energy'],
  progress_charts:    ['body_weight'],
  heart_rate_summary: ['heart_rate'],
}

export interface PermissionRecord {
  provider:  HealthProvider
  dataType:  string
  granted:   boolean
  grantedAt: Date | null
  revokedAt: Date | null
}

export async function getHealthPermissions(userId: string): Promise<PermissionRecord[]> {
  const rows = await prisma.healthPermission.findMany({ where: { userId } })
  return rows.map(r => ({
    provider:  r.provider,
    dataType:  r.dataType,
    granted:   r.granted,
    grantedAt: r.grantedAt,
    revokedAt: r.revokedAt,
  }))
}

export async function hasPermission(
  userId:   string,
  provider: HealthProvider,
  dataType: string,
): Promise<boolean> {
  const row = await prisma.healthPermission.findUnique({
    where: { userId_provider_dataType: { userId, provider, dataType } },
  })
  return row?.granted === true && row.revokedAt === null
}

export async function recordPermissionGrant(
  userId:    string,
  provider:  HealthProvider,
  dataTypes: string[],
): Promise<void> {
  const now = new Date()
  await Promise.all(
    dataTypes.map(dataType =>
      prisma.healthPermission.upsert({
        where:  { userId_provider_dataType: { userId, provider, dataType } },
        create: { userId, provider, dataType, granted: true, grantedAt: now },
        update: { granted: true, grantedAt: now, revokedAt: null },
      })
    )
  )
}

export async function recordPermissionRevoke(
  userId:    string,
  provider:  HealthProvider,
  dataTypes: string[],
): Promise<void> {
  const now = new Date()
  await Promise.all(
    dataTypes.map(dataType =>
      prisma.healthPermission.upsert({
        where:  { userId_provider_dataType: { userId, provider, dataType } },
        create: { userId, provider, dataType, granted: false, revokedAt: now },
        update: { granted: false, revokedAt: now },
      })
    )
  )
}
