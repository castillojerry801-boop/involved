import 'server-only'
import { prisma } from '@/lib/prisma'

/**
 * Returns the user's next upcoming workout:
 *   1. Any in-progress workout (highest priority, no date filter)
 *   2. The earliest planned workout with scheduledDate >= today (in user's local timezone)
 * Completed workouts and unscheduled templates are excluded.
 *
 * todayDateStr must be the user's local calendar date as "YYYY-MM-DD".
 * We convert it to UTC midnight so Prisma serializes it as the correct @db.Date value —
 * using todayStart (local midnight in UTC) would give the wrong calendar date for UTC+ users
 * because Prisma strips the time component to produce the UTC date.
 */
export async function getNextWorkout(userId: string, todayDateStr: string) {
  return prisma.workout.findFirst({
    where: {
      userId,
      OR: [
        { status: 'in_progress' },
        {
          status: 'planned',
          scheduledDate: { gte: new Date(todayDateStr + 'T00:00:00Z') },
        },
      ],
    },
    orderBy: [
      { status: 'asc' },        // 'in_progress' < 'planned' alphabetically
      { scheduledDate: 'asc' }, // earliest scheduled first within same status
    ],
    include: {
      exercises: { select: { exerciseId: true }, take: 5 },
    },
  })
}

/**
 * Formats a workout's scheduled date relative to the user's local today.
 *
 * scheduledDate is a Prisma @db.Date value (stored as a calendar date, returned as UTC
 * midnight). The UTC ISO date string is the canonical stored value and can be compared
 * directly with todayStr without a timezone conversion — no tz parameter needed.
 */
export function formatWorkoutDate(
  scheduledDate: Date,
  todayStr: string, // "YYYY-MM-DD" in user's local timezone
): string {
  const dateStr = scheduledDate.toISOString().slice(0, 10)

  if (dateStr === todayStr) return 'Today'

  const tomorrowStr = new Date(
    new Date(todayStr + 'T00:00:00Z').getTime() + 24 * 60 * 60 * 1000,
  )
    .toISOString()
    .slice(0, 10)

  if (dateStr === tomorrowStr) return 'Tomorrow'

  // Render at noon UTC so the calendar date is stable across any local timezone
  return new Date(dateStr + 'T12:00:00Z').toLocaleDateString('en-US', {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}
