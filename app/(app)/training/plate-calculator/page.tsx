'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { cn } from '@/lib/utils'

// Available plate denominations in kg
const PLATE_DENOMINATIONS = [25, 20, 15, 10, 5, 2.5, 1.25]

const BAR_PRESETS = [
  { label: 'Olympic (20kg)', value: 20 },
  { label: 'Women\'s (15kg)', value: 15 },
  { label: 'EZ bar (10kg)', value: 10 },
  { label: 'No bar (0kg)', value: 0 },
]

function calcPlates(targetKg: number, barKg: number, available: number[]): Array<{ plate: number; count: number }> | null {
  const perSide = (targetKg - barKg) / 2
  if (perSide < 0) return null
  if (perSide === 0) return []

  let remaining = perSide
  const result: Array<{ plate: number; count: number }> = []

  for (const plate of [...available].sort((a, b) => b - a)) {
    if (plate > remaining + 0.001) continue
    const count = Math.floor(remaining / plate + 0.001)
    if (count > 0) {
      result.push({ plate, count })
      remaining = Math.round((remaining - count * plate) * 1000) / 1000
    }
    if (remaining < 0.001) break
  }

  if (remaining > 0.001) return null // can't make exact weight
  return result
}

export default function PlateCalculatorPage() {
  const [target, setTarget] = useState('')
  const [barKg, setBarKg] = useState(20)
  const [customBar, setCustomBar] = useState('')
  const [useCustomBar, setUseCustomBar] = useState(false)
  const [available, setAvailable] = useState<number[]>(PLATE_DENOMINATIONS)

  const effectiveBar = useCustomBar ? (parseFloat(customBar) || 0) : barKg
  const targetNum = parseFloat(target) || 0

  const plates = targetNum > 0 ? calcPlates(targetNum, effectiveBar, available) : null
  const canMake = plates !== null

  const togglePlate = (p: number) =>
    setAvailable(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p].sort((a, b) => b - a))

  return (
    <div className="mx-auto max-w-lg px-4 py-8 md:px-8">
      <div className="mb-6 flex items-center gap-3">
        <Link href="/training" className="flex size-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors">
          <ArrowLeft className="size-4 text-zinc-600 dark:text-zinc-400" />
        </Link>
        <div>
          <h1 className="text-xl font-black text-zinc-900 dark:text-white">Plate calculator</h1>
          <p className="text-sm text-zinc-500">Target weight → plates per side</p>
        </div>
      </div>

      {/* Target weight */}
      <div className="mb-5 rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
        <label className="text-xs font-semibold text-zinc-500 block mb-2">Target weight (kg)</label>
        <input
          type="number"
          value={target}
          onChange={e => setTarget(e.target.value)}
          placeholder="e.g. 100"
          className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-4 py-3 text-2xl font-black text-zinc-900 dark:text-white text-center focus:outline-none focus:border-zinc-400"
        />
      </div>

      {/* Bar selection */}
      <div className="mb-5 rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
        <label className="text-xs font-semibold text-zinc-500 block mb-2">Barbell</label>
        <div className="grid grid-cols-2 gap-2">
          {BAR_PRESETS.map(p => (
            <button
              key={p.value}
              onClick={() => { setBarKg(p.value); setUseCustomBar(false) }}
              className={cn(
                'rounded-xl border px-3 py-2 text-sm font-medium text-left transition-colors',
                !useCustomBar && barKg === p.value
                  ? 'border-zinc-900 dark:border-white bg-zinc-900 dark:bg-white text-white dark:text-zinc-900'
                  : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800'
              )}
            >
              {p.label}
            </button>
          ))}
          <button
            onClick={() => setUseCustomBar(true)}
            className={cn(
              'rounded-xl border px-3 py-2 text-sm font-medium text-left transition-colors',
              useCustomBar
                ? 'border-zinc-900 dark:border-white bg-zinc-900 dark:bg-white text-white dark:text-zinc-900'
                : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800'
            )}
          >
            Custom
          </button>
        </div>
        {useCustomBar && (
          <input
            type="number"
            value={customBar}
            onChange={e => setCustomBar(e.target.value)}
            placeholder="Bar weight in kg"
            className="mt-2 w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-white focus:outline-none focus:border-zinc-400"
          />
        )}
      </div>

      {/* Available plates */}
      <div className="mb-5 rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
        <label className="text-xs font-semibold text-zinc-500 block mb-2">Available plates (kg)</label>
        <div className="flex flex-wrap gap-2">
          {PLATE_DENOMINATIONS.map(p => (
            <button
              key={p}
              onClick={() => togglePlate(p)}
              className={cn(
                'rounded-full border px-3 py-1 text-sm font-medium transition-colors',
                available.includes(p)
                  ? 'border-zinc-900 dark:border-white bg-zinc-900 dark:bg-white text-white dark:text-zinc-900'
                  : 'border-zinc-200 dark:border-zinc-700 text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800'
              )}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* Result */}
      {targetNum > 0 && (
        <div className={cn(
          'rounded-2xl border p-5',
          canMake
            ? 'border-emerald-200 dark:border-emerald-800/40 bg-emerald-50 dark:bg-emerald-900/10'
            : 'border-red-100 dark:border-red-900/40 bg-red-50 dark:bg-red-900/10'
        )}>
          {!canMake ? (
            <p className="text-sm font-semibold text-red-600 dark:text-red-400 text-center">
              Can&apos;t make {targetNum}kg with selected plates and {effectiveBar}kg bar.
            </p>
          ) : plates!.length === 0 ? (
            <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400 text-center">
              Bar only — {effectiveBar}kg
            </p>
          ) : (
            <div>
              <p className="text-xs font-semibold text-zinc-500 mb-3 text-center">
                EACH SIDE — {((targetNum - effectiveBar) / 2).toFixed(2).replace(/\.?0+$/, '')}kg
              </p>
              <div className="flex flex-wrap justify-center gap-3">
                {plates!.map(({ plate, count }) => (
                  <div key={plate} className="flex flex-col items-center gap-1">
                    <div className="flex gap-1">
                      {Array.from({ length: count }).map((_, i) => (
                        <div
                          key={i}
                          className={cn(
                            'flex items-center justify-center rounded font-black text-white text-xs',
                            plate >= 20 ? 'w-8 h-14' :
                            plate >= 10 ? 'w-7 h-12' :
                            plate >= 5  ? 'w-6 h-10' : 'w-5 h-8',
                            plate >= 20 ? 'bg-red-500' :
                            plate >= 10 ? 'bg-blue-500' :
                            plate >= 5  ? 'bg-yellow-500' :
                            plate >= 2.5 ? 'bg-green-500' : 'bg-zinc-400'
                          )}
                        >
                          {plate}
                        </div>
                      ))}
                    </div>
                    <span className="text-xs text-zinc-500">×{count}</span>
                  </div>
                ))}
              </div>
              <p className="text-center text-xs text-zinc-400 mt-4">
                Total: {effectiveBar}kg bar + {plates!.reduce((s, p) => s + p.plate * p.count * 2, 0)}kg plates = <strong className="text-zinc-700 dark:text-zinc-300">{targetNum}kg</strong>
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
