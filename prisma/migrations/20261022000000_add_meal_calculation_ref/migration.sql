-- CreateTable
CREATE TABLE "meal_calculation_refs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meal_calculation_refs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "meal_calculation_refs_user_id_idx" ON "meal_calculation_refs"("user_id");

-- CreateIndex
CREATE INDEX "meal_calculation_refs_expires_at_idx" ON "meal_calculation_refs"("expires_at");

-- RLS: server-only table — no client role may read or write rows directly.
-- The Prisma connection (postgres superuser via DATABASE_URL / DIRECT_URL) bypasses RLS.
-- Supabase default privileges auto-grant SELECT/INSERT/UPDATE/DELETE to anon and
-- authenticated on every new public-schema table; REVOKE removes those grants so the
-- Supabase Data API (PostgREST) returns "permission denied" rather than an empty result.
ALTER TABLE "meal_calculation_refs" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "meal_calculation_refs" FROM anon, authenticated;
