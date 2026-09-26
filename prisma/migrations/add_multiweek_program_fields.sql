-- Additive migration: executable multi-week program persistence.
-- All columns nullable → existing/legacy programs are unaffected and resolve to
-- their base-week prescription. No drops, no renames, no backfill.
-- Safe to run multiple times (IF NOT EXISTS).

-- Program: overall duration + phase structure (display/coaching context only).
ALTER TABLE programs
  ADD COLUMN IF NOT EXISTS duration_weeks integer,
  ADD COLUMN IF NOT EXISTS phases jsonb;

-- ProgramExercise: per-week overrides + progression metadata on top of the base
-- ProgramSet prescription.
ALTER TABLE program_exercises
  ADD COLUMN IF NOT EXISTS week_progressions jsonb,
  ADD COLUMN IF NOT EXISTS progression_model varchar(40),
  ADD COLUMN IF NOT EXISTS progression_increment double precision,
  ADD COLUMN IF NOT EXISTS progression_condition varchar(500),
  ADD COLUMN IF NOT EXISTS starting_load double precision,
  ADD COLUMN IF NOT EXISTS failure_allowed boolean,
  ADD COLUMN IF NOT EXISTS sequencing_mode varchar(40),
  ADD COLUMN IF NOT EXISTS sequencing_group varchar(40);

-- WorkoutSet: carry the resolved week's target RIR into the live workout.
ALTER TABLE workout_sets
  ADD COLUMN IF NOT EXISTS target_rir integer;
