import 'server-only'
import { prisma } from '@/lib/prisma'
import { buildVTrainingContext, deriveReadinessState, trainingContextToPrompt, RESISTANCE_ACTIVITY_TYPES } from '@/lib/v/training-context'
import type { VTrainingContext } from '@/lib/v/training-context'

// Compact structured context sent to the Coach.
// AI receives summaries — not raw database records.

export interface NutritionDayTotal {
  date:     string
  calories: number
  protein:  number
  carbs:    number
  fat:      number
  meals:    number
}

export interface NutritionContext {
  targetsSet: boolean
  targets?: { calories: number; protein: number; carbs: number; fat: number }
  today?: {
    calories: number; protein: number; carbs: number; fat: number
    remaining?: number; mealsLogged: number
    byMeal: Record<string, { calories: number; protein: number; carbs: number; fat: number; count: number }>
  }
  // Last 7 days including today — oldest first, today last
  history: NutritionDayTotal[]
}

export interface HealthMetricsSummary {
  stepsToday?:         number
  stepsAvg7d?:         number
  stepsDataDays?:      number
  sleepLastNightHours?: number
  bodyWeightKg?:       number
  bodyWeightDate?:     string
}

// A single Apple Health / Health Connect / manual activity as surfaced to V.
// Never contains set-level data — only activity-level summaries.
export interface HealthActivityForV {
  id:               string
  provider:         string
  activityType:     string
  title:            string | null
  date:             string   // YYYY-MM-DD
  durationMinutes:  number | null
  activeEnergyKcal: number | null
  distanceKm:       number | null
  avgHeartRateBpm:  number | null
  maxHeartRateBpm:  number | null
  stepCount:        number | null
  // Non-null = formally matched to an Involved workout via involvedWorkoutId FK.
  involvedWorkoutId: string | null
  // How confident we are that this activity overlaps an Involved session:
  //   'time'  — start/end timestamps overlap (high confidence)
  //   'date'  — same calendar date only, no timestamp data for one side (lower confidence)
  //   null    — no Involved session on the same date
  overlapKind: 'time' | 'date' | null
}

const PROVIDER_DISPLAY: Record<string, string> = {
  apple_health:   'Apple Health',
  health_connect: 'Health Connect',
  garmin:         'Garmin',
  polar:          'Polar',
  manual:         'Manual',
}

// Exported for unit testing.
// Returns true when two activity time windows overlap or are within 60 minutes.
// Falls back to false (not "unknown") so callers can apply date-only detection separately.
export function timesOverlap(
  haStart: Date,
  haDurationSec: number | null,
  wStart: Date | null,
  wEnd:   Date | null,
  wDurationSec: number | null,
): boolean {
  // Compute health-activity end time
  const haEnd = haDurationSec != null
    ? new Date(haStart.getTime() + haDurationSec * 1000)
    : null

  // Compute workout start/end from whatever is available
  const effectiveWStart =
    wStart ??
    (wEnd != null && wDurationSec != null
      ? new Date(wEnd.getTime() - wDurationSec * 1000)
      : null)
  const effectiveWEnd =
    wEnd ??
    (wStart != null && wDurationSec != null
      ? new Date(wStart.getTime() + wDurationSec * 1000)
      : null)

  // Full interval overlap when both ranges are known
  if (haEnd && effectiveWStart && effectiveWEnd) {
    return haStart < effectiveWEnd && haEnd > effectiveWStart
  }

  // Proximity fallback: if starts/ends are within 60 minutes, treat as the same session.
  // Covers the common case where one side lacks duration (e.g. Apple Watch start +
  // Involved completedAt only) — a 60-min window is conservative for typical gym sessions.
  const PROXIMITY_MS = 60 * 60 * 1000
  if (effectiveWStart && Math.abs(haStart.getTime() - effectiveWStart.getTime()) <= PROXIMITY_MS) return true
  if (effectiveWEnd   && Math.abs(haStart.getTime() - effectiveWEnd.getTime())   <= PROXIMITY_MS) return true
  if (haEnd && effectiveWEnd && Math.abs(haEnd.getTime() - effectiveWEnd.getTime()) <= PROXIMITY_MS) return true

  return false
}

export interface GoalSummary {
  type: string
  title: string
  detail?: string
  targetDate?: string
}

export interface CoachContext {
  today:                  string  // YYYY-MM-DD UTC — anchor for "last N days" calculations
  user:                   { name: string; tier: 'free' | 'plus' }
  goals:                  GoalSummary[]
  nutrition:              NutritionContext
  healthMetrics:          HealthMetricsSummary
  recentHealthActivities?: HealthActivityForV[]
  trainingSnippet:        string
  trainingCtx:            VTrainingContext | null
}

export async function buildCoachContext(userId: string, userEmail?: string): Promise<CoachContext> {
  const today     = new Date().toISOString().slice(0, 10)
  const todayDate = new Date(today)

  // 7-day window: 6 days ago through today
  const sevenDaysAgo = new Date(todayDate)
  sevenDaysAgo.setDate(todayDate.getDate() - 6)
  sevenDaysAgo.setHours(0, 0, 0, 0)

  // 14-day window for health activities — matches buildHealthVSummary default
  const fourteenDaysAgo = new Date(todayDate)
  fourteenDaysAgo.setDate(todayDate.getDate() - 13)
  fourteenDaysAgo.setHours(0, 0, 0, 0)

  const [profile, goals, target, entries7d, healthMetricRows, trainingCtx, rawHealthActivities, workoutTimestamps] = await Promise.all([
    prisma.profile.findUnique({
      where:  { id: userId },
      select: { displayName: true, subscriptionTier: true },
    }).catch(() => null),

    prisma.goal.findMany({
      where:   { userId, status: 'active' },
      select:  { type: true, title: true, description: true, targetDate: true },
      orderBy: { createdAt: 'desc' },
      take:    8,
    }).catch(() => []),

    prisma.nutritionTarget.findFirst({
      where:   { userId },
      orderBy: { effectiveDate: 'desc' },
    }).catch(() => null),

    prisma.foodLogEntry.findMany({
      where: {
        userId,
        logDate: { gte: sevenDaysAgo, lte: new Date(today) },
      },
      select: {
        logDate:                        true,
        mealType:                       true,
        servingMultiplier:              true,
        snapshotCaloriesPerServing:     true,
        snapshotProteinGPerServing:     true,
        snapshotCarbohydrateGPerServing: true,
        snapshotFatGPerServing:         true,
      },
      orderBy: { logDate: 'asc' },
    }).catch(() => []),

    prisma.healthMetric.findMany({
      where: {
        userId,
        metricType: { in: ['steps', 'sleep_duration_s', 'body_weight_kg'] },
        recordedAt: { gte: sevenDaysAgo },
      },
      select:  { metricType: true, value: true, recordedAt: true, periodStart: true },
      orderBy: { recordedAt: 'desc' },
    }).catch(() => []),

    buildVTrainingContext(userId).catch(() => null),

    // Non-Strava health activities for the last 14 days.
    // Strava excluded pending API-terms review — consistent with training-context.ts.
    prisma.healthActivity.findMany({
      where: {
        userId,
        provider:  { not: 'strava' },
        startedAt: { gte: fourteenDaysAgo },
      },
      select: {
        id:               true,
        provider:         true,
        activityType:     true,
        title:            true,
        startedAt:        true,
        durationSeconds:  true,
        activeEnergyKcal: true,
        distanceM:        true,
        avgHeartRateBpm:  true,
        maxHeartRateBpm:  true,
        stepCount:        true,
        involvedWorkoutId: true,
      },
      orderBy: { startedAt: 'desc' },
      take: 20,
    }).catch(() => []),

    // Lightweight timestamp query for the same 14-day window — used for time-overlap
    // duplicate detection against health activities. Only timing fields are fetched;
    // full workout data comes from trainingCtx above.
    prisma.workout.findMany({
      where: {
        userId,
        status:    'completed',
        source:    { not: 'strava' },
        completedAt: { gte: fourteenDaysAgo },
      },
      select: {
        id:              true,
        startedAt:       true,
        completedAt:     true,
        durationSeconds: true,
      },
    }).catch(() => []),
  ])

  const name = profile?.displayName || userEmail?.split('@')[0] || 'Athlete'
  const tier = (profile?.subscriptionTier ?? 'free') as 'free' | 'plus'

  const goalSummaries: GoalSummary[] = goals.map(g => ({
    type:       g.type,
    title:      g.title,
    detail:     g.description ?? undefined,
    targetDate: g.targetDate
      ? new Date(g.targetDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : undefined,
  }))

  // ── Nutrition: group entries by date and mealType ──────────────────────────
  // Math done here — never by AI

  type MacroAcc = { calories: number; protein: number; carbs: number; fat: number; count: number }
  const zeroMacro = (): MacroAcc => ({ calories: 0, protein: 0, carbs: 0, fat: 0, count: 0 })

  const byDate  = new Map<string, MacroAcc>()
  const byMeal  = new Map<string, MacroAcc>()

  for (const e of entries7d) {
    const dateKey = (e.logDate instanceof Date ? e.logDate : new Date(e.logDate))
      .toISOString().slice(0, 10)
    const m       = Number(e.servingMultiplier)
    const cal     = Math.round(Number(e.snapshotCaloriesPerServing) * m)
    const pro     = Math.round(Number(e.snapshotProteinGPerServing)        * m * 10) / 10
    const carb    = Math.round(Number(e.snapshotCarbohydrateGPerServing)   * m * 10) / 10
    const fat     = Math.round(Number(e.snapshotFatGPerServing)            * m * 10) / 10

    const d = byDate.get(dateKey) ?? zeroMacro()
    d.calories += cal; d.protein += pro; d.carbs += carb; d.fat += fat; d.count++
    byDate.set(dateKey, d)

    if (dateKey === today) {
      const meal = String(e.mealType)
      const mv = byMeal.get(meal) ?? zeroMacro()
      mv.calories += cal; mv.protein += pro; mv.carbs += carb; mv.fat += fat; mv.count++
      byMeal.set(meal, mv)
    }
  }

  // Build 7-day history array, oldest → newest
  const history: NutritionDayTotal[] = []
  for (let i = 6; i >= 0; i--) {
    const d    = new Date(todayDate)
    d.setDate(todayDate.getDate() - i)
    const key  = d.toISOString().slice(0, 10)
    const day  = byDate.get(key) ?? zeroMacro()
    history.push({ date: key, calories: day.calories, protein: day.protein, carbs: day.carbs, fat: day.fat, meals: day.count })
  }

  const todayMacros = byDate.get(today) ?? zeroMacro()
  const byMealRecord: Record<string, { calories: number; protein: number; carbs: number; fat: number; count: number }> = {}
  for (const [meal, v] of byMeal) {
    byMealRecord[meal] = v
  }

  const nutrition: NutritionContext = {
    targetsSet: !!target,
    history,
    ...(target
      ? {
          targets: {
            calories: Number(target.calories),
            protein:  Number(target.proteinG),
            carbs:    Number(target.carbohydrateG),
            fat:      Number(target.fatG),
          },
          today: {
            calories:    todayMacros.calories,
            protein:     todayMacros.protein,
            carbs:       todayMacros.carbs,
            fat:         todayMacros.fat,
            remaining:   Number(target.calories) - todayMacros.calories,
            mealsLogged: todayMacros.count,
            byMeal:      byMealRecord,
          },
        }
      : {
          today: {
            calories:    todayMacros.calories,
            protein:     todayMacros.protein,
            carbs:       todayMacros.carbs,
            fat:         todayMacros.fat,
            mealsLogged: todayMacros.count,
            byMeal:      byMealRecord,
          },
        }),
  }

  // ── Health metrics summary ─────────────────────────────────────────────────
  const healthMetrics: HealthMetricsSummary = {}

  const stepsRows = healthMetricRows.filter(r => r.metricType === 'steps')
  if (stepsRows.length > 0) {
    // Today's steps = row with periodStart on today, else most recent
    const todaySteps = stepsRows.find(r =>
      r.periodStart?.toISOString().slice(0, 10) === today ||
      r.recordedAt.toISOString().slice(0, 10) === today
    )
    if (todaySteps) healthMetrics.stepsToday = Math.round(Number(todaySteps.value))

    // 7-day average (one row per calendar day, take the most recent per day)
    const seenDays = new Map<string, number>()
    for (const r of stepsRows) {
      const dk = (r.periodStart ?? r.recordedAt).toISOString().slice(0, 10)
      if (!seenDays.has(dk)) seenDays.set(dk, Number(r.value))
    }
    if (seenDays.size > 0) {
      const total = [...seenDays.values()].reduce((s, v) => s + v, 0)
      healthMetrics.stepsAvg7d   = Math.round(total / seenDays.size)
      healthMetrics.stepsDataDays = seenDays.size
    }
  }

  // Sleep: most recent night's duration
  const sleepRows = healthMetricRows.filter(r => r.metricType === 'sleep_duration_s')
  if (sleepRows.length > 0) {
    healthMetrics.sleepLastNightHours = Math.round(Number(sleepRows[0].value) / 3600 * 10) / 10
  }

  // Body weight: most recent reading
  const weightRows = healthMetricRows.filter(r => r.metricType === 'body_weight_kg')
  if (weightRows.length > 0) {
    healthMetrics.bodyWeightKg   = Math.round(Number(weightRows[0].value) * 10) / 10
    healthMetrics.bodyWeightDate = weightRows[0].recordedAt.toISOString().slice(0, 10)
  }

  // ── Health activities — overlap detection + readiness update ─────────────
  type WorkoutStamp = { id: string; startedAt: Date | null; completedAt: Date | null; durationSeconds: number | null }
  // Group workout timestamps by date for efficient per-activity lookup.
  const workoutsByDate = new Map<string, WorkoutStamp[]>()
  for (const w of workoutTimestamps) {
    const d = (w.completedAt ?? w.startedAt)?.toISOString().slice(0, 10)
    if (!d) continue
    if (!workoutsByDate.has(d)) workoutsByDate.set(d, [])
    workoutsByDate.get(d)!.push(w)
  }

  const recentHealthActivities: HealthActivityForV[] = rawHealthActivities.map(a => {
    const date         = a.startedAt.toISOString().slice(0, 10)
    const isResistance = RESISTANCE_ACTIVITY_TYPES.has(a.activityType)

    let overlapKind: HealthActivityForV['overlapKind'] = null

    if (a.involvedWorkoutId === null && isResistance) {
      const sameDayWorkouts = workoutsByDate.get(date) ?? []
      if (sameDayWorkouts.length > 0) {
        // Prefer time-overlap detection when workout has at least one timestamp.
        const timeMatch = sameDayWorkouts.some(w =>
          (w.startedAt != null || w.completedAt != null) &&
          timesOverlap(a.startedAt, a.durationSeconds, w.startedAt, w.completedAt, w.durationSeconds)
        )
        overlapKind = timeMatch ? 'time' : 'date'
      }
    }

    return {
      id:               a.id,
      provider:         a.provider,
      activityType:     a.activityType,
      title:            a.title,
      date,
      durationMinutes:  a.durationSeconds ? Math.round(a.durationSeconds / 60) : null,
      activeEnergyKcal: a.activeEnergyKcal ? Math.round(Number(a.activeEnergyKcal)) : null,
      distanceKm:       a.distanceM ? Math.round(Number(a.distanceM) / 10) / 100 : null,
      avgHeartRateBpm:  a.avgHeartRateBpm,
      maxHeartRateBpm:  a.maxHeartRateBpm,
      stepCount:        a.stepCount,
      involvedWorkoutId: a.involvedWorkoutId,
      overlapKind,
    }
  })

  // Re-derive readiness now that we have health activities. This overrides the
  // estimate computed inside buildVTrainingContext (which had no health data).
  // Must happen before trainingContextToPrompt so READINESS guidance is correct.
  if (trainingCtx) {
    trainingCtx.readinessState = deriveReadinessState(
      trainingCtx.profile.fitnessLevel,
      trainingCtx.recentTraining,
      trainingCtx.personalRecords,
      recentHealthActivities,
    )
  }

  return {
    today,
    user: { name, tier },
    goals: goalSummaries,
    nutrition,
    healthMetrics,
    recentHealthActivities,
    trainingSnippet: trainingCtx ? trainingContextToPrompt(trainingCtx) : 'TRAINING: No data available.',
    trainingCtx,
  }
}

export function contextToSystemSnippet(ctx: CoachContext): string {
  const { today, goals, nutrition, healthMetrics, recentHealthActivities, trainingSnippet } = ctx
  const lines: string[] = []

  // Anchor date — V uses this to compute any "last N days" or "this week" window.
  lines.push(`TODAY: ${today}`)
  lines.push('')

  if (goals.length > 0) {
    lines.push('USER GOALS:')
    goals.forEach(g => {
      const date   = g.targetDate ? ` (target: ${g.targetDate})` : ''
      const detail = g.detail ? ` — ${g.detail}` : ''
      lines.push(`  • [${g.type}] ${g.title}${detail}${date}`)
    })
  } else {
    lines.push('USER GOALS: None set yet.')
  }

  lines.push('')

  // Nutrition today
  if (nutrition.targetsSet && nutrition.targets && nutrition.today) {
    const t = nutrition.targets
    const d = nutrition.today
    if (d.mealsLogged === 0) {
      // Nothing logged yet — do not emit zero-calorie consumed/remaining values, which
      // V would otherwise read as an actual intake signal (e.g. at midnight after reset).
      lines.push('NUTRITION: Targets set, nothing logged today yet.')
    } else {
      lines.push('NUTRITION TODAY:')
      lines.push(`  Targets:   ${t.calories} cal | ${t.protein}g protein | ${t.carbs}g carbs | ${t.fat}g fat`)
      lines.push(`  Consumed:  ${d.calories} cal | ${d.protein}g protein | ${d.carbs}g carbs | ${d.fat}g fat`)
      lines.push(`  Remaining: ${d.remaining} cal | Meals logged: ${d.mealsLogged}`)
      if (Object.keys(d.byMeal).length > 0) {
        lines.push('  By meal:')
        for (const [meal, v] of Object.entries(d.byMeal)) {
          lines.push(`    ${meal}: ${v.calories} cal | ${v.protein}g P | ${v.carbs}g C | ${v.fat}g F`)
        }
      }
    }
  } else if (nutrition.today && nutrition.today.mealsLogged > 0) {
    const d = nutrition.today
    lines.push(`NUTRITION TODAY (no targets set): ${d.calories} cal | ${d.protein}g protein | ${d.carbs}g carbs | ${d.fat}g fat | ${d.mealsLogged} meals`)
  } else if (nutrition.targetsSet) {
    lines.push('NUTRITION: Targets set, nothing logged today.')
  } else {
    lines.push('NUTRITION: No targets set.')
  }

  // 7-day nutrition history — show if at least 1 day has data; always include pre-computed avg
  const daysWithData = nutrition.history.filter(d => d.meals > 0)
  if (daysWithData.length >= 1) {
    const avgCal  = Math.round(daysWithData.reduce((s, d) => s + d.calories, 0) / daysWithData.length)
    const avgPro  = Math.round(daysWithData.reduce((s, d) => s + d.protein,  0) / daysWithData.length * 10) / 10
    const avgCarb = Math.round(daysWithData.reduce((s, d) => s + d.carbs,    0) / daysWithData.length * 10) / 10
    const avgFat  = Math.round(daysWithData.reduce((s, d) => s + d.fat,      0) / daysWithData.length * 10) / 10
    lines.push(`NUTRITION HISTORY (${daysWithData.length} of 7 days logged):`)
    daysWithData.forEach(d => {
      lines.push(`  ${d.date}: ${d.calories} cal | ${d.protein}g P | ${d.carbs}g C | ${d.fat}g F (${d.meals} meals)`)
    })
    lines.push(`  Avg over ${daysWithData.length} logged day${daysWithData.length === 1 ? '' : 's'}: ${avgCal} cal | ${avgPro}g P | ${avgCarb}g C | ${avgFat}g F`)
    if (daysWithData.length < 5) {
      lines.push(`  IMPORTANT: Only ${daysWithData.length} of 7 days have food entries — averages reflect logged days only. Do NOT infer a calorie surplus or deficit from partial logs.`)
    }
  }

  // Health metrics
  const hmLines: string[] = []
  if (healthMetrics.stepsToday    != null) hmLines.push(`Steps today: ${healthMetrics.stepsToday.toLocaleString()}`)
  if (healthMetrics.stepsAvg7d != null) {
    const daysNote = healthMetrics.stepsDataDays != null && healthMetrics.stepsDataDays < 7
      ? ` (based on ${healthMetrics.stepsDataDays} of 7 days synced — may not be representative)`
      : ''
    hmLines.push(`7-day avg steps: ${healthMetrics.stepsAvg7d.toLocaleString()}${daysNote}`)
  }
  if (healthMetrics.sleepLastNightHours != null) hmLines.push(`Sleep last night: ${healthMetrics.sleepLastNightHours}h`)
  if (healthMetrics.bodyWeightKg  != null) {
    const lbs = Math.round(healthMetrics.bodyWeightKg * 2.20462)
    hmLines.push(`Body weight: ${lbs} lb / ${healthMetrics.bodyWeightKg} kg (${healthMetrics.bodyWeightDate})`)
  }
  if (hmLines.length > 0) {
    lines.push('')
    lines.push('HEALTH METRICS:')
    hmLines.forEach(l => lines.push(`  ${l}`))
    lines.push('NOTE: Do NOT compute energy balance from active calories alone — resting expenditure is substantial and not fully measured here.')
  }

  // Health activities (Apple Health / Health Connect / manual — last 14 days)
  const activities = recentHealthActivities ?? []
  if (activities.length > 0) {
    lines.push('')
    lines.push(`HEALTH ACTIVITIES (non-Strava — last 14 days through ${today}):`)
    for (const a of activities) {
      const label    = a.title ?? a.activityType.replace(/_/g, ' ')
      const provider = PROVIDER_DISPLAY[a.provider] ?? a.provider
      const parts: string[] = [a.date, label, provider]
      if (a.durationMinutes  != null) parts.push(`${a.durationMinutes} min`)
      if (a.avgHeartRateBpm  != null) parts.push(`avg HR ${a.avgHeartRateBpm} bpm`)
      if (a.activeEnergyKcal != null) parts.push(`${a.activeEnergyKcal} kcal active`)
      if (a.distanceKm       != null) parts.push(`${a.distanceKm} km`)
      if (a.stepCount        != null) parts.push(`${a.stepCount.toLocaleString()} steps`)
      let suffix = ''
      if (a.involvedWorkoutId != null) {
        suffix = ' [also logged in Involved]'
      } else if (a.overlapKind === 'time') {
        suffix = ' [likely same session — time window overlaps Involved workout]'
      } else if (a.overlapKind === 'date') {
        suffix = ' [possible overlap — Involved workout on same date, timestamps unavailable]'
      }
      lines.push(`  • ${parts.join(' · ')}${suffix}`)
    }
    lines.push('NOTE: Activity summaries only — no set data. For load calibration use RECENT TRAINING. Linked sessions (source-noted above) count once across both sections.')
  }

  lines.push('')
  lines.push(trainingSnippet)

  return lines.join('\n')
}
