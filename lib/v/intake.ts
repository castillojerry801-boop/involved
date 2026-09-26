import 'server-only'
import type { VTrainingContext } from './training-context'

export interface IntakeGapAssessment {
  hasEnough: boolean
  missingHighValue: string[]
  optional: string[]
}

function isRunningOrOCRSport(sport: string): boolean {
  const s = sport.toLowerCase()
  return /run|marathon|half.?marathon|ocr|spartan|obstacle|triathlon|5k|10k/.test(s)
}

function isPowerliftingSport(sport: string): boolean {
  return /powerlifting|powerlifter/.test(sport.toLowerCase())
}

function hasSqBeDlPr(prs: VTrainingContext['personalRecords']): boolean {
  return prs.some(pr => {
    const n = pr.exerciseName.toLowerCase()
    return /\bsquat\b/.test(n) || /bench\s*press/.test(n) || /\bdeadlift\b/.test(n)
  })
}

function hasRecentMileageSignal(ctx: VTrainingContext): boolean {
  // Look for running-related goals or PRs
  const runningGoal = ctx.profile.goals.some(g =>
    /run|mile|marathon|5k|10k|km|distance/i.test(g.title)
  )
  const runningPr = ctx.personalRecords.some(pr =>
    /run|mile|marathon|5k|10k|km|distance/i.test(pr.exerciseName)
  )
  return runningGoal || runningPr
}

// Readiness signals the user may state in conversation before the DB is updated.
// Returns a non-null state when readiness is known — sufficient to bypass the
// 8-week program gate even if the DB profile hasn't been updated yet.
// Scan only user messages (not assistant text) to avoid false positives.
export function extractReadinessFromConversation(text: string): string | null {
  if (/\breturning\b|\bback after a break\b|\bgetting back\b|\bcoming back\b/i.test(text)) return 'returning'
  if (/\bfirst time\b|\bnever trained\b|\bnever\s+(?:worked out|trained|lifted)\b|\bjust starting\b/i.test(text)) return 'never_trained'
  if (/\bstill training\b|\bcurrently training\b|\btraining consistently\b/i.test(text)) return 'active'
  return null
}

export function assessIntakeGaps(
  ctx: VTrainingContext,
  request: {
    weeks?: number
    days?: number
    sport?: string
    focus?: string
    injuries?: string
  }
): IntakeGapAssessment {
  const missingHighValue: string[] = []
  const optional: string[] = []

  // 1. Readiness state — derived from ctx.readinessState (set by caller)
  const readinessKnown = ctx.readinessState !== null && ctx.readinessState !== undefined
  const isLongProgram = (request.weeks ?? 0) >= 8
  if (!readinessKnown) {
    missingHighValue.push('How long have you been training consistently, if at all?')
  } else if (isLongProgram && ctx.readinessState === 'never_trained') {
    // For 8+ week programs, a never-trained user needs more context than just "never trained"
    missingHighValue.push('Have you trained with weights before, or will this be your first structured program?')
  }

  // 2. Equipment
  const equipmentKnown =
    ctx.equipment !== null ||
    (request.focus ?? '').toLowerCase().includes('home') ||
    (request.focus ?? '').toLowerCase().includes('bodyweight') ||
    (request.injuries ?? '').toLowerCase().includes('no gym')
  if (!equipmentKnown) {
    missingHighValue.push('Do you have access to a gym, or are you training at home?')
  }

  // 3. Training days
  const trainingDaysKnown =
    (request.days != null && request.days > 0) ||
    (ctx.profile.weeklyWorkoutTarget != null && ctx.profile.weeklyWorkoutTarget > 0)
  if (!trainingDaysKnown) {
    missingHighValue.push('How many days per week can you train?')
  }

  // 4. For long programs: need fitness-level signal
  if (isLongProgram && !ctx.profile.fitnessLevel) {
    missingHighValue.push('How would you describe your current fitness level?')
  }

  // 5. Running / OCR sport: need current mileage context
  if (request.sport && isRunningOrOCRSport(request.sport) && !hasRecentMileageSignal(ctx)) {
    missingHighValue.push('Are you currently running at all, and roughly how far per week?')
  }

  // 6. Powerlifting: need working weights
  if (request.sport && isPowerliftingSport(request.sport) && !hasSqBeDlPr(ctx.personalRecords)) {
    missingHighValue.push('Do you know your current working weights or approximate maxes for squat, bench, and deadlift?')
  }

  // Optional
  optional.push(
    'Do you have any recurring pain, injuries, or movement restrictions?',
    'How long do you typically have for each training session?',
    'Do you prefer a consistent routine or some variety week to week?',
  )

  const hasEnough = missingHighValue.length === 0

  return { hasEnough, missingHighValue, optional }
}
