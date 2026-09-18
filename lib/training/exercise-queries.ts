import 'server-only'
import { prisma } from '@/lib/prisma'
import { getExerciseIdsForEquipment } from '@/lib/exercises'

// All functions here are server-only.
// V and any future AI caller should consume these to get structured
// constraints rather than reading raw tables directly.

export type PreferenceMap = Map<string, string>  // exerciseId → ExercisePreferenceState

export async function getUserPreferenceMap(userId: string): Promise<PreferenceMap> {
  const rows = await prisma.exercisePreference.findMany({
    where: { userId },
    select: { exerciseId: true, state: true },
  })
  return new Map(rows.map(r => [r.exerciseId, r.state]))
}

export async function getUserFavoriteIds(userId: string): Promise<Set<string>> {
  const rows = await prisma.exercisePreference.findMany({
    where: { userId, state: 'favorite' },
    select: { exerciseId: true },
  })
  return new Set(rows.map(r => r.exerciseId))
}

export async function getUserExcludedIds(userId: string): Promise<Set<string>> {
  const rows = await prisma.exercisePreference.findMany({
    where: { userId, state: 'dont_recommend' },
    select: { exerciseId: true },
  })
  return new Set(rows.map(r => r.exerciseId))
}

// Returns the equipment list from the user's active profile, or null if none.
export async function getActiveEquipmentList(userId: string): Promise<string[] | null> {
  const profile = await prisma.equipmentProfile.findFirst({
    where: { userId, isActive: true },
    include: { items: { select: { equipment: true } } },
  })
  if (!profile) return null
  return profile.items.map(i => i.equipment)
}

// Returns exercise IDs compatible with the user's active equipment profile.
// Pass to filterExercises as allowedIds.
export async function getAllowedExerciseIds(userId: string): Promise<Set<string> | null> {
  const equipment = await getActiveEquipmentList(userId)
  if (!equipment) return null
  return getExerciseIdsForEquipment(equipment)
}

// Full constraint bundle for V workout generation (no AI called here).
export async function getExerciseConstraints(userId: string) {
  const [preferenceMap, allowedIds] = await Promise.all([
    getUserPreferenceMap(userId),
    getAllowedExerciseIds(userId),
  ])

  const favoriteIds = new Set<string>()
  const moreOftenIds = new Set<string>()
  const lessOftenIds = new Set<string>()
  const excludeIds = new Set<string>()

  for (const [id, state] of preferenceMap) {
    if (state === 'favorite') favoriteIds.add(id)
    else if (state === 'more_often') moreOftenIds.add(id)
    else if (state === 'less_often') lessOftenIds.add(id)
    else if (state === 'dont_recommend') excludeIds.add(id)
  }

  return {
    allowedIds,       // null = no equipment restriction
    favoriteIds,
    moreOftenIds,
    lessOftenIds,
    excludeIds,
  }
}
