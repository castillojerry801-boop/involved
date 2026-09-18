import 'server-only'
import { prisma } from '@/lib/prisma'
import { getExerciseById } from '@/lib/exercises'

// Context V uses when a trainer asks about a client or their roster.
// Only data the trainer is authorized to access is included.
// V must not silently modify client data — produce drafts for trainer approval.

export interface TrainerClientSummary {
  clientId:      string
  displayName:   string | null
  joinedAt:      Date
  lastWorkout?:  { date: string; title: string }
  recentPRs:     Array<{ exerciseId: string; metric: string; value: number; unit: string; date: string }>
  weeklyTarget?: number
  workoutsThisWeek: number
  missedScheduled:  number
}

export interface VTrainerContext {
  trainerId:  string
  clients:    TrainerClientSummary[]
  // Populated when a specific client is in scope
  focusClient?: {
    clientId:    string
    displayName: string | null
    goals:       Array<{ type: string; title: string }>
    recentWorkouts: Array<{
      date:       string
      title:      string
      completed:  boolean
      totalSets:  number
      musclesWorked: string[]
    }>
    recentPRs:   Array<{ exerciseId: string; metric: string; value: number; unit: string; date: string }>
    trainerNotes: Array<{ content: string; createdAt: string; isPrivate: boolean }>
    targets:      Array<{ targetType: string; targetValue: number; unit: string }>
    pendingDrafts: number
  }
}

export async function buildVTrainerContext(
  trainerId: string,
  focusClientId?: string,
): Promise<VTrainerContext> {
  // Verify trainer access
  const trainerProfile = await prisma.trainerProfile.findUnique({
    where: { userId: trainerId },
    include: {
      clients: {
        where:   { status: 'active', revokedAt: null },
        include: { client: { select: { id: true, displayName: true } } },
        orderBy: { acceptedAt: 'asc' },
      },
    },
  })
  if (!trainerProfile) throw new Error('Trainer profile not found')

  const weekStart = new Date()
  weekStart.setDate(weekStart.getDate() - weekStart.getDay())
  weekStart.setHours(0, 0, 0, 0)

  const clients: TrainerClientSummary[] = await Promise.all(
    trainerProfile.clients.map(async rel => {
      const clientId = rel.clientId

      const [lastWorkout, recentPRs, weeklyWorkouts, missedWorkouts, weeklyTargetRow] = await Promise.all([
        prisma.workout.findFirst({
          where:   { userId: clientId, status: 'completed' },
          orderBy: { completedAt: 'desc' },
          select:  { completedAt: true, title: true },
        }),

        prisma.personalRecord.findMany({
          where:   { userId: clientId },
          orderBy: { achievedAt: 'desc' },
          take:    3,
        }),

        prisma.workout.count({
          where: { userId: clientId, status: 'completed', completedAt: { gte: weekStart } },
        }),

        prisma.workout.count({
          where: { userId: clientId, status: 'skipped', scheduledDate: { gte: weekStart } },
        }),

        prisma.weeklyTarget.findUnique({
          where: { userId_targetType: { userId: clientId, targetType: 'workouts_per_week' } },
        }),
      ])

      return {
        clientId,
        displayName:      rel.client.displayName,
        joinedAt:         rel.acceptedAt ?? rel.createdAt,
        lastWorkout:      lastWorkout
          ? { date: lastWorkout.completedAt!.toISOString().slice(0, 10), title: lastWorkout.title }
          : undefined,
        recentPRs: recentPRs.map(pr => ({
          exerciseId: pr.exerciseId,
          metric:     pr.metric,
          value:      Number(pr.value),
          unit:       pr.unit,
          date:       pr.achievedAt.toISOString().slice(0, 10),
        })),
        weeklyTarget:     weeklyTargetRow?.targetValue,
        workoutsThisWeek: weeklyWorkouts,
        missedScheduled:  missedWorkouts,
      } satisfies TrainerClientSummary
    })
  )

  const ctx: VTrainerContext = { trainerId, clients }

  if (focusClientId) {
    // Verify this client is actually on the trainer's active roster
    const isClient = clients.some(c => c.clientId === focusClientId)
    if (!isClient) throw new Error('UNAUTHORIZED')

    const [profile, goals, recentWorkouts, recentPRs, notes, targets, pendingDrafts] = await Promise.all([
      prisma.profile.findUnique({
        where:  { id: focusClientId },
        select: { displayName: true },
      }),

      prisma.goal.findMany({
        where:   { userId: focusClientId, status: 'active' },
        select:  { type: true, title: true },
        take:    5,
      }),

      prisma.workout.findMany({
        where:   { userId: focusClientId, status: { in: ['completed', 'skipped'] } },
        orderBy: { completedAt: 'desc' },
        take:    10,
        include: {
          exercises: {
            include: { sets: { where: { completed: true }, select: { id: true } } },
          },
        },
      }),

      prisma.personalRecord.findMany({
        where:   { userId: focusClientId },
        orderBy: { achievedAt: 'desc' },
        take:    5,
      }),

      prisma.trainerNote.findMany({
        where:   { trainerId, clientId: focusClientId },
        orderBy: { createdAt: 'desc' },
        take:    10,
      }),

      prisma.trainerClientTarget.findMany({
        where:   { trainerId, clientId: focusClientId },
        orderBy: { effectiveDate: 'desc' },
      }),

      prisma.vTrainerDraft.count({
        where: { trainerId, clientId: focusClientId, status: 'pending' },
      }),
    ])

    ctx.focusClient = {
      clientId:    focusClientId,
      displayName: profile?.displayName ?? null,
      goals:       goals.map(g => ({ type: g.type, title: g.title })),
      recentWorkouts: recentWorkouts.map(w => {
        const muscles = [...new Set(
          w.exercises.flatMap(we => {
            const ex = getExerciseById(we.exerciseId)
            return ex ? [ex.target] : []
          })
        )]
        return {
          date:          (w.completedAt ?? w.createdAt).toISOString().slice(0, 10),
          title:         w.title,
          completed:     w.status === 'completed',
          totalSets:     w.exercises.reduce((n, we) => n + we.sets.length, 0),
          musclesWorked: muscles,
        }
      }),
      recentPRs: recentPRs.map(pr => ({
        exerciseId: pr.exerciseId,
        metric:     pr.metric,
        value:      Number(pr.value),
        unit:       pr.unit,
        date:       pr.achievedAt.toISOString().slice(0, 10),
      })),
      trainerNotes: notes.map(n => ({
        content:   n.content,
        createdAt: n.createdAt.toISOString().slice(0, 10),
        isPrivate: n.isPrivate,
      })),
      targets: targets.map(t => ({
        targetType:  t.targetType,
        targetValue: Number(t.targetValue),
        unit:        t.unit,
      })),
      pendingDrafts,
    }
  }

  return ctx
}

export function trainerContextToPrompt(ctx: VTrainerContext): string {
  const lines: string[] = []

  lines.push(`TRAINER ROSTER: ${ctx.clients.length} active client(s)`)

  const missed = ctx.clients.filter(c => c.missedScheduled >= 2)
  if (missed.length > 0) {
    lines.push(`ATTENTION — clients with 2+ missed sessions this week: ${missed.map(c => c.displayName ?? c.clientId).join(', ')}`)
  }

  if (ctx.focusClient) {
    const fc = ctx.focusClient
    lines.push(`\nFOCUS CLIENT: ${fc.displayName ?? fc.clientId}`)

    if (fc.goals.length > 0) {
      lines.push('GOALS:')
      fc.goals.forEach(g => lines.push(`  • [${g.type}] ${g.title}`))
    }

    if (fc.targets.length > 0) {
      lines.push('TRAINER-SET TARGETS:')
      fc.targets.forEach(t => lines.push(`  • ${t.targetType}: ${t.targetValue} ${t.unit}`))
    }

    if (fc.recentWorkouts.length > 0) {
      lines.push('RECENT TRAINING (last 10):')
      fc.recentWorkouts.forEach(w => {
        const muscles = w.musclesWorked.join(', ') || 'unknown'
        const status  = w.completed ? '✓' : '✗'
        lines.push(`  ${status} ${w.date} — ${w.title} — ${muscles} — ${w.totalSets} sets`)
      })
    }

    if (fc.recentPRs.length > 0) {
      lines.push('RECENT PRS:')
      fc.recentPRs.forEach(pr => lines.push(`  • ${pr.exerciseId} ${pr.metric}: ${pr.value} ${pr.unit} (${pr.date})`))
    }

    if (fc.pendingDrafts > 0) {
      lines.push(`PENDING DRAFTS: ${fc.pendingDrafts} awaiting trainer review`)
    }
  }

  lines.push('\nIMPORTANT: Meaningful changes to client programming or targets must be returned as DRAFTS for trainer approval. Do not describe actions as completed.')

  return lines.join('\n')
}
