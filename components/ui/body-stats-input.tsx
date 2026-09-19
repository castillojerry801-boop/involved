'use client'

import { cn } from '@/lib/utils'
import { useWeightUnit } from '@/lib/hooks/use-weight-unit'

// ─── Conversions ──────────────────────────────────────────────────────────────

function cmToFtIn(cm: number) { const totalIn = cm / 2.54; return { ft: Math.floor(totalIn / 12), inches: Math.round(totalIn % 12) } }
function ftInToCm(ft: number, inches: number) { return Math.round((ft * 12 + inches) * 2.54 * 10) / 10 }

type DisplayUnit = 'imperial' | 'metric'

interface Props {
  weightKg:  number | null
  heightCm:  number | null
  onChange:  (weightKg: number | null, heightCm: number | null) => void
  className?: string
}

export function BodyStatsInput({ weightKg, heightCm, onChange, className }: Props) {
  const { unit: weightUnit, setUnit: setWeightUnit, toDisplay, fromInput } = useWeightUnit()
  const unit: DisplayUnit = weightUnit === 'kg' ? 'metric' : 'imperial'

  // Display values derived from canonical kg/cm
  const displayWeight = weightKg != null ? toDisplay(weightKg) : ''

  const displayFt     = heightCm != null ? String(cmToFtIn(heightCm).ft)     : ''
  const displayIn     = heightCm != null ? String(cmToFtIn(heightCm).inches)  : ''
  const displayCm     = heightCm != null ? String(heightCm) : ''

  const handleWeightChange = (val: string) => {
    if (!val) { onChange(null, heightCm); return }
    const kg = fromInput(val)
    if (kg == null) return
    onChange(kg, heightCm)
  }

  const handleFtChange = (val: string) => {
    const ft = parseInt(val) || 0
    const inches = heightCm != null ? cmToFtIn(heightCm).inches : 0
    onChange(weightKg, ftInToCm(ft, inches))
  }

  const handleInChange = (val: string) => {
    const inches = parseInt(val) || 0
    const ft = heightCm != null ? cmToFtIn(heightCm).ft : 0
    onChange(weightKg, ftInToCm(ft, inches))
  }

  const handleCmChange = (val: string) => {
    if (!val) { onChange(weightKg, null); return }
    const n = parseFloat(val)
    if (isNaN(n)) return
    onChange(weightKg, n)
  }

  const switchUnit = (next: DisplayUnit) => {
    setWeightUnit(next === 'imperial' ? 'lbs' : 'kg')
  }

  return (
    <div className={className}>
      {/* Unit toggle */}
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-bold text-zinc-900 dark:text-white">
          Body stats <span className="font-normal text-zinc-400">(optional)</span>
        </p>
        <div className="flex rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden text-[11px]">
          {(['imperial', 'metric'] as const).map(u => (
            <button
              key={u}
              type="button"
              onClick={() => switchUnit(u)}
              className={cn(
                'px-2.5 py-1 transition-colors capitalize',
                unit === u
                  ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 font-semibold'
                  : 'text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800'
              )}
            >
              {u === 'imperial' ? 'lbs / ft' : 'kg / cm'}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-3">
        {/* Weight */}
        <div className="flex-1">
          <label className="text-xs text-zinc-400 block mb-1">
            Weight ({unit === 'imperial' ? 'lbs' : 'kg'})
          </label>
          <input
            type="number"
            value={displayWeight}
            onChange={e => handleWeightChange(e.target.value)}
            placeholder={unit === 'imperial' ? '165' : '75'}
            className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2.5 text-sm text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:outline-none focus:border-zinc-400"
          />
        </div>

        {/* Height */}
        {unit === 'imperial' ? (
          <div className="flex-1">
            <label className="text-xs text-zinc-400 block mb-1">Height</label>
            <div className="flex gap-1.5">
              <div className="relative flex-1">
                <input
                  type="number"
                  value={displayFt}
                  onChange={e => handleFtChange(e.target.value)}
                  placeholder="5"
                  min={0} max={9}
                  className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2.5 pr-6 text-sm text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:outline-none focus:border-zinc-400"
                />
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-zinc-400 pointer-events-none">ft</span>
              </div>
              <div className="relative flex-1">
                <input
                  type="number"
                  value={displayIn}
                  onChange={e => handleInChange(e.target.value)}
                  placeholder="10"
                  min={0} max={11}
                  className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2.5 pr-6 text-sm text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:outline-none focus:border-zinc-400"
                />
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-zinc-400 pointer-events-none">in</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1">
            <label className="text-xs text-zinc-400 block mb-1">Height (cm)</label>
            <input
              type="number"
              value={displayCm}
              onChange={e => handleCmChange(e.target.value)}
              placeholder="178"
              className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2.5 text-sm text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:outline-none focus:border-zinc-400"
            />
          </div>
        )}
      </div>
    </div>
  )
}
