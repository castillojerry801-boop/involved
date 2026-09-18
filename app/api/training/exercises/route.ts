import 'server-only'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { filterExercises } from '@/lib/exercises'
import { getUserFavoriteIds, getUserExcludedIds } from '@/lib/training/exercise-queries'

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const q = sp.get('q') ?? ''
  const bodyPart = sp.get('bodyPart') ?? undefined
  const equipment = sp.get('equipment') ?? undefined
  const target = sp.get('target') ?? undefined
  const favoritesOnly = sp.get('favoritesOnly') === 'true'
  const limit = Math.min(parseInt(sp.get('limit') ?? '60'), 200)
  const offset = parseInt(sp.get('offset') ?? '0')

  // Load user preferences when needed
  let favoriteIds: Set<string> | undefined
  let excludeIds: Set<string> | undefined

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (user && (favoritesOnly || sp.get('applyPreferences') !== 'false')) {
    const [favs, excl] = await Promise.all([
      getUserFavoriteIds(user.id),
      getUserExcludedIds(user.id),
    ])
    favoriteIds = favs
    excludeIds = excl
  }

  const exercises = filterExercises({
    q,
    bodyPart: bodyPart || null,
    equipment: equipment || null,
    target: target || null,
    favoriteIds,
    favoritesOnly,
    excludeIds,
    limit,
    offset,
  })

  return Response.json({ exercises, total: exercises.length })
}
