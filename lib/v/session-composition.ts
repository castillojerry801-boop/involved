/**
 * Session Composition Engine
 *
 * Defines typed role templates for each session type at each experience level,
 * and generates the text block injected into PROGRAM_INTELLIGENCE_PROMPT.
 */

export interface SessionRole {
  role: string        // e.g. "primary_press"
  pattern: string     // movementPattern
  required: boolean
  rationale: string
}

type ExperienceLevel = 'beginner' | 'intermediate' | 'advanced'

type SessionTemplate = Record<ExperienceLevel, SessionRole[]>

// ─── Session templates ────────────────────────────────────────────────────────

const SESSION_TEMPLATES: Record<string, SessionTemplate> = {
  upper_push: {
    beginner: [
      { role: 'primary_press',    pattern: 'horizontal_push', required: true,  rationale: 'Primary chest and tricep stimulus' },
      { role: 'secondary_press',  pattern: 'incline_push',    required: true,  rationale: 'Upper chest angle and volume' },
      { role: 'isolation',        pattern: 'fly',             required: false, rationale: 'Stretch-biased chest work, optional for beginners' },
      { role: 'tricep_support',   pattern: 'tricep',          required: false, rationale: 'Elbow extensor work if time allows' },
    ],
    intermediate: [
      { role: 'primary_press',      pattern: 'horizontal_push',    required: true,  rationale: 'Primary chest stimulus — main strength driver' },
      { role: 'secondary_press',    pattern: 'incline_push',       required: true,  rationale: 'Upper chest angle / additional volume' },
      { role: 'isolation',          pattern: 'fly',                required: true,  rationale: 'Stretch-biased chest work, long-length loading' },
      { role: 'overhead_press',     pattern: 'vertical_push',      required: false, rationale: 'Shoulder strength; include if not trained separately' },
      { role: 'shoulder_isolation', pattern: 'shoulder_isolation', required: false, rationale: 'Lateral/rear delt volume' },
      { role: 'tricep_support',     pattern: 'tricep',             required: true,  rationale: 'Elbow extensor work' },
    ],
    advanced: [
      { role: 'primary_press',      pattern: 'horizontal_push',    required: true,  rationale: 'Primary horizontal push — strength focus' },
      { role: 'secondary_press',    pattern: 'incline_push',       required: true,  rationale: 'Upper chest angle / incline or decline variation' },
      { role: 'tertiary_press',     pattern: 'incline_push',       required: false, rationale: 'Third press angle or weighted dip for volume/variety — only if not redundant' },
      { role: 'isolation',          pattern: 'fly',                required: true,  rationale: 'Stretch-biased chest isolation, long-length loading' },
      { role: 'overhead_press',     pattern: 'vertical_push',      required: false, rationale: 'Shoulder press if not covered in a separate day' },
      { role: 'shoulder_isolation', pattern: 'shoulder_isolation', required: true,  rationale: 'Lateral/rear delt volume — often undertrained' },
      { role: 'tricep_support',     pattern: 'tricep',             required: true,  rationale: 'Elbow extensor — two exercises appropriate if volume supports it' },
    ],
  },

  upper_pull: {
    beginner: [
      { role: 'primary_pull',  pattern: 'vertical_pull',   required: true,  rationale: 'Primary lat width stimulus' },
      { role: 'row',           pattern: 'horizontal_pull', required: true,  rationale: 'Mid-back thickness and horizontal pulling' },
      { role: 'bicep',         pattern: 'bicep',           required: false, rationale: 'Elbow flexor volume, optional for beginners' },
    ],
    intermediate: [
      { role: 'primary_pull',  pattern: 'vertical_pull',   required: true,  rationale: 'Primary lat width — weighted or cable variation' },
      { role: 'secondary_pull',pattern: 'vertical_pull',   required: false, rationale: 'Second vertical pull angle if volume warrants; different grip' },
      { role: 'row',           pattern: 'horizontal_pull', required: true,  rationale: 'Mid-back thickness — barbell, dumbbell, or cable row' },
      { role: 'bicep_primary', pattern: 'bicep',           required: true,  rationale: 'Primary elbow flexor work' },
      { role: 'bicep_secondary',pattern:'bicep',           required: false, rationale: 'Second curl variation for peak/brachialis if session allows' },
    ],
    advanced: [
      { role: 'primary_pull',      pattern: 'vertical_pull',   required: true,  rationale: 'Primary lat width — weighted pull-up or cable' },
      { role: 'secondary_pull',    pattern: 'vertical_pull',   required: true,  rationale: 'Second vertical pull angle; different grip or cable' },
      { role: 'row_primary',       pattern: 'horizontal_pull', required: true,  rationale: 'Heavy mid-back thickness — barbell or heavy cable' },
      { role: 'row_secondary',     pattern: 'horizontal_pull', required: false, rationale: 'Second row for mid-back detail; different angle' },
      { role: 'shoulder_isolation',pattern: 'shoulder_isolation', required: false, rationale: 'Rear delt / face pull for shoulder health and detail' },
      { role: 'bicep_primary',     pattern: 'bicep',           required: true,  rationale: 'Primary bicep curl' },
      { role: 'bicep_secondary',   pattern: 'bicep',           required: true,  rationale: 'Second curl pattern — hammer, incline, or cable' },
    ],
  },

  upper_full: {
    beginner: [
      { role: 'horizontal_push', pattern: 'horizontal_push', required: true,  rationale: 'Chest/tricep compound' },
      { role: 'vertical_pull',   pattern: 'vertical_pull',   required: true,  rationale: 'Lat/bicep compound' },
      { role: 'horizontal_pull', pattern: 'horizontal_pull', required: true,  rationale: 'Mid-back thickness' },
      { role: 'vertical_push',   pattern: 'vertical_push',   required: false, rationale: 'Overhead press if time allows' },
    ],
    intermediate: [
      { role: 'horizontal_push',    pattern: 'horizontal_push',    required: true,  rationale: 'Primary chest compound' },
      { role: 'vertical_pull',      pattern: 'vertical_pull',      required: true,  rationale: 'Primary lat compound' },
      { role: 'horizontal_pull',    pattern: 'horizontal_pull',    required: true,  rationale: 'Mid-back row' },
      { role: 'vertical_push',      pattern: 'vertical_push',      required: true,  rationale: 'Overhead press for shoulder strength' },
      { role: 'isolation_push',     pattern: 'fly',                required: false, rationale: 'Chest isolation' },
      { role: 'arm_support',        pattern: 'bicep',              required: false, rationale: 'Arm accessory' },
    ],
    advanced: [
      { role: 'horizontal_push',    pattern: 'horizontal_push',    required: true,  rationale: 'Primary chest' },
      { role: 'incline_press',      pattern: 'incline_push',       required: true,  rationale: 'Upper chest angle' },
      { role: 'vertical_pull',      pattern: 'vertical_pull',      required: true,  rationale: 'Lat width' },
      { role: 'horizontal_pull',    pattern: 'horizontal_pull',    required: true,  rationale: 'Mid-back' },
      { role: 'vertical_push',      pattern: 'vertical_push',      required: true,  rationale: 'Overhead strength' },
      { role: 'chest_isolation',    pattern: 'fly',                required: true,  rationale: 'Long-length chest work' },
      { role: 'shoulder_isolation', pattern: 'shoulder_isolation', required: false, rationale: 'Lateral/rear delt detail' },
    ],
  },

  lower_quad: {
    beginner: [
      { role: 'primary_squat',  pattern: 'squat',  required: true,  rationale: 'Primary quad compound' },
      { role: 'unilateral',     pattern: 'lunge',  required: true,  rationale: 'Single-leg strength and balance' },
      { role: 'hinge_support',  pattern: 'hinge',  required: true,  rationale: 'Posterior chain balance' },
      { role: 'calf',           pattern: 'calf',   required: false, rationale: 'Calf work if time allows' },
    ],
    intermediate: [
      { role: 'primary_squat',  pattern: 'squat',               required: true,  rationale: 'Main quad compound' },
      { role: 'secondary_squat',pattern: 'squat',               required: false, rationale: 'Second squat variation (leg press, hack squat) for volume' },
      { role: 'unilateral',     pattern: 'lunge',               required: true,  rationale: 'Unilateral leg work — split squat, lunge' },
      { role: 'hinge',          pattern: 'hinge',               required: true,  rationale: 'RDL or hip thrust for posterior chain balance' },
      { role: 'core',           pattern: 'core_antiextension',  required: false, rationale: 'Trunk stability under load' },
      { role: 'calf',           pattern: 'calf',                required: false, rationale: 'Calf raises' },
    ],
    advanced: [
      { role: 'primary_squat',  pattern: 'squat',              required: true,  rationale: 'Main quad compound, heaviest work' },
      { role: 'secondary_squat',pattern: 'squat',              required: true,  rationale: 'Volume squat variation — leg press, hack squat' },
      { role: 'unilateral_a',   pattern: 'lunge',              required: true,  rationale: 'Bulgarian split squat or walking lunge for quad depth' },
      { role: 'hinge',          pattern: 'hinge',              required: true,  rationale: 'Posterior chain — RDL or hip thrust' },
      { role: 'quad_isolation', pattern: 'lunge',              required: false, rationale: 'Leg extension or step-up for quad isolation/pump' },
      { role: 'core',           pattern: 'core_antiextension', required: false, rationale: 'Loaded core stability' },
      { role: 'calf',           pattern: 'calf',               required: true,  rationale: 'Calf raises — two variations if volume supports' },
    ],
  },

  lower_posterior: {
    beginner: [
      { role: 'primary_hinge',  pattern: 'hinge',  required: true,  rationale: 'Hip hinge compound — deadlift or RDL' },
      { role: 'squat_support',  pattern: 'squat',  required: true,  rationale: 'Quad balance — goblet squat or leg press' },
      { role: 'unilateral',     pattern: 'lunge',  required: false, rationale: 'Single-leg work if time allows' },
    ],
    intermediate: [
      { role: 'primary_hinge',   pattern: 'hinge',              required: true,  rationale: 'Primary hip hinge — deadlift or Romanian deadlift' },
      { role: 'secondary_hinge', pattern: 'hinge',              required: true,  rationale: 'Second hinge variation — hip thrust, good morning' },
      { role: 'squat_support',   pattern: 'squat',              required: true,  rationale: 'Quad balance' },
      { role: 'unilateral',      pattern: 'lunge',              required: false, rationale: 'Unilateral posterior chain — single-leg RDL' },
      { role: 'core',            pattern: 'core_antiextension', required: false, rationale: 'Anti-extension trunk work' },
    ],
    advanced: [
      { role: 'primary_hinge',   pattern: 'hinge',              required: true,  rationale: 'Heavy deadlift variation' },
      { role: 'secondary_hinge', pattern: 'hinge',              required: true,  rationale: 'Hip thrust or RDL for glute/hamstring volume' },
      { role: 'tertiary_hinge',  pattern: 'hinge',              required: false, rationale: 'Nordic curl, leg curl, or good morning for hamstring detail' },
      { role: 'squat_support',   pattern: 'squat',              required: true,  rationale: 'Quad balance — not the focus but needed' },
      { role: 'unilateral',      pattern: 'lunge',              required: true,  rationale: 'Single-leg RDL or reverse lunge for glute/ham isolation' },
      { role: 'core',            pattern: 'core_antiextension', required: true,  rationale: 'Trunk stability — anti-extension or carry' },
    ],
  },

  lower_full: {
    beginner: [
      { role: 'squat',          pattern: 'squat',  required: true,  rationale: 'Quad-dominant compound' },
      { role: 'hinge',          pattern: 'hinge',  required: true,  rationale: 'Hip-dominant compound' },
      { role: 'unilateral',     pattern: 'lunge',  required: true,  rationale: 'Single-leg stability' },
      { role: 'core',           pattern: 'core_antiextension', required: false, rationale: 'Core stability' },
    ],
    intermediate: [
      { role: 'primary_squat',  pattern: 'squat',              required: true,  rationale: 'Knee-dominant quad compound' },
      { role: 'primary_hinge',  pattern: 'hinge',              required: true,  rationale: 'Hip-dominant posterior chain' },
      { role: 'unilateral',     pattern: 'lunge',              required: true,  rationale: 'Single-leg strength and balance' },
      { role: 'calf',           pattern: 'calf',               required: false, rationale: 'Calf work' },
      { role: 'core',           pattern: 'core_antiextension', required: false, rationale: 'Core stability' },
    ],
    advanced: [
      { role: 'primary_squat',  pattern: 'squat',              required: true,  rationale: 'Heavy squat compound' },
      { role: 'primary_hinge',  pattern: 'hinge',              required: true,  rationale: 'Heavy hinge compound' },
      { role: 'unilateral_quad',pattern: 'lunge',              required: true,  rationale: 'Unilateral quad work' },
      { role: 'unilateral_post',pattern: 'hinge',              required: false, rationale: 'Single-leg posterior chain — single-leg RDL' },
      { role: 'calf',           pattern: 'calf',               required: true,  rationale: 'Calf raises' },
      { role: 'core',           pattern: 'core_antiextension', required: true,  rationale: 'Loaded trunk work' },
    ],
  },

  full_body: {
    beginner: [
      { role: 'squat',          pattern: 'squat',           required: true,  rationale: 'Lower body compound' },
      { role: 'hinge_or_lunge', pattern: 'hinge',           required: true,  rationale: 'Posterior chain or unilateral lower' },
      { role: 'push',           pattern: 'horizontal_push', required: true,  rationale: 'Upper push compound' },
      { role: 'pull',           pattern: 'vertical_pull',   required: true,  rationale: 'Upper pull compound' },
      { role: 'core',           pattern: 'core_antiextension', required: false, rationale: 'Core stability' },
    ],
    intermediate: [
      { role: 'lower_compound_a',  pattern: 'squat',              required: true,  rationale: 'Primary lower-body compound' },
      { role: 'lower_compound_b',  pattern: 'hinge',              required: true,  rationale: 'Hip-dominant complement' },
      { role: 'upper_push',        pattern: 'horizontal_push',    required: true,  rationale: 'Primary push' },
      { role: 'upper_pull',        pattern: 'vertical_pull',      required: true,  rationale: 'Primary pull' },
      { role: 'row',               pattern: 'horizontal_pull',    required: true,  rationale: 'Horizontal pull for balance' },
      { role: 'core',              pattern: 'core_antiextension', required: false, rationale: 'Core stability' },
    ],
    advanced: [
      { role: 'lower_primary',  pattern: 'squat',              required: true,  rationale: 'Lower body strength anchor' },
      { role: 'hinge',          pattern: 'hinge',              required: true,  rationale: 'Posterior chain compound' },
      { role: 'unilateral',     pattern: 'lunge',              required: true,  rationale: 'Single-leg work' },
      { role: 'push',           pattern: 'horizontal_push',    required: true,  rationale: 'Upper push compound' },
      { role: 'vertical_pull',  pattern: 'vertical_pull',      required: true,  rationale: 'Lat pull' },
      { role: 'horizontal_pull',pattern: 'horizontal_pull',    required: true,  rationale: 'Row' },
      { role: 'core',           pattern: 'core_antiextension', required: false, rationale: 'Core stability' },
    ],
  },

  push_pull_legs_push: {
    beginner: [
      { role: 'chest_primary',  pattern: 'horizontal_push', required: true,  rationale: 'Chest compound' },
      { role: 'shoulder',       pattern: 'vertical_push',   required: true,  rationale: 'Overhead press' },
      { role: 'tricep',         pattern: 'tricep',          required: true,  rationale: 'Tricep accessory' },
    ],
    intermediate: [
      { role: 'chest_primary',      pattern: 'horizontal_push',    required: true,  rationale: 'Flat press — primary chest' },
      { role: 'chest_secondary',    pattern: 'incline_push',       required: true,  rationale: 'Incline press — upper chest' },
      { role: 'shoulder',           pattern: 'vertical_push',      required: true,  rationale: 'Overhead press' },
      { role: 'chest_isolation',    pattern: 'fly',                required: false, rationale: 'Fly for chest isolation' },
      { role: 'shoulder_isolation', pattern: 'shoulder_isolation', required: false, rationale: 'Lateral raises' },
      { role: 'tricep',             pattern: 'tricep',             required: true,  rationale: 'Tricep isolation' },
    ],
    advanced: [
      { role: 'chest_primary',      pattern: 'horizontal_push',    required: true,  rationale: 'Flat press' },
      { role: 'chest_secondary',    pattern: 'incline_push',       required: true,  rationale: 'Incline press' },
      { role: 'chest_isolation',    pattern: 'fly',                required: true,  rationale: 'Cable fly or pec deck — stretch-biased' },
      { role: 'shoulder',           pattern: 'vertical_push',      required: true,  rationale: 'Overhead press' },
      { role: 'shoulder_isolation', pattern: 'shoulder_isolation', required: true,  rationale: 'Lateral/rear delt work' },
      { role: 'tricep_a',           pattern: 'tricep',             required: true,  rationale: 'Tricep compound (e.g. close-grip bench, dip)' },
      { role: 'tricep_b',           pattern: 'tricep',             required: false, rationale: 'Tricep isolation (e.g. overhead extension, pushdown)' },
    ],
  },

  push_pull_legs_pull: {
    beginner: [
      { role: 'vertical_pull',  pattern: 'vertical_pull',   required: true,  rationale: 'Lat pull compound' },
      { role: 'row',            pattern: 'horizontal_pull', required: true,  rationale: 'Row for mid-back' },
      { role: 'bicep',          pattern: 'bicep',           required: true,  rationale: 'Bicep curl' },
    ],
    intermediate: [
      { role: 'vertical_pull',   pattern: 'vertical_pull',      required: true,  rationale: 'Pull-up or pulldown' },
      { role: 'row_primary',     pattern: 'horizontal_pull',    required: true,  rationale: 'Barbell or cable row' },
      { role: 'row_secondary',   pattern: 'horizontal_pull',    required: false, rationale: 'Second row angle if volume warrants' },
      { role: 'shoulder',        pattern: 'shoulder_isolation', required: false, rationale: 'Rear delt/face pull' },
      { role: 'bicep_primary',   pattern: 'bicep',              required: true,  rationale: 'Main bicep curl' },
      { role: 'bicep_secondary', pattern: 'bicep',              required: false, rationale: 'Second curl variation' },
    ],
    advanced: [
      { role: 'vertical_pull_a', pattern: 'vertical_pull',      required: true,  rationale: 'Weighted pull-up or cable pulldown — primary lat' },
      { role: 'vertical_pull_b', pattern: 'vertical_pull',      required: true,  rationale: 'Second vertical pull — different grip or machine' },
      { role: 'row_primary',     pattern: 'horizontal_pull',    required: true,  rationale: 'Heavy row' },
      { role: 'row_secondary',   pattern: 'horizontal_pull',    required: true,  rationale: 'Second row variation for mid-back detail' },
      { role: 'rear_delt',       pattern: 'shoulder_isolation', required: true,  rationale: 'Face pull or rear fly — shoulder health' },
      { role: 'bicep_primary',   pattern: 'bicep',              required: true,  rationale: 'Main bicep curl' },
      { role: 'bicep_secondary', pattern: 'bicep',              required: true,  rationale: 'Incline curl, hammer, or cable for bicep peak/brachialis' },
    ],
  },

  push_pull_legs_legs: {
    beginner: [
      { role: 'squat',      pattern: 'squat',  required: true,  rationale: 'Quad compound' },
      { role: 'hinge',      pattern: 'hinge',  required: true,  rationale: 'Posterior chain' },
      { role: 'unilateral', pattern: 'lunge',  required: true,  rationale: 'Single-leg work' },
    ],
    intermediate: [
      { role: 'squat',        pattern: 'squat',              required: true,  rationale: 'Quad dominant' },
      { role: 'hinge',        pattern: 'hinge',              required: true,  rationale: 'Posterior chain' },
      { role: 'unilateral',   pattern: 'lunge',              required: true,  rationale: 'Single leg' },
      { role: 'calf',         pattern: 'calf',               required: false, rationale: 'Calf raises' },
      { role: 'core',         pattern: 'core_antiextension', required: false, rationale: 'Core stability' },
    ],
    advanced: [
      { role: 'squat_primary',   pattern: 'squat',              required: true,  rationale: 'Primary squat compound' },
      { role: 'squat_secondary', pattern: 'squat',              required: true,  rationale: 'Volume squat — leg press, hack squat' },
      { role: 'hinge_primary',   pattern: 'hinge',              required: true,  rationale: 'Primary hip hinge' },
      { role: 'hinge_secondary', pattern: 'hinge',              required: false, rationale: 'Hip thrust or leg curl for glute/hamstring' },
      { role: 'unilateral',      pattern: 'lunge',              required: true,  rationale: 'Single-leg compound' },
      { role: 'calf',            pattern: 'calf',               required: true,  rationale: 'Calf raises — seated and standing' },
      { role: 'core',            pattern: 'core_antiextension', required: false, rationale: 'Core stability' },
    ],
  },

  conditioning: {
    beginner: [
      { role: 'aerobic_base', pattern: 'cardio', required: true,  rationale: 'Low-intensity aerobic work — treadmill, bike, rower' },
      { role: 'core',         pattern: 'core_antiextension', required: false, rationale: 'Light core at end' },
    ],
    intermediate: [
      { role: 'primary_cardio',  pattern: 'cardio', required: true,  rationale: 'Main conditioning modality' },
      { role: 'secondary_cardio',pattern: 'cardio', required: false, rationale: 'Second modality for variety or interval work' },
    ],
    advanced: [
      { role: 'primary_cardio',  pattern: 'cardio', required: true,  rationale: 'Primary conditioning modality' },
      { role: 'secondary_cardio',pattern: 'cardio', required: true,  rationale: 'Second conditioning modality or interval protocol' },
      { role: 'carry',           pattern: 'carry',  required: false, rationale: 'Loaded carry for functional conditioning' },
    ],
  },

  sport_specific: {
    beginner:     [],
    intermediate: [],
    advanced:     [],
    // Rules come from sport-rules.ts — this placeholder is intentional
  },
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function getSessionRoles(sessionType: string, experienceLevel: ExperienceLevel): SessionRole[] {
  const template = SESSION_TEMPLATES[sessionType]
  if (!template) return []
  return template[experienceLevel] ?? []
}

// ─── Prompt generation ────────────────────────────────────────────────────────

export function sessionCompositionPrompt(): string {
  return `
════════════════════════════════════════
SESSION COMPOSITION ENGINE
════════════════════════════════════════
A complete workout is not a random list of exercises — it is a purposeful set of movement-pattern roles filled in the right order.

STEP 1: IDENTIFY THE SESSION TYPE
Determine the session type from the day name and focus:
  upper_push / push         → chest, shoulder, tricep
  upper_pull / pull         → back, bicep
  upper_full                → full upper body
  lower_quad                → squat-dominant lower
  lower_posterior           → hinge-dominant lower
  lower_full / legs         → balanced lower body
  full_body                 → whole body
  push/pull/legs splits     → PPL structure
  conditioning              → cardio/metcon focus
  sport_specific            → see SPORT PROGRAMMING RULES below

STEP 2: BUILD ROLES BASED ON EXPERIENCE LEVEL
Session depth scales with experience level. This is not about hitting a number — it is about whether the trainee can absorb, execute, and recover from the volume.

BEGINNER (< ~1 year consistent training):
  • 3–5 roles per session is complete and appropriate
  • Focus on foundational patterns: master the movement before adding variety
  • Do NOT pad a beginner session with accessories they cannot train productively
  • Every exercise must earn its place — "more = better" is wrong for beginners
  • Effort: 2–3 RIR on all sets (never routine failure). Language: plain ("keep 2–3 reps in the tank")
  • Method default: straight sets, linear load progression
  • Avoid: supersets, drop sets, rest-pause, failure training, cluster sets, giant sets

INTERMEDIATE (~1–4 years consistent training):
  • 4–7 roles depending on session type and recovery capacity
  • Primary movements anchor the session; accessories add targeted volume
  • May include 2 exercises per major muscle group where recovery supports it
  • Effort: 1–3 RIR on most sets; final set of accessories may be harder
  • Method options: straight sets, select alternating pairs, accessory supersets
  • Sequencing: ask if they prefer supersets or separate rest

ADVANCED (4+ years consistent, periodized training history):
  • 5–9 roles where the session type and recovery capacity support it
  • Greater specialization: multiple angles, weak-point work, more isolation
  • Additional exercises must have a purpose: different angle, resistance profile, stretch-biased vs shortened position, stabilizer work, or sport transfer
  • Do NOT add exercises merely to hit a count. Each role needs a rationale.
  • Effort: periodized — can be 0–1 RIR on isolation, 1–2 RIR on compounds
  • Method options: straight sets, alternating, supersets, antagonist supersets, drop sets, rest-pause, AMRAP on final set

STEP 3: FILL EACH ROLE WITH A SEARCHED EXERCISE
For each role identified in Step 2:
  → search_exercises with the role's movementPattern
  → select an exercise appropriate for the user's equipment and level
  → record the exercise ID and intended_pattern

STEP 4: ASSIGN PROGRESSION MODELS (see EXERCISE PROGRESSION MODEL ASSIGNMENT below)

STEP 5: SET EFFORT TARGETS (RPE / RIR)
  • Set target_rir or rpe on every exercise where effort matters
  • Beginners: 2–3 RIR on all sets. No failure.
  • Intermediate: 1–2 RIR on compounds; 0–1 RIR allowed on isolations
  • Advanced: can use 0 RIR (failure) on isolation work; technical failure only on compounds

SEQUENCING RULES:
  • Power/technique movements first (olympic_power always first if present)
  • Primary compound lifts before secondary compounds
  • Larger multi-joint before smaller single-joint
  • Isolation and accessory work later
  • Conditioning typically last unless goal is conditioning

EXERCISE CONTINUITY:
  • Primary movements stay stable within a training block (4+ weeks)
  • Secondary movements generally persist at least 3–4 weeks before rotation
  • Accessories may rotate more frequently but changes need a reason
  • Do NOT randomize exercises week to week — real programs build competency with repeated exposure

════════════════════════════════════════
TRAINING METHOD GLOSSARY — PRECISE DEFINITIONS
════════════════════════════════════════
DO NOT confuse these. Each is a distinct protocol:

STRAIGHT SETS:
  Complete all prescribed sets of one exercise with full rest between sets, then move to the next exercise.
  Default method. Most appropriate for compounds and when fatigue must be managed precisely.

ALTERNATING ORDER:
  Rotate between two (or more) exercises, taking FULL REST between each individual set.
  Example: Bench Press set 1 → 90s rest → Hammer Curl set 1 → 90s rest → Bench Press set 2 → ...
  This is NOT a superset. Full recovery occurs between every set.
  Purpose: time efficiency, keeping the non-working muscle warm, reducing perceived monotony.
  Appropriate for: antagonist pairs (push + pull), or exercises that don't interfere with each other.

SUPERSET:
  Two exercises performed BACK-TO-BACK with MINIMAL or NO rest between them.
  Then rest after the PAIR is complete.
  Example: Bench Press → (immediate) → Hammer Curl → rest 90s → repeat
  Always pair with sequencing_group (same integer = paired) and sequencing_mode = "superset".
  Appropriate for: accessory/isolation work, antagonist pairs for advanced trainees, time-compressed sessions.
  NOT recommended for heavy compound movements where fatigue would compromise safety or form.

ANTAGONIST SUPERSET:
  Superset of opposing muscle groups (e.g., chest + back, bicep + tricep, quad + hamstring).
  Reduces fatigue per muscle while maintaining density.

COMPOUND SET:
  Superset of exercises targeting the SAME muscle group.
  High metabolic demand. Use selectively for hypertrophy finishers, not primary compound work.

GIANT SET:
  3 or more exercises performed back-to-back with minimal rest.
  Very high density. Use for conditioning, circuit training, or experienced trainees only.

DROP SET:
  After completing the final set at working weight, immediately reduce weight (15–25%) and continue with no rest.
  Use selectively on isolation exercises for hypertrophy. Excessive use leads to junk volume.

REST-PAUSE:
  After reaching near-failure, rest 10–15 seconds in position, then continue with additional reps.
  Allows more total reps at a given weight with maintained motor unit recruitment.

AMRAP (set_type: "amrap"):
  Do as many reps as possible on the final set. Used to auto-regulate volume and track progress.
  Do not prescribe AMRAP on heavy compound movements for beginners — injury risk.

TECHNICAL FAILURE:
  Stop the set when form begins to break down (not muscular failure).
  Always appropriate — protect the movement pattern, especially on compound lifts.

MUSCULAR FAILURE:
  The muscle physically cannot complete another rep with good form.
  Appropriate selectively for isolation work (advanced trainees). Compounds should generally not reach muscular failure.

RPE (Rate of Perceived Exertion, 1–10):
  10 = absolute maximum effort / failure
  9  = could have done 1 more rep
  8  = could have done 2 more reps (~2 RIR)
  7  = could have done 3 more reps (~3 RIR)
  6  = light, 4+ reps still available

RIR (Reps In Reserve):
  0 RIR = muscular failure
  1 RIR = could have done 1 more rep
  2 RIR = could have done 2 more reps (RPE ~8)
  3 RIR = could have done 3 more reps (RPE ~7)

════════════════════════════════════════
EXERCISE PROGRESSION MODEL ASSIGNMENT
════════════════════════════════════════
Assign a distinct progression model to each exercise based on its role.
DIFFERENT exercises in the same workout SHOULD have DIFFERENT progression models.

progression_model options and when to use them:

"linear"           → Primary compound lifts, beginners.
                     Increase load by progression_increment (e.g., 5 lb) each week when target reps achieved at target RIR.
                     Example: Bench Press — week 1: 100 lb × 4×5, week 2: 105 lb × 4×5

"double_progression" → Secondary compounds and isolation work.
                     Keep weight constant until all sets reach reps_max at target RIR. Then increase load.
                     Set progression_condition to: "increase load once all sets reach reps_max at target RIR"
                     Example: Incline Press — 3×8–12; hold at 80 lb until 12/12/12 @ 2 RIR, then 85 lb

"rep_progression"  → Accessories where load is fixed but volume grows.
                     Add 1 rep per set per week within the rep range. Increase load when reps_max × sets is exceeded.
                     Example: Cable Fly — week 1: 3×12, week 2: 3×13, week 3: 3×14, week 4: increase weight → 3×12

"set_progression"  → When sets increase over a block before load increases.
                     Example: Row — week 1: 3×10, week 2: 3×10, week 3: 4×10, week 4: increase load

"percentage_rpe"   → Main lifts for intermediate/advanced, powerlifting, and athletes.
                     Use week_progressions with load_note referencing % 1RM from LOAD ANCHORS.
                     Example: Squat — week 1: 4×5 @ 70% (284 lb), week 2: 4×4 @ 75% (304 lb)

"duration_distance" → Carries, runs, swims, bike, row.
                     Progress distance (meters), duration (seconds), or pace over weeks.

"auto"             → V chooses based on the exercise's role and user's level.
                     Use when no specific model fits better than the algorithm.

ASSIGNMENT RULES:
  Beginner main lifts            → "linear"
  Intermediate main lifts        → "linear" or "double_progression"
  Advanced main lifts            → "percentage_rpe"
  Secondary compounds            → "double_progression" or "linear"
  Isolation/accessory            → "double_progression" or "rep_progression"
  Carries / conditioning         → "duration_distance"
  Mixed modality / sport         → "auto" or "duration_distance"

IMPORTANT: At least two exercises in the same workout SHOULD use DIFFERENT progression models.
A program where EVERY exercise uses "linear" progression is a low-quality signal.
A compound using "percentage_rpe" and an isolation using "double_progression" in the same session is correct.`
}
