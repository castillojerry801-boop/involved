import 'server-only'
import { extractEquipmentFromConversation } from './equipment-normalize'
import type { VTrainingContext, ReadinessState } from './training-context'

/**
 * Structured program-intake state.
 *
 * This is the single source of truth for what the coach knows about a program
 * request. It is DERIVED FRESH each turn from the full conversation (which the
 * client resends whole) merged with the persisted DB training context. There is
 * no separate mutable store to fall out of sync — the conversation IS the store.
 */
export interface ProgramIntakeState {
  readinessState: ReadinessState | null
  readinessSource: 'conversation' | 'profile' | null
  trainingDaysPerWeek: number | null
  trainingDaysSource: 'conversation' | 'profile' | null
  trainingLocation: 'home' | 'gym' | null
  primaryGoal: string | null
  primaryGoalSource: 'conversation' | 'profile' | null
  secondaryGoals: string[]
  /** Canonical equipment list. null = not yet resolved. Empty-but-resolved is impossible; "body weight" always present once resolved. */
  equipmentProfile: string[] | null
  weeks: number | null
}

export type IntakeField =
  | 'readiness'
  | 'equipment'
  | 'trainingDays'
  | 'goal'

export interface MissingContextItem {
  field: IntakeField
  question: string
}

// ─── Word-number map for natural replies ("four days") ────────────────────────

const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
}

// ─── Field extractors ─────────────────────────────────────────────────────────

/**
 * Readiness from natural replies. Maps colloquial phrases to the canonical
 * ReadinessState enum so downstream (quality validator, gate) sees one vocabulary.
 * Returns null when no confident signal is present.
 */
export function extractReadiness(text: string): ReadinessState | null {
  const t = text.toLowerCase()
  // First-timer signals take priority — "never" is unambiguous.
  if (/\bnever\s+(?:trained|worked out|lifted|exercised)\b|\bfirst[\s-]?time\b|\bbrand new\b|\bnever done\b/.test(t)) {
    return 'never_trained'
  }
  // Returning / detrained — only STRONG signals of a prior training history + gap.
  // Deliberately excludes vague phrases like "get back in shape", which a
  // never-trained person also uses — those must be asked, not assumed.
  if (/\breturning\b|\bcoming back\b|\bback (?:after|into training|to (?:lifting|training|the gym))\b|\bafter a (?:long )?break\b|\btime off\b|\bhaven'?t trained\b|\bused to (?:train|lift|work ?out)\b|\bgot out of (?:shape|the habit|training)\b/.test(t)) {
    return 'detrained'
  }
  // Currently training / active
  if (/\bcurrently training\b|\bstill training\b|\btraining consistently\b|\btrain regularly\b|\bactively (?:training|lifting)\b|\bi (?:train|lift) \d/.test(t)) {
    return 'recreationally_active'
  }
  return null
}

/**
 * STRONG training-days signal — self-describing, safe to read from anywhere in the
 * conversation because a unit word ("days", "x", "sessions", "per week") disambiguates
 * it. "4 days", "4x/week", "four days a week", "train 4 days".
 */
export function extractTrainingDaysStrong(text: string): number | null {
  const t = text.toLowerCase()

  const digit = t.match(/\b([1-7])\s*(?:x|days?|times?|sessions?|d\/?w|\/\s*week|per week|day\/week)\b/)
  if (digit) return parseInt(digit[1], 10)

  const word = t.match(/\b(one|two|three|four|five|six|seven)\s*(?:x|days?|times?|sessions?)\b/)
  if (word) return WORD_NUMBERS[word[1]]

  const verb = t.match(/\b(?:train|training|lift|workout|work out)\s+([1-7])\b/)
  if (verb) return parseInt(verb[1], 10)

  return null
}

/**
 * BARE training-days answer — a lone number or number-word with no unit ("4",
 * "four"). This is ambiguous on its own, so callers MUST only apply it when the
 * immediately preceding assistant turn asked for training availability (active
 * field = trainingDays). Applied to a single message, never to joined text.
 */
export function extractTrainingDaysBare(text: string): number | null {
  const t = text.trim().toLowerCase()
  const digit = t.match(/^([1-7])\b/)
  if (digit) return parseInt(digit[1], 10)
  const word = t.match(/^(one|two|three|four|five|six|seven)\b/)
  if (word) return WORD_NUMBERS[word[1]]
  return null
}

/**
 * Permissive single-message extractor (strong OR bare). Convenience for callers
 * that already know the message is a days answer. parseProgramIntake does NOT use
 * this directly — it uses the strong/bare split with active-field context so a
 * stray number in unrelated chat cannot mutate trainingDaysPerWeek.
 */
export function extractTrainingDays(text: string): number | null {
  return extractTrainingDaysStrong(text) ?? extractTrainingDaysBare(text)
}

/**
 * Classify what the assistant's last message was asking for. Used to make bare
 * answers context-aware: a lone "4" only sets trainingDaysPerWeek when the prior
 * assistant turn was the training-availability question.
 */
export function detectActiveField(assistantText: string): IntakeField | null {
  const t = assistantText.toLowerCase()
  if (/how many days|days per week|days can you|days.*(?:train|week)|training availability|how many.*sessions/.test(t)) return 'trainingDays'
  if (/currently training|returning after|first time training|training background|how long have you been training|are you (?:currently )?training/.test(t)) return 'readiness'
  if (/what equipment|equipment.*available|equipment do you have|equipment.*at home/.test(t)) return 'equipment'
  if (/main focus|main goal|primary goal|build muscle.*lose fat|what.*your goal/.test(t)) return 'goal'
  return null
}

/**
 * Resolve training days from the whole conversation, message by message, with
 * active-field context. Returns the most recent confidently-extracted value, or
 * null. This is the authoritative extractor used by parseProgramIntake — never
 * scan joined text for the bare answer, or a stray number elsewhere in the
 * transcript (or an unanchored match) will be lost or misread.
 */
export function extractConversationDays(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
): number | null {
  let days: number | null = null
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    if (m.role !== 'user') continue

    // Strong, self-describing signal — read from any user message.
    const strong = extractTrainingDaysStrong(m.content)
    if (strong != null) { days = strong; continue }

    // Bare answer — only when the previous assistant turn asked for availability.
    const prev = i > 0 ? messages[i - 1] : null
    const activeField = prev && prev.role === 'assistant' ? detectActiveField(prev.content) : null
    if (activeField === 'trainingDays') {
      const bare = extractTrainingDaysBare(m.content)
      if (bare != null) days = bare
    }
  }
  return days
}

/**
 * Location from natural replies. Returns 'gym', 'home', or null.
 * "gym" resolves equipment (full access); "home" requires an explicit list.
 */
export function extractLocation(text: string): 'home' | 'gym' | null {
  const t = text.toLowerCase()
  if (/\b(?:at |from )?home\b|home gym|garage gym|my (?:house|garage|apartment|place)|no gym/.test(t)) {
    return 'home'
  }
  if (/\bcommercial gym\b|\bfull gym\b|\bthe gym\b|\bat (?:the |a |my )?gym\b|\bgym access\b|\bglobo gym\b|\bplanet fitness\b|\blocal gym\b|\bi (?:go to|have) (?:a |the )?gym\b/.test(t)) {
    return 'gym'
  }
  return null
}

/**
 * Goals from natural replies. Returns an ordered list; first is primary.
 * "4 days I want to build muscle and lose fat" → ['muscle_gain', 'fat_loss']
 */
export function extractGoals(text: string): string[] {
  const t = text.toLowerCase()
  const goals: string[] = []
  const add = (g: string) => { if (!goals.includes(g)) goals.push(g) }

  // Order the scan so the first-appearing goal in the text becomes primary.
  const matchers: Array<{ goal: string; re: RegExp }> = [
    { goal: 'muscle_gain', re: /build (?:some )?muscle|gain muscle|muscle|hypertrophy|get (?:big|bigger|jacked|swole)|put on (?:size|mass)|\bmass\b|tone up|get toned/ },
    { goal: 'fat_loss',    re: /lose (?:some )?(?:fat|weight)|fat loss|weight loss|cut(?:ting)?\b|lean(?:er)? out|get lean|slim down|drop (?:weight|pounds|lbs)|shred/ },
    { goal: 'strength',    re: /get stronger|build strength|\bstrength\b|\bstronger\b|powerlifting|increase my (?:squat|bench|deadlift|lifts)|hit a (?:pr|1rm)/ },
    { goal: 'endurance',   re: /endurance|conditioning|stamina|cardio fitness|aerobic|run (?:a|longer|farther)/ },
    { goal: 'general_fitness', re: /get (?:back )?in shape|overall fitness|general fitness|be healthier|feel better|get fit/ },
  ]

  // Find each goal's first index in the text, then sort by appearance — but
  // 'general_fitness' is a vague catch-all ("get in shape") and must never
  // outrank a specific training goal, so it is always demoted to last.
  const found = matchers
    .map(m => ({ goal: m.goal, idx: t.search(m.re) }))
    .filter(m => m.idx >= 0)
    .sort((a, b) => {
      const aGen = a.goal === 'general_fitness'
      const bGen = b.goal === 'general_fitness'
      if (aGen !== bGen) return aGen ? 1 : -1
      return a.idx - b.idx
    })

  for (const f of found) add(f.goal)
  return goals
}

/** Program length in weeks from "12-week", "12 week", "8 weeks". */
export function extractWeeks(text: string): number | null {
  const m = text.toLowerCase().match(/\b(\d{1,2})[\s-]*week/)
  if (m) {
    const n = parseInt(m[1], 10)
    if (n >= 1 && n <= 52) return n
  }
  return null
}

// ─── Aggregate parser ─────────────────────────────────────────────────────────

/**
 * Parse the full conversation into structured intake state, merged with the
 * persisted DB context. Conversation-stated values take priority over the DB
 * (the DB is only updated by explicit profile edits — chat answers are never
 * written back, so the conversation is the more current signal).
 *
 * Scans USER messages only for the natural-language fields to avoid matching
 * the coach's own question text back as an answer.
 */
export function parseProgramIntake(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  dbCtx?: VTrainingContext | null,
): ProgramIntakeState {
  const userText = messages.filter(m => m.role === 'user').map(m => m.content).join('\n')
  const fullText = messages.map(m => m.content).join('\n')

  // Readiness — conversation first, then DB but ONLY when the stored value reflects
  // CURRENT, explicit signal. deriveReadinessState() always returns a value (it
  // defaults to 'never_trained' when there's no data), so a non-null DB readiness is
  // NOT itself proof the training status is known. Training status is time-sensitive
  // and materially changes an 8+ week program, so we only reuse it when the user has
  // recently logged training; otherwise we treat it as unknown and confirm.
  const convReadiness = extractReadiness(userText)
  const dbReadinessIsCurrent = !!dbCtx && dbCtx.recentTraining.length > 0 && dbCtx.readinessState != null
  const readinessState = convReadiness ?? (dbReadinessIsCurrent ? dbCtx!.readinessState : null)
  const readinessSource: ProgramIntakeState['readinessSource'] =
    convReadiness ? 'conversation' : (dbReadinessIsCurrent ? 'profile' : null)

  // Training days — CONTEXT-AWARE per-message extraction (the fix for the loop).
  // Strong signals ("4 days", "4x/week") are read from any user message. A bare
  // answer ("4", "four") is only accepted when the immediately preceding assistant
  // turn asked for training availability — so a stray number elsewhere in the
  // conversation cannot silently mutate the field.
  const convDays = extractConversationDays(messages)
  const trainingDaysPerWeek = convDays ?? dbCtx?.profile.weeklyWorkoutTarget ?? null
  const trainingDaysSource: ProgramIntakeState['trainingDaysSource'] =
    convDays != null ? 'conversation' : (dbCtx?.profile.weeklyWorkoutTarget != null ? 'profile' : null)

  // Location.
  const trainingLocation = extractLocation(userText)

  // Goals — conversation first; fall back to DB goals (mapped loosely).
  const convGoals = extractGoals(userText)
  const goals = convGoals.length > 0 ? convGoals : mapDbGoals(dbCtx)
  const primaryGoal = goals[0] ?? null
  const primaryGoalSource: ProgramIntakeState['primaryGoalSource'] =
    convGoals.length > 0 ? 'conversation' : (goals.length > 0 ? 'profile' : null)
  const secondaryGoals = goals.slice(1)

  // Equipment — conversation (canonical) first, then DB, then location inference.
  const convEquipment = extractEquipmentFromConversation(fullText)
  let equipmentProfile: string[] | null
  if (convEquipment && convEquipment.length > 0) {
    equipmentProfile = convEquipment
  } else if (dbCtx?.equipment?.items?.length) {
    equipmentProfile = dbCtx.equipment.items
  } else if (trainingLocation === 'gym') {
    // Gym stated → full access. Represent as null downstream (no restriction),
    // but mark as resolved via a sentinel non-empty list is wrong; use the flag
    // in isEquipmentResolved() instead. Keep equipmentProfile null here.
    equipmentProfile = null
  } else {
    equipmentProfile = null
  }

  const weeks = extractWeeks(fullText)

  return {
    readinessState,
    readinessSource,
    trainingDaysPerWeek,
    trainingDaysSource,
    trainingLocation,
    primaryGoal,
    primaryGoalSource,
    secondaryGoals,
    equipmentProfile,
    weeks,
  }
}

function mapDbGoals(dbCtx?: VTrainingContext | null): string[] {
  if (!dbCtx?.profile.goals?.length) return []
  const goals: string[] = []
  for (const g of dbCtx.profile.goals) {
    const parsed = extractGoals(g.title + ' ' + g.type)
    for (const p of parsed) if (!goals.includes(p)) goals.push(p)
  }
  return goals
}

// ─── Resolution + missing-field check ─────────────────────────────────────────

/**
 * Equipment is resolved when either explicit equipment was stated, the DB has an
 * equipment profile, or the user said they train at a gym (full access).
 */
export function isEquipmentResolved(
  state: ProgramIntakeState,
  dbCtx?: VTrainingContext | null,
): boolean {
  if (state.equipmentProfile && state.equipmentProfile.length > 0) return true
  if (dbCtx?.equipment?.items?.length) return true
  if (state.trainingLocation === 'gym') return true
  return false
}

/**
 * Deterministic check: which required program-intake fields are still missing.
 * Each turn asks ONLY for what is not yet confidently resolved. A field is never
 * re-asked once resolved unless the user later contradicts it (which produces a
 * new extraction that overwrites the old value on the next parse).
 *
 * Readiness is only required for programs of significant length (≥ 8 weeks),
 * matching the existing generation gate.
 */
export function missingProgramContext(
  state: ProgramIntakeState,
  dbCtx?: VTrainingContext | null,
): MissingContextItem[] {
  const missing: MissingContextItem[] = []
  const requiresReadiness = (state.weeks ?? 0) >= 8

  if (requiresReadiness && state.readinessState === null) {
    missing.push({
      field: 'readiness',
      question: 'Are you currently training, returning after a break, or is this your first time training consistently?',
    })
  }

  if (!isEquipmentResolved(state, dbCtx)) {
    missing.push({
      field: 'equipment',
      question: 'What equipment do you have available? For example: dumbbells, barbell, kettlebells, bench, pull-up bar, resistance bands, cable machine, or bodyweight only.',
    })
  }

  // Training days must be confirmed for THIS program. A general profile
  // weeklyWorkoutTarget is program-agnostic and must not silently satisfy the
  // requirement — otherwise generation begins on a day-count the user never
  // chose for this program (the exact bug that produced garbage + a retry loop).
  if (state.trainingDaysSource !== 'conversation') {
    missing.push({
      field: 'trainingDays',
      question: 'How many days per week can you train?',
    })
  }

  if (state.primaryGoal === null) {
    missing.push({
      field: 'goal',
      question: "What's your main focus: build muscle, get stronger, lose fat, or a combination?",
    })
  }

  return missing
}

/**
 * Compose a single user-facing message asking only for the missing fields.
 * Returns null when nothing is missing (caller must not emit a re-ask).
 */
export function buildMissingContextPrompt(missing: MissingContextItem[]): string | null {
  if (missing.length === 0) return null
  if (missing.length === 1) return missing[0].question
  // Ask the first missing field only, to keep the exchange tight and avoid a wall
  // of questions. Subsequent turns resolve the rest one at a time.
  return missing[0].question
}
