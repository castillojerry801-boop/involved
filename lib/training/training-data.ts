import { prisma } from '@/lib/prisma'

export async function getTrainingData(userId: string) {
  try {
    const [recent, planned, allPrograms, templateCount, inProgressWorkout] = await Promise.all([
      // Completed workouts only — in-progress is fetched and displayed separately
      prisma.workout.findMany({
        where: { userId, status: 'completed' },
        orderBy: { completedAt: 'desc' },
        take: 2,
        include: {
          exercises: { select: { exerciseId: true }, take: 3 },
        },
      }),
      prisma.workout.findMany({
        where: { userId, status: 'planned' },
        orderBy: { scheduledDate: 'asc' },
        take: 3,
        include: {
          exercises: { select: { exerciseId: true }, take: 3 },
        },
      }),
      prisma.program.findMany({
        where: { userId },
        orderBy: [{ isActive: 'desc' }, { updatedAt: 'desc' }],
        take: 5,
        include: {
          days: {
            orderBy: { sortOrder: 'asc' },
            include: { _count: { select: { exercises: true } } },
          },
        },
      }),
      prisma.workoutTemplate.count({ where: { userId } }),
      // Separate findFirst ensures the in-progress session surfaces regardless of how
      // many completed workouts exist. Sorted by updatedAt so the most recently active
      // session (not just most recently started) is returned.
      prisma.workout.findFirst({
        where: { userId, status: 'in_progress' },
        orderBy: { updatedAt: 'desc' },
        include: { exercises: { select: { exerciseId: true }, take: 3 } },
      }),
    ])
    const activeProgram = allPrograms.find(p => p.isActive) ?? null
    return {
      recent,
      planned,
      activeProgram,
      allPrograms,
      templateCount,
      inProgressWorkout: inProgressWorkout ?? null,
    }
  } catch {
    return {
      recent: [],
      planned: [],
      activeProgram: null,
      allPrograms: [],
      templateCount: 0,
      inProgressWorkout: null,
    }
  }
}
