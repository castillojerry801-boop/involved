import 'server-only'

export type AdaptationTrigger =
  | 'missed_workout'
  | 'missed_week'
  | 'too_easy'
  | 'too_hard'
  | 'exercise_pain'
  | 'time_constraint'
  | 'equipment_unavailable'
  | 'return_from_illness'
  | 'exceeded_rpe'

export interface AdaptationContext {
  trigger: AdaptationTrigger
  detail?: string
  affectedDay?: string
  affectedExercise?: string
  programWeek?: number
  totalWeeks?: number
}

const ADAPTATION_RULES: Record<AdaptationTrigger, string> = {
  missed_workout: `ADAPTATION: MISSED WORKOUT
The user missed a single workout. Rules:
• Skip the missed session — do NOT double up or attempt to combine it with the next session.
• Continue from the next scheduled session as planned.
• If the missed session was during a deload week, re-do the deload rather than skipping it entirely — deloads serve a recovery purpose.
• Do not advance load or volume as if the session occurred.
• Keep the modification minimal: resume the program from where they are.`,

  missed_week: `ADAPTATION: MISSED WEEK
The user missed an entire week of training. Rules:
• Back off: reduce total volume by approximately 10–15% for the return week.
• Hold load — do not advance weight or intensity during the return week.
• Rebuild over 1–2 weeks before resuming the planned progression.
• Do NOT simply jump ahead to the week they would have been on — the missed stimulus needs to be bridged.
• If they were mid-phase, repeat the last completed week at reduced volume, then progress from there.`,

  too_easy: `ADAPTATION: PROGRAM FEELS TOO EASY
The user finds the prescribed work easier than intended. Rules:
• Increase load slightly or reduce rest periods — do not restructure the program.
• Do not change exercise selection or program structure unless this pattern persists across 2+ weeks.
• For strength lifts: add the next appropriate increment (e.g., 5 lb) or tighten the RPE target.
• For conditioning: reduce rest by 10–15 seconds or add a round.
• Do not introduce advanced techniques (supersets, drop sets) just to make it harder unless they are already in the plan.`,

  too_hard: `ADAPTATION: PROGRAM FEELS TOO HARD
The user is struggling to complete the prescribed work. Rules:
• Drop one working set per exercise (not the whole exercise) for this week.
• Hold current load — do not advance weight while struggling.
• If multiple sessions feel too hard, consider extending the current phase by one week.
• Do NOT crash the entire progression — small adjustments first.
• Check: is the issue fatigue accumulation, sleep, nutrition, or life stress? If so, note it rather than permanently downgrading the program.`,

  exercise_pain: `ADAPTATION: EXERCISE CAUSING PAIN
The user reports pain from a specific exercise. Rules:
• Substitute the affected exercise with an alternative that fills the same movement pattern role.
• Preserve the progression intent: if the exercise was a primary compound, replace with another primary compound (same pattern).
• Do NOT replace a pressing movement with a curl.
• If the pain is described as joint-based, sharp, or worsening: remove the entire movement pattern for that session and recommend the user consult a professional if it persists.
• If it sounds like normal muscle soreness (DOMS), note that and retain the exercise with a form cue.
• Do NOT instruct the user to push through pain — modify first.`,

  time_constraint: `ADAPTATION: TIME CONSTRAINT
The user has less time than planned for a session. Rules:
• Drop accessory work first — keep all primary compound movements.
• Reduce working sets on accessories before removing exercises entirely.
• If only 20–25 minutes available: keep the 2–3 highest-priority exercises, drop everything else.
• Do not reduce rest below 60 seconds for heavy compound work.
• Suggest the shortened version rather than skipping entirely.`,

  equipment_unavailable: `ADAPTATION: EQUIPMENT UNAVAILABLE
A piece of equipment the program relies on is not available. Rules:
• Find a substitute for the affected exercises using available equipment.
• Preserve the movement pattern — replace a barbell squat with a goblet squat or leg press, not a curl.
• If substitution is not possible for a session (e.g., no gym at all), offer a bodyweight or minimal-equipment alternative session with the same training intent.
• Do not simply remove the entire session.`,

  return_from_illness: `ADAPTATION: RETURNING AFTER ILLNESS
The user is returning to training after being sick. Rules:
• Reduce volume for the first session back by 20–30% (drop 1–2 sets per exercise).
• Hold current load — do not advance weight on the return session.
• Rebuild over the following 1–2 weeks: add one set back per session until back at prescribed volume.
• Do not rush the rebuild — the first session back should feel manageable, not maximal.
• If they were out for more than a week, treat as missed_week and bridge accordingly.`,

  exceeded_rpe: `ADAPTATION: RPE EXCEEDED TARGET
The user's actual RPE was significantly higher than the prescribed target (e.g., prescribed RPE 7, felt like RPE 9+). Rules:
• Hold the current load for one more session before advancing.
• Do NOT increase weight at the next session — let the adaptation catch up.
• If RPE was exceeded two sessions in a row, consider reducing load by 5% and building back.
• Do not restructure the progression model — this is a temporary hold, not a regression.`,
}

export function buildAdaptationPrompt(ctx: AdaptationContext): string {
  const rule = ADAPTATION_RULES[ctx.trigger]

  const parts: string[] = [rule]

  if (ctx.detail) {
    parts.push(`\nUSER REPORT: "${ctx.detail}"`)
  }
  if (ctx.affectedDay) {
    parts.push(`AFFECTED DAY: ${ctx.affectedDay}`)
  }
  if (ctx.affectedExercise) {
    parts.push(`AFFECTED EXERCISE: ${ctx.affectedExercise}`)
  }
  if (ctx.programWeek != null && ctx.totalWeeks != null) {
    parts.push(`PROGRAM POSITION: Week ${ctx.programWeek} of ${ctx.totalWeeks}`)
  }

  parts.push('\nApply the minimum necessary change. Preserve the program structure, phase, and progression wherever possible.')

  return parts.join('\n')
}
