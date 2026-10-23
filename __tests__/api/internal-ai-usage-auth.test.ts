import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/ai/cost-reporting', () => ({
  generateAiUsageReport: vi.fn().mockResolvedValue({ billingPeriod: '2026-10', totalRequests: 0 }),
}))

import { GET } from '../../app/api/internal/ai-usage/route'
import { NextRequest } from 'next/server'

function makeRequest(headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost/api/internal/ai-usage', { headers })
}

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.INTERNAL_REPORTING_KEY
})

describe('GET /api/internal/ai-usage — key-only auth', () => {
  it('returns 401 when no key header is sent', async () => {
    const res = await GET(makeRequest())
    expect(res.status).toBe(401)
  })

  it('returns 401 when INTERNAL_REPORTING_KEY is not configured (even with a key header)', async () => {
    const res = await GET(makeRequest({ 'x-internal-key': 'any-key' }))
    expect(res.status).toBe(401)
  })

  it('returns 401 when key header does not match INTERNAL_REPORTING_KEY', async () => {
    process.env.INTERNAL_REPORTING_KEY = 'correct-secret-key'
    const res = await GET(makeRequest({ 'x-internal-key': 'wrong-key' }))
    expect(res.status).toBe(401)
  })

  it('returns 200 when key exactly matches INTERNAL_REPORTING_KEY', async () => {
    process.env.INTERNAL_REPORTING_KEY = 'correct-secret-key'
    const res = await GET(makeRequest({ 'x-internal-key': 'correct-secret-key' }))
    expect(res.status).toBe(200)
  })

  it('returns 401 for empty-string key header', async () => {
    process.env.INTERNAL_REPORTING_KEY = 'correct-secret-key'
    const res = await GET(makeRequest({ 'x-internal-key': '' }))
    expect(res.status).toBe(401)
  })

  it('returns 401 when key is a prefix of the configured key', async () => {
    process.env.INTERNAL_REPORTING_KEY = 'correct-secret-key'
    const res = await GET(makeRequest({ 'x-internal-key': 'correct-secret' }))
    expect(res.status).toBe(401)
  })

  it('returns 401 when key is a superset of the configured key', async () => {
    process.env.INTERNAL_REPORTING_KEY = 'correct-secret'
    const res = await GET(makeRequest({ 'x-internal-key': 'correct-secret-key' }))
    expect(res.status).toBe(401)
  })

  it('session-based access is not available — ordinary users cannot access even if authenticated', async () => {
    // No session mock needed: endpoint does not check sessions at all.
    // Without a key, all requests are denied regardless of caller identity.
    process.env.INTERNAL_REPORTING_KEY = 'correct-secret-key'
    const res = await GET(makeRequest({}))
    expect(res.status).toBe(401)
  })
})
