'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Sparkles, Loader2, X, Users, Clock } from 'lucide-react'
import { Capacitor } from '@capacitor/core'
import {
  PRICING, annualSavings, PLUS_HIGHLIGHTS,
  TRAINER_TIERS, TRAINER_HIGHLIGHTS, type TrainerTierKey,
} from '@/lib/subscription/config'
import type { Entitlement } from '@/lib/subscription/entitlements'
import type { PurchasesOffering } from '@revenuecat/purchases-capacitor'
import {
  initializePurchases, fetchOfferings, getPackageForPlan,
  purchasePackage as rcPurchasePackage,
  restorePurchases as rcRestorePurchases,
} from '@/lib/revenuecat/purchases'
import { createClient } from '@/lib/supabase/client'
// DIAGNOSTIC — remove next two imports after RC issue is identified
import { Purchases } from '@revenuecat/purchases-capacitor'
import { runRcDiagnostic } from '@/lib/revenuecat/diagnostic'

type Plan = 'monthly' | 'annual'

// DIAGNOSTIC — remove this constant after RC issue is identified
const RC_DIAGNOSTIC_EMAIL = 'castillojerry801@gmail.com'

function fmt(n: number) {
  return `${PRICING.currencySymbol}${n.toFixed(2)}`
}

const TRAINER_TIER_KEYS = Object.keys(TRAINER_TIERS) as TrainerTierKey[]

function RcSubscribeBlock({
  plan, rcOffering, purchasing, restoring, purchaseError, onPurchase, onRestore,
}: {
  plan: Plan
  rcOffering: PurchasesOffering | null
  purchasing: boolean
  restoring: boolean
  purchaseError: string | null
  onPurchase: () => void
  onRestore: () => void
}) {
  const activePackage = rcOffering ? getPackageForPlan(rcOffering, plan) : undefined
  const isNative = Capacitor.isNativePlatform()

  if (!isNative || !activePackage) {
    return (
      <>
        <button
          disabled
          className="w-full rounded-2xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 py-4 font-black text-base opacity-40"
        >
          Subscribe — coming soon
        </button>
        <p className="text-xs text-zinc-400 mt-3 text-center">
          In-app billing is being set up. You&apos;ll be notified when it&apos;s ready.
        </p>
      </>
    )
  }

  return (
    <>
      {purchaseError && (
        <div className="flex items-center gap-2 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/30 px-4 py-3 mb-3">
          <X className="size-4 text-red-500 shrink-0" />
          <p className="text-sm text-red-700 dark:text-red-400">{purchaseError}</p>
        </div>
      )}
      <button
        onClick={onPurchase}
        disabled={purchasing || restoring}
        className="w-full flex items-center justify-center gap-2 rounded-2xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 py-4 font-black text-base hover:opacity-90 transition-opacity disabled:opacity-50"
      >
        {purchasing
          ? <Loader2 className="size-5 animate-spin" />
          : <Sparkles className="size-5" />}
        {purchasing ? 'Processing…' : `Subscribe — ${activePackage.product.priceString}`}
      </button>
      <button
        onClick={onRestore}
        disabled={purchasing || restoring}
        className="w-full text-center text-xs text-zinc-400 mt-3 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors disabled:opacity-50"
      >
        {restoring ? 'Restoring…' : 'Restore purchases'}
      </button>
    </>
  )
}

export default function PlusPage() {
  const router = useRouter()
  const [plan, setPlan] = useState<Plan>('annual')
  const [entitlement, setEntitlement] = useState<Entitlement | null>(null)
  const [rcOffering, setRcOffering] = useState<PurchasesOffering | null>(null)
  const [purchasing, setPurchasing] = useState(false)
  const [purchaseError, setPurchaseError] = useState<string | null>(null)
  const [restoring, setRestoring] = useState(false)
  // DIAGNOSTIC — remove next line after RC issue is identified
  const [rcDiagnostic, setRcDiagnostic] = useState<string | null>(null)

  const savings = annualSavings()

  useEffect(() => {
    fetch('/api/subscription')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setEntitlement(data as Entitlement) })
      .catch(() => null)
    if (Capacitor.isNativePlatform()) {
      // React effects run bottom-up (child before parent), so this useEffect
      // fires before RevenueCatInit's useEffect in the layout configures the SDK.
      // Chaining init → fetchOfferings here ensures configure completes first.
      const supabase = createClient()
      supabase.auth.getUser()
        .then(({ data: { user } }) => user ? initializePurchases(user.id) : undefined)
        .then(() => fetchOfferings())
        .then(o => { if (o) setRcOffering(o) })
        .catch(() => null)
    }
  }, [])

  // DIAGNOSTIC — remove this entire useEffect after RC issue is identified
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    const supabase = createClient()
    runRcDiagnostic({
      getUser: async () => {
        const { data: { user } } = await supabase.auth.getUser()
        return user ? { id: user.id, email: user.email ?? null } : null
      },
      initialize: initializePurchases,
      getOfferings: () => Purchases.getOfferings(),
      testEmail: RC_DIAGNOSTIC_EMAIL,
    }).then(msg => { if (msg !== null) setRcDiagnostic(msg) }).catch(() => null)
  }, [])
  // END DIAGNOSTIC

  const handlePurchase = async () => {
    if (!rcOffering) return
    const pkg = getPackageForPlan(rcOffering, plan)
    if (!pkg) return
    setPurchasing(true)
    setPurchaseError(null)
    const result = await rcPurchasePackage(pkg)
    if (result.ok) {
      router.push('/today')
      return
    }
    if (!result.cancelled) {
      setPurchaseError(result.message)
    }
    setPurchasing(false)
  }

  const handleRestorePurchases = async () => {
    setRestoring(true)
    setPurchaseError(null)
    const result = await rcRestorePurchases()
    if (result.ok) {
      const data = await fetch('/api/subscription').then(r => r.ok ? r.json() : null).catch(() => null)
      if (data) setEntitlement(data as Entitlement)
      if (result.hadActiveSubscription) {
        router.push('/today')
        return
      }
    } else {
      setPurchaseError(result.message)
    }
    setRestoring(false)
  }

  const isTrainer   = entitlement?.isTrainer
  const alreadyPlus = entitlement?.isPlus && !isTrainer
  const isTrial     = entitlement?.isTrial

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

      {/* Current status banners */}
      {isTrainer && (
        <div className="mb-6 flex items-center gap-3 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800/30 px-4 py-3">
          <Check className="size-5 text-emerald-500 shrink-0" />
          <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300">
            You&apos;re on Involved Trainer. You have full Plus access and can manage clients.
          </p>
        </div>
      )}
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

      {/* Personal Plus plan section — hidden for existing Plus and Trainer subscribers */}
      {!alreadyPlus && !isTrainer && (
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

          {/* DIAGNOSTIC — remove this block after RC issue is identified */}
          {rcDiagnostic && Capacitor.isNativePlatform() && (
            <div className="mb-4 rounded-xl bg-zinc-100 dark:bg-zinc-800 px-4 py-3 font-mono text-xs text-zinc-500 break-all">
              {rcDiagnostic}
            </div>
          )}
          {/* END DIAGNOSTIC */}

          {/* Subscribe CTA — shown to all non-Plus non-Trainer users */}
          <div className="py-4">
            {isTrial && entitlement?.trialDaysRemaining !== null && (
              <p className="text-center text-sm text-zinc-500 mb-4">
                You&apos;re in your trial. Subscribe now to keep Involved+ after it ends.
              </p>
            )}
            <RcSubscribeBlock
              plan={plan}
              rcOffering={rcOffering}
              purchasing={purchasing}
              restoring={restoring}
              purchaseError={purchaseError}
              onPurchase={handlePurchase}
              onRestore={handleRestorePurchases}
            />
          </div>
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
            `${20} AI Coach messages / month`,
          ].map(item => (
            <li key={item} className="flex items-start gap-2 text-sm text-zinc-500 dark:text-zinc-400">
              <Check className="size-4 text-zinc-300 dark:text-zinc-600 shrink-0 mt-0.5" />
              {item}
            </li>
          ))}
        </ul>
      </div>

      {/* Trainer plans discovery — shown to all non-trainer users */}
      {!isTrainer && (
        <div className="mt-10">
          <div className="mb-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1">For coaches</p>
            <h2 className="text-xl font-black text-zinc-900 dark:text-white mb-2">Involved Trainer</h2>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Coach clients with AI tools, reusable program libraries, and per-client progress tracking.
              Includes everything in Involved+.
            </p>
          </div>

          {/* Tier cards */}
          <div className="grid gap-3 sm:grid-cols-3 mb-5">
            {TRAINER_TIER_KEYS.map(key => {
              const tier = TRAINER_TIERS[key]
              return (
                <div
                  key={key}
                  className="rounded-2xl border-2 border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900/50 p-4"
                >
                  <p className="text-sm font-bold text-zinc-900 dark:text-white mb-2">{tier.label}</p>
                  <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                    <Users className="size-3.5 shrink-0" />
                    Up to {tier.maxClients} clients
                  </div>
                </div>
              )
            })}
          </div>

          {/* Trainer features */}
          <div className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 mb-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-3">
              Included with every Trainer plan
            </p>
            <ul className="space-y-2">
              {TRAINER_HIGHLIGHTS.map(item => (
                <li key={item} className="flex items-start gap-2.5 text-sm text-zinc-700 dark:text-zinc-300">
                  <Check className="size-4 text-emerald-500 shrink-0 mt-0.5" />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          {/* Coming soon */}
          <div className="rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900/50 px-5 py-4 flex items-start gap-3">
            <Clock className="size-4 text-zinc-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-zinc-900 dark:text-white mb-0.5">
                Trainer plans coming soon
              </p>
              <p className="text-xs text-zinc-500">
                In-app purchases for Trainer plans are not available yet. Check back soon.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
