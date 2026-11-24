# Nutrition Foundation Milestone 1 — Migration Runbook

Applies to commits `1e98215` → `fcaa995` → `fd16091`.  
Pending migrations: `20261110010000_billing_source_rc_test` and  
`20261123000000_nutrition_foundation_milestone1`.

---

## Pre-flight checklist

Before running `prisma migrate deploy` on production:

1. **Record current LSN** (restore target if rollback needed):
   ```sql
   SELECT pg_current_wal_lsn(), now() AT TIME ZONE 'UTC' AS recorded_at;
   ```
   Save both values. This is your PITR anchor.

2. **Confirm WAL archive is current** (last archived should be < 5 min ago):
   ```sql
   SELECT last_archived_wal, last_archived_time, failed_count
   FROM pg_stat_archiver;
   ```
   If `failed_count > 0` or `last_archived_time` is > 10 min ago: **STOP**. Do not migrate.

3. **Confirm no active long-running transactions**:
   ```sql
   SELECT pid, now() - xact_start AS duration, state, query
   FROM pg_stat_activity
   WHERE xact_start IS NOT NULL AND now() - xact_start > interval '1 minute'
   ORDER BY duration DESC;
   ```

4. **Run the shadow rehearsal** (from this repo root):
   ```bash
   # Requires local PostgreSQL 14+
   psql -d postgres -f supabase/tests/shadow_setup_reference.sql
   DATABASE_URL="postgresql://localhost/involved_shadow" \
   DIRECT_URL="postgresql://localhost/involved_shadow" \
   npx prisma migrate deploy
   psql -d involved_shadow -v ON_ERROR_STOP=1 \
        -f supabase/tests/nutrition_rls_validation.sql
   ```
   Must exit 0 before proceeding.

---

## Apply migrations

```bash
npx prisma migrate deploy
```

Prisma applies all pending migrations in order:
1. `20261110010000_billing_source_rc_test` — `ALTER TYPE BillingSource ADD VALUE IF NOT EXISTS 'rc_test'`
2. `20261123000000_nutrition_foundation_milestone1` — 9 tables + 5 enums + RLS

Both migrations are wrapped in a PostgreSQL transaction by Prisma. If either fails mid-execution, the entire migration is rolled back automatically. No partial state is possible.

---

## Post-migration verification

After `migrate deploy` returns:

```bash
# Confirm both migrations appear in _prisma_migrations with no rolled_back_at
psql "$DIRECT_URL" -c "
SELECT migration_name, finished_at, rolled_back_at
FROM _prisma_migrations
WHERE migration_name IN (
  '20261110010000_billing_source_rc_test',
  '20261123000000_nutrition_foundation_milestone1'
)
ORDER BY started_at;"

# Run full RLS validation against production
psql "$DIRECT_URL" -v ON_ERROR_STOP=1 \
     -f supabase/tests/nutrition_rls_validation.sql
```

Expected: both rows with `rolled_back_at = NULL`, validation exits 0.

---

## Recovery procedures

### Case 1: Migration fails, Prisma reports error

Prisma's transaction rollback means no DDL was applied. The `_prisma_migrations` row will have `rolled_back_at` set.

**What NOT to do**: Do not manually `DELETE FROM _prisma_migrations`. This breaks Prisma's migration history permanently and is not a supported recovery path.

**What to do**:
1. Inspect the error. Prisma prints the exact SQL line that failed.
2. Fix the issue (edit the migration SQL if needed — only if the migration has NOT yet been applied; if it has partially applied and rolled back cleanly, re-deploy is safe).
3. Re-run `prisma migrate deploy`. Prisma retries failed migrations automatically.

### Case 2: Tables created but app deployment fails

The nutrition tables exist in the DB but the app hasn't deployed. Tables are empty (no user data). No user-visible impact.

**What to do**: Roll back the Vercel deployment using the rollback target from your deploy summary. The tables remain in the DB harmlessly. When the app code issue is resolved, re-deploy. No migration redo needed.

### Case 3: App deployed with a critical bug in nutrition code

**What to do**: Roll back the Vercel deployment (`vercel rollback`). The old code doesn't reference the new tables, so it ignores them. Fix the bug, then re-deploy without touching migrations.

### Case 4: Need to fully remove the nutrition tables from production

This should be rare — only if the schema design was fundamentally wrong.

**What to do**: Create a new Prisma migration (`prisma migrate dev --name revert_nutrition_m1`) that DROPs the 9 tables and 5 enums. Apply it via `prisma migrate deploy`. **Never delete rows from `_prisma_migrations`**.

### Case 5: Data corruption requiring PITR restore

For catastrophic scenarios where data needs to be restored to a point before the migration:

See the PITR procedure below.

---

## Production recovery window

Measured 2026-11-24 01:34 UTC (read from production `pg_stat_archiver`):

| Metric | Value |
|---|---|
| WAL archiver status | Active (0 failures since 2026-08-25) |
| Last archived WAL | `00000001000000090000003E` |
| Last archived time | 2026-11-24 00:26:47 UTC (67 min before measurement) |
| Total archived segments | 2,365 |
| Server start (WAL epoch) | 2026-09-16 02:49 UTC |
| `archive_command` | `/usr/bin/admin-mgr wal-push` (Supabase WAL-G) |

The WAL archive covers 69+ days of continuous history. Supabase's PITR dashboard retention window is plan-dependent:
- **Pro plan**: 7 days
- **Team plan**: 14 days

**Action required**: Confirm PITR is enabled and verify the retention period in Supabase Dashboard → Project Settings → Addons → Point in Time Recovery.

---

## Isolated restore rehearsal (documentation)

A full PITR restore rehearsal requires Supabase Dashboard access and a spare project (or the restore creates a new project). The following documents the procedure and what access/cost approval is needed.

### Access and cost requirements

| Requirement | Detail |
|---|---|
| Dashboard access | Project owner or admin role required |
| Plan tier | Pro or Team — Free plan does not support PITR |
| Cost | Supabase creates a **new project** for the restore; it incurs the standard project fee until deleted. Estimate: ~$25–50/month pro-rated for the duration of the rehearsal (< 1 day = < $2). |
| Approval needed | Yes — costs money and requires owner-level dashboard access |

### Rehearsal procedure (once approved)

1. **Record restore target**: Before starting, note the LSN and timestamp you want to restore to (the pre-migration LSN recorded in pre-flight step 1).

2. **Initiate restore**: Dashboard → Database → Backups → Point in Time Recovery → select the timestamp → "Restore to new project".

3. **Wait for restore**: Supabase provisions a new project and applies WAL replay. For a 68-day database, estimate 15–30 minutes.

4. **Verify restored state**:
   ```bash
   # Connect to the restored project using its DIRECT_URL
   psql "$RESTORED_DIRECT_URL" -c "
   SELECT migration_name, finished_at
   FROM _prisma_migrations
   ORDER BY started_at DESC
   LIMIT 3;"
   ```
   Expected: `20261110010000_billing_source_rc_test` and `20261123000000_nutrition_foundation_milestone1` should NOT appear if restored to pre-migration.
   
   ```bash
   # Verify nutrition tables do NOT exist
   psql "$RESTORED_DIRECT_URL" -c "
   SELECT tablename FROM pg_tables
   WHERE schemaname = 'public'
   AND tablename LIKE 'dietary_%' OR tablename LIKE 'user_meal_%';"
   ```
   Expected: 0 rows.

5. **Confirm user data integrity**: Spot-check a known user's recent workout or meal log entry to confirm the data matches what was present before the migration.

6. **Tear down**: Delete the restored project from the dashboard once verified.

### Shadow database as smoke-test analog

The `involved_shadow` shadow database (local PostgreSQL) serves as the structural rehearsal:
- Both pending migrations applied via `prisma migrate deploy`: confirmed ✓
- All 13 migration history rows present, `rolled_back_at = NULL` on all: confirmed ✓
- All 10 RLS validation sections passed, exit 0: confirmed 2026-11-24 ✓

This confirms the SQL will apply without error and the RLS policies are correct. It does not replace a Supabase PITR rehearsal for data-integrity verification.

---

## What the failing-migration runbook previously said (incorrect)

> "Delete the failed migration from `_prisma_migrations` to allow re-running it"

**This is wrong.** Deleting rows from `_prisma_migrations` corrupts Prisma's migration state. Prisma will then try to re-apply the migration but encounter already-existing tables/enums and fail again. Recovery from this requires manual schema surgery.

**Correct behavior**: Prisma automatically retries a failed migration on the next `prisma migrate deploy` call. The `rolled_back_at` timestamp tells Prisma the migration needs to be retried. No manual intervention in `_prisma_migrations` is ever required.
