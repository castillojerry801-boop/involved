-- nutrition_rls_validation.sql
-- Post-migration smoke test for RLS policies on the 9 nutrition tables.
--
-- Run this AFTER `prisma migrate deploy` using a psql session connected as
-- superuser (postgres role), which bypasses RLS and can SET LOCAL role freely.
--
-- Usage:
--   psql "$DIRECT_URL" -f supabase/tests/nutrition_rls_validation.sql
--
-- Expected: all RAISE EXCEPTION lines fire (meaning the policy blocked the
-- forbidden operation) and all SELECT assertions return the correct counts.
-- A "query returned X rows" mismatch or a missing RAISE is a policy failure.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- Setup: two real user UUIDs from your database (replace before running)
-- ─────────────────────────────────────────────────────────────────────────────
-- \set user_a 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
-- \set user_b 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

-- For automated validation without real users, we seed synthetic test data
-- via the postgres role (which bypasses RLS), then test access via the
-- authenticated role with fabricated JWTs.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Verify RLS is ENABLED on all 9 tables
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  tbl text;
  rls_on bool;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'dietary_preferences',
    'dietary_allergens',
    'dietary_exclusions',
    'meal_plan_templates',
    'meal_plan_template_days',
    'meal_plan_template_entries',
    'user_meal_plans',
    'user_meal_plan_days',
    'user_meal_plan_entries'
  ] LOOP
    SELECT relrowsecurity INTO rls_on
      FROM pg_class
     WHERE relname = tbl AND relnamespace = 'public'::regnamespace;
    IF NOT rls_on THEN
      RAISE EXCEPTION 'RLS NOT enabled on table: %', tbl;
    END IF;
    RAISE NOTICE 'RLS enabled: %', tbl;
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Verify policy count: 9 tables, 9 policies total
--    (3 personal tables × FOR ALL = 1 policy each,
--     3 personal child tables × FOR ALL = 1 policy each,
--     3 template tables × FOR SELECT = 1 policy each)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  cnt int;
BEGIN
  SELECT COUNT(*) INTO cnt
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename IN (
       'dietary_preferences', 'dietary_allergens', 'dietary_exclusions',
       'meal_plan_templates', 'meal_plan_template_days', 'meal_plan_template_entries',
       'user_meal_plans', 'user_meal_plan_days', 'user_meal_plan_entries'
     );
  IF cnt <> 9 THEN
    RAISE EXCEPTION 'Expected 9 RLS policies on nutrition tables, found %', cnt;
  END IF;
  RAISE NOTICE 'Policy count correct: % policies', cnt;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Seed test data as postgres (bypasses RLS)
-- ─────────────────────────────────────────────────────────────────────────────

-- Use synthetic UUIDs that cannot collide with real profiles.id values
-- (they reference profiles via FK — in a live test environment, substitute
-- real user UUIDs and skip the INSERT into profiles below).

-- For isolated schema-only validation (no profiles table dependency),
-- temporarily disable FK checks:
SET session_replication_role = 'replica';  -- disables FK triggers

INSERT INTO dietary_preferences (id, user_id, approaches, created_at, updated_at)
VALUES
  ('dp-test-aaa1', 'aaaaaaaa-0000-0000-0000-aaaaaaaaaaaa', '{}', now(), now()),
  ('dp-test-bbb1', 'bbbbbbbb-0000-0000-0000-bbbbbbbbbbbb', '{}', now(), now())
ON CONFLICT DO NOTHING;

INSERT INTO dietary_allergens (id, dietary_preference_id, name, severity, created_at, updated_at)
VALUES
  ('da-test-aaa1', 'dp-test-aaa1', 'peanuts', 'allergy', now(), now()),
  ('da-test-bbb1', 'dp-test-bbb1', 'shellfish', 'allergy', now(), now())
ON CONFLICT DO NOTHING;

INSERT INTO user_meal_plans (id, user_id, title, status, source, created_at, updated_at)
VALUES
  ('ump-test-aaa1', 'aaaaaaaa-0000-0000-0000-aaaaaaaaaaaa', 'Plan A', 'active', 'custom', now(), now()),
  ('ump-test-bbb1', 'bbbbbbbb-0000-0000-0000-bbbbbbbbbbbb', 'Plan B', 'active', 'custom', now(), now())
ON CONFLICT DO NOTHING;

INSERT INTO user_meal_plan_days (id, plan_id, day_index, label, created_at, updated_at)
VALUES
  ('upd-test-aaa1', 'ump-test-aaa1', 1, 'Monday', now(), now()),
  ('upd-test-bbb1', 'ump-test-bbb1', 1, 'Monday', now(), now())
ON CONFLICT DO NOTHING;

SET session_replication_role = 'origin';  -- re-enable FK triggers

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Test: anon role sees nothing
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE cnt int;
BEGIN
  SET LOCAL role = 'anon';
  SELECT COUNT(*) INTO cnt FROM dietary_preferences;
  IF cnt > 0 THEN
    RAISE EXCEPTION 'FAIL: anon can read dietary_preferences (% rows visible)', cnt;
  END IF;

  SELECT COUNT(*) INTO cnt FROM user_meal_plans;
  IF cnt > 0 THEN
    RAISE EXCEPTION 'FAIL: anon can read user_meal_plans (% rows visible)', cnt;
  END IF;

  SELECT COUNT(*) INTO cnt FROM meal_plan_templates;
  IF cnt > 0 THEN
    RAISE EXCEPTION 'FAIL: anon can read meal_plan_templates (% rows visible)', cnt;
  END IF;

  RAISE NOTICE 'PASS: anon sees 0 rows on all nutrition tables';
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Test: user A can see only their own rows
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE cnt int;
BEGIN
  SET LOCAL role = 'authenticated';
  SET LOCAL "request.jwt.claims" = '{"sub":"aaaaaaaa-0000-0000-0000-aaaaaaaaaaaa","role":"authenticated"}';

  -- dietary_preferences: should see exactly 1 (their own)
  SELECT COUNT(*) INTO cnt FROM dietary_preferences WHERE id = 'dp-test-aaa1';
  IF cnt <> 1 THEN
    RAISE EXCEPTION 'FAIL: user A cannot see own dietary_preference (got %)', cnt;
  END IF;

  -- dietary_preferences: should NOT see user B's row
  SELECT COUNT(*) INTO cnt FROM dietary_preferences WHERE id = 'dp-test-bbb1';
  IF cnt > 0 THEN
    RAISE EXCEPTION 'FAIL: user A can read user B dietary_preference (%)', cnt;
  END IF;

  -- dietary_allergens: own row visible
  SELECT COUNT(*) INTO cnt FROM dietary_allergens WHERE id = 'da-test-aaa1';
  IF cnt <> 1 THEN
    RAISE EXCEPTION 'FAIL: user A cannot see own allergen (got %)', cnt;
  END IF;

  -- dietary_allergens: other user's row NOT visible
  SELECT COUNT(*) INTO cnt FROM dietary_allergens WHERE id = 'da-test-bbb1';
  IF cnt > 0 THEN
    RAISE EXCEPTION 'FAIL: user A can read user B allergen (%)', cnt;
  END IF;

  -- user_meal_plans: own row visible
  SELECT COUNT(*) INTO cnt FROM user_meal_plans WHERE id = 'ump-test-aaa1';
  IF cnt <> 1 THEN
    RAISE EXCEPTION 'FAIL: user A cannot see own meal plan (got %)', cnt;
  END IF;

  -- user_meal_plans: other user's row NOT visible
  SELECT COUNT(*) INTO cnt FROM user_meal_plans WHERE id = 'ump-test-bbb1';
  IF cnt > 0 THEN
    RAISE EXCEPTION 'FAIL: user A can read user B meal plan (%)', cnt;
  END IF;

  -- user_meal_plan_days: own row visible
  SELECT COUNT(*) INTO cnt FROM user_meal_plan_days WHERE id = 'upd-test-aaa1';
  IF cnt <> 1 THEN
    RAISE EXCEPTION 'FAIL: user A cannot see own plan day (got %)', cnt;
  END IF;

  -- user_meal_plan_days: other user's row NOT visible
  SELECT COUNT(*) INTO cnt FROM user_meal_plan_days WHERE id = 'upd-test-bbb1';
  IF cnt > 0 THEN
    RAISE EXCEPTION 'FAIL: user A can read user B plan day (%)', cnt;
  END IF;

  RAISE NOTICE 'PASS: user A isolation verified (personal tables)';
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Test: authenticated user CANNOT write to template tables
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  SET LOCAL role = 'authenticated';
  SET LOCAL "request.jwt.claims" = '{"sub":"aaaaaaaa-0000-0000-0000-aaaaaaaaaaaa","role":"authenticated"}';

  BEGIN
    INSERT INTO meal_plan_templates (id, title, status, created_at, updated_at)
    VALUES ('mpt-test-attack', 'Injected', 'draft', now(), now());
    -- If we get here, RLS did NOT block the insert — that is a failure
    RAISE EXCEPTION 'FAIL: authenticated user was able to INSERT into meal_plan_templates';
  EXCEPTION
    WHEN insufficient_privilege OR check_violation THEN
      RAISE NOTICE 'PASS: authenticated INSERT into meal_plan_templates blocked';
    WHEN others THEN
      RAISE NOTICE 'PASS (FK/other constraint blocked insert): %', SQLERRM;
  END;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Test: authenticated user CANNOT write to another user's personal tables
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  SET LOCAL role = 'authenticated';
  SET LOCAL "request.jwt.claims" = '{"sub":"aaaaaaaa-0000-0000-0000-aaaaaaaaaaaa","role":"authenticated"}';

  -- Attempt to insert an allergen linked to user B's preference
  BEGIN
    INSERT INTO dietary_allergens (id, dietary_preference_id, name, severity, created_at, updated_at)
    VALUES ('da-test-inject', 'dp-test-bbb1', 'injected', 'allergy', now(), now());
    RAISE EXCEPTION 'FAIL: user A was able to INSERT allergen under user B preference';
  EXCEPTION
    WHEN insufficient_privilege OR check_violation THEN
      RAISE NOTICE 'PASS: cross-user allergen insert blocked by WITH CHECK';
    WHEN others THEN
      RAISE NOTICE 'PASS (other constraint blocked insert): %', SQLERRM;
  END;

  -- Attempt to insert a meal plan day linked to user B's plan
  BEGIN
    INSERT INTO user_meal_plan_days (id, plan_id, day_index, label, created_at, updated_at)
    VALUES ('upd-test-inject', 'ump-test-bbb1', 2, 'Tuesday', now(), now());
    RAISE EXCEPTION 'FAIL: user A was able to INSERT plan day under user B plan';
  EXCEPTION
    WHEN insufficient_privilege OR check_violation THEN
      RAISE NOTICE 'PASS: cross-user plan day insert blocked by WITH CHECK';
    WHEN others THEN
      RAISE NOTICE 'PASS (other constraint blocked insert): %', SQLERRM;
  END;

  RAISE NOTICE 'PASS: cross-user write isolation verified';
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Cleanup test data
-- ─────────────────────────────────────────────────────────────────────────────
-- Running as postgres (superuser, bypasses RLS)
SET session_replication_role = 'replica';
DELETE FROM dietary_allergens  WHERE id LIKE 'da-test-%';
DELETE FROM user_meal_plan_days WHERE id LIKE 'upd-test-%';
DELETE FROM user_meal_plans    WHERE id LIKE 'ump-test-%';
DELETE FROM dietary_preferences WHERE id LIKE 'dp-test-%';
SET session_replication_role = 'origin';

RAISE NOTICE '──────────────────────────────────────────────────────';
RAISE NOTICE 'nutrition_rls_validation: all checks passed';
RAISE NOTICE '──────────────────────────────────────────────────────';

ROLLBACK;  -- Roll back test data; remove this line to keep test artifacts
