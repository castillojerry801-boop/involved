'use client'

import { useState, useEffect, useMemo } from 'react'
import { AlertCircle, Info, Loader2 } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { cn } from '@/lib/utils'
import { useWeightUnit } from '@/lib/hooks/use-weight-unit'
import {
  calcWeightGoalTimeline,
  LOSS_RATE_OPTIONS_KG,
  GAIN_RATE_OPTIONS_KG,
  type WeightGoalDirection,
} from '@/lib/calculators/weight-goal'

const LBS_PER_KG = 2.20462

function fmtRateLabel(rateKg: number, unit: 'lbs' | 'kg'): string {
  if (unit === 'lbs') {
    const lbs = Math.round(rateKg * LBS_PER_KG * 10) / 10
    return `~${lbs} lb / week`
  }
  return `~${rateKg} kg / week`
}

function fmtWeightDisplay(kg: number, unit: 'lbs' | 'kg'): string {
  if (unit === 'lbs') return `${Math.round(kg * LBS_PER_KG * 10) / 10} lbs`
  return `${kg} kg`
}

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

function fmtProjectedDate(d: Date): string {
  // Local-time methods so projected date matches the user's calendar, not UTC.
  return `${MONTH_NAMES[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`
}

export default function WeightGoalPage() {
  const { unit, setUnit, toDisplay, fromInput } = useWeightUnit()

  const [profileLoading, setProfileLoading] = useState(true)
  const [hasProfileWeight, setHasProfileWeight] = useState(false)

  const [currentStr, setCurrentStr] = useState('')
  const [goalStr, setGoalStr]       = useState('')
  const [ageStr, setAgeStr]         = useState('')
  const [rateKg, setRateKg]         = useState(0.5)

  useEffect(() => {
    fetch('/api/profile')
      .then(r => r.json())
      .then(({ profile }: { profile: { weightKg?: number | null } }) => {
        const wkg = profile?.weightKg != null ? Number(profile.weightKg) : null
        if (wkg && wkg > 0) {
          setCurrentStr(toDisplay(wkg))
          setHasProfileWeight(true)
        }
      })
      .catch(() => {})
      .finally(() => setProfileLoading(false))
  // toDisplay changes when unit changes — intentionally re-run only on mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const currentKg = useMemo(() => fromInput(currentStr) ?? null, [currentStr, fromInput])
  const goalKg    = useMemo(() => fromInput(goalStr)    ?? null, [goalStr,    fromInput])

  const ageNum = useMemo(() => {
    const n = parseInt(ageStr, 10)
    return ageStr.trim() && Number.isInteger(n) && n > 0 ? n : null
  }, [ageStr])

  // Derive direction from inputs so the rate selector responds before results are shown
  const direction = useMemo<WeightGoalDirection | null>(() => {
    if (currentKg == null || goalKg == null) return null
    const diff = goalKg - currentKg
    if (diff < -0.05) return 'loss'
    if (diff > 0.05) return 'gain'
    return 'maintain'
  }, [currentKg, goalKg])

  // Gain rates are capped at 0.5 kg/week; loss rates allow up to 1.0 kg/week
  const rateOptions = direction === 'gain' ? GAIN_RATE_OPTIONS_KG : LOSS_RATE_OPTIONS_KG

  // Clamp the effective rate when direction switches to gain; restores on switch back to loss
  const effectiveRateKg = direction === 'gain' && rateKg > 0.5 ? 0.5 : rateKg

  const isMinor = ageNum != null && ageNum < 18

  const result = useMemo(() => {
    if (currentKg == null || goalKg == null || isMinor) return null
    return calcWeightGoalTimeline(currentKg, goalKg, effectiveRateKg)
  }, [currentKg, goalKg, effectiveRateKg, isMinor])

  const placeholder = unit === 'lbs' ? '165' : '75'

  function handleUnitSwitch(next: 'lbs' | 'kg') {
    if (next === unit) return
    if (currentKg != null) {
      setCurrentStr(
        next === 'lbs'
          ? String(Math.round(currentKg * LBS_PER_KG * 10) / 10)
          : String(currentKg)
      )
    }
    if (goalKg != null) {
      setGoalStr(
        next === 'lbs'
          ? String(Math.round(goalKg * LBS_PER_KG * 10) / 10)
          : String(goalKg)
      )
    }
    setUnit(next)
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-8 md:px-8">
      <PageHeader
        title="Weight-Goal Timeline"
        backHref="/calculators"
        subtitle="Illustrative estimate — actual results are nonlinear"
      />

      <div className="mt-6 space-y-4">

        {/* Unit toggle + weight inputs */}
        <div className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
              Weights
            </p>
            <div className="flex rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden text-[11px]">
              {(['lbs', 'kg'] as const).map(u => (
                <button
                  key={u}
                  type="button"
                  onClick={() => handleUnitSwitch(u)}
                  className={cn(
                    'px-2.5 py-1 transition-colors',
                    unit === u
                      ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 font-semibold'
                      : 'text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800'
                  )}
                >
                  {u}
                </button>
              ))}
            </div>
          </div>

          {profileLoading ? (
            <div className="flex items-center gap-2 py-4 justify-center">
              <Loader2 className="size-4 animate-spin text-zinc-400" />
              <span className="text-sm text-zinc-400">Loading profile…</span>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-zinc-400 mb-1.5">Current weight</p>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={currentStr}
                    onChange={e => setCurrentStr(e.target.value)}
                    placeholder={placeholder}
                    className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-3 text-lg font-bold text-center text-zinc-900 dark:text-white placeholder:text-zinc-300 dark:placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <p className="text-xs text-zinc-400 mb-1.5">Goal weight</p>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={goalStr}
                    onChange={e => setGoalStr(e.target.value)}
                    placeholder={placeholder}
                    className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-3 text-lg font-bold text-center text-zinc-900 dark:text-white placeholder:text-zinc-300 dark:placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>
              {hasProfileWeight && (
                <p className="text-xs text-zinc-400">
                  Current weight pre-populated from your profile. Changes here won't affect your profile.
                </p>
              )}
            </>
          )}
        </div>

        {/* Age input */}
        <div className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-3">
          <div>
            <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
              Age
            </p>
            <p className="text-xs text-zinc-400 mt-0.5">
              This calculator is for adults 18 and older. Not saved to your profile.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="number"
              inputMode="numeric"
              value={ageStr}
              onChange={e => setAgeStr(e.target.value)}
              placeholder="30"
              min={1}
              max={120}
              className="w-24 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-3 text-lg font-bold text-center text-zinc-900 dark:text-white placeholder:text-zinc-300 dark:placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500"
            />
            <p className="text-sm text-zinc-400">years old</p>
          </div>
        </div>

        {/* Rate selector */}
        <div className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-3">
          <div>
            <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
              Estimated weekly rate
            </p>
            <p className="text-xs text-zinc-400 mt-0.5">
              {direction === 'gain'
                ? 'For muscle gain, a slower rate helps minimise unwanted fat accumulation.'
                : 'A slower rate is generally more sustainable.'}
            </p>
          </div>
          <div className="space-y-1.5">
            {rateOptions.map(r => (
              <button
                key={r}
                onClick={() => setRateKg(r)}
                className={cn(
                  'w-full flex items-center gap-3 rounded-xl border px-4 py-2.5 text-left transition-all',
                  effectiveRateKg === r
                    ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/10'
                    : 'border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600'
                )}
              >
                <div className={cn(
                  'size-3.5 rounded-full border-2 shrink-0',
                  effectiveRateKg === r
                    ? 'border-emerald-500 bg-emerald-500'
                    : 'border-zinc-300 dark:border-zinc-600'
                )} />
                <p className={cn(
                  'text-sm font-medium',
                  effectiveRateKg === r ? 'text-emerald-700 dark:text-emerald-400' : 'text-zinc-700 dark:text-zinc-300'
                )}>
                  {fmtRateLabel(r, unit)}
                </p>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Results */}
      <div className="mt-6 space-y-4">

        {/* Under-18 block */}
        {isMinor && (
          <div className="rounded-2xl border border-amber-200 dark:border-amber-800/40 bg-amber-50 dark:bg-amber-900/10 px-5 py-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="size-5 text-amber-500 shrink-0 mt-0.5" />
              <p className="text-sm text-amber-700 dark:text-amber-400">
                This calculator is intended for adults 18 and older. For guidance on nutrition or healthy weight management for those under 18, please consult a healthcare provider or registered dietitian.
              </p>
            </div>
          </div>
        )}

        {/* Prompt */}
        {!isMinor && (currentKg == null || goalKg == null) && (
          <div className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-5 py-4 text-center">
            <p className="text-sm text-zinc-400">
              {currentKg == null
                ? 'Enter your current weight above to get started.'
                : 'Enter your goal weight to see the estimated timeline.'}
            </p>
          </div>
        )}

        {/* Error */}
        {!isMinor && result != null && !result.ok && (
          <div className="rounded-2xl border border-red-200 dark:border-red-800/40 bg-red-50 dark:bg-red-900/10 px-5 py-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="size-5 text-red-500 shrink-0 mt-0.5" />
              <p className="text-sm text-red-700 dark:text-red-400">{result.message}</p>
            </div>
          </div>
        )}

        {/* Already at goal */}
        {!isMinor && result?.ok && result.direction === 'maintain' && (
          <div className="rounded-2xl border border-emerald-200 dark:border-emerald-800/40 bg-emerald-50 dark:bg-emerald-900/10 px-5 py-4">
            <div className="flex items-start gap-3">
              <Info className="size-5 text-emerald-500 shrink-0 mt-0.5" />
              <p className="text-sm text-emerald-700 dark:text-emerald-400">
                Your current and goal weights are the same — you're already at your target.
              </p>
            </div>
          </div>
        )}

        {/* Timeline result */}
        {!isMinor && result?.ok && result.direction !== 'maintain' && (
          <>
            <div className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
              <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide mb-4">
                Estimated timeline
              </p>

              <div className="grid grid-cols-3 gap-3 mb-4">
                <div className="rounded-xl bg-zinc-50 dark:bg-zinc-800 px-3 py-3 text-center">
                  <p className="text-[10px] text-zinc-400 mb-1">
                    {result.direction === 'loss' ? 'To lose' : 'To gain'}
                  </p>
                  <p className="text-xl font-black text-zinc-900 dark:text-white leading-tight">
                    {fmtWeightDisplay(result.weightDiffKg, unit)}
                  </p>
                </div>

                <div className="rounded-xl bg-zinc-50 dark:bg-zinc-800 px-3 py-3 text-center">
                  <p className="text-[10px] text-zinc-400 mb-1">Weeks</p>
                  <p className="text-3xl font-black text-emerald-600 dark:text-emerald-400 leading-tight">
                    {result.weeks}
                  </p>
                </div>

                <div className="rounded-xl bg-zinc-50 dark:bg-zinc-800 px-3 py-3 text-center">
                  <p className="text-[10px] text-zinc-400 mb-1">Months</p>
                  <p className="text-xl font-black text-zinc-900 dark:text-white leading-tight">
                    {(result.weeks / 4.33).toFixed(1)}
                  </p>
                </div>
              </div>

              <div className="rounded-xl bg-zinc-50 dark:bg-zinc-800 px-4 py-3 flex items-center justify-between">
                <p className="text-xs text-zinc-400">Projected around</p>
                <p className="text-sm font-bold text-zinc-900 dark:text-white">
                  {fmtProjectedDate(result.projectedDate)}
                </p>
              </div>

              <p className="text-xs text-zinc-400 mt-3 leading-relaxed">
                At <strong className="text-zinc-500">{fmtRateLabel(effectiveRateKg, unit)}</strong> of change. Illustrative estimate only.
              </p>
            </div>

            {/* Disclaimers */}
            <div className="flex items-start gap-2.5 rounded-2xl border border-amber-100 dark:border-amber-900/30 bg-amber-50 dark:bg-amber-900/10 px-4 py-3">
              <AlertCircle className="size-4 text-amber-500 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-700 dark:text-amber-400 leading-relaxed">
                Weight change is nonlinear — weekly fluctuations, water retention, and adaptation all affect actual progress.
                This is a rough illustrative estimate, not a guarantee or recommendation.
                Selected rates are not universally appropriate for everyone.
                Not medical advice. Consult a healthcare provider before starting any weight-change program.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
