'use client'

import { useState, useMemo } from 'react'
import { AlertCircle, Info } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { cn } from '@/lib/utils'
import {
  calcHRZonesFromAge,
  calcHRZonesAdvanced,
  estimateMaxHR,
} from '@/lib/calculators/heart-rate-zones'

type Mode = 'basic' | 'advanced'

const METHOD_LABELS: Record<string, string> = {
  age_estimated: 'Tanaka formula (estimated)',
  measured_max:  '% of measured max HR',
  karvonen:      'Karvonen heart-rate-reserve',
}

const ZONE_TEXT_COLORS = [
  'text-sky-600 dark:text-sky-400',
  'text-emerald-600 dark:text-emerald-400',
  'text-yellow-600 dark:text-yellow-500',
  'text-orange-500 dark:text-orange-400',
  'text-red-600 dark:text-red-500',
]

export default function HeartRateZonesPage() {
  const [mode, setMode] = useState<Mode>('basic')

  // Basic mode
  const [ageStr, setAgeStr] = useState('')

  // Advanced mode
  const [maxHRStr, setMaxHRStr]       = useState('')
  const [restingHRStr, setRestingHRStr] = useState('')

  const ageNum = useMemo(() => {
    const n = parseInt(ageStr, 10)
    return Number.isInteger(n) && n >= 0 ? n : null
  }, [ageStr])

  const maxHRNum = useMemo(() => {
    const n = parseInt(maxHRStr, 10)
    return Number.isInteger(n) && n > 0 ? n : null
  }, [maxHRStr])

  const restingHRNum = useMemo(() => {
    if (!restingHRStr.trim()) return null
    const n = parseInt(restingHRStr, 10)
    return Number.isInteger(n) && n > 0 ? n : null
  }, [restingHRStr])

  const result = useMemo(() => {
    if (mode === 'basic') {
      if (ageNum == null) return null
      return calcHRZonesFromAge(ageNum)
    } else {
      if (maxHRNum == null) return null
      return calcHRZonesAdvanced(maxHRNum, restingHRNum)
    }
  }, [mode, ageNum, maxHRNum, restingHRNum])

  const estimatedPreview = useMemo(() => {
    if (mode !== 'basic' || ageNum == null) return null
    if (ageNum < 10 || ageNum > 100) return null
    return estimateMaxHR(ageNum)
  }, [mode, ageNum])

  const missingInput = mode === 'basic' ? ageStr.trim() === '' : maxHRStr.trim() === ''

  return (
    <div className="mx-auto max-w-lg px-4 py-8 md:px-8">
      <PageHeader
        title="Heart Rate Zones"
        backHref="/calculators"
        subtitle="Guidance — not precise physiological thresholds"
      />

      <div className="mt-6 space-y-4">

        {/* Mode toggle */}
        <div className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-3">
          <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
            Calculation method
          </p>
          <div className="grid grid-cols-2 gap-2">
            {(['basic', 'advanced'] as const).map(m => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={cn(
                  'rounded-xl border py-2.5 text-sm font-medium transition-all',
                  mode === m
                    ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/10 text-emerald-700 dark:text-emerald-400'
                    : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:border-zinc-300'
                )}
              >
                {m === 'basic' ? 'Basic (age)' : 'Advanced'}
              </button>
            ))}
          </div>
          <p className="text-xs text-zinc-400 leading-relaxed">
            {mode === 'basic'
              ? 'Estimates max HR from age using the Tanaka (2001) formula: 208 − 0.7 × age.'
              : 'Uses a heart-rate you\'ve measured. Optionally provide resting HR for the Karvonen method.'}
          </p>
        </div>

        {/* Basic inputs */}
        {mode === 'basic' && (
          <div className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-3">
            <label className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide block">
              Age (years)
            </label>
            <input
              type="number"
              inputMode="numeric"
              value={ageStr}
              onChange={e => setAgeStr(e.target.value)}
              placeholder="30"
              min={10}
              max={100}
              className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-4 py-3 text-lg font-bold text-center text-zinc-900 dark:text-white placeholder:text-zinc-300 dark:placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500"
            />
            {estimatedPreview != null && (
              <p className="text-xs text-zinc-400">
                Estimated max HR: <strong className="text-zinc-500">{estimatedPreview} bpm</strong>
                {' '}(Tanaka). Zones are a percentage of this estimate.
              </p>
            )}
          </div>
        )}

        {/* Advanced inputs */}
        {mode === 'advanced' && (
          <div className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-4">
            <div>
              <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide mb-1.5">
                Maximum heart rate (bpm)
              </p>
              <input
                type="number"
                inputMode="numeric"
                value={maxHRStr}
                onChange={e => setMaxHRStr(e.target.value)}
                placeholder="190"
                className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-4 py-3 text-lg font-bold text-center text-zinc-900 dark:text-white placeholder:text-zinc-300 dark:placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500"
              />
              <p className="text-xs text-zinc-400 mt-1.5 leading-relaxed">
                Use a value from a supervised test, a structured protocol, or a field test.
                Note: peak HR recorded by a wearable during exercise may not represent your true maximum.
              </p>
            </div>

            <div>
              <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide mb-1.5">
                Resting heart rate (bpm) — optional
              </p>
              <input
                type="number"
                inputMode="numeric"
                value={restingHRStr}
                onChange={e => setRestingHRStr(e.target.value)}
                placeholder="60"
                className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-4 py-3 text-lg font-bold text-center text-zinc-900 dark:text-white placeholder:text-zinc-300 dark:placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500"
              />
              <p className="text-xs text-zinc-400 mt-1.5">
                If provided, zones use the Karvonen heart-rate-reserve method. Measure resting HR after
                several minutes of quiet rest.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Results */}
      <div className="mt-6 space-y-4">

        {/* Prompt */}
        {missingInput && (
          <div className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-5 py-4 text-center">
            <p className="text-sm text-zinc-400">
              {mode === 'basic' ? 'Enter your age above to see your zones.' : 'Enter your max HR above to see your zones.'}
            </p>
          </div>
        )}

        {/* Validation error */}
        {result != null && !result.ok && (
          <div className="rounded-2xl border border-red-200 dark:border-red-800/40 bg-red-50 dark:bg-red-900/10 px-5 py-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="size-5 text-red-500 shrink-0 mt-0.5" />
              <p className="text-sm text-red-700 dark:text-red-400">{result.message}</p>
            </div>
          </div>
        )}

        {/* Zones */}
        {result?.ok && (
          <>
            {/* Summary row */}
            <div className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
                  Training zones
                </p>
                <span className="text-[10px] font-medium text-zinc-400 bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded-full">
                  {METHOD_LABELS[result.method]}
                </span>
              </div>

              <div className="flex items-center gap-3 mb-3">
                <div className="rounded-xl bg-zinc-50 dark:bg-zinc-800 px-4 py-2.5 flex-1 text-center">
                  <p className="text-[10px] text-zinc-400">
                    {result.method === 'age_estimated' ? 'Est. max HR' : 'Max HR'}
                  </p>
                  <p className="text-2xl font-black text-zinc-900 dark:text-white">{result.maxHR}</p>
                  <p className="text-[10px] text-zinc-400">bpm</p>
                </div>
                {result.restingHR != null && (
                  <div className="rounded-xl bg-zinc-50 dark:bg-zinc-800 px-4 py-2.5 flex-1 text-center">
                    <p className="text-[10px] text-zinc-400">Resting HR</p>
                    <p className="text-2xl font-black text-zinc-900 dark:text-white">{result.restingHR}</p>
                    <p className="text-[10px] text-zinc-400">bpm</p>
                  </div>
                )}
                {result.restingHR != null && (
                  <div className="rounded-xl bg-zinc-50 dark:bg-zinc-800 px-4 py-2.5 flex-1 text-center">
                    <p className="text-[10px] text-zinc-400">HR Reserve</p>
                    <p className="text-2xl font-black text-zinc-900 dark:text-white">
                      {result.maxHR - result.restingHR}
                    </p>
                    <p className="text-[10px] text-zinc-400">bpm</p>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                {result.zones.map((zone, i) => (
                  <div
                    key={zone.zone}
                    className="flex items-center gap-3 rounded-xl border border-zinc-100 dark:border-zinc-800 px-3 py-2.5"
                  >
                    <div className={cn('w-1 self-stretch rounded-full shrink-0', zone.color)} />
                    <div className="flex-1 min-w-0">
                      <p className={cn('text-xs font-semibold leading-tight', ZONE_TEXT_COLORS[i])}>
                        {zone.name}
                      </p>
                      <p className="text-[11px] text-zinc-400 leading-tight mt-0.5">
                        {zone.purpose}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-black text-zinc-900 dark:text-white tabular-nums">
                        {zone.minBpm}–{zone.maxBpm}
                      </p>
                      <p className="text-[10px] text-zinc-400">bpm</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Method note */}
            {result.method === 'age_estimated' && (
              <div className="flex items-start gap-2.5 rounded-2xl border border-sky-100 dark:border-sky-900/30 bg-sky-50 dark:bg-sky-900/10 px-4 py-3">
                <Info className="size-4 text-sky-500 shrink-0 mt-0.5" />
                <p className="text-xs text-sky-700 dark:text-sky-400 leading-relaxed">
                  Zones are based on an estimated max HR (Tanaka, 2001). For more accurate zones,
                  switch to Advanced mode and enter a measured max HR from a structured test.
                </p>
              </div>
            )}

            {/* Disclaimer */}
            <div className="flex items-start gap-2.5 rounded-2xl border border-amber-100 dark:border-amber-900/30 bg-amber-50 dark:bg-amber-900/10 px-4 py-3">
              <AlertCircle className="size-4 text-amber-500 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-700 dark:text-amber-400 leading-relaxed">
                Zone boundaries are guidance only — not precise physiological thresholds. Individual
                response varies. Consult a qualified coach or exercise physiologist to calibrate zones
                for your specific physiology.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
