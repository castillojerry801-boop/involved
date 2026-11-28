#!/usr/bin/env tsx
/**
 * scripts/test-chat-ceiling.ts
 * Authenticated Preview integration checks for the V chat ceiling.
 *
 * Classification: live auth/database integration with mocked OpenAI
 *   LIVE  — real Supabase Auth (admin create + anon sign-in), real Postgres
 *            (Prisma seed / query via DIRECT_URL), real HTTP requests to the
 *            running Next.js dev server.
 *   MOCKED — OpenAI provider replaced by a deterministic local stub whose
 *            call count is verified per-check to assert that:
 *              • allowed messages reach the provider exactly once
 *              • blocked messages reach the provider zero times
 *
 * Checks performed:
 *   1. Free message 20  — allowed (last slot), stream delivers terminal event,
 *                         provider called once
 *   2. Free message 21  — blocked (429 limit_reached), zero provider calls
 *   3. Plus message 150 — allowed (last slot), stream delivers terminal event,
 *                         provider called once
 *   4. Plus message 151 — blocked (429 limit_reached), zero provider calls
 *   5. Concurrent       — two requests at count=149 → exactly one stream event,
 *                         one 429, provider called exactly once total
 *   6. Billing reset    — prior-period at-cap does not block current period,
 *                         stream delivers terminal event, provider called once
 *   7. GET banner       — Plus at-cap shows tier/limit/remaining/resetsAt,
 *                         zero provider calls
 *
 * PREREQS:
 *   ENV_FILE env var pointing to a file with:
 *     NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
 *     SUPABASE_SERVICE_ROLE_KEY, DIRECT_URL (or DATABASE_URL)
 *   REQUIRED_SUPABASE_REF  — project ref guard (aborts if mismatch)
 *   OPENAI_STUB_URL        — base URL of the deterministic OpenAI stub
 *   PREVIEW_URL            — dev server URL (default: http://localhost:3000)
 */

import * as dotenv from 'dotenv'
import * as fs from 'fs'
import * as path from 'path'
import { createClient } from '@supabase/supabase-js'
import { PrismaClient } from '@prisma/client'

// ── Env file loading ──────────────────────────────────────────────────────────

const envFile = process.env.ENV_FILE ?? '.env.local'
const envPath = path.resolve(process.cwd(), envFile)
if (!fs.existsSync(envPath)) {
  console.error(`\x1b[31mAbort: env file not found: ${envPath}\x1b[0m`)
  process.exit(1)
}
dotenv.config({ path: envPath })

// ── Project ref guard — abort before any write if targets mismatch ────────────

const REQUIRED_REF = process.env.REQUIRED_SUPABASE_REF
if (!REQUIRED_REF) {
  console.error(
    '\x1b[31mAbort: REQUIRED_SUPABASE_REF is not set.\x1b[0m\n' +
    '  Set it to the expected Supabase project ref.\n' +
    '  This guard prevents accidental writes to production.'
  )
  process.exit(1)
}

// ── Config ────────────────────────────────────────────────────────────────────

const PREVIEW_URL       = (process.env.PREVIEW_URL ?? 'http://localhost:3000').replace(/\/$/, '')
const SUPABASE_URL      = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const SUPABASE_SRK      = process.env.SUPABASE_SERVICE_ROLE_KEY!
const OPENAI_STUB_URL   = (process.env.OPENAI_STUB_URL ?? '').replace(/\/$/, '')

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SRK) {
  console.error('\x1b[31mAbort: missing NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, or SUPABASE_SERVICE_ROLE_KEY\x1b[0m')
  process.exit(1)
}
if (!OPENAI_STUB_URL) {
  console.error('\x1b[31mAbort: OPENAI_STUB_URL is not set — required for deterministic provider-call assertions\x1b[0m')
  process.exit(1)
}

const PROJECT_REF = new URL(SUPABASE_URL).hostname.split('.')[0]

if (PROJECT_REF !== REQUIRED_REF) {
  console.error(
    `\x1b[31mAbort: Supabase URL project ref mismatch.\x1b[0m\n` +
    `  Expected : ${REQUIRED_REF}\n` +
    `  Got      : ${PROJECT_REF} (from ${SUPABASE_URL})\n` +
    `  Env file : ${envPath}`
  )
  process.exit(1)
}

// ── Prisma DB URL ref guard ───────────────────────────────────────────────────

const dbUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? ''
if (!dbUrl) {
  console.error('\x1b[31mAbort: neither DIRECT_URL nor DATABASE_URL is set\x1b[0m')
  process.exit(1)
}
if (!dbUrl.includes(REQUIRED_REF)) {
  console.error(
    `\x1b[31mAbort: DB URL does not contain the expected project ref.\x1b[0m\n` +
    `  Expected ref in URL : ${REQUIRED_REF}\n` +
    `  DB URL key used     : ${process.env.DIRECT_URL ? 'DIRECT_URL' : 'DATABASE_URL'}\n` +
    `  Env file            : ${envPath}`
  )
  process.exit(1)
}

// ── Billing period helpers ─────────────────────────────────────────────────────

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

const admin = createClient(SUPABASE_URL, SUPABASE_SRK, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } })

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
// @supabase/ssr 0.12.7: "base64-" + base64url(JSON.stringify(session)),
// chunked at 3180 URL-encoded bytes into sb-{ref}-auth-token[.N] cookies.

const MAX_CHUNK_SIZE = 3180

function sessionToCookies(session: {
  access_token: string; refresh_token: string; token_type: string
  expires_in: number; expires_at: number; user: object
}): string {
  const key     = `sb-${PROJECT_REF}-auth-token`
  const encoded = 'base64-' + Buffer.from(JSON.stringify(session)).toString('base64url')
  if (encodeURIComponent(encoded).length <= MAX_CHUNK_SIZE) return `${key}=${encoded}`

  const parts: string[] = []
  let remaining = encoded, i = 0
  while (remaining.length > 0) {
    let end = MAX_CHUNK_SIZE
    while (end > 0 && encodeURIComponent(remaining.slice(0, end)).length > MAX_CHUNK_SIZE) end--
    parts.push(`${key}.${i}=${remaining.slice(0, end)}`)
    remaining = remaining.slice(end)
    i++
  }
  return parts.join('; ')
}

// ── API helpers ───────────────────────────────────────────────────────────────

type CoachPostResult = {
  status: number
  body: unknown
  headers: Record<string, string | null>
  /** True when the SSE stream delivered the terminal {"type":"done"} event. */
  hasDone: boolean
}

async function coachPost(cookieHeader: string): Promise<CoachPostResult> {
  const res = await fetch(`${PREVIEW_URL}/api/coach`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
    body:    JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
  })

  let body: unknown = null
  let hasDone = false
  const ct = res.headers.get('content-type') ?? ''

  if (ct.includes('application/json')) {
    body = await res.json().catch(() => null)
  } else if (res.body) {
    // SSE stream — drain fully and check for the terminal {"type":"done"} event.
    const reader = res.body.getReader()
    const dec    = new TextDecoder()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (dec.decode(value, { stream: true }).includes('"type":"done"')) hasDone = true
    }
  }

  return {
    status:  res.status,
    body,
    headers: {
      'x-usage-count': res.headers.get('x-usage-count'),
      'x-usage-limit': res.headers.get('x-usage-limit'),
    },
    hasDone,
  }
}

async function coachGet(cookieHeader: string): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${PREVIEW_URL}/api/coach`, {
    method:  'GET',
    headers: { Cookie: cookieHeader },
  })
  return { status: res.status, json: await res.json().catch(() => null) }
}

/** Returns the number of POST /v1/chat/completions calls the stub has seen. */
async function stubCalls(): Promise<number> {
  try {
    const r = await fetch(`${OPENAI_STUB_URL}/calls`)
    return ((await r.json()) as { count: number }).count
  } catch {
    return -1
  }
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

  await (prisma as PrismaClient & { profile: { upsert: (a: unknown) => Promise<unknown> } }).profile.upsert({
    where: { id: userId }, create: { id: userId }, update: {},
  })

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

// ── Target verification (before any writes) ───────────────────────────────────

async function verifyTargets(): Promise<void> {
  const { error: authErr } = await admin.auth.admin.listUsers({ perPage: 1 })
  if (authErr) {
    console.error(
      `\x1b[31mAbort: Supabase admin auth check failed.\x1b[0m\n` +
      `  ${authErr.message}\n` +
      `  Verify SUPABASE_SERVICE_ROLE_KEY belongs to project ${REQUIRED_REF}.`
    )
    process.exit(1)
  }
  try {
    await prisma.$queryRaw`SELECT 1`
  } catch (e) {
    console.error(
      `\x1b[31mAbort: Prisma DB connection failed.\x1b[0m\n` +
      `  ${(e as Error).message}\n` +
      `  Verify DATABASE_URL/DIRECT_URL targets project ${REQUIRED_REF}.`
    )
    await prisma.$disconnect()
    process.exit(1)
  }
  try {
    await fetch(`${OPENAI_STUB_URL}/calls`)
  } catch {
    console.error(
      `\x1b[31mAbort: OpenAI stub unreachable at ${OPENAI_STUB_URL}.\x1b[0m\n` +
      `  Verify the stub is running and OPENAI_STUB_URL is correct.`
    )
    process.exit(1)
  }
  console.log(G(`✓ Supabase Auth → ${REQUIRED_REF}`))
  console.log(G(`✓ Postgres      → ${REQUIRED_REF}`))
  console.log(G(`✓ OpenAI stub   → ${OPENAI_STUB_URL}`))
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nV Chat Ceiling — Live Integration Checks`)
  console.log(DIM('Live  : Supabase Auth (create/sign-in) + Postgres (Prisma seed/query)'))
  console.log(DIM('Mocked: OpenAI provider — deterministic stub, call-count verified per check'))
  console.log(DIM(`Server : ${PREVIEW_URL}`))
  console.log(DIM(`Project: ${PROJECT_REF}  Period: ${CURRENT_PERIOD}`))

  await verifyTargets()

  const users: TestUser[] = []

  try {
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
    await makePlusUser(resetUser.id)

    await Promise.all([
      seedUsage(freeUser.id,       19),
      seedUsage(plusUser.id,      149),
      seedUsage(concurrentUser.id, 149),
      seedUsage(resetUser.id, 150, PREV_PERIOD),
    ])

    // ── Check 1: Free message 20 (allowed) ───────────────────────────────────
    section('Check 1 — Free: message 20 allowed')
    {
      const before = await stubCalls()
      const r      = await coachPost(freeUser.cookieHeader)
      const after  = await stubCalls()
      if (r.status === 200) pass(`status ${r.status} (not blocked)`)
      else fail(`expected 200, got ${r.status}`, JSON.stringify(r.body))
      if (r.hasDone) pass('stream delivered terminal {"type":"done"} event')
      else fail('no terminal stream event received (stream ended without {"type":"done"})')
      if (after === before + 1) pass(`provider called once (count ${before}→${after})`)
      else fail(`provider call count`, `expected ${before + 1}, got ${after}`)
    }

    // ── Check 2: Free message 21 (blocked) ───────────────────────────────────
    section('Check 2 — Free: message 21 blocked')
    {
      await seedUsage(freeUser.id, 20)
      const before = await stubCalls()
      const r      = await coachPost(freeUser.cookieHeader)
      const after  = await stubCalls()
      if (r.status === 429) {
        const body = r.body as { error?: string; limit?: number }
        pass('429 returned')
        if (body?.error === 'limit_reached') pass('body.error = limit_reached')
        else fail('body.error', `expected limit_reached, got ${body?.error}`)
        if (body?.limit === 20) pass('body.limit = 20')
        else fail('body.limit', `expected 20, got ${body?.limit}`)
      } else {
        fail(`expected 429, got ${r.status}`)
      }
      if (after === before) pass(`zero provider calls for blocked message (count stayed ${after})`)
      else fail('provider called for blocked message', `count ${before}→${after}`)
    }

    // ── Check 3: Plus message 150 (allowed) ──────────────────────────────────
    section('Check 3 — Plus: message 150 allowed')
    {
      const before = await stubCalls()
      const r      = await coachPost(plusUser.cookieHeader)
      const after  = await stubCalls()
      if (r.status === 200) pass(`status ${r.status} (not blocked)`)
      else fail(`expected 200, got ${r.status}`, JSON.stringify(r.body))
      if (r.hasDone) pass('stream delivered terminal {"type":"done"} event')
      else fail('no terminal stream event received')
      if (after === before + 1) pass(`provider called once (count ${before}→${after})`)
      else fail('provider call count', `expected ${before + 1}, got ${after}`)
    }

    // ── Check 4: Plus message 151 (blocked) ──────────────────────────────────
    section('Check 4 — Plus: message 151 blocked')
    {
      await seedUsage(plusUser.id, 150)
      const before = await stubCalls()
      const r      = await coachPost(plusUser.cookieHeader)
      const after  = await stubCalls()
      if (r.status === 429) {
        const body = r.body as { error?: string; limit?: number }
        pass('429 returned')
        if (body?.error === 'limit_reached') pass('body.error = limit_reached')
        else fail('body.error', `expected limit_reached, got ${body?.error}`)
        if (body?.limit === 150) pass('body.limit = 150')
        else fail('body.limit', `expected 150, got ${body?.limit}`)
      } else {
        fail(`expected 429, got ${r.status}`)
      }
      if (after === before) pass(`zero provider calls for blocked message (count stayed ${after})`)
      else fail('provider called for blocked message', `count ${before}→${after}`)
    }

    // ── Check 5: Concurrent — exactly one 200, one 429 ───────────────────────
    section('Check 5 — Concurrent: two requests at count=149, one wins')
    {
      const before       = await stubCalls()
      const [rA, rB]     = await Promise.all([
        coachPost(concurrentUser.cookieHeader),
        coachPost(concurrentUser.cookieHeader),
      ])
      const after        = await stubCalls()
      const statuses     = [rA.status, rB.status]
      const blockedCount = statuses.filter(s => s === 429).length
      const allowedCount = statuses.filter(s => s === 200).length

      if (allowedCount === 1 && blockedCount === 1)
        pass("exactly one allowed (200), one blocked (429)")
      else fail('expected 1 allowed + 1 blocked', `got statuses: ${statuses.join(', ')}`)

      const doneCount = [rA.hasDone, rB.hasDone].filter(Boolean).length
      if (doneCount === 1) pass('terminal stream event from exactly one response')
      else fail('terminal stream event count', `expected 1, got ${doneCount}`)

      if (after === before + 1)
        pass(`provider called exactly once for 2 concurrent requests (count ${before}→${after})`)
      else fail('provider call count for concurrent test', `expected ${before + 1}, got ${after}`)
    }

    // ── Check 6: Billing period reset ────────────────────────────────────────
    section('Check 6 — Billing reset: prior-period at-cap does not block current period')
    {
      const before = await stubCalls()
      const r      = await coachPost(resetUser.cookieHeader)
      const after  = await stubCalls()
      if (r.status === 200) pass(`status ${r.status} (not blocked despite prior-period at-cap)`)
      else fail(`expected 200 with a fresh billing period, got ${r.status}`)
      if (r.hasDone) pass('stream delivered terminal {"type":"done"} event')
      else fail('no terminal stream event received')
      if (after === before + 1) pass(`provider called once (count ${before}→${after})`)
      else fail('provider call count', `expected ${before + 1}, got ${after}`)
    }

    // ── Check 7: GET banner ───────────────────────────────────────────────────
    section('Check 7 — GET /api/coach: Plus at-cap banner data')
    {
      await seedUsage(plusUser.id, 150)
      const before        = await stubCalls()
      const { status, json } = await coachGet(plusUser.cookieHeader)
      const after         = await stubCalls()
      const data = json as { tier?: string; limit?: number; remaining?: number; resetsAt?: string } | null

      if (status === 200) pass('GET 200')
      else fail('GET status', `expected 200, got ${status}`)

      if (data?.tier === 'plus') pass('tier = plus')
      else fail('tier', `expected plus, got ${data?.tier}`)

      if (data?.limit === 150) pass('limit = 150')
      else fail('limit', `expected 150, got ${data?.limit}`)

      if (data?.remaining === 0) pass('remaining = 0')
      else fail('remaining', `expected 0, got ${data?.remaining}`)

      if (data?.resetsAt) pass(`resetsAt present (${data.resetsAt})`)
      else fail('resetsAt missing')

      if (after === before) pass(`zero provider calls for GET request (count stayed ${after})`)
      else fail('provider called for GET request', `count ${before}→${after}`)
    }

  } finally {
    console.log('\nCleaning up test users…')
    await Promise.all(users.map(u => cleanupUser(u.id)))
    console.log(`  Deleted ${users.length} test users`)
    await prisma.$disconnect()
  }

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
