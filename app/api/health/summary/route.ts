import 'server-only'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { buildHealthVSummary } from '@/lib/health/summary'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const days = Math.min(parseInt(req.nextUrl.searchParams.get('days') ?? '14'), 90)

  try {
    const summary = await buildHealthVSummary(user.id, days)
    return Response.json({ summary })
  } catch {
    return Response.json({ error: 'Failed to build summary' }, { status: 500 })
  }
}
