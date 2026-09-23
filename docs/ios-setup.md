# iOS Setup Guide

## Overview

The Involved iOS app uses **Capacitor v6 in server mode** — a WKWebView that loads the live Vercel deployment URL. No static export is needed. HealthKit data is read via a custom Swift Capacitor plugin and synced to the Involved backend over the authenticated Next.js API.

---

## Prerequisites

- macOS with Xcode 15+
- Apple Developer account (free for simulator; paid for TestFlight/App Store)
- Node.js 20+ and npm
- CocoaPods (`sudo gem install cocoapods`)

---

## First-time setup

### 1. Install dependencies

```bash
npm install
```

### 2. Set environment variable

In `.env.local`, set your Vercel deployment URL:

```
CAPACITOR_SERVER_URL=https://your-app.vercel.app
```

For local development with a simulator, you can omit this variable; the default `http://localhost:3000` is used. **Make sure `npm run dev` is running** when testing locally.

### 3. Sync Capacitor

```bash
npx cap sync ios
```

This copies the Capacitor config into the Xcode project and installs CocoaPods.

### 4. Open in Xcode

```bash
npx cap open ios
```

---

## HealthKit entitlement

The `App.entitlements` file at `ios/App/App/App.entitlements` includes `com.apple.developer.healthkit`. Xcode must also have HealthKit capability toggled ON:

1. Select the **App** target in Xcode
2. Go to **Signing & Capabilities**
3. Click **+ Capability** → add **HealthKit**

HealthKit requires a real device. The simulator will silently return empty data.

---

## Info.plist usage description

Add the following keys to `ios/App/App/Info.plist` (see `ios-additions/Info.plist.additions.xml`):

```xml
<key>NSHealthShareUsageDescription</key>
<string>Involved reads your workouts, heart rate, and body weight from Apple Health to give you a complete picture of your training history.</string>
<key>NSHealthUpdateUsageDescription</key>
<string>Involved does not write data to Apple Health.</string>
```

Xcode may add these automatically if HealthKit capability is toggled on, but verify they exist before building.

---

## Building for TestFlight

1. In Xcode, set **Signing** to your Apple Developer team
2. Select **Any iOS Device (arm64)** as destination
3. Set `CAPACITOR_SERVER_URL` to the production Vercel URL in your build environment
4. Run **Product → Archive**
5. Upload via **Organizer → Distribute App → TestFlight**

---

## Custom HealthKit plugin

The plugin lives at `ios/App/App/HealthKitPlugin.swift` + `HealthKitPlugin.m`.

| Method | Description |
|--------|-------------|
| `isAvailable()` | Returns `{ available: bool }` — false on iPad/simulators |
| `requestPermissions()` | Triggers iOS permission sheet; returns `{ granted: bool }` |
| `queryWorkouts({ startDate, endDate })` | Returns up to all workouts in range |
| `queryBodyMass({ startDate, endDate })` | Returns up to 90 body weight samples |
| `queryRestingHeartRate({ startDate, endDate })` | Returns up to 90 RHR readings |

Dates are ISO 8601 strings. HR is queried per-workout during `queryWorkouts` via a nested `HKSampleQuery`.

---

## Data flow

```
Apple Health → HKHealthStore → HealthKitPlugin.swift
  → Capacitor bridge
  → lib/native/healthkit.ts
  → lib/native/healthkit-normalizer.ts
  → lib/native/healthkit-sync.ts
  → POST /api/healthkit/activities  (upsert HealthActivity)
  → POST /api/healthkit/metrics     (upsert HealthMetric)
```

Deduplication uses `externalId` (HealthKit UUID) via unique index on `(userId, provider, externalId)`.

---

## Sync window

Initial sync covers the past **30 days**. Subsequent syncs start from the `lastSyncedAt` cursor stored in `HealthSyncCursor`. Background sync is planned for v2; for now, users trigger it manually from Settings.

---

## Settings UI

`components/settings/AppleHealthCard` renders on Settings page only when running on a native iOS device (`isNativeApp()` returns true via `window.Capacitor` check). On web it is invisible.

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `HealthKit not available` | Must run on real device; enable HealthKit capability in Xcode |
| `Unauthorized` from API | User session must be active; ensure the Vercel URL is set correctly |
| Empty workout list | Check date range; HealthKit permission must be granted for Workouts |
| CocoaPods error | Run `cd ios/App && pod install` manually |
| WKWebView shows blank screen | Ensure `CAPACITOR_SERVER_URL` points to a running Next.js instance |
