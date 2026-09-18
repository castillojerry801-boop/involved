-- RLS policies for exercise preferences and equipment profiles
-- Run in Supabase SQL editor AFTER: npx prisma db push

ALTER TABLE exercise_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "exercise_preferences: users own data"
  ON exercise_preferences
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

ALTER TABLE equipment_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "equipment_profiles: users own data"
  ON equipment_profiles
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

ALTER TABLE equipment_profile_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "equipment_profile_items: via profile owner"
  ON equipment_profile_items
  USING (
    profile_id IN (SELECT id FROM equipment_profiles WHERE user_id = auth.uid())
  )
  WITH CHECK (
    profile_id IN (SELECT id FROM equipment_profiles WHERE user_id = auth.uid())
  );
