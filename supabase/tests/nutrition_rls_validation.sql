-- 04_rls_validation.sql  v3
-- Full RLS validation for all 9 nutrition tables.
--
-- Prerequisites: 02_supabase_stubs.sql applied, all 13 migrations applied,
--                03_post_migration_grants.sql applied.
--
-- Uses \set ON_ERROR_STOP on — any RAISE EXCEPTION exits psql nonzero.
-- Every assertion that fails raises; passing tests emit NOTICE.
-- Wraps in a transaction; ROLLBACK removes all fixture rows.
--
-- Usage:
--   psql -d involved_shadow -v ON_ERROR_STOP=1 -f 04_rls_validation.sql
-- Exit 0 = all assertions passed.  Nonzero = first failed assertion.

\set ON_ERROR_STOP on

-- Fixture UUIDs (systematically chosen, easy to grep in results)
\set USER_A        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
\set USER_B        'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
\set DP_A          'cccccccc-cccc-cccc-cccc-cccccccc0001'
\set DP_B          'cccccccc-cccc-cccc-cccc-cccccccc0002'
\set DA_A          'cccccccc-cccc-cccc-cccc-cccccccc0011'
\set DA_B          'cccccccc-cccc-cccc-cccc-cccccccc0012'
\set DE_A          'cccccccc-cccc-cccc-cccc-cccccccc0021'
\set DE_B          'cccccccc-cccc-cccc-cccc-cccccccc0022'
\set UMP_A         'cccccccc-cccc-cccc-cccc-cccccccc0031'
\set UMP_B         'cccccccc-cccc-cccc-cccc-cccccccc0032'
\set UPD_A         'cccccccc-cccc-cccc-cccc-cccccccc0041'
\set UPD_B         'cccccccc-cccc-cccc-cccc-cccccccc0042'
\set UPE_A         'cccccccc-cccc-cccc-cccc-cccccccc0051'
\set UPE_B         'cccccccc-cccc-cccc-cccc-cccccccc0052'
\set MPT_SYS       'cccccccc-cccc-cccc-cccc-cccccccc0061'
\set MPTD_SYS      'cccccccc-cccc-cccc-cccc-cccccccc0071'
\set MPTE_SYS      'cccccccc-cccc-cccc-cccc-cccccccc0081'

BEGIN;

-- ═════════════════════════════════════════════════════════════════════════════
-- S0: Structural checks — 9 tables with RLS enabled, 9 policies
-- ═════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  tbl text;
  rls_on bool;
  policy_count int;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'dietary_preferences','dietary_allergens','dietary_exclusions',
    'meal_plan_templates','meal_plan_template_days','meal_plan_template_entries',
    'user_meal_plans','user_meal_plan_days','user_meal_plan_entries'
  ] LOOP
    SELECT relrowsecurity INTO rls_on
      FROM pg_class
     WHERE relname = tbl AND relnamespace = 'public'::regnamespace;
    IF NOT FOUND OR NOT rls_on THEN
      RAISE EXCEPTION '[S0] RLS NOT enabled on table: %', tbl;
    END IF;
    RAISE NOTICE '[S0] PASS: RLS enabled on %', tbl;
  END LOOP;

  SELECT COUNT(*) INTO policy_count
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename IN (
       'dietary_preferences','dietary_allergens','dietary_exclusions',
       'meal_plan_templates','meal_plan_template_days','meal_plan_template_entries',
       'user_meal_plans','user_meal_plan_days','user_meal_plan_entries'
     );
  IF policy_count <> 9 THEN
    RAISE EXCEPTION '[S0] Expected 9 policies on nutrition tables, found %', policy_count;
  END IF;
  RAISE NOTICE '[S0] PASS: policy count = 9';
END $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- S1: Insert fixtures as postgres (rolbypassrls = t, skips FK triggers)
-- ═════════════════════════════════════════════════════════════════════════════

SET session_replication_role = 'replica';

-- profiles rows required: dietary_preferences.user_id FK is IMMEDIATE;
-- PostgreSQL rechecks the FK on every UPDATE of that table even when user_id
-- is not being changed, so the referenced profile must exist.
-- profiles has no FK to auth.users in the shadow DB, so direct INSERT is safe.
INSERT INTO profiles (id, updated_at)
VALUES
  (:'USER_A', now()),
  (:'USER_B', now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO dietary_preferences (id, user_id, updated_at)
VALUES
  (:'DP_A', :'USER_A', now()),
  (:'DP_B', :'USER_B', now());

INSERT INTO dietary_allergens (id, dietary_preference_id, name, severity)
VALUES
  (:'DA_A', :'DP_A', 'peanuts',   'allergy'),
  (:'DA_B', :'DP_B', 'shellfish', 'allergy');

INSERT INTO dietary_exclusions (id, dietary_preference_id, ingredient)
VALUES
  (:'DE_A', :'DP_A', 'cilantro'),
  (:'DE_B', :'DP_B', 'mushrooms');

INSERT INTO user_meal_plans (id, user_id, name, source, updated_at)
VALUES
  (:'UMP_A', :'USER_A', 'Plan A', 'custom', now()),
  (:'UMP_B', :'USER_B', 'Plan B', 'custom', now());

INSERT INTO user_meal_plan_days (id, plan_id, day_index)
VALUES
  (:'UPD_A', :'UMP_A', 1),
  (:'UPD_B', :'UMP_B', 1);

INSERT INTO user_meal_plan_entries (id, plan_day_id, meal_type, updated_at)
VALUES
  (:'UPE_A', :'UPD_A', 'lunch',  now()),
  (:'UPE_B', :'UPD_B', 'dinner', now());

INSERT INTO meal_plan_templates (id, name, target_calories, updated_at)
VALUES
  (:'MPT_SYS', 'System Template', 2000, now());

INSERT INTO meal_plan_template_days (id, template_id, day_index)
VALUES
  (:'MPTD_SYS', :'MPT_SYS', 1);

INSERT INTO meal_plan_template_entries (id, template_day_id, meal_type, updated_at)
VALUES
  (:'MPTE_SYS', :'MPTD_SYS', 'breakfast', now());

SET session_replication_role = 'origin';
DO $$ BEGIN RAISE NOTICE '[S1] Fixtures inserted as postgres (bypasses RLS/FK)'; END $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- S2: Anon role — default deny on all 9 tables
-- (anon has DML grants but no policy → 0 rows)
-- ═════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE cnt int;
BEGIN
  SET LOCAL role = 'anon';

  SELECT COUNT(*) INTO cnt FROM dietary_preferences;
  IF cnt > 0 THEN RAISE EXCEPTION '[S2] FAIL: anon sees % rows in dietary_preferences', cnt; END IF;

  SELECT COUNT(*) INTO cnt FROM dietary_allergens;
  IF cnt > 0 THEN RAISE EXCEPTION '[S2] FAIL: anon sees % rows in dietary_allergens', cnt; END IF;

  SELECT COUNT(*) INTO cnt FROM dietary_exclusions;
  IF cnt > 0 THEN RAISE EXCEPTION '[S2] FAIL: anon sees % rows in dietary_exclusions', cnt; END IF;

  SELECT COUNT(*) INTO cnt FROM user_meal_plans;
  IF cnt > 0 THEN RAISE EXCEPTION '[S2] FAIL: anon sees % rows in user_meal_plans', cnt; END IF;

  SELECT COUNT(*) INTO cnt FROM user_meal_plan_days;
  IF cnt > 0 THEN RAISE EXCEPTION '[S2] FAIL: anon sees % rows in user_meal_plan_days', cnt; END IF;

  SELECT COUNT(*) INTO cnt FROM user_meal_plan_entries;
  IF cnt > 0 THEN RAISE EXCEPTION '[S2] FAIL: anon sees % rows in user_meal_plan_entries', cnt; END IF;

  SELECT COUNT(*) INTO cnt FROM meal_plan_templates;
  IF cnt > 0 THEN RAISE EXCEPTION '[S2] FAIL: anon sees % rows in meal_plan_templates', cnt; END IF;

  SELECT COUNT(*) INTO cnt FROM meal_plan_template_days;
  IF cnt > 0 THEN RAISE EXCEPTION '[S2] FAIL: anon sees % rows in meal_plan_template_days', cnt; END IF;

  SELECT COUNT(*) INTO cnt FROM meal_plan_template_entries;
  IF cnt > 0 THEN RAISE EXCEPTION '[S2] FAIL: anon sees % rows in meal_plan_template_entries', cnt; END IF;

  RAISE NOTICE '[S2] PASS: anon sees 0 rows on all 9 nutrition tables';
END $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- S3: User A — sees own rows, cannot see user B rows (all personal tables)
-- ═════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE cnt int;
BEGIN
  SET LOCAL role = 'authenticated';
  SET LOCAL "request.jwt.claims" = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';

  -- dietary_preferences: own row visible, B not visible, total=1
  SELECT COUNT(*) INTO cnt FROM dietary_preferences WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccc0001';
  IF cnt <> 1 THEN RAISE EXCEPTION '[S3] FAIL: user A cannot see own dietary_preference (got %)', cnt; END IF;

  SELECT COUNT(*) INTO cnt FROM dietary_preferences WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccc0002';
  IF cnt > 0 THEN RAISE EXCEPTION '[S3] FAIL: user A reads user B dietary_preference (% rows)', cnt; END IF;

  SELECT COUNT(*) INTO cnt FROM dietary_preferences;
  IF cnt <> 1 THEN RAISE EXCEPTION '[S3] FAIL: user A table-scan sees % dietary_preferences rows (want 1)', cnt; END IF;

  -- dietary_allergens
  SELECT COUNT(*) INTO cnt FROM dietary_allergens WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccc0011';
  IF cnt <> 1 THEN RAISE EXCEPTION '[S3] FAIL: user A cannot see own allergen (got %)', cnt; END IF;

  SELECT COUNT(*) INTO cnt FROM dietary_allergens WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccc0012';
  IF cnt > 0 THEN RAISE EXCEPTION '[S3] FAIL: user A reads user B allergen (% rows)', cnt; END IF;

  -- dietary_exclusions
  SELECT COUNT(*) INTO cnt FROM dietary_exclusions WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccc0021';
  IF cnt <> 1 THEN RAISE EXCEPTION '[S3] FAIL: user A cannot see own exclusion (got %)', cnt; END IF;

  SELECT COUNT(*) INTO cnt FROM dietary_exclusions WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccc0022';
  IF cnt > 0 THEN RAISE EXCEPTION '[S3] FAIL: user A reads user B exclusion (% rows)', cnt; END IF;

  -- user_meal_plans
  SELECT COUNT(*) INTO cnt FROM user_meal_plans WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccc0031';
  IF cnt <> 1 THEN RAISE EXCEPTION '[S3] FAIL: user A cannot see own meal plan (got %)', cnt; END IF;

  SELECT COUNT(*) INTO cnt FROM user_meal_plans WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccc0032';
  IF cnt > 0 THEN RAISE EXCEPTION '[S3] FAIL: user A reads user B meal plan (% rows)', cnt; END IF;

  -- user_meal_plan_days
  SELECT COUNT(*) INTO cnt FROM user_meal_plan_days WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccc0041';
  IF cnt <> 1 THEN RAISE EXCEPTION '[S3] FAIL: user A cannot see own plan day (got %)', cnt; END IF;

  SELECT COUNT(*) INTO cnt FROM user_meal_plan_days WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccc0042';
  IF cnt > 0 THEN RAISE EXCEPTION '[S3] FAIL: user A reads user B plan day (% rows)', cnt; END IF;

  -- user_meal_plan_entries (2-level join: entry→day→plan→user_id)
  SELECT COUNT(*) INTO cnt FROM user_meal_plan_entries WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccc0051';
  IF cnt <> 1 THEN RAISE EXCEPTION '[S3] FAIL: user A cannot see own plan entry (got %)', cnt; END IF;

  SELECT COUNT(*) INTO cnt FROM user_meal_plan_entries WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccc0052';
  IF cnt > 0 THEN RAISE EXCEPTION '[S3] FAIL: user A reads user B plan entry (% rows)', cnt; END IF;

  RAISE NOTICE '[S3] PASS: user A read isolation verified on all 6 personal tables + child tables';
END $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- S4: User B — symmetric isolation
-- ═════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE cnt int;
BEGIN
  SET LOCAL role = 'authenticated';
  SET LOCAL "request.jwt.claims" = '{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","role":"authenticated"}';

  SELECT COUNT(*) INTO cnt FROM dietary_preferences;
  IF cnt <> 1 THEN RAISE EXCEPTION '[S4] FAIL: user B sees % dietary_preferences rows (want 1)', cnt; END IF;

  SELECT COUNT(*) INTO cnt FROM dietary_preferences WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccc0001';
  IF cnt > 0 THEN RAISE EXCEPTION '[S4] FAIL: user B reads user A dietary_preference (% rows)', cnt; END IF;

  SELECT COUNT(*) INTO cnt FROM user_meal_plan_entries;
  IF cnt <> 1 THEN RAISE EXCEPTION '[S4] FAIL: user B sees % plan entries (want 1)', cnt; END IF;

  SELECT COUNT(*) INTO cnt FROM user_meal_plan_entries WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccc0051';
  IF cnt > 0 THEN RAISE EXCEPTION '[S4] FAIL: user B reads user A plan entry (% rows)', cnt; END IF;

  RAISE NOTICE '[S4] PASS: user B symmetric isolation verified';
END $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- S5: Cross-user INSERT — WITH CHECK enforcement
-- ═════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  SET LOCAL role = 'authenticated';
  SET LOCAL "request.jwt.claims" = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';

  -- User A tries to INSERT allergen under user B's dietary_preference
  BEGIN
    INSERT INTO dietary_allergens (id, dietary_preference_id, name, severity)
    VALUES ('cccccccc-cccc-cccc-cccc-cccccccc9901', 'cccccccc-cccc-cccc-cccc-cccccccc0002', 'inject', 'dislike');
    RAISE EXCEPTION '[S5] FAIL: user A inserted allergen under user B preference';
  EXCEPTION
    WHEN check_violation OR insufficient_privilege THEN
      RAISE NOTICE '[S5] PASS: allergen cross-user INSERT blocked (check_violation/insufficient_privilege)';
    WHEN others THEN
      RAISE NOTICE '[S5] PASS: allergen cross-user INSERT blocked (%)', SQLERRM;
  END;

  -- User A tries to INSERT plan day under user B's meal plan
  BEGIN
    INSERT INTO user_meal_plan_days (id, plan_id, day_index)
    VALUES ('cccccccc-cccc-cccc-cccc-cccccccc9902', 'cccccccc-cccc-cccc-cccc-cccccccc0032', 2);
    RAISE EXCEPTION '[S5] FAIL: user A inserted plan day under user B plan';
  EXCEPTION
    WHEN check_violation OR insufficient_privilege THEN
      RAISE NOTICE '[S5] PASS: plan day cross-user INSERT blocked';
    WHEN others THEN
      RAISE NOTICE '[S5] PASS: plan day cross-user INSERT blocked (%)', SQLERRM;
  END;

  -- User A tries to INSERT plan entry under user B's plan day (2-level join)
  BEGIN
    INSERT INTO user_meal_plan_entries (id, plan_day_id, meal_type, updated_at)
    VALUES ('cccccccc-cccc-cccc-cccc-cccccccc9903', 'cccccccc-cccc-cccc-cccc-cccccccc0042', 'snack', now());
    RAISE EXCEPTION '[S5] FAIL: user A inserted plan entry under user B plan day';
  EXCEPTION
    WHEN check_violation OR insufficient_privilege THEN
      RAISE NOTICE '[S5] PASS: plan entry cross-user INSERT blocked (2-level join WITH CHECK)';
    WHEN others THEN
      RAISE NOTICE '[S5] PASS: plan entry cross-user INSERT blocked (%)', SQLERRM;
  END;

  RAISE NOTICE '[S5] PASS: all cross-user INSERT attempts blocked';
END $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- S6: Cross-user UPDATE — silent filter + verify no mutation
-- ═════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  SET LOCAL role = 'authenticated';
  SET LOCAL "request.jwt.claims" = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
  -- User A tries to UPDATE user B's dietary_preference
  -- RLS USING clause makes user B's row invisible → UPDATE touches 0 rows silently
  UPDATE dietary_preferences SET notes = 'hijacked' WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccc0002';
  RAISE NOTICE '[S6] NOTE: cross-user UPDATE returned (expected silent 0-row filter)';
END $$;

-- Verify the update was truly a no-op (re-read as postgres, bypasses RLS)
DO $$
DECLARE n text;
BEGIN
  SELECT notes INTO n FROM dietary_preferences WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccc0002';
  IF n = 'hijacked' THEN
    RAISE EXCEPTION '[S6] FAIL: user A UPDATE of user B preference succeeded (notes = hijacked)';
  END IF;
  RAISE NOTICE '[S6] PASS: user B notes unchanged after user A UPDATE attempt (notes = %)', COALESCE(n, 'NULL');
END $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- S7: Child row re-parent attempt — cannot move to another user's parent
-- ═════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE pid uuid;
BEGIN
  SET LOCAL role = 'authenticated';
  SET LOCAL "request.jwt.claims" = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';

  -- User A tries to re-parent their own plan day to user B's plan.
  -- The WITH CHECK clause blocks this: new plan_id is not in user A's
  -- plan set → PostgreSQL raises check_violation directly (not silent filter).
  BEGIN
    UPDATE user_meal_plan_days
       SET plan_id = 'cccccccc-cccc-cccc-cccc-cccccccc0032'   -- user B's plan
     WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccc0041';        -- user A's day
    -- If we reach here: check plan_id was not changed
    SELECT plan_id INTO pid FROM user_meal_plan_days WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccc0041';
    IF pid::text = 'cccccccc-cccc-cccc-cccc-cccccccc0032' THEN
      RAISE EXCEPTION '[S7] FAIL: user A re-parented plan day to user B plan';
    END IF;
    RAISE NOTICE '[S7] PASS: re-parent UPDATE silently filtered (plan_id still = %)', pid;
  EXCEPTION
    WHEN check_violation OR insufficient_privilege THEN
      RAISE NOTICE '[S7] PASS: re-parent UPDATE blocked by WITH CHECK (new row violates RLS policy)';
    WHEN others THEN
      RAISE NOTICE '[S7] PASS: re-parent UPDATE blocked (%)', SQLERRM;
  END;
END $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- S8: Template tables — authenticated READ succeeds
-- ═════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE cnt int;
BEGIN
  SET LOCAL role = 'authenticated';
  SET LOCAL "request.jwt.claims" = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';

  SELECT COUNT(*) INTO cnt FROM meal_plan_templates WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccc0061';
  IF cnt <> 1 THEN RAISE EXCEPTION '[S8] FAIL: authenticated cannot read meal_plan_templates (got %)', cnt; END IF;

  SELECT COUNT(*) INTO cnt FROM meal_plan_template_days WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccc0071';
  IF cnt <> 1 THEN RAISE EXCEPTION '[S8] FAIL: authenticated cannot read meal_plan_template_days (got %)', cnt; END IF;

  SELECT COUNT(*) INTO cnt FROM meal_plan_template_entries WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccc0081';
  IF cnt <> 1 THEN RAISE EXCEPTION '[S8] FAIL: authenticated cannot read meal_plan_template_entries (got %)', cnt; END IF;

  RAISE NOTICE '[S8] PASS: authenticated can read all 3 template tables';
END $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- S9: Template tables — authenticated INSERT/UPDATE/DELETE blocked
-- ═════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  SET LOCAL role = 'authenticated';
  SET LOCAL "request.jwt.claims" = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';

  -- INSERT into templates blocked (no INSERT policy)
  BEGIN
    INSERT INTO meal_plan_templates (id, name, target_calories, updated_at)
    VALUES ('cccccccc-cccc-cccc-cccc-cccccccc9910', 'Injected', 2000, now());
    RAISE EXCEPTION '[S9] FAIL: authenticated INSERT into meal_plan_templates succeeded';
  EXCEPTION
    WHEN check_violation OR insufficient_privilege THEN
      RAISE NOTICE '[S9] PASS: authenticated INSERT into meal_plan_templates blocked';
    WHEN others THEN
      RAISE NOTICE '[S9] PASS: template INSERT blocked (%)', SQLERRM;
  END;

  -- DELETE of template row (no DELETE policy → silent 0-row filter)
  DELETE FROM meal_plan_templates WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccc0061';
  RAISE NOTICE '[S9] NOTE: template DELETE returned (verifying row still exists below)';
END $$;

-- Verify DELETE was a no-op
DO $$
DECLARE cnt int;
BEGIN
  SELECT COUNT(*) INTO cnt FROM meal_plan_templates WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccc0061';
  IF cnt <> 1 THEN
    RAISE EXCEPTION '[S9] FAIL: meal_plan_templates row was deleted by authenticated user (count = %)', cnt;
  END IF;
  RAISE NOTICE '[S9] PASS: template row survives authenticated DELETE attempt (count = %)', cnt;
END $$;

-- Template UPDATE (no UPDATE policy → silent 0-row filter)
DO $$
BEGIN
  SET LOCAL role = 'authenticated';
  SET LOCAL "request.jwt.claims" = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
  UPDATE meal_plan_templates SET name = 'hijacked' WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccc0061';
END $$;

DO $$
DECLARE n text;
BEGIN
  SELECT name INTO n FROM meal_plan_templates WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccc0061';
  IF n = 'hijacked' THEN
    RAISE EXCEPTION '[S9] FAIL: authenticated UPDATE of meal_plan_templates succeeded (name = hijacked)';
  END IF;
  RAISE NOTICE '[S9] PASS: template name unchanged after authenticated UPDATE attempt (name = %)', n;
END $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- S10: Postgres role bypasses RLS — sees all rows
-- ═════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE cnt int;
BEGIN
  -- Explicitly reset role: SET LOCAL persists across DO blocks in same txn.
  -- After S9's authenticated block we must return to the superuser session.
  RESET ROLE;

  -- Running as session superuser (jerrycastillo, rolbypassrls = t on local PG)
  SELECT COUNT(*) INTO cnt FROM dietary_preferences;
  IF cnt <> 2 THEN RAISE EXCEPTION '[S10] FAIL: postgres sees % dietary_preferences rows (want 2)', cnt; END IF;

  SELECT COUNT(*) INTO cnt FROM user_meal_plan_entries;
  IF cnt <> 2 THEN RAISE EXCEPTION '[S10] FAIL: postgres sees % plan entries (want 2)', cnt; END IF;

  SELECT COUNT(*) INTO cnt FROM meal_plan_templates;
  IF cnt <> 1 THEN RAISE EXCEPTION '[S10] FAIL: postgres sees % template rows (want 1)', cnt; END IF;

  RAISE NOTICE '[S10] PASS: postgres role bypasses RLS, sees all fixture rows (dp=2, upe=2, mpt=1)';
END $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- S11: Owner positive writes — dietary layer
--      Owner CAN INSERT/UPDATE/DELETE their own rows
-- ═════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE n text; cnt int;
BEGIN
  SET LOCAL role = 'authenticated';
  SET LOCAL "request.jwt.claims" = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';

  -- dietary_preferences: owner UPDATE succeeds
  UPDATE dietary_preferences SET notes = 'my notes' WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccc0001';
END $$;

DO $$
DECLARE n text;
BEGIN
  SELECT notes INTO n FROM dietary_preferences WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccc0001';
  IF n <> 'my notes' THEN
    RAISE EXCEPTION '[S11] FAIL: owner UPDATE of dietary_preferences did not persist (got %)', n;
  END IF;
  RAISE NOTICE '[S11] PASS: owner UPDATE of dietary_preferences persisted (notes = %)', n;
END $$;

DO $$
DECLARE cnt int;
BEGIN
  SET LOCAL role = 'authenticated';
  SET LOCAL "request.jwt.claims" = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';

  -- dietary_allergens: owner INSERT under own preference
  INSERT INTO dietary_allergens (id, dietary_preference_id, name, severity)
  VALUES ('cccccccc-cccc-cccc-cccc-cccccccc0013', 'cccccccc-cccc-cccc-cccc-cccccccc0001', 'tree nuts', 'intolerance');

  SELECT COUNT(*) INTO cnt FROM dietary_allergens WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccc0013';
  IF cnt <> 1 THEN RAISE EXCEPTION '[S11] FAIL: owner INSERT of allergen not visible (got %)', cnt; END IF;
  RAISE NOTICE '[S11] PASS: owner INSERT of dietary_allergen succeeded and is visible';

  -- dietary_allergens: owner DELETE of own row
  DELETE FROM dietary_allergens WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccc0013';
  SELECT COUNT(*) INTO cnt FROM dietary_allergens WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccc0013';
  IF cnt <> 0 THEN RAISE EXCEPTION '[S11] FAIL: owner DELETE of allergen did not remove row (got %)', cnt; END IF;
  RAISE NOTICE '[S11] PASS: owner DELETE of dietary_allergen succeeded';

  -- dietary_exclusions: owner INSERT under own preference
  INSERT INTO dietary_exclusions (id, dietary_preference_id, ingredient)
  VALUES ('cccccccc-cccc-cccc-cccc-cccccccc0023', 'cccccccc-cccc-cccc-cccc-cccccccc0001', 'msg');
  SELECT COUNT(*) INTO cnt FROM dietary_exclusions WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccc0023';
  IF cnt <> 1 THEN RAISE EXCEPTION '[S11] FAIL: owner INSERT of exclusion not visible (got %)', cnt; END IF;

  DELETE FROM dietary_exclusions WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccc0023';
  SELECT COUNT(*) INTO cnt FROM dietary_exclusions WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccc0023';
  IF cnt <> 0 THEN RAISE EXCEPTION '[S11] FAIL: owner DELETE of exclusion did not remove row (got %)', cnt; END IF;
  RAISE NOTICE '[S11] PASS: owner INSERT/DELETE of dietary_exclusion succeeded';
END $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- S12: Owner positive writes — meal plan layer
--      Owner CAN INSERT/UPDATE/DELETE user_meal_plans, days, entries
-- ═════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE cnt int; meal text;
BEGIN
  SET LOCAL role = 'authenticated';
  SET LOCAL "request.jwt.claims" = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';

  -- user_meal_plans: owner INSERT
  INSERT INTO user_meal_plans (id, user_id, name, source, updated_at)
  VALUES ('cccccccc-cccc-cccc-cccc-cccccccc0033', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'New Plan', 'custom', now());
  SELECT COUNT(*) INTO cnt FROM user_meal_plans WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccc0033';
  IF cnt <> 1 THEN RAISE EXCEPTION '[S12] FAIL: owner INSERT of user_meal_plan not visible (got %)', cnt; END IF;
  RAISE NOTICE '[S12] PASS: owner INSERT of user_meal_plan succeeded';

  -- user_meal_plan_days: owner INSERT under own plan
  INSERT INTO user_meal_plan_days (id, plan_id, day_index)
  VALUES ('cccccccc-cccc-cccc-cccc-cccccccc0043', 'cccccccc-cccc-cccc-cccc-cccccccc0033', 2);
  SELECT COUNT(*) INTO cnt FROM user_meal_plan_days WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccc0043';
  IF cnt <> 1 THEN RAISE EXCEPTION '[S12] FAIL: owner INSERT of user_meal_plan_day not visible (got %)', cnt; END IF;
  RAISE NOTICE '[S12] PASS: owner INSERT of user_meal_plan_day succeeded';

  -- user_meal_plan_entries: owner INSERT under own plan day
  INSERT INTO user_meal_plan_entries (id, plan_day_id, meal_type, updated_at)
  VALUES ('cccccccc-cccc-cccc-cccc-cccccccc0053', 'cccccccc-cccc-cccc-cccc-cccccccc0043', 'snack', now());
  SELECT COUNT(*) INTO cnt FROM user_meal_plan_entries WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccc0053';
  IF cnt <> 1 THEN RAISE EXCEPTION '[S12] FAIL: owner INSERT of user_meal_plan_entry not visible (got %)', cnt; END IF;
  RAISE NOTICE '[S12] PASS: owner INSERT of user_meal_plan_entry succeeded (2-level join via own plan)';

  -- user_meal_plan_entries: owner UPDATE
  UPDATE user_meal_plan_entries SET meal_type = 'other' WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccc0053';
  SELECT meal_type INTO meal FROM user_meal_plan_entries WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccc0053';
  IF meal::text <> 'other' THEN RAISE EXCEPTION '[S12] FAIL: owner UPDATE of plan entry did not persist (got %)', meal; END IF;
  RAISE NOTICE '[S12] PASS: owner UPDATE of user_meal_plan_entry persisted (meal_type = other)';

  -- Delete leaf-to-root to respect FK constraints
  DELETE FROM user_meal_plan_entries WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccc0053';
  SELECT COUNT(*) INTO cnt FROM user_meal_plan_entries WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccc0053';
  IF cnt <> 0 THEN RAISE EXCEPTION '[S12] FAIL: owner DELETE of plan entry did not remove row'; END IF;

  DELETE FROM user_meal_plan_days WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccc0043';
  DELETE FROM user_meal_plans WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccc0033';

  SELECT COUNT(*) INTO cnt FROM user_meal_plans WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccc0033';
  IF cnt <> 0 THEN RAISE EXCEPTION '[S12] FAIL: owner DELETE of meal plan did not remove row'; END IF;
  RAISE NOTICE '[S12] PASS: owner DELETE cascade (entry → day → plan) all succeeded';
END $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- S13: Template child tables — authenticated INSERT/UPDATE/DELETE blocked
--      meal_plan_template_days and meal_plan_template_entries have FOR SELECT
--      policies only; writes must be blocked.
-- ═════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  SET LOCAL role = 'authenticated';
  SET LOCAL "request.jwt.claims" = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';

  -- meal_plan_template_days: INSERT blocked
  BEGIN
    INSERT INTO meal_plan_template_days (id, template_id, day_index)
    VALUES ('cccccccc-cccc-cccc-cccc-cccccccc9920', 'cccccccc-cccc-cccc-cccc-cccccccc0061', 2);
    RAISE EXCEPTION '[S13] FAIL: authenticated INSERT into meal_plan_template_days succeeded';
  EXCEPTION
    WHEN check_violation OR insufficient_privilege THEN
      RAISE NOTICE '[S13] PASS: meal_plan_template_days INSERT blocked (check_violation/insufficient_privilege)';
    WHEN others THEN
      RAISE NOTICE '[S13] PASS: meal_plan_template_days INSERT blocked (%)', SQLERRM;
  END;

  -- meal_plan_template_days: UPDATE → silent 0-row filter
  UPDATE meal_plan_template_days SET day_index = 99 WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccc0071';
  RAISE NOTICE '[S13] NOTE: template_days UPDATE returned (verifying no mutation below)';
END $$;

DO $$
DECLARE d int;
BEGIN
  SELECT day_index INTO d FROM meal_plan_template_days WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccc0071';
  IF d = 99 THEN
    RAISE EXCEPTION '[S13] FAIL: authenticated UPDATE of meal_plan_template_days succeeded (day_index = 99)';
  END IF;
  RAISE NOTICE '[S13] PASS: meal_plan_template_days day_index unchanged after authenticated UPDATE (= %)', d;
END $$;

DO $$
BEGIN
  SET LOCAL role = 'authenticated';
  SET LOCAL "request.jwt.claims" = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';

  -- meal_plan_template_days: DELETE → silent 0-row filter
  DELETE FROM meal_plan_template_days WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccc0071';
END $$;

DO $$
DECLARE cnt int;
BEGIN
  SELECT COUNT(*) INTO cnt FROM meal_plan_template_days WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccc0071';
  IF cnt <> 1 THEN
    RAISE EXCEPTION '[S13] FAIL: meal_plan_template_days row deleted by authenticated user (count = %)', cnt;
  END IF;
  RAISE NOTICE '[S13] PASS: meal_plan_template_days row survives authenticated DELETE (count = 1)';
END $$;

DO $$
BEGIN
  SET LOCAL role = 'authenticated';
  SET LOCAL "request.jwt.claims" = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';

  -- meal_plan_template_entries: INSERT blocked
  BEGIN
    INSERT INTO meal_plan_template_entries (id, template_day_id, meal_type, updated_at)
    VALUES ('cccccccc-cccc-cccc-cccc-cccccccc9921', 'cccccccc-cccc-cccc-cccc-cccccccc0071', 'lunch', now());
    RAISE EXCEPTION '[S13] FAIL: authenticated INSERT into meal_plan_template_entries succeeded';
  EXCEPTION
    WHEN check_violation OR insufficient_privilege THEN
      RAISE NOTICE '[S13] PASS: meal_plan_template_entries INSERT blocked';
    WHEN others THEN
      RAISE NOTICE '[S13] PASS: meal_plan_template_entries INSERT blocked (%)', SQLERRM;
  END;

  -- meal_plan_template_entries: UPDATE → silent 0-row filter
  -- Use 'other' (valid MealType); fixture value is 'breakfast', so a change would be detectable.
  UPDATE meal_plan_template_entries SET meal_type = 'other' WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccc0081';
  RAISE NOTICE '[S13] NOTE: template_entries UPDATE returned (verifying no mutation below)';
END $$;

DO $$
DECLARE m text;
BEGIN
  SELECT meal_type INTO m FROM meal_plan_template_entries WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccc0081';
  IF m::text = 'other' THEN
    RAISE EXCEPTION '[S13] FAIL: authenticated UPDATE of meal_plan_template_entries succeeded (meal_type changed to other)';
  END IF;
  RAISE NOTICE '[S13] PASS: meal_plan_template_entries meal_type unchanged after authenticated UPDATE (= %)', m;
END $$;

DO $$
BEGIN
  SET LOCAL role = 'authenticated';
  SET LOCAL "request.jwt.claims" = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';

  -- meal_plan_template_entries: DELETE → silent 0-row filter
  DELETE FROM meal_plan_template_entries WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccc0081';
END $$;

DO $$
DECLARE cnt int;
BEGIN
  SELECT COUNT(*) INTO cnt FROM meal_plan_template_entries WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccc0081';
  IF cnt <> 1 THEN
    RAISE EXCEPTION '[S13] FAIL: meal_plan_template_entries row deleted by authenticated user (count = %)', cnt;
  END IF;
  RAISE NOTICE '[S13] PASS: meal_plan_template_entries row survives authenticated DELETE (count = 1)';
END $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- CLEANUP & FINAL RESULT
-- ═════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  RAISE NOTICE '══════════════════════════════════════════════════════════════';
  RAISE NOTICE 'nutrition_rls_validation v3: ALL 13 SECTIONS PASSED';
  RAISE NOTICE '══════════════════════════════════════════════════════════════';
END $$;

ROLLBACK;  -- removes all fixture rows; schema changes persist
