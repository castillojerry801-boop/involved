import 'server-only'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { filterExercises } from '@/lib/exercises'
import { getUserFavoriteIds, getUserExcludedIds } from '@/lib/training/exercise-queries'
import { getUserCustomExercises } from '@/lib/training/custom-exercises'
import type { ExerciseMeta } from '@/lib/exercises'

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const q = sp.get('q') ?? ''
  const bodyPart = sp.get('bodyPart') ?? undefined
  const equipment = sp.get('equipment') ?? undefined
  const target = sp.get('target') ?? undefined
  const favoritesOnly = sp.get('favoritesOnly') === 'true'
  const includeCustom = sp.get('includeCustom') === 'true'
  const limit = Math.min(parseInt(sp.get('limit') ?? '60'), 200)
  const offset = parseInt(sp.get('offset') ?? '0')

  let favoriteIds: Set<string> | undefined
  let excludeIds: Set<string> | undefined
  let customExercises: ExerciseMeta[] = []

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

  if (includeCustom && user) {
    const allCustom = await getUserCustomExercises(user.id)
    const lq = q.toLowerCase()
    customExercises = allCustom.filter(c =>
      !q || c.name.toLowerCase().includes(lq) || (c.target ?? '').toLowerCase().includes(lq)
    )
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

  return Response.json({
    exercises: [...customExercises, ...exercises],
    total: customExercises.length + exercises.length,
  })
}
