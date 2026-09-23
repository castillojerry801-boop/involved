// Normalized health/activity types shared between the sync API and lib services.
// Platform-agnostic — Apple Health, Health Connect, Garmin etc. all map to these.

export type HealthProvider =
  | 'apple_health'
  | 'health_connect'
  | 'garmin'
  | 'strava'
  | 'polar'
  | 'manual'

export type HealthActivityType =
  | 'strength_training'
  | 'running'
  | 'cycling'
  | 'walking'
  | 'swimming'
  | 'hiking'
  | 'yoga'
  | 'hiit'
  | 'rowing'
  | 'other'
  | 'functional_strength'
  | 'elliptical'
  | 'stair_climbing'
  | 'cross_training'

export type HealthMetricType =
  | 'steps'
  | 'active_energy_kcal'
  | 'resting_energy_kcal'
  | 'heart_rate_avg_bpm'
  | 'heart_rate_max_bpm'
  | 'heart_rate_resting_bpm'
  | 'distance_m'
  | 'body_weight_kg'
  | 'body_fat_pct'
  | 'sleep_duration_s'
  | 'vo2_max'
  | 'hrv_ms'
  | 'stand_hours'
  | 'flights_climbed'

// Standard unit strings for each metric type — enforced by sync service
export const METRIC_UNITS: Record<HealthMetricType, string> = {
  steps:                 'count',
  active_energy_kcal:    'kcal',
  resting_energy_kcal:   'kcal',
  heart_rate_avg_bpm:    'bpm',
  heart_rate_max_bpm:    'bpm',
  heart_rate_resting_bpm:'bpm',
  distance_m:            'm',
  body_weight_kg:        'kg',
  body_fat_pct:          '%',
  sleep_duration_s:      's',
  vo2_max:               'mL/kg/min',
  hrv_ms:                'ms',
  stand_hours:           'hours',
  flights_climbed:       'count',
}

// ─── Inbound sync payload ─────────────────────────────────────────────────────
// Shape expected by POST /api/health/sync from native bridges.
// All fields are optional at the item level — only include what you have.

export interface InboundHealthActivity {
  externalId:       string
  activityType:     HealthActivityType
  title?:           string
  startedAt:        string  // ISO 8601
  endedAt?:         string  // ISO 8601
  durationSeconds?: number
  activeEnergyKcal?: number
  totalEnergyKcal?:  number
  distanceM?:       number
  stepCount?:       number
  avgHeartRateBpm?: number
  maxHeartRateBpm?: number
  rawMetadata?:     Record<string, unknown>
}

export interface InboundHealthMetric {
  externalId?:    string
  metricType:     HealthMetricType
  value:          number
  recordedAt:     string  // ISO 8601
  periodStart?:   string  // ISO 8601 — set for period aggregates
  periodEnd?:     string  // ISO 8601
}

export interface HealthSyncPayload {
  provider:    HealthProvider
  activities?: InboundHealthActivity[]
  metrics?:    InboundHealthMetric[]
  // Opaque cursor to return to the calling client for incremental sync
  anchor?:     string
}

// ─── V summary types ──────────────────────────────────────────────────────────
// Validated, structured summaries sent to V. Never raw records.

export interface ActivitySummaryItem {
  date:             string   // YYYY-MM-DD
  title?:           string
  activityType:     HealthActivityType
  durationMinutes?: number
  activeEnergyKcal?: number
  avgHeartRateBpm?: number
  maxHeartRateBpm?: number
  distanceM?:       number
  stepCount?:       number
}

export interface HealthVSummary {
  provider:         HealthProvider | null
  periodStart:      string  // YYYY-MM-DD
  periodEnd:        string  // YYYY-MM-DD
  // Daily step count for the period — only dates with data included
  dailySteps:       Array<{ date: string; steps: number }>
  // Recent activities — most recent first, max 10
  recentActivities: ActivitySummaryItem[]
  // Latest body weight reading
  latestWeightKg?:  number
  latestWeightDate?: string
  // Today's stats (if data exists for today)
  today?: {
    steps?:          number
    activeEnergyKcal?: number
  }
}
