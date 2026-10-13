-- CreateEnum
CREATE TYPE "RecipeStatus" AS ENUM ('draft', 'private', 'pending', 'published', 'rejected', 'archived');

-- AlterTable: add recipe FK and idempotency key to food_log_entries
ALTER TABLE "food_log_entries" ADD COLUMN "recipe_id" UUID;
ALTER TABLE "food_log_entries" ADD COLUMN "idempotency_key" TEXT;
CREATE UNIQUE INDEX "food_log_entries_idempotency_key_key" ON "food_log_entries"("idempotency_key") WHERE "idempotency_key" IS NOT NULL;

-- CreateTable: recipes
CREATE TABLE "recipes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" VARCHAR(300) NOT NULL,
    "description" VARCHAR(1000),
    "servings" INTEGER NOT NULL DEFAULT 1,
    "prep_minutes" INTEGER,
    "cook_minutes" INTEGER,
    "status" "RecipeStatus" NOT NULL DEFAULT 'draft',
    "storage_key" TEXT,
    "cached_cal_per_serving" DECIMAL(8,2),
    "cached_protein_g_per_serving" DECIMAL(8,3),
    "cached_carb_g_per_serving" DECIMAL(8,3),
    "cached_fat_g_per_serving" DECIMAL(8,3),
    "nutrition_complete" BOOLEAN NOT NULL DEFAULT false,
    "sharing_consent" BOOLEAN NOT NULL DEFAULT false,
    "sharing_consent_at" TIMESTAMP(3),
    "creator_name" VARCHAR(200),
    "source_url" TEXT,
    "source_license" TEXT,
    "submitted_at" TIMESTAMP(3),
    "reviewed_at" TIMESTAMP(3),
    "rejection_reason" VARCHAR(500),
    "is_ai_generated" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recipes_pkey" PRIMARY KEY ("id")
);

-- CreateTable: recipe_ingredients
CREATE TABLE "recipe_ingredients" (
    "id" UUID NOT NULL,
    "recipe_id" UUID NOT NULL,
    "food_item_id" UUID,
    "name" VARCHAR(300) NOT NULL,
    "quantity" DECIMAL(10,3) NOT NULL,
    "unit" VARCHAR(50) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "notes" VARCHAR(200),
    "snapshot_calories" DECIMAL(8,2),
    "snapshot_protein_g" DECIMAL(8,3),
    "snapshot_carb_g" DECIMAL(8,3),
    "snapshot_fat_g" DECIMAL(8,3),

    CONSTRAINT "recipe_ingredients_pkey" PRIMARY KEY ("id")
);

-- CreateTable: recipe_steps
CREATE TABLE "recipe_steps" (
    "id" UUID NOT NULL,
    "recipe_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "body" TEXT NOT NULL,

    CONSTRAINT "recipe_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable: recipe_saves
CREATE TABLE "recipe_saves" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "recipe_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recipe_saves_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "recipes_user_id_idx" ON "recipes"("user_id");
CREATE INDEX "recipes_status_idx" ON "recipes"("status");
CREATE INDEX "recipe_ingredients_recipe_id_idx" ON "recipe_ingredients"("recipe_id");
CREATE INDEX "recipe_steps_recipe_id_idx" ON "recipe_steps"("recipe_id");
CREATE INDEX "recipe_saves_user_id_idx" ON "recipe_saves"("user_id");
CREATE UNIQUE INDEX "recipe_saves_user_id_recipe_id_key" ON "recipe_saves"("user_id", "recipe_id");
CREATE INDEX "food_log_entries_recipe_id_idx" ON "food_log_entries"("recipe_id");

-- AddForeignKey
ALTER TABLE "food_log_entries" ADD CONSTRAINT "food_log_entries_recipe_id_fkey"
  FOREIGN KEY ("recipe_id") REFERENCES "recipes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "recipes" ADD CONSTRAINT "recipes_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_recipe_id_fkey"
  FOREIGN KEY ("recipe_id") REFERENCES "recipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_food_item_id_fkey"
  FOREIGN KEY ("food_item_id") REFERENCES "food_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "recipe_steps" ADD CONSTRAINT "recipe_steps_recipe_id_fkey"
  FOREIGN KEY ("recipe_id") REFERENCES "recipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "recipe_saves" ADD CONSTRAINT "recipe_saves_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "recipe_saves" ADD CONSTRAINT "recipe_saves_recipe_id_fkey"
  FOREIGN KEY ("recipe_id") REFERENCES "recipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
