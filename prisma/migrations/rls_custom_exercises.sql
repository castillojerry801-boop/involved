-- RLS for custom_exercises table
-- Run in Supabase SQL editor AFTER: npx prisma db push

ALTER TABLE custom_exercises ENABLE ROW LEVEL SECURITY;
CREATE POLICY "custom_exercises: users own data"
  ON custom_exercises
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
