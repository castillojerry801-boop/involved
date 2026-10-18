import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/admin/auth'

// How long each probe search is allowed to run.
const PROBE_TIMEOUT_MS = 6000
const PROBE_QUERY = 'apple'

// ── Probe rate limiting ───────────────────────────────────────────────────────
// Prevents rapid-fire probe calls from exhausting provider rate limits.
// In-memory per-instance: adequate for an admin diagnostic tool.
// Minimum 60 seconds between probe=true requests.
const MIN_PROBE_INTERVAL_MS = 60_000
let lastProbeAt = 0

type ProviderConfig = {
  name: string
  providerId: string
  configured: boolean
  configNote?: string
}

type ProbeResult = {
  status: 'ok' | 'empty' | 'timeout' | 'auth_fail' | 'ip_restricted' | 'http_error' | 'error'
  resultCount: number
  latencyMs: number
  httpStatus?: number
  sampleName?: string
  note?: string
}

function configuredProviders(): ProviderConfig[] {
  const hasFatSecret = !!(process.env.FATSECRET_CLIENT_ID && process.env.FATSECRET_CLIENT_SECRET)
  const hasUsda      = !!process.env.USDA_API_KEY
  const hasNutri     = !!(process.env.NUTRITIONIX_APP_ID && process.env.NUTRITIONIX_APP_KEY)

  return [
    {
      name: 'FatSecret',
      providerId: 'fatsecret',
      configured: hasFatSecret,
      configNote: hasFatSecret ? undefined : 'FATSECRET_CLIENT_ID / FATSECRET_CLIENT_SECRET missing',
    },
    {
      name: 'USDA FoodData Central',
      providerId: 'usda_fooddata',
      configured: hasUsda,
      configNote: hasUsda ? undefined : 'USDA_API_KEY missing',
    },
    {
      name: 'Open Food Facts',
      providerId: 'open_food_facts',
      configured: true, // no key required
    },
    {
      name: 'NIH DSLD',
      providerId: 'nih_dsld',
      configured: true,
      configNote: 'Registered in FOOD_PROVIDERS but excluded from matchIngredient (supplements only)',
    },
    {
      name: 'Nutritionix',
      providerId: 'nutritionix',
      configured: hasNutri,
      configNote: hasNutri
        ? 'Keys present but Nutritionix is NOT registered in FOOD_PROVIDERS — dead code'
        : 'Keys absent and NOT registered in FOOD_PROVIDERS — dead code',
    },
  ]
}

async function probeFatSecret(clientId: string, clientSecret: string): Promise<ProbeResult> {
  const start = Date.now()
  try {
    // Step 1: get token
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
    const controller1 = new AbortController()
    const t1 = setTimeout(() => controller1.abort(), PROBE_TIMEOUT_MS)
    let tokenData: { access_token: string } | null = null
    try {
      const res = await fetch('https://oauth.fatsecret.com/connect/token', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials&scope=basic',
        signal: controller1.signal,
      })
      if (!res.ok) {
        return { status: 'auth_fail', resultCount: 0, latencyMs: Date.now() - start, httpStatus: res.status, note: 'OAuth token request failed' }
      }
      tokenData = await res.json() as { access_token: string }
    } finally {
      clearTimeout(t1)
    }

    if (!tokenData?.access_token) {
      return { status: 'auth_fail', resultCount: 0, latencyMs: Date.now() - start, note: 'Token response missing access_token' }
    }

    // Step 2: search
    const controller2 = new AbortController()
    const t2 = setTimeout(() => controller2.abort(), PROBE_TIMEOUT_MS)
    try {
      const url = new URL('https://platform.fatsecret.com/rest/server.api')
      url.searchParams.set('method', 'foods.search')
      url.searchParams.set('search_expression', PROBE_QUERY)
      url.searchParams.set('max_results', '5')
      url.searchParams.set('format', 'json')

      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
        signal: controller2.signal,
      })

      if (!res.ok) {
        return {
          status: res.status === 429 ? 'http_error' : 'http_error',
          resultCount: 0,
          latencyMs: Date.now() - start,
          httpStatus: res.status,
        }
      }

      const data = await res.json() as {
        foods?: { food?: unknown[] | unknown }
        error?: { code: number; message: string }
      }

      if (data.error) {
        const note = data.error.code === 21
          ? 'Error 21: IP allowlist restriction (FatSecret requires a static IP allowlist). ' +
            'This may indicate your deployment IPs are not allowlisted. ' +
            'Verify FatSecret account settings before drawing conclusions.'
          : `API error ${data.error.code}: ${data.error.message}`
        return {
          status: data.error.code === 21 ? 'ip_restricted' : 'http_error',
          resultCount: 0,
          latencyMs: Date.now() - start,
          httpStatus: 200,
          errorCode: data.error.code,
          note,
        } as ProbeResult & { errorCode: number }
      }

      const foods = data.foods?.food
      const count = Array.isArray(foods) ? foods.length : (foods ? 1 : 0)
      const first = (Array.isArray(foods) ? foods[0] : foods) as Record<string, string> | undefined
      return {
        status: count > 0 ? 'ok' : 'empty',
        resultCount: count,
        latencyMs: Date.now() - start,
        sampleName: first?.food_name,
      }
    } finally {
      clearTimeout(t2)
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const isTimeout = msg.includes('abort')
    return {
      status: isTimeout ? 'timeout' : 'error',
      resultCount: 0,
      latencyMs: Date.now() - start,
      note: isTimeout ? 'Request timed out' : 'Unexpected error during probe',
    }
  }
}

async function probeUsda(apiKey: string): Promise<ProbeResult> {
  const start = Date.now()
  try {
    const params = new URLSearchParams({
      query:    PROBE_QUERY,
      api_key:  apiKey,
      pageSize: '5',
    })
    const url = `https://api.nal.usda.gov/fdc/v1/foods/search?${params.toString()}&dataType=Foundation,SR%20Legacy`

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
    try {
      const res = await fetch(url, { signal: controller.signal })
      if (!res.ok) {
        let note: string | undefined
        if (res.status === 400) {
          try { note = (await res.text()).slice(0, 200) } catch { /* ignore */ }
        }
        return { status: 'http_error', resultCount: 0, latencyMs: Date.now() - start, httpStatus: res.status, note }
      }
      const data = await res.json() as { foods?: Array<{ description: string }> }
      const count = data.foods?.length ?? 0
      return {
        status: count > 0 ? 'ok' : 'empty',
        resultCount: count,
        latencyMs: Date.now() - start,
        sampleName: data.foods?.[0]?.description,
      }
    } finally {
      clearTimeout(timer)
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const isTimeout = msg.includes('abort')
    return {
      status: isTimeout ? 'timeout' : 'error',
      resultCount: 0,
      latencyMs: Date.now() - start,
      note: isTimeout ? 'Request timed out' : 'Unexpected error during probe',
    }
  }
}

async function probeOpenFoodFacts(): Promise<ProbeResult> {
  const start = Date.now()
  try {
    const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${PROBE_QUERY}&search_simple=1&action=process&json=1&page_size=5&fields=product_name`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'InvolvedApp/1.0 (https://involvedfit.com; support@involvedfit.com)' },
        signal: controller.signal,
      })
      if (!res.ok) {
        return { status: 'http_error', resultCount: 0, latencyMs: Date.now() - start, httpStatus: res.status }
      }
      const data = await res.json() as { products?: Array<{ product_name?: string }> }
      const count = data.products?.length ?? 0
      return {
        status: count > 0 ? 'ok' : 'empty',
        resultCount: count,
        latencyMs: Date.now() - start,
        sampleName: data.products?.[0]?.product_name,
      }
    } finally {
      clearTimeout(timer)
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const isTimeout = msg.includes('abort')
    return {
      status: isTimeout ? 'timeout' : 'error',
      resultCount: 0,
      latencyMs: Date.now() - start,
      note: isTimeout ? 'Request timed out' : 'Unexpected error during probe',
    }
  }
}

/**
 * GET /api/admin/nutrition-health
 * Returns provider configuration and optionally live probe results.
 *
 * Query params:
 *   probe=true  — run live test searches against each configured provider (default: false)
 *
 * Access: admin only (ADMIN_USER_IDS env var). Returns 403 for non-admin authenticated users
 * and for unauthenticated requests.
 *
 * Rate limiting: probe=true requests are throttled to one per 60 seconds per instance
 * to avoid burning provider rate limits. Returns 429 with Retry-After on violation.
 *
 * Security:
 *   - Never returns credentials, tokens, or API keys (not even masked)
 *   - sampleName returns the first result food name (e.g. "Apple") — not user data
 *   - Probe status fields describe technical HTTP/API outcomes, not customer data
 *   - note fields are informational; Error 21 note is factual about the error code,
 *     not a conclusion about deployment architecture
 *
 * Provider status interpretation:
 *   A status of 'ok' confirms the probe query returned results at query time.
 *   A status of 'auth_fail' or 'ip_restricted' confirms the probe failed.
 *   Key presence (configured=true) does NOT imply the provider is functional.
 *   Do not draw conclusions about production reliability from a single probe run.
 */
export async function GET(req: NextRequest) {
  const user = await getUser()
  if (!user || !isAdmin(user.id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const runProbe = req.nextUrl.searchParams.get('probe') === 'true'
  const providers = configuredProviders()

  // ── Rate limit probe calls ────────────────────────────────────────────────────
  // Probe runs count against provider rate limits. Enforce a minimum interval.
  if (runProbe) {
    const now = Date.now()
    const elapsed = now - lastProbeAt
    if (elapsed < MIN_PROBE_INTERVAL_MS) {
      const retryAfterSec = Math.ceil((MIN_PROBE_INTERVAL_MS - elapsed) / 1000)
      return NextResponse.json(
        { error: 'Probe rate limit: too many requests. Retry after probe cooldown.', retryAfterSeconds: retryAfterSec },
        { status: 429, headers: { 'Retry-After': String(retryAfterSec) } },
      )
    }
    lastProbeAt = now
  }

  if (!runProbe) {
    return NextResponse.json({
      ts: new Date().toISOString(),
      probeQuery: null,
      providers: providers.map(p => ({
        name: p.name,
        providerId: p.providerId,
        configured: p.configured,
        configNote: p.configNote,
        probe: null,
      })),
      notes: [
        'Pass ?probe=true to run live test searches against each configured provider.',
        'Live probes count against provider rate limits. Use sparingly.',
      ],
    })
  }

  // Run probes in parallel
  const clientId     = process.env.FATSECRET_CLIENT_ID ?? ''
  const clientSecret = process.env.FATSECRET_CLIENT_SECRET ?? ''
  const usdaKey      = process.env.USDA_API_KEY ?? ''

  const [fsProbe, usdaProbe, offProbe] = await Promise.all([
    clientId && clientSecret ? probeFatSecret(clientId, clientSecret) : Promise.resolve<ProbeResult>({ status: 'auth_fail', resultCount: 0, latencyMs: 0, note: 'Credentials not configured' }),
    usdaKey                  ? probeUsda(usdaKey)                      : Promise.resolve<ProbeResult>({ status: 'auth_fail', resultCount: 0, latencyMs: 0, note: 'USDA_API_KEY not configured' }),
    probeOpenFoodFacts(),
  ])

  const probeMap: Record<string, ProbeResult | null> = {
    fatsecret:       fsProbe,
    usda_fooddata:   usdaProbe,
    open_food_facts: offProbe,
    nih_dsld:        null,
    nutritionix:     null,
  }

  return NextResponse.json({
    ts: new Date().toISOString(),
    probeQuery: PROBE_QUERY,
    providers: providers.map(p => ({
      name: p.name,
      providerId: p.providerId,
      configured: p.configured,
      configNote: p.configNote,
      probe: probeMap[p.providerId] ?? null,
    })),
  })
}
