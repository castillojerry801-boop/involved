-- Trainer System — Row Level Security
-- Apply after `npx prisma db push` creates the tables.
-- These policies enforce the authorization model at the database layer.
-- Application-layer checks (assertTrainerClientAccess) are defense-in-depth.

-- ─── trainer_profiles ────────────────────────────────────────────────────────

ALTER TABLE trainer_profiles ENABLE ROW LEVEL SECURITY;

-- Trainer reads/writes own profile
CREATE POLICY "trainer_profiles: own row"
  ON trainer_profiles
  FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ─── trainer_subscriptions ───────────────────────────────────────────────────

ALTER TABLE trainer_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "trainer_subscriptions: own row"
  ON trainer_subscriptions
  FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ─── trainer_client_relationships ────────────────────────────────────────────

ALTER TABLE trainer_client_relationships ENABLE ROW LEVEL SECURITY;

-- Trainer can read and manage their own client relationships
CREATE POLICY "trainer_client_relationships: trainer access"
  ON trainer_client_relationships
  FOR ALL
  USING  (auth.uid() = trainer_id)
  WITH CHECK (auth.uid() = trainer_id);

-- Client can read their own relationship rows (to see who their trainer is)
CREATE POLICY "trainer_client_relationships: client read"
  ON trainer_client_relationships
  FOR SELECT
  USING (auth.uid() = client_id);

-- ─── trainer_invitations ─────────────────────────────────────────────────────

ALTER TABLE trainer_invitations ENABLE ROW LEVEL SECURITY;

-- Trainer can manage invitations they sent
CREATE POLICY "trainer_invitations: trainer access"
  ON trainer_invitations
  FOR ALL
  USING  (auth.uid() = trainer_id)
  WITH CHECK (auth.uid() = trainer_id);

-- Any authenticated user can read an invitation by token (for the accept flow)
-- Application layer validates token expiry and status before acting.
CREATE POLICY "trainer_invitations: token read"
  ON trainer_invitations
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- ─── user_entitlements ───────────────────────────────────────────────────────

ALTER TABLE user_entitlements ENABLE ROW LEVEL SECURITY;

-- Users can read their own entitlements
CREATE POLICY "user_entitlements: own read"
  ON user_entitlements
  FOR SELECT
  USING (auth.uid() = user_id);

-- Only service role can write entitlements (application uses service role key for writes)
-- Regular authenticated users cannot grant or revoke their own entitlements
CREATE POLICY "user_entitlements: service role write"
  ON user_entitlements
  FOR ALL
  USING  (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ─── trainer_programs ────────────────────────────────────────────────────────

ALTER TABLE trainer_programs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "trainer_programs: trainer access"
  ON trainer_programs
  FOR ALL
  USING  (auth.uid() = trainer_id)
  WITH CHECK (auth.uid() = trainer_id);

-- ─── trainer_program_days ────────────────────────────────────────────────────

ALTER TABLE trainer_program_days ENABLE ROW LEVEL SECURITY;

CREATE POLICY "trainer_program_days: trainer access via program"
  ON trainer_program_days
  FOR ALL
  USING (
    program_id IN (
      SELECT id FROM trainer_programs WHERE trainer_id = auth.uid()
    )
  )
  WITH CHECK (
    program_id IN (
      SELECT id FROM trainer_programs WHERE trainer_id = auth.uid()
    )
  );

-- ─── trainer_program_exercises ───────────────────────────────────────────────

ALTER TABLE trainer_program_exercises ENABLE ROW LEVEL SECURITY;

CREATE POLICY "trainer_program_exercises: trainer access via program"
  ON trainer_program_exercises
  FOR ALL
  USING (
    program_day_id IN (
      SELECT tpd.id
        FROM trainer_program_days tpd
        JOIN trainer_programs tp ON tp.id = tpd.program_id
       WHERE tp.trainer_id = auth.uid()
    )
  )
  WITH CHECK (
    program_day_id IN (
      SELECT tpd.id
        FROM trainer_program_days tpd
        JOIN trainer_programs tp ON tp.id = tpd.program_id
       WHERE tp.trainer_id = auth.uid()
    )
  );

-- ─── trainer_program_sets ────────────────────────────────────────────────────

ALTER TABLE trainer_program_sets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "trainer_program_sets: trainer access via program"
  ON trainer_program_sets
  FOR ALL
  USING (
    program_exercise_id IN (
      SELECT tpe.id
        FROM trainer_program_exercises tpe
        JOIN trainer_program_days tpd ON tpd.id = tpe.program_day_id
        JOIN trainer_programs tp ON tp.id = tpd.program_id
       WHERE tp.trainer_id = auth.uid()
    )
  )
  WITH CHECK (
    program_exercise_id IN (
      SELECT tpe.id
        FROM trainer_program_exercises tpe
        JOIN trainer_program_days tpd ON tpd.id = tpe.program_day_id
        JOIN trainer_programs tp ON tp.id = tpd.program_id
       WHERE tp.trainer_id = auth.uid()
    )
  );

-- ─── trainer_notes ───────────────────────────────────────────────────────────

ALTER TABLE trainer_notes ENABLE ROW LEVEL SECURITY;

-- Trainer can read and write their own notes
CREATE POLICY "trainer_notes: trainer access"
  ON trainer_notes
  FOR ALL
  USING  (auth.uid() = trainer_id)
  WITH CHECK (auth.uid() = trainer_id);

-- Client can read non-private notes about themselves
CREATE POLICY "trainer_notes: client read non-private"
  ON trainer_notes
  FOR SELECT
  USING (auth.uid() = client_id AND is_private = false);

-- ─── trainer_client_targets ──────────────────────────────────────────────────

ALTER TABLE trainer_client_targets ENABLE ROW LEVEL SECURITY;

-- Trainer can read and write targets they set
CREATE POLICY "trainer_client_targets: trainer access"
  ON trainer_client_targets
  FOR ALL
  USING  (auth.uid() = trainer_id)
  WITH CHECK (auth.uid() = trainer_id);

-- Client can read targets set for them
CREATE POLICY "trainer_client_targets: client read"
  ON trainer_client_targets
  FOR SELECT
  USING (auth.uid() = client_id);

-- ─── v_trainer_drafts ────────────────────────────────────────────────────────

ALTER TABLE v_trainer_drafts ENABLE ROW LEVEL SECURITY;

-- Only the trainer who created the draft can read/write it
CREATE POLICY "v_trainer_drafts: trainer access"
  ON v_trainer_drafts
  FOR ALL
  USING  (auth.uid() = trainer_id)
  WITH CHECK (auth.uid() = trainer_id);

-- Clients do NOT see trainer drafts — they are an internal trainer tool
