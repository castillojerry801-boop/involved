import Link from 'next/link'
import { ArrowRight, Dumbbell, Target, Bot, TrendingUp, Users, Zap } from 'lucide-react'
import { InvolvedLogo } from '@/components/logo'
import { Button } from '@/components/ui/button'

const features = [
  {
    icon: Dumbbell,
    title: 'Smart Training',
    description: 'Structured programs for strength, conditioning, running, and obstacle racing. Built around your goals, not someone else\'s.',
  },
  {
    icon: Bot,
    title: 'AI Fitness Coach',
    description: 'Get personalized guidance, workout adjustments, and answers to your training questions — available whenever you need it.',
  },
  {
    icon: Target,
    title: 'Goal-Driven',
    description: 'Training that organizes itself around your next race, lifting milestone, or fitness goal. Know exactly where you\'re headed.',
  },
  {
    icon: TrendingUp,
    title: 'Real Progress Tracking',
    description: 'Log workouts, track PRs, see your fitness trend over time. Progress you can actually measure and be proud of.',
  },
]

const forWhom = [
  'First-time gym-goers building a habit',
  'Spartan & obstacle-course racers',
  'Runners chasing new PRs',
  'Strength athletes pushing limits',
  'Hyrox competitors',
  'Anyone ready to be more active',
]

export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col bg-white dark:bg-zinc-950">
      {/* Nav */}
      <header className="sticky top-0 z-50 border-b border-zinc-100 bg-white/95 backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-950/95">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <InvolvedLogo size="sm" />
          <div className="flex items-center gap-3">
            <Link href="/login">
              <Button variant="ghost" size="sm">Sign in</Button>
            </Link>
            <Link href="/signup">
              <Button size="sm">Get started</Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden bg-zinc-950 px-6 pb-24 pt-20 text-white md:pb-32 md:pt-28">
          {/* Background texture */}
          <div
            aria-hidden="true"
            className="absolute inset-0 opacity-[0.03] [background-image:repeating-linear-gradient(0deg,transparent,transparent_40px,white_40px,white_41px),repeating-linear-gradient(90deg,transparent,transparent_40px,white_40px,white_41px)]"
          />

          <div className="relative mx-auto max-w-4xl text-center">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-zinc-700 bg-zinc-900 px-4 py-1.5 text-xs font-medium text-zinc-300">
              <Zap className="size-3 fill-emerald-400 text-emerald-400" />
              Now in early access
            </div>

            <h1 className="mb-6 font-black text-5xl leading-[1.05] tracking-tight md:text-7xl">
              Real habits.{' '}
              <br className="hidden md:block" />
              Real progress.
            </h1>

            <p className="mx-auto mb-10 max-w-xl text-lg text-zinc-400 md:text-xl">
              The fitness platform built for real people. Whether you&apos;re just starting or training for your next Spartan — Involved meets you where you are.
            </p>

            <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
              <Link href="/signup">
                <Button
                  size="lg"
                  className="w-full bg-white text-zinc-900 hover:bg-zinc-100 sm:w-auto"
                >
                  Start for free
                  <ArrowRight className="size-4" />
                </Button>
              </Link>
              <Link href="/login">
                <Button
                  variant="ghost"
                  size="lg"
                  className="w-full text-zinc-300 hover:bg-zinc-800 hover:text-white sm:w-auto"
                >
                  Sign in
                </Button>
              </Link>
            </div>

            <p className="mt-6 text-sm text-zinc-500">Free to start. No credit card required.</p>
          </div>
        </section>

        {/* For whom */}
        <section className="border-b border-zinc-100 bg-zinc-50 px-6 py-16 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mx-auto max-w-4xl">
            <p className="mb-8 text-center text-sm font-semibold uppercase tracking-widest text-zinc-500">
              Built for every kind of athlete
            </p>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              {forWhom.map((item) => (
                <div
                  key={item}
                  className="flex items-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-medium text-zinc-700 shadow-sm dark:bg-zinc-800 dark:text-zinc-300"
                >
                  <div className="size-1.5 shrink-0 rounded-full bg-emerald-500" />
                  {item}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Features */}
        <section className="px-6 py-20">
          <div className="mx-auto max-w-5xl">
            <div className="mb-14 text-center">
              <h2 className="mb-4 font-black text-3xl tracking-tight text-zinc-900 dark:text-white md:text-4xl">
                Everything you need to get involved
              </h2>
              <p className="mx-auto max-w-lg text-zinc-500">
                A complete fitness platform designed around your goals — not vanity metrics.
              </p>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
              {features.map(({ icon: Icon, title, description }) => (
                <div
                  key={title}
                  className="group rounded-2xl border border-zinc-100 bg-white p-8 shadow-sm transition-shadow hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900"
                >
                  <div className="mb-4 inline-flex size-12 items-center justify-center rounded-xl bg-zinc-950 text-white dark:bg-white dark:text-zinc-900">
                    <Icon className="size-6" />
                  </div>
                  <h3 className="mb-2 font-bold text-lg text-zinc-900 dark:text-white">{title}</h3>
                  <p className="text-zinc-500 dark:text-zinc-400">{description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Community callout */}
        <section className="px-6 py-16 border-t border-zinc-100 dark:border-zinc-800">
          <div className="mx-auto max-w-3xl text-center">
            <div className="mb-4 inline-flex size-14 items-center justify-center rounded-2xl bg-zinc-100 dark:bg-zinc-800">
              <Users className="size-7 text-zinc-600 dark:text-zinc-400" />
            </div>
            <h2 className="mb-3 font-black text-2xl text-zinc-900 dark:text-white">Community — coming soon</h2>
            <p className="text-zinc-500">
              Challenges, training partners, event groups, and shared accomplishments. The social layer is on the roadmap — built right.
            </p>
          </div>
        </section>

        {/* CTA */}
        <section className="bg-zinc-950 px-6 py-20 text-white">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="mb-4 font-black text-3xl tracking-tight md:text-5xl">
              A more involved you starts today.
            </h2>
            <p className="mb-10 text-zinc-400">
              Free to start. Every feature you need to build real, lasting fitness habits.
            </p>
            <Link href="/signup">
              <Button
                size="lg"
                className="bg-white text-zinc-900 hover:bg-zinc-100"
              >
                Get started — it&apos;s free
                <ArrowRight className="size-4" />
              </Button>
            </Link>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-zinc-100 bg-white px-6 py-8 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 text-sm text-zinc-400 sm:flex-row">
          <InvolvedLogo size="sm" scheme="dark" />
          <p>© 2026 Involved. All rights reserved.</p>
        </div>
      </footer>
    </div>
  )
}
