/**
 * Standalone provider health probe.
 *
 * Calls USDA FoodData Central, FatSecret, and Open Food Facts directly using
 * credentials from .env.local. Does NOT go through the Next.js server.
 *
 * Outputs a JSON summary of what actually happened at each provider.
 *
 * Run: npx tsx --env-file=.env.local scripts/probe-nutrition-providers.ts
 *
 * NEVER exposes credentials in output.
 */

const PROBE_QUERY = 'apple'
const TIMEOUT_MS  = 8000

interface ProbeResult {
  provider: string
  status: 'ok' | 'empty' | 'auth_fail' | 'ip_restricted' | 'http_error' | 'rate_limited' | 'timeout' | 'error'
  httpStatus?: number
  errorCode?: number
  resultCount: number
  latencyMs: number
  sampleName?: string
  note?: string
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('TIMEOUT')), ms)
    ),
  ])
}

// ── USDA FoodData Central ──────────────────────────────────────────────────────

async function probeUsda(): Promise<ProbeResult> {
  const apiKey = process.env.USDA_API_KEY
  if (!apiKey) {
    return { provider: 'usda_fooddata', status: 'auth_fail', resultCount: 0, latencyMs: 0, note: 'USDA_API_KEY not set' }
  }

  const start = Date.now()
  try {
    const params = new URLSearchParams({
      query:    PROBE_QUERY,
      api_key:  apiKey,
      pageSize: '5',
    })
    const url = `https://api.nal.usda.gov/fdc/v1/foods/search?${params}&dataType=Foundation,SR%20Legacy`

    const res = await withTimeout(fetch(url), TIMEOUT_MS)
    const latencyMs = Date.now() - start

    if (!res.ok) {
      let note: string | undefined
      if (res.status === 400) {
        try { note = (await res.text()).slice(0, 300) } catch { /* ignore */ }
      }
      return {
        provider: 'usda_fooddata',
        status: res.status === 429 ? 'rate_limited' : 'http_error',
        httpStatus: res.status,
        resultCount: 0,
        latencyMs,
        note,
      }
    }

    const data = await res.json() as { foods?: Array<{ description: string; dataType?: string }> }
    const count = data.foods?.length ?? 0
    return {
      provider:    'usda_fooddata',
      status:      count > 0 ? 'ok' : 'empty',
      resultCount: count,
      latencyMs,
      sampleName:  data.foods?.[0]?.description,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      provider:    'usda_fooddata',
      status:      msg.includes('TIMEOUT') ? 'timeout' : 'error',
      resultCount: 0,
      latencyMs:   Date.now() - start,
      note:        msg.includes('TIMEOUT') ? 'Request timed out' : msg,
    }
  }
}

// ── FatSecret ─────────────────────────────────────────────────────────────────

async function probeFatSecret(): Promise<ProbeResult> {
  const clientId     = process.env.FATSECRET_CLIENT_ID
  const clientSecret = process.env.FATSECRET_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    return { provider: 'fatsecret', status: 'auth_fail', resultCount: 0, latencyMs: 0, note: 'FATSECRET_CLIENT_ID / FATSECRET_CLIENT_SECRET not set' }
  }

  const start = Date.now()
  try {
    // Step 1: OAuth2 token
    const creds = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
    const tokenRes = await withTimeout(
      fetch('https://oauth.fatsecret.com/connect/token', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${creds}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials&scope=basic',
      }),
      TIMEOUT_MS,
    )

    if (!tokenRes.ok) {
      return {
        provider:    'fatsecret',
        status:      'auth_fail',
        httpStatus:  tokenRes.status,
        resultCount: 0,
        latencyMs:   Date.now() - start,
        note:        `OAuth token request failed: HTTP ${tokenRes.status}`,
      }
    }

    const tokenData = await tokenRes.json() as { access_token?: string }
    if (!tokenData.access_token) {
      return { provider: 'fatsecret', status: 'auth_fail', resultCount: 0, latencyMs: Date.now() - start, note: 'Token response missing access_token' }
    }

    // Step 2: Search
    const url = new URL('https://platform.fatsecret.com/rest/server.api')
    url.searchParams.set('method', 'foods.search')
    url.searchParams.set('search_expression', PROBE_QUERY)
    url.searchParams.set('max_results', '5')
    url.searchParams.set('format', 'json')

    const searchRes = await withTimeout(
      fetch(url.toString(), { headers: { Authorization: `Bearer ${tokenData.access_token}` } }),
      TIMEOUT_MS,
    )

    const latencyMs = Date.now() - start

    if (!searchRes.ok) {
      return {
        provider:    'fatsecret',
        status:      searchRes.status === 429 ? 'rate_limited' : 'http_error',
        httpStatus:  searchRes.status,
        resultCount: 0,
        latencyMs,
      }
    }

    const data = await searchRes.json() as {
      foods?: { food?: unknown[] | unknown }
      error?: { code: number; message: string }
    }

    if (data.error) {
      return {
        provider:    'fatsecret',
        status:      data.error.code === 21 ? 'ip_restricted' : 'http_error',
        httpStatus:  200,
        errorCode:   data.error.code,
        resultCount: 0,
        latencyMs,
        note:        data.error.code === 21
          ? `Error 21 — IP allowlist restriction. This IP is not on the FatSecret allowlist.`
          : `API error ${data.error.code}: ${data.error.message}`,
      }
    }

    const foods  = data.foods?.food
    const count  = Array.isArray(foods) ? foods.length : (foods ? 1 : 0)
    const first  = (Array.isArray(foods) ? foods[0] : foods) as Record<string, string> | undefined

    return {
      provider:    'fatsecret',
      status:      count > 0 ? 'ok' : 'empty',
      resultCount: count,
      latencyMs,
      sampleName:  first?.food_name,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      provider:    'fatsecret',
      status:      msg.includes('TIMEOUT') ? 'timeout' : 'error',
      resultCount: 0,
      latencyMs:   Date.now() - start,
      note:        msg.includes('TIMEOUT') ? 'Request timed out' : msg,
    }
  }
}

// ── FatSecret — detail fetch (secondary probe) ────────────────────────────────

async function probeFatSecretDetail(foodId: string): Promise<ProbeResult> {
  const clientId     = process.env.FATSECRET_CLIENT_ID
  const clientSecret = process.env.FATSECRET_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    return { provider: 'fatsecret_detail', status: 'auth_fail', resultCount: 0, latencyMs: 0 }
  }

  const start = Date.now()
  try {
    const creds    = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
    const tokenRes = await withTimeout(
      fetch('https://oauth.fatsecret.com/connect/token', {
        method: 'POST',
        headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=client_credentials&scope=basic',
      }),
      TIMEOUT_MS,
    )
    if (!tokenRes.ok) {
      return { provider: 'fatsecret_detail', status: 'auth_fail', resultCount: 0, latencyMs: Date.now() - start }
    }
    const { access_token } = await tokenRes.json() as { access_token?: string }
    if (!access_token) {
      return { provider: 'fatsecret_detail', status: 'auth_fail', resultCount: 0, latencyMs: Date.now() - start }
    }

    const url = new URL('https://platform.fatsecret.com/rest/server.api')
    url.searchParams.set('method', 'food.get.v4')
    url.searchParams.set('food_id', foodId)
    url.searchParams.set('format', 'json')
    url.searchParams.set('include_food_images', 'false')

    const detailRes = await withTimeout(
      fetch(url.toString(), { headers: { Authorization: `Bearer ${access_token}` } }),
      TIMEOUT_MS,
    )
    const latencyMs = Date.now() - start

    if (!detailRes.ok) {
      return { provider: 'fatsecret_detail', status: 'http_error', httpStatus: detailRes.status, resultCount: 0, latencyMs }
    }

    const body = await detailRes.json() as { food?: { food_name?: string; servings?: unknown }; error?: { code: number } }
    if (body.error) {
      return {
        provider: 'fatsecret_detail',
        status: body.error.code === 21 ? 'ip_restricted' : 'http_error',
        errorCode: body.error.code,
        resultCount: 0,
        latencyMs,
        note: `Error ${body.error.code}`,
      }
    }

    return {
      provider:    'fatsecret_detail',
      status:      body.food ? 'ok' : 'empty',
      resultCount: body.food ? 1 : 0,
      latencyMs,
      sampleName:  body.food?.food_name,
      note:        `Servings field present: ${!!body.food?.servings}`,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { provider: 'fatsecret_detail', status: msg.includes('TIMEOUT') ? 'timeout' : 'error', resultCount: 0, latencyMs: Date.now() - start, note: msg }
  }
}

// ── Open Food Facts ────────────────────────────────────────────────────────────

async function probeOpenFoodFacts(): Promise<ProbeResult> {
  const start = Date.now()
  try {
    const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${PROBE_QUERY}&search_simple=1&action=process&json=1&page_size=5&fields=product_name,nutriments`
    const res = await withTimeout(
      fetch(url, { headers: { 'User-Agent': 'InvolvedApp/1.0 (eval-probe; support@involvedfit.com)' } }),
      TIMEOUT_MS,
    )
    const latencyMs = Date.now() - start

    if (!res.ok) {
      return { provider: 'open_food_facts', status: 'http_error', httpStatus: res.status, resultCount: 0, latencyMs }
    }

    const data = await res.json() as { products?: Array<{ product_name?: string; nutriments?: Record<string, number> }> }
    const count = data.products?.length ?? 0
    return {
      provider:    'open_food_facts',
      status:      count > 0 ? 'ok' : 'empty',
      resultCount: count,
      latencyMs,
      sampleName:  data.products?.[0]?.product_name,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      provider:    'open_food_facts',
      status:      msg.includes('TIMEOUT') ? 'timeout' : 'error',
      resultCount: 0,
      latencyMs:   Date.now() - start,
      note:        msg.includes('TIMEOUT') ? 'Request timed out' : msg,
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

import * as fs from 'fs'
import * as path from 'path'

async function main() {
  const timestamp = new Date().toISOString()
  console.log(`\n${'═'.repeat(60)}`)
  console.log('  Nutrition Provider Health Probe')
  console.log(`  ${timestamp}`)
  console.log(`  Query: "${PROBE_QUERY}"`)
  console.log('═'.repeat(60))

  const [usdaResult, fsResult, offResult] = await Promise.all([
    probeUsda(),
    probeFatSecret(),
    probeOpenFoodFacts(),
  ])

  const results = [usdaResult, fsResult, offResult]

  for (const r of results) {
    const icon = r.status === 'ok' ? '✓' : r.status === 'empty' ? '?' : '✗'
    console.log(`\n  ${icon} ${r.provider}`)
    console.log(`    status:      ${r.status}`)
    console.log(`    latency:     ${r.latencyMs}ms`)
    console.log(`    results:     ${r.resultCount}`)
    if (r.sampleName) console.log(`    sample:      "${r.sampleName}"`)
    if (r.httpStatus) console.log(`    httpStatus:  ${r.httpStatus}`)
    if (r.errorCode)  console.log(`    errorCode:   ${r.errorCode}`)
    if (r.note)       console.log(`    note:        ${r.note}`)
  }

  // If FatSecret search returned results, probe detail fetch for one food
  let fsDetailResult: ProbeResult | null = null
  if (fsResult.status === 'ok') {
    console.log('\n  Probing FatSecret detail fetch (food.get.v4)...')
    // Use a known FatSecret ID for apple (33689 is "Apple" in FatSecret)
    fsDetailResult = await probeFatSecretDetail('33689')
    const icon2 = fsDetailResult.status === 'ok' ? '✓' : '✗'
    console.log(`  ${icon2} fatsecret_detail`)
    console.log(`    status:  ${fsDetailResult.status}`)
    console.log(`    latency: ${fsDetailResult.latencyMs}ms`)
    if (fsDetailResult.sampleName) console.log(`    food:    "${fsDetailResult.sampleName}"`)
    if (fsDetailResult.note) console.log(`    note:    ${fsDetailResult.note}`)
  }

  // Write machine-readable output
  const output = {
    probedAt:     timestamp,
    probeQuery:   PROBE_QUERY,
    environment:  'local',
    note:         'Local probe. Vercel runtime may have different IP allowlist behavior.',
    providers:    [...results, ...(fsDetailResult ? [fsDetailResult] : [])],
  }

  const outPath = path.resolve(process.cwd(), '__tests__/nutrition/eval/fixtures/probe-results.json')
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2))
  console.log(`\n  Results written to: ${outPath}`)
  console.log('═'.repeat(60) + '\n')
}

main().catch(err => {
  console.error('Probe failed:', err)
  process.exit(1)
})
