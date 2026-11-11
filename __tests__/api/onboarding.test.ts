import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Supabase auth mock ────────────────────────────────────────────────────────

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

// ── Prisma mock ───────────────────────────────────────────────────────────────
// vi.mock is hoisted before variable declarations, so fns must be created inside
// the factory. Retrieve them via the imported prisma after the mock is set up.

vi.mock('@/lib/prisma', () => ({
  prisma: {
    profile:          { upsert: vi.fn(), findUnique: vi.fn() },
    goal:             { create: vi.fn() },
    weeklyTarget:     { upsert: vi.fn() },
    equipmentProfile: { create: vi.fn() },
  },
}))

import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { POST, GET } from '@/app/api/onboarding/route'

const mockCreateClient     = createClient as ReturnType<typeof vi.fn>
const mockProfileUpsert    = prisma.profile.upsert    as ReturnType<typeof vi.fn>
const mockProfileFindUnique = prisma.profile.findUnique as ReturnType<typeof vi.fn>
const mockGoalCreate       = prisma.goal.create        as ReturnType<typeof vi.fn>
const mockWeeklyTargetUpsert = prisma.weeklyTarget.upsert as ReturnType<typeof vi.fn>
const mockEquipmentCreate  = prisma.equipmentProfile.create as ReturnType<typeof vi.fn>

function mockAuth(userId: string | null) {
  mockCreateClient.mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: userId ? { id: userId } : null },
      }),
    },
  } as never)
}

function makePost(body: unknown) {
  return new NextRequest('http://localhost/api/onboarding', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const VALID_BODY = {
  displayName:    'Test User',
  fitnessLevel:   'beginner',
  goalType:       'strength',
  goalTitle:      'Get stronger',
  equipment:      [],
  weeklyWorkouts: 3,
}

beforeEach(() => {
  vi.clearAllMocks()
  mockProfileUpsert.mockResolvedValue({ id: 'user-1' })
  mockGoalCreate.mockResolvedValue({ id: 'goal-1' })
  mockWeeklyTargetUpsert.mockResolvedValue({ id: 'wt-1' })
  mockEquipmentCreate.mockResolvedValue({ id: 'eq-1' })
  mockProfileFindUnique.mockResolvedValue(null)
})

// ── Auth guard ────────────────────────────────────────────────────────────────

describe('POST /api/onboarding — auth', () => {
  it('returns 401 when user is not authenticated', async () => {
    mockAuth(null)
    const res = await POST(makePost(VALID_BODY))
    expect(res.status).toBe(401)
  })
})

// ── Input validation ──────────────────────────────────────────────────────────

describe('POST /api/onboarding — validation', () => {
  beforeEach(() => mockAuth('user-1'))

  it('returns 400 when displayName is missing', async () => {
    const res = await POST(makePost({ ...VALID_BODY, displayName: '' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when fitnessLevel is invalid', async () => {
    const res = await POST(makePost({ ...VALID_BODY, fitnessLevel: 'elite' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when goalTitle is missing', async () => {
    const res = await POST(makePost({ ...VALID_BODY, goalTitle: '' }))
    expect(res.status).toBe(400)
  })
})

// ── Core regression: sequential write order ───────────────────────────────────
//
// Root cause of the P2003 loop: profile.upsert and goal.create were inside the
// same Promise.all. When no profiles row existed, goal.create's FK check ran
// against a separate DB connection before profile.upsert committed → P2003.
//
// Fix: profile.upsert is now awaited sequentially before the Promise.all that
// writes goal and weekly_target.

describe('POST /api/onboarding — write ordering (P2003 regression)', () => {
  it('calls profile.upsert before goal.create when user has no profile', async () => {
    mockAuth('user-new')
    const callOrder: string[] = []

    mockProfileUpsert.mockImplementation(async () => {
      callOrder.push('profile.upsert')
      return { id: 'user-new' }
    })
    mockGoalCreate.mockImplementation(async () => {
      callOrder.push('goal.create')
      return { id: 'goal-new' }
    })
    mockWeeklyTargetUpsert.mockImplementation(async () => {
      callOrder.push('weeklyTarget.upsert')
      return { id: 'wt-new' }
    })

    const res = await POST(makePost(VALID_BODY))
    expect(res.status).toBe(200)

    // profile.upsert must be first — its commit must precede FK-dependent writes
    expect(callOrder[0]).toBe('profile.upsert')
    expect(callOrder.indexOf('profile.upsert')).toBeLessThan(callOrder.indexOf('goal.create'))
    expect(callOrder.indexOf('profile.upsert')).toBeLessThan(callOrder.indexOf('weeklyTarget.upsert'))
  })

  it('still creates profile and goal when profile already exists (update path)', async () => {
    mockAuth('user-existing')
    const res = await POST(makePost(VALID_BODY))
    expect(res.status).toBe(200)
    expect(mockProfileUpsert).toHaveBeenCalledOnce()
    expect(mockGoalCreate).toHaveBeenCalledOnce()
    expect(mockWeeklyTargetUpsert).toHaveBeenCalledOnce()
  })

  it('upserts profile with correct data from request body', async () => {
    mockAuth('user-abc')
    const body = { ...VALID_BODY, displayName: 'Alice', fitnessLevel: 'advanced', weightKg: 65, heightCm: 170 }
    const res = await POST(makePost(body))
    expect(res.status).toBe(200)
    expect(mockProfileUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where:  { id: 'user-abc' },
        create: expect.objectContaining({ id: 'user-abc', displayName: 'Alice', fitnessLevel: 'advanced', weightKg: 65, heightCm: 170 }),
      })
    )
  })

  it('creates goal with userId, type, title, and active status', async () => {
    mockAuth('user-abc')
    const body = { ...VALID_BODY, goalType: 'endurance', goalTitle: 'Run a marathon' }
    const res = await POST(makePost(body))
    expect(res.status).toBe(200)
    expect(mockGoalCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: 'user-abc', type: 'endurance', title: 'Run a marathon', status: 'active' }),
      })
    )
  })

  it('upserts weekly target with clamped weeklyWorkouts (10 → 7)', async () => {
    mockAuth('user-abc')
    const res = await POST(makePost({ ...VALID_BODY, weeklyWorkouts: 10 }))
    expect(res.status).toBe(200)
    expect(mockWeeklyTargetUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ targetValue: 7 }),
        update: expect.objectContaining({ targetValue: 7 }),
      })
    )
  })

  it('falls back to custom goalType for unknown values', async () => {
    mockAuth('user-abc')
    const res = await POST(makePost({ ...VALID_BODY, goalType: 'unknown_type' }))
    expect(res.status).toBe(200)
    expect(mockGoalCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: 'custom' }) })
    )
  })

  it('skips equipment profile creation when equipment array is empty', async () => {
    mockAuth('user-abc')
    await POST(makePost({ ...VALID_BODY, equipment: [] }))
    expect(mockEquipmentCreate).not.toHaveBeenCalled()
  })

  it('creates equipment profile when equipment is provided', async () => {
    mockAuth('user-abc')
    const res = await POST(makePost({ ...VALID_BODY, equipment: ['barbell', 'dumbbell'] }))
    expect(res.status).toBe(200)
    expect(mockEquipmentCreate).toHaveBeenCalledOnce()
  })
})

// ── GET /api/onboarding ───────────────────────────────────────────────────────

describe('GET /api/onboarding', () => {
  it('returns 401 when unauthenticated', async () => {
    mockAuth(null)
    const res = await GET()
    expect(res.status).toBe(401)
  })

  it('returns complete:true when profile has fitnessLevel', async () => {
    mockAuth('user-1')
    mockProfileFindUnique.mockResolvedValue({ fitnessLevel: 'beginner', displayName: 'Alice' })
    const res = await GET()
    const body = await res.json() as { complete: boolean }
    expect(body.complete).toBe(true)
  })

  it('returns complete:false when profile has no fitnessLevel', async () => {
    mockAuth('user-1')
    mockProfileFindUnique.mockResolvedValue({ fitnessLevel: null, displayName: null })
    const res = await GET()
    const body = await res.json() as { complete: boolean }
    expect(body.complete).toBe(false)
  })

  it('returns complete:false when profile does not exist', async () => {
    mockAuth('user-1')
    mockProfileFindUnique.mockResolvedValue(null)
    const res = await GET()
    const body = await res.json() as { complete: boolean }
    expect(body.complete).toBe(false)
  })
})
