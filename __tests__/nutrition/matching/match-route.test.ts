import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Hoisted mocks ──────────────────────────────────────────────────────────────

const { mockSupabase, mockMatchIngredient } = vi.hoisted(() => {
  const mockSupabase = {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }),
    },
  }

  const mockMatchIngredient = vi.fn().mockResolvedValue({
    confidence: 'plausible',
    topMatch: {
      provider: 'usda_fooddata',
      externalId: 'usda-olive',
      name: 'Oil, olive',
      servingSize: 14,
      servingUnit: 'g',
      calories: 119,
      proteinG: 0,
      carbohydrateG: 0,
      fatG: 13.5,
      isGeneric: true,
      matchScore: 70,
      matchReasons: ['All query words match'],
    },
    alternatives: [],
  })

  return { mockSupabase, mockMatchIngredient }
})

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue(mockSupabase),
}))

vi.mock('@/lib/nutrition/matching/matcher', () => ({
  matchIngredient: mockMatchIngredient,
}))

import { POST } from '@/app/api/nutrition/match/route'

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeRequest(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost/api/nutrition/match', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('POST /api/nutrition/match', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    mockMatchIngredient.mockResolvedValue({
      confidence: 'plausible',
      topMatch: {
        provider: 'usda_fooddata',
        externalId: 'usda-olive',
        name: 'Oil, olive',
        servingSize: 14,
        servingUnit: 'g',
        calories: 119,
        proteinG: 0,
        carbohydrateG: 0,
        fatG: 13.5,
        isGeneric: true,
        matchScore: 70,
        matchReasons: [],
      },
      alternatives: [],
    })
  })

  it('returns 401 without auth session', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } })
    const req = makeRequest({ ingredientName: 'olive oil' })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('returns 400 for empty ingredientName', async () => {
    const req = makeRequest({ ingredientName: '' })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 400 for single-char ingredientName', async () => {
    const req = makeRequest({ ingredientName: 'a' })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 400 for missing ingredientName', async () => {
    const req = makeRequest({})
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 400 for sensitive query (email)', async () => {
    const req = makeRequest({ ingredientName: 'user@example.com' })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBeTruthy()
  })

  it('returns 200 with MatchResult shape for valid request', async () => {
    const req = makeRequest({ ingredientName: 'olive oil' })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('confidence')
    expect(body).toHaveProperty('topMatch')
    expect(body).toHaveProperty('alternatives')
    expect(['confident', 'plausible', 'ambiguous', 'no_match']).toContain(body.confidence)
  })

  it('returns 200 with no_match when provider fails (graceful degradation)', async () => {
    mockMatchIngredient.mockRejectedValue(new Error('Provider failure'))
    const req = makeRequest({ ingredientName: 'chicken breast' })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.confidence).toBe('no_match')
    expect(body.topMatch).toBeNull()
  })

  it('passes optional fields (quantity, unit, preparationState) to matchIngredient', async () => {
    const req = makeRequest({
      ingredientName: 'chicken breast',
      quantity: 200,
      unit: 'g',
      preparationState: 'raw',
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(mockMatchIngredient).toHaveBeenCalledWith({
      ingredientName: 'chicken breast',
      quantity: 200,
      unit: 'g',
      preparationState: 'raw',
    })
  })

  it('returns 400 for invalid JSON body', async () => {
    const req = new NextRequest('http://localhost/api/nutrition/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-valid-json',
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })
})
