-- CreateTable: ymove_exercise_catalog
-- Additive migration — does not touch any existing tables or data.
-- Full YMove exercise library, synced by the admin catalog-sync job.
-- YMove-native exercise IDs are addressed as ymv:{ymove_id} in workout
-- and program records; this table is the backing store for those IDs.
--
-- NOT exposed in the public UI (Milestone B — backend only).
-- Selection UI gating deferred to Milestone C.

CREATE TABLE "ymove_exercise_catalog" (
    "id"                     UUID          NOT NULL DEFAULT gen_random_uuid(),
    "ymove_id"               VARCHAR(36)   NOT NULL,
    "name"                   VARCHAR(300)  NOT NULL,
    "slug"                   VARCHAR(300)  NOT NULL,
    "description"            TEXT,
    "primary_muscle_group"   VARCHAR(100),
    "muscle_groups_json"     JSONB         NOT NULL DEFAULT '[]',
    "secondary_muscles_json" JSONB         NOT NULL DEFAULT '[]',
    "equipment"              VARCHAR(100),
    "category"               VARCHAR(100),
    "difficulty"             VARCHAR(50),
    "has_video"              BOOLEAN       NOT NULL DEFAULT false,
    "exercise_types_json"    JSONB         NOT NULL DEFAULT '[]',
    "thumbnail_media_id"     VARCHAR(36),
    "synced_at"              TIMESTAMP(3)  NOT NULL,
    "created_at"             TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"             TIMESTAMP(3)  NOT NULL,

    CONSTRAINT "ymove_exercise_catalog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: unique exercise UUID
CREATE UNIQUE INDEX "ymove_exercise_catalog_ymove_id_key"
    ON "ymove_exercise_catalog"("ymove_id");

-- CreateIndex: filter helpers
CREATE INDEX "ymove_exercise_catalog_equipment_idx"
    ON "ymove_exercise_catalog"("equipment");

CREATE INDEX "ymove_exercise_catalog_category_idx"
    ON "ymove_exercise_catalog"("category");

CREATE INDEX "ymove_exercise_catalog_difficulty_idx"
    ON "ymove_exercise_catalog"("difficulty");

CREATE INDEX "ymove_exercise_catalog_primary_muscle_group_name_idx"
    ON "ymove_exercise_catalog"("primary_muscle_group", "name");

-- RLS: catalog is server-managed system data.
-- No user-owned rows; no per-user client access needed.
-- Supabase auto-grants SELECT/INSERT/UPDATE/DELETE to anon and authenticated
-- on every new public-schema table — REVOKE prevents PostgREST from leaking
-- catalog rows to unauthenticated requests.
ALTER TABLE "ymove_exercise_catalog" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "ymove_exercise_catalog" FROM anon, authenticated;
