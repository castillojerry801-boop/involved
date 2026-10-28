import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

// The $transaction mock passes the tx client back as the same nutritionTarget methods
// so existing mockFindFirst/mockCreate setups work unchanged inside transactions.
vi.mock('@/lib/prisma', () => {
  const nutritionTarget = {
    findFirst: vi.fn(),
    create: vi.fn(),
  }
  return {
    prisma: {
      $transaction: vi.fn((fn: (tx: { nutritionTarget: typeof nutritionTarget }) => unknown) =>
        fn({ nutritionTarget }),
      ),
      nutritionTarget,
    },
  }
})

import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { GET, POST } from '../../app/api/nutrition/targets/route'
import { NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'

const mockCreateClient = createClient as ReturnType<typeof vi.fn>
const mockFindFirst = prisma.nutritionTarget.findFirst as ReturnType<typeof vi.fn>
const mockCreate = prisma.nutritionTarget.create as ReturnType<typeof vi.fn>
const mockTransaction = prisma.$transaction as ReturnType<typeof vi.fn>

function mockAuth(userId: string | null) {
  mockCreateClient.mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: userId ? { id: userId } : null },
      }),
    },
  } as never)
}

function makeGetRequest() {
  return new NextRequest('http://localhost/api/nutrition/targets', { method: 'GET' })
}

function makePostRequest(body: unknown) {
  return new NextRequest('http://localhost/api/nutrition/targets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const VALID_BODY = {
  calories: 2000,
  proteinG: 150,
  carbohydrateG: 250,
  fatG: 65,
}

const FULL_TARGET = {
  id: 'tgt_1',
  userId: 'user_abc',
  effectiveDate: new Date('2026-01-01'),
  ...VALID_BODY,
  fiberG: 28,
  sugarG: 50,
  sodiumMg: 2300,
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ── GET ─────────────────────────────────────────────────────────────────────────

describe('GET /api/nutrition/targets', () => {
  it('returns 401 when unauthenticated', async () => {
    mockAuth(null)
    const res = await GET(makeGetRequest())
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ error: 'Unauthorized' })
  })

  it('returns null target when user has no saved target', async () => {
    mockAuth('user_abc')
    mockFindFirst.mockResolvedValue(null)

    const res = await GET(makeGetRequest())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ target: null })
  })

  it('returns the most recent target with all fields', async () => {
    mockAuth('user_abc')
    mockFindFirst.mockResolvedValue(FULL_TARGET)

    const res = await GET(makeGetRequest())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.target.calories).toBe(2000)
    expect(body.target.fiberG).toBe(28)
    expect(body.target.sodiumMg).toBe(2300)
  })

  // Regression: Prisma Decimal fields serialize as strings in JSON. The GET
  // response must convert them to numbers so callers can safely spread them
  // into a POST payload without hitting the "must be a number" validation.
  it('serializes Decimal string values from Prisma as JS numbers', async () => {
    mockAuth('user_abc')
    // Simulate what Prisma actually returns for Decimal columns: string-like objects
    // whose valueOf()/toString() return the decimal string.
    mockFindFirst.mockResolvedValue({
      ...FULL_TARGET,
      calories: '2000.00',
      proteinG: '150.00',
      carbohydrateG: '130.00',
      fatG: '65.00',
      fiberG: '28.00',
      sugarG: '50.00',
      sodiumMg: '2300.00',
    })

    const res = await GET(makeGetRequest())
    expect(res.status).toBe(200)
    const { target } = await res.json()
    expect(typeof target.calories).toBe('number')
    expect(typeof target.proteinG).toBe('number')
    expect(typeof target.carbohydrateG).toBe('number')
    expect(typeof target.fatG).toBe('number')
    expect(typeof target.fiberG).toBe('number')
    expect(typeof target.sugarG).toBe('number')
    expect(typeof target.sodiumMg).toBe('number')
    expect(target.calories).toBe(2000)
    expect(target.proteinG).toBe(150)
    expect(target.carbohydrateG).toBe(130)
    expect(target.fatG).toBe(65)
  })

  it('serializes null optional Decimal fields as null', async () => {
    mockAuth('user_abc')
    mockFindFirst.mockResolvedValue({
      ...FULL_TARGET,
      calories: '2000.00',
      proteinG: '150.00',
      carbohydrateG: '130.00',
      fatG: '65.00',
      fiberG: null,
      sugarG: null,
      sodiumMg: null,
    })

    const res = await GET(makeGetRequest())
    const { target } = await res.json()
    expect(target.fiberG).toBeNull()
    expect(target.sugarG).toBeNull()
    expect(target.sodiumMg).toBeNull()
  })

  it('queries by userId ordered by effectiveDate desc', async () => {
    mockAuth('user_abc')
    mockFindFirst.mockResolvedValue(FULL_TARGET)

    await GET(makeGetRequest())
    expect(mockFindFirst).toHaveBeenCalledWith({
      where: { userId: 'user_abc' },
      orderBy: { effectiveDate: 'desc' },
    })
  })
})

// ── POST ────────────────────────────────────────────────────────────────────────

describe('POST /api/nutrition/targets', () => {
  it('returns 401 when unauthenticated', async () => {
    mockAuth(null)
    const res = await POST(makePostRequest(VALID_BODY))
    expect(res.status).toBe(401)
  })

  it('creates and returns a target for valid payload', async () => {
    mockAuth('user_abc')
    mockCreate.mockResolvedValue({ id: 'tgt_2', userId: 'user_abc', ...VALID_BODY, fiberG: null, sugarG: null, sodiumMg: null })

    const res = await POST(makePostRequest(VALID_BODY))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.target.calories).toBe(2000)
  })

  it('preserves optional fiberG/sugarG/sodiumMg when provided', async () => {
    mockAuth('user_abc')
    const fullBody = { ...VALID_BODY, fiberG: 28, sugarG: 50, sodiumMg: 2300 }
    mockCreate.mockResolvedValue({ id: 'tgt_3', userId: 'user_abc', ...fullBody })

    const res = await POST(makePostRequest(fullBody))
    expect(res.status).toBe(201)
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ fiberG: 28, sugarG: 50, sodiumMg: 2300 }),
      }),
    )
  })

  it('stores null for optional fields when omitted', async () => {
    mockAuth('user_abc')
    mockCreate.mockResolvedValue({ id: 'tgt_4', userId: 'user_abc', ...VALID_BODY, fiberG: null, sugarG: null, sodiumMg: null })

    await POST(makePostRequest(VALID_BODY))
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ fiberG: null, sugarG: null, sodiumMg: null }),
      }),
    )
  })

  // ── Validation: calories ────────────────────────────────────────────────────

  it('rejects NaN calories', async () => {
    mockAuth('user_abc')
    const res = await POST(makePostRequest({ ...VALID_BODY, calories: NaN }))
    expect(res.status).toBe(422)
    expect((await res.json()).error).toMatch(/calories/)
  })

  it('rejects Infinity calories', async () => {
    mockAuth('user_abc')
    const res = await POST(makePostRequest({ ...VALID_BODY, calories: Infinity }))
    expect(res.status).toBe(422)
    expect((await res.json()).error).toMatch(/calories/)
  })

  it('rejects negative calories', async () => {
    mockAuth('user_abc')
    const res = await POST(makePostRequest({ ...VALID_BODY, calories: -100 }))
    expect(res.status).toBe(422)
    expect((await res.json()).error).toMatch(/calories/)
  })

  it('rejects 0 calories', async () => {
    mockAuth('user_abc')
    const res = await POST(makePostRequest({ ...VALID_BODY, calories: 0 }))
    expect(res.status).toBe(422)
    expect((await res.json()).error).toMatch(/calories/)
  })

  it('rejects calories exceeding 15000', async () => {
    mockAuth('user_abc')
    const res = await POST(makePostRequest({ ...VALID_BODY, calories: 15001 }))
    expect(res.status).toBe(422)
    expect((await res.json()).error).toMatch(/calories/)
  })

  it('accepts calories at boundary 15000', async () => {
    mockAuth('user_abc')
    mockCreate.mockResolvedValue({ id: 't', userId: 'user_abc', ...VALID_BODY, calories: 15000, fiberG: null, sugarG: null, sodiumMg: null })
    const res = await POST(makePostRequest({ ...VALID_BODY, calories: 15000 }))
    expect(res.status).toBe(201)
  })

  // ── Validation: macros ──────────────────────────────────────────────────────

  it('rejects negative proteinG', async () => {
    mockAuth('user_abc')
    const res = await POST(makePostRequest({ ...VALID_BODY, proteinG: -1 }))
    expect(res.status).toBe(422)
    expect((await res.json()).error).toMatch(/proteinG/)
  })

  it('rejects proteinG above 2000', async () => {
    mockAuth('user_abc')
    const res = await POST(makePostRequest({ ...VALID_BODY, proteinG: 2001 }))
    expect(res.status).toBe(422)
    expect((await res.json()).error).toMatch(/proteinG/)
  })

  it('rejects NaN carbohydrateG', async () => {
    mockAuth('user_abc')
    const res = await POST(makePostRequest({ ...VALID_BODY, carbohydrateG: NaN }))
    expect(res.status).toBe(422)
    expect((await res.json()).error).toMatch(/carbohydrateG/)
  })

  it('rejects NaN fatG', async () => {
    mockAuth('user_abc')
    const res = await POST(makePostRequest({ ...VALID_BODY, fatG: NaN }))
    expect(res.status).toBe(422)
    expect((await res.json()).error).toMatch(/fatG/)
  })

  // ── Validation: optional fields ─────────────────────────────────────────────

  it('rejects fiberG above 500', async () => {
    mockAuth('user_abc')
    const res = await POST(makePostRequest({ ...VALID_BODY, fiberG: 501 }))
    expect(res.status).toBe(422)
    expect((await res.json()).error).toMatch(/fiberG/)
  })

  it('accepts fiberG at boundary 500', async () => {
    mockAuth('user_abc')
    mockCreate.mockResolvedValue({ id: 't', userId: 'user_abc', ...VALID_BODY, fiberG: 500, sugarG: null, sodiumMg: null })
    const res = await POST(makePostRequest({ ...VALID_BODY, fiberG: 500 }))
    expect(res.status).toBe(201)
  })

  it('accepts null optional fields explicitly', async () => {
    mockAuth('user_abc')
    mockCreate.mockResolvedValue({ id: 't', userId: 'user_abc', ...VALID_BODY, fiberG: null, sugarG: null, sodiumMg: null })
    const res = await POST(makePostRequest({ ...VALID_BODY, fiberG: null, sugarG: null, sodiumMg: null }))
    expect(res.status).toBe(201)
  })

  it('rejects sodiumMg above 50000', async () => {
    mockAuth('user_abc')
    const res = await POST(makePostRequest({ ...VALID_BODY, sodiumMg: 50001 }))
    expect(res.status).toBe(422)
    expect((await res.json()).error).toMatch(/sodiumMg/)
  })

  // ── Malformed requests ──────────────────────────────────────────────────────

  it('returns 400 for non-JSON body', async () => {
    mockAuth('user_abc')
    const req = new NextRequest('http://localhost/api/nutrition/targets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 422 for non-object body', async () => {
    mockAuth('user_abc')
    const req = new NextRequest('http://localhost/api/nutrition/targets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(42),
    })
    const res = await POST(req)
    expect(res.status).toBe(422)
  })

  // ── Stale target check ──────────────────────────────────────────────────────

  it('creates target when existingTargetId matches the current record', async () => {
    mockAuth('user_abc')
    mockFindFirst.mockResolvedValue({ id: 'tgt_current' })
    mockCreate.mockResolvedValue({ id: 'tgt_new', userId: 'user_abc', ...VALID_BODY, fiberG: null, sugarG: null, sodiumMg: null })

    const res = await POST(makePostRequest({ ...VALID_BODY, existingTargetId: 'tgt_current' }))
    expect(res.status).toBe(201)
    expect(mockCreate).toHaveBeenCalledTimes(1)
  })

  it('returns 409 when existingTargetId does not match the current record', async () => {
    mockAuth('user_abc')
    mockFindFirst.mockResolvedValue({ id: 'tgt_newer' })

    const res = await POST(makePostRequest({ ...VALID_BODY, existingTargetId: 'tgt_old' }))
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toMatch(/updated after/)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('returns 409 when existingTargetId is provided but user has no current target', async () => {
    mockAuth('user_abc')
    mockFindFirst.mockResolvedValue(null)

    // Caller thinks 'tgt_ghost' was the current target, but it no longer exists
    const res = await POST(makePostRequest({ ...VALID_BODY, existingTargetId: 'tgt_ghost' }))
    expect(res.status).toBe(409)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('skips stale check and creates target when existingTargetId is not provided', async () => {
    mockAuth('user_abc')
    mockCreate.mockResolvedValue({ id: 'tgt_new', userId: 'user_abc', ...VALID_BODY, fiberG: null, sugarG: null, sodiumMg: null })

    const res = await POST(makePostRequest(VALID_BODY))
    expect(res.status).toBe(201)
    // findFirst should not have been called for the stale check
    expect(mockFindFirst).not.toHaveBeenCalled()
    expect(mockCreate).toHaveBeenCalledTimes(1)
  })

  it('ignores existingTargetId when it is not a string or null', async () => {
    mockAuth('user_abc')
    mockCreate.mockResolvedValue({ id: 'tgt_new', userId: 'user_abc', ...VALID_BODY, fiberG: null, sugarG: null, sodiumMg: null })

    // a number value for existingTargetId is not a valid type — treat as absent
    const res = await POST(makePostRequest({ ...VALID_BODY, existingTargetId: 42 }))
    expect(res.status).toBe(201)
    expect(mockFindFirst).not.toHaveBeenCalled()
  })

  // ── First-time user: null existingTargetId ──────────────────────────────────

  it('creates target when existingTargetId is null and no record exists (first-time)', async () => {
    mockAuth('user_abc')
    mockFindFirst.mockResolvedValue(null)
    mockCreate.mockResolvedValue({ id: 'tgt_first', userId: 'user_abc', ...VALID_BODY, fiberG: null, sugarG: null, sodiumMg: null })

    const res = await POST(makePostRequest({ ...VALID_BODY, existingTargetId: null }))
    expect(res.status).toBe(201)
    expect(mockFindFirst).toHaveBeenCalledTimes(1)
    expect(mockCreate).toHaveBeenCalledTimes(1)
  })

  it('returns 409 when existingTargetId is null but a concurrent save created a record', async () => {
    mockAuth('user_abc')
    // A record appeared after the calculator opened (concurrent GoalsEditor save)
    mockFindFirst.mockResolvedValue({ id: 'tgt_concurrent' })

    const res = await POST(makePostRequest({ ...VALID_BODY, existingTargetId: null }))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/updated after/)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  // ── Prisma P2034 serialization failure maps to 409 ─────────────────────────

  it('returns 409 on a Prisma serialization failure (P2034)', async () => {
    mockAuth('user_abc')
    const serializationError = new Prisma.PrismaClientKnownRequestError(
      'Transaction failed due to a write conflict or a deadlock.',
      { code: 'P2034', clientVersion: '5.0.0' },
    )
    mockTransaction.mockRejectedValueOnce(serializationError)

    const res = await POST(makePostRequest(VALID_BODY))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/concurrent update/)
  })
})
