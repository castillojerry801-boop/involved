/**
 * Applies additive enum migrations and reconciles Prisma migration history
 * in the Vercel Preview (sandbox) database during build.
 *
 * Runs ONLY when VERCEL_ENV === 'preview'. Production and local builds are no-ops.
 *
 * DDL step: uses DIRECT_URL (non-pooled) via `prisma db execute` — required because
 * `ALTER TYPE ... ADD VALUE` cannot run inside a transaction block, and `prisma migrate
 * deploy` wraps every migration in one. `prisma db execute` sends SQL directly.
 * Supabase blocks port 5432 from Vercel build machines, so this step falls back to a
 * manual instruction when the connection is refused.
 *
 * Reconcile step: uses DATABASE_URL (pooler) via `prisma migrate resolve --applied`.
 * This is plain DML (INSERT into _prisma_migrations), so the pooler connection works.
 * Marks each migration as applied so future `migrate deploy` runs skip it correctly
 * instead of trying to re-run the ALTER TYPE inside a failing transaction.
 */

import { execFileSync } from 'child_process'
import { fileURLToPath } from 'url'
import path from 'path'

if (process.env.VERCEL_ENV !== 'preview') {
  process.exit(0)
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// Migrations that must be applied non-transactionally (ALTER TYPE ADD VALUE).
// Add new entries here when adding enum values in future migrations.
const enumMigrations = [
  '20261110010000_billing_source_rc_test',
]

for (const name of enumMigrations) {
  const rel  = `prisma/migrations/${name}/migration.sql`
  const file = path.join(root, rel)

  // ── DDL step (DIRECT_URL, non-transactional) ──────────────────────────────
  const directUrl = process.env.DIRECT_URL
  if (directUrl) {
    console.log(`apply-migration-preview: DDL — applying ${name}`)
    try {
      execFileSync('npx', ['prisma', 'db', 'execute', '--file', file, '--url', directUrl], {
        stdio: 'inherit',
        cwd:   root,
      })
      console.log(`apply-migration-preview: DDL OK — ${name}`)
    } catch {
      // Supabase direct connection (port 5432) is blocked from Vercel build machines.
      // Apply the migration manually if it has not been applied yet.
      console.warn(`apply-migration-preview: DDL WARN — network unreachable for ${name}`)
      console.warn('apply-migration-preview: Apply manually in Supabase SQL Editor (project qverqgbfkgiscycdqsck):')
      console.warn(`  ALTER TYPE "BillingSource" ADD VALUE IF NOT EXISTS 'rc_test';`)
    }
  } else {
    console.warn('apply-migration-preview: DIRECT_URL not set — skipping DDL step')
  }

  // ── Reconcile step (DATABASE_URL pooler, plain DML) ───────────────────────
  // Marks the migration as applied in _prisma_migrations so `migrate deploy`
  // does not attempt to re-run the ALTER TYPE inside a transaction on future runs.
  console.log(`apply-migration-preview: reconcile — marking ${name} as applied`)
  try {
    execFileSync('npx', ['prisma', 'migrate', 'resolve', '--applied', name], {
      stdio: 'inherit',
      cwd:   root,
    })
    console.log(`apply-migration-preview: reconcile OK — ${name}`)
  } catch {
    // Expected on re-deploy if migration is already recorded as applied.
    // Also fires if _prisma_migrations table does not exist (schema not yet initialised
    // via migrate deploy). Both cases are non-fatal.
    console.warn(`apply-migration-preview: reconcile WARN — ${name} (already applied, or _prisma_migrations absent)`)
  }
}
