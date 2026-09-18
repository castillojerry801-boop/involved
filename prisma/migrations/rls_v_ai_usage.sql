-- RLS for ai_usage_logs table
-- Run in Supabase SQL editor AFTER: npx prisma db push

ALTER TABLE ai_usage_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_usage_logs: users own data"
  ON ai_usage_logs
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
