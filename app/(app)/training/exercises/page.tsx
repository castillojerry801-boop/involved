import { Metadata } from 'next'
import { filterExercises, getDistinctEquipment, getDistinctTargets } from '@/lib/exercises'
import { ExerciseBrowser, type BrowserFilterState } from '@/components/training/exercise-browser'
import { getUser } from '@/lib/supabase/server'
import {
  getUserPreferenceMap,
  getAllowedExerciseIds,
  getActiveEquipmentList,
} from '@/lib/training/exercise-queries'

export const metadata: Metadata = { title: 'Exercise Library' }

async function search(filters: BrowserFilterState) {
  'use server'
  const user = await getUser()

  let favoriteIds: Set<string> | undefined
  let excludeIds: Set<string> | undefined

  if (user) {
    const { getUserFavoriteIds, getUserExcludedIds } = await import('@/lib/training/exercise-queries')
    const [favs, excl] = await Promise.all([
      getUserFavoriteIds(user.id),
      getUserExcludedIds(user.id),
    ])
    favoriteIds = favs
    excludeIds = excl
  }

  return filterExercises({
    q: filters.q,
    bodyPart: filters.bodyPart === 'all' ? null : filters.bodyPart,
    equipment: filters.equipment,
    target: filters.target,
    favoriteIds,
    favoritesOnly: filters.favoritesOnly,
    excludeIds,
    limit: 120,
  })
}

export default async function ExerciseLibraryPage() {
  const user = await getUser()

  const [preferences, allowedIds, activeEquipmentList] = await Promise.all([
    user ? getUserPreferenceMap(user.id).then(m => Object.fromEntries(m)) : Promise.resolve({}),
    user ? getAllowedExerciseIds(user.id) : Promise.resolve(null),
    user ? getActiveEquipmentList(user.id) : Promise.resolve(null),
  ])

  const favoriteIds = new Set(
    Object.entries(preferences)
      .filter(([, s]) => s === 'favorite')
      .map(([id]) => id)
  )
  const excludeIds = new Set(
    Object.entries(preferences)
      .filter(([, s]) => s === 'dont_recommend')
      .map(([id]) => id)
  )

  const initial = filterExercises({
    allowedIds: allowedIds ?? undefined,
    favoriteIds,
    excludeIds,
    limit: 120,
  })

  const equipmentOptions = getDistinctEquipment()
  const targetOptions = getDistinctTargets()

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:px-8 md:py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-black text-zinc-900 dark:text-white">Exercise Library</h1>
        <p className="text-sm text-zinc-500">1,394 exercises with animated guides</p>
      </div>
      <ExerciseBrowser
        initialExercises={initial}
        equipmentOptions={equipmentOptions}
        targetOptions={targetOptions}
        initialPreferences={preferences as Record<string, import('@/components/training/exercise-browser').PreferenceState>}
        activeEquipmentProfile={activeEquipmentList ? { name: 'Active profile', equipment: activeEquipmentList } : null}
        onSearch={search}
        showFavoriteToggle
      />
    </div>
  )
}
