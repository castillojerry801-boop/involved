# Migration: add_food_item_portions

Status: PREPARED — NOT APPLIED TO PRODUCTION

This migration is additive only. No existing columns, tables, or data are modified.

Key design decisions:
- Partial unique indexes used instead of standard @@unique for FoodItemPortion
  because PostgreSQL treats NULL as DISTINCT in standard unique indexes.
  This would allow duplicate rows with NULL preparationState for the same food+unit.
  The three partial indexes correctly enforce deduplication for all NULL/non-NULL cases.
- All new columns on existing tables are nullable or have safe defaults.
- food_log_entries snapshot columns are NOT touched.
- recipe_ingredients snapshot columns are NOT touched.
- logMode defaults to ingredient_calculated so all existing recipes are unaffected.

To apply: review with DBA, then run with prisma migrate deploy or psql.
DO NOT apply without explicit approval.
