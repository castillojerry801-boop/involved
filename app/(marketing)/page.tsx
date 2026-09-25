import Link from 'next/link'
import Image from 'next/image'
import { ArrowRight, Dumbbell, Target, TrendingUp, Users, Zap, PersonStanding, Trophy, Activity } from 'lucide-react'
import { InvolvedLogo } from '@/components/logo'
import { Button } from '@/components/ui/button'

const features = [
  {
    icon: Dumbbell,
    title: 'Smart Training',
    description: 'Structured programs for strength, conditioning, and sport-specific training. Built around your goals, not someone else\'s.',
    color: 'from-emerald-500/20 to-emerald-600/10',
    iconColor: 'text-emerald-400',
  },
  {
    icon: null,
    title: 'AI Fitness Coach',
    description: 'Get personalized guidance, workout adjustments, and answers to your training questions — available whenever you need it.',
    color: 'from-sky-500/20 to-sky-600/10',
    iconColor: 'text-sky-400',
  },
  {
    icon: Target,
    title: 'Goal-Driven',
    description: 'Training that organizes itself around your next race, lifting milestone, or fitness goal. Know exactly where you\'re headed.',
    color: 'from-violet-500/20 to-violet-600/10',
    iconColor: 'text-violet-400',
  },
  {
    icon: TrendingUp,
    title: 'Real Progress Tracking',
    description: 'Log workouts, track PRs, see your fitness trend over time. Progress you can actually measure and be proud of.',
    color: 'from-amber-500/20 to-amber-600/10',
    iconColor: 'text-amber-400',
  },
]

const forWhom = [
  { icon: PersonStanding, title: 'First-time gym-goers', sub: 'Building healthy habits' },
  { icon: Activity,       title: 'Runners & endurance athletes', sub: 'Chasing new distances and PRs' },
  { icon: Users,          title: 'Team sports athletes', sub: 'Stronger for your team' },
  { icon: Dumbbell,       title: 'Strength & bodybuilders', sub: 'Getting stronger, every day' },
  { icon: Trophy,         title: 'Individual sport athletes', sub: 'Competing and improving' },
  { icon: Zap,            title: 'Weekend warriors', sub: 'A healthier, more active you' },
]

export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col">
      {/* Nav */}
      <header className="sticky top-0 z-50 border-b border-zinc-200/40 bg-white/70 backdrop-blur-md dark:border-zinc-700/40 dark:bg-zinc-950/70">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <InvolvedLogo size="sm" variant="wordmark" />
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
        <section className="relative overflow-hidden px-6 pb-24 pt-16 text-white md:pb-32 md:pt-24">

          {/* Emerald glow behind headline */}
          <div className="pointer-events-none absolute left-1/2 top-1/3 -translate-x-1/2 -translate-y-1/2 h-64 w-64 rounded-full bg-emerald-500/20 blur-3xl md:h-96 md:w-96" />

          <div className="relative mx-auto max-w-4xl text-center">
            <div className="mb-5 flex justify-center">
              <InvolvedLogo size="lg" variant="wordmark" className="rounded-2xl" />
            </div>

            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-4 py-1.5 text-xs font-semibold text-emerald-400">
              <Zap className="size-3 fill-emerald-400 text-emerald-400" />
              Now in early access
            </div>

            <h1 className="mb-5 font-black text-4xl leading-[1.08] tracking-tight md:text-6xl">
              Build habits for{' '}
              <br />
              <span className="text-emerald-400">real progress.</span>
            </h1>

            <p className="mx-auto mb-10 max-w-lg text-base text-zinc-400 md:text-lg">
              The fitness platform built for real people. Whether you&apos;re just starting out or training for your next season — Involved meets you where you are.
            </p>

            <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
              <Link href="/signup">
                <Button
                  size="lg"
                  className="w-full bg-emerald-500 text-white hover:bg-emerald-400 sm:w-auto"
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

            <p className="mt-5 text-sm text-zinc-500">Free to start. No credit card required.</p>
          </div>
        </section>

        {/* For whom */}
        <section className="bg-zinc-950 px-6 py-16">
          <div className="mx-auto max-w-5xl">
            <div className="mb-3 text-center">
              <h2 className="font-black text-3xl tracking-tight text-white md:text-4xl">
                Built for{' '}
                <span className="text-emerald-400">real people</span>
              </h2>
            </div>
            <p className="mb-2 text-center text-xs font-semibold uppercase tracking-widest text-zinc-500">
              Real goals. Real progress. No matter where you start.
            </p>
            <div className="mb-10 mx-auto w-12 border-b-2 border-emerald-500" />

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
              {forWhom.map(({ icon: Icon, title, sub }) => (
                <div
                  key={title}
                  className="flex items-center gap-4 rounded-2xl border border-zinc-800 bg-zinc-900 px-5 py-4 transition-colors hover:border-emerald-500/40 hover:bg-zinc-800/60"
                >
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15">
                    <Icon className="size-5 text-emerald-400" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-white">{title}</p>
                    <p className="text-xs text-zinc-400">{sub}</p>
                  </div>
                </div>
              ))}
            </div>

            <p className="mt-10 text-center text-xs font-semibold uppercase tracking-widest text-zinc-600">
              Fitness supports a better life
            </p>
          </div>
        </section>

        {/* Features */}
        <section className="bg-white/10 px-6 py-20 backdrop-blur-sm dark:bg-zinc-950/20">
          <div className="mx-auto max-w-5xl">
            <div className="mb-14 text-center">
              <h2 className="mb-4 font-black text-3xl tracking-tight text-zinc-900 dark:text-white md:text-4xl">
                Everything you need to get{' '}
                <span className="text-emerald-500">involved</span>
              </h2>
              <p className="mx-auto max-w-lg text-zinc-500">
                A complete fitness platform designed around your goals — not vanity metrics.
              </p>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
              {features.map(({ icon: Icon, title, description, color, iconColor }: { icon: React.ElementType | null; title: string; description: string; color: string; iconColor: string }) => (
                <div
                  key={title}
                  className="group rounded-2xl border border-zinc-200/40 bg-white/60 p-8 shadow-sm backdrop-blur-sm transition-shadow hover:shadow-md dark:border-zinc-700/40 dark:bg-zinc-900/60"
                >
                  <div className={`mb-4 inline-flex size-12 items-center justify-center rounded-xl bg-gradient-to-br ${color} overflow-hidden`}>
                    {Icon
                      ? <Icon className={`size-6 ${iconColor}`} />
                      : <Image src="/icon.jpg" alt="AI Coach" width={48} height={48} className="size-12 object-cover" />
                    }
                  </div>
                  <h3 className="mb-2 font-bold text-lg text-zinc-900 dark:text-white">{title}</h3>
                  <p className="text-zinc-500 dark:text-zinc-400">{description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Community callout */}
        <section className="border-t border-zinc-200/30 bg-white/10 px-6 py-16 backdrop-blur-sm dark:border-zinc-700/30 dark:bg-zinc-950/20">
          <div className="mx-auto max-w-3xl text-center">
            <div className="mb-4 inline-flex size-14 items-center justify-center rounded-2xl bg-emerald-500/15">
              <Users className="size-7 text-emerald-400" />
            </div>
            <h2 className="mb-3 font-black text-2xl text-zinc-900 dark:text-white">Community — coming soon</h2>
            <p className="text-zinc-500">
              Challenges, training partners, event groups, and shared accomplishments. The social layer is on the roadmap — built right.
            </p>
          </div>
        </section>

        {/* CTA */}
        <section className="relative overflow-hidden bg-zinc-950 px-6 py-20 text-white">
          <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-64 w-96 rounded-full bg-emerald-500/15 blur-3xl" />
          <div className="relative mx-auto max-w-2xl text-center">
            <h2 className="mb-4 font-black text-3xl tracking-tight md:text-5xl">
              A more <span className="text-emerald-400">involved</span> you starts today.
            </h2>
            <p className="mb-10 text-zinc-400">
              Free to start. Every feature you need to build real, lasting fitness habits.
            </p>
            <Link href="/signup">
              <Button
                size="lg"
                className="bg-emerald-500 text-white hover:bg-emerald-400"
              >
                Get started — it&apos;s free
                <ArrowRight className="size-4" />
              </Button>
            </Link>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-zinc-200/30 bg-white/70 px-6 py-8 backdrop-blur-md dark:border-zinc-700/30 dark:bg-zinc-950/70">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 text-sm text-zinc-400 sm:flex-row">
          <InvolvedLogo size="sm" variant="wordmark" />
          <div className="flex items-center gap-5">
            <Link href="/privacy" className="hover:text-zinc-900 dark:hover:text-white transition-colors">Privacy</Link>
            <Link href="/terms" className="hover:text-zinc-900 dark:hover:text-white transition-colors">Terms</Link>
            <Link href="/support" className="hover:text-zinc-900 dark:hover:text-white transition-colors">Support</Link>
          </div>
          <p>© 2026 GameFloHQ LLC. All rights reserved.</p>
        </div>
      </footer>
    </div>
  )
}
