-- CreateTable
CREATE TABLE "ymove_recipe_saves" (
    "id"                  UUID        NOT NULL DEFAULT gen_random_uuid(),
    "user_id"             UUID        NOT NULL,
    "ymove_recipe_id"     VARCHAR(100) NOT NULL,
    "snapshot_title"      VARCHAR(300) NOT NULL,
    "snapshot_calories"   DECIMAL(8,2) NOT NULL,
    "snapshot_protein"    DECIMAL(8,3) NOT NULL,
    "snapshot_carbs"      DECIMAL(8,3) NOT NULL,
    "snapshot_fat"        DECIMAL(8,3) NOT NULL,
    "snapshot_image_url"  VARCHAR(500),
    "snapshot_meal_type"  VARCHAR(50),
    "snapshot_diet_tags"  JSONB        NOT NULL DEFAULT '[]',
    "snapshot_servings"   INTEGER      NOT NULL DEFAULT 1,
    "snapshot_prep_min"   INTEGER,
    "snapshot_cook_min"   INTEGER,
    "saved_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ymove_recipe_saves_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (uniqueness prevents duplicate saves per user per recipe)
CREATE UNIQUE INDEX "ymove_recipe_saves_user_id_ymove_recipe_id_key"
    ON "ymove_recipe_saves"("user_id", "ymove_recipe_id");

-- CreateIndex
CREATE INDEX "ymove_recipe_saves_user_id_idx"
    ON "ymove_recipe_saves"("user_id");

-- AddForeignKey
ALTER TABLE "ymove_recipe_saves" ADD CONSTRAINT "ymove_recipe_saves_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: saves are user-private — no direct client access.
-- The Prisma connection (postgres superuser via DIRECT_URL) bypasses RLS.
-- Supabase auto-grants SELECT/INSERT/UPDATE/DELETE to anon and authenticated on every new
-- public-schema table; REVOKE removes those grants so the Supabase Data API (PostgREST)
-- returns "permission denied" rather than leaking other users' saves.
ALTER TABLE "ymove_recipe_saves" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "ymove_recipe_saves" FROM anon, authenticated;
