/**
 * Applies additive enum migrations and reconciles Prisma migration history
 * in the Vercel Preview (sandbox) database during build.
 *
 * Runs ONLY when VERCEL_ENV === 'preview'. Production and local builds are no-ops.
 *
 * Enum migration step: ALTER TYPE ... ADD VALUE cannot run inside a transaction
 * block, so each enum migration is applied via `prisma db execute` (which sends
 * the SQL directly without wrapping it in BEGIN/COMMIT) and then recorded with
 * `migrate resolve --applied` so `migrate deploy` skips it on subsequent runs.
 *
 * Deploy step: runs `prisma migrate deploy` using DIRECT_URL (the Supabase
 * Session pooler). A failure exits non-zero and fails the build.
 */

import { execFileSync } from 'child_process'
import { fileURLToPath } from 'url'
import path from 'path'

if (process.env.VERCEL_ENV !== 'preview') {
  process.exit(0)
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const directUrl = process.env.DIRECT_URL

if (!directUrl) {
  console.error('apply-migration-preview: DIRECT_URL is not set — cannot apply migrations')
  process.exit(1)
}

// Migrations that must be applied non-transactionally (ALTER TYPE ADD VALUE).
// Add new entries here when adding enum values in future migrations.
const enumMigrations = [
  '20261110010000_billing_source_rc_test',
]

for (const name of enumMigrations) {
  const rel  = `prisma/migrations/${name}/migration.sql`
  const file = path.join(root, rel)

  // ── DDL step (non-transactional) ─────────────────────────────────────────
  // IF NOT EXISTS guards make this safe to re-run on redeployment.
  console.log(`apply-migration-preview: DDL — applying ${name}`)
  try {
    execFileSync('npx', ['prisma', 'db', 'execute', '--file', file, '--url', directUrl], {
      stdio: 'inherit',
      cwd:   root,
    })
    console.log(`apply-migration-preview: DDL OK — ${name}`)
  } catch {
    console.warn(`apply-migration-preview: DDL WARN — ${name} (already applied or non-fatal error)`)
  }

  // ── Reconcile step ────────────────────────────────────────────────────────
  // Records the migration in _prisma_migrations so migrate deploy skips it.
  console.log(`apply-migration-preview: reconcile — marking ${name} as applied`)
  try {
    execFileSync('npx', ['prisma', 'migrate', 'resolve', '--applied', name], {
      stdio:   'inherit',
      cwd:     root,
      timeout: 15000,
    })
    console.log(`apply-migration-preview: reconcile OK — ${name}`)
  } catch {
    // Expected on redeployment when migration is already recorded as applied.
    console.warn(`apply-migration-preview: reconcile WARN — ${name} (already applied or non-fatal)`)
  }
}

// ── Deploy remaining transactional migrations ─────────────────────────────
// Uses DIRECT_URL (Supabase Session pooler). No try/catch — a failure exits
// non-zero and fails the Preview build so migration errors are never silent.
console.log('apply-migration-preview: deploy — running prisma migrate deploy')
execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
  stdio:   'inherit',
  cwd:     root,
  timeout: 90000,
})
console.log('apply-migration-preview: deploy OK')
