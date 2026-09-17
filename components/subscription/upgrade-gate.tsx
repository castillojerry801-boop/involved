'use client'

import Link from 'next/link'
import { Sparkles, Lock } from 'lucide-react'
import { PLUS_HIGHLIGHTS } from '@/lib/subscription/config'
import type { EffectiveTier, FeatureKey } from '@/lib/subscription/config'
import { hasFeatureAccess } from '@/lib/subscription/config'

interface UpgradeGateProps {
  tier: EffectiveTier
  feature: FeatureKey
  // Label shown on the gate (e.g. "Generate AI Workout")
  featureLabel: string
  children: React.ReactNode
}

/**
 * Wraps a premium feature. Shows the feature normally if the user has access,
 * or a non-intrusive upgrade prompt if they don't.
 */
export function UpgradeGate({ tier, feature, featureLabel, children }: UpgradeGateProps) {
  if (hasFeatureAccess(tier, feature)) return <>{children}</>

  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 overflow-hidden">
      <div className="px-6 py-8 text-center">
        <div className="mb-4 inline-flex size-14 items-center justify-center rounded-2xl bg-zinc-100 dark:bg-zinc-800">
          <Lock className="size-6 text-zinc-400" />
        </div>
        <p className="font-bold text-zinc-900 dark:text-white mb-1">{featureLabel}</p>
        <p className="text-sm text-zinc-500 mb-6 max-w-xs mx-auto">
          This feature is included with Involved+.
        </p>
        <Link
          href="/plus"
          className="inline-flex items-center gap-2 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 px-5 py-2.5 text-sm font-bold hover:opacity-90 transition-opacity"
        >
          <Sparkles className="size-4" />
          See Involved+
        </Link>
      </div>
    </div>
  )
}

/**
 * Inline upgrade nudge — a smaller, less intrusive prompt.
 * Suitable for placing near a button or input that requires Plus.
 */
export function UpgradeNudge({ featureLabel }: { featureLabel: string }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-800/30 dark:bg-amber-900/10 px-4 py-3">
      <Sparkles className="size-4 text-amber-500 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-amber-900 dark:text-amber-300">
          {featureLabel} is included with Involved+
        </p>
        <Link href="/plus" className="text-xs text-amber-700 dark:text-amber-400 hover:underline">
          View plans →
        </Link>
      </div>
    </div>
  )
}

/**
 * Banner shown inside feature pages for trial users showing days remaining.
 */
export function TrialBanner({ daysRemaining }: { daysRemaining: number }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 dark:border-emerald-800/30 dark:bg-emerald-900/10 px-4 py-3">
      <Sparkles className="size-4 text-emerald-500 shrink-0" />
      <p className="text-sm font-medium text-emerald-900 dark:text-emerald-300 flex-1">
        {daysRemaining === 1
          ? 'Your Involved+ trial ends tomorrow.'
          : `${daysRemaining} days left in your Involved+ trial.`}
      </p>
      <Link href="/plus" className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline whitespace-nowrap">
        Upgrade
      </Link>
    </div>
  )
}

export { PLUS_HIGHLIGHTS }
