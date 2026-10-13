-- AddColumn: household serving metadata on food_items
-- Additive-only migration: three nullable columns, no existing rows affected.

ALTER TABLE "food_items"
  ADD COLUMN IF NOT EXISTS "household_serving_text" VARCHAR(200),
  ADD COLUMN IF NOT EXISTS "household_unit" VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "units_per_serving" DECIMAL(8,3);
