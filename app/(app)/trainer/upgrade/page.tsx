'use client'

import Link from 'next/link'
import { ArrowLeft, Check, Users, Clock } from 'lucide-react'
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

      {/* Tier cards — display only, no selection interaction */}
      <div className="grid gap-4 sm:grid-cols-3 mb-8">
        {TIER_KEYS.map(key => {
          const tier = TRAINER_TIERS[key]
          return (
            <div
              key={key}
              className={cn(
                'rounded-2xl border-2 p-5 text-left',
                'border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900/50',
              )}
            >
              <div className="mb-3">
                <span className="text-sm font-bold text-zinc-900 dark:text-white">{tier.label}</span>
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
            </div>
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

      {/* Pending billing state — replaces the purchase button */}
      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900/50 px-6 py-5 flex items-start gap-4">
        <Clock className="size-5 text-zinc-400 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-zinc-900 dark:text-white mb-1">
            Trainer subscriptions coming soon
          </p>
          <p className="text-sm text-zinc-500">
            In-app purchases for Trainer plans are not available yet. Pricing and plan details are shown above for reference. Check back soon.
          </p>
        </div>
      </div>
    </div>
  )
}
