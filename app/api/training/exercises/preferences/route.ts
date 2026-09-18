import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'

// GET: returns all exercise preferences for the current user as a plain object.
// Shape: { [exerciseId]: ExercisePreferenceState }

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const rows = await prisma.exercisePreference.findMany({
      where: { userId: user.id },
      select: { exerciseId: true, state: true },
    })
    const preferences: Record<string, string> = {}
    for (const row of rows) {
      preferences[row.exerciseId] = row.state
    }
    return Response.json({ preferences })
  } catch {
    return Response.json({ error: 'Failed to load preferences' }, { status: 500 })
  }
}
