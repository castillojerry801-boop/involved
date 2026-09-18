import 'server-only'
import { prisma } from '@/lib/prisma'
import type { HealthVSummary, ActivitySummaryItem } from './types'

/**
 * Build a validated health summary for V context.
 *
 * Rules:
 * - Only includes values that are actually present in the database.
 * - Never invents or interpolates missing metrics.
 * - Covers the last `days` calendar days.
 * - Returns null if the user has no health data at all.
 */
export async function buildHealthVSummary(
  userId: string,
  days = 14,
): Promise<HealthVSummary | null> {
  const now     = new Date()
  const start   = new Date(now)
  start.setDate(start.getDate() - days)
  start.setHours(0, 0, 0, 0)

  const periodStart = start.toISOString().slice(0, 10)
  const periodEnd   = now.toISOString().slice(0, 10)
  const today       = periodEnd

  const [activities, stepMetrics, latestWeight, todayActiveEnergy] = await Promise.all([
    prisma.healthActivity.findMany({
      where:   { userId, startedAt: { gte: start } },
      orderBy: { startedAt: 'desc' },
      take:    10,
    }),

    prisma.healthMetric.findMany({
      where:   { userId, metricType: 'steps', recordedAt: { gte: start } },
      orderBy: { recordedAt: 'asc' },
    }),

    prisma.healthMetric.findFirst({
      where:   { userId, metricType: 'body_weight_kg' },
      orderBy: { recordedAt: 'desc' },
    }),

    prisma.healthMetric.findFirst({
      where: {
        userId,
        metricType: 'active_energy_kcal',
        recordedAt: { gte: new Date(today) },
      },
      orderBy: { recordedAt: 'desc' },
    }),
  ])

  if (activities.length === 0 && stepMetrics.length === 0 && !latestWeight) {
    return null
  }

  // Determine which provider to surface (most recent activity wins)
  const provider = activities[0]?.provider ?? stepMetrics[0]?.provider ?? null

  // Map activities to summary items — only present fields
  const recentActivities: ActivitySummaryItem[] = activities.map(a => {
    const item: ActivitySummaryItem = {
      date:         a.startedAt.toISOString().slice(0, 10),
      activityType: a.activityType,
    }
    if (a.title)            item.title            = a.title
    if (a.durationSeconds)  item.durationMinutes  = Math.round(a.durationSeconds / 60)
    if (a.activeEnergyKcal) item.activeEnergyKcal = Number(a.activeEnergyKcal)
    if (a.avgHeartRateBpm)  item.avgHeartRateBpm  = a.avgHeartRateBpm
    if (a.maxHeartRateBpm)  item.maxHeartRateBpm  = a.maxHeartRateBpm
    if (a.distanceM)        item.distanceM        = Number(a.distanceM)
    if (a.stepCount)        item.stepCount        = a.stepCount
    return item
  })

  // Aggregate daily steps
  const dailyStepsMap = new Map<string, number>()
  for (const m of stepMetrics) {
    const date = m.recordedAt.toISOString().slice(0, 10)
    const existing = dailyStepsMap.get(date) ?? 0
    // Sum multiple readings per day (e.g. partial syncs)
    dailyStepsMap.set(date, existing + Number(m.value))
  }
  const dailySteps = [...dailyStepsMap.entries()]
    .map(([date, steps]) => ({ date, steps: Math.round(steps) }))
    .sort((a, b) => a.date.localeCompare(b.date))

  const summary: HealthVSummary = {
    provider,
    periodStart,
    periodEnd,
    dailySteps,
    recentActivities,
  }

  if (latestWeight) {
    summary.latestWeightKg   = Number(latestWeight.value)
    summary.latestWeightDate = latestWeight.recordedAt.toISOString().slice(0, 10)
  }

  // Today's snapshot
  const todaySteps = dailyStepsMap.get(today)
  const todayEnergy = todayActiveEnergy ? Number(todayActiveEnergy.value) : undefined
  if (todaySteps !== undefined || todayEnergy !== undefined) {
    summary.today = {}
    if (todaySteps  !== undefined) summary.today.steps           = todaySteps
    if (todayEnergy !== undefined) summary.today.activeEnergyKcal = todayEnergy
  }

  return summary
}

/**
 * Format a HealthVSummary as a compact text block for V system context.
 * Only includes fields that are present — never invents missing data.
 */
export function healthSummaryToPrompt(summary: HealthVSummary): string {
  const lines: string[] = []

  lines.push(`HEALTH DATA (${summary.periodStart} → ${summary.periodEnd}):`)

  if (summary.today) {
    const t = summary.today
    const parts: string[] = []
    if (t.steps           !== undefined) parts.push(`${t.steps.toLocaleString()} steps`)
    if (t.activeEnergyKcal !== undefined) parts.push(`${Math.round(t.activeEnergyKcal)} kcal active energy`)
    if (parts.length > 0) lines.push(`  Today: ${parts.join(' · ')}`)
  }

  if (summary.dailySteps.length > 0) {
    const recent = summary.dailySteps.slice(-7)
    const avg = Math.round(recent.reduce((s, d) => s + d.steps, 0) / recent.length)
    lines.push(`  Avg daily steps (last ${recent.length}d): ${avg.toLocaleString()}`)
  }

  if (summary.latestWeightKg !== undefined) {
    lines.push(`  Body weight: ${summary.latestWeightKg} kg (${summary.latestWeightDate})`)
  }

  if (summary.recentActivities.length > 0) {
    lines.push('  Recent activities:')
    for (const a of summary.recentActivities.slice(0, 5)) {
      const parts: string[] = [a.date, a.title ?? a.activityType]
      if (a.durationMinutes)  parts.push(`${a.durationMinutes} min`)
      if (a.avgHeartRateBpm)  parts.push(`avg HR ${a.avgHeartRateBpm} bpm`)
      if (a.activeEnergyKcal) parts.push(`${Math.round(a.activeEnergyKcal)} kcal`)
      lines.push(`    • ${parts.join(' · ')}`)
    }
  }

  return lines.join('\n')
}
