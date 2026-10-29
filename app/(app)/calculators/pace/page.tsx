'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { AlertCircle, Info } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { cn } from '@/lib/utils'
import { useDistanceUnit } from '@/lib/hooks/use-distance-unit'
import {
  calcPace,
  calcFinishTime,
  projectRaceTimes,
  formatPace,
  formatTime,
  secondsToHms,
  STANDARD_DISTANCES,
} from '@/lib/calculators/pace'

type CalcMode = 'pace' | 'finish_time' | 'race_projection'

const MODE_LABELS: Record<CalcMode, string> = {
  pace:             'Pace & Speed',
  finish_time:      'Finish Time',
  race_projection:  'Race Projection',
}

// ─── Small helpers ────────────────────────────────────────────────────────────

function NumInput({
  value, onChange, placeholder, max = 99, label,
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
  max?: number
  label: string
}) {
  return (
    <div className="flex-1">
      <p className="text-[10px] text-zinc-400 text-center mb-1">{label}</p>
      <input
        type="number"
        inputMode="numeric"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        min={0}
        max={max}
        className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-2 py-3 text-lg font-bold text-center text-zinc-900 dark:text-white placeholder:text-zinc-300 dark:placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500"
      />
    </div>
  )
}

function TimeColon() {
  return <span className="text-xl font-bold text-zinc-400 self-end pb-3">:</span>
}

// Parse a string to a non-negative integer, or null
function parseIntOrNull(s: string): number | null {
  if (!s.trim()) return null
  const n = parseInt(s, 10)
  return Number.isInteger(n) && n >= 0 ? n : null
}

export default function PacePage() {
  const { unit: distUnit } = useDistanceUnit()

  const [mode, setMode] = useState<CalcMode>('pace')

  // Shared: distance selection
  const [distKey, setDistKey] = useState('5k')
  const [customDistStr, setCustomDistStr] = useState('')

  // Mode: pace — time inputs
  const [ph, setPh] = useState('')  // hours
  const [pm, setPm] = useState('')  // minutes
  const [ps, setPs] = useState('')  // seconds

  // Mode: finish_time — pace inputs (min:sec per unit)
  const [paceMin, setPaceMin] = useState('')
  const [paceSec, setPaceSec] = useState('')

  // Mode: race_projection — time inputs (same fields, separate state)
  const [rph, setRph] = useState('')
  const [rpm, setRpm] = useState('')
  const [rps, setRps] = useState('')

  // Resolve selected distance in meters
  const selectedDistM = useMemo(() => {
    if (distKey === 'custom') {
      const n = parseFloat(customDistStr)
      if (!isFinite(n) || n <= 0) return null
      // Custom input is in the user's preferred unit
      const m = distUnit === 'mi' ? n * 1609.344 : n * 1000
      return m
    }
    const d = STANDARD_DISTANCES.find(d => d.key === distKey)
    return d && d.meters > 0 ? d.meters : null
  }, [distKey, customDistStr, distUnit])

  const distDisplayLabel = useMemo(() => {
    if (distKey !== 'custom') return STANDARD_DISTANCES.find(d => d.key === distKey)?.label ?? ''
    if (selectedDistM == null) return 'Custom distance'
    const display = distUnit === 'mi'
      ? (selectedDistM / 1609.344).toFixed(2) + ' mi'
      : (selectedDistM / 1000).toFixed(2) + ' km'
    return display
  }, [distKey, distUnit, selectedDistM])

  // ── Results ────────────────────────────────────────────────────────────────

  const paceResult = useMemo(() => {
    if (mode !== 'pace') return null
    if (selectedDistM == null) return null
    const h = parseIntOrNull(ph) ?? 0
    const m = parseIntOrNull(pm) ?? 0
    const s = parseIntOrNull(ps) ?? 0
    if (h + m + s === 0) return null
    return calcPace(selectedDistM, h, m, s)
  }, [mode, selectedDistM, ph, pm, ps])

  const finishResult = useMemo(() => {
    if (mode !== 'finish_time') return null
    if (selectedDistM == null) return null
    const min = parseIntOrNull(paceMin)
    const sec = parseIntOrNull(paceSec) ?? 0
    if (min == null || (min === 0 && sec === 0)) return null
    return calcFinishTime(selectedDistM, min, sec, distUnit)
  }, [mode, selectedDistM, paceMin, paceSec, distUnit])

  const projResult = useMemo(() => {
    if (mode !== 'race_projection') return null
    if (selectedDistM == null) return null
    const h = parseIntOrNull(rph) ?? 0
    const m = parseIntOrNull(rpm) ?? 0
    const s = parseIntOrNull(rps) ?? 0
    if (h + m + s === 0) return null
    const totalSec = h * 3600 + m * 60 + s
    return projectRaceTimes(selectedDistM, totalSec)
  }, [mode, selectedDistM, rph, rpm, rps])

  const activeResult = mode === 'pace' ? paceResult : mode === 'finish_time' ? finishResult : null
  const hasError = activeResult != null && !activeResult.ok

  return (
    <div className="mx-auto max-w-lg px-4 py-8 md:px-8">
      <PageHeader
        title="Running Pace"
        backHref="/calculators"
        subtitle="Pace, speed, and finish time for any distance"
      />

      <div className="mt-6 space-y-4">

        {/* Mode selector */}
        <div className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-3">
          <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
            Calculate
          </p>
          <div className="flex gap-2">
            {(['pace', 'finish_time', 'race_projection'] as CalcMode[]).map(m => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={cn(
                  'flex-1 rounded-xl border py-2 text-[11px] font-semibold transition-all leading-tight text-center',
                  mode === m
                    ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/10 text-emerald-700 dark:text-emerald-400'
                    : 'border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:border-zinc-300'
                )}
              >
                {MODE_LABELS[m]}
              </button>
            ))}
          </div>
        </div>

        {/* Distance selector */}
        <div className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-3">
          <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
            Distance
          </p>
          <div className="grid grid-cols-3 gap-1.5">
            {STANDARD_DISTANCES.map(d => (
              <button
                key={d.key}
                onClick={() => setDistKey(d.key)}
                className={cn(
                  'rounded-xl border py-2 text-xs font-semibold transition-all',
                  distKey === d.key
                    ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/10 text-emerald-700 dark:text-emerald-400'
                    : 'border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:border-zinc-300 dark:hover:border-zinc-600'
                )}
              >
                {d.label}
              </button>
            ))}
          </div>

          {distKey === 'custom' && (
            <div className="flex items-center gap-2">
              <input
                type="number"
                inputMode="decimal"
                value={customDistStr}
                onChange={e => setCustomDistStr(e.target.value)}
                placeholder="0.0"
                className="flex-1 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-4 py-2.5 text-lg font-bold text-center text-zinc-900 dark:text-white placeholder:text-zinc-300 dark:placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500"
              />
              <span className="text-sm font-semibold text-zinc-400 w-8">{distUnit}</span>
            </div>
          )}
          <div className="flex justify-end">
            <Link
              href="/settings"
              className="text-[11px] text-zinc-400 hover:text-zinc-500 dark:hover:text-zinc-300 underline-offset-2 hover:underline"
            >
              Using {distUnit === 'mi' ? 'miles' : 'km'} · Change in Settings
            </Link>
          </div>
        </div>

        {/* Inputs: mode-specific */}
        {mode === 'pace' && (
          <div className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-2">
            <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
              Completion time
            </p>
            <div className="flex items-end gap-1">
              <NumInput value={ph} onChange={setPh} placeholder="0"  label="h"  max={23} />
              <TimeColon />
              <NumInput value={pm} onChange={setPm} placeholder="25" label="min" max={59} />
              <TimeColon />
              <NumInput value={ps} onChange={setPs} placeholder="00" label="sec" max={59} />
            </div>
          </div>
        )}

        {mode === 'finish_time' && (
          <div className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-2">
            <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
              Target pace (per {distUnit})
            </p>
            <div className="flex items-end gap-1">
              <NumInput value={paceMin} onChange={setPaceMin} placeholder="5" label="min" max={99} />
              <TimeColon />
              <NumInput value={paceSec} onChange={setPaceSec} placeholder="00" label="sec" max={59} />
            </div>
          </div>
        )}

        {mode === 'race_projection' && (
          <div className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-2">
            <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
              Your time for {distDisplayLabel}
            </p>
            <div className="flex items-end gap-1">
              <NumInput value={rph} onChange={setRph} placeholder="0"  label="h"  max={23} />
              <TimeColon />
              <NumInput value={rpm} onChange={setRpm} placeholder="25" label="min" max={59} />
              <TimeColon />
              <NumInput value={rps} onChange={setRps} placeholder="00" label="sec" max={59} />
            </div>
          </div>
        )}
      </div>

      {/* Results */}
      <div className="mt-6 space-y-4">

        {/* Validation error */}
        {hasError && activeResult != null && !activeResult.ok && (
          <div className="rounded-2xl border border-red-200 dark:border-red-800/40 bg-red-50 dark:bg-red-900/10 px-5 py-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="size-5 text-red-500 shrink-0 mt-0.5" />
              <p className="text-sm text-red-700 dark:text-red-400">{activeResult.message}</p>
            </div>
          </div>
        )}

        {/* Pace & Speed results */}
        {mode === 'pace' && paceResult?.ok && (
          <div className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-3">
            <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
              Results
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-zinc-50 dark:bg-zinc-800 px-4 py-3 text-center">
                <p className="text-[10px] text-zinc-400 mb-1">Pace</p>
                <p className="text-2xl font-black text-emerald-600 dark:text-emerald-400 tabular-nums">
                  {formatPace(distUnit === 'mi' ? paceResult.paceSecPerMi : paceResult.paceSecPerKm)}
                </p>
                <p className="text-xs text-zinc-400">min / {distUnit}</p>
              </div>
              <div className="rounded-xl bg-zinc-50 dark:bg-zinc-800 px-4 py-3 text-center">
                <p className="text-[10px] text-zinc-400 mb-1">Speed</p>
                <p className="text-2xl font-black text-zinc-900 dark:text-white tabular-nums">
                  {(distUnit === 'mi' ? paceResult.speedMph : paceResult.speedKmh).toFixed(1)}
                </p>
                <p className="text-xs text-zinc-400">{distUnit === 'mi' ? 'mph' : 'km/h'}</p>
              </div>
              <div className="rounded-xl bg-zinc-50 dark:bg-zinc-800 px-4 py-3 text-center">
                <p className="text-[10px] text-zinc-400 mb-1">Also in</p>
                <p className="text-lg font-bold text-zinc-500 dark:text-zinc-400 tabular-nums">
                  {formatPace(distUnit === 'mi' ? paceResult.paceSecPerKm : paceResult.paceSecPerMi)}
                </p>
                <p className="text-xs text-zinc-400">min / {distUnit === 'mi' ? 'km' : 'mi'}</p>
              </div>
              <div className="rounded-xl bg-zinc-50 dark:bg-zinc-800 px-4 py-3 text-center">
                <p className="text-[10px] text-zinc-400 mb-1">Also in</p>
                <p className="text-lg font-bold text-zinc-500 dark:text-zinc-400 tabular-nums">
                  {(distUnit === 'mi' ? paceResult.speedKmh : paceResult.speedMph).toFixed(1)}
                </p>
                <p className="text-xs text-zinc-400">{distUnit === 'mi' ? 'km/h' : 'mph'}</p>
              </div>
            </div>
          </div>
        )}

        {/* Finish Time results */}
        {mode === 'finish_time' && finishResult?.ok && (
          <div className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-3">
            <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
              Estimated finish time
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-zinc-50 dark:bg-zinc-800 px-4 py-3 text-center col-span-2">
                <p className="text-[10px] text-zinc-400 mb-1">{distDisplayLabel}</p>
                <p className="text-4xl font-black text-emerald-600 dark:text-emerald-400 tabular-nums">
                  {formatTime(finishResult.totalSeconds)}
                </p>
              </div>
              <div className="rounded-xl bg-zinc-50 dark:bg-zinc-800 px-4 py-3 text-center">
                <p className="text-[10px] text-zinc-400 mb-1">Speed</p>
                <p className="text-xl font-black text-zinc-900 dark:text-white tabular-nums">
                  {(distUnit === 'mi' ? finishResult.speedMph : finishResult.speedKmh).toFixed(1)}
                </p>
                <p className="text-xs text-zinc-400">{distUnit === 'mi' ? 'mph' : 'km/h'}</p>
              </div>
              <div className="rounded-xl bg-zinc-50 dark:bg-zinc-800 px-4 py-3 text-center">
                <p className="text-[10px] text-zinc-400 mb-1">
                  Pace / {distUnit === 'mi' ? 'km' : 'mi'}
                </p>
                <p className="text-xl font-black text-zinc-500 dark:text-zinc-400 tabular-nums">
                  {formatPace(distUnit === 'mi' ? finishResult.paceSecPerKm : finishResult.paceSecPerMi)}
                </p>
                <p className="text-xs text-zinc-400">
                  min / {distUnit === 'mi' ? 'km' : 'mi'}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Race Projection results */}
        {mode === 'race_projection' && (() => {
          const r = projResult
          if (!r) return null
          if (!r.ok) {
            return (
              <div className="rounded-2xl border border-red-200 dark:border-red-800/40 bg-red-50 dark:bg-red-900/10 px-5 py-4">
                <div className="flex items-start gap-3">
                  <AlertCircle className="size-5 text-red-500 shrink-0 mt-0.5" />
                  <p className="text-sm text-red-700 dark:text-red-400">{r.message}</p>
                </div>
              </div>
            )
          }

          // Known perf summary
          const knownH = parseIntOrNull(rph) ?? 0
          const knownM = parseIntOrNull(rpm) ?? 0
          const knownS = parseIntOrNull(rps) ?? 0
          const knownSec = knownH * 3600 + knownM * 60 + knownS

          return (
            <>
              <div className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
                <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide mb-3">
                  Projected race times
                </p>

                {/* Reference row */}
                <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-emerald-50 dark:bg-emerald-900/10 border border-emerald-200 dark:border-emerald-800/30 mb-2">
                  <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                    Reference — {distDisplayLabel}
                  </p>
                  <p className="text-sm font-black text-emerald-700 dark:text-emerald-400 tabular-nums">
                    {formatTime(knownSec)}
                  </p>
                </div>

                <div className="space-y-1">
                  {r.projections.map(proj => {
                    const { h, m, s } = secondsToHms(proj.predictedSeconds)
                    const pacePerUnit = distUnit === 'mi'
                      ? proj.predictedSeconds / ((proj.meters / 1000) * 0.6213711922)
                      : proj.predictedSeconds / (proj.meters / 1000)
                    return (
                      <div
                        key={proj.key}
                        className="flex items-center justify-between px-3 py-2.5 rounded-xl border border-zinc-100 dark:border-zinc-800"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-zinc-900 dark:text-white">
                            {proj.label}
                          </p>
                          <p className="text-[11px] text-zinc-400">
                            {formatPace(pacePerUnit)} / {distUnit}
                          </p>
                        </div>
                        <p className="text-sm font-black text-zinc-900 dark:text-white tabular-nums shrink-0 ml-3">
                          {h > 0
                            ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
                            : `${m}:${String(s).padStart(2, '0')}`}
                        </p>
                      </div>
                    )
                  })}
                </div>
              </div>

              <div className="flex items-start gap-2.5 rounded-2xl border border-amber-100 dark:border-amber-900/30 bg-amber-50 dark:bg-amber-900/10 px-4 py-3">
                <Info className="size-4 text-amber-500 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-700 dark:text-amber-400 leading-relaxed">
                  Projections use the Riegel formula (T₂ = T₁ × (D₂/D₁)^1.06). Assumes consistent
                  effort and training. Real race times depend on course, conditions, fitness, and strategy.
                </p>
              </div>
            </>
          )
        })()}

        {/* Prompt when no result yet */}
        {mode === 'pace'           && !paceResult   && selectedDistM != null && (
          <div className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-5 py-4 text-center">
            <p className="text-sm text-zinc-400">Enter your completion time above to calculate pace.</p>
          </div>
        )}
        {mode === 'finish_time'    && !finishResult  && selectedDistM != null && (
          <div className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-5 py-4 text-center">
            <p className="text-sm text-zinc-400">Enter your target pace above to calculate finish time.</p>
          </div>
        )}
        {mode === 'race_projection' && !projResult   && selectedDistM != null && (
          <div className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-5 py-4 text-center">
            <p className="text-sm text-zinc-400">Enter your time for the selected distance above.</p>
          </div>
        )}
        {selectedDistM == null && distKey === 'custom' && (
          <div className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-5 py-4 text-center">
            <p className="text-sm text-zinc-400">Enter a custom distance in {distUnit} above.</p>
          </div>
        )}
      </div>
    </div>
  )
}
