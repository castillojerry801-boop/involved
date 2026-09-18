import 'server-only'
import { prisma } from '@/lib/prisma'
import { getExerciseById } from '@/lib/exercises'

export interface VTrainingContext {
  profile: {
    fitnessLevel: string | null
    goals: Array<{ type: string; title: string; targetDate?: string }>
  }
  equipment: {
    profileName: string
    items: string[]
  } | null
  preferences: {
    favorites: string[]
    moreOften: string[]
    lessOften: string[]
    dontRecommend: string[]
  }
  recentTraining: Array<{
    date: string
    title: string
    musclesWorked: string[]
    totalSets: number
  }>
}

export async function buildVTrainingContext(userId: string): Promise<VTrainingContext> {
  const [profile, goals, activeEquipment, preferences, recentWorkouts] = await Promise.all([
    prisma.profile.findUnique({
      where: { id: userId },
      select: { fitnessLevel: true },
    }).catch(() => null),

    prisma.goal.findMany({
      where: { userId, status: 'active' },
      select: { type: true, title: true, targetDate: true },
      orderBy: { createdAt: 'desc' },
      take: 5,
    }).catch(() => []),

    prisma.equipmentProfile.findFirst({
      where: { userId, isActive: true },
      include: { items: { select: { equipment: true } } },
    }).catch(() => null),

    prisma.exercisePreference.findMany({
      where: { userId },
      select: { exerciseId: true, state: true },
    }).catch(() => []),

    prisma.workout.findMany({
      where: { userId, status: 'completed' },
      orderBy: { completedAt: 'desc' },
      take: 10,
      include: {
        exercises: {
          include: {
            sets: { where: { completed: true }, select: { id: true } },
          },
        },
      },
    }).catch(() => []),
  ])

  const favs: string[] = []
  const more: string[] = []
  const less: string[] = []
  const avoid: string[] = []

  for (const p of preferences) {
    if (p.state === 'favorite')        favs.push(p.exerciseId)
    else if (p.state === 'more_often') more.push(p.exerciseId)
    else if (p.state === 'less_often') less.push(p.exerciseId)
    else if (p.state === 'dont_recommend') avoid.push(p.exerciseId)
  }

  const recentTraining = recentWorkouts.map(w => {
    const muscles = [...new Set(
      w.exercises.flatMap(we => {
        const ex = getExerciseById(we.exerciseId)
        return ex ? [ex.target] : []
      })
    )]
    const totalSets = w.exercises.reduce((n, we) => n + we.sets.length, 0)
    return {
      date: (w.completedAt ?? w.startedAt ?? w.createdAt).toISOString().slice(0, 10),
      title: w.title,
      musclesWorked: muscles,
      totalSets,
    }
  })

  return {
    profile: {
      fitnessLevel: profile?.fitnessLevel ?? null,
      goals: goals.map(g => ({
        type: g.type,
        title: g.title,
        targetDate: g.targetDate
          ? new Date(g.targetDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
          : undefined,
      })),
    },
    equipment: activeEquipment
      ? { profileName: activeEquipment.name, items: activeEquipment.items.map(i => i.equipment) }
      : null,
    preferences: {
      favorites:     favs.slice(0, 20),
      moreOften:     more.slice(0, 20),
      lessOften:     less.slice(0, 20),
      dontRecommend: avoid.slice(0, 20),
    },
    recentTraining,
  }
}

export function trainingContextToPrompt(ctx: VTrainingContext): string {
  const lines: string[] = []

  lines.push(`FITNESS LEVEL: ${ctx.profile.fitnessLevel ?? 'not specified'}`)

  if (ctx.profile.goals.length > 0) {
    lines.push('GOALS:')
    ctx.profile.goals.forEach(g => {
      const date = g.targetDate ? ` (target: ${g.targetDate})` : ''
      lines.push(`  • [${g.type}] ${g.title}${date}`)
    })
  } else {
    lines.push('GOALS: None set.')
  }

  if (ctx.equipment) {
    lines.push(`EQUIPMENT PROFILE: ${ctx.equipment.profileName} — ${ctx.equipment.items.join(', ') || 'none listed'}`)
    lines.push('IMPORTANT: Only use exercises compatible with this equipment. Use search_exercises with these equipment values.')
  } else {
    lines.push('EQUIPMENT: No active equipment profile — assume full gym access.')
  }

  if (ctx.preferences.favorites.length > 0) {
    lines.push(`FAVORITE EXERCISES (prefer these): ${ctx.preferences.favorites.join(', ')}`)
  }
  if (ctx.preferences.moreOften.length > 0) {
    lines.push(`MORE OFTEN (include when relevant): ${ctx.preferences.moreOften.join(', ')}`)
  }
  if (ctx.preferences.lessOften.length > 0) {
    lines.push(`LESS OFTEN (avoid unless needed): ${ctx.preferences.lessOften.join(', ')}`)
  }
  if (ctx.preferences.dontRecommend.length > 0) {
    lines.push(`DO NOT USE (user excluded): ${ctx.preferences.dontRecommend.join(', ')}`)
  }

  if (ctx.recentTraining.length > 0) {
    lines.push('RECENT TRAINING (last 10 sessions):')
    ctx.recentTraining.forEach(t => {
      const muscles = t.musclesWorked.join(', ') || 'unknown'
      lines.push(`  ${t.date} — ${t.title} — ${muscles} — ${t.totalSets} sets`)
    })
  } else {
    lines.push('RECENT TRAINING: No recent sessions.')
  }

  return lines.join('\n')
}
