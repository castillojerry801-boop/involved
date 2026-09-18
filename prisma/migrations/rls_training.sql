-- RLS policies for training tables
-- Run this in Supabase SQL editor AFTER running: npx prisma db push
-- All policies enforce: users can only read/write their own data.

-- ─── programs ─────────────────────────────────────────────────────────────────
ALTER TABLE programs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "programs: users own data"
  ON programs
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ─── program_days ─────────────────────────────────────────────────────────────
ALTER TABLE program_days ENABLE ROW LEVEL SECURITY;

CREATE POLICY "program_days: via program owner"
  ON program_days
  USING (
    program_id IN (SELECT id FROM programs WHERE user_id = auth.uid())
  )
  WITH CHECK (
    program_id IN (SELECT id FROM programs WHERE user_id = auth.uid())
  );

-- ─── program_exercises ────────────────────────────────────────────────────────
ALTER TABLE program_exercises ENABLE ROW LEVEL SECURITY;

CREATE POLICY "program_exercises: via program owner"
  ON program_exercises
  USING (
    program_day_id IN (
      SELECT pd.id FROM program_days pd
      JOIN programs p ON p.id = pd.program_id
      WHERE p.user_id = auth.uid()
    )
  )
  WITH CHECK (
    program_day_id IN (
      SELECT pd.id FROM program_days pd
      JOIN programs p ON p.id = pd.program_id
      WHERE p.user_id = auth.uid()
    )
  );

-- ─── program_sets ─────────────────────────────────────────────────────────────
ALTER TABLE program_sets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "program_sets: via program owner"
  ON program_sets
  USING (
    program_exercise_id IN (
      SELECT pe.id FROM program_exercises pe
      JOIN program_days pd ON pd.id = pe.program_day_id
      JOIN programs p ON p.id = pd.program_id
      WHERE p.user_id = auth.uid()
    )
  )
  WITH CHECK (
    program_exercise_id IN (
      SELECT pe.id FROM program_exercises pe
      JOIN program_days pd ON pd.id = pe.program_day_id
      JOIN programs p ON p.id = pd.program_id
      WHERE p.user_id = auth.uid()
    )
  );

-- ─── workout_templates ────────────────────────────────────────────────────────
ALTER TABLE workout_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workout_templates: users own data"
  ON workout_templates
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ─── template_exercises ───────────────────────────────────────────────────────
ALTER TABLE template_exercises ENABLE ROW LEVEL SECURITY;

CREATE POLICY "template_exercises: via template owner"
  ON template_exercises
  USING (
    template_id IN (SELECT id FROM workout_templates WHERE user_id = auth.uid())
  )
  WITH CHECK (
    template_id IN (SELECT id FROM workout_templates WHERE user_id = auth.uid())
  );

-- ─── template_sets ────────────────────────────────────────────────────────────
ALTER TABLE template_sets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "template_sets: via template owner"
  ON template_sets
  USING (
    template_exercise_id IN (
      SELECT te.id FROM template_exercises te
      JOIN workout_templates wt ON wt.id = te.template_id
      WHERE wt.user_id = auth.uid()
    )
  )
  WITH CHECK (
    template_exercise_id IN (
      SELECT te.id FROM template_exercises te
      JOIN workout_templates wt ON wt.id = te.template_id
      WHERE wt.user_id = auth.uid()
    )
  );
