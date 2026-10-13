-- CreateEnum
CREATE TYPE "AiFeature" AS ENUM ('coach_message', 'workout_generation', 'meal_photo', 'label_scan', 'progress_insight', 'weekly_review', 'voice_transcription', 'voice_intent', 'workout_adjustment', 'substitution');

-- CreateEnum
CREATE TYPE "BillingSource" AS ENUM ('stripe', 'apple', 'google', 'manual');

-- CreateEnum
CREATE TYPE "BiologicalSex" AS ENUM ('male', 'female', 'prefer_not_to_say');

-- CreateEnum
CREATE TYPE "CoachingPresence" AS ENUM ('quiet', 'weekly_checkin', 'active');

-- CreateEnum
CREATE TYPE "ExerciseBehaviorEventType" AS ENUM ('exercise_added', 'exercise_removed', 'exercise_skipped', 'exercise_replaced', 'exercise_completed');

-- CreateEnum
CREATE TYPE "ExercisePreferenceState" AS ENUM ('favorite', 'more_often', 'normal', 'less_often', 'dont_recommend');

-- CreateEnum
CREATE TYPE "FitnessLevel" AS ENUM ('beginner', 'intermediate', 'advanced');

-- CreateEnum
CREATE TYPE "FoodSourceCategory" AS ENUM ('system', 'external_api', 'user_created');

-- CreateEnum
CREATE TYPE "FoodVisibility" AS ENUM ('private', 'community', 'verified');

-- CreateEnum
CREATE TYPE "GoalStatus" AS ENUM ('active', 'completed', 'paused');

-- CreateEnum
CREATE TYPE "GoalType" AS ENUM ('event', 'strength', 'endurance', 'body_comp', 'habit', 'custom');

-- CreateEnum
CREATE TYPE "HealthActivityType" AS ENUM ('strength_training', 'running', 'cycling', 'walking', 'swimming', 'hiking', 'yoga', 'hiit', 'rowing', 'other', 'functional_strength', 'elliptical', 'stair_climbing', 'cross_training');

-- CreateEnum
CREATE TYPE "HealthMetricType" AS ENUM ('steps', 'active_energy_kcal', 'resting_energy_kcal', 'heart_rate_avg_bpm', 'heart_rate_max_bpm', 'heart_rate_resting_bpm', 'distance_m', 'body_weight_kg', 'body_fat_pct', 'sleep_duration_s', 'vo2_max', 'hrv_ms', 'stand_hours', 'flights_climbed', 'water_ml');

-- CreateEnum
CREATE TYPE "HealthProvider" AS ENUM ('apple_health', 'health_connect', 'garmin', 'strava', 'polar', 'manual');

-- CreateEnum
CREATE TYPE "HealthSyncState" AS ENUM ('pending', 'synced', 'failed');

-- CreateEnum
CREATE TYPE "MealType" AS ENUM ('breakfast', 'lunch', 'dinner', 'snack', 'other');

-- CreateEnum
CREATE TYPE "PRMetric" AS ENUM ('weight', 'reps', 'duration', 'distance', 'estimated_1rm', 'volume_kg');

-- CreateEnum
CREATE TYPE "SetType" AS ENUM ('warmup', 'working', 'amrap', 'drop', 'failure');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('active', 'trialing', 'expired', 'canceled', 'paused');

-- CreateEnum
CREATE TYPE "SubscriptionTier" AS ENUM ('free', 'plus', 'trial', 'trainer');

-- CreateEnum
CREATE TYPE "TrackingType" AS ENUM ('strength', 'bodyweight', 'assisted', 'cardio', 'carry', 'isometric', 'intervals');

-- CreateEnum
CREATE TYPE "TrainerClientStatus" AS ENUM ('invited', 'active', 'paused', 'ended');

-- CreateEnum
CREATE TYPE "TrainerClientTargetType" AS ENUM ('daily_calories', 'daily_protein_g', 'daily_carbs_g', 'daily_fat_g', 'weekly_workouts', 'weekly_cardio_minutes', 'body_weight_kg', 'body_fat_pct', 'custom');

-- CreateEnum
CREATE TYPE "TrainerInvitationStatus" AS ENUM ('pending', 'accepted', 'declined', 'expired', 'canceled');

-- CreateEnum
CREATE TYPE "TrainerSubscriptionStatus" AS ENUM ('active', 'canceled', 'paused', 'expired');

-- CreateEnum
CREATE TYPE "UserEntitlementSource" AS ENUM ('personal_plus', 'trainer_sponsored', 'trial', 'promo', 'admin_grant');

-- CreateEnum
CREATE TYPE "UserEntitlementStatus" AS ENUM ('active', 'expired', 'revoked');

-- CreateEnum
CREATE TYPE "VDraftStatus" AS ENUM ('pending', 'approved', 'dismissed');

-- CreateEnum
CREATE TYPE "VDraftType" AS ENUM ('program_adjustment', 'workout_edit', 'target_update', 'trainer_note');

-- CreateEnum
CREATE TYPE "WeeklyTargetType" AS ENUM ('workouts_per_week', 'training_days', 'nutrition_log_days', 'protein_target_days');

-- CreateEnum
CREATE TYPE "WorkoutSource" AS ENUM ('manual', 'coach_generated', 'trainer_assigned', 'strava');

-- CreateEnum
CREATE TYPE "WorkoutStatus" AS ENUM ('planned', 'in_progress', 'completed', 'skipped');

-- CreateTable
CREATE TABLE "ai_usage_logs" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "billing_period" VARCHAR(7) NOT NULL,
    "interaction_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "feature" "AiFeature" NOT NULL DEFAULT 'coach_message',

    CONSTRAINT "ai_usage_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_exercises" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "body_part" VARCHAR(100),
    "target_muscle" VARCHAR(100),
    "equipment" VARCHAR(100),
    "tracking_type" "TrackingType" NOT NULL DEFAULT 'strength',
    "instructions" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "custom_exercises_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipment_profile_items" (
    "id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "equipment" VARCHAR(100) NOT NULL,
    "available_weights" JSONB,

    CONSTRAINT "equipment_profile_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipment_profiles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "equipment_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exercise_behavior_events" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "exercise_id" VARCHAR(100) NOT NULL,
    "event" "ExerciseBehaviorEventType" NOT NULL,
    "workout_id" UUID,
    "program_id" UUID,
    "replaced_by" VARCHAR(100),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exercise_behavior_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exercise_preferences" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "exercise_id" VARCHAR(100) NOT NULL,
    "state" "ExercisePreferenceState" NOT NULL DEFAULT 'normal',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exercise_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "food_favorites" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "food_item_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "food_favorites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "food_items" (
    "id" UUID NOT NULL,
    "name" VARCHAR(300) NOT NULL,
    "brand" VARCHAR(200),
    "barcode" VARCHAR(50),
    "source_category" "FoodSourceCategory" NOT NULL,
    "source_provider" VARCHAR(100),
    "external_id" VARCHAR(200),
    "last_synced_at" TIMESTAMP(3),
    "visibility" "FoodVisibility" NOT NULL DEFAULT 'private',
    "created_by_id" UUID,
    "verified_at" TIMESTAMP(3),
    "verified_by_id" UUID,
    "duplicate_of_id" UUID,
    "serving_size" DECIMAL(10,3) NOT NULL,
    "serving_unit" VARCHAR(50) NOT NULL,
    "servings_per_container" DECIMAL(8,2),
    "calories" DECIMAL(8,2) NOT NULL,
    "protein_g" DECIMAL(8,3) NOT NULL,
    "carbohydrate_g" DECIMAL(8,3) NOT NULL,
    "fat_g" DECIMAL(8,3) NOT NULL,
    "nutrients_json" JSONB,
    "ingredients_text" TEXT,
    "is_draft" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "food_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "food_log_entries" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "food_item_id" UUID,
    "log_date" DATE NOT NULL,
    "logged_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "meal_type" "MealType" NOT NULL,
    "serving_multiplier" DECIMAL(8,3) NOT NULL,
    "notes" VARCHAR(500),
    "snapshot_food_name" VARCHAR(300) NOT NULL,
    "snapshot_serving_size" DECIMAL(10,3) NOT NULL,
    "snapshot_serving_unit" VARCHAR(50) NOT NULL,
    "snapshot_calories_per_serving" DECIMAL(8,2) NOT NULL,
    "snapshot_protein_g_per_serving" DECIMAL(8,3) NOT NULL,
    "snapshot_carbohydrate_g_per_serving" DECIMAL(8,3) NOT NULL,
    "snapshot_fat_g_per_serving" DECIMAL(8,3) NOT NULL,
    "snapshot_nutrients_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "food_log_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goals" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "GoalType" NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" VARCHAR(1000),
    "target_date" DATE,
    "status" "GoalStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "health_activities" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" "HealthProvider" NOT NULL,
    "external_id" VARCHAR(500),
    "activity_type" "HealthActivityType" NOT NULL,
    "title" VARCHAR(200),
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "ended_at" TIMESTAMPTZ(3),
    "duration_seconds" INTEGER,
    "active_energy_kcal" DECIMAL(8,2),
    "total_energy_kcal" DECIMAL(8,2),
    "distance_m" DECIMAL(10,2),
    "step_count" INTEGER,
    "avg_heart_rate_bpm" INTEGER,
    "max_heart_rate_bpm" INTEGER,
    "involved_workout_id" UUID,
    "sync_state" "HealthSyncState" NOT NULL DEFAULT 'synced',
    "synced_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "raw_metadata_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "health_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "health_metrics" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" "HealthProvider" NOT NULL,
    "external_id" VARCHAR(500),
    "metric_type" "HealthMetricType" NOT NULL,
    "value" DECIMAL(12,4) NOT NULL,
    "unit" VARCHAR(20) NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL,
    "period_start" TIMESTAMPTZ(3),
    "period_end" TIMESTAMPTZ(3),
    "sync_state" "HealthSyncState" NOT NULL DEFAULT 'synced',
    "synced_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "health_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "health_permissions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" "HealthProvider" NOT NULL,
    "data_type" VARCHAR(100) NOT NULL,
    "granted" BOOLEAN NOT NULL DEFAULT false,
    "granted_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "health_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "health_sync_cursors" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" "HealthProvider" NOT NULL,
    "data_type" VARCHAR(100) NOT NULL,
    "last_synced_at" TIMESTAMPTZ(3),
    "last_anchor" VARCHAR(1000),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "health_sync_cursors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nutrition_targets" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "effective_date" DATE NOT NULL,
    "calories" DECIMAL(8,2) NOT NULL,
    "protein_g" DECIMAL(8,2) NOT NULL,
    "carbohydrate_g" DECIMAL(8,2) NOT NULL,
    "fat_g" DECIMAL(8,2) NOT NULL,
    "fiber_g" DECIMAL(8,2),
    "sugar_g" DECIMAL(8,2),
    "sodium_mg" DECIMAL(10,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nutrition_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "personal_records" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "exercise_id" VARCHAR(100) NOT NULL,
    "metric" "PRMetric" NOT NULL,
    "value" DECIMAL(10,3) NOT NULL,
    "unit" VARCHAR(20) NOT NULL,
    "achieved_at" TIMESTAMPTZ(3) NOT NULL,
    "workout_id" UUID,
    "workout_set_id" UUID,

    CONSTRAINT "personal_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profiles" (
    "id" UUID NOT NULL,
    "username" VARCHAR(30),
    "display_name" VARCHAR(100),
    "avatar_url" TEXT,
    "bio" VARCHAR(500),
    "date_of_birth" DATE,
    "height_cm" DECIMAL(5,1),
    "weight_kg" DECIMAL(5,1),
    "fitness_level" "FitnessLevel",
    "subscription_tier" "SubscriptionTier" NOT NULL DEFAULT 'free',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "coaching_presence" "CoachingPresence" NOT NULL DEFAULT 'weekly_checkin',
    "biological_sex" "BiologicalSex",
    "water_target_oz" INTEGER,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "program_days" (
    "id" UUID NOT NULL,
    "program_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "estimated_duration_minutes" INTEGER,
    "focus" VARCHAR(300),
    "weekday" INTEGER,

    CONSTRAINT "program_days_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "program_exercises" (
    "id" UUID NOT NULL,
    "program_day_id" UUID NOT NULL,
    "exercise_id" VARCHAR(100) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "tracking_type" "TrackingType" NOT NULL DEFAULT 'strength',
    "notes" VARCHAR(500),
    "rest_seconds" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "failure_allowed" BOOLEAN,
    "progression_condition" VARCHAR(500),
    "progression_increment" DOUBLE PRECISION,
    "progression_model" VARCHAR(40),
    "sequencing_group" VARCHAR(40),
    "sequencing_mode" VARCHAR(40),
    "starting_load" DOUBLE PRECISION,
    "week_progressions" JSONB,

    CONSTRAINT "program_exercises_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "program_sets" (
    "id" UUID NOT NULL,
    "program_exercise_id" UUID NOT NULL,
    "set_number" INTEGER NOT NULL,
    "set_type" "SetType" NOT NULL DEFAULT 'working',
    "target_reps_min" INTEGER,
    "target_reps_max" INTEGER,
    "target_weight_kg" DECIMAL(7,2),
    "target_weight_percent" INTEGER,
    "target_duration_seconds" INTEGER,
    "target_distance_m" DECIMAL(10,2),
    "target_rir" INTEGER,
    "rest_seconds" INTEGER,
    "notes" VARCHAR(300),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "program_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "programs" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "source_trainer_program_id" UUID,
    "trainer_created_by_id" UUID,
    "duration_weeks" INTEGER,
    "phases" JSONB,

    CONSTRAINT "programs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "progress_photos" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "storage_key" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "note" VARCHAR(500),
    "taken_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "progress_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_meal_items" (
    "id" UUID NOT NULL,
    "saved_meal_id" UUID NOT NULL,
    "food_item_id" UUID NOT NULL,
    "serving_multiplier" DECIMAL(8,3) NOT NULL,
    "meal_type" "MealType" NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "saved_meal_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_meals" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_meals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "strava_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "athlete_id" INTEGER NOT NULL,
    "access_token" TEXT NOT NULL,
    "refresh_token" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "scope" VARCHAR(500) NOT NULL DEFAULT 'activity:read_all',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "strava_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "template_exercises" (
    "id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "exercise_id" VARCHAR(100) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "tracking_type" "TrackingType" NOT NULL DEFAULT 'strength',
    "notes" VARCHAR(500),
    "rest_seconds" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "template_exercises_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "template_sets" (
    "id" UUID NOT NULL,
    "template_exercise_id" UUID NOT NULL,
    "set_number" INTEGER NOT NULL,
    "set_type" "SetType" NOT NULL DEFAULT 'working',
    "target_reps_min" INTEGER,
    "target_reps_max" INTEGER,
    "target_weight_kg" DECIMAL(7,2),
    "target_duration_seconds" INTEGER,
    "target_distance_m" DECIMAL(10,2),
    "rest_seconds" INTEGER,
    "notes" VARCHAR(300),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "template_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trainer_client_relationships" (
    "id" UUID NOT NULL,
    "trainer_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "status" "TrainerClientStatus" NOT NULL DEFAULT 'invited',
    "invited_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accepted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "sponsored_entitlement_id" UUID,

    CONSTRAINT "trainer_client_relationships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trainer_client_targets" (
    "id" UUID NOT NULL,
    "trainer_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "target_type" "TrainerClientTargetType" NOT NULL,
    "target_value" DECIMAL(10,3) NOT NULL,
    "unit" VARCHAR(50) NOT NULL,
    "notes" VARCHAR(500),
    "effective_date" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trainer_client_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trainer_invitations" (
    "id" UUID NOT NULL,
    "trainer_id" UUID NOT NULL,
    "invited_email" VARCHAR(255) NOT NULL,
    "token" VARCHAR(64) NOT NULL,
    "status" "TrainerInvitationStatus" NOT NULL DEFAULT 'pending',
    "sent_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "accepted_by_user_id" UUID,
    "accepted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trainer_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trainer_notes" (
    "id" UUID NOT NULL,
    "trainer_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "is_private" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trainer_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trainer_profiles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "bio" VARCHAR(500),
    "specialty" VARCHAR(200),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trainer_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trainer_program_days" (
    "id" UUID NOT NULL,
    "program_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trainer_program_days_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trainer_program_exercises" (
    "id" UUID NOT NULL,
    "program_day_id" UUID NOT NULL,
    "exercise_id" VARCHAR(100) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "tracking_type" "TrackingType" NOT NULL DEFAULT 'strength',
    "notes" VARCHAR(500),
    "rest_seconds" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trainer_program_exercises_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trainer_program_sets" (
    "id" UUID NOT NULL,
    "program_exercise_id" UUID NOT NULL,
    "set_number" INTEGER NOT NULL,
    "set_type" "SetType" NOT NULL DEFAULT 'working',
    "target_reps_min" INTEGER,
    "target_reps_max" INTEGER,
    "target_weight_kg" DECIMAL(7,2),
    "target_weight_percent" INTEGER,
    "target_duration_seconds" INTEGER,
    "target_distance_m" DECIMAL(10,2),
    "target_rir" INTEGER,
    "rest_seconds" INTEGER,
    "notes" VARCHAR(300),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trainer_program_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trainer_programs" (
    "id" UUID NOT NULL,
    "trainer_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" VARCHAR(1000),
    "level" "FitnessLevel",
    "duration_weeks" INTEGER,
    "sessions_per_week" INTEGER,
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trainer_programs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trainer_subscriptions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "tier_key" VARCHAR(50) NOT NULL,
    "max_clients" INTEGER NOT NULL,
    "status" "TrainerSubscriptionStatus" NOT NULL DEFAULT 'active',
    "billing_source" "BillingSource",
    "external_subscription_id" VARCHAR(255),
    "external_price_id" VARCHAR(255),
    "current_period_start" TIMESTAMPTZ(3),
    "current_period_end" TIMESTAMPTZ(3),
    "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trainer_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_entitlements" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "source" "UserEntitlementSource" NOT NULL,
    "status" "UserEntitlementStatus" NOT NULL DEFAULT 'active',
    "source_ref" VARCHAR(200),
    "granted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_entitlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_subscriptions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "tier" "SubscriptionTier" NOT NULL DEFAULT 'free',
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'active',
    "billing_source" "BillingSource",
    "external_subscription_id" VARCHAR(255),
    "external_price_id" VARCHAR(255),
    "trial_started_at" TIMESTAMPTZ(3),
    "trial_ends_at" TIMESTAMPTZ(3),
    "current_period_start" TIMESTAMPTZ(3),
    "current_period_end" TIMESTAMPTZ(3),
    "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "v_trainer_drafts" (
    "id" UUID NOT NULL,
    "trainer_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "draft_type" "VDraftType" NOT NULL,
    "description" VARCHAR(500) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "VDraftStatus" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_at" TIMESTAMPTZ(3),

    CONSTRAINT "v_trainer_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weekly_targets" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "target_type" "WeeklyTargetType" NOT NULL,
    "target_value" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "weekly_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workout_exercises" (
    "id" UUID NOT NULL,
    "workout_id" UUID NOT NULL,
    "exercise_id" VARCHAR(100) NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "notes" VARCHAR(500),
    "target_sets" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rest_seconds" INTEGER,
    "tracking_type" "TrackingType" NOT NULL DEFAULT 'strength',

    CONSTRAINT "workout_exercises_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workout_sets" (
    "id" UUID NOT NULL,
    "workout_exercise_id" UUID NOT NULL,
    "set_number" INTEGER NOT NULL,
    "target_reps" INTEGER,
    "target_weight_kg" DECIMAL(7,2),
    "target_duration_seconds" INTEGER,
    "target_distance_m" DECIMAL(10,2),
    "actual_reps" INTEGER,
    "actual_weight_kg" DECIMAL(7,2),
    "actual_duration_seconds" INTEGER,
    "actual_distance_m" DECIMAL(10,2),
    "rpe" INTEGER,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "rest_seconds" INTEGER,
    "rir" INTEGER,
    "set_type" "SetType" NOT NULL DEFAULT 'working',
    "target_reps_max" INTEGER,
    "target_reps_min" INTEGER,
    "target_rir" INTEGER,

    CONSTRAINT "workout_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workout_templates" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "equipment_profile_id" UUID,

    CONSTRAINT "workout_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workouts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "assigned_by_id" UUID,
    "title" VARCHAR(200) NOT NULL,
    "notes" TEXT,
    "scheduled_date" DATE,
    "status" "WorkoutStatus" NOT NULL DEFAULT 'planned',
    "source" "WorkoutSource" NOT NULL DEFAULT 'manual',
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "duration_seconds" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "program_day_id" UUID,
    "template_id" UUID,
    "duration_target_minutes" INTEGER,

    CONSTRAINT "workouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ymove_mapping" (
    "exerciseDbId" TEXT NOT NULL,
    "ymoveId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ymove_mapping_pkey" PRIMARY KEY ("exerciseDbId")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_usage_logs_user_id_billing_period_feature_key" ON "ai_usage_logs"("user_id" ASC, "billing_period" ASC, "feature" ASC);

-- CreateIndex
CREATE INDEX "ai_usage_logs_user_id_idx" ON "ai_usage_logs"("user_id" ASC);

-- CreateIndex
CREATE INDEX "custom_exercises_user_id_idx" ON "custom_exercises"("user_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "equipment_profile_items_profile_id_equipment_key" ON "equipment_profile_items"("profile_id" ASC, "equipment" ASC);

-- CreateIndex
CREATE INDEX "equipment_profile_items_profile_id_idx" ON "equipment_profile_items"("profile_id" ASC);

-- CreateIndex
CREATE INDEX "equipment_profiles_user_id_idx" ON "equipment_profiles"("user_id" ASC);

-- CreateIndex
CREATE INDEX "exercise_behavior_events_user_id_created_at_idx" ON "exercise_behavior_events"("user_id" ASC, "created_at" ASC);

-- CreateIndex
CREATE INDEX "exercise_behavior_events_user_id_exercise_id_idx" ON "exercise_behavior_events"("user_id" ASC, "exercise_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "exercise_preferences_user_id_exercise_id_key" ON "exercise_preferences"("user_id" ASC, "exercise_id" ASC);

-- CreateIndex
CREATE INDEX "exercise_preferences_user_id_idx" ON "exercise_preferences"("user_id" ASC);

-- CreateIndex
CREATE INDEX "exercise_preferences_user_id_state_idx" ON "exercise_preferences"("user_id" ASC, "state" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "food_favorites_user_id_food_item_id_key" ON "food_favorites"("user_id" ASC, "food_item_id" ASC);

-- CreateIndex
CREATE INDEX "food_favorites_user_id_idx" ON "food_favorites"("user_id" ASC);

-- CreateIndex
CREATE INDEX "food_items_barcode_idx" ON "food_items"("barcode" ASC);

-- CreateIndex
CREATE INDEX "food_items_name_idx" ON "food_items"("name" ASC);

-- CreateIndex
CREATE INDEX "food_items_source_category_source_provider_external_id_idx" ON "food_items"("source_category" ASC, "source_provider" ASC, "external_id" ASC);

-- CreateIndex
CREATE INDEX "food_items_visibility_created_by_id_idx" ON "food_items"("visibility" ASC, "created_by_id" ASC);

-- CreateIndex
CREATE INDEX "food_log_entries_user_id_log_date_idx" ON "food_log_entries"("user_id" ASC, "log_date" ASC);

-- CreateIndex
CREATE INDEX "food_log_entries_user_id_meal_type_idx" ON "food_log_entries"("user_id" ASC, "meal_type" ASC);

-- CreateIndex
CREATE INDEX "goals_user_id_idx" ON "goals"("user_id" ASC);

-- CreateIndex
CREATE INDEX "health_activities_involved_workout_id_idx" ON "health_activities"("involved_workout_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "health_activities_involved_workout_id_key" ON "health_activities"("involved_workout_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "health_activities_user_id_provider_external_id_key" ON "health_activities"("user_id" ASC, "provider" ASC, "external_id" ASC);

-- CreateIndex
CREATE INDEX "health_activities_user_id_provider_idx" ON "health_activities"("user_id" ASC, "provider" ASC);

-- CreateIndex
CREATE INDEX "health_activities_user_id_started_at_idx" ON "health_activities"("user_id" ASC, "started_at" ASC);

-- CreateIndex
CREATE INDEX "health_metrics_user_id_metric_type_recorded_at_idx" ON "health_metrics"("user_id" ASC, "metric_type" ASC, "recorded_at" ASC);

-- CreateIndex
CREATE INDEX "health_metrics_user_id_provider_idx" ON "health_metrics"("user_id" ASC, "provider" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "health_metrics_user_id_provider_metric_type_recorded_at_key" ON "health_metrics"("user_id" ASC, "provider" ASC, "metric_type" ASC, "recorded_at" ASC);

-- CreateIndex
CREATE INDEX "health_permissions_user_id_idx" ON "health_permissions"("user_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "health_permissions_user_id_provider_data_type_key" ON "health_permissions"("user_id" ASC, "provider" ASC, "data_type" ASC);

-- CreateIndex
CREATE INDEX "health_sync_cursors_user_id_idx" ON "health_sync_cursors"("user_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "health_sync_cursors_user_id_provider_data_type_key" ON "health_sync_cursors"("user_id" ASC, "provider" ASC, "data_type" ASC);

-- CreateIndex
CREATE INDEX "nutrition_targets_user_id_effective_date_idx" ON "nutrition_targets"("user_id" ASC, "effective_date" ASC);

-- CreateIndex
CREATE INDEX "personal_records_user_id_exercise_id_metric_idx" ON "personal_records"("user_id" ASC, "exercise_id" ASC, "metric" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "personal_records_workout_set_id_key" ON "personal_records"("workout_set_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "profiles_username_key" ON "profiles"("username" ASC);

-- CreateIndex
CREATE INDEX "program_days_program_id_idx" ON "program_days"("program_id" ASC);

-- CreateIndex
CREATE INDEX "program_exercises_program_day_id_idx" ON "program_exercises"("program_day_id" ASC);

-- CreateIndex
CREATE INDEX "program_sets_program_exercise_id_idx" ON "program_sets"("program_exercise_id" ASC);

-- CreateIndex
CREATE INDEX "programs_trainer_created_by_id_idx" ON "programs"("trainer_created_by_id" ASC);

-- CreateIndex
CREATE INDEX "programs_user_id_idx" ON "programs"("user_id" ASC);

-- CreateIndex
CREATE INDEX "saved_meal_items_saved_meal_id_idx" ON "saved_meal_items"("saved_meal_id" ASC);

-- CreateIndex
CREATE INDEX "saved_meals_user_id_idx" ON "saved_meals"("user_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "strava_tokens_athlete_id_key" ON "strava_tokens"("athlete_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "strava_tokens_user_id_key" ON "strava_tokens"("user_id" ASC);

-- CreateIndex
CREATE INDEX "template_exercises_template_id_idx" ON "template_exercises"("template_id" ASC);

-- CreateIndex
CREATE INDEX "template_sets_template_exercise_id_idx" ON "template_sets"("template_exercise_id" ASC);

-- CreateIndex
CREATE INDEX "trainer_client_relationships_client_id_idx" ON "trainer_client_relationships"("client_id" ASC);

-- CreateIndex
CREATE INDEX "trainer_client_relationships_status_idx" ON "trainer_client_relationships"("status" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "trainer_client_relationships_trainer_id_client_id_key" ON "trainer_client_relationships"("trainer_id" ASC, "client_id" ASC);

-- CreateIndex
CREATE INDEX "trainer_client_relationships_trainer_id_idx" ON "trainer_client_relationships"("trainer_id" ASC);

-- CreateIndex
CREATE INDEX "trainer_client_targets_client_id_target_type_idx" ON "trainer_client_targets"("client_id" ASC, "target_type" ASC);

-- CreateIndex
CREATE INDEX "trainer_client_targets_trainer_id_client_id_idx" ON "trainer_client_targets"("trainer_id" ASC, "client_id" ASC);

-- CreateIndex
CREATE INDEX "trainer_invitations_invited_email_idx" ON "trainer_invitations"("invited_email" ASC);

-- CreateIndex
CREATE INDEX "trainer_invitations_token_idx" ON "trainer_invitations"("token" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "trainer_invitations_token_key" ON "trainer_invitations"("token" ASC);

-- CreateIndex
CREATE INDEX "trainer_invitations_trainer_id_idx" ON "trainer_invitations"("trainer_id" ASC);

-- CreateIndex
CREATE INDEX "trainer_notes_trainer_id_client_id_idx" ON "trainer_notes"("trainer_id" ASC, "client_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "trainer_profiles_user_id_key" ON "trainer_profiles"("user_id" ASC);

-- CreateIndex
CREATE INDEX "trainer_program_days_program_id_idx" ON "trainer_program_days"("program_id" ASC);

-- CreateIndex
CREATE INDEX "trainer_program_exercises_program_day_id_idx" ON "trainer_program_exercises"("program_day_id" ASC);

-- CreateIndex
CREATE INDEX "trainer_program_sets_program_exercise_id_idx" ON "trainer_program_sets"("program_exercise_id" ASC);

-- CreateIndex
CREATE INDEX "trainer_programs_trainer_id_idx" ON "trainer_programs"("trainer_id" ASC);

-- CreateIndex
CREATE INDEX "trainer_subscriptions_user_id_idx" ON "trainer_subscriptions"("user_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "trainer_subscriptions_user_id_key" ON "trainer_subscriptions"("user_id" ASC);

-- CreateIndex
CREATE INDEX "user_entitlements_source_ref_idx" ON "user_entitlements"("source_ref" ASC);

-- CreateIndex
CREATE INDEX "user_entitlements_user_id_source_idx" ON "user_entitlements"("user_id" ASC, "source" ASC);

-- CreateIndex
CREATE INDEX "user_entitlements_user_id_status_idx" ON "user_entitlements"("user_id" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "user_subscriptions_user_id_idx" ON "user_subscriptions"("user_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "user_subscriptions_user_id_key" ON "user_subscriptions"("user_id" ASC);

-- CreateIndex
CREATE INDEX "v_trainer_drafts_client_id_status_idx" ON "v_trainer_drafts"("client_id" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "v_trainer_drafts_trainer_id_status_idx" ON "v_trainer_drafts"("trainer_id" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "weekly_targets_user_id_idx" ON "weekly_targets"("user_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "weekly_targets_user_id_target_type_key" ON "weekly_targets"("user_id" ASC, "target_type" ASC);

-- CreateIndex
CREATE INDEX "workout_exercises_workout_id_idx" ON "workout_exercises"("workout_id" ASC);

-- CreateIndex
CREATE INDEX "workout_sets_workout_exercise_id_idx" ON "workout_sets"("workout_exercise_id" ASC);

-- CreateIndex
CREATE INDEX "workout_templates_user_id_idx" ON "workout_templates"("user_id" ASC);

-- CreateIndex
CREATE INDEX "workouts_program_day_id_idx" ON "workouts"("program_day_id" ASC);

-- CreateIndex
CREATE INDEX "workouts_template_id_idx" ON "workouts"("template_id" ASC);

-- CreateIndex
CREATE INDEX "workouts_user_id_completed_at_idx" ON "workouts"("user_id" ASC, "completed_at" ASC);

-- CreateIndex
CREATE INDEX "workouts_user_id_scheduled_date_idx" ON "workouts"("user_id" ASC, "scheduled_date" ASC);

-- CreateIndex
CREATE INDEX "workouts_user_id_status_idx" ON "workouts"("user_id" ASC, "status" ASC);

-- AddForeignKey
ALTER TABLE "ai_usage_logs" ADD CONSTRAINT "ai_usage_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_exercises" ADD CONSTRAINT "custom_exercises_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_profile_items" ADD CONSTRAINT "equipment_profile_items_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "equipment_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_profiles" ADD CONSTRAINT "equipment_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exercise_behavior_events" ADD CONSTRAINT "exercise_behavior_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exercise_preferences" ADD CONSTRAINT "exercise_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "food_favorites" ADD CONSTRAINT "food_favorites_food_item_id_fkey" FOREIGN KEY ("food_item_id") REFERENCES "food_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "food_favorites" ADD CONSTRAINT "food_favorites_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "food_items" ADD CONSTRAINT "food_items_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "food_items" ADD CONSTRAINT "food_items_duplicate_of_id_fkey" FOREIGN KEY ("duplicate_of_id") REFERENCES "food_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "food_log_entries" ADD CONSTRAINT "food_log_entries_food_item_id_fkey" FOREIGN KEY ("food_item_id") REFERENCES "food_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "food_log_entries" ADD CONSTRAINT "food_log_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_activities" ADD CONSTRAINT "health_activities_involved_workout_id_fkey" FOREIGN KEY ("involved_workout_id") REFERENCES "workouts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_activities" ADD CONSTRAINT "health_activities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_metrics" ADD CONSTRAINT "health_metrics_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_permissions" ADD CONSTRAINT "health_permissions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_sync_cursors" ADD CONSTRAINT "health_sync_cursors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutrition_targets" ADD CONSTRAINT "nutrition_targets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personal_records" ADD CONSTRAINT "personal_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personal_records" ADD CONSTRAINT "personal_records_workout_id_fkey" FOREIGN KEY ("workout_id") REFERENCES "workouts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personal_records" ADD CONSTRAINT "personal_records_workout_set_id_fkey" FOREIGN KEY ("workout_set_id") REFERENCES "workout_sets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program_days" ADD CONSTRAINT "program_days_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program_exercises" ADD CONSTRAINT "program_exercises_program_day_id_fkey" FOREIGN KEY ("program_day_id") REFERENCES "program_days"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program_sets" ADD CONSTRAINT "program_sets_program_exercise_id_fkey" FOREIGN KEY ("program_exercise_id") REFERENCES "program_exercises"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "programs" ADD CONSTRAINT "programs_source_trainer_program_id_fkey" FOREIGN KEY ("source_trainer_program_id") REFERENCES "trainer_programs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "programs" ADD CONSTRAINT "programs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progress_photos" ADD CONSTRAINT "progress_photos_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_meal_items" ADD CONSTRAINT "saved_meal_items_food_item_id_fkey" FOREIGN KEY ("food_item_id") REFERENCES "food_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_meal_items" ADD CONSTRAINT "saved_meal_items_saved_meal_id_fkey" FOREIGN KEY ("saved_meal_id") REFERENCES "saved_meals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_meals" ADD CONSTRAINT "saved_meals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strava_tokens" ADD CONSTRAINT "strava_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "template_exercises" ADD CONSTRAINT "template_exercises_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "workout_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_sets" ADD CONSTRAINT "template_sets_template_exercise_id_fkey" FOREIGN KEY ("template_exercise_id") REFERENCES "template_exercises"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trainer_client_relationships" ADD CONSTRAINT "trainer_client_relationships_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trainer_client_relationships" ADD CONSTRAINT "trainer_client_relationships_trainer_id_fkey" FOREIGN KEY ("trainer_id") REFERENCES "trainer_profiles"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trainer_client_targets" ADD CONSTRAINT "trainer_client_targets_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trainer_client_targets" ADD CONSTRAINT "trainer_client_targets_trainer_id_fkey" FOREIGN KEY ("trainer_id") REFERENCES "trainer_profiles"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trainer_invitations" ADD CONSTRAINT "trainer_invitations_trainer_id_fkey" FOREIGN KEY ("trainer_id") REFERENCES "trainer_profiles"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trainer_notes" ADD CONSTRAINT "trainer_notes_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trainer_notes" ADD CONSTRAINT "trainer_notes_trainer_id_fkey" FOREIGN KEY ("trainer_id") REFERENCES "trainer_profiles"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trainer_profiles" ADD CONSTRAINT "trainer_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trainer_program_days" ADD CONSTRAINT "trainer_program_days_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "trainer_programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trainer_program_exercises" ADD CONSTRAINT "trainer_program_exercises_program_day_id_fkey" FOREIGN KEY ("program_day_id") REFERENCES "trainer_program_days"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trainer_program_sets" ADD CONSTRAINT "trainer_program_sets_program_exercise_id_fkey" FOREIGN KEY ("program_exercise_id") REFERENCES "trainer_program_exercises"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trainer_programs" ADD CONSTRAINT "trainer_programs_trainer_id_fkey" FOREIGN KEY ("trainer_id") REFERENCES "trainer_profiles"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trainer_subscriptions" ADD CONSTRAINT "trainer_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_entitlements" ADD CONSTRAINT "user_entitlements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_subscriptions" ADD CONSTRAINT "user_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "v_trainer_drafts" ADD CONSTRAINT "v_trainer_drafts_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "v_trainer_drafts" ADD CONSTRAINT "v_trainer_drafts_trainer_id_fkey" FOREIGN KEY ("trainer_id") REFERENCES "trainer_profiles"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_targets" ADD CONSTRAINT "weekly_targets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_exercises" ADD CONSTRAINT "workout_exercises_workout_id_fkey" FOREIGN KEY ("workout_id") REFERENCES "workouts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_sets" ADD CONSTRAINT "workout_sets_workout_exercise_id_fkey" FOREIGN KEY ("workout_exercise_id") REFERENCES "workout_exercises"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_templates" ADD CONSTRAINT "workout_templates_equipment_profile_id_fkey" FOREIGN KEY ("equipment_profile_id") REFERENCES "equipment_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_templates" ADD CONSTRAINT "workout_templates_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workouts" ADD CONSTRAINT "workouts_program_day_id_fkey" FOREIGN KEY ("program_day_id") REFERENCES "program_days"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workouts" ADD CONSTRAINT "workouts_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "workout_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workouts" ADD CONSTRAINT "workouts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

