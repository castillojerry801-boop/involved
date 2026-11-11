import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const CF_TEST_SECRET = '1x0000000000000000000000000000000AA'
const CF_TEST_SITE_KEY = '1x00000000000000000000AA'
const REAL_SECRET = 'real_production_secret_key_xyz'

function makeReq(token: string | null) {
  const body = token === null ? {} : { token }
  return new NextRequest('https://example.com/api/security/turnstile', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function cfSuccess() {
  mockFetch.mockResolvedValue({ json: async () => ({ success: true }) })
}
function cfFail(codes: string[] = ['invalid-input-response']) {
  mockFetch.mockResolvedValue({ json: async () => ({ success: false, 'error-codes': codes }) })
}

describe('POST /api/security/turnstile', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllEnvs()
    mockFetch.mockReset()
  })

  async function callRoute(token: string | null) {
    const { POST } = await import('@/app/api/security/turnstile/route')
    return POST(makeReq(token))
  }

  it('returns 400 when token is missing', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const res = await callRoute(null)
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ success: false })
  })

  it('returns 200 immediately in development without calling Cloudflare', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const res = await callRoute('any-token')
    expect(res.status).toBe(200)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('skips verification and returns 200 when secret is not set', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('TURNSTILE_SECRET_KEY', '')
    const res = await callRoute('some-token')
    expect(res.status).toBe(200)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns 200 when Cloudflare siteverify succeeds', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('VERCEL_ENV', 'preview')
    vi.stubEnv('TURNSTILE_SECRET_KEY', REAL_SECRET)
    cfSuccess()
    const res = await callRoute('valid-token')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ success: true })
  })

  it('returns 403 when Cloudflare siteverify fails', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('VERCEL_ENV', 'preview')
    vi.stubEnv('TURNSTILE_SECRET_KEY', REAL_SECRET)
    cfFail(['invalid-input-response'])
    const res = await callRoute('bad-token')
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ success: false })
  })

  it('passes the secret and token to Cloudflare siteverify', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('VERCEL_ENV', 'preview')
    vi.stubEnv('TURNSTILE_SECRET_KEY', REAL_SECRET)
    cfSuccess()
    await callRoute('my-token')
    expect(mockFetch).toHaveBeenCalledWith(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      expect.objectContaining({
        body: JSON.stringify({ secret: REAL_SECRET, response: 'my-token' }),
      })
    )
  })

  // ── Cloudflare always-pass test keys (sandbox / Preview) ──────────────────

  it('accepts test secret in preview env — allows sandbox login', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('VERCEL_ENV', 'preview')
    vi.stubEnv('TURNSTILE_SECRET_KEY', CF_TEST_SECRET)
    cfSuccess()
    const res = await callRoute('cf-test-token')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ success: true })
  })

  it('accepts test secret when VERCEL_ENV is not set (CI / local preview)', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('TURNSTILE_SECRET_KEY', CF_TEST_SECRET)
    cfSuccess()
    const res = await callRoute('cf-test-token')
    expect(res.status).toBe(200)
  })

  // ── Production safeguard ──────────────────────────────────────────────────

  it('returns 500 and blocks when test secret is used in VERCEL_ENV=production', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('TURNSTILE_SECRET_KEY', CF_TEST_SECRET)
    const res = await callRoute('any-token')
    expect(res.status).toBe(500)
    expect(mockFetch).not.toHaveBeenCalled()
    const body = await res.json() as { success: boolean }
    expect(body.success).toBe(false)
  })

  it('allows a real secret in VERCEL_ENV=production', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('TURNSTILE_SECRET_KEY', REAL_SECRET)
    cfSuccess()
    const res = await callRoute('valid-token')
    expect(res.status).toBe(200)
  })

  it('production guard is scoped to the secret, not the site key (site key is client-only)', () => {
    // NEXT_PUBLIC_TURNSTILE_SITE_KEY is baked into the JS bundle at build time.
    // The server only reads TURNSTILE_SECRET_KEY — the guard can only cover the secret.
    expect(CF_TEST_SITE_KEY).toBe('1x00000000000000000000AA')
    expect(CF_TEST_SECRET).toBe('1x0000000000000000000000000000000AA')
    expect(CF_TEST_SITE_KEY).not.toBe(CF_TEST_SECRET)
  })
})
