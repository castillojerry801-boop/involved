/**
 * Cron: cleanup-meal-refs — endpoint security and correctness
 *
 * Covers:
 *   Authorization
 *     1. Missing Authorization header → 401
 *     2. Wrong Bearer secret → 401
 *     3. Correct Bearer secret → 200
 *     4. CRON_SECRET env var not set → 500 (server misconfiguration)
 *
 *   Cleanup logic
 *     5. Deletes rows with expiresAt < now across all users
 *     6. Reports the deleted row count in the response body
 *     7. DB error → 500 (does not throw)
 *
 *   Schedule compatibility
 *     8. vercel.json cron path matches the route path
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Hoisted mocks ────────────────────────────────────────────────────────────

const { mockPrisma } = vi.hoisted(() => {
  const mockPrisma = {
    mealCalculationRef: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  }
  return { mockPrisma }
})

vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }))

// ── Late imports ─────────────────────────────────────────────────────────────

import { GET } from '../../app/api/cron/cleanup-meal-refs/route'

// ── Fixtures ─────────────────────────────────────────────────────────────────

const VALID_SECRET = 'test-cron-secret-abc123'

function makeReq(authHeader?: string): Request {
  return new Request('http://localhost/api/cron/cleanup-meal-refs', {
    headers: authHeader ? { authorization: authHeader } : {},
  })
}

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('CRON_SECRET', VALID_SECRET)
  mockPrisma.mealCalculationRef.deleteMany.mockResolvedValue({ count: 0 })
})

// ── Tests ────────────────────────────────────────────────────────────────────

describe('cleanup-meal-refs — authorization', () => {
  // 1
  it('missing Authorization header → 401', async () => {
    const res = await GET(makeReq() as never)
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBeTruthy()
  })

  // 2
  it('wrong Bearer secret → 401', async () => {
    const res = await GET(makeReq('Bearer wrong-secret') as never)
    expect(res.status).toBe(401)
  })

  // 3
  it('correct Bearer secret → 200', async () => {
    const res = await GET(makeReq(`Bearer ${VALID_SECRET}`) as never)
    expect(res.status).toBe(200)
  })

  // 4 — Fail-closed: missing CRON_SECRET must return 401, not 200 or a status that
  // distinguishes "not configured" from "wrong secret" (information leak).
  it('CRON_SECRET not set → 401 (fails closed, does not leak configuration state)', async () => {
    vi.stubEnv('CRON_SECRET', '')
    const res = await GET(makeReq(`Bearer ${VALID_SECRET}`) as never)
    expect(res.status).toBe(401)
    // Response body must not describe the server-side misconfiguration
    const body = await res.json()
    expect(JSON.stringify(body)).not.toContain('misconfiguration')
    expect(JSON.stringify(body)).not.toContain('not set')
  })
})

describe('cleanup-meal-refs — cleanup logic', () => {
  // 5
  it('deleteMany targets rows with expiresAt < now (cross-user sweep)', async () => {
    mockPrisma.mealCalculationRef.deleteMany.mockResolvedValue({ count: 7 })
    await GET(makeReq(`Bearer ${VALID_SECRET}`) as never)

    expect(mockPrisma.mealCalculationRef.deleteMany).toHaveBeenCalledOnce()
    const [call] = mockPrisma.mealCalculationRef.deleteMany.mock.calls
    // Must target expiresAt < now — no userId filter (cross-user sweep)
    expect(call[0].where).toHaveProperty('expiresAt')
    expect(call[0].where.expiresAt).toHaveProperty('lt')
    expect(call[0].where).not.toHaveProperty('userId')
  })

  // 6
  it('response body includes deleted count', async () => {
    mockPrisma.mealCalculationRef.deleteMany.mockResolvedValue({ count: 13 })
    const res = await GET(makeReq(`Bearer ${VALID_SECRET}`) as never)
    const body = await res.json()
    expect(body.deleted).toBe(13)
  })

  // 7
  it('DB error → 500, does not throw', async () => {
    mockPrisma.mealCalculationRef.deleteMany.mockRejectedValue(new Error('Connection timeout'))
    const res = await GET(makeReq(`Bearer ${VALID_SECRET}`) as never)
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBeTruthy()
  })
})

describe('cleanup-meal-refs — schedule config', () => {
  // 8
  it('vercel.json cron path matches the route path', async () => {
    const { readFileSync } = await import('fs')
    const { resolve } = await import('path')
    const vercelJson = JSON.parse(
      readFileSync(resolve(process.cwd(), 'vercel.json'), 'utf-8'),
    ) as { crons: { path: string; schedule: string }[] }

    const cronEntry = vercelJson.crons.find(c => c.path === '/api/cron/cleanup-meal-refs')
    expect(cronEntry).toBeDefined()
    // Verify schedule is set (daily is compatible with Hobby plan)
    expect(cronEntry!.schedule).toBeTruthy()
  })
})
