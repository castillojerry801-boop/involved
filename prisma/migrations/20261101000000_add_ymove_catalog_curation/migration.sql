-- Additive curation columns for ymove_exercise_catalog.
-- Does NOT touch any user-owned tables (workout_exercises, personal_records,
-- programs, workout_templates, ymove_mapping, etc.).
--
-- curation_status:     pending_review | approved | rejected | duplicate
-- verified_media_for:  exact ExerciseDB exercise_id this YMove exercise is
--                      the verified media provider for. Setting this does NOT
--                      change the tracking identity of the ExerciseDB exercise.
-- is_duplicate_of:     ymove_id of the preferred record when curation_status
--                      is 'duplicate'. Must not form a cycle.
-- canonical_id:        optional grouping hint (e.g. 'inv_bench_press').
-- curator_notes:       free-text notes from the admin curator.
-- curated_at/by:       ISO timestamp and admin user ID of the last curation action.

ALTER TABLE "ymove_exercise_catalog"
  ADD COLUMN "curation_status"    VARCHAR(30)   NOT NULL DEFAULT 'pending_review',
  ADD COLUMN "verified_media_for" VARCHAR(100),
  ADD COLUMN "is_duplicate_of"    VARCHAR(36),
  ADD COLUMN "canonical_id"       VARCHAR(200),
  ADD COLUMN "curator_notes"      VARCHAR(500),
  ADD COLUMN "curated_at"         TIMESTAMP(3),
  ADD COLUMN "curated_by"         VARCHAR(200);

CREATE INDEX "ymove_exercise_catalog_curation_status_idx"
    ON "ymove_exercise_catalog"("curation_status");

CREATE INDEX "ymove_exercise_catalog_verified_media_for_idx"
    ON "ymove_exercise_catalog"("verified_media_for");

CREATE INDEX "ymove_exercise_catalog_canonical_id_idx"
    ON "ymove_exercise_catalog"("canonical_id");

CREATE INDEX "ymove_exercise_catalog_is_duplicate_of_idx"
    ON "ymove_exercise_catalog"("is_duplicate_of");
