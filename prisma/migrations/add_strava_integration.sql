-- Add strava to WorkoutSource enum
ALTER TYPE "WorkoutSource" ADD VALUE IF NOT EXISTS 'strava';

-- Create strava_tokens table
CREATE TABLE IF NOT EXISTS "strava_tokens" (
  "id"            UUID           NOT NULL DEFAULT gen_random_uuid(),
  "user_id"       UUID           NOT NULL,
  "athlete_id"    INTEGER        NOT NULL,
  "access_token"  TEXT           NOT NULL,
  "refresh_token" TEXT           NOT NULL,
  "expires_at"    TIMESTAMPTZ(3) NOT NULL,
  "scope"         VARCHAR(500)   NOT NULL DEFAULT 'activity:read_all',
  "created_at"    TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "strava_tokens_pkey" PRIMARY KEY ("id")
);

-- One token per Involved account
CREATE UNIQUE INDEX IF NOT EXISTS "strava_tokens_user_id_key"    ON "strava_tokens"("user_id");

-- One Involved account per Strava athlete (prevents the same Strava user
-- from connecting to multiple accounts)
CREATE UNIQUE INDEX IF NOT EXISTS "strava_tokens_athlete_id_key" ON "strava_tokens"("athlete_id");

-- Foreign key to profiles — wrapped for idempotency on re-run
DO $$ BEGIN
  ALTER TABLE "strava_tokens"
    ADD CONSTRAINT "strava_tokens_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- RLS: enabled with no permissive policies.
-- anon and authenticated Supabase clients have zero access to token rows.
-- The Prisma client connects via DATABASE_URL as the postgres superuser,
-- which bypasses RLS — token management remains purely server-side.
ALTER TABLE "strava_tokens" ENABLE ROW LEVEL SECURITY;
