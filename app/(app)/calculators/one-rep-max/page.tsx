'use client'

import { useState, useMemo } from 'react'
import { AlertTriangle } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { cn } from '@/lib/utils'
import { useWeightUnit } from '@/lib/hooks/use-weight-unit'
import {
  calcOneRM,
  trainingPercentages,
  kgToLbs,
} from '@/lib/calculators/one-rm'

const REPS_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]

export default function OneRepMaxPage() {
  const { unit, setUnit, toDisplay, fromInput } = useWeightUnit()
  const [weightStr, setWeightStr] = useState('')
  const [reps, setReps] = useState<number>(5)

  const weightKg = useMemo(() => {
    if (!weightStr) return null
    const kg = fromInput(weightStr)
    return kg ?? null
  }, [weightStr, fromInput])

  const oneRMResult = useMemo(() => {
    if (weightKg == null) return null
    return calcOneRM({ weight: weightKg, unit: 'kg', reps })
  }, [weightKg, reps])

  const rows = useMemo(() => {
    if (!oneRMResult?.ok) return []
    return trainingPercentages(oneRMResult.oneRMKg)
  }, [oneRMResult])

  const displayOneRM = useMemo(() => {
    if (!oneRMResult?.ok) return null
    return unit === 'lbs'
      ? { primary: oneRMResult.oneRMLbs, secondary: oneRMResult.oneRMKg, primaryUnit: 'lbs', secondaryUnit: 'kg' }
      : { primary: oneRMResult.oneRMKg, secondary: oneRMResult.oneRMLbs, primaryUnit: 'kg', secondaryUnit: 'lbs' }
  }, [oneRMResult, unit])

  return (
    <div className="mx-auto max-w-lg px-4 py-8 md:px-8">
      <PageHeader
        title="Estimated 1-Rep Max"
        backHref="/calculators"
        subtitle="Statistical estimate — not a safe lift target"
      />

      <div className="mt-6 space-y-4">

        {/* Unit + weight input */}
        <div className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
              Weight lifted
            </p>
            <div className="flex rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden text-[11px]">
              {(['lbs', 'kg'] as const).map(u => (
                <button
                  key={u}
                  type="button"
                  onClick={() => {
                    if (u === unit) return
                    // Convert existing weight display on unit switch
                    if (weightStr) {
                      const kg = fromInput(weightStr)
                      if (kg != null) {
                        setWeightStr(u === 'lbs' ? String(kgToLbs(kg)) : String(kg))
                      }
                    }
                    setUnit(u)
                  }}
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

          <input
            type="number"
            inputMode="decimal"
            value={weightStr}
            onChange={e => setWeightStr(e.target.value)}
            placeholder={unit === 'lbs' ? '225' : '100'}
            className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-4 py-3 text-lg font-bold text-center text-zinc-900 dark:text-white placeholder:text-zinc-300 dark:placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500"
          />
          <p className="text-xs text-zinc-400">
            Enter the weight you successfully lifted for the set below.
          </p>
        </div>

        {/* Reps */}
        <div className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-3">
          <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
            Reps completed
          </p>
          <div className="grid grid-cols-6 gap-1.5">
            {REPS_OPTIONS.map(r => (
              <button
                key={r}
                onClick={() => setReps(r)}
                className={cn(
                  'rounded-xl border py-2 text-sm font-semibold transition-all',
                  reps === r
                    ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/10 text-emerald-700 dark:text-emerald-400'
                    : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:border-zinc-300 dark:hover:border-zinc-600'
                )}
              >
                {r}
              </button>
            ))}
          </div>
          {reps === 1 && (
            <p className="text-xs text-zinc-400">
              At 1 rep, the lifted weight is the estimated 1RM (no extrapolation).
            </p>
          )}
        </div>
      </div>

      {/* Results */}
      {displayOneRM && (
        <div className="mt-6 space-y-4">

          {/* 1RM summary */}
          <div className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
            <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide mb-3">
              Estimated 1-rep max
            </p>
            <div className="flex items-end gap-3">
              <div>
                <p className="text-4xl font-black text-emerald-600 dark:text-emerald-400 tabular-nums">
                  {displayOneRM.primary}
                </p>
                <p className="text-sm text-zinc-400">{displayOneRM.primaryUnit}</p>
              </div>
              <div className="pb-1 text-zinc-400">
                <p className="text-lg font-semibold tabular-nums">
                  {displayOneRM.secondary} {displayOneRM.secondaryUnit}
                </p>
              </div>
            </div>
          </div>

          {/* Training percentage table */}
          <div className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
            <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide mb-3">
              Training loads
            </p>
            <div className="overflow-x-auto -mx-1">
              <table className="w-full text-sm min-w-0">
                <thead>
                  <tr className="text-left border-b border-zinc-100 dark:border-zinc-800">
                    <th className="pb-2 text-xs font-semibold text-zinc-400 w-12">%1RM</th>
                    <th className="pb-2 text-xs font-semibold text-zinc-400 text-right">
                      {unit === 'lbs' ? 'lbs' : 'kg'}
                    </th>
                    <th className="pb-2 text-xs font-semibold text-zinc-400 pl-3 text-right">
                      {unit === 'lbs' ? 'kg' : 'lbs'}
                    </th>
                    <th className="pb-2 text-xs font-semibold text-zinc-400 pl-3 text-right">
                      Rep range
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-50 dark:divide-zinc-800/50">
                  {rows.map(row => (
                    <tr
                      key={row.percent}
                      className={cn(
                        row.percent === 100
                          ? 'font-semibold text-zinc-900 dark:text-white'
                          : 'text-zinc-700 dark:text-zinc-300'
                      )}
                    >
                      <td className="py-2 text-sm tabular-nums">
                        <span className={cn(
                          'text-xs font-bold rounded px-1.5 py-0.5',
                          row.percent === 100
                            ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400'
                            : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400'
                        )}>
                          {row.label}
                        </span>
                      </td>
                      <td className="py-2 text-right tabular-nums text-sm">
                        {unit === 'lbs' ? row.weightLbs : row.weightKg}
                      </td>
                      <td className="py-2 pl-3 text-right tabular-nums text-xs text-zinc-400">
                        {unit === 'lbs' ? row.weightKg : row.weightLbs}
                      </td>
                      <td className="py-2 pl-3 text-right text-xs text-zinc-400 whitespace-nowrap">
                        {row.repRange}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Disclaimer */}
          <div className="flex items-start gap-2.5 rounded-2xl border border-amber-100 dark:border-amber-900/30 bg-amber-50 dark:bg-amber-900/10 px-4 py-3">
            <AlertTriangle className="size-4 text-amber-500 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-700 dark:text-amber-400 leading-relaxed">
              These are statistical estimates using the Epley formula. They do not represent a safe lifting
              target. Always use a spotter or safety equipment when training near your maximum capacity.
            </p>
          </div>
        </div>
      )}

      {/* Prompt */}
      {!displayOneRM && weightStr === '' && (
        <div className="mt-6 rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-5 py-4 text-center">
          <p className="text-sm text-zinc-400">Enter a weight above to calculate your estimated 1RM.</p>
        </div>
      )}
    </div>
  )
}
