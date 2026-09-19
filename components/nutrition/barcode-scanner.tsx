'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2, CheckCircle, AlertCircle, ScanLine, Search, RefreshCw } from 'lucide-react'

interface FoodResult {
  provider?: string
  externalId: string
  name: string
  brand?: string
  servingSize: number
  servingUnit: string
  coreNutrients: { calories: number; proteinG: number; carbohydrateG: number; fatG: number }
  extendedNutrients?: Record<string, number>
  nutriScore?: string
  novaGroup?: number
  incompleteData?: boolean
}

interface Props {
  mealType: string
  logDate: string
  onFound: (food: FoodResult) => void
  onLogged: () => void
}

function ProviderBadge({ provider }: { provider?: string }) {
  if (!provider) return null
  if (provider === 'usda_fooddata') return (
    <span className="rounded-full bg-sky-100 dark:bg-sky-900/40 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700 dark:text-sky-300 uppercase tracking-wide">USDA</span>
  )
  if (provider === 'open_food_facts') return (
    <span className="rounded-full bg-emerald-100 dark:bg-emerald-900/40 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300 uppercase tracking-wide">OFF</span>
  )
  return null
}

function NutriScoreBadge({ grade }: { grade?: string }) {
  if (!grade) return null
  const colors: Record<string, string> = {
    A: 'bg-green-500', B: 'bg-lime-400', C: 'bg-yellow-400',
    D: 'bg-orange-400', E: 'bg-red-500',
  }
  const bg = colors[grade.toUpperCase()] ?? 'bg-zinc-400'
  return (
    <span className={`${bg} text-white rounded px-1.5 py-0.5 text-[10px] font-black`}>
      {grade.toUpperCase()}
    </span>
  )
}

export function BarcodeScanner({ onFound }: Props) {
  const scannerRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'idle' | 'scanning' | 'found' | 'notfound' | 'error'>('idle')
  const [foundFood, setFoundFood] = useState<FoodResult | null>(null)
  const [lastScanned, setLastScanned] = useState('')
  const [fallbackQuery, setFallbackQuery] = useState('')
  const [fallbackResults, setFallbackResults] = useState<FoodResult[]>([])
  const [fallbackSearching, setFallbackSearching] = useState(false)
  const [showFallback, setShowFallback] = useState(false)
  const scannerInstanceRef = useRef<{ stop: () => Promise<void>; clear: () => void } | null>(null)

  useEffect(() => {
    let html5QrCode: { stop: () => Promise<void>; clear: () => void; start: (...args: unknown[]) => Promise<void> } | null = null
    let stopped = false

    async function startScanner() {
      const { Html5Qrcode } = await import('html5-qrcode')
      if (!scannerRef.current) return

      html5QrCode = new Html5Qrcode('barcode-reader') as unknown as typeof html5QrCode
      scannerInstanceRef.current = html5QrCode
      setStatus('scanning')

      await html5QrCode!.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 280, height: 140 } },
        async (decodedText: string) => {
          if (decodedText === lastScanned || stopped) return
          setLastScanned(decodedText)
          stopped = true
          await html5QrCode!.stop()

          const res = await fetch(`/api/nutrition/barcode?upc=${encodeURIComponent(decodedText)}`)
          if (res.ok) {
            const data = await res.json() as { result: FoodResult }
            setFoundFood(data.result)
            setStatus('found')
          } else {
            setStatus('notfound')
          }
        },
        () => {},
      )
    }

    startScanner().catch(() => setStatus('error'))

    return () => {
      if (!stopped) {
        stopped = true
        html5QrCode?.stop().catch(() => {})
      }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const rescan = async () => {
    setStatus('idle')
    setFoundFood(null)
    setLastScanned('')
    setShowFallback(false)
    setFallbackResults([])

    const { Html5Qrcode } = await import('html5-qrcode')
    const instance = new Html5Qrcode('barcode-reader') as unknown as {
      stop: () => Promise<void>; clear: () => void;
      start: (...args: unknown[]) => Promise<void>
    }
    scannerInstanceRef.current = instance
    setStatus('scanning')

    await instance.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 280, height: 140 } },
      async (decodedText: string) => {
        if (decodedText === lastScanned) return
        setLastScanned(decodedText)
        await instance.stop()
        const res = await fetch(`/api/nutrition/barcode?upc=${encodeURIComponent(decodedText)}`)
        if (res.ok) {
          const data = await res.json() as { result: FoodResult }
          setFoundFood(data.result)
          setStatus('found')
        } else {
          setStatus('notfound')
        }
      },
      () => {},
    )
  }

  const doFallbackSearch = async (q: string) => {
    if (q.trim().length < 2) return
    setFallbackSearching(true)
    try {
      const res = await fetch(`/api/nutrition/search?q=${encodeURIComponent(q)}`)
      const data = await res.json() as { results: FoodResult[] }
      setFallbackResults(data.results ?? [])
    } finally {
      setFallbackSearching(false)
    }
  }

  return (
    <div className="p-4 flex flex-col gap-4">
      {/* Scanner viewport — hidden while showing fallback search */}
      {!showFallback && (
        <div
          id="barcode-reader"
          ref={scannerRef}
          className="w-full rounded-xl overflow-hidden bg-zinc-900 min-h-[180px]"
        />
      )}

      {status === 'scanning' && !showFallback && (
        <div className="flex items-center justify-center gap-2 text-sm text-zinc-500">
          <ScanLine className="size-4 animate-pulse" />
          Point camera at a barcode
        </div>
      )}

      {/* Found */}
      {status === 'found' && foundFood && (
        <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 p-4">
          <div className="flex items-start gap-3 mb-3">
            <CheckCircle className="size-5 text-emerald-500 shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="flex items-center gap-2 flex-wrap mb-0.5">
                <p className="font-semibold text-sm text-zinc-900 dark:text-white">{foundFood.name}</p>
                <ProviderBadge provider={foundFood.provider} />
                <NutriScoreBadge grade={foundFood.nutriScore} />
              </div>
              {foundFood.brand && <p className="text-xs text-zinc-500">{foundFood.brand}</p>}
              <p className="text-xs text-zinc-500 mt-1">
                {foundFood.coreNutrients.calories} cal · {foundFood.servingSize}{foundFood.servingUnit}
              </p>
              <p className="text-xs text-zinc-400 mt-0.5">
                P {foundFood.coreNutrients.proteinG}g · C {foundFood.coreNutrients.carbohydrateG}g · F {foundFood.coreNutrients.fatG}g
              </p>
              {foundFood.incompleteData && (
                <p className="mt-1.5 text-[11px] text-amber-600 dark:text-amber-400">
                  Some nutrient data may be incomplete.
                </p>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => onFound(foundFood)}
              className="flex-1 rounded-xl bg-emerald-500 py-2.5 text-sm font-semibold text-white hover:bg-emerald-600 transition-colors"
            >
              Add to meal
            </button>
            <button
              onClick={rescan}
              className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
            >
              <RefreshCw className="size-4" />
            </button>
          </div>
        </div>
      )}

      {/* Not found */}
      {status === 'notfound' && !showFallback && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertCircle className="size-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <p className="text-sm font-medium text-amber-800 dark:text-amber-300">Barcode not found</p>
          </div>
          <p className="text-xs text-zinc-500 mb-3">
            This product isn&apos;t in our database yet. Search by name to find it.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setShowFallback(true)}
              className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-zinc-900 dark:bg-white py-2.5 text-sm font-semibold text-white dark:text-zinc-900 hover:opacity-90 transition-opacity"
            >
              <Search className="size-4" />
              Search by name
            </button>
            <button
              onClick={rescan}
              className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
            >
              <RefreshCw className="size-4" />
            </button>
          </div>
        </div>
      )}

      {/* Fallback search */}
      {showFallback && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <button
              onClick={() => { setShowFallback(false); setFallbackResults([]) }}
              className="text-xs text-zinc-400 hover:text-zinc-600"
            >
              ← Back to scanner
            </button>
          </div>
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-zinc-400" />
            <input
              autoFocus
              type="text"
              value={fallbackQuery}
              onChange={e => {
                setFallbackQuery(e.target.value)
                if (e.target.value.trim().length >= 2) {
                  const t = setTimeout(() => doFallbackSearch(e.target.value), 400)
                  return () => clearTimeout(t)
                }
              }}
              onKeyDown={e => e.key === 'Enter' && doFallbackSearch(fallbackQuery)}
              placeholder="Search by product name..."
              className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 pl-9 pr-4 py-2.5 text-sm text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            {fallbackSearching && (
              <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 size-4 animate-spin text-zinc-400" />
            )}
          </div>
          <div className="flex flex-col divide-y divide-zinc-100 dark:divide-zinc-800 max-h-64 overflow-y-auto">
            {fallbackResults.map(food => (
              <button
                key={food.externalId}
                onClick={() => onFound(food)}
                className="flex items-center gap-3 py-3 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/50 -mx-1 px-1 rounded-lg transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <p className="text-sm font-medium text-zinc-900 dark:text-white truncate">{food.name}</p>
                    <ProviderBadge provider={food.provider} />
                  </div>
                  {food.brand && <p className="text-xs text-zinc-400 truncate">{food.brand}</p>}
                  <p className="text-xs text-zinc-500 mt-0.5">
                    {food.coreNutrients.calories} cal · {food.servingSize}{food.servingUnit}
                  </p>
                </div>
              </button>
            ))}
            {!fallbackSearching && fallbackResults.length === 0 && fallbackQuery.length >= 2 && (
              <p className="py-6 text-center text-sm text-zinc-400">No results found.</p>
            )}
          </div>
        </div>
      )}

      {status === 'error' && (
        <div className="flex items-center gap-2 text-sm text-red-500">
          <AlertCircle className="size-4" />
          Camera access required for barcode scanning.
        </div>
      )}
    </div>
  )
}
