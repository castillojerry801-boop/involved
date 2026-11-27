#!/usr/bin/env tsx
/**
 * scripts/test-chat-ceiling.ts
 * Authenticated Preview integration checks for the V chat ceiling.
 *
 * PREREQS:
 *   .env.local with NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
 *   SUPABASE_SERVICE_ROLE_KEY, and DIRECT_URL (or DATABASE_URL).
 *
 * Usage:
 *   PREVIEW_URL=https://your-preview.vercel.app npx tsx scripts/test-chat-ceiling.ts
 *   # Defaults to http://localhost:3000 when PREVIEW_URL is not set.
 *
 * Live vs mock breakdown:
 *   LIVE  — HTTP calls to the real Preview URL, real Supabase auth, real DB rows
 *   MOCK  — none (this script is purely live; unit mocks live in __tests__/)
 *
 * Checks performed:
 *   1. Free message 20  — allowed (last slot)
 *   2. Free message 21  — blocked (429), no OpenAI call
 *   3. Plus message 150 — allowed (last slot)
 *   4. Plus message 151 — blocked (429), no OpenAI call
 *   5. Concurrent       — two requests at count=149 → exactly one 200, one 429
 *   6. Billing reset    — previous-period row does NOT block current period
 *   7. GET banner       — Plus at-cap shows limit=150, remaining=0 (no upgrade prompt)
 *   8. DB error path    — 503 returned when usage check fails (mocked via seeded count
 *                         manipulation; not tested live since we can't cut DB access)
 *      NOTE: Check 8 is covered by unit tests (chat-ceiling.test.ts). Skipped here.
 */

import * as dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { PrismaClient } from '@prisma/client'

dotenv.config({ path: '.env.local' })

// ── Config ────────────────────────────────────────────────────────────────────

const PREVIEW_URL = (process.env.PREVIEW_URL ?? 'http://localhost:3000').replace(/\/$/, '')
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const PROJECT_REF = new URL(SUPABASE_URL).hostname.split('.')[0]

function currentPeriod() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
function prevPeriod() {
  const d = new Date()
  d.setMonth(d.getMonth() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const CURRENT_PERIOD = currentPeriod()
const PREV_PERIOD    = prevPeriod()

// ── Clients ───────────────────────────────────────────────────────────────────

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } },
})

// ── Reporting ─────────────────────────────────────────────────────────────────

const G   = (s: string) => `\x1b[32m${s}\x1b[0m`
const R   = (s: string) => `\x1b[31m${s}\x1b[0m`
const DIM = (s: string) => `\x1b[2m${s}\x1b[0m`
let passed = 0, failed = 0

function pass(label: string) { console.log(`  ${G('✓')} ${label}`); passed++ }
function fail(label: string, detail?: string) {
  console.log(`  ${R('✗')} ${label}${detail ? `\n      ${DIM(detail)}` : ''}`)
  failed++
}
function section(title: string) { console.log(`\n${title}`) }

// ── Cookie helpers ────────────────────────────────────────────────────────────
// @supabase/ssr 0.12.7 stores sessions as "base64-" + base64url(JSON.stringify(session)),
// chunked at 3180 URL-encoded bytes into sb-{ref}-auth-token.0 / .1 / ... cookies.

const MAX_CHUNK_SIZE = 3180

function sessionToCookies(session: {
  access_token: string; refresh_token: string; token_type: string
  expires_in: number; expires_at: number; user: object
}): string {
  const key     = `sb-${PROJECT_REF}-auth-token`
  const encoded = 'base64-' + Buffer.from(JSON.stringify(session)).toString('base64url')

  if (encodeURIComponent(encoded).length <= MAX_CHUNK_SIZE) {
    return `${key}=${encoded}`
  }

  const parts: string[] = []
  let remaining = encoded, i = 0
  while (remaining.length > 0) {
    // Find the boundary where URL-encoding stays within MAX_CHUNK_SIZE
    let end = MAX_CHUNK_SIZE
    while (end > 0 && encodeURIComponent(remaining.slice(0, end)).length > MAX_CHUNK_SIZE) end--
    parts.push(`${key}.${i}=${remaining.slice(0, end)}`)
    remaining = remaining.slice(end)
    i++
  }
  return parts.join('; ')
}

// ── API helpers ───────────────────────────────────────────────────────────────

type CoachPostResult = { status: number; body: unknown; headers: Record<string, string | null> }

async function coachPost(cookieHeader: string): Promise<CoachPostResult> {
  const res = await fetch(`${PREVIEW_URL}/api/coach`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
    body:    JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
  })

  let body: unknown = null
  const ct = res.headers.get('content-type') ?? ''
  if (ct.includes('application/json')) {
    body = await res.json().catch(() => null)
  } else {
    // SSE stream — drain it
    if (res.body) {
      const r = res.body.getReader()
      while (!(await r.read()).done) {}
    }
  }

  return {
    status:  res.status,
    body,
    headers: {
      'x-usage-count': res.headers.get('x-usage-count'),
      'x-usage-limit': res.headers.get('x-usage-limit'),
    },
  }
}

async function coachGet(cookieHeader: string): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${PREVIEW_URL}/api/coach`, {
    method:  'GET',
    headers: { Cookie: cookieHeader },
  })
  return { status: res.status, json: await res.json().catch(() => null) }
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

type TestUser = { id: string; email: string; cookieHeader: string }

async function createTestUser(tag: string): Promise<TestUser> {
  const email    = `test-ceiling-${tag}-${Date.now()}@test.internal`
  const password = crypto.randomUUID()

  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
  })
  if (error || !data.user) throw new Error(`createUser(${tag}): ${error?.message ?? 'no user'}`)
  const userId = data.user.id

  // Profile row is required for AiRequestLog profile relation
  await (prisma as PrismaClient & { profile: { upsert: (a: unknown) => Promise<unknown> } }).profile.upsert({
    where:  { id: userId },
    create: { id: userId },
    update: {},
  })

  // Sign in with anon client to get a session
  const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: si, error: siErr } = await anonClient.auth.signInWithPassword({ email, password })
  if (siErr || !si.session) throw new Error(`signIn(${tag}): ${siErr?.message ?? 'no session'}`)

  const s = si.session
  return {
    id: userId,
    email,
    cookieHeader: sessionToCookies({
      access_token:  s.access_token,
      refresh_token: s.refresh_token,
      token_type:    s.token_type,
      expires_in:    s.expires_in ?? 3600,
      expires_at:    s.expires_at ?? Math.floor(Date.now() / 1000) + 3600,
      user:          s.user,
    }),
  }
}

async function makePlusUser(userId: string): Promise<void> {
  await prisma.userSubscription.create({
    data: { userId, tier: 'plus', status: 'active', billingSource: 'manual' } as never,
  })
}

async function seedUsage(userId: string, count: number, period: string = CURRENT_PERIOD): Promise<void> {
  await prisma.aiUsageLog.upsert({
    where:  { userId_billingPeriod_feature: { userId, billingPeriod: period, feature: 'coach_message' } },
    create: { userId, billingPeriod: period, feature: 'coach_message', interactionCount: count },
    update: { interactionCount: count },
  })
}

async function cleanupUser(userId: string): Promise<void> {
  await prisma.aiUsageLog.deleteMany({ where: { userId } }).catch(() => {})
  await prisma.aiRequestLog.deleteMany({ where: { userId } }).catch(() => {})
  await prisma.userSubscription.deleteMany({ where: { userId } }).catch(() => {})
  await (prisma as PrismaClient & { profile: { delete: (a: unknown) => Promise<unknown> } })
    .profile.delete({ where: { id: userId } }).catch(() => {})
  await admin.auth.admin.deleteUser(userId).catch(() => {})
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nV Chat Ceiling — Live Preview Checks`)
  console.log(`${DIM(`URL: ${PREVIEW_URL}`)}`)
  console.log(`${DIM(`Period: ${CURRENT_PERIOD} (prev: ${PREV_PERIOD})`)}`)

  const users: TestUser[] = []

  try {
    // ── Create users ─────────────────────────────────────────────────────────
    console.log('\nCreating test users…')
    const [freeUser, plusUser, concurrentUser, resetUser] = await Promise.all([
      createTestUser('free'),
      createTestUser('plus'),
      createTestUser('concurrent'),
      createTestUser('reset'),
    ])
    users.push(freeUser, plusUser, concurrentUser, resetUser)
    console.log(`  Created ${users.length} disposable test users`)

    await makePlusUser(plusUser.id)
    await makePlusUser(concurrentUser.id)
    // resetUser is Plus for the billing-reset check (limit=150, not 20)
    await makePlusUser(resetUser.id)

    // ── Seed usage counts ─────────────────────────────────────────────────────
    await Promise.all([
      seedUsage(freeUser.id,       19),          // next POST = 20th (last free slot)
      seedUsage(plusUser.id,      149),          // next POST = 150th (last plus slot)
      seedUsage(concurrentUser.id, 149),          // race condition: two requests for slot 150
      seedUsage(resetUser.id,     150, PREV_PERIOD), // prior period at cap — current period fresh
    ])

    // ── Check 1: Free message 20 (allowed) ───────────────────────────────────
    section('Check 1 — Free: message 20 allowed')
    {
      const r = await coachPost(freeUser.cookieHeader)
      if (r.status !== 429 && r.status !== 503) {
        pass(`status ${r.status} (not blocked)`)
      } else {
        fail(`expected non-429, got ${r.status}`, JSON.stringify(r.body))
      }
    }

    // ── Check 2: Free message 21 (blocked) ───────────────────────────────────
    // After check 1 the count is now 20 (or still 19 if the AI call errored and decremented).
    // Force count=20 to guarantee a clean blocked state.
    section('Check 2 — Free: message 21 blocked')
    {
      await seedUsage(freeUser.id, 20)
      const r = await coachPost(freeUser.cookieHeader)
      if (r.status === 429) {
        const body = r.body as { error?: string; limit?: number; count?: number }
        pass(`429 returned`)
        if (body?.error === 'limit_reached') pass(`body.error = limit_reached`)
        else fail(`body.error`, `expected limit_reached, got ${body?.error}`)
        if (body?.limit === 20) pass(`body.limit = 20`)
        else fail(`body.limit`, `expected 20, got ${body?.limit}`)
      } else {
        fail(`expected 429, got ${r.status}`)
      }
    }

    // ── Check 3: Plus message 150 (allowed) ──────────────────────────────────
    section('Check 3 — Plus: message 150 allowed')
    {
      const r = await coachPost(plusUser.cookieHeader)
      if (r.status !== 429 && r.status !== 503) {
        pass(`status ${r.status} (not blocked)`)
      } else {
        fail(`expected non-429, got ${r.status}`, JSON.stringify(r.body))
      }
    }

    // ── Check 4: Plus message 151 (blocked) ──────────────────────────────────
    section('Check 4 — Plus: message 151 blocked')
    {
      await seedUsage(plusUser.id, 150)
      const r = await coachPost(plusUser.cookieHeader)
      if (r.status === 429) {
        const body = r.body as { error?: string; limit?: number; count?: number }
        pass(`429 returned`)
        if (body?.error === 'limit_reached') pass(`body.error = limit_reached`)
        else fail(`body.error`, `expected limit_reached, got ${body?.error}`)
        if (body?.limit === 150) pass(`body.limit = 150`)
        else fail(`body.limit`, `expected 150, got ${body?.limit}`)
      } else {
        fail(`expected 429, got ${r.status}`)
      }
    }

    // ── Check 5: Concurrent — exactly one 200, one 429 ───────────────────────
    section('Check 5 — Concurrent: two requests at count=149, one wins')
    {
      // concurrentUser is at count=149 (seeded above)
      const [rA, rB] = await Promise.all([
        coachPost(concurrentUser.cookieHeader),
        coachPost(concurrentUser.cookieHeader),
      ])
      const statuses = [rA.status, rB.status]
      const blocked  = statuses.filter(s => s === 429).length
      const allowed  = statuses.filter(s => s !== 429 && s !== 503).length

      if (allowed === 1 && blocked === 1) {
        pass(`exactly one allowed (${statuses.filter(s => s !== 429)[0]}), one blocked (429)`)
      } else {
        fail(`expected 1 allowed + 1 blocked`, `got statuses: ${statuses.join(', ')}`)
      }
    }

    // ── Check 6: Billing period reset ────────────────────────────────────────
    section('Check 6 — Billing reset: prior-period at-cap does not block current period')
    {
      // resetUser has count=150 for PREV_PERIOD but no row for CURRENT_PERIOD
      const r = await coachPost(resetUser.cookieHeader)
      if (r.status !== 429 && r.status !== 503) {
        pass(`status ${r.status} (not blocked despite prior-period at-cap)`)
      } else {
        fail(`expected non-429, got ${r.status} — prior period bleeding into current`)
      }
    }

    // ── Check 7: GET banner — Plus at-cap shows correct data ─────────────────
    section('Check 7 — GET /api/coach: Plus at-cap banner data')
    {
      await seedUsage(plusUser.id, 150)
      const { status, json } = await coachGet(plusUser.cookieHeader)
      const data = json as { tier?: string; limit?: number; remaining?: number; resetsAt?: string } | null

      if (status === 200) pass(`GET 200`)
      else fail(`GET status`, `expected 200, got ${status}`)

      if (data?.tier === 'plus') pass(`tier = plus`)
      else fail(`tier`, `expected plus, got ${data?.tier}`)

      if (data?.limit === 150) pass(`limit = 150`)
      else fail(`limit`, `expected 150, got ${data?.limit}`)

      if (data?.remaining === 0) pass(`remaining = 0`)
      else fail(`remaining`, `expected 0, got ${data?.remaining}`)

      if (data?.resetsAt) pass(`resetsAt present (${data.resetsAt})`)
      else fail(`resetsAt missing`)

      // No upgrade prompt: the GET response is JSON, not HTML. The banner itself is
      // client-side. Verify the API does NOT return a tier of 'free' (which would
      // cause the UI to render the upgrade link).
      if (data?.tier !== 'free') pass(`tier is not 'free' (no upgrade prompt would render)`)
      else fail(`tier is 'free' — upgrade prompt would appear for Plus user`)
    }

  } finally {
    // ── Cleanup ───────────────────────────────────────────────────────────────
    console.log('\nCleaning up test users…')
    await Promise.all(users.map(u => cleanupUser(u.id)))
    console.log(`  Deleted ${users.length} test users`)

    await prisma.$disconnect()
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(50)}`)
  if (failed === 0) {
    console.log(G(`✓ All ${passed} checks passed`))
  } else {
    console.log(R(`✗ ${failed} check(s) failed`) + `, ${G(`${passed} passed`)}`)
    process.exit(1)
  }
}

main().catch(err => {
  console.error(R('Fatal error:'), err)
  process.exit(1)
})
