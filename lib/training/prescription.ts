/**
 * Shared runtime prescription resolver for multi-week programs.
 *
 * A saved program stores ONE base-week prescription (ProgramExercise + its
 * ProgramSet rows) plus optional per-week overrides (ProgramExercise.weekProgressions
 * as JSON) and phase metadata (Program.phases as JSON).
 *
 * The effective prescription for a given week is:
 *     base prescription  +  the override whose `week` matches  (present fields only)
 *
 * There is exactly ONE resolver. Every read/execution path — saved-program UI,
 * Today, upcoming, Start Workout — must resolve through here so the program page
 * and the live workout never disagree.
 *
 * Legacy safety: a program with no weekProgressions/phases (null) resolves to its
 * base prescription for every week, i.e. behaves exactly as before.
 */

// ── Persisted JSON shapes (camelCase, stored on the DB rows) ──────────────────

export interface PersistedWeekProgression {
  week: number
  sets?: number
  repsMin?: number
  repsMax?: number
  targetRir?: number
  load?: number
  durationSeconds?: number
  distance?: number
  targetRpe?: number
  deload?: boolean
  taper?: boolean
}

export interface PersistedPhase {
  name: string
  startWeek: number
  endWeek: number
}

// ── Base + resolved prescription ──────────────────────────────────────────────

export interface BasePrescription {
  sets: number
  repsMin: number | null
  repsMax: number | null
  targetRir: number | null
  load: number | null              // program's unit (kg for DB-backed sets)
  durationSeconds: number | null
  distanceM: number | null
  restSeconds: number | null
  targetRpe: number | null
}

export interface ResolvedPrescription extends BasePrescription {
  week: number
  deload: boolean
  taper: boolean
}

/** A ProgramExercise-shaped input the resolver can read (DB row or plain object). */
export interface ResolvableExercise {
  restSeconds?: number | null
  startingLoad?: number | null
  weekProgressions?: PersistedWeekProgression[] | null
  sets: Array<{
    targetRepsMin?: number | null
    targetRepsMax?: number | null
    targetRir?: number | null
    targetWeightKg?: number | string | null   // Prisma Decimal serializes as string
    targetDurationSeconds?: number | null
    targetDistanceM?: number | string | null
    restSeconds?: number | null
  }>
}

function num(v: number | string | null | undefined): number | null {
  if (v == null) return null
  const n = typeof v === 'string' ? parseFloat(v) : v
  return Number.isFinite(n) ? n : null
}

/** Derive the base-week prescription from a ProgramExercise + its ProgramSet rows. */
export function deriveBasePrescription(ex: ResolvableExercise): BasePrescription {
  const s0 = ex.sets[0]
  return {
    sets: ex.sets.length || 1,
    repsMin: s0?.targetRepsMin ?? null,
    repsMax: s0?.targetRepsMax ?? null,
    targetRir: s0?.targetRir ?? null,
    load: ex.startingLoad ?? num(s0?.targetWeightKg),
    durationSeconds: s0?.targetDurationSeconds ?? null,
    distanceM: num(s0?.targetDistanceM),
    restSeconds: ex.restSeconds ?? s0?.restSeconds ?? null,
    targetRpe: null,
  }
}

/**
 * Apply the week override (if any) onto a base prescription. Only fields present
 * on the override change; everything else falls through from base. Weeks with no
 * matching override resolve to base (that is the intended "store only diffs" model).
 */
export function resolvePrescriptionForWeek(
  base: BasePrescription,
  weekProgressions: PersistedWeekProgression[] | null | undefined,
  week: number,
): ResolvedPrescription {
  const o = weekProgressions?.find(w => w.week === week)
  const resolved: ResolvedPrescription = { ...base, week, deload: false, taper: false }
  if (!o) return resolved

  if (o.sets != null) resolved.sets = o.sets
  if (o.repsMin != null) resolved.repsMin = o.repsMin
  if (o.repsMax != null) resolved.repsMax = o.repsMax
  if (o.targetRir != null) resolved.targetRir = o.targetRir
  if (o.load != null) resolved.load = o.load
  if (o.durationSeconds != null) resolved.durationSeconds = o.durationSeconds
  if (o.distance != null) resolved.distanceM = o.distance
  if (o.targetRpe != null) resolved.targetRpe = o.targetRpe
  resolved.deload = o.deload === true
  resolved.taper = o.taper === true
  return resolved
}

/** The single shared entry point: resolve a ProgramExercise for a given week. */
export function resolveExercisePrescriptionForWeek(
  ex: ResolvableExercise,
  week: number,
): ResolvedPrescription {
  return resolvePrescriptionForWeek(deriveBasePrescription(ex), ex.weekProgressions ?? null, week)
}

// ── Set expansion (used by workout creation) ──────────────────────────────────

export interface ResolvedSetSpec {
  setNumber: number
  setType: 'working'
  targetRepsMin: number | null
  targetRepsMax: number | null
  targetRir: number | null
  targetWeightKg: number | null
  targetDurationSeconds: number | null
  targetDistanceM: number | null
  restSeconds: number | null
}

/**
 * Expand a resolved prescription into concrete per-set specs. The set COUNT comes
 * from the resolved week (so a deload week with sets:2 creates two sets, a build
 * week with sets:4 creates four) — never the stored base count.
 */
export function buildResolvedSetSpecs(resolved: ResolvedPrescription): ResolvedSetSpec[] {
  const count = Math.max(1, Math.round(resolved.sets))
  return Array.from({ length: count }, (_, i) => ({
    setNumber: i + 1,
    setType: 'working' as const,
    targetRepsMin: resolved.repsMin,
    targetRepsMax: resolved.repsMax,
    targetRir: resolved.targetRir,
    targetWeightKg: resolved.load,
    targetDurationSeconds: resolved.durationSeconds,
    targetDistanceM: resolved.distanceM,
    restSeconds: resolved.restSeconds,
  }))
}

// ── Phase helpers ─────────────────────────────────────────────────────────────

/** Which phase covers this week, if any. */
export function phaseForWeek(phases: PersistedPhase[] | null | undefined, week: number): PersistedPhase | null {
  if (!phases?.length) return null
  return phases.find(p => week >= p.startWeek && week <= p.endWeek) ?? null
}

/** A concise label for the week ("Deload", "Taper", or the phase name). */
export function weekLabel(
  phases: PersistedPhase[] | null | undefined,
  resolvedExamples: ResolvedPrescription[],
  week: number,
): string | null {
  if (resolvedExamples.some(r => r.taper)) return 'Taper'
  if (resolvedExamples.some(r => r.deload)) return 'Deload'
  return phaseForWeek(phases, week)?.name ?? null
}
