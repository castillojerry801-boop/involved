import 'server-only'
import { prisma } from '@/lib/prisma'
import { getExerciseById } from '@/lib/exercises'
import { getExperienceDialogue } from './experience-dialogue'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface VTrainingContext {
  profile: {
    fitnessLevel:        string | null
    goals:               Array<{ type: string; title: string; targetDate?: string }>
    bodyMetrics:         { ageYears: number | null; weightKg: number | null }
    weeklyWorkoutTarget: number | null
  }
  equipment: {
    profileName: string
    items: string[]
  } | null
  preferences: {
    favorites:     string[]
    moreOften:     string[]
    lessOften:     string[]
    dontRecommend: string[]
  }
  personalRecords: Array<{
    exerciseName: string
    exerciseId:   string
    metric:       string
    value:        number
    unit:         string
    achievedAt:   string
  }>
  recentTraining: Array<{
    date:          string
    title:         string
    musclesWorked: string[]
    totalSets:     number
    topSets:       Array<{
      exerciseName: string
      exerciseId:   string
      maxWeightKg:  number
      topReps:      number | null
      setCount:     number
    }>
  }>
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function calcAge(dob: Date | null): number | null {
  if (!dob) return null
  const today = new Date()
  let age = today.getFullYear() - dob.getFullYear()
  const m = today.getMonth() - dob.getMonth()
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--
  return age
}

// ─── Builder ──────────────────────────────────────────────────────────────────

export async function buildVTrainingContext(userId: string): Promise<VTrainingContext> {
  const [profile, goals, activeEquipment, preferences, prs, weeklyTarget, recentWorkouts] = await Promise.all([
    prisma.profile.findUnique({
      where: { id: userId },
      select: { fitnessLevel: true, dateOfBirth: true, weightKg: true },
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

    prisma.personalRecord.findMany({
      where: {
        userId,
        metric: { in: ['weight', 'estimated_1rm'] },
      },
      select: { exerciseId: true, metric: true, value: true, unit: true, achievedAt: true },
      orderBy: { value: 'desc' },
      take: 20,
    }).catch(() => []),

    prisma.weeklyTarget.findFirst({
      where: { userId, targetType: 'workouts_per_week' },
      select: { targetValue: true },
    }).catch(() => null),

    prisma.workout.findMany({
      where: { userId, status: 'completed' },
      orderBy: { completedAt: 'desc' },
      take: 10,
      include: {
        exercises: {
          include: {
            sets: {
              where: { completed: true },
              select: {
                setType:      true,
                actualWeightKg: true,
                actualReps:   true,
              },
            },
          },
        },
      },
    }).catch(() => []),
  ])

  // Preferences
  const favs: string[] = []
  const more: string[] = []
  const less: string[] = []
  const avoid: string[] = []
  for (const p of preferences) {
    if (p.state === 'favorite')         favs.push(p.exerciseId)
    else if (p.state === 'more_often')  more.push(p.exerciseId)
    else if (p.state === 'less_often')  less.push(p.exerciseId)
    else if (p.state === 'dont_recommend') avoid.push(p.exerciseId)
  }

  // PRs
  const personalRecords = prs.map(pr => {
    const ex = getExerciseById(pr.exerciseId)
    return {
      exerciseName: ex?.name ?? pr.exerciseId,
      exerciseId:   pr.exerciseId,
      metric:       pr.metric,
      value:        Number(pr.value),
      unit:         pr.unit,
      achievedAt:   new Date(pr.achievedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    }
  })

  // Recent training with actual performance
  const recentTraining = recentWorkouts.map(w => {
    const muscles = [...new Set(
      w.exercises.flatMap(we => {
        const ex = getExerciseById(we.exerciseId)
        return ex ? [ex.target] : []
      })
    )]
    const totalSets = w.exercises.reduce((n, we) => n + we.sets.length, 0)

    // Top sets per exercise: working sets with weight data, highest weight first
    const topSets = w.exercises
      .map(we => {
        const ex = getExerciseById(we.exerciseId)
        const workingSets = we.sets.filter(
          s => s.setType === 'working' && s.actualWeightKg != null && Number(s.actualWeightKg) > 0
        )
        if (workingSets.length === 0) return null
        const topSet = workingSets.reduce((best, s) =>
          Number(s.actualWeightKg) > Number(best.actualWeightKg) ? s : best
        )
        return {
          exerciseName: ex?.name ?? we.exerciseId,
          exerciseId:   we.exerciseId,
          maxWeightKg:  Number(topSet.actualWeightKg),
          topReps:      topSet.actualReps ?? null,
          setCount:     workingSets.length,
        }
      })
      .filter((s): s is NonNullable<typeof s> => s !== null)
      .sort((a, b) => b.maxWeightKg - a.maxWeightKg)
      .slice(0, 4)

    return {
      date:          (w.completedAt ?? w.startedAt ?? w.createdAt).toISOString().slice(0, 10),
      title:         w.title,
      musclesWorked: muscles,
      totalSets,
      topSets,
    }
  })

  return {
    profile: {
      fitnessLevel:        profile?.fitnessLevel ?? null,
      goals:               goals.map(g => ({
        type:       g.type,
        title:      g.title,
        targetDate: g.targetDate
          ? new Date(g.targetDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
          : undefined,
      })),
      bodyMetrics: {
        ageYears: calcAge(profile?.dateOfBirth ?? null),
        weightKg: profile?.weightKg != null ? Number(profile.weightKg) : null,
      },
      weeklyWorkoutTarget: weeklyTarget?.targetValue ?? null,
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
    personalRecords,
    recentTraining,
  }
}

// ─── Load anchor helpers ──────────────────────────────────────────────────────

export function isPowerliftingMovement(name: string): boolean {
  const n = name.toLowerCase()
  return /\bsquat\b/.test(n) || /bench\s*press/.test(n) || /\bdeadlift\b/.test(n)
}

const ANCHOR_PCTS = [50, 60, 65, 70, 72.5, 75, 77.5, 80, 82.5, 85, 87.5, 90, 92.5, 95]

export function buildLoadAnchors(
  prs: Array<{ exerciseName: string; metric: string; value: number; unit: string }>
): string[] {
  const lines: string[] = []
  // Use estimated_1rm if available; if only weight is available, do NOT extrapolate
  const seen = new Set<string>()
  for (const pr of prs) {
    if (!isPowerliftingMovement(pr.exerciseName)) continue
    if (pr.metric !== 'estimated_1rm') continue
    if (seen.has(pr.exerciseName)) continue
    seen.add(pr.exerciseName)

    const oneRmKg = pr.unit === 'lb' ? pr.value / 2.20462 : pr.value
    const oneRmLb = pr.unit === 'lb' ? pr.value : pr.value * 2.20462

    const pctPairs = ANCHOR_PCTS.map(pct => {
      const lbs = Math.round(oneRmLb * pct / 100)
      const kg  = Math.round(oneRmKg * pct / 100 * 10) / 10
      return `${pct}% = ${lbs} lb / ${kg} kg`
    })

    const approxLb = Math.round(oneRmLb)
    const approxKg = Math.round(oneRmKg * 10) / 10
    lines.push(`  ${pr.exerciseName} (1RM ~${approxLb} lb / ${approxKg} kg):`)
    // Two rows of 7
    lines.push(`    ${pctPairs.slice(0, 7).join(' | ')}`)
    lines.push(`    ${pctPairs.slice(7).join(' | ')}`)
  }
  return lines
}

// ─── Formatter ────────────────────────────────────────────────────────────────

export function trainingContextToPrompt(ctx: VTrainingContext): string {
  const lines: string[] = []

  lines.push(`FITNESS LEVEL: ${ctx.profile.fitnessLevel ?? 'not specified'}`)
  lines.push(getExperienceDialogue(ctx.profile.fitnessLevel))

  // Session depth guidance based on experience
  const lvl = (ctx.profile.fitnessLevel ?? '').toLowerCase()
  if (lvl.includes('beginner') || lvl.includes('novice')) {
    lines.push('SESSION DEPTH GUIDANCE: Beginner — 3–5 exercises per session is complete and appropriate. Do NOT pad with accessories. Linear progression on all movements. No failure training, no supersets, no advanced techniques.')
  } else if (lvl.includes('intermediate')) {
    lines.push('SESSION DEPTH GUIDANCE: Intermediate — 4–7 exercises depending on session type. Primary compound + targeted accessories. May use alternating pairs or accessory supersets. 1–3 RIR on compounds, 0–1 RIR allowed on isolations.')
  } else if (lvl.includes('advanced') || lvl.includes('expert')) {
    lines.push('SESSION DEPTH GUIDANCE: Advanced — 5–9 exercises where session type and recovery support it. Greater specialization: multiple angles, weak-point work, loaded carries, sport-specific. Each additional exercise must have a stated purpose.')
  }

  // Body metrics
  const { ageYears, weightKg } = ctx.profile.bodyMetrics
  if (ageYears != null || weightKg != null) {
    const parts: string[] = []
    if (ageYears != null) parts.push(`Age: ${ageYears}`)
    if (weightKg != null) {
      const lbs = Math.round(weightKg * 2.20462)
      parts.push(`Body weight: ${lbs} lb (${weightKg} kg)`)
    }
    lines.push(`BODY METRICS: ${parts.join(' | ')}`)
  }

  // Weekly target
  if (ctx.profile.weeklyWorkoutTarget != null) {
    lines.push(`WEEKLY WORKOUT TARGET: ${ctx.profile.weeklyWorkoutTarget} days/week`)
  }

  // Goals
  if (ctx.profile.goals.length > 0) {
    lines.push('GOALS:')
    ctx.profile.goals.forEach(g => {
      const date = g.targetDate ? ` (target: ${g.targetDate})` : ''
      lines.push(`  • [${g.type}] ${g.title}${date}`)
    })
  } else {
    lines.push('GOALS: None set.')
  }

  // Equipment
  if (ctx.equipment) {
    lines.push(`EQUIPMENT PROFILE: ${ctx.equipment.profileName} — ${ctx.equipment.items.join(', ') || 'none listed'}`)
    lines.push('IMPORTANT: Only use exercises compatible with this equipment. Use search_exercises with these equipment values.')
  } else {
    lines.push('EQUIPMENT: No active equipment profile — assume full gym access.')
  }

  // Preferences
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

  // PRs — load calibration reference
  if (ctx.personalRecords.length > 0) {
    lines.push('PERSONAL RECORDS (use for load calibration):')
    ctx.personalRecords.forEach(pr => {
      const metricLabel = pr.metric === 'estimated_1rm' ? 'est. 1RM' : 'max weight'
      lines.push(`  ${pr.exerciseName}: ${metricLabel} ${pr.value} ${pr.unit} (${pr.achievedAt})`)
    })

    // Load anchors — compute percentage landmarks for powerlifting movements
    const anchors = buildLoadAnchors(ctx.personalRecords)
    if (anchors.length > 0) {
      lines.push('LOAD ANCHORS — USE THESE for percentage-based prescription:')
      anchors.forEach(a => lines.push(a))
    }
  }

  // Recent training with actual performance
  if (ctx.recentTraining.length > 0) {
    lines.push('RECENT TRAINING (last 10 sessions):')
    ctx.recentTraining.forEach(t => {
      const muscles = t.musclesWorked.join(', ') || 'unknown'
      lines.push(`  ${t.date} — ${t.title} — ${muscles} — ${t.totalSets} sets`)
      if (t.topSets.length > 0) {
        t.topSets.forEach(s => {
          const repsStr = s.topReps != null ? ` × ${s.topReps} reps` : ''
          lines.push(`    ${s.exerciseName}: ${s.setCount} sets @ ${s.maxWeightKg} kg${repsStr}`)
        })
      }
    })
  } else {
    lines.push('RECENT TRAINING: No recent sessions.')
  }

  return lines.join('\n')
}
