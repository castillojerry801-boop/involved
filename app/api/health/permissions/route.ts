import 'server-only'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  getHealthPermissions,
  recordPermissionGrant,
  recordPermissionRevoke,
} from '@/lib/health/permissions'
import type { HealthProvider } from '@/lib/health/types'

export async function GET(_req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const permissions = await getHealthPermissions(user.id)
  return Response.json({ permissions })
}

interface PermissionUpdateBody {
  provider:  HealthProvider
  dataTypes: string[]
  action:    'grant' | 'revoke'
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as PermissionUpdateBody

  if (!body.provider || !Array.isArray(body.dataTypes) || !body.action) {
    return Response.json({ error: 'provider, dataTypes, and action are required' }, { status: 400 })
  }
  if (!['grant', 'revoke'].includes(body.action)) {
    return Response.json({ error: 'action must be grant or revoke' }, { status: 400 })
  }

  try {
    if (body.action === 'grant') {
      await recordPermissionGrant(user.id, body.provider, body.dataTypes)
    } else {
      await recordPermissionRevoke(user.id, body.provider, body.dataTypes)
    }
    return Response.json({ ok: true })
  } catch {
    return Response.json({ error: 'Failed to update permissions' }, { status: 500 })
  }
}
