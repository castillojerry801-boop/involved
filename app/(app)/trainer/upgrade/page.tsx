'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Check, Users, Loader2, X } from 'lucide-react'
import { TRAINER_TIERS, type TrainerTierKey } from '@/lib/subscription/config'
import { cn } from '@/lib/utils'

const TIER_KEYS = Object.keys(TRAINER_TIERS) as TrainerTierKey[]

const TRAINER_HIGHLIGHTS = [
  'Client roster with adherence tracking',
  'Reusable program library — assign to any client',
  'Per-client targets, notes, and goal tracking',
  'V AI summaries and draft programming (trainer approval required)',
  'Invitation-based client relationships',
  'Client keeps their account and history if relationship ends',
]

export default function TrainerUpgradePage() {
  const [selected, setSelected] = useState<TrainerTierKey>('trainer_10')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [success, setSuccess]   = useState(false)

  async function handleSubscribe() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/trainer/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tierKey:                selected,
          externalSubscriptionId: `dev_${selected}_${Date.now()}`,
          externalPriceId:        `dev_price_${selected}`,
          billingSource:          'manual',
        }),
      })
      const data = await res.json() as { ok?: boolean; error?: string }
      if (!res.ok || !data.ok) {
        setError(data.error ?? 'Something went wrong.')
        return
      }
      setSuccess(true)
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <div className="inline-flex size-16 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/30 mb-6">
          <Check className="size-8 text-emerald-500" />
        </div>
        <h1 className="text-2xl font-black text-zinc-900 dark:text-white mb-3">
          Welcome to Involved Trainer
        </h1>
        <p className="text-zinc-500 mb-8">
          Your trainer account is active. Head to the dashboard to invite your first client.
        </p>
        <Link
          href="/trainer"
          className="inline-flex items-center gap-2 rounded-2xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 px-6 py-3 font-black hover:opacity-90 transition-opacity"
        >
          Go to Trainer Dashboard
        </Link>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:px-8">
      <div className="mb-8 flex items-center gap-3">
        <Link
          href="/trainer"
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
        >
          <ArrowLeft className="size-4 text-zinc-600 dark:text-zinc-400" />
        </Link>
        <div>
          <h1 className="text-xl font-black text-zinc-900 dark:text-white">Involved Trainer</h1>
          <p className="text-sm text-zinc-500">Choose a plan to get started</p>
        </div>
      </div>

      {/* Tier cards */}
      <div className="grid gap-4 sm:grid-cols-3 mb-8">
        {TIER_KEYS.map(key => {
          const tier = TRAINER_TIERS[key]
          const active = selected === key
          return (
            <button
              key={key}
              onClick={() => setSelected(key)}
              className={cn(
                'rounded-2xl border-2 p-5 text-left transition-all',
                active
                  ? 'border-zinc-900 dark:border-white bg-white dark:bg-zinc-900 shadow-md'
                  : 'border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900/50 hover:border-zinc-400 dark:hover:border-zinc-500'
              )}
            >
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-bold text-zinc-900 dark:text-white">{tier.label}</span>
                {active && <Check className="size-4 text-emerald-500" />}
              </div>
              <div className="mb-1">
                <span className="text-2xl font-black text-zinc-900 dark:text-white">
                  ${tier.monthlyAmount}
                </span>
                <span className="text-xs text-zinc-500"> / mo</span>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                <Users className="size-3.5" />
                Up to {tier.maxClients} clients
              </div>
            </button>
          )
        })}
      </div>

      {/* Features */}
      <div className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 mb-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-4">
          Included with every Trainer plan
        </p>
        <ul className="space-y-2.5">
          {TRAINER_HIGHLIGHTS.map(item => (
            <li key={item} className="flex items-start gap-2.5 text-sm text-zinc-700 dark:text-zinc-300">
              <Check className="size-4 text-emerald-500 shrink-0 mt-0.5" />
              {item}
            </li>
          ))}
        </ul>
      </div>

      {/* CTA */}
      {error && (
        <div className="flex items-center gap-2 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/30 px-4 py-3 mb-4">
          <X className="size-4 text-red-500 shrink-0" />
          <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
        </div>
      )}
      <button
        onClick={handleSubscribe}
        disabled={loading}
        className="w-full flex items-center justify-center gap-2 rounded-2xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 py-4 font-black text-base hover:opacity-90 transition-opacity disabled:opacity-50"
      >
        {loading ? <Loader2 className="size-5 animate-spin" /> : <Users className="size-5" />}
        Subscribe — {TRAINER_TIERS[selected].label} ({TRAINER_TIERS[selected].maxClients} clients)
      </button>
      <p className="text-center text-xs text-zinc-400 mt-3">
        Billing integration in progress. This activates your trainer account immediately.
      </p>
    </div>
  )
}
