'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Sparkles, Loader2, X } from 'lucide-react'
import { PRICING, TRIAL_DAYS, annualSavings, PLUS_HIGHLIGHTS } from '@/lib/subscription/config'
import type { Entitlement } from '@/lib/subscription/entitlements'

type Plan = 'monthly' | 'annual'

function fmt(n: number) {
  return `${PRICING.currencySymbol}${n.toFixed(2)}`
}

export default function PlusPage() {
  const router = useRouter()
  const [plan, setPlan] = useState<Plan>('annual')
  const [entitlement, setEntitlement] = useState<Entitlement | null>(null)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const savings = annualSavings()

  useEffect(() => {
    fetch('/api/subscription')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setEntitlement(data as Entitlement) })
      .catch(() => null)
  }, [])

  const handleStartTrial = async () => {
    setStarting(true)
    setError(null)
    try {
      const res = await fetch('/api/subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start_trial' }),
      })
      const data = await res.json() as { success?: boolean; error?: string }
      if (!res.ok || !data.success) {
        const msg =
          data.error === 'trial_already_used' ? 'You have already used your free trial.' :
          data.error === 'already_subscribed'  ? 'You already have an active subscription.' :
          'Something went wrong. Please try again.'
        setError(msg)
        return
      }
      // Reload entitlement and redirect to app
      router.push('/today')
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setStarting(false)
    }
  }

  const alreadyPlus = entitlement?.isPlus
  const isTrial     = entitlement?.isTrial
  const trialUsed   = entitlement !== null && !entitlement.isFree && !entitlement.isPlus && !entitlement.isTrial

  return (
    <div className="mx-auto max-w-lg px-4 py-10 md:py-16">

      {/* Header */}
      <div className="text-center mb-10">
        <div className="inline-flex items-center gap-2 mb-4 rounded-full bg-zinc-100 dark:bg-zinc-800 px-4 py-1.5 text-xs font-semibold text-zinc-600 dark:text-zinc-300">
          <Sparkles className="size-3.5" />
          Involved+
        </div>
        <h1 className="font-black text-3xl md:text-4xl text-zinc-900 dark:text-white mb-3 tracking-tight">
          Train smarter.<br />Track deeper.
        </h1>
        <p className="text-zinc-500 dark:text-zinc-400 max-w-sm mx-auto">
          Involved is free forever. Involved+ adds AI, personalization, and advanced insights for athletes who want more.
        </p>
      </div>

      {/* Current status banner */}
      {alreadyPlus && (
        <div className="mb-6 flex items-center gap-3 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800/30 px-4 py-3">
          <Check className="size-5 text-emerald-500 shrink-0" />
          <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300">
            You&apos;re on Involved+. Thanks for subscribing!
          </p>
        </div>
      )}
      {isTrial && entitlement.trialDaysRemaining !== null && (
        <div className="mb-6 flex items-center gap-3 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800/30 px-4 py-3">
          <Sparkles className="size-5 text-emerald-500 shrink-0" />
          <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300">
            You&apos;re in your free trial — {entitlement.trialDaysRemaining} {entitlement.trialDaysRemaining === 1 ? 'day' : 'days'} remaining.
          </p>
        </div>
      )}

      {/* Plan selector */}
      {!alreadyPlus && (
        <>
          <div className="flex rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 p-1 mb-4">
            <button
              onClick={() => setPlan('annual')}
              className={`flex-1 rounded-xl py-2.5 text-sm font-semibold transition-all ${
                plan === 'annual'
                  ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-sm'
                  : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300'
              }`}
            >
              Annual
              <span className="ml-1.5 rounded-full bg-emerald-100 dark:bg-emerald-900/40 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-400">
                Save {savings.savingsPct}%
              </span>
            </button>
            <button
              onClick={() => setPlan('monthly')}
              className={`flex-1 rounded-xl py-2.5 text-sm font-semibold transition-all ${
                plan === 'monthly'
                  ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-sm'
                  : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300'
              }`}
            >
              Monthly
            </button>
          </div>

          {/* Pricing card */}
          <div className="rounded-2xl border-2 border-zinc-900 dark:border-white bg-white dark:bg-zinc-900 overflow-hidden mb-6">
            <div className="px-6 py-6 border-b border-zinc-100 dark:border-zinc-800">
              {plan === 'annual' ? (
                <div>
                  <div className="flex items-baseline gap-2 mb-1">
                    <span className="font-black text-4xl text-zinc-900 dark:text-white">
                      {fmt(savings.effectiveMonthly)}
                    </span>
                    <span className="text-zinc-500 text-sm">/ month</span>
                  </div>
                  <p className="text-sm text-zinc-500">
                    Billed annually at {fmt(PRICING.annual.amount)} / year
                  </p>
                  <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium mt-1">
                    Save {fmt(savings.saved)} compared to monthly billing
                  </p>
                </div>
              ) : (
                <div>
                  <div className="flex items-baseline gap-2 mb-1">
                    <span className="font-black text-4xl text-zinc-900 dark:text-white">
                      {fmt(PRICING.monthly.amount)}
                    </span>
                    <span className="text-zinc-500 text-sm">/ month</span>
                  </div>
                  <p className="text-sm text-zinc-500">Billed monthly, cancel anytime</p>
                </div>
              )}
            </div>

            {/* Features list */}
            <div className="px-6 py-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-3">
                Included with Involved+
              </p>
              <ul className="space-y-2.5">
                {PLUS_HIGHLIGHTS.map((item) => (
                  <li key={item} className="flex items-start gap-2.5 text-sm text-zinc-700 dark:text-zinc-300">
                    <Check className="size-4 text-emerald-500 shrink-0 mt-0.5" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Trial CTA */}
          {!trialUsed && !isTrial && (
            <div className="space-y-3">
              {error && (
                <div className="flex items-center gap-2 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/30 px-4 py-3">
                  <X className="size-4 text-red-500 shrink-0" />
                  <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
                </div>
              )}
              <button
                onClick={handleStartTrial}
                disabled={starting}
                className="w-full flex items-center justify-center gap-2 rounded-2xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 py-4 font-black text-base hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {starting ? (
                  <Loader2 className="size-5 animate-spin" />
                ) : (
                  <Sparkles className="size-5" />
                )}
                Start {TRIAL_DAYS}-Day Free Trial
              </button>
              <p className="text-center text-xs text-zinc-400">
                No credit card required. After {TRIAL_DAYS} days, choose a plan or stay on the free tier.
              </p>
            </div>
          )}

          {isTrial && (
            <div className="text-center py-4">
              <p className="text-sm text-zinc-500 mb-4">
                You&apos;re already in your trial. Subscribe to keep Involved+ after it ends.
              </p>
              <button
                disabled
                className="w-full rounded-2xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 py-4 font-black text-base opacity-40"
              >
                Subscribe — coming soon
              </button>
              <p className="text-xs text-zinc-400 mt-3">
                In-app billing is being set up. You&apos;ll be notified when it&apos;s ready.
              </p>
            </div>
          )}

          {trialUsed && (
            <div className="text-center py-4">
              <button
                disabled
                className="w-full rounded-2xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 py-4 font-black text-base opacity-40"
              >
                Subscribe — coming soon
              </button>
              <p className="text-xs text-zinc-400 mt-3">
                In-app billing is being set up. You&apos;ll be notified when it&apos;s ready.
              </p>
            </div>
          )}
        </>
      )}

      {/* Free tier comparison */}
      <div className="mt-10 rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 p-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-4">
          Free tier — always available
        </p>
        <ul className="space-y-2">
          {[
            'Food logging & calorie tracking',
            'Macro and nutrition targets',
            'Workout logging',
            'Full exercise library',
            'Exercise GIF demonstrations',
            'Basic progress tracking',
            'Goals',
            'Recent foods & favorites',
            'Saved meals',
            `${25} AI Coach messages / month`,
          ].map(item => (
            <li key={item} className="flex items-start gap-2 text-sm text-zinc-500 dark:text-zinc-400">
              <Check className="size-4 text-zinc-300 dark:text-zinc-600 shrink-0 mt-0.5" />
              {item}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
