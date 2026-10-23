-- AlterEnum
-- PostgreSQL 12+: ADD VALUE may run inside a transaction; the new value is not
-- visible until after COMMIT, but column type references are safe in the same txn.
-- IF NOT EXISTS makes this idempotent on re-run.
ALTER TYPE "AiFeature" ADD VALUE IF NOT EXISTS 'trainer_query';

-- CreateTable
CREATE TABLE "ai_request_logs" (
    "id"                  UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id"             UUID NOT NULL,
    "billing_period"      VARCHAR(7) NOT NULL,
    "feature"             "AiFeature" NOT NULL,
    "operation_type"      VARCHAR(64) NOT NULL,
    "model"               VARCHAR(100) NOT NULL,
    "input_tokens"        INTEGER,
    "output_tokens"       INTEGER,
    "cached_input_tokens" INTEGER,
    "audio_bytes"         INTEGER,
    "estimated_cost_usd"  DECIMAL(10,8),
    "pricing_status"      VARCHAR(20) NOT NULL DEFAULT 'unknown',
    "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_request_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_request_logs_user_id_billing_period_idx" ON "ai_request_logs"("user_id", "billing_period");

-- CreateIndex
CREATE INDEX "ai_request_logs_billing_period_idx" ON "ai_request_logs"("billing_period");

-- CreateIndex
CREATE INDEX "ai_request_logs_model_idx" ON "ai_request_logs"("model");

-- CreateIndex
CREATE INDEX "ai_request_logs_created_at_idx" ON "ai_request_logs"("created_at");

-- AddForeignKey
ALTER TABLE "ai_request_logs" ADD CONSTRAINT "ai_request_logs_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: server-only table — no client role may read or write rows directly.
-- The Prisma connection (postgres superuser via DATABASE_URL / DIRECT_URL) bypasses RLS.
-- Supabase default privileges auto-grant SELECT/INSERT/UPDATE/DELETE to anon and
-- authenticated on every new public-schema table; REVOKE removes those grants so the
-- Supabase Data API (PostgREST) returns "permission denied" rather than an empty result.
ALTER TABLE "ai_request_logs" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "ai_request_logs" FROM anon, authenticated;
