-- CreateEnum
CREATE TYPE "DietaryApproach" AS ENUM ('keto', 'carnivore', 'vegan', 'vegetarian', 'mediterranean', 'paleo', 'low_carb', 'high_protein', 'plant_based', 'gluten_free', 'dairy_free');

-- CreateEnum
CREATE TYPE "AllergenSeverity" AS ENUM ('allergy', 'intolerance', 'dislike');

-- CreateEnum
CREATE TYPE "MealPlanTemplateStatus" AS ENUM ('draft', 'published', 'archived');

-- CreateEnum
CREATE TYPE "MealPlanSource" AS ENUM ('template', 'v_generated', 'custom');

-- CreateEnum
CREATE TYPE "UserMealPlanStatus" AS ENUM ('draft', 'active', 'completed', 'archived');

-- CreateTable
CREATE TABLE "dietary_preferences" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "approaches" "DietaryApproach"[],
    "meals_per_day" INTEGER,
    "snacks_per_day" INTEGER,
    "notes" VARCHAR(1000),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dietary_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dietary_allergens" (
    "id" UUID NOT NULL,
    "dietary_preference_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "severity" "AllergenSeverity" NOT NULL,
    "notes" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dietary_allergens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dietary_exclusions" (
    "id" UUID NOT NULL,
    "dietary_preference_id" UUID NOT NULL,
    "ingredient" VARCHAR(200) NOT NULL,
    "reason" VARCHAR(100),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dietary_exclusions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meal_plan_templates" (
    "id" UUID NOT NULL,
    "name" VARCHAR(300) NOT NULL,
    "description" VARCHAR(1000),
    "slug" VARCHAR(300),
    "target_calories" INTEGER NOT NULL,
    "target_protein_g" DECIMAL(8,2),
    "target_carb_g" DECIMAL(8,2),
    "target_fat_g" DECIMAL(8,2),
    "suitable_for" "DietaryApproach"[],
    "verified_allergen_free" TEXT[],
    "duration_days" INTEGER NOT NULL DEFAULT 7,
    "meals_per_day" INTEGER NOT NULL DEFAULT 3,
    "status" "MealPlanTemplateStatus" NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meal_plan_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meal_plan_template_days" (
    "id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "day_index" INTEGER NOT NULL,
    "label" VARCHAR(100),

    CONSTRAINT "meal_plan_template_days_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meal_plan_template_entries" (
    "id" UUID NOT NULL,
    "template_day_id" UUID NOT NULL,
    "meal_type" "MealType" NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "recipe_id" UUID,
    "food_item_id" UUID,
    "generic_description" VARCHAR(500),
    "recipe_servings" DECIMAL(8,3),
    "serving_multiplier" DECIMAL(8,3),
    "calculated_calories" DECIMAL(8,2),
    "calculated_protein_g" DECIMAL(8,3),
    "calculated_carb_g" DECIMAL(8,3),
    "calculated_fat_g" DECIMAL(8,3),
    "nutrition_source" VARCHAR(100),
    "nutrition_confidence" VARCHAR(50),
    "unresolved_note" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meal_plan_template_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_meal_plans" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "template_id" UUID,
    "name" VARCHAR(300) NOT NULL,
    "source" "MealPlanSource" NOT NULL,
    "target_calories" INTEGER,
    "target_protein_g" DECIMAL(8,2),
    "target_carb_g" DECIMAL(8,2),
    "target_fat_g" DECIMAL(8,2),
    "start_date" DATE,
    "status" "UserMealPlanStatus" NOT NULL DEFAULT 'draft',
    "generation_note" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_meal_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_meal_plan_days" (
    "id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "day_index" INTEGER NOT NULL,
    "label" VARCHAR(100),

    CONSTRAINT "user_meal_plan_days_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_meal_plan_entries" (
    "id" UUID NOT NULL,
    "plan_day_id" UUID NOT NULL,
    "meal_type" "MealType" NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "recipe_id" UUID,
    "food_item_id" UUID,
    "generic_description" VARCHAR(500),
    "recipe_servings" DECIMAL(8,3),
    "serving_multiplier" DECIMAL(8,3),
    "calculated_calories" DECIMAL(8,2),
    "calculated_protein_g" DECIMAL(8,3),
    "calculated_carb_g" DECIMAL(8,3),
    "calculated_fat_g" DECIMAL(8,3),
    "nutrition_source" VARCHAR(100),
    "nutrition_confidence" VARCHAR(50),
    "unresolved_note" VARCHAR(500),
    "logged_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_meal_plan_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "dietary_preferences_user_id_key" ON "dietary_preferences"("user_id");

-- CreateIndex
CREATE INDEX "dietary_allergens_dietary_preference_id_idx" ON "dietary_allergens"("dietary_preference_id");

-- CreateIndex
CREATE UNIQUE INDEX "dietary_allergens_dietary_preference_id_name_key" ON "dietary_allergens"("dietary_preference_id", "name");

-- CreateIndex
CREATE INDEX "dietary_exclusions_dietary_preference_id_idx" ON "dietary_exclusions"("dietary_preference_id");

-- CreateIndex
CREATE UNIQUE INDEX "dietary_exclusions_dietary_preference_id_ingredient_key" ON "dietary_exclusions"("dietary_preference_id", "ingredient");

-- CreateIndex
CREATE UNIQUE INDEX "meal_plan_templates_slug_key" ON "meal_plan_templates"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "meal_plan_template_days_template_id_day_index_key" ON "meal_plan_template_days"("template_id", "day_index");

-- CreateIndex
CREATE INDEX "meal_plan_template_entries_template_day_id_idx" ON "meal_plan_template_entries"("template_day_id");

-- CreateIndex
CREATE INDEX "user_meal_plans_user_id_idx" ON "user_meal_plans"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_meal_plan_days_plan_id_day_index_key" ON "user_meal_plan_days"("plan_id", "day_index");

-- CreateIndex
CREATE INDEX "user_meal_plan_entries_plan_day_id_idx" ON "user_meal_plan_entries"("plan_day_id");

-- AddForeignKey
ALTER TABLE "dietary_preferences" ADD CONSTRAINT "dietary_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dietary_allergens" ADD CONSTRAINT "dietary_allergens_dietary_preference_id_fkey" FOREIGN KEY ("dietary_preference_id") REFERENCES "dietary_preferences"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dietary_exclusions" ADD CONSTRAINT "dietary_exclusions_dietary_preference_id_fkey" FOREIGN KEY ("dietary_preference_id") REFERENCES "dietary_preferences"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_plan_template_days" ADD CONSTRAINT "meal_plan_template_days_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "meal_plan_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_plan_template_entries" ADD CONSTRAINT "meal_plan_template_entries_template_day_id_fkey" FOREIGN KEY ("template_day_id") REFERENCES "meal_plan_template_days"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_plan_template_entries" ADD CONSTRAINT "meal_plan_template_entries_recipe_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "recipes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_plan_template_entries" ADD CONSTRAINT "meal_plan_template_entries_food_item_id_fkey" FOREIGN KEY ("food_item_id") REFERENCES "food_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_meal_plans" ADD CONSTRAINT "user_meal_plans_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_meal_plans" ADD CONSTRAINT "user_meal_plans_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "meal_plan_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_meal_plan_days" ADD CONSTRAINT "user_meal_plan_days_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "user_meal_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_meal_plan_entries" ADD CONSTRAINT "user_meal_plan_entries_plan_day_id_fkey" FOREIGN KEY ("plan_day_id") REFERENCES "user_meal_plan_days"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_meal_plan_entries" ADD CONSTRAINT "user_meal_plan_entries_recipe_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "recipes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_meal_plan_entries" ADD CONSTRAINT "user_meal_plan_entries_food_item_id_fkey" FOREIGN KEY ("food_item_id") REFERENCES "food_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS: Row Level Security for all 9 new nutrition tables
--
-- Role summary:
--   postgres / service_role  rolbypassrls = t → never touched by these policies
--   authenticated            subject to policies below
--   anon                     no policies = default deny on every table
--
-- auth.uid() = profiles.id = user_id FK on personal tables (confirmed from
-- existing health_rls.sql / rls_training.sql patterns)
-- ─────────────────────────────────────────────────────────────────────────────

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
