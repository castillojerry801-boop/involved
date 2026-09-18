import 'server-only'
import { prisma } from '@/lib/prisma'
import { buildVTrainingContext, trainingContextToPrompt } from '@/lib/v/training-context'

// Compact structured context sent to the Coach.
// AI receives summaries — not raw database records.

export interface NutritionContext {
  targetsSet: boolean
  targets?: { calories: number; protein: number; carbs: number; fat: number }
  today?: {
    calories: number; protein: number; carbs: number; fat: number
    remaining?: number; mealsLogged: number
  }
}

export interface GoalSummary {
  type: string
  title: string
  detail?: string
  targetDate?: string
}

export interface CoachContext {
  user: { name: string; tier: 'free' | 'plus' }
  goals: GoalSummary[]
  nutrition: NutritionContext
  trainingSnippet: string
}

export async function buildCoachContext(userId: string, userEmail?: string): Promise<CoachContext> {
  const today = new Date().toISOString().slice(0, 10)

  const [profile, goals, target, entries, trainingCtx] = await Promise.all([
    prisma.profile.findUnique({
      where: { id: userId },
      select: { displayName: true, subscriptionTier: true },
    }).catch(() => null),

    prisma.goal.findMany({
      where: { userId, status: 'active' },
      select: { type: true, title: true, description: true, targetDate: true },
      orderBy: { createdAt: 'desc' },
      take: 8,
    }).catch(() => []),

    prisma.nutritionTarget.findFirst({
      where: { userId },
      orderBy: { effectiveDate: 'desc' },
    }).catch(() => null),

    prisma.foodLogEntry.findMany({
      where: { userId, logDate: new Date(today) },
      select: {
        servingMultiplier: true,
        snapshotCaloriesPerServing: true,
        snapshotProteinGPerServing: true,
        snapshotCarbohydrateGPerServing: true,
        snapshotFatGPerServing: true,
      },
    }).catch(() => []),

    buildVTrainingContext(userId).catch(() => null),
  ])

  const name = profile?.displayName || userEmail?.split('@')[0] || 'Athlete'
  const tier = (profile?.subscriptionTier ?? 'free') as 'free' | 'plus'

  const goalSummaries: GoalSummary[] = goals.map(g => ({
    type: g.type,
    title: g.title,
    detail: g.description ?? undefined,
    targetDate: g.targetDate
      ? new Date(g.targetDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : undefined,
  }))

  // Math done here — never by AI
  const todayTotals = entries.reduce(
    (acc, e) => {
      const m = Number(e.servingMultiplier)
      return {
        calories: acc.calories + Math.round(Number(e.snapshotCaloriesPerServing) * m),
        protein:  acc.protein  + Math.round(Number(e.snapshotProteinGPerServing)  * m * 10) / 10,
        carbs:    acc.carbs    + Math.round(Number(e.snapshotCarbohydrateGPerServing) * m * 10) / 10,
        fat:      acc.fat      + Math.round(Number(e.snapshotFatGPerServing)       * m * 10) / 10,
        count:    acc.count    + 1,
      }
    },
    { calories: 0, protein: 0, carbs: 0, fat: 0, count: 0 },
  )

  const nutrition: NutritionContext = target
    ? {
        targetsSet: true,
        targets: {
          calories: Number(target.calories),
          protein:  Number(target.proteinG),
          carbs:    Number(target.carbohydrateG),
          fat:      Number(target.fatG),
        },
        today: {
          calories:    todayTotals.calories,
          protein:     todayTotals.protein,
          carbs:       todayTotals.carbs,
          fat:         todayTotals.fat,
          remaining:   Number(target.calories) - todayTotals.calories,
          mealsLogged: todayTotals.count,
        },
      }
    : { targetsSet: false }

  return {
    user: { name, tier },
    goals: goalSummaries,
    nutrition,
    trainingSnippet: trainingCtx ? trainingContextToPrompt(trainingCtx) : 'TRAINING: No data available.',
  }
}

export function contextToSystemSnippet(ctx: CoachContext): string {
  const { goals, nutrition, trainingSnippet } = ctx
  const lines: string[] = []

  if (goals.length > 0) {
    lines.push('USER GOALS:')
    goals.forEach(g => {
      const date = g.targetDate ? ` (target: ${g.targetDate})` : ''
      const detail = g.detail ? ` — ${g.detail}` : ''
      lines.push(`  • [${g.type}] ${g.title}${detail}${date}`)
    })
  } else {
    lines.push('USER GOALS: None set yet.')
  }

  lines.push('')
  if (nutrition.targetsSet && nutrition.targets && nutrition.today) {
    const t = nutrition.targets
    const d = nutrition.today
    lines.push('NUTRITION TODAY:')
    lines.push(`  Targets: ${t.calories} cal | ${t.protein}g protein | ${t.carbs}g carbs | ${t.fat}g fat`)
    lines.push(`  Consumed: ${d.calories} cal | ${d.protein}g protein | ${d.carbs}g carbs | ${d.fat}g fat`)
    lines.push(`  Remaining: ${d.remaining} cal | Meals logged: ${d.mealsLogged}`)
  } else if (nutrition.targetsSet) {
    lines.push('NUTRITION: Targets set, nothing logged today.')
  } else {
    lines.push('NUTRITION: No targets set.')
  }

  lines.push('')
  lines.push(trainingSnippet)

  return lines.join('\n')
}
