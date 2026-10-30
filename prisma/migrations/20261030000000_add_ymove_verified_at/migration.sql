-- Add visual-verification timestamp to ymove_mapping.
-- NULL = approved via algorithm or name match only.
-- Non-null = admin watched the video and explicitly confirmed.
-- Existing rows stay NULL (not auto-verified) per design requirement.
ALTER TABLE "ymove_mapping" ADD COLUMN "verified_at" TIMESTAMP(3);
