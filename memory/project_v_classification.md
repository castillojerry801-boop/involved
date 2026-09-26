---
name: project-v-classification
description: V classification layer architecture and canonical exercise library status — 2026-09-19
metadata:
  type: project
---

Architectural fix for the classification layer (2026-09-19).

**Why:** ExerciseDB IDs were being used as primary keys everywhere, which blocks building Involved's own exercise identity layer and stable references for programs, history, and V.

**How to apply:** `inv_*` IDs are Involved-owned stable references. ExerciseDB IDs are source references only — never primary keys. `WorkoutExercise.exerciseId` still stores ExerciseDB string IDs; `inv_*` must never reach that field.

## Key patterns

- `olympic_power` movement pattern (e.g., power clean) — reserved for future
- Name-first classifier: canonical exercise name → movement family → pattern
- `intended_pattern` field on V tool calls — validation contract so V can't silently misclassify
- `movementFamily` on ExerciseClassification is now redundant (derivable from `movementPattern`) — don't double-maintain

## Canonical Exercise Library — current state

Seed v0.2 is live in `data/involved-exercise-library.json`. 7 movement families, 13 canonical exercises.

- `lib/exercises/canonical.ts` — types (`CanonicalFamily`, `CanonicalExercise`, `CanonicalImplementation`), `movementFamilies` export, `MOVEMENT_PATTERN_LABELS` display map
- `components/training/canonical-exercise-detail.tsx` — Option B rich detail view (coaching cues, muscles, implementations with ExerciseDB GIFs, sourceGap notices)
- `components/training/exercise-browser.tsx` — Search | Browse tab switcher; Browse: Family grid → Canonical list → Detail view

**Display name rule:** `CanonicalFamily.displayName` is the user-facing label (e.g., "Hip Hinge", "Chest Press"). `name` and `movementPattern` are the technical keys used by V and filtering logic. `MOVEMENT_PATTERN_LABELS` maps pattern keys to display labels for use in UI chips.

**Next:** User is building a larger canonical library seed to replace v0.2. Will arrive as a new JSON file — wire it into `data/involved-exercise-library.json` when it lands.

**Security constraint:** ExerciseDB licensed GIFs must never be sent to OpenAI or any third-party AI.
