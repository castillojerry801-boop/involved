import 'server-only'
import { prisma } from '@/lib/prisma'
import type { TrackingType, SetType, FitnessLevel } from '@prisma/client'

// ─── Trainer program CRUD ─────────────────────────────────────────────────────

export interface CreateTrainerProgramInput {
  name:            string
  description?:    string
  level?:          FitnessLevel
  durationWeeks?:  number
  sessionsPerWeek?: number
  days: Array<{
    name:      string
    sortOrder: number
    exercises: Array<{
      exerciseId:   string
      sortOrder:    number
      trackingType: TrackingType
      notes?:       string
      restSeconds?: number
      sets: Array<{
        setNumber:             number
        setType?:              SetType
        targetRepsMin?:        number
        targetRepsMax?:        number
        targetWeightKg?:       number
        targetWeightPercent?:  number
        targetDurationSeconds?: number
        targetDistanceM?:      number
        targetRir?:            number
        restSeconds?:          number
        notes?:                string
      }>
    }>
  }>
}

export async function createTrainerProgram(
  trainerId: string,
  input:     CreateTrainerProgramInput,
) {
  return prisma.trainerProgram.create({
    data: {
      trainerId,
      name:            input.name,
      description:     input.description ?? null,
      level:           input.level ?? null,
      durationWeeks:   input.durationWeeks ?? null,
      sessionsPerWeek: input.sessionsPerWeek ?? null,
      days: {
        create: input.days.map(day => ({
          name:      day.name,
          sortOrder: day.sortOrder,
          exercises: {
            create: day.exercises.map(ex => ({
              exerciseId:   ex.exerciseId,
              sortOrder:    ex.sortOrder,
              trackingType: ex.trackingType,
              notes:        ex.notes ?? null,
              restSeconds:  ex.restSeconds ?? null,
              sets: {
                create: ex.sets.map(s => ({
                  setNumber:             s.setNumber,
                  setType:               s.setType ?? 'working',
                  targetRepsMin:         s.targetRepsMin ?? null,
                  targetRepsMax:         s.targetRepsMax ?? null,
                  targetWeightKg:        s.targetWeightKg ?? null,
                  targetWeightPercent:   s.targetWeightPercent ?? null,
                  targetDurationSeconds: s.targetDurationSeconds ?? null,
                  targetDistanceM:       s.targetDistanceM ?? null,
                  targetRir:             s.targetRir ?? null,
                  restSeconds:           s.restSeconds ?? null,
                  notes:                 s.notes ?? null,
                })),
              },
            })),
          },
        })),
      },
    },
    include: {
      days: {
        include: { exercises: { include: { sets: true } } },
        orderBy: { sortOrder: 'asc' },
      },
    },
  })
}

/**
 * Assign a trainer program to a client.
 *
 * Deep-copies the TrainerProgram into a new Program owned by the client.
 * The master template is never modified. Customizations on the assigned
 * copy are independent of the template and of other clients' copies.
 */
export async function assignProgramToClient(
  trainerId:       string,
  clientId:        string,
  trainerProgramId: string,
  overrides?: { name?: string; description?: string },
) {
  // Verify trainer owns this program
  const template = await prisma.trainerProgram.findUnique({
    where: { id: trainerProgramId },
    include: {
      days: {
        orderBy:  { sortOrder: 'asc' },
        include: {
          exercises: {
            orderBy: { sortOrder: 'asc' },
            include: { sets: { orderBy: { setNumber: 'asc' } } },
          },
        },
      },
    },
  })
  if (!template || template.trainerId !== trainerId) {
    throw new Error('Trainer program not found')
  }

  // Verify active trainer-client relationship
  const rel = await prisma.trainerClientRelationship.findUnique({
    where: { trainerId_clientId: { trainerId, clientId } },
  })
  if (!rel || rel.status !== 'active' || rel.revokedAt) {
    throw new Error('No active trainer-client relationship')
  }

  return prisma.program.create({
    data: {
      userId:                clientId,
      name:                  overrides?.name        ?? template.name,
      description:           overrides?.description ?? template.description,
      isActive:              false,
      trainerCreatedById:    trainerId,
      sourceTrainerProgramId: trainerProgramId,
      days: {
        create: template.days.map(day => ({
          name:      day.name,
          sortOrder: day.sortOrder,
          exercises: {
            create: day.exercises.map(ex => ({
              exerciseId:   ex.exerciseId,
              sortOrder:    ex.sortOrder,
              trackingType: ex.trackingType,
              notes:        ex.notes,
              restSeconds:  ex.restSeconds,
              sets: {
                create: ex.sets.map(s => ({
                  setNumber:             s.setNumber,
                  setType:               s.setType,
                  targetRepsMin:         s.targetRepsMin,
                  targetRepsMax:         s.targetRepsMax,
                  targetWeightKg:        s.targetWeightKg,
                  targetWeightPercent:   s.targetWeightPercent,
                  targetDurationSeconds: s.targetDurationSeconds,
                  targetDistanceM:       s.targetDistanceM,
                  targetRir:             s.targetRir,
                  restSeconds:           s.restSeconds,
                  notes:                 s.notes,
                })),
              },
            })),
          },
        })),
      },
    },
    include: { days: { include: { exercises: { include: { sets: true } } } } },
  })
}
