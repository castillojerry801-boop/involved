import 'server-only'

/**
 * Shared program-design intelligence injected into every V endpoint that
 * generates training programs or workouts. Single source of truth for
 * movement-pattern knowledge, classification rules, and the review pass.
 *
 * Import this constant rather than duplicating prompt text across routes.
 */
export const PROGRAM_INTELLIGENCE_PROMPT = `
════════════════════════════════════════
CONVENTIONAL EXERCISE PREFERENCE
════════════════════════════════════════
Unless the user's preferences, equipment, or explicit goals direct otherwise, default to well-established conventional exercises (e.g., barbell squat, Romanian deadlift, bench press, overhead press, weighted pull-up, barbell row). These movements have the broadest evidence base and serve most athletes well. The Involved curated exercise layer will add deeper personalization in a future release.

════════════════════════════════════════
PROGRAM DESIGN — DESIGN FIRST, SEARCH SECOND
════════════════════════════════════════
CRITICAL: The exercise database is a toolbox. It does NOT determine program structure.
ExerciseDB bodyPart and target fields are raw metadata — they are NOT programming intelligence.
The Involved classification layer (movementPattern, movementFamily, exerciseRole) is what you use.

Your programming pipeline:

  USER GOAL
  → Training requirements (volume, frequency, intensity, recovery, duration)
  → Weekly structure and session purposes
  → Phases / periodization if appropriate
  → Per session: list every movement pattern role you need to fill (e.g., "Day 1 needs: squat, hinge, vertical_pull, horizontal_pull, core_antiextension")
  → For EACH role: call search_exercises with movementPattern filter to get candidates
  → Select exercises from candidates whose movementPattern matches the role
  → Sets / reps / intensity / rest
  → Progression strategy
  → Program Review Pass
  → propose_program (with intended_pattern = role pattern for every exercise)

DO NOT search exercises first and assemble days from results.
PLAN the roles first. THEN search with movementPattern filter to fill each role.

════════════════════════════════════════
MOVEMENT PATTERNS — SEARCH AND REASON WITH THESE
════════════════════════════════════════
Every search result includes movementPattern, movementFamily, exerciseRole, and laterality from the Involved classification layer.

Use movementPattern filter when searching for a specific training role.
Check movementFamily to detect redundancy across exercise variations.

LOWER BODY:
  squat              knee-dominant (back squat, front squat, leg press, goblet squat)
  hinge              hip-dominant posterior chain (deadlift, RDL, hip thrust, good morning)
  lunge              unilateral lower (lunge, split squat, step-up, Bulgarian split squat, pistol)
  calf               calf raises and variants

UPPER PUSH:
  horizontal_push    flat bench press variants
  incline_push       incline / decline press
  fly                chest isolation (flye, crossover, pec deck)
  vertical_push      overhead press variants
  shoulder_isolation lateral raise, front raise, face pull, rear delt work

UPPER PULL:
  vertical_pull      pull-ups, lat pulldowns
  horizontal_pull    rows of all kinds

ARMS / ACCESSORY:
  bicep              curls and variants
  tricep             extensions, pushdowns, skull crushers
  forearm            wrist / forearm work

CORE:
  core_antiextension plank, ab wheel, dead bug, bird-dog, Pallof press
  core_flexion       crunch, sit-up
  core_rotation      Russian twist, woodchop
  core_lateral       side bend, lateral flexion

OTHER:
  carry              farmer carry, suitcase carry
  cardio             conditioning modalities
  olympic_power      clean, snatch, jerk, thruster, power clean — COMPLEX multi-pattern movements;
                     do not substitute a clean for a squat or a press; treat as its own role

════════════════════════════════════════
EXERCISE CLASSIFICATION — HOW TO READ SEARCH RESULTS
════════════════════════════════════════
Each search result has these Involved classification fields:

movementPattern:      The primary training role (use this for role-based planning)
secondaryMovementPatterns: Patterns this exercise meaningfully trains (e.g., dip = [incline_push, tricep])
movementFamily:       The movement variation family for redundancy detection (see below)
exerciseRole:         primary_compound, secondary_compound, accessory, isolation, power, conditioning, mobility
laterality:           bilateral, unilateral, alternating, unknown
classificationConfidence: high, medium, needs_review

IMPORTANT:
• If classificationConfidence = "needs_review", treat that exercise with caution.
  Do not place it in a slot where the movementPattern must be certain.
• If an exercise has secondaryMovementPatterns, you may use it to fill either its primary or a secondary role — but declare the role you are filling in intended_pattern.
• olympic_power exercises (clean, snatch, jerk, thruster) are complex multi-pattern lifts.
  They are NOT substitutes for a normal squat or a normal press. If you include one, give it its own role slot.

════════════════════════════════════════
REDUNDANCY CONTROL — MOVEMENT FAMILY
════════════════════════════════════════
Two exercises with the same movementFamily fill the same programming role regardless of equipment.

Examples of redundant movementFamily groupings:
  front_squat:  barbell front squat, dumbbell front squat, goblet squat (front-loaded squat variations)
  lat_pulldown: wide-grip pulldown, close-grip pulldown, neutral-grip pulldown, cable pulldown
  row:          barbell row, dumbbell row, cable row, seated row (all horizontal pulling)
  curl:         barbell curl, dumbbell curl, EZ-bar curl
  bench_press:  barbell bench press, dumbbell bench press, machine chest press

Rule: Never select two exercises with the same movementFamily in the same session unless specialization explicitly requires it with a stated reason.

Broader redundancy rule: Never select two exercises with the same movementPattern in one session without a clear training reason.

BAD: Barbell Front Squat (squat, front_squat) + Goblet Squat (squat, goblet_squat) — two quad-dominant squat variations
BAD: Wide-grip pulldown (vertical_pull, lat_pulldown) + Close-grip pulldown (vertical_pull, lat_pulldown)
GOOD: Squat (squat) + Romanian Deadlift (hinge) + Split Squat (lunge) + Calf Raise (calf) — four distinct roles

════════════════════════════════════════
SESSION COMPLETENESS — CHECK BEFORE PROPOSING
════════════════════════════════════════
For every session you design, verify:
1. What is this session's purpose?
2. Does each exercise serve a distinct movement-pattern role?
3. Are major required patterns represented for this session type?
4. Are exercises unnecessarily redundant (same pattern or same movementFamily twice)?
5. Is exercise order logical? (compounds first, isolation last; technique before fatigue)
6. Is volume appropriate for the user's experience level?
7. Is rep range / intensity aligned with the goal?
8. Does it fit the requested duration?
9. Does it fit available equipment?
10. Does it complement other sessions this week?
11. Does it create obvious recovery conflicts with surrounding days?

════════════════════════════════════════
intended_pattern — REQUIRED FOR EVERY EXERCISE
════════════════════════════════════════
When calling propose_workout or propose_program, every exercise must include:

  intended_pattern: "<movementPattern>"  // the role this exercise fills in this session

The server validates this against the Involved classification. If intended_pattern does not match
the exercise's movementPattern (or secondaryMovementPatterns), the server rejects the exercise and you must revise.

This is a hard check — it prevents wrong exercises from entering programs regardless of exercise name.

If intended_pattern is rejected:
• Do NOT simply change intended_pattern to make it pass.
• SEARCH for a different exercise with the correct movementPattern for that role.
• The exercise you selected was wrong for the role — find one that actually fits.

════════════════════════════════════════
EXERCISE ORDER
════════════════════════════════════════
General principles:
• Power / technique movements before fatigue (olympic_power always first)
• Primary compound lifts before accessories
• Larger multi-joint before smaller single-joint
• Isolation and accessory work later in the session
• Conditioning typically last (unless goal is conditioning)

Adjust based on the user's specific goal and constraints.

════════════════════════════════════════
EXPERIENCE LEVEL — DRIVES PROGRAMMING DECISIONS
════════════════════════════════════════
Do NOT treat experience level as a label — use it to make programming decisions.

BEGINNER:
• 4–6 exercises per session is often enough
• Repeated exposure to foundational patterns builds motor skill through frequency
• Simple, linear progression (same movements, add load or reps)
• Moderate volume — avoid excessive fatigue
• No advanced techniques, minimal exercise variation
• A beginner must NOT receive an advanced bodybuilding program

INTERMEDIATE:
• More volume and targeted accessory work where it serves the goal
• Deliberate weekly loading structure
• Planned multi-week progression
• Greater goal specialization

ADVANCED:
• Programming becomes MORE individualized, not just harder or more complex
• Consider actual training history, tolerance, movement strengths/weaknesses
• May include periodization, RPE/RIR, specialization blocks, fatigue management
• Advanced ≠ more exercises, shorter rest, training to failure every set
• Minimum complexity to accomplish the goal — more complexity must earn its place

If experience is unknown and it materially affects the program, ask before generating.
If stated experience and training history are inconsistent, use the data conservatively and note the discrepancy — do not silently override the user.

════════════════════════════════════════
EQUIPMENT
════════════════════════════════════════
If the user has an active equipment profile, you must use it.
Search with the equipment filter. Do not select exercises requiring equipment outside the profile.
If no equipment profile exists, assume full gym access.

════════════════════════════════════════
CARDIO AND CONDITIONING
════════════════════════════════════════
Program modalities, not just exercises:
  Air Bike — 30 min — Zone 2 / conversational pace
  Rower — 6 rounds: 2 min hard / 2 min easy
  Treadmill — 30 min — Zone 2
  Farmer Carry — 4 × 100 ft
  Sprint — 6 × 20 sec, full recovery

Use heart-rate zones ONLY when actual HR data exists.
Never fabricate a personalized heart-rate range.
If HR data is unavailable, use effort descriptions (e.g., "conversational pace", "RPE 7/10").

════════════════════════════════════════
LONG-TERM PROGRAMS
════════════════════════════════════════
A multi-month program cannot be one week repeated indefinitely.

For programs spanning multiple weeks or months:
• Use the program description to document the periodization structure — phases, goals per phase, duration of each phase, and progression model
• The days represent Week 1 of the program
• Use exercise notes to describe week-over-week progression (e.g., "Add 5 lb/week", "Progress from 3×12 to 4×8 over 4 weeks")
• Name and describe phases clearly (e.g., "Phase 1 — Foundation (Weeks 1–4): Higher reps, technique focus. Phase 2 — Strength (Weeks 5–10): Progressive load increase...")

Progression can work through: load, reps, sets, volume, density, intensity, distance, pace, exercise progression — use whatever fits the goal.

════════════════════════════════════════
PROGRAM REVIEW PASS — REQUIRED BEFORE propose_program
════════════════════════════════════════
Before calling propose_program, run this check:

□ Every exercise has intended_pattern set — no exercise is missing it
□ No day has two exercises with the same movementPattern without an explicit stated reason
□ No day has two exercises with the same movementFamily (that would be flagrantly redundant)
□ Each session's major required patterns are represented for its stated purpose
□ Exercise order within each day is logical (power → compound → accessory → isolation)
□ Volume per session matches user experience level
□ Adjacent days don't create problematic recovery conflicts (e.g., heavy legs two days in a row)
□ All exercises are compatible with available equipment
□ Progression is defined — not "do the same thing every week"
□ Program complexity and exercise selection are appropriate for this user's experience level
□ No exercise IDs are invented — all from search_exercises
□ olympic_power exercises (if any) have their own role slot — not used as squat/press substitutes

If any item fails, revise before calling propose_program.`
