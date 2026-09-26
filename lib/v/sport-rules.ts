import 'server-only'

// ─── Sport alias normalization ─────────────────────────────────────────────────

function normalizeSport(input: string): string {
  const s = input.toLowerCase().trim()
  if (/\bocr\b|spartan|obstacle|mud\s*run/.test(s)) return 'ocr'
  if (/half.?marathon/.test(s)) return 'running'
  if (/marathon/.test(s)) return 'running'
  if (/\brunning\b|\broad.?race|5k|10k/.test(s)) return 'running'
  if (/powerlifting|power.?lift/.test(s)) return 'powerlifting'
  if (/bodybuilding|body.?build|hypertrophy|bb\.?split|ppl/.test(s)) return 'bodybuilding'
  if (/crossfit|cross.?fit|functional.?fitness|wod/.test(s)) return 'crossfit'
  if (/basketball/.test(s)) return 'basketball'
  if (/football|wide.?receiver|wr\b/.test(s)) return 'football'
  if (/soccer|futbol/.test(s)) return 'soccer'
  if (/baseball|softball/.test(s)) return 'baseball'
  if (/bjj|jiu.?jitsu|grappling|wrestling|judo/.test(s)) return 'bjj'
  if (/cycl|biking|bike/.test(s)) return 'cycling'
  if (/swim/.test(s)) return 'swimming'
  if (/general.?fitness|beginner|general.?conditioning|fat.?loss|weight.?loss/.test(s)) return 'general_fitness'
  if (/hybrid|strength.*run|run.*strength/.test(s)) return 'hybrid'
  return s
}

// ─── Sport rules map ───────────────────────────────────────────────────────────

const SPORT_RULES: Record<string, string> = {

ocr: `
════════════════════════════════════════
SPORT PROGRAMMING RULES — OCR / SPARTAN RACE
════════════════════════════════════════
OCR races demand a specific combination of aerobic endurance, functional strength, grip, and compromised running. This is NOT a generic strength + cardio program.

REQUIRED ELEMENTS — every OCR program MUST include all of these:
• Running (or treadmill / track work) progressing from easy aerobic to race-pace efforts
• Loaded carries: farmer carries, sandbag carries, bucket carries, log carries — these are race-mandatory. Use carry pattern exercises. If user has sandbags/dumbbells/kettlebells, use them.
• Grip endurance: dead hangs, bar hangs, farmer carries, pull-ups with fat grip if available
• Pull-ups and rows (vertical_pull + horizontal_pull) — essential for obstacles (monkey bars, rope climbs, walls)
• Hills/incline: treadmill incline runs, step-ups, box step-ups — simulate race terrain
• Compromised running: running immediately after carries or strength work in the same session (this is race-specific — program it explicitly in later phases)
• Burpee conditioning: burpees appear as a penalty in races; include them in conditioning work
• Lower-body endurance: step-ups, split squats, lunges for uneven terrain durability

DO NOT program only stationary bike cardio. Every cardio session must use running, rower, carries, or stair/step-ups. Stationary bike is a recovery or cross-training option only.

PHASES (12-week example — scale proportionally):
  Weeks 1–3 — Base Conditioning: easy runs (Zone 2), foundational strength, basic carries, pull-up volume. No race-specific work yet.
  Weeks 4–6 — Build: longer runs, heavier carries, more grip volume, introduce hills and incline, higher pull-up frequency.
  Weeks 7–9 — Specific Preparation: compromised running sessions (carry then run back-to-back), obstacle simulation, burpee integration, tempo runs.
  Weeks 10–11 — Race Prep / Peak: race-simulation sessions, peak carry loads, race-pace running, maintain pulling strength.
  Week 12 — Taper: reduce volume 40–50%, maintain intensity, race readiness. No new training stimuli.

EQUIPMENT USAGE:
• Treadmill → incline runs (8–15% grade), compromised runs, easy aerobic work
• Air bike / Assault bike → conditioning intervals, active recovery
• Dumbbells / kettlebells → farmer carries, single-arm carries, swings
• Sandbag → sandbag carries, sandbag squats, sandbag shouldering
• Pull-up station → pull-ups, dead hangs, bar hangs, scapular work
• Rower → aerobic conditioning, interval work

RECOVERY: after heavy carry or grip sessions, allow 48 hours before another grip-intensive day. Do not stack grip + running + carries on consecutive days without a rest day between.

EXERCISE SELECTION:
• Core: prioritize anti-extension and anti-rotation (plank variations, Pallof press) — these transfer to obstacle navigation
• Squat/hinge: for load tolerance on uneven terrain (goblet squat, trap bar deadlift, Romanian deadlift)
• Do NOT program isolation work (bicep curls, leg extensions) as primary movements — accessories only
`,

running: `
════════════════════════════════════════
SPORT PROGRAMMING RULES — RUNNING / ROAD RACING
════════════════════════════════════════
Running programs must prioritize injury prevention and sustainable adaptation. Most running injuries come from doing too much too soon.

BEGINNER RUNNER SAFETY (fitness level = beginner or stated as new runner):
• Start with 3 run days/week maximum. 4+ days is too aggressive in weeks 1–4.
• Weeks 1–3: ALL runs should be easy/conversational pace (Zone 2 / RPE ≤ 4). No intervals. No tempo. No threshold work.
• Use run/walk intervals for true beginners: "Run 2 min, walk 1 min, repeat" progressing to continuous running over weeks.
• Long run should not exceed 35% of weekly total volume.
• Weekly mileage/time increases should be gradual. A 30%+ increase in a single week is flagged as too aggressive.
• Do NOT introduce structured intervals (400m repeats, tempo runs, lactate threshold) until the runner has established 6–8 weeks of consistent base.

INTERMEDIATE / ADVANCED PROGRESSION:
• Include intensity in phases: Base → Aerobic Development → Tempo/Threshold → Speed/Race-Specific → Taper
• Easy runs (Zone 2) should constitute 75–80% of weekly run volume at all levels
• Tempo runs: 20–30 min at "comfortably hard" (RPE 6–7). Introduce in build phase only.
• Intervals: after base is established. Start with short repeats (200–400m), progress to longer.
• Long run: increases by 1–2 miles (or 10–15 min) per week, with a step-back week every 3–4 weeks

STRENGTH WORK FOR RUNNERS:
• 2 strength sessions/week (not 3+) when run volume is high
• Focus on: hip hinge (single-leg RDL, hinge), glute strength (hip thrust, glute bridge), calf (single-leg calf raise), core stability (anti-extension, anti-rotation)
• Avoid heavy quad-dominant bilateral squats on hard run days — schedule after easy days
• Plyometrics (jump training) only for intermediate+ runners with established base

HALF MARATHON PHASES (24-week plan):
  Weeks 1–6 — Base Building: 3 runs/week, all easy, run/walk for beginners, introduce basic strength
  Weeks 7–12 — Aerobic Development: 3–4 runs/week, increase long run, add strides (not full intervals)
  Weeks 13–18 — Build / Threshold: introduce tempo runs (1x/week), progress long run to 10–11 miles
  Weeks 19–22 — Race Specific: race-pace runs, peak long run (11–12 miles), maintain strength
  Weeks 23–24 — Taper: reduce volume 30–40%, keep some intensity, race week is easy
`,

powerlifting: `
════════════════════════════════════════
SPORT PROGRAMMING RULES — POWERLIFTING
════════════════════════════════════════
Powerlifting programs revolve around the squat, bench press, and deadlift. Everything else is accessory work.

COMPETITION LIFT FREQUENCY:
• Squat: 2–3x per week (main + variation or lighter technique day)
• Bench press: 2–3x per week
• Deadlift: 1–2x per week (deadlift is more CNS-intensive; 2x is appropriate for intermediate+)
• Do not spread competition lifts so thin that a 4-day program has each lift only once.

PERCENTAGE-BASED LOADING — USE LOAD ANCHORS FROM CONTEXT:
If LOAD ANCHORS are present in the user's context, use the computed percentages directly.
General loading scheme across 12 weeks (adjust to actual 1RMs from context):
  Week 1:  4×5 @ 70% — technique re-establishment
  Week 2:  4×4 @ 75%
  Week 3:  4×3 @ 80%
  Week 4:  DELOAD — 3×5 @ 60–65%
  Week 5:  5×3 @ 80%
  Week 6:  4×3 @ 82.5%
  Week 7:  3×3 @ 85%
  Week 8:  DELOAD — 3×5 @ 65%
  Week 9:  3×2 @ 87.5%
  Week 10: 3×2 @ 90%
  Week 11: 2×2 @ 92.5% + top single @ RPE 9
  Week 12: TAPER — work up to opener, 1×2 @ ~90%, no new PRs

Populate week_progressions on all three competition lifts with load_note showing the actual percentage AND computed weight (e.g. "70% = 284 lb / 129 kg").

RPE GUARDRAILS:
• Use RPE as a ceiling, not a target: "4×5 @ 70%, stop if RPE > 8"
• Deload weeks: all main lifts capped at RPE 7
• Peak weeks: main lifts at RPE 9–9.5 max on working sets; reserve absolute max for competition

ACCESSORIES — program after competition lifts:
• Squat accessories: leg press, lunge/split squat (lunge pattern), Romanian deadlift (hinge), leg curl
• Bench accessories: close-grip bench (horizontal_push), dumbbell press (horizontal_push), tricep work (tricep), row (horizontal_pull) for shoulder health
• Deadlift accessories: Romanian deadlift, back extensions (hinge), lat pulldown (vertical_pull), row (horizontal_pull)
• Core: anti-extension (ab wheel, dead bug) — NOT flexion-dominant sit-ups

DELOAD — mandatory every 4th week:
• Reduce volume by 40–50% (fewer sets, not fewer exercises)
• Maintain intensity at 60–65% — do not go below 55%
• Purpose: recovery and supercompensation, not "active rest"

PHASES for 12-week program:
  Weeks 1–3: Hypertrophy/Technique — moderate load, higher reps (4–6), technique focus
  Weeks 4:   Deload
  Weeks 5–7: Strength — lower reps (3–5), heavier load (80–87.5%)
  Week 8:    Deload
  Weeks 9–11: Peak — heavy singles and doubles, high intensity, low volume
  Week 12:   Taper — no new PRs, opener work only

CRITICAL — do NOT label the same week as both "peak" and "deload". These are mutually exclusive.
`,

bodybuilding: `
════════════════════════════════════════
SPORT PROGRAMMING RULES — BODYBUILDING / HYPERTROPHY
════════════════════════════════════════
Bodybuilding programs optimize for muscle growth via volume, progressive overload, and recovery.

WEEKLY HARD-SET VOLUME PER MUSCLE GROUP:
• Beginner: 10–12 sets/week per muscle is sufficient
• Intermediate: 12–16 sets/week per muscle
• Advanced: 16–20 sets/week (diminishing returns beyond 20)
• Do NOT program 25+ sets/week for a single muscle group — this is counterproductive

MUSCLE FREQUENCY — 2x per week per muscle is the evidence-backed standard:
• Example: chest hit Monday (Push) and Thursday (Upper)
• Avoid: chest 3×/week unless advanced specialization is the explicit goal

EXERCISE STABILITY — main movements must not change every week:
• Keep primary compound movements for the full phase (≥4 weeks, ideally 6–8)
• Accessories can rotate more selectively (every 3–4 weeks)
• Random exercise changes week to week prevent progressive overload — do NOT do this

PROXIMITY TO FAILURE — use RIR (reps in reserve) in notes:
• Hypertrophy base phase: 3–4 RIR (still challenging, not grinding)
• Build phase: 2–3 RIR
• Intensification: 1–2 RIR
• Do NOT train to failure on every set every week — that is not what builds muscle fastest
• Use rpe field: RPE 7 = ~3 RIR, RPE 8 = ~2 RIR, RPE 9 = ~1 RIR

PROGRESSIVE OVERLOAD — the mechanism of muscle growth:
• Week-over-week: add weight when top of rep range is hit with 1–2 RIR
• Or: add reps (progress from 8 to 12 before adding weight)
• Use week_progressions to show the expected progression arc on main lifts

DELOAD — every 4–6 weeks:
• Reduce sets by 30–40% (keep intensity the same)
• Do not take an unplanned deload — build it into the program structure

PHASES for 16-week program:
  Weeks 1–4:   Base — technique, higher reps (10–15), 3–4 RIR, learn movements
  Weeks 5–8:   Accumulation — increase sets, reps 8–12, 2–3 RIR
  Weeks 9–12:  Intensification — add weight, reps 6–10, 1–2 RIR
  Week 13:     Deload
  Weeks 14–16: Peak / Specialization — personal weak points, 1–2 RIR, peak effort
`,

crossfit: `
════════════════════════════════════════
SPORT PROGRAMMING RULES — CROSSFIT / FUNCTIONAL FITNESS
════════════════════════════════════════
CrossFit training demands broad competency: strength, power, gymnastics, and metabolic conditioning (metcons). Do not specialize in only one domain.

PROGRAM STRUCTURE per session:
• Strength/Skill (15–20 min): one primary barbell or gymnastics skill focus
• MetCon (10–20 min): mixed-modal conditioning piece (time domain varies)
• Avoid programming pure strength days with zero conditioning, or pure conditioning days with zero strength work (unless explicitly requested)

MOVEMENT DOMAINS to distribute across the week:
• Barbell strength: squat, deadlift, press, Olympic lifts (clean, snatch) — do not neglect any
• Gymnastics: pull-ups, muscle-ups, handstand push-ups, toes-to-bar, ring work
• Monostructural: running, rowing, assault bike, jump rope
• Carries and odd objects where equipment allows

BENCHMARKS — reference classic CrossFit workouts for context (Fran, Grace, Cindy, Diane) but do not copy them verbatim unless asked. Use them as benchmark templates.

OLYMPIC LIFTING: cleans and snatches are complex movements; program them early in the session before fatigue. Use olympic_power pattern. Do not substitute them for squats.

PERIODIZATION: CrossFit can be periodized. A 12-week program should not be random:
  Weeks 1–4: Skill and base — volume, technique, aerobic base
  Weeks 5–8: Build — heavier loads, more complex skills, higher-intensity metcons
  Weeks 9–12: Peak — competition-style workouts, max effort, test benchmarks

AVOID SINGLE-MODALITY BIAS: do not make every metcon bike-only or run-only. Vary modalities.
`,

basketball: `
════════════════════════════════════════
SPORT PROGRAMMING RULES — BASKETBALL
════════════════════════════════════════
Basketball demands explosive power, lateral quickness, jumping ability, and aerobic capacity for repeated high-intensity efforts.

PRIMARY PHYSICAL DEMANDS:
• Acceleration and deceleration (first-step quickness, stop-and-go)
• Vertical jump (both bilateral and unilateral takeoffs)
• Lateral movement (defensive slides, cut-and-close)
• Repeated sprint ability (multiple possessions, no time to fully recover)
• Strength/power (not hypertrophy — avoid programming like a bodybuilder)
• Upper body strength for contact and finishing at the rim

KEY TRAINING MODALITIES to include:
• Lower body power: jump squats, trap bar deadlift, Romanian deadlift, split squats
• Speed/acceleration: use sprint notes ("3×20m sprint acceleration") in conditioning exercises
• Lateral movement: use conditioning or lunge patterns with lateral emphasis
• Plyometrics (for intermediate+): box jumps (plyometric/carry pattern), depth drops, broad jumps
• Core stability: anti-rotation (Pallof press, single-arm carries), anti-extension

IN-SEASON vs OFF-SEASON:
• Off-season: higher volume, develop strength and power base, more sessions/week
• In-season: reduce volume 30–40%, maintain intensity, prioritize recovery. Max 2 strength days/week in-season.
• If user has practice days, do NOT schedule hard training sessions on those days.

AVOID:
• Excessive hypertrophy volume (bodybuilding-style isolation sets) — adds non-functional mass
• High-fatigue endurance training (marathon-style) during season — impairs explosiveness
• Back-to-back heavy lower body sessions
`,

football: `
════════════════════════════════════════
SPORT PROGRAMMING RULES — FOOTBALL / WIDE RECEIVER
════════════════════════════════════════
Wide receivers need a combination of max velocity, acceleration, change of direction, and functional upper-body strength for blocking and route-running mechanics.

PRIMARY PHYSICAL DEMANDS:
• Linear acceleration: 0–10 yard burst out of breaks
• Max velocity: top speed on vertical routes and deep patterns
• Change of direction (COD): sharp cuts, double-moves, route breaks
• Upper body strength: blocking, contested catches, physicality
• Lower body power: hip drive, single-leg strength for cut mechanics

KEY TRAINING ELEMENTS:
• Power development: trap bar deadlift, Romanian deadlift, hip thrust (hinge), jump squats
• Unilateral leg work: split squats, Bulgarian split squats, single-leg RDL (lunge + hinge)
• Acceleration mechanics: short sprints (notes: "6×15m acceleration"), hip hinge with explosiveness
• Upper body: vertical push and pull for blocking and catch strength; rows for scapular health
• Core: anti-rotation (essential for cutting mechanics), anti-extension

PERIODIZATION:
• Off-season (general): strength + power base, 3–4 days/week
• Pre-season (specific): speed/power + conditioning, reduce hypertrophy work
• In-season: maintenance only, 2 sessions/week, no new stimuli

AVOID:
• Long-distance endurance work (this impairs fast-twitch output)
• High-rep isolated bodybuilding work as primary programming
`,

soccer: `
════════════════════════════════════════
SPORT PROGRAMMING RULES — SOCCER
════════════════════════════════════════
Soccer requires a large aerobic engine, repeated sprint ability, multidirectional movement, and lower-body durability for 90+ minutes.

PRIMARY PHYSICAL DEMANDS:
• Aerobic base (VO2max): cover 7–9 miles per game
• Repeated sprint ability: ~150 high-intensity sprints per game with incomplete recovery
• Multidirectional movement: cuts, backpedals, lateral runs
• Lower-body durability: quad, hamstring, hip flexor, adductor — common injury sites
• Upper body: minimal (shoulder strength for shielding, core for balance)

KEY TRAINING ELEMENTS:
• Aerobic base: Zone 2 running 30–45 min, 1–2x/week
• Repeated sprint conditioning: 6–10 × 20–30m with 20–30 sec rest (active recovery)
• Injury prevention focus: single-leg RDL (hinge) for hamstrings, Copenhagen adductor (lunge), glute bridges
• Lower body strength: squat, hinge, lunge patterns — moderate load, not maximal
• Multidirectional: lateral lunges, lateral band walks (lunge/carry patterns)
• Core: anti-rotation, anti-lateral flexion (for balance on 1-leg actions)

AVOID:
• Heavy hypertrophy work — excess muscle mass impairs endurance and speed
• Back-to-back heavy leg sessions
• High-intensity strength work within 48 hours of game or intense practice day
`,

baseball: `
════════════════════════════════════════
SPORT PROGRAMMING RULES — BASEBALL
════════════════════════════════════════
Baseball is a rotational power sport with explosive sprint demands and unique unilateral considerations for throwing athletes.

PRIMARY PHYSICAL DEMANDS:
• Rotational power: hip-to-shoulder separation for hitting and throwing velocity
• Sprint acceleration: first step out of the box, stolen base, outfield reads (10–30m sprints)
• Throwing-side considerations: unilateral muscle imbalances (dominant arm), posterior shoulder health
• Grip strength: bat control, glove work
• Hip stability: single-leg landing mechanics for fielding

KEY TRAINING ELEMENTS:
• Rotational power: cable rotations (core_rotation pattern), medicine ball rotational throws (notes only, not in exercise DB — program as conditioning), hip hinge with rotation
• Unilateral lower body: single-leg RDL, split squats, step-ups — address bilateral dominance asymmetry
• Posterior shoulder health: face pulls (shoulder_isolation), external rotation, rows (horizontal_pull)
• Sprint mechanics: acceleration notes in cardio exercises ("6×20m sprint, full recovery")
• Core: rotation (cable chop, woodchop) and anti-rotation (Pallof press)

THROWING-SIDE BALANCE:
• Program pulling exercises for both arms but note any unilateral imbalance
• Do NOT overload dominant shoulder with heavy pressing
• Include posterior chain and scapular work

AVOID:
• Heavy loaded rotational work under fatigue (injury risk to spine)
• Excessive bilateral pressing dominance (creates internal rotation imbalance)
`,

bjj: `
════════════════════════════════════════
SPORT PROGRAMMING RULES — BJJ / GRAPPLING
════════════════════════════════════════
Brazilian jiu-jitsu demands grip endurance, isometric strength (especially trunk and neck), pulling dominance, aerobic base for extended rolls, and repeated high-intensity effort tolerance.

PRIMARY PHYSICAL DEMANDS:
• Grip endurance: gi grips, collar grips, wrist control — must not fatigue early
• Isometric strength: clinch, guard retention, bridging, framing — sustained force production
• Pulling dominance: BJJ is pulling-heavy (throws, guard pulling, sweeps) — program more pulling than pushing
• Aerobic base: 5–10 min rounds, multiple back-to-back, must recover between rounds
• Repeat high-intensity: explosive scrambles every few minutes amid aerobic demand
• Core stiffness: bridging, hip escape mechanics, framing

KEY TRAINING ELEMENTS:
• Grip endurance: dead hangs (build to 60+ sec), farmer carries with grip emphasis, towel pull-ups if available
• Pulling: prioritize vertical_pull and horizontal_pull over pressing (3:2 pull:push ratio minimum)
• Isometrics: plank holds (core_antiextension), wall sit, bear crawl position holds
• Neck: neck isometrics (note in conditioning exercises) — injury-prone area, do carefully
• Aerobic base: Zone 2 conditioning (30–45 min rower, run, or bike) 1–2x/week
• High-intensity: interval rowing or sprint intervals to simulate round intensity

INJURY-PRONE AREAS — program to protect:
• Neck: isometric work, no heavy direct loading
• Knees: avoid deep knee flexion with heavy load for athletes with knee issues
• Shoulders: include scapular health work (face pulls, external rotation), avoid internal-rotation dominance

AVOID:
• Bodybuilding-style splits (don't train like a bro — muscle size without strength is useless in grappling)
• Heavy spinal loading under fatigue (deadlifts late in session when already fatigued from grappling)
`,

cycling: `
════════════════════════════════════════
SPORT PROGRAMMING RULES — CYCLING
════════════════════════════════════════
Cycling programs must develop aerobic capacity, lactate threshold, and event-specific endurance. Most amateur cyclists need more Zone 2 base, not more intervals.

PRIMARY PHYSICAL DEMANDS:
• Aerobic capacity (VO2max and aerobic base)
• Lactate threshold (the watts/speed you can sustain for ~1 hour)
• Muscular endurance: primarily quad, hamstring, glute — sustained force under fatigue
• Cadence efficiency: 80–100 RPM for efficiency (note in session descriptions)

TRAINING ZONES (effort-based, not HR zones unless HR data provided):
• Zone 1 (Active Recovery): very easy, <50% effort
• Zone 2 (Endurance): conversational pace, could hold for hours — the PRIMARY training zone
• Zone 3 (Tempo): "comfortably hard," 70–80% effort
• Zone 4 (Threshold): hard, sustainable 20–60 min, RPE ~8
• Zone 5 (VO2max intervals): very hard, 3–8 min efforts

VOLUME DISTRIBUTION: 70–80% of ride time should be Zone 2. Avoid "junk miles" — everything is either easy (Zone 2) or hard (Zone 4–5). Avoid Zone 3 as a default.

LONG RIDE PROGRESSION:
• Increase long ride by 15–20% per week maximum
• Step back week every 3–4 weeks (reduce long ride by 30%)
• Long ride is the cornerstone of the week — schedule it on a rest-adjacent day

STRENGTH TRAINING FOR CYCLISTS:
• 1–2x/week, focus on: squat (bilateral quad dominance), hinge (hip drive), single-leg work (lunge), core
• Keep strength sessions short (30–45 min) — don't cannibalize ride recovery
• Strength work is secondary to riding volume during peak training periods

PERIODIZE TOWARD EVENT:
• Base → Build → Peak → Taper structure
• Taper: reduce volume 30–40% the week before event; keep 1 threshold session to stay sharp
`,

swimming: `
════════════════════════════════════════
SPORT PROGRAMMING RULES — SWIMMING / OPEN WATER
════════════════════════════════════════
Swimming programs must build distance tolerance, stroke efficiency, and (for open water) race-specific skills.

BEGINNER SWIMMER:
• Start with short distances and technique focus — poor technique that adds fatigue creates a ceiling
• 2–3 pool sessions/week max to start
• Intervals appropriate to skill: beginners use 25m–50m repeats with full rest
• Do NOT program 400m repeats for a beginner — this entrenches bad mechanics under fatigue

DISTANCE PROGRESSION:
• Total weekly yardage/meters increases no more than 10–15% per week
• Step-back week every 3–4 weeks
• Session length progresses before intensity is added

OPEN WATER SPECIFICITY (if requested):
• Sighting drills: program explicitly (e.g., "every 10 strokes, sight 2x, practice bilateral breathing")
• Chop tolerance: pool swimming doesn't prepare for waves — note open water simulation sessions
• No walls: turns don't exist in open water — include sets without flip turns
• Navigation: sighting adds ~3–5% to effective distance — account for this in race estimates
• Wetsuit: buoyancy affects stroke mechanics — note if wetsuit training is appropriate

STRENGTH TRAINING FOR SWIMMERS:
• Lat work (vertical_pull) is directly transferable — prioritize pull-up variations, lat pulldown
• Shoulder health: posterior chain (face pull, Y/T/W, external rotation) — swimmers are prone to impingement
• Core: anti-rotation and anti-extension (not just flexion) — crucial for body position and rotation
• Avoid excessive pressing — swimmers already have strong anterior shoulder from pulling phase

PHASES:
• Base: distance, technique, aerobic capacity — easy pace, longer sets
• Build: introduce threshold work (CSS = critical swim speed), maintain distance
• Peak: race-specific intervals (appropriate to target event distance), maintain sharpness
• Taper: reduce volume 30%, keep short intense sets, no new training stimuli
`,

general_fitness: `
════════════════════════════════════════
SPORT PROGRAMMING RULES — GENERAL FITNESS
════════════════════════════════════════
General fitness programs serve beginners and non-competitive athletes who want to be healthier, stronger, and more capable.

CORE PRINCIPLES:
• Sustainable habit formation matters more than optimal programming — programs that are too hard get abandoned
• Balanced development: push, pull, hinge, squat, carry, core — do not neglect any major pattern
• Progressive: must be harder in week 4 than week 1, but not overwhelming
• Minimal complexity for the goal — do not add advanced techniques that aren't earned yet

BEGINNER CONSIDERATIONS:
• 3 sessions/week is sufficient and sustainable — do not jump to 5 days
• 4–6 exercises per session; more is not better
• Simple linear progression: same movements each week, add load or reps
• No advanced techniques (RPE management, periodization blocks, daily undulating periodization) for true beginners
• Rest at least one day between sessions

EXERCISE SELECTION:
• Prioritize foundational compound movements: squat, hinge (deadlift pattern), push, pull
• Include one core exercise per session minimum
• Avoid novelty for novelty's sake — beginners benefit from repetition

CONDITIONING:
• 1–2 cardio sessions/week: 20–30 min Zone 2 (walking, easy cycling, rowing) is sufficient
• Do not stack high-intensity cardio on top of strength sessions for beginners — too much fatigue
• Gradual: if week 1 is 20 min Zone 2, week 4 might be 30–35 min

PROGRESSION (12-week beginner program):
  Weeks 1–3: Learn movements, 3 days, 4 exercises/session, light load, focus on form
  Weeks 4–6: Add reps/load to now-familiar movements
  Weeks 7–9: Increase sets or introduce slight variations
  Weeks 10–12: Peak effort for this phase, consider what comes next (intermediate program)
`,

hybrid: `
════════════════════════════════════════
SPORT PROGRAMMING RULES — HYBRID STRENGTH + ENDURANCE
════════════════════════════════════════
Hybrid programs serve athletes who want to be both strong and capable endurance athletes (e.g., running a sub-5-hour marathon while squatting 2× body weight).

THE INTERFERENCE EFFECT — manage this explicitly:
• Endurance work suppresses strength adaptations when combined improperly
• Key rule: do NOT do strength work immediately before long aerobic sessions on the same day
• Preferred order within a day: strength first, then conditioning (if same-day)
• Best: separate strength and endurance on different days

SCHEDULING:
• Heavy lower body (squat, deadlift, hinge) should NOT immediately precede long runs
• Place at least one easy/rest day between heavy leg sessions and long runs
• Upper body strength is compatible with running days

VOLUME BALANCE:
• At any given time, one quality is the priority. A 12-week hybrid program should have phases:
  - Strength block: 3–4 strength days, 2 easy runs/week
  - Endurance block: 3–4 run days, 2 maintenance strength days
  - Parallel block: balanced, neither dominates — used when time allows
• Do not try to maximize both simultaneously for every week — this leads to mediocre results in both

STRENGTH SELECTION FOR HYBRID ATHLETES:
• Prioritize compound lifts with high carryover: deadlift, squat, carry (farmer carry)
• Avoid excessive hypertrophy volume — extra mass hurts endurance performance
• Carries and unilateral work transfer well to running mechanics

RUNNING SELECTION:
• Easy Zone 2 runs do not significantly impair strength — include freely
• Hard interval sessions DO impair strength recovery — keep to 1x/week maximum
• Long runs impair leg strength recovery for 24–48 hours — plan accordingly
`,

}

// ─── Public API ───────────────────────────────────────────────────────────────

export function getSportRules(sport: string): string | null {
  if (!sport?.trim()) return null
  const key = normalizeSport(sport)
  return SPORT_RULES[key] ?? null
}
