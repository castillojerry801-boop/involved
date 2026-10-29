'use client'

import { useState, useMemo, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { useRouter } from 'next/navigation'
import { Loader2, AlertCircle } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { ApplyTargetDialog } from '@/components/nutrition/apply-target-dialog'
import { cn } from '@/lib/utils'
import {
  macrosFromSplit,
  macroCalorieConsistency,
  validateMacroSplit,
  MACRO_GOAL_LABELS,
  MACRO_SPLITS,
  type MacroGoal,
} from '@/lib/calculators/macros'
import {
  buildMacroPayload,
  FALLBACK_TARGET,
  type FullNutritionTarget,
} from '@/lib/calculators/apply-targets'

const MACRO_GOALS: MacroGoal[] = ['weight_loss', 'maintenance', 'muscle_gain', 'endurance']

type ApplyPhase =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'confirm'; existing: FullNutritionTarget; proposed: FullNutritionTarget; existingId: string | null; isFirstTarget: boolean }

function MacrosContent() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [caloriesStr, setCaloriesStr] = useState(searchParams.get('calories') ?? '')
  const [selectedGoal, setSelectedGoal] = useState<MacroGoal>('maintenance')
  const [proteinPct, setProteinPct] = useState(MACRO_SPLITS.maintenance.proteinPct)
  const [fatPct, setFatPct] = useState(MACRO_SPLITS.maintenance.fatPct)
  const [carbPct, setCarbPct] = useState(MACRO_SPLITS.maintenance.carbPct)

  const [applyPhase, setApplyPhase] = useState<ApplyPhase>({ phase: 'idle' })
  const [applyError, setApplyError] = useState<string | null>(null)

  // When URL param changes (e.g. navigating from TDEE), update calorie input
  useEffect(() => {
    const fromUrl = searchParams.get('calories')
    if (fromUrl) setCaloriesStr(fromUrl)
  }, [searchParams])

  const calories = useMemo(() => {
    const n = parseInt(caloriesStr, 10)
    return Number.isInteger(n) && n > 0 ? n : null
  }, [caloriesStr])

  const splitTotal = proteinPct + fatPct + carbPct
  const splitValid = validateMacroSplit(proteinPct, fatPct, carbPct)

  const macroResult = useMemo(() => {
    if (!calories || !splitValid) return null
    return macrosFromSplit(calories, proteinPct, fatPct, carbPct)
  }, [calories, splitValid, proteinPct, fatPct, carbPct, macrosFromSplit])

  const consistency = useMemo(() => {
    if (!macroResult?.ok) return null
    return macroCalorieConsistency(macroResult.targets)
  }, [macroResult])

  function applyPreset(goal: MacroGoal) {
    setSelectedGoal(goal)
    const s = MACRO_SPLITS[goal]
    setProteinPct(s.proteinPct)
    setFatPct(s.fatPct)
    setCarbPct(s.carbPct)
  }

  function handlePctInput(
    field: 'protein' | 'fat' | 'carb',
    raw: string,
  ) {
    const val = Math.min(100, Math.max(0, parseInt(raw) || 0))
    if (field === 'protein') setProteinPct(val)
    else if (field === 'fat') setFatPct(val)
    else setCarbPct(val)
  }

  async function startApplyMacros() {
    if (!macroResult?.ok) return
    setApplyError(null)
    setApplyPhase({ phase: 'loading' })
    try {
      const res = await fetch('/api/nutrition/targets')
      if (!res.ok) {
        setApplyPhase({ phase: 'idle' })
        setApplyError('Unable to load current goals. Please try again.')
        return
      }
      const { target } = await res.json() as { target: (FullNutritionTarget & { id: string }) | null }
      const existing = target ?? FALLBACK_TARGET
      setApplyPhase({
        phase: 'confirm',
        existing,
        proposed: buildMacroPayload(existing, macroResult.targets),
        existingId: target?.id ?? null,
        isFirstTarget: target === null,
      })
    } catch {
      setApplyPhase({ phase: 'idle' })
      setApplyError('Unable to load current goals. Please check your connection.')
    }
  }

  async function handleApplyConfirm(): Promise<{ ok: boolean; error?: string }> {
    if (applyPhase.phase !== 'confirm') return { ok: false, error: 'Invalid state.' }
    const { proposed, existingId } = applyPhase
    // Always include existingTargetId so the server stale check runs.
    // null = first-time user (expect no current record); string = existing record ID.
    const payload = { ...proposed, existingTargetId: existingId }
    try {
      const res = await fetch('/api/nutrition/targets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string }
        return { ok: false, error: data.error ?? 'Failed to save goals.' }
      }
      router.refresh()
      return { ok: true }
    } catch {
      return { ok: false, error: 'Network error. Please try again.' }
    }
  }

  const pctInputClass =
    'w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2.5 text-lg font-bold text-center text-zinc-900 dark:text-white focus:outline-none focus:border-emerald-500'

  return (
    <div className="mx-auto max-w-lg px-4 py-8 md:px-8">
      <PageHeader
        title="Macro Goals"
        backHref="/calculators"
        subtitle="Estimates based on 4/4/9 kcal per gram"
      />

      <div className="mt-6 space-y-4">

        {/* Calorie target */}
        <div className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
          <label className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide block mb-2">
            Daily calorie target (kcal)
          </label>
          <input
            type="number"
            inputMode="numeric"
            value={caloriesStr}
            onChange={e => setCaloriesStr(e.target.value)}
            placeholder="2000"
            min={400}
            max={15000}
            className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-4 py-3 text-lg font-bold text-center text-zinc-900 dark:text-white placeholder:text-zinc-300 dark:placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500"
          />
          {calories != null && (calories < 400 || calories > 15000) && (
            <p className="text-xs text-red-500 mt-1.5">
              {calories < 400 ? 'Minimum is 400 kcal.' : 'Maximum is 15 000 kcal.'}
            </p>
          )}
        </div>

        {/* Goal presets */}
        <div className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-3">
          <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
            Goal preset
          </p>
          <div className="grid grid-cols-2 gap-2">
            {MACRO_GOALS.map(goal => {
              const s = MACRO_SPLITS[goal]
              const active =
                selectedGoal === goal &&
                proteinPct === s.proteinPct &&
                fatPct === s.fatPct &&
                carbPct === s.carbPct
              return (
                <button
                  key={goal}
                  onClick={() => applyPreset(goal)}
                  className={cn(
                    'rounded-xl border px-3 py-2.5 text-left transition-all',
                    active
                      ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/10'
                      : 'border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600'
                  )}
                >
                  <p className={cn(
                    'text-sm font-semibold leading-tight',
                    active ? 'text-emerald-700 dark:text-emerald-400' : 'text-zinc-800 dark:text-zinc-200'
                  )}>
                    {MACRO_GOAL_LABELS[goal]}
                  </p>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    {s.proteinPct}P / {s.fatPct}F / {s.carbPct}C
                  </p>
                </button>
              )
            })}
          </div>
          <p className="text-xs text-zinc-400">
            Presets are starting points — adjust the splits below.
          </p>
        </div>

        {/* Custom split */}
        <div className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
              Macro split
            </p>
            <span className={cn(
              'text-xs font-semibold tabular-nums',
              splitTotal === 100
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-red-500'
            )}>
              Total: {splitTotal}%{splitTotal !== 100 ? ' (must equal 100%)' : ''}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {/* Protein */}
            <div>
              <label className="text-xs text-zinc-400 block mb-1 text-center">Protein %</label>
              <input
                type="number"
                value={proteinPct}
                onChange={e => handlePctInput('protein', e.target.value)}
                min={0}
                max={100}
                className={pctInputClass}
              />
            </div>
            {/* Fat */}
            <div>
              <label className="text-xs text-zinc-400 block mb-1 text-center">Fat %</label>
              <input
                type="number"
                value={fatPct}
                onChange={e => handlePctInput('fat', e.target.value)}
                min={0}
                max={100}
                className={pctInputClass}
              />
            </div>
            {/* Carbs */}
            <div>
              <label className="text-xs text-zinc-400 block mb-1 text-center">Carbs %</label>
              <input
                type="number"
                value={carbPct}
                onChange={e => handlePctInput('carb', e.target.value)}
                min={0}
                max={100}
                className={pctInputClass}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Results */}
      {macroResult?.ok && (
        <div className="mt-6 space-y-4">
          <div className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
            <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide mb-3">
              Estimated targets
            </p>

            {/* Macro bars */}
            <div className="space-y-3">
              {[
                { label: 'Protein', grams: macroResult.targets.proteinG, pct: macroResult.targets.proteinPct, color: 'bg-blue-500' },
                { label: 'Carbohydrate', grams: macroResult.targets.carbohydrateG, pct: macroResult.targets.carbPct, color: 'bg-emerald-500' },
                { label: 'Fat', grams: macroResult.targets.fatG, pct: macroResult.targets.fatPct, color: 'bg-amber-500' },
              ].map(({ label, grams, pct, color }) => (
                <div key={label}>
                  <div className="flex items-baseline justify-between mb-1">
                    <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{label}</span>
                    <span className="text-sm font-black text-zinc-900 dark:text-white tabular-nums">
                      {grams}g <span className="text-xs font-normal text-zinc-400">{pct}%</span>
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${color}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>

            {/* Calorie summary */}
            <div className="mt-4 flex items-center justify-between rounded-xl bg-zinc-50 dark:bg-zinc-800 px-4 py-3">
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Implied calories</span>
              <div className="text-right">
                <span className="text-lg font-black text-zinc-900 dark:text-white tabular-nums">
                  {consistency?.impliedCalories.toLocaleString()}
                </span>
                <span className="text-xs text-zinc-400 ml-1">kcal</span>
                {consistency && !consistency.withinTolerance && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                    ±{Math.abs(consistency.impliedCalories - macroResult.targets.calories)} kcal from target (rounding)
                  </p>
                )}
              </div>
            </div>

            {/* Apply to Nutrition Goals */}
            <div className="mt-4 pt-4 border-t border-zinc-100 dark:border-zinc-800 space-y-2">
              {applyError && (
                <div className="flex items-start gap-2 rounded-xl bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800/40 px-3 py-2">
                  <AlertCircle className="size-3.5 text-red-500 shrink-0 mt-0.5" />
                  <p className="text-xs text-red-700 dark:text-red-400">{applyError}</p>
                </div>
              )}
              <Button
                onClick={startApplyMacros}
                disabled={applyPhase.phase === 'loading'}
                className="w-full"
              >
                {applyPhase.phase === 'loading'
                  ? <><Loader2 className="size-4 animate-spin" /> Loading current goals…</>
                  : 'Apply to Nutrition Goals'}
              </Button>
            </div>
          </div>

          <p className="text-xs text-zinc-400 text-center px-2 leading-relaxed">
            Gram values are calculated from 4 kcal/g protein, 4 kcal/g carbohydrate, and 9 kcal/g fat.
            These are estimates — individual needs vary.
          </p>
        </div>
      )}

      {/* Prompt if incomplete */}
      {!macroResult?.ok && (caloriesStr !== '' || splitTotal !== 100) && (
        <div className="mt-6 rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-5 py-4 text-center">
          <p className="text-sm text-zinc-400">
            {caloriesStr === ''
              ? 'Enter a calorie target to calculate.'
              : !calories || calories < 400
              ? 'Enter a calorie target of at least 400 kcal.'
              : splitTotal !== 100
              ? `Adjust your splits to total 100% (currently ${splitTotal}%).`
              : ''}
          </p>
        </div>
      )}

      {/* Apply confirmation dialog */}
      {applyPhase.phase === 'confirm' && (
        <ApplyTargetDialog
          mode="macros"
          existing={applyPhase.existing}
          proposed={applyPhase.proposed}
          isFirstTarget={applyPhase.isFirstTarget}
          onConfirm={handleApplyConfirm}
          onClose={() => setApplyPhase({ phase: 'idle' })}
        />
      )}
    </div>
  )
}

export default function MacrosPage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-20">
          <Loader2 className="size-6 animate-spin text-zinc-400" />
        </div>
      }
    >
      <MacrosContent />
    </Suspense>
  )
}
