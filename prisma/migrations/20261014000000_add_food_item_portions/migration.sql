-- Migration: add_food_item_portions
-- ADDITIVE ONLY — no existing columns modified or removed
-- Partial unique indexes used instead of standard unique constraints
-- because PostgreSQL treats NULL as distinct in unique indexes,
-- which would allow duplicate "unspecified" portion rows.
-- Partial indexes correctly enforce deduplication for nullable columns.

-- New enum types (idempotent — safe for re-runs)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PortionSourceConfidence') THEN
    CREATE TYPE "PortionSourceConfidence" AS ENUM (
      'usda_measured',
      'manufacturer_declared',
      'density_derived',
      'reference_table'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ConversionSource') THEN
    CREATE TYPE "ConversionSource" AS ENUM (
      'same_unit',
      'manufacturer_declared',
      'usda_measured',
      'density_derived',
      'reference_table',
      'user_supplied',
      'unresolved'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RecipeLogMode') THEN
    CREATE TYPE "RecipeLogMode" AS ENUM (
      'ingredient_calculated',
      'user_confirmed_estimate',
      'imported_source'
    );
  END IF;
END $$;

-- New table: food_item_portions (CREATE TABLE ... IF NOT EXISTS for idempotency)
CREATE TABLE IF NOT EXISTS "food_item_portions" (
  "id"                  UUID NOT NULL DEFAULT gen_random_uuid(),
  "food_item_id"        UUID NOT NULL,
  "portion_description" VARCHAR(200) NOT NULL,
  "quantity"            NUMERIC(8,4) NOT NULL,
  "unit"                VARCHAR(50) NOT NULL,
  "gram_weight"         NUMERIC(8,3) NOT NULL,
  "fdc_portion_id"      INTEGER,
  "source_confidence"   "PortionSourceConfidence" NOT NULL,
  "preparation_state"   VARCHAR(100),

  CONSTRAINT "food_item_portions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "food_item_portions_food_item_id_fkey"
    FOREIGN KEY ("food_item_id") REFERENCES "food_items"("id") ON DELETE CASCADE,
  CONSTRAINT "food_item_portions_gram_weight_positive"
    CHECK ("gram_weight" > 0),
  CONSTRAINT "food_item_portions_quantity_positive"
    CHECK ("quantity" > 0)
);

CREATE INDEX IF NOT EXISTS "food_item_portions_food_item_id_unit_idx"
  ON "food_item_portions" ("food_item_id", "unit");

-- Partial unique index 1: USDA-sourced portions (fdc_portion_id is set)
-- Prevents duplicate USDA portion rows on re-import
CREATE UNIQUE INDEX IF NOT EXISTS "food_item_portions_fdc_unique"
  ON "food_item_portions" ("food_item_id", "fdc_portion_id")
  WHERE "fdc_portion_id" IS NOT NULL;

-- Partial unique index 2: non-USDA portions, unspecified preparation
-- Two rows with preparation_state=NULL for same (food, unit, source) are duplicates
CREATE UNIQUE INDEX IF NOT EXISTS "food_item_portions_unit_null_prep_unique"
  ON "food_item_portions" ("food_item_id", "unit", "source_confidence")
  WHERE "preparation_state" IS NULL AND "fdc_portion_id" IS NULL;

-- Partial unique index 3: non-USDA portions, specific preparation state
-- Prevents e.g. two "cup / shredded / reference_table" rows for the same food
CREATE UNIQUE INDEX IF NOT EXISTS "food_item_portions_unit_prep_unique"
  ON "food_item_portions" ("food_item_id", "unit", "preparation_state", "source_confidence")
  WHERE "preparation_state" IS NOT NULL AND "fdc_portion_id" IS NULL;

-- Additive columns on food_items
ALTER TABLE "food_items"
  ADD COLUMN IF NOT EXISTS "is_generic"     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "canonical_name" VARCHAR(300),
  ADD COLUMN IF NOT EXISTS "fdc_data_type"  VARCHAR(50);

-- Additive columns on recipe_ingredients
ALTER TABLE "recipe_ingredients"
  ADD COLUMN IF NOT EXISTS "is_optional"                   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "is_to_taste"                   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "conversion_source"             "ConversionSource",
  ADD COLUMN IF NOT EXISTS "preparation_state"             VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "user_supplied_gram_equivalent" NUMERIC(8,3),
  ADD COLUMN IF NOT EXISTS "user_supplied_unit"            VARCHAR(50);

-- Additive columns on recipes
ALTER TABLE "recipes"
  ADD COLUMN IF NOT EXISTS "log_mode"                           "RecipeLogMode" NOT NULL DEFAULT 'ingredient_calculated',
  ADD COLUMN IF NOT EXISTS "imported_cal_per_serving"           NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS "imported_protein_g_per_serving"     NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS "imported_carb_g_per_serving"        NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS "imported_fat_g_per_serving"         NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS "user_confirmed_cal_per_serving"     NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS "user_confirmed_protein_g_per_serving" NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS "user_confirmed_carb_g_per_serving"  NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS "user_confirmed_fat_g_per_serving"   NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS "estimate_source_note"               VARCHAR(500);

-- Additive columns on food_log_entries
-- IMPORTANT: existing snapshot columns are NOT modified
ALTER TABLE "food_log_entries"
  ADD COLUMN IF NOT EXISTS "optional_ingredient_overrides" JSONB,
  ADD COLUMN IF NOT EXISTS "recipe_log_mode"               "RecipeLogMode",
  ADD COLUMN IF NOT EXISTS "estimate_source_note"          VARCHAR(500);
