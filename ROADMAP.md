# Involved — Product Roadmap

> Last updated: 2026-09-15
> Status key: ✅ Done · 🔄 In progress · 📋 Planned · 💡 Future

---

## Phase 1 — Foundation ✅

The application shell, design system, auth architecture, and database foundation.

**Completed:**
- [x] Next.js 16 App Router project setup
- [x] Tailwind v4 design system (zinc/emerald palette)
- [x] Responsive layout: desktop sidebar + mobile bottom nav
- [x] Landing / marketing page
- [x] Login and signup pages (UI + Supabase integration)
- [x] Supabase Auth architecture (browser client, server client, proxy)
- [x] Auth callback route handler
- [x] Route protection via proxy.ts
- [x] App shell layout (dashboard, training, coach, profile)
- [x] Dashboard with demo data (streak, weekly progress, today's workout, events, PRs)
- [x] Training page shell (programs list, recent workouts)
- [x] Coach page shell (usage meter, suggested prompts, Involved+ upsell)
- [x] Profile page shell (stats, goal/event links, sign out)
- [x] Prisma database schema (profiles, goals, ai_usage_logs + full nutrition schema)
- [x] Brand design system components (Button, Card, Input, Badge)
- [x] InvolvedLogo component (placeholder — replace with final asset)
- [x] Food provider abstraction layer (lib/nutrition/providers/)

**Pending (before Phase 2):**
- [ ] Connect Supabase project (add .env.local credentials)
- [ ] Run `npx prisma db push` to create tables
- [ ] Enable RLS in Supabase and set policies
- [ ] Run `npx supabase gen types typescript` to update lib/types/database.ts
- [ ] Add actual logo file to /public/logo.png and update components/logo.tsx

---

## Phase 2 — Training Core 📋

Build out the core training functionality with real data.

- [ ] Workout logging (sets, reps, weight, duration, distance, pace)
- [ ] Exercise library (name, muscle groups, movement pattern, instructions)
- [ ] Workout builder (create custom workouts)
- [ ] Program structure (phases, weeks, workout days)
- [ ] Active workout view (in-progress session UI)
- [ ] Mark workout complete + save to history
- [ ] Workout history + calendar view
- [ ] Strength progression chart (per exercise over time)
- [ ] Personal records tracking and auto-detection
- [ ] Exercise substitution suggestions

**Database additions:**
- exercises (id, name, muscle_groups, movement_type, instructions, video_url)
- workouts (id, user_id, program_id?, name, date, status, notes)
- workout_exercises (workout_id, exercise_id, order)
- workout_sets (workout_exercise_id, set_number, reps, weight_kg, duration_s, distance_m, completed)
- programs (id, name, description, weeks, sessions_per_week, level, created_by)
- personal_records (user_id, exercise_id, value, unit, achieved_at)

---

## Phase 3 — AI Coach 📋

Wire up the AI coaching engine with usage metering.

- [ ] Conversational AI chat interface (streaming)
- [ ] Anthropic Claude integration via server-side API route
- [ ] Context injection: user goals, recent workouts, training history, PRs
- [ ] **Nutrition context injection** — structured daily summary (not raw logs) sent with relevant prompts
- [ ] AI usage metering enforcement (check ai_usage_logs before each request)
- [ ] Subscription tier limit configuration (env-based, not hardcoded)
- [ ] Training plan generation
- [ ] Workout adjustment suggestions
- [ ] Exercise explanations
- [ ] Recovery recommendations
- [ ] Race/event preparation advice
- [ ] Conversation history (persist chat threads)

**Security notes:**
- API key stays server-side only
- Rate limit by IP + user ID
- Never expose model names or technical AI details to users
- Present as "Involved Coach" throughout
- Nutrition context is a pre-built summary struct — never the raw food log

**AI nutrition context shape (Phase 3 planning):**
```typescript
// Built server-side before each AI call — never sent raw log data
interface NutritionContext {
  today: {
    calories:  { consumed: number; target: number; remaining: number }
    proteinG:  { consumed: number; target: number; remaining: number }
    carbsG:    { consumed: number; target: number; remaining: number }
    fatG:      { consumed: number; target: number; remaining: number }
  }
  recentDaysAvg?: {       // 7-day rolling average
    calories:  number
    proteinG:  number
  }
}
// Normal food tracking continues to function if AI is unavailable.
```

---

## Phase 4 — Goals & Events 📋

- [ ] Goal creation flow (select type, set title/target/date)
- [ ] Goal progress tracking
- [ ] Goal completion + celebration
- [ ] Upcoming event/race tracking
- [ ] Event countdown on dashboard
- [ ] Training plan organized around event date
- [ ] Body composition goal integration with nutrition targets
- [ ] Goal history

---

## Phase 5 — Profile & Onboarding 📋

- [ ] Onboarding flow (fitness level, primary goal, schedule preference)
- [ ] Profile editing (name, avatar, bio, stats)
- [ ] Fitness level assessment
- [ ] **Initial nutrition target setup** — set daily calorie/macro targets during onboarding
- [ ] Settings (units: lbs/kg, imperial/metric; notifications, preferences)
- [ ] Account management (email change, password change)
- [ ] Avatar upload (Supabase Storage)

---

## Phase 6 — Nutrition & Food Library 📋

> Nutrition is a first-class product pillar alongside Training. It appears in the brand concepts
> and is required for body composition goals, AI Coach nutrition context, and long-term user value.
> The database schema and provider abstraction are already in place from Phase 1.

### Food Search

- [ ] Food search page/modal with tabbed results (Involved Library + External)
- [ ] Search query → Involved Food Library (Postgres full-text or trigram)
- [ ] Search query → external providers via FoodProvider abstraction
- [ ] Result deduplication (suppress known duplicates via duplicate_of_id)
- [ ] Display: food name, brand, calories, macros per serving, source badge
- [ ] Select food → choose serving size → log food

### Food Logging

- [ ] Log food to a meal (Breakfast, Lunch, Dinner, Snack, Other)
- [ ] Serving size selection (fraction of serving, multiple servings)
- [ ] Daily food log view — grouped by meal, shows per-item and totals
- [ ] Edit / delete a logged food entry (modifies only the log row — snapshot unchanged)
- [ ] Daily nutrition totals (calories, protein, carbs, fat)
  - Computed server-side: `SUM(snapshot_calories × serving_multiplier)`
  - This is arithmetic, not AI
- [ ] Nutrition target vs. actual comparison (progress bars)
- [ ] Food log history (browse past days)
- [ ] Copy previous day's log (creates new entries for today, new snapshots)

### Food Library

- [ ] User can add a new food manually (name, brand, serving, macros, barcode, ingredients)
- [ ] User-created foods start as `private_food`
- [ ] User can submit food for community sharing (→ `community`)
- [ ] Involved team can verify community foods (→ `verified`)
- [ ] Food search respects visibility:
  - Returns all `verified` and `community` foods globally
  - Returns user's own `private_food` items only to that user
- [ ] Duplicate detection prompt when a new food closely matches an existing one

### Barcode Support (backend-ready, UI deferred)

- [ ] `/api/nutrition/barcode-lookup` route:
  1. Query `food_items` by barcode (O(1) indexed lookup)
  2. If not found → query registered FoodProviders
  3. If found externally → import to `food_items` with provenance, return result
  4. If still not found → return "not found, add food?" response
- [ ] Barcode field on the "Add Food" form (manual entry)
- [ ] Native barcode scanning deferred to mobile phase — web camera API can be added
  when a web-based scanner library (e.g., QuaggaJS, ZXing-WASM) is evaluated

### External Provider Integration

- [ ] Implement `UsdaFoodProvider` (lib/nutrition/providers/usda.ts)
  - USDA FoodData Central API — free, no key required for basic use
  - Stores: source_category = `external_api`, source_provider = `"usda_fooddata_central"`
  - Cache results in `food_items` on first lookup; re-sync periodically via `last_synced_at`
- [ ] Provider result caching strategy: import to `food_items` on first use to avoid repeated
  external API calls for common foods
- [ ] Adding future providers (Open Food Facts, barcode DB, restaurant API):
  implement `FoodProvider` interface, register in `lib/nutrition/providers/index.ts`
  — no schema migrations required

### Favorites & Recents

- [ ] Recent foods derived from `food_log_entries` — no separate table needed
  - Query: `GROUP BY food_item_id ORDER BY MAX(logged_at) DESC LIMIT 10`
- [ ] Favorite foods (explicit) — `food_favorites` table
- [ ] Saved meals — `saved_meals` + `saved_meal_items` tables
- [ ] "Log this meal again" action

### Nutrition Targets

- [ ] Set daily calorie/macro targets (calories, protein, carbs, fat)
- [ ] Optional extended targets (fiber, sugar, sodium)
- [ ] Effective-date model: insert a new `nutrition_targets` row when targets change
  so history is preserved. Always use latest row where `effective_date <= today`.
- [ ] Target wizard (guided setup) — can suggest targets based on profile data;
  final values are always user-controlled

### Nutrition Label Photo (AI — future, deferred)

> This is the only nutrition feature where AI adds meaningful value beyond what
> normal application logic can do. The entire pipeline must route through user
> confirmation before any data enters the food library.

- [ ] Photo upload endpoint (Supabase Storage → signed URL → Claude Vision)
- [ ] Claude extracts: product name, serving size, calories, macros, extended nutrients
- [ ] Extracted data is presented to user for review — field-by-field confirmation
- [ ] On confirmation → creates a `FoodItem` with `is_draft = false` and
  `source_category = user_created`, `visibility = private_food`
- [ ] AI-extracted data that is NOT confirmed is discarded — never auto-saved
- [ ] This AI call is metered the same as AI Coach interactions
- [ ] Prompt engineering: ask Claude to return structured JSON, not prose,
  to make confirmation UI straightforward

### Nutrition Admin (internal tooling)

- [ ] View flagged/pending `community` foods
- [ ] Verify or reject community-submitted foods
- [ ] Merge duplicate foods (set `duplicate_of_id`)
- [ ] View food library growth metrics

---

## Phase 7 — Subscriptions 📋

*(was Phase 6)*

- [ ] Stripe integration
- [ ] Involved Free vs Involved+ feature gating
- [ ] Subscription management page
- [ ] Billing history
- [ ] Webhook handler (subscription events)
- [ ] Upgrade/downgrade flows
- [ ] Trial period logic

**Involved Free:**
- Core workout logging
- Basic program access
- Limited AI Coach interactions/month (count TBD)
- Goal tracking
- Food logging (core feature — free)
- Basic nutrition targets

**Involved+:**
- Unlimited AI Coach (including nutrition label photo feature)
- Advanced analytics and progress charts
- Premium training programs
- Saved meals, advanced food logging features
- Priority features

---

## Phase 8 — Analytics & Progress 📋

*(was Phase 7)*

- [ ] Workout volume chart (total weekly/monthly)
- [ ] Strength progress charts (per lift over time)
- [ ] Body composition tracking (weight over time)
- [ ] Running metrics (pace, distance, effort)
- [ ] Training consistency heatmap
- [ ] PRs timeline
- [ ] **Nutrition trends** — calorie and macro averages by week/month
- [ ] **Protein intake chart** — weekly protein vs. target
- [ ] Weekly/monthly summary report

---

## Phase 9 — External Integrations 💡

*(was Phase 8)*

- [ ] Apple Health / HealthKit (workouts + nutrition if available)
- [ ] Android Health Connect
- [ ] Apple Watch / watchOS companion
- [ ] Garmin Connect
- [ ] Strava
- [ ] Race event data / results import

**Architecture note:** All integration data normalizes to internal workout/activity schema.
External IDs tracked per-integration for deduplication.

---

## Phase 10 — Community 💡

*(was Phase 9)*

- [ ] Friends / training partners
- [ ] Challenges (public or group)
- [ ] Shared workout results
- [ ] Groups (e.g., local Spartan training group)
- [ ] Event participation tracking
- [ ] Leaderboards (opt-in)
- [ ] Activity feed (minimal, focused)

---

## Technical Debt & Infrastructure 📋

- [ ] End-to-end tests (Playwright)
- [ ] Unit tests for business logic (especially nutrition calculations)
- [ ] Error monitoring (Sentry)
- [ ] Rate limiting on API routes
- [ ] Proper logging / observability
- [ ] Admin dashboard (internal — user management, food library moderation, usage stats)
- [ ] CI/CD pipeline (GitHub Actions → Vercel)
- [ ] Feature flags for gradual rollout
- [ ] Performance monitoring
- [ ] Accessibility audit
- [ ] Full-text search for food library (evaluate: Postgres trigrams, pg_trgm extension, or Supabase search)

---

## Design Backlog 📋

- [ ] Dark mode polish pass
- [ ] Onboarding illustrations / empty states
- [ ] Achievement / badge system
- [ ] Confetti / celebration for PRs and goal completions
- [ ] Workout completion animation
- [ ] Nutrition dashboard widget for main dashboard
- [ ] Splash screen (mobile)
- [ ] Push notifications architecture
- [ ] Replace placeholder wordmark with final logo asset

---

## Architecture Reference

### Nutrition System

#### Historical Accuracy (snapshot pattern)

Food log entries store a **nutrition snapshot** at the time of logging. This guarantees that
historical logs always show the macros that were logged, even if the food item is later
corrected, updated, or deleted.

```
food_log_entries
  food_item_id                  → nullable reference to FoodItem (for traceability)
  snapshot_food_name            ← never changes
  snapshot_calories_per_serving ← never changes
  snapshot_protein_g_per_serving  ← never changes
  ... (all macro fields)
  serving_multiplier            × snapshot = actual consumed

Daily total query (pure SQL, never AI):
  SELECT SUM(snapshot_calories_per_serving * serving_multiplier) AS calories_total
  FROM food_log_entries
  WHERE user_id = $1 AND log_date = $2
```

If a food's recipe genuinely changes (e.g., a brand reformulation), create a new `food_items`
row — do not update the existing one. Historical logs reference the original.

#### External Provider Abstraction

```
lib/nutrition/providers/
  types.ts        ← FoodProvider interface, ExternalFoodResult, ExternalFoodDetail
  index.ts        ← FOOD_PROVIDERS registry, getProvider()
  usda.ts         ← UsdaFoodProvider (to be implemented in Phase 6)
  open-food-facts.ts  ← future
  ...

Search flow:
  1. Query food_items WHERE visibility IN ('verified','community') OR created_by_id = userId
  2. Fan out to FOOD_PROVIDERS in parallel
  3. Merge results, suppress known duplicates (duplicate_of_id)
  4. Return to client

Barcode lookup flow:
  1. SELECT * FROM food_items WHERE barcode = $1 LIMIT 1
  2. If not found → provider.searchByBarcode(barcode) for each provider
  3. If found externally → import to food_items (source_category = external_api)
  4. Return result or "not found"
```

#### Food Trust Lifecycle

```
User creates food → visibility: private_food (only creator sees it)
User opts in to share → community (all users can see; unverified)
Involved admin reviews → verified (trusted; shown prominently in search)

Visibility enforced by Supabase RLS:
  private_food → auth.uid() = created_by_id
  community    → authenticated users can SELECT; only creator can UPDATE
  verified     → anyone can SELECT; only service role can UPDATE
```

#### What uses AI vs. what doesn't

| Operation | AI? | Implementation |
|-----------|-----|----------------|
| Food search | No | DB query + FoodProvider.search() |
| Barcode lookup | No | DB index + FoodProvider.searchByBarcode() |
| Log a food | No | INSERT with snapshot values |
| Daily macro totals | No | SQL: SUM(snapshot_cal × multiplier) |
| Macro calculations | No | Arithmetic |
| Set nutrition targets | No | User input → DB INSERT |
| Recent/favorite foods | No | DB query on log history |
| Nutrition label photo | **Yes** | Claude Vision → draft → user confirms → save |
| AI Coach nutrition Q&A | **Yes** | Pre-built summary struct → Claude → response |
| Weekly nutrition narrative | **Yes** | Aggregated SQL data → Claude → prose |

AI is never used for routine data operations. Food tracking must work
fully if the AI service is unavailable.

#### Nutrition context for AI Coach

The server builds a structured summary before each AI call.
Raw food log data is never sent to the model.

```typescript
interface NutritionContext {
  today: {
    calories:  { consumed: number; target: number; remaining: number }
    proteinG:  { consumed: number; target: number; remaining: number }
    carbsG:    { consumed: number; target: number; remaining: number }
    fatG:      { consumed: number; target: number; remaining: number }
  }
  recentDaysAvg?: { calories: number; proteinG: number } // 7-day rolling
}
```

#### Barcode and nutrition label scanning — dependencies

**Backend (already designed):**
- `barcode` field in `food_items` with index
- `searchByBarcode()` in `FoodProvider` interface
- `/api/nutrition/barcode-lookup` route (Phase 6)
- `is_draft` flag + user-confirmation flow for AI-extracted data

**Frontend (deferred — mobile phase):**
- Native camera access: requires React Native or a native wrapper
- Web preview: browser MediaDevices API + ZXing-WASM or QuaggaJS
- No native implementation until mobile distribution is being built
- Backend is fully ready to receive barcode lookups from any client

**Nutrition label photo (deferred — Phase 6 late or Involved+):**
- Claude's vision capability (image input support confirmed in claude-sonnet-4-6)
- Endpoint: accepts image (base64 or Supabase Storage URL) → returns structured draft
- Requires user confirmation UI before any data is persisted
- Counts against the user's AI Coach usage meter

#### Privacy & RLS requirements

```
food_log_entries:   user can only read/write own rows
nutrition_targets:  user can only read/write own rows
food_favorites:     user can only read/write own rows
saved_meals:        user can only read/write own rows
food_items (private_food): only creator can read
food_items (community):    any authenticated user can read
food_items (verified):     any user (including unauthenticated on public pages) can read
```

Never include raw food log data in AI context. Summarize server-side first.

#### The Involved Food Library as a product asset

```
Start:    External API results (USDA, etc.) cached in food_items
Growth:   User-created foods (private) → community → verified
Long-term: Verified library + barcode mappings = competitive moat

Provenance is always preserved:
  source_category + source_provider + external_id + last_synced_at
  created_by_id + created_at + verified_at + verified_by_id

Historical log accuracy is always preserved:
  snapshot fields in food_log_entries never overwritten

When a product formula changes:
  → Create a new food_items row (do not update the old one)
  → Old logs reference the original record and remain accurate
  → New barcode lookup may need to return the new record
     (can be handled by updating the barcode on the old record
      and setting barcode on the new one — or by soft-retiring the old item)
```

---

## Notes

- **Native mobile app** — keep business logic in `lib/` and server actions/API routes to allow React Native extraction later.
- **Medical disclaimer** — The platform provides fitness guidance only. Never diagnose injuries, diseases, or prescribe medical treatment.
- **Nutrition scope** — Nutrition is a first-class pillar alongside Training. The schema and provider abstraction are production-ready from Phase 1. UI implementation is Phase 6.
