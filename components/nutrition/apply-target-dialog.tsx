'use client'

import { useState } from 'react'
import { X, Loader2, CheckCircle2, AlertTriangle, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { macroReconciliation, type FullNutritionTarget } from '@/lib/calculators/apply-targets'

interface Props {
  mode: 'calorie' | 'macros'
  existing: FullNutritionTarget
  proposed: FullNutritionTarget
  isFirstTarget: boolean
  onConfirm: () => Promise<{ ok: boolean; error?: string }>
  onClose: () => void
}

export function ApplyTargetDialog({ mode, existing, proposed, isFirstTarget, onConfirm, onClose }: Props) {
  const [phase, setPhase] = useState<'idle' | 'saving' | 'success' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  const reconciliation = macroReconciliation(proposed)

  const handleConfirm = async () => {
    setPhase('saving')
    const result = await onConfirm()
    if (result.ok) {
      setPhase('success')
    } else {
      setPhase('error')
      setErrorMsg(result.error ?? 'Save failed. Please try again.')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center p-0 sm:p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={phase !== 'saving' ? onClose : undefined}
      />
      <div className="relative w-full sm:max-w-md bg-white dark:bg-zinc-900 rounded-t-2xl sm:rounded-2xl shadow-2xl">

        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-zinc-100 dark:border-zinc-800">
          <h2 className="font-bold text-lg text-zinc-900 dark:text-white">
            {phase === 'success'
              ? 'Goals saved'
              : mode === 'calorie'
              ? 'Apply calorie goal'
              : 'Apply macro targets'}
          </h2>
          <button
            onClick={onClose}
            disabled={phase === 'saving'}
            className="flex size-8 items-center justify-center rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 disabled:opacity-40"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {phase === 'success' && (
            <div className="flex flex-col items-center gap-3 py-4">
              <CheckCircle2 className="size-10 text-emerald-500" />
              <p className="text-sm text-zinc-600 dark:text-zinc-400 text-center">
                Your nutrition goals have been updated. Changes appear on the Today and Nutrition pages.
              </p>
              <Button onClick={onClose} className="w-full mt-2">Done</Button>
            </div>
          )}

          {phase === 'error' && (
            <div className="space-y-4">
              <div className="flex items-start gap-3 rounded-xl bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800/40 px-4 py-3">
                <AlertCircle className="size-5 text-red-500 shrink-0 mt-0.5" />
                <p className="text-sm text-red-700 dark:text-red-400">{errorMsg}</p>
              </div>
              <div className="flex gap-3">
                <Button variant="secondary" onClick={onClose} className="flex-1">Cancel</Button>
                <Button onClick={() => { setPhase('idle'); setErrorMsg('') }} className="flex-1">Try again</Button>
              </div>
            </div>
          )}

          {(phase === 'idle' || phase === 'saving') && mode === 'calorie' && (
            <>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                {isFirstTarget
                  ? 'No nutrition goals are currently saved. This will create your first daily target.'
                  : 'Your daily calorie target will change:'}
              </p>

              <div className="rounded-xl border border-zinc-100 dark:border-zinc-800 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 bg-emerald-50 dark:bg-emerald-900/10 border-b border-zinc-100 dark:border-zinc-800">
                  <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Calories</span>
                  <span className="text-sm font-bold tabular-nums">
                    {!isFirstTarget && (
                      <span className="text-zinc-400 line-through mr-2">{existing.calories.toLocaleString()}</span>
                    )}
                    <span className="text-emerald-600 dark:text-emerald-400">{proposed.calories.toLocaleString()} kcal</span>
                  </span>
                </div>
                <div className="px-4 py-3 space-y-1.5">
                  <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-2">
                    {isFirstTarget ? 'Macro defaults (update in Macro Goals)' : 'Macros (unchanged)'}
                  </p>
                  {[
                    { label: 'Protein', value: proposed.proteinG },
                    { label: 'Carbohydrate', value: proposed.carbohydrateG },
                    { label: 'Fat', value: proposed.fatG },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex items-center justify-between">
                      <span className="text-sm text-zinc-500 dark:text-zinc-400">{label}</span>
                      <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 tabular-nums">{value} g</span>
                    </div>
                  ))}
                </div>
              </div>

              {!isFirstTarget && !reconciliation.withinTolerance && (
                <div className="flex items-start gap-2.5 rounded-xl bg-amber-50 dark:bg-amber-900/10 border border-amber-100 dark:border-amber-800/30 px-4 py-3">
                  <AlertTriangle className="size-4 text-amber-500 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-700 dark:text-amber-400 leading-relaxed">
                    Your current macros add up to {reconciliation.impliedCalories.toLocaleString()} kcal, which
                    differs from the new {proposed.calories.toLocaleString()} kcal target by {Math.abs(reconciliation.delta)} kcal.
                    Consider updating your macros in the Macro Goals calculator.
                  </p>
                </div>
              )}

              <div className="flex gap-3 pt-1">
                <Button variant="secondary" onClick={onClose} disabled={phase === 'saving'} className="flex-1">
                  Cancel
                </Button>
                <Button onClick={handleConfirm} disabled={phase === 'saving'} className="flex-1">
                  {phase === 'saving'
                    ? <><Loader2 className="size-4 animate-spin" /> Saving…</>
                    : 'Apply calorie goal'}
                </Button>
              </div>
            </>
          )}

          {(phase === 'idle' || phase === 'saving') && mode === 'macros' && (
            <>
              {isFirstTarget && (
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  No nutrition goals are currently saved. This will create your first daily target.
                </p>
              )}

              <div className="rounded-xl border border-zinc-100 dark:border-zinc-800 overflow-hidden">
                {/* Header row */}
                <div className={`grid px-4 py-2 bg-zinc-50 dark:bg-zinc-800 border-b border-zinc-100 dark:border-zinc-800 ${isFirstTarget ? 'grid-cols-2' : 'grid-cols-3'}`}>
                  <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">Field</span>
                  {!isFirstTarget && (
                    <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wide text-right">Current</span>
                  )}
                  <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wide text-right">New</span>
                </div>

                {[
                  { label: 'Calories', current: existing.calories, next: proposed.calories, unit: 'kcal' },
                  { label: 'Protein', current: existing.proteinG, next: proposed.proteinG, unit: 'g' },
                  { label: 'Carbs', current: existing.carbohydrateG, next: proposed.carbohydrateG, unit: 'g' },
                  { label: 'Fat', current: existing.fatG, next: proposed.fatG, unit: 'g' },
                ].map(({ label, current, next, unit }) => {
                  const changed = current !== next
                  return (
                    <div key={label} className={`grid px-4 py-2.5 border-b border-zinc-50 dark:border-zinc-800/50 last:border-0 items-center ${isFirstTarget ? 'grid-cols-2' : 'grid-cols-3'}`}>
                      <span className="text-sm text-zinc-600 dark:text-zinc-400">{label}</span>
                      {!isFirstTarget && (
                        <span className="text-sm text-zinc-400 text-right tabular-nums">
                          {current.toLocaleString()}
                        </span>
                      )}
                      <span className={`text-sm font-semibold text-right tabular-nums ${!isFirstTarget && changed ? 'text-emerald-600 dark:text-emerald-400' : isFirstTarget ? 'text-emerald-600 dark:text-emerald-400' : 'text-zinc-600 dark:text-zinc-400'}`}>
                        {next.toLocaleString()} <span className="text-[10px] font-normal">{unit}</span>
                      </span>
                    </div>
                  )
                })}
              </div>

              {!isFirstTarget && (existing.fiberG != null || existing.sugarG != null || existing.sodiumMg != null) && (
                <p className="text-xs text-zinc-400">
                  Fiber, sugar, and sodium targets are unchanged.
                </p>
              )}

              {!reconciliation.withinTolerance && (
                <div className="flex items-start gap-2.5 rounded-xl bg-amber-50 dark:bg-amber-900/10 border border-amber-100 dark:border-amber-800/30 px-4 py-3">
                  <AlertTriangle className="size-4 text-amber-500 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-700 dark:text-amber-400 leading-relaxed">
                    The new macro targets imply {reconciliation.impliedCalories.toLocaleString()} kcal,
                    which differs from the {proposed.calories.toLocaleString()} kcal target
                    by {Math.abs(reconciliation.delta)} kcal (rounding).
                  </p>
                </div>
              )}

              <div className="flex gap-3 pt-1">
                <Button variant="secondary" onClick={onClose} disabled={phase === 'saving'} className="flex-1">
                  Cancel
                </Button>
                <Button onClick={handleConfirm} disabled={phase === 'saving'} className="flex-1">
                  {phase === 'saving'
                    ? <><Loader2 className="size-4 animate-spin" /> Saving…</>
                    : 'Apply macro targets'}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
