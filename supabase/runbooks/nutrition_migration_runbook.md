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

### Case 1: Migration fails, Prisma reports error (P3018)

When a migration fails mid-execution, Prisma's behavior is:

1. The migration SQL ran inside a PostgreSQL `BEGIN`/`COMMIT` transaction. If any SQL statement errors, the entire transaction is rolled back — **no DDL reaches the database**.
2. Prisma records the failure in `_prisma_migrations`:
   - `finished_at` = NULL (migration did not complete)
   - `rolled_back_at` = NULL (**not automatically set**)
   - `applied_steps_count` = 0
   - `logs` = error message
3. Subsequent `prisma migrate deploy` calls immediately return **P3009** ("migrate found failed migrations") and refuse to apply any further migrations until the failure is resolved.

**Prisma does NOT automatically retry a failed migration.** Manual intervention is required.

**What NOT to do**: Do not manually `DELETE FROM _prisma_migrations`. This breaks Prisma's migration history permanently and is not a supported recovery path.

**Recovery steps**:

1. **Identify the failure**: Read the P3018 output or query `_prisma_migrations`:
   ```sql
   SELECT migration_name, logs, applied_steps_count
   FROM _prisma_migrations
   WHERE finished_at IS NULL AND rolled_back_at IS NULL;
   ```

2. **Confirm no partial state** (for fully transactional DDL, nothing was committed):
   ```sql
   -- Check whether the migration's tables were created
   SELECT tablename FROM pg_tables
   WHERE schemaname = 'public'
   AND tablename IN ('dietary_preferences', 'dietary_allergens', ...);
   ```
   If tables exist despite the failure, DDL was not fully rolled back (can happen with non-transactional DDL like `ALTER TYPE ... ADD VALUE` on some PostgreSQL versions). In that case, manually reconcile the partial state before proceeding.

3. **Mark as rolled back** (this is the ONLY way to unblock deploy):
   ```bash
   npx prisma migrate resolve --rolled-back "20261123000000_nutrition_foundation_milestone1"
   ```
   This sets `rolled_back_at = now()` in `_prisma_migrations`. It **does not undo any SQL** — it only updates migration history. If partial DDL was committed, it remains and must be reconciled manually first.

4. **Fix the migration SQL** if the failure was caused by a bug in the migration file.

5. **Re-run deploy** — Prisma detects `rolled_back_at` and re-applies the migration. On success it inserts a **new row** in `_prisma_migrations`; the old failed row (with `rolled_back_at` set) remains in history.
   ```bash
   npx prisma migrate deploy
   ```

**Rehearsed 2026-11-24 on `involved_shadow_runbook`**: injected a `SELECT 1/0` failure into a 14th migration, confirmed `finished_at = NULL` / `rolled_back_at = NULL` after failure, confirmed P3009 on re-run without resolve, ran `migrate resolve --rolled-back`, confirmed `rolled_back_at` set, fixed SQL, re-ran deploy — exit 0, new success row inserted.

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

## Restore safety checklist — outbound call risk

**Live read-only check of production `cthozkricqchjgciwztx` — 2026-11-23.**  
Connected via DIRECT_URL from `.env.local`; all queries were SELECT-only.

### Extensions installed

| Extension | Version | Schema | Outbound risk |
|---|---|---|---|
| `plpgsql` | 1.0 | pg_catalog | None |
| `pgcrypto` | 1.3 | extensions | None |
| `pg_stat_statements` | 1.11 | extensions | None |
| `uuid-ossp` | 1.1 | extensions | None |
| `supabase_vault` | 0.3.1 | vault | None |
| `pg_cron` | — | — | **Not installed** |
| `pg_net` | — | — | **Not installed** |
| `wrappers` | — | — | **Not installed** |

`pg_cron` and `pg_net` are absent. Without `pg_net`, no DB function can make an HTTP request. Without `pg_cron`, no job can be scheduled. No foreign data wrappers.

### Schemas

`cron`, `net`, and `supabase_functions` schemas are all absent. Database webhooks require `supabase_functions`; scheduled jobs require `cron`. Neither exists.

### Triggers (all schemas)

16 triggers exist across `auth`, `realtime`, and `storage` — zero in `public`:

| Trigger | Table | What it does |
|---|---|---|
| `auth.on_auth_user_created` | `auth.users` | Calls `handle_new_user()` → `INSERT INTO public.profiles` only. No HTTP. |
| `realtime.tr_check_filters` | `realtime.subscription` | Internal subscription validation. No HTTP. |
| `storage.*` (14 triggers) | `storage.buckets/objects` | Bucket lifecycle and delete guards. All internal. No HTTP. |

`handle_new_user()` body confirmed:
```sql
BEGIN
  INSERT INTO public.profiles (id, display_name, updated_at)
  VALUES (new.id, new.raw_user_meta_data->>'full_name', CURRENT_TIMESTAMP)
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
```
Pure SQL, no outbound call. On a restored copy, this would only fire if a new user is created in the restored project's own auth — writing to the restored `profiles` table, not production.

### Functions with outbound patterns

Zero matches scanning all non-system schemas for `http`, `net.`, `webhook`, `pg_net`, `cron`, `supabase_functions`, `wrappers`, `curl`.

### Vault secrets

Vault is empty (0 rows in `vault.secrets`). No secrets would transfer to the restored project that could be misused.

### Realtime publication

`supabase_realtime` publication exists but has **zero tables** in it (`pg_publication_tables` = 0 rows, `puballtables = false`). The restored copy's Realtime service would broadcast nothing, and each project's Realtime is scoped to its own WebSocket endpoint — no cross-project events.

### Active background workers

Zero non-idle connections at time of check.

### Application-layer risk (not DB-layer)

The Next.js app calls ymove API, RevenueCat SDK, Apple Health, AI providers, and Stripe — none of these are triggered by the database. The restored DB cannot reach them. The only way application-level calls would run against the restored project is if you intentionally changed `DATABASE_URL`/`DIRECT_URL` env vars in a running app instance.

RevenueCat is configured to POST webhooks to `https://involvedfit.com/api/webhooks/revenuecat`. The restored project has a different URL; RC cannot reach it without explicit reconfiguration in the RC dashboard.

### Verdict

**Safe to restore.** The database layer has no mechanism to call any external service. The restore is an isolated copy.

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

4. **Verify restored state**: Run the read-only verification SQL in the restored project's SQL Editor. The query checks migration count, migration names, schema presence, and record counts without exposing customer records. See the rehearsal results below for the expected output.

5. **Confirm user data integrity**: The record counts in check 8 (profiles non-zero, food_log_entries non-zero, workouts non-zero) confirm data was restored. Latest-activity timestamps in check 9 confirm the cut is at or before the restore target.

6. **Tear down**: Delete the restored project from the dashboard once verified.

### Rehearsal completed — 2026-11-23

**Restore project**: `involved-restore-rehearsal` (`tkkujphqlohlfxolzzho.supabase.co`)  
**Restore target**: 2026-11-23 05:03:12 UTC  
**Verification run via Supabase SQL Editor**

| Check | Expected | Actual | Result |
|---|---|---|---|
| PostgreSQL version | 17.x | 17.12 | PASS |
| Migration count | 11 | 11 | PASS |
| Unfinished / rolled-back migrations | 0 | 0 | PASS |
| All 11 migrations applied | baseline → revenuecat_phase_a | All "Applied" | PASS |
| billing_source_rc_test absent | Yes | "Absent as expected" | PASS |
| nutrition_foundation_milestone1 absent | Yes | "Absent as expected" | PASS |
| 17 expected tables present | All | All "Present" | PASS |
| 4 ALTER-only columns present | All | All "Present" | PASS |
| BillingSource.rc_test absent | Yes | "Absent as expected" | PASS |
| 9 nutrition tables absent | Yes | All "Absent as expected" | PASS |
| profiles count | > 0 | 21 | PASS |
| food_items count | > 0 | 188 | PASS |
| food_log_entries count | > 0 | 299 | PASS |
| workouts / workout_sets | > 0 | 29 / 405 | PASS |
| ai_request_logs latest (UTC) | ≤ 05:03:12 | 03:13:32 (−1h 50m) | PASS |
| profiles latest (UTC) | ≤ 05:03:12 | 2026-11-16 17:20 | PASS |
| workouts latest (UTC) | ≤ 05:03:12 | 2026-11-15 06:20 | PASS |
| user_subscriptions count | 0 expected | 0 | PASS (RC webhook inactive — secrets not yet configured in production) |
| webhook_events count | ≤ 1 | 1 | PASS (single RC test call before secrets configured) |

**Gate 4 verdict: PASS.** The restore is a faithful, isolated snapshot of production at the target timestamp. Schema matches the 11-migration baseline exactly. Both pending migrations left no footprint. User data is present and all activity timestamps fall before the cut.

### Shadow database as smoke-test analog

The `involved_shadow` shadow database (local PostgreSQL) serves as the structural rehearsal:
- Both pending migrations applied via `prisma migrate deploy`: confirmed ✓
- All 13 migration history rows present, `rolled_back_at = NULL` on all: confirmed ✓
- All 13 RLS validation sections passed, exit 0: confirmed 2026-11-24 ✓

This confirms the SQL will apply without error and the RLS policies are correct. It does not replace a Supabase PITR rehearsal for data-integrity verification.

---

## Prisma migration failure — what actually happens

**Verified 2026-11-24 on `involved_shadow_runbook`** (see Case 1 above for the full rehearsal).

| Claim | Actual behavior |
|---|---|
| `rolled_back_at` is set automatically on failure | **FALSE** — it is NULL until you run `migrate resolve --rolled-back` |
| `prisma migrate deploy` retries failed migrations automatically | **FALSE** — subsequent runs return P3009 and refuse to apply anything |
| `migrate resolve --rolled-back` undoes committed SQL | **FALSE** — it only updates `_prisma_migrations`; SQL already committed remains |
| Deleting rows from `_prisma_migrations` enables re-running | **FALSE** — corrupts migration history; do not delete |

**Correct recovery path**: inspect → confirm partial state → `migrate resolve --rolled-back <name>` → fix SQL → `migrate deploy`.
