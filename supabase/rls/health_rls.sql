-- Health / Activity Layer — Row Level Security
-- Apply after `npx prisma db push` creates the tables.
-- Run as a Supabase service role migration or via the SQL editor.

-- ─── health_activities ───────────────────────────────────────────────────────

ALTER TABLE health_activities ENABLE ROW LEVEL SECURITY;

-- Users can only read and write their own health activities
CREATE POLICY "health_activities: own rows only"
  ON health_activities
  FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ─── health_metrics ──────────────────────────────────────────────────────────

ALTER TABLE health_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "health_metrics: own rows only"
  ON health_metrics
  FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ─── health_sync_cursors ──────────────────────────────────────────────────────

ALTER TABLE health_sync_cursors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "health_sync_cursors: own rows only"
  ON health_sync_cursors
  FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ─── health_permissions ──────────────────────────────────────────────────────

ALTER TABLE health_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "health_permissions: own rows only"
  ON health_permissions
  FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
