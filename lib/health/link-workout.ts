import 'server-only'
import type { PrismaClient } from '@prisma/client'
import { classifyWorkoutActivity, activityTypesCompatible } from './classify'

// Two sessions may start up to 10 minutes apart and still represent the same workout
// (e.g. phone started before watch, or app delay on session start).
const MATCH_WINDOW_MS = 10 * 60 * 1000

// Durations may differ by up to 50% and still be the same session.
const DURATION_MISMATCH_RATIO = 0.5

export interface WorkoutForLink {
  id: string
  userId: string
  title: string
  startedAt: Date | null
  completedAt: Date | null
  durationSeconds: number | null
  exercises: Array<{ trackingType: string }>
}

/**
 * Write a completed Involved workout into health_activities so it appears on the
 * Health → Activities list and Today page alongside Apple Health / Health Connect rows.
 *
 * Arrival-order A — Involved finishes before HealthKit sync:
 *   Creates a `manual` projection row (externalId = 'involved:<workoutId>').
 *   When HealthKit later syncs the same session, reconcileManualRow() in the
 *   HealthKit route transfers involvedWorkoutId to the apple_health row and
 *   deletes the manual row.
 *
 * Arrival-order B — HealthKit row already exists:
 *   Finds the single matching apple_health row and links involvedWorkoutId to it.
 *   No manual row is created.
 *
 * Multiple matches or no match → creates the manual projection row (safe fallback).
 *
 * The function is idempotent: a second call for the same workoutId is a no-op.
 */
export async function linkOrCreateHealthActivity(
  workout: WorkoutForLink,
  db: PrismaClient,
): Promise<void> {
  // Fallback: workouts that jump planned → completed have no startedAt; use completedAt.
  const effectiveStart = workout.startedAt ?? workout.completedAt
  if (!effectiveStart) return

  // Idempotency check — if any health_activity is already linked, bail out.
  const existing = await db.healthActivity.findFirst({
    where: { involvedWorkoutId: workout.id },
  })
  if (existing) return

  const activityType = classifyWorkoutActivity({
    title: workout.title,
    exercises: workout.exercises,
  })

  // Search for a matching apple_health row within the temporal window.
  const windowStart = new Date(effectiveStart.getTime() - MATCH_WINDOW_MS)
  const windowEnd   = new Date(effectiveStart.getTime() + MATCH_WINDOW_MS)

  const candidates = await db.healthActivity.findMany({
    where: {
      userId:           workout.userId,
      provider:         'apple_health',
      startedAt:        { gte: windowStart, lte: windowEnd },
      involvedWorkoutId: null,
    },
  })

  const validMatches = candidates.filter(c => {
    if (!activityTypesCompatible(c.activityType, activityType)) return false
    const wd = workout.durationSeconds
    const cd = c.durationSeconds
    if (wd && cd) {
      const ratio = Math.abs(wd - cd) / Math.max(wd, cd)
      if (ratio > DURATION_MISMATCH_RATIO) return false
    }
    return true
  })

  if (validMatches.length === 1) {
    // Single unambiguous match — link it in-place.
    await db.healthActivity.update({
      where: { id: validMatches[0].id },
      data:  { involvedWorkoutId: workout.id },
    })
    return
  }

  // No match (or ambiguous) — create a manual projection row so the workout is
  // visible immediately, without waiting for HealthKit sync.
  // The 'involved:<workoutId>' externalId makes this upsert idempotent on re-completion.
  await db.healthActivity.upsert({
    where: {
      userId_provider_externalId: {
        userId:     workout.userId,
        provider:   'manual',
        externalId: `involved:${workout.id}`,
      },
    },
    create: {
      userId:           workout.userId,
      provider:         'manual',
      externalId:       `involved:${workout.id}`,
      activityType,
      title:            workout.title,
      startedAt:        effectiveStart,
      endedAt:          workout.completedAt ?? null,
      durationSeconds:  workout.durationSeconds ?? null,
      involvedWorkoutId: workout.id,
      syncState:        'synced',
      syncedAt:         new Date(),
    },
    update: {
      activityType,
      title:            workout.title,
      endedAt:          workout.completedAt ?? null,
      durationSeconds:  workout.durationSeconds ?? null,
      involvedWorkoutId: workout.id,
      syncedAt:         new Date(),
    },
  })
}
