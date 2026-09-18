-- RLS for weekly_targets table
-- Run in Supabase SQL editor AFTER: npx prisma db push

ALTER TABLE weekly_targets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "weekly_targets: users own data"
  ON weekly_targets
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
