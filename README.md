# Involved

**Real habits. Real progress. A more involved you.**

A fitness and training platform for real people — whether you're beginning your fitness journey or training for your next Spartan Race.

---

## Stack

- **Next.js 16** (App Router)
- **React 19** + **TypeScript**
- **Tailwind CSS v4**
- **Supabase** (Auth + PostgreSQL)
- **Prisma** (type-safe DB access)

## Getting started

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.local.example .env.local
```

Fill in your Supabase project URL and keys from the [Supabase dashboard](https://supabase.com).

### 3. Set up the database

```bash
npx prisma db push
```

Then enable RLS in Supabase and generate types:

```bash
npx supabase gen types typescript --project-id YOUR_PROJECT_ID > lib/types/database.ts
```

### 4. Run development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Project structure

```
app/
  (marketing)/    # Public landing page
  (auth)/         # Login, signup
  (app)/          # Authenticated app (dashboard, training, coach, profile)
  api/            # Route handlers (auth callback, etc.)

components/
  ui/             # Design system primitives (Button, Card, Input, Badge)
  layout/         # App navigation
  logo.tsx        # Involved wordmark

lib/
  supabase/       # Browser + server Supabase clients
  types/          # Database types (generated)
  utils.ts        # cn() utility

prisma/
  schema.prisma   # Database schema

middleware.ts     # Session refresh + route protection
ROADMAP.md        # Development roadmap
```

## Development phases

See [ROADMAP.md](./ROADMAP.md) for the full development plan.

- **Phase 1** ✅ Foundation (current)
- **Phase 2** 📋 Training core
- **Phase 3** 📋 AI Coach
- **Phase 4** 📋 Goals & Events
- **Phase 5+** 📋 Profile, Subscriptions, Analytics, Integrations, Community
