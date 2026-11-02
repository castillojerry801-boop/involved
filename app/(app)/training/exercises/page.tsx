import { Metadata } from 'next'
import { PageHeader } from '@/components/layout/PageHeader'
import { filterExercises, getDistinctEquipment, getDistinctTargets, getExerciseIdsForEquipment, type Exercise } from '@/lib/exercises'
import { ExerciseBrowser, type BrowserFilterState } from '@/components/training/exercise-browser'
import { getUser } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
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

interface PageProps {
  searchParams: Promise<{ profileId?: string }>
}

export default async function ExerciseLibraryPage({ searchParams }: PageProps) {
  const user = await getUser()
  const { profileId } = await searchParams
  const isYmoveMode = process.env.YMOVE_CATALOG_ENABLED === 'true'

  // YMove mode: load initial catalog exercises
  if (isYmoveMode) {
    const preferences = user
      ? await getUserPreferenceMap(user.id).then(m => Object.fromEntries(m)).catch(() => ({}))
      : {}

    const [rows, ymoveTotal] = await Promise.all([
      prisma.ymoveExerciseCatalog.findMany({
        where: { NOT: { curationStatus: 'duplicate' } },
        select: { ymoveId: true, name: true, equipment: true, primaryMuscleGroup: true },
        orderBy: { name: 'asc' },
        take: 20,
      }).catch(() => []),
      prisma.ymoveExerciseCatalog.count({
        where: { NOT: { curationStatus: 'duplicate' } },
      }).catch(() => 0),
    ])

    const ymoveInitial: Exercise[] = rows.map(r => ({
      id: `ymv:${r.ymoveId}`,
      name: r.name,
      bodyPart: r.primaryMuscleGroup?.toLowerCase() ?? 'unknown',
      equipment: r.equipment ?? 'unknown',
      target: r.primaryMuscleGroup ?? 'unknown',
      secondaryMuscles: [],
      instructions: [],
      description: '',
    }))

    return (
      <div className="mx-auto max-w-3xl px-4 py-6 md:px-8 md:py-8">
        <PageHeader
          title="Exercise Library"
          subtitle={`${ymoveTotal.toLocaleString()} exercises with technique videos`}
        />
        <ExerciseBrowser
          initialExercises={ymoveInitial}
          equipmentOptions={[]}
          targetOptions={[]}
          initialPreferences={preferences as Record<string, import('@/components/training/exercise-browser').PreferenceState>}
          activeEquipmentProfile={null}
          onSearch={search}
          showFavoriteToggle
          ymoveMode
        />
      </div>
    )
  }

  // ExDB mode (default)
  let allowedIds: Set<string> | null = null
  let profileName: string | null = null
  let profileEquipmentList: string[] | null = null

  if (user && profileId) {
    const profile = await prisma.equipmentProfile.findFirst({
      where: { id: profileId, userId: user.id },
      include: { items: { select: { equipment: true } } },
    }).catch(() => null)

    if (profile) {
      profileEquipmentList = profile.items.map(i => i.equipment)
      allowedIds = getExerciseIdsForEquipment(profileEquipmentList)
      profileName = profile.name
    }
  } else if (user) {
    const [ids, equipList] = await Promise.all([
      getAllowedExerciseIds(user.id),
      getActiveEquipmentList(user.id),
    ])
    allowedIds = ids
    profileEquipmentList = equipList
    if (equipList) profileName = 'Active profile'
  }

  const [preferences] = await Promise.all([
    user ? getUserPreferenceMap(user.id).then(m => Object.fromEntries(m)) : Promise.resolve({}),
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
      <PageHeader
        title={profileName && profileId ? `Exercises at ${profileName}` : 'Exercise Library'}
        subtitle={allowedIds ? `${initial.length} exercises with your available equipment` : '1,394 exercises with animated guides'}
      />
      <ExerciseBrowser
        initialExercises={initial}
        equipmentOptions={equipmentOptions}
        targetOptions={targetOptions}
        initialPreferences={preferences as Record<string, import('@/components/training/exercise-browser').PreferenceState>}
        activeEquipmentProfile={profileEquipmentList ? { name: profileName ?? 'Profile', equipment: profileEquipmentList } : null}
        onSearch={search}
        showFavoriteToggle
      />
    </div>
  )
}
