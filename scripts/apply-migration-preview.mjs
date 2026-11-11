/**
 * Applies additive enum migrations to the Vercel Preview (sandbox) database during build.
 *
 * Runs ONLY when VERCEL_ENV === 'preview'. Production and local builds are no-ops.
 *
 * Why a custom script: `prisma migrate deploy` wraps every migration in a BEGIN/COMMIT
 * transaction block, but `ALTER TYPE ... ADD VALUE` cannot run inside a PostgreSQL
 * transaction. `prisma db execute` sends SQL directly without any transaction wrapper,
 * which is what this DDL requires.
 *
 * Idempotency: each migration SQL uses IF NOT EXISTS so re-running is safe.
 */

import { execFileSync } from 'child_process'
import { fileURLToPath } from 'url'
import path from 'path'

if (process.env.VERCEL_ENV !== 'preview') {
  process.exit(0)
}

const directUrl = process.env.DIRECT_URL
if (!directUrl) {
  console.error('apply-migration-preview: DIRECT_URL not set — skipping')
  process.exit(0)
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const migrations = [
  'prisma/migrations/20261110010000_billing_source_rc_test/migration.sql',
]

for (const rel of migrations) {
  const file = path.join(root, rel)
  console.log(`apply-migration-preview: applying ${rel}`)
  execFileSync('npx', ['prisma', 'db', 'execute', '--file', file, '--url', directUrl], {
    stdio: 'inherit',
    cwd: root,
  })
  console.log(`apply-migration-preview: ${rel} OK`)
}
