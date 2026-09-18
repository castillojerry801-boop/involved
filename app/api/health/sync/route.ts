import 'server-only'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { processSyncPayload } from '@/lib/health/sync'
import { recordPermissionGrant } from '@/lib/health/permissions'
import type { HealthSyncPayload } from '@/lib/health/types'

/**
 * POST /api/health/sync
 *
 * Receives normalized health data from a native platform bridge
 * (iOS HealthKit bridge, Android Health Connect bridge, etc.).
 *
 * The native layer is responsible for:
 *   1. Requesting platform permissions
 *   2. Reading raw platform data
 *   3. Normalizing to the InboundHealthActivity / InboundHealthMetric shape
 *   4. Calling this endpoint with the user's auth token
 *
 * See /docs/NATIVE_BRIDGE.md for the full native-layer contract.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  let payload: HealthSyncPayload
  try {
    payload = await req.json() as HealthSyncPayload
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!payload.provider) {
    return Response.json({ error: 'provider is required' }, { status: 400 })
  }

  // Record that the user has granted access (the native layer already verified permission)
  const grantedTypes: string[] = []
  if ((payload.activities?.length ?? 0) > 0) grantedTypes.push('workouts', 'active_energy', 'heart_rate')
  if (payload.metrics?.some(m => m.metricType === 'steps'))           grantedTypes.push('steps')
  if (payload.metrics?.some(m => m.metricType === 'body_weight_kg'))  grantedTypes.push('body_weight')
  if (grantedTypes.length > 0) {
    await recordPermissionGrant(user.id, payload.provider, [...new Set(grantedTypes)])
  }

  try {
    const result = await processSyncPayload(user.id, payload)
    return Response.json({ ok: true, ...result })
  } catch (err) {
    console.error('health/sync error:', err)
    return Response.json({ error: 'Sync failed' }, { status: 500 })
  }
}
