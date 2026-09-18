# Involved — Native Health Bridge Contract

This document specifies what must be implemented in the native iOS and Android layers to complete the health/activity sync integration. The backend is fully implemented and ready to receive data.

---

## Architecture Overview

```
Native App (iOS / Android)
  ↓ reads with platform permission
Health Platform (HealthKit / Health Connect)
  ↓ normalizes to Involved schema
POST /api/health/sync  (authenticated with user's session token)
  ↓ deduplicates and stores
health_activities / health_metrics tables
  ↓ surfaces to UI and V context
Dashboards, V summaries
```

The native layer owns platform permissions and raw data access. The backend owns normalization, storage, dedup, and feature logic.

---

## Authentication

All `/api/health/*` requests must include the user's session token:

```
Authorization: Bearer <supabase-access-token>
```

Refresh the token before sync if it may be expired.

---

## Sync Payload Shape

`POST /api/health/sync`

```typescript
interface HealthSyncPayload {
  provider: 'apple_health' | 'health_connect' | 'garmin' | 'strava' | 'polar' | 'manual'
  activities?: InboundHealthActivity[]
  metrics?:    InboundHealthMetric[]
  anchor?:     string  // opaque cursor — echo back on next sync for incremental reads
}

interface InboundHealthActivity {
  externalId:        string       // required for dedup — platform UUID
  activityType:      HealthActivityType
  title?:            string
  startedAt:         string       // ISO 8601 with timezone
  endedAt?:          string       // ISO 8601
  durationSeconds?:  number
  activeEnergyKcal?: number
  totalEnergyKcal?:  number
  distanceM?:        number
  stepCount?:        number
  avgHeartRateBpm?:  number
  maxHeartRateBpm?:  number
  rawMetadata?:      Record<string, unknown>  // platform extras, not surfaced to V
}

interface InboundHealthMetric {
  externalId?:   string       // optional; used for dedup if present
  metricType:    HealthMetricType
  value:         number
  recordedAt:    string       // ISO 8601
  periodStart?:  string       // ISO 8601 — for period aggregates (e.g. daily steps)
  periodEnd?:    string
}

type HealthActivityType =
  | 'strength_training' | 'running' | 'cycling' | 'walking'
  | 'swimming' | 'hiking' | 'yoga' | 'hiit' | 'rowing' | 'other'

type HealthMetricType =
  | 'steps' | 'active_energy_kcal' | 'resting_energy_kcal'
  | 'heart_rate_avg_bpm' | 'heart_rate_max_bpm' | 'heart_rate_resting_bpm'
  | 'distance_m' | 'body_weight_kg' | 'body_fat_pct'
  | 'sleep_duration_s' | 'vo2_max' | 'hrv_ms' | 'stand_hours' | 'flights_climbed'
```

---

## iOS — HealthKit Implementation Required

### Info.plist Keys

Add these usage descriptions. Request only permissions actually used:

```xml
<key>NSHealthShareUsageDescription</key>
<string>Involved reads your workouts, steps, and activity to enrich your training summary.</string>
<key>NSHealthUpdateUsageDescription</key>
<string>Involved writes completed workouts to Apple Health so your activity history is complete.</string>
```

### Entitlements

```xml
<key>com.apple.developer.healthkit</key>
<true/>
<key>com.apple.developer.healthkit.access</key>
<array>
  <string>health-records</string>
</array>
```

### Permission Request (Swift)

Request only the types you need. Do not request all available types:

```swift
let readTypes: Set<HKSampleType> = [
    HKWorkoutType.workoutType(),
    HKQuantityType.quantityType(forIdentifier: .stepCount)!,
    HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned)!,
    HKQuantityType.quantityType(forIdentifier: .heartRate)!,
    HKQuantityType.quantityType(forIdentifier: .bodyMass)!,
    HKQuantityType.quantityType(forIdentifier: .distanceWalkingRunning)!,
]

let writeTypes: Set<HKSampleType> = [
    HKWorkoutType.workoutType(),
]

HKHealthStore().requestAuthorization(toShare: writeTypes, read: readTypes) { success, error in
    // Record granted types via POST /api/health/permissions
}
```

### Reading Workouts

```swift
let query = HKSampleQuery(
    sampleType: HKWorkoutType.workoutType(),
    predicate: HKQuery.predicateForSamples(withStart: lastSyncDate, end: nil),
    limit: HKObjectQueryNoLimit,
    sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)]
) { _, samples, _ in
    let activities = (samples as? [HKWorkout])?.map { workout in
        InboundHealthActivity(
            externalId:        workout.uuid.uuidString,
            activityType:      mapActivityType(workout.workoutActivityType),
            title:             nil,
            startedAt:         ISO8601DateFormatter().string(from: workout.startDate),
            endedAt:           ISO8601DateFormatter().string(from: workout.endDate),
            durationSeconds:   Int(workout.duration),
            activeEnergyKcal:  workout.totalEnergyBurned?.doubleValue(for: .kilocalorie()),
            distanceM:         workout.totalDistance?.doubleValue(for: .meter()),
        )
    } ?? []
    // POST to /api/health/sync
}
```

### Activity Type Mapping

```swift
func mapActivityType(_ type: HKWorkoutActivityType) -> String {
    switch type {
    case .traditionalStrengthTraining, .functionalStrengthTraining, .coreTraining:
        return "strength_training"
    case .running:    return "running"
    case .cycling:    return "cycling"
    case .walking:    return "walking"
    case .swimming:   return "swimming"
    case .hiking:     return "hiking"
    case .yoga:       return "yoga"
    case .highIntensityIntervalTraining: return "hiit"
    case .rowing:     return "rowing"
    default:          return "other"
    }
}
```

### Writing Workouts Back to Apple Health

When an Involved workout is completed, write it back so it appears in the Health app:

```swift
let workout = HKWorkout(
    activityType: .traditionalStrengthTraining,
    start: startDate,
    end: endDate,
    duration: durationSeconds,
    totalEnergyBurned: HKQuantity(unit: .kilocalorie(), doubleValue: activeEnergyKcal ?? 0),
    totalDistance: nil,
    metadata: ["InvolvedWorkoutId": involvedWorkoutId]
)
HKHealthStore().save(workout) { success, error in ... }
```

Use `"InvolvedWorkoutId"` in metadata so re-import is recognized as the same record (matched via the `involved:` prefix in `externalId`).

### Incremental Sync

Store the last sync date (not the anchor token — HealthKit uses date predicates, not tokens):

```swift
let lastSync = UserDefaults.standard.object(forKey: "healthkit_last_sync") as? Date ?? .distantPast
// Use as predicate start date on next sync
UserDefaults.standard.set(Date(), forKey: "healthkit_last_sync")
```

---

## Android — Health Connect Implementation Required

Health Connect replaced Google Fit. Do NOT use the deprecated Google Fit API.

### Gradle Dependencies

```groovy
implementation "androidx.health.connect:connect-client:1.1.0-alpha10"
```

### Permissions (AndroidManifest.xml)

```xml
<uses-permission android:name="android.permission.health.READ_EXERCISE"/>
<uses-permission android:name="android.permission.health.READ_STEPS"/>
<uses-permission android:name="android.permission.health.READ_ACTIVE_CALORIES_BURNED"/>
<uses-permission android:name="android.permission.health.READ_HEART_RATE"/>
<uses-permission android:name="android.permission.health.READ_WEIGHT"/>
<uses-permission android:name="android.permission.health.WRITE_EXERCISE"/>
```

Add intent filter for Health Connect settings:

```xml
<activity-alias
    android:name="HealthConnectActivity"
    android:exported="true"
    android:targetActivity=".MainActivity">
  <intent-filter>
    <action android:name="androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE"/>
  </intent-filter>
</activity-alias>
```

### Permission Request (Kotlin)

```kotlin
val client = HealthConnectClient.getOrCreate(context)

val permissions = setOf(
    HealthPermission.getReadPermission(ExerciseSessionRecord::class),
    HealthPermission.getReadPermission(StepsRecord::class),
    HealthPermission.getReadPermission(ActiveCaloriesBurnedRecord::class),
    HealthPermission.getReadPermission(HeartRateRecord::class),
    HealthPermission.getReadPermission(WeightRecord::class),
    HealthPermission.getWritePermission(ExerciseSessionRecord::class),
)

val requestPermissions = registerForActivityResult(
    PermissionController.createRequestPermissionResultContract()
) { granted ->
    // Record granted types via POST /api/health/permissions
}

if (client.permissionController.getGrantedPermissions().containsAll(permissions)) {
    // Already granted — begin sync
} else {
    requestPermissions.launch(permissions)
}
```

### Reading Exercise Sessions (Kotlin)

```kotlin
val response = client.readRecords(
    ReadRecordsRequest(
        ExerciseSessionRecord::class,
        timeRangeFilter = TimeRangeFilter.after(lastSyncTime)
    )
)

val activities = response.records.map { session ->
    mapOf(
        "externalId"       to session.metadata.id,
        "activityType"     to mapExerciseType(session.exerciseType),
        "title"            to session.title,
        "startedAt"        to session.startTime.toString(),
        "endedAt"          to session.endTime.toString(),
        "durationSeconds"  to Duration.between(session.startTime, session.endTime).seconds,
        "activeEnergyKcal" to (session.segments.sumOf { it.metadata.clientRecordVersion.toDouble() }),
    )
}
```

### Exercise Type Mapping (Kotlin)

```kotlin
fun mapExerciseType(type: Int): String = when (type) {
    ExerciseSessionRecord.EXERCISE_TYPE_STRENGTH_TRAINING,
    ExerciseSessionRecord.EXERCISE_TYPE_WEIGHTLIFTING -> "strength_training"
    ExerciseSessionRecord.EXERCISE_TYPE_RUNNING       -> "running"
    ExerciseSessionRecord.EXERCISE_TYPE_BIKING        -> "cycling"
    ExerciseSessionRecord.EXERCISE_TYPE_WALKING       -> "walking"
    ExerciseSessionRecord.EXERCISE_TYPE_SWIMMING_POOL,
    ExerciseSessionRecord.EXERCISE_TYPE_SWIMMING_OPEN_WATER -> "swimming"
    ExerciseSessionRecord.EXERCISE_TYPE_HIKING        -> "hiking"
    ExerciseSessionRecord.EXERCISE_TYPE_YOGA          -> "yoga"
    ExerciseSessionRecord.EXERCISE_TYPE_HIGH_INTENSITY_INTERVAL_TRAINING -> "hiit"
    ExerciseSessionRecord.EXERCISE_TYPE_ROWING_MACHINE -> "rowing"
    else -> "other"
}
```

### Incremental Sync (Android)

Health Connect supports change tokens for efficient incremental reads:

```kotlin
// First sync: get initial token
val token = client.getChangesToken(ChangesTokenRequest(setOf(ExerciseSessionRecord::class)))

// Subsequent syncs: use stored token
val changes = client.getChanges(storedToken)
// process changes.changes (upserts and deletes)
val newToken = changes.nextChangesToken
// Store newToken as the anchor for the next sync
```

Pass `nextChangesToken` as `anchor` in the sync payload — the backend stores it in `health_sync_cursors.last_anchor`.

---

## Sync Frequency

- On app launch (if last sync > 15 minutes ago)
- On workout completion (write-back + pull latest)
- Background refresh: platform background fetch / WorkManager — at most once per hour
- Do NOT sync on every app foreground — respect platform battery limits

---

## Write-Back Dedup

Involved workout IDs are written back with `externalId = "involved:<workoutId>"`. When the native bridge imports workouts from the platform, these will match existing `HealthActivity` rows and upsert cleanly, preventing duplicate records.

---

## Privacy Contract

- Request only permissions listed above — do not request unused types
- Permissions are requested once, on the health settings screen — not buried in onboarding
- Users can revoke via iOS Health app or Android Health Connect at any time
- Call `POST /api/health/permissions` with `action: "revoke"` after detecting revocation
- Do not store raw health data in app storage beyond what is needed for the current sync batch
- Treat all health data as sensitive — do not log it, do not include it in crash reports

---

## Not Yet Implemented (Backend Ready, Native Pending)

| Feature | Status |
|---------|--------|
| HealthKit workout read + sync | Backend ready, iOS native pending |
| HealthKit write-back | Backend ready, iOS native pending |
| HealthKit incremental sync | Backend ready, iOS native pending |
| Health Connect workout read + sync | Backend ready, Android native pending |
| Health Connect write-back | Backend ready, Android native pending |
| Health Connect incremental sync (change tokens) | Backend ready, Android native pending |
| Garmin Connect integration | Backend enum ready, connector pending |
| Strava integration | Backend enum ready, connector pending |
| Email transactional send for trainer invites | API endpoint ready, email provider pending |
| Stripe webhook → trainer subscription provisioning | Endpoint ready, Stripe product IDs pending |
