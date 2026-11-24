-- nutrition_rls.sql
-- Reference copy of RLS policies for the 9 nutrition tables introduced in
-- migration 20261123000000_nutrition_foundation_milestone1.
--
-- These policies are ALREADY embedded in that migration file and are applied
-- automatically via `prisma migrate deploy`. This file exists as a standalone
-- reference and can be manually re-applied if needed without re-running the
-- full migration.
--
-- Role summary:
--   postgres / service_role  rolbypassrls = t → bypasses all policies
--   authenticated            subject to policies below
--   anon                     no matching policy = default deny on every table
--
-- auth.uid() = profiles.id = user_id FK on personal tables

-- ── dietary_preferences (direct user_id) ─────────────────────────────────────
ALTER TABLE "dietary_preferences" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dietary_preferences: own rows only"
  ON "dietary_preferences" FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ── dietary_allergens (child of dietary_preferences) ─────────────────────────
ALTER TABLE "dietary_allergens" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dietary_allergens: via preference owner"
  ON "dietary_allergens" FOR ALL
  USING (
    dietary_preference_id IN (
      SELECT id FROM dietary_preferences WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    dietary_preference_id IN (
      SELECT id FROM dietary_preferences WHERE user_id = auth.uid()
    )
  );

-- ── dietary_exclusions (child of dietary_preferences) ────────────────────────
ALTER TABLE "dietary_exclusions" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dietary_exclusions: via preference owner"
  ON "dietary_exclusions" FOR ALL
  USING (
    dietary_preference_id IN (
      SELECT id FROM dietary_preferences WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    dietary_preference_id IN (
      SELECT id FROM dietary_preferences WHERE user_id = auth.uid()
    )
  );

-- ── meal_plan_templates (admin-owned, no user_id) ─────────────────────────────
-- Authenticated users: SELECT only. INSERT/UPDATE/DELETE: default-deny.
-- postgres/service_role bypass RLS → admin writes still work.
ALTER TABLE "meal_plan_templates" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "meal_plan_templates: authenticated read-only"
  ON "meal_plan_templates" FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- ── meal_plan_template_days (child of meal_plan_templates) ───────────────────
ALTER TABLE "meal_plan_template_days" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "meal_plan_template_days: authenticated read-only"
  ON "meal_plan_template_days" FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- ── meal_plan_template_entries (child of meal_plan_template_days) ────────────
ALTER TABLE "meal_plan_template_entries" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "meal_plan_template_entries: authenticated read-only"
  ON "meal_plan_template_entries" FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- ── user_meal_plans (direct user_id) ─────────────────────────────────────────
ALTER TABLE "user_meal_plans" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_meal_plans: own rows only"
  ON "user_meal_plans" FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ── user_meal_plan_days (child of user_meal_plans) ───────────────────────────
ALTER TABLE "user_meal_plan_days" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_meal_plan_days: via plan owner"
  ON "user_meal_plan_days" FOR ALL
  USING (
    plan_id IN (
      SELECT id FROM user_meal_plans WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    plan_id IN (
      SELECT id FROM user_meal_plans WHERE user_id = auth.uid()
    )
  );

-- ── user_meal_plan_entries (grandchild: plan_day → plan → user_id) ───────────
ALTER TABLE "user_meal_plan_entries" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_meal_plan_entries: via plan owner"
  ON "user_meal_plan_entries" FOR ALL
  USING (
    plan_day_id IN (
      SELECT upd.id
        FROM user_meal_plan_days upd
        JOIN user_meal_plans ump ON ump.id = upd.plan_id
       WHERE ump.user_id = auth.uid()
    )
  )
  WITH CHECK (
    plan_day_id IN (
      SELECT upd.id
        FROM user_meal_plan_days upd
        JOIN user_meal_plans ump ON ump.id = upd.plan_id
       WHERE ump.user_id = auth.uid()
    )
  );
