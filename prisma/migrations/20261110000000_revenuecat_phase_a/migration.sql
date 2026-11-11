-- RevenueCat Phase A: multi-source UserSubscription + WebhookEvent table
-- ============================================================================
-- BEFORE RUNNING THIS MIGRATION, execute the PREFLIGHT queries below on the
-- production database (read-only) and review the output.
--
-- SAFE TO RUN: All changes are additive (new columns with defaults, new table).
-- The unique constraint swap requires a brief ACCESS EXCLUSIVE lock on
-- user_subscriptions. Run during a low-traffic window on production.
--
-- TRANSACTION: Explicit BEGIN/COMMIT are required. Prisma 5.x's migrate deploy
-- executes PostgreSQL migration SQL directly without an outer transaction wrapper.
-- All 9 statements below are PostgreSQL transactional DDL — none uses CONCURRENTLY,
-- which is the only index operation that cannot run inside a transaction block.
-- ============================================================================


-- ============================================================================
-- PREFLIGHT — run these on production BEFORE the migration; do not modify data
-- ============================================================================

-- 1. Verify no NULL billing_source values exist (should be 0 rows).
--    If any rows appear, they will be backfilled in Step 0 below.
-- SELECT COUNT(*) AS null_billing_source_count
--   FROM user_subscriptions
--  WHERE billing_source IS NULL;

-- 2. Identify unique indexes/constraints on user_id.
--    The migration handles BOTH constraint-backed and bare-index forms.
-- SELECT conname AS constraint_name, contype
--   FROM pg_constraint
--  WHERE conrelid = 'user_subscriptions'::regclass
--    AND contype = 'u'
--  ORDER BY conname;
-- SELECT indexname, indexdef
--   FROM pg_indexes
--  WHERE tablename = 'user_subscriptions'
--  ORDER BY indexname;

-- 3. Confirm no duplicate (user_id, billing_source) pairs exist.
--    This must return 0 rows before running Step 3 (compound index creation).
-- SELECT user_id, billing_source, COUNT(*) AS cnt
--   FROM user_subscriptions
--  GROUP BY user_id, billing_source
-- HAVING COUNT(*) > 1;

-- 4. Snapshot current row counts for post-migration verification.
-- SELECT COUNT(*) AS total_rows FROM user_subscriptions;
-- SELECT billing_source, status, COUNT(*)
--   FROM user_subscriptions
--  GROUP BY billing_source, status
--  ORDER BY billing_source, status;


-- ============================================================================
-- MIGRATION
-- ============================================================================

BEGIN;

-- Step 0: Backfill any NULL billing_source values before adding NOT NULL.
-- Safe when no NULLs exist — UPDATE with no matching rows is a no-op.
UPDATE user_subscriptions
   SET billing_source = 'manual'
 WHERE billing_source IS NULL;

-- Step 1: Add new columns (IF NOT EXISTS makes this idempotent on re-run).
ALTER TABLE user_subscriptions
  ADD COLUMN IF NOT EXISTS billing_issue_detected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_event_timestamp_ms   BIGINT;

-- Step 2: Set default for billing_source and enforce NOT NULL.
-- Step 0 guarantees no NULLs remain, so SET NOT NULL will not scan-fail.
ALTER TABLE user_subscriptions
  ALTER COLUMN billing_source SET DEFAULT 'manual';

ALTER TABLE user_subscriptions
  ALTER COLUMN billing_source SET NOT NULL;

-- Step 3: Replace the single-column unique index on (user_id) with a
-- compound unique index on (user_id, billing_source).
--
-- Two-part drop to handle both Prisma deployment styles:
--
--   Part (a) — constraint-backed unique (prisma migrate):
--     Prisma stores these as ALTER TABLE ... ADD CONSTRAINT, which appears
--     in pg_constraint as type 'u'. Dropped via ALTER TABLE DROP CONSTRAINT
--     using the dynamically discovered constraint name. The backing index is
--     removed automatically.
--
--   Part (b) — bare CREATE UNIQUE INDEX (prisma db push / legacy SQL):
--     Appears only in pg_indexes, not pg_constraint. The DO block finds
--     nothing and skips. Dropped explicitly by name via DROP INDEX IF EXISTS.
--
-- Together they cover every Prisma deployment path. Each part is a no-op if
-- its target does not exist.

-- Part (a): dynamically discover and drop any constraint-backed unique on user_id
DO $$
DECLARE
  v_constraint TEXT;
BEGIN
  SELECT c.conname INTO v_constraint
    FROM pg_constraint c
    JOIN pg_attribute  a ON a.attrelid = c.conrelid
                        AND a.attnum   = ANY(c.conkey)
   WHERE c.conrelid  = 'user_subscriptions'::regclass
     AND c.contype   = 'u'
     AND a.attname   = 'user_id'
     AND array_length(c.conkey, 1) = 1
   LIMIT 1;

  IF v_constraint IS NOT NULL THEN
    EXECUTE 'ALTER TABLE user_subscriptions DROP CONSTRAINT ' || quote_ident(v_constraint);
    RAISE NOTICE 'Dropped single-column unique constraint: %', v_constraint;
  ELSE
    RAISE NOTICE 'No constraint-backed single-column unique on user_id — handled by bare-index drop below';
  END IF;
END $$;

-- Part (b): drop the bare unique index by name (safe if already gone or never existed)
DROP INDEX IF EXISTS user_subscriptions_user_id_key;

-- Create the compound unique index.
-- IF NOT EXISTS makes this idempotent on re-run.
CREATE UNIQUE INDEX IF NOT EXISTS user_subscriptions_user_id_billing_source_key
  ON user_subscriptions (user_id, billing_source);

-- Step 4: Create WebhookEvent table for idempotent webhook deduplication.
CREATE TABLE IF NOT EXISTS webhook_events (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     VARCHAR(100) NOT NULL UNIQUE,
  event_type   VARCHAR(50)  NOT NULL,
  app_user_id  VARCHAR(255),
  status       VARCHAR(20)  NOT NULL DEFAULT 'processing',
  outcome_note VARCHAR(500),
  raw_payload  JSONB,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS webhook_events_app_user_id_idx
  ON webhook_events (app_user_id);

CREATE INDEX IF NOT EXISTS webhook_events_status_created_at_idx
  ON webhook_events (status, created_at);

COMMIT;


-- ============================================================================
-- POST-MIGRATION VERIFICATION — run after deploy to confirm correctness
-- ============================================================================

-- 1. Verify new columns exist with correct nullability and defaults.
-- SELECT column_name, data_type, is_nullable, column_default
--   FROM information_schema.columns
--  WHERE table_name = 'user_subscriptions'
--    AND column_name IN ('billing_source', 'billing_issue_detected_at', 'last_event_timestamp_ms')
--  ORDER BY column_name;
-- Expected:
--   billing_issue_detected_at | timestamp with time zone | YES | null
--   billing_source            | USER-DEFINED             | NO  | 'manual'::"BillingSource"
--   last_event_timestamp_ms   | bigint                   | YES | null

-- 2. Confirm the compound unique index was created.
-- SELECT indexname, indexdef
--   FROM pg_indexes
--  WHERE tablename = 'user_subscriptions'
--    AND indexname = 'user_subscriptions_user_id_billing_source_key';
-- Expected: 1 row

-- 3. Confirm single-column unique index was removed.
-- SELECT indexname
--   FROM pg_indexes
--  WHERE tablename = 'user_subscriptions'
--    AND indexname = 'user_subscriptions_user_id_key';
-- Expected: 0 rows

-- 4. Confirm row count is unchanged (compare with preflight snapshot).
-- SELECT COUNT(*) AS total_rows FROM user_subscriptions;

-- 5. Confirm webhook_events table exists.
-- SELECT COUNT(*) FROM webhook_events;
-- Expected: 0 rows (no events yet)

-- 6. Confirm FK and non-unique user_id index are intact (must not be dropped).
-- SELECT conname, contype FROM pg_constraint
--  WHERE conrelid = 'user_subscriptions'::regclass
--    AND contype = 'f';
-- Expected: user_subscriptions_user_id_fkey
-- SELECT indexname FROM pg_indexes
--  WHERE tablename = 'user_subscriptions'
--    AND indexname = 'user_subscriptions_user_id_idx';
-- Expected: 1 row
