'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { Search, Barcode, Camera, X, Plus, Loader2, ChevronDown, ChevronUp, Minus, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { BarcodeScanner } from './barcode-scanner'
import { PhotoAnalyzer } from './photo-analyzer'

type Tab = 'search' | 'barcode' | 'photo'
type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack'

interface FoodResult {
  provider?: string
  externalId: string
  name: string
  brand?: string
  barcode?: string
  servingSize: number
  servingUnit: string
  coreNutrients: {
    calories: number
    proteinG: number
    carbohydrateG: number
    fatG: number
  }
  extendedNutrients?: Record<string, number>
  nutriScore?: string
  novaGroup?: number
  incompleteData?: boolean
}

interface Props {
  mealType: MealType
  logDate: string
  onLogged: () => void
  onClose: () => void
}

function ProviderBadge({ provider }: { provider?: string }) {
  if (!provider || provider === 'library') return (
    <span className="rounded-full bg-zinc-100 dark:bg-zinc-700 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">Library</span>
  )
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
    A: 'bg-green-500', B: 'bg-lime-400 text-zinc-800', C: 'bg-yellow-400 text-zinc-800',
    D: 'bg-orange-400', E: 'bg-red-500',
  }
  const cls = colors[grade.toUpperCase()] ?? 'bg-zinc-400'
  return (
    <span className={`${cls} text-white rounded px-1.5 py-0.5 text-[10px] font-black`}>
      {grade.toUpperCase()}
    </span>
  )
}

// ─── Expanded food card ───────────────────────────────────────────────────────

function FoodCard({
  food,
  onLog,
  logging,
}: {
  food: FoodResult
  onLog: (food: FoodResult, multiplier: number) => void
  logging: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const [servings, setServings] = useState(1)

  const cal = Math.round(food.coreNutrients.calories * servings)
  const pro = Math.round(food.coreNutrients.proteinG * servings * 10) / 10
  const carb = Math.round(food.coreNutrients.carbohydrateG * servings * 10) / 10
  const fat = Math.round(food.coreNutrients.fatG * servings * 10) / 10

  return (
    <div className="flex flex-col border-b border-zinc-100 dark:border-zinc-800 last:border-0">
      {/* Row */}
      <button
        className="flex items-center gap-3 py-3 text-left w-full"
        onClick={() => setExpanded(v => !v)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="text-sm font-medium text-zinc-900 dark:text-white truncate">{food.name}</p>
            <ProviderBadge provider={food.provider} />
            {food.nutriScore && <NutriScoreBadge grade={food.nutriScore} />}
          </div>
          {food.brand && <p className="text-xs text-zinc-400 truncate">{food.brand}</p>}
          <p className="text-xs text-zinc-500 mt-0.5">
            {food.coreNutrients.calories} cal · {food.servingSize}{food.servingUnit}
            {' · '}P {food.coreNutrients.proteinG}g · C {food.coreNutrients.carbohydrateG}g · F {food.coreNutrients.fatG}g
          </p>
        </div>
        {expanded
          ? <ChevronUp className="size-4 text-zinc-300 shrink-0" />
          : <ChevronDown className="size-4 text-zinc-300 shrink-0" />
        }
      </button>

      {/* Expanded: serving editor + add button */}
      {expanded && (
        <div className="pb-3 pl-0">
          {food.incompleteData && (
            <p className="mb-2 text-[11px] text-amber-600 dark:text-amber-400">
              Some nutrient data may be incomplete for this product.
            </p>
          )}

          {/* Serving multiplier */}
          <div className="mb-3 flex items-center gap-3">
            <span className="text-xs font-medium text-zinc-500">Servings</span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setServings(s => Math.max(0.5, Math.round((s - 0.5) * 10) / 10))}
                className="flex size-7 items-center justify-center rounded-full border border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              >
                <Minus className="size-3" />
              </button>
              <input
                type="number"
                min={0.5}
                max={20}
                step={0.5}
                value={servings}
                onChange={e => {
                  const v = parseFloat(e.target.value)
                  if (!isNaN(v) && v > 0) setServings(Math.round(v * 10) / 10)
                }}
                className="w-14 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-2 py-1 text-center text-sm text-zinc-900 dark:text-white focus:outline-none"
              />
              <button
                onClick={() => setServings(s => Math.round((s + 0.5) * 10) / 10)}
                className="flex size-7 items-center justify-center rounded-full border border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              >
                <Plus className="size-3" />
              </button>
            </div>
            <span className="text-xs text-zinc-400">
              = {servings * food.servingSize}{food.servingUnit}
            </span>
          </div>

          {/* Calculated macros */}
          <div className="mb-3 flex items-center gap-4 rounded-lg bg-zinc-50 dark:bg-zinc-800 px-3 py-2">
            <div className="text-center">
              <p className="text-base font-black text-zinc-900 dark:text-white">{cal}</p>
              <p className="text-[10px] text-zinc-400">cal</p>
            </div>
            <div className="text-center">
              <p className="text-sm font-bold text-zinc-900 dark:text-white">{pro}g</p>
              <p className="text-[10px] text-zinc-400">protein</p>
            </div>
            <div className="text-center">
              <p className="text-sm font-bold text-zinc-900 dark:text-white">{carb}g</p>
              <p className="text-[10px] text-zinc-400">carbs</p>
            </div>
            <div className="text-center">
              <p className="text-sm font-bold text-zinc-900 dark:text-white">{fat}g</p>
              <p className="text-[10px] text-zinc-400">fat</p>
            </div>
          </div>

          {/* Quick serving presets */}
          <div className="mb-3 flex gap-1.5">
            {[0.5, 1, 1.5, 2, 3].map(n => (
              <button
                key={n}
                onClick={() => setServings(n)}
                className={cn(
                  'rounded-lg px-2.5 py-1 text-xs font-medium transition-colors',
                  servings === n
                    ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900'
                    : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                )}
              >
                {n}x
              </button>
            ))}
          </div>

          <button
            onClick={() => onLog(food, servings)}
            disabled={logging}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-emerald-500 py-2.5 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-50 transition-colors"
          >
            {logging ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            Add {cal} cal to meal
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Main modal ───────────────────────────────────────────────────────────────

export function FoodSearchModal({ mealType, logDate, onLogged, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('search')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<FoodResult[]>([])
  const [recentFoods, setRecentFoods] = useState<FoodResult[]>([])
  const [searching, setSearching] = useState(false)
  const [logging, setLogging] = useState<string | null>(null)
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    fetch('/api/nutrition/recent')
      .then(r => r.ok ? r.json() as Promise<{ foods: FoodResult[] }> : null)
      .then(d => { if (d) setRecentFoods(d.foods) })
      .catch(() => {})
  }, [])

  const search = useCallback(async (q: string) => {
    if (q.trim().length < 2) { setResults([]); return }
    setSearching(true)
    try {
      const res = await fetch(`/api/nutrition/search?q=${encodeURIComponent(q)}`)
      const data = await res.json() as { results: FoodResult[] }
      setResults(data.results ?? [])
    } finally {
      setSearching(false)
    }
  }, [])

  const handleQueryChange = (q: string) => {
    setQuery(q)
    if (searchTimeout.current) clearTimeout(searchTimeout.current)
    searchTimeout.current = setTimeout(() => search(q), 400)
  }

  const handleNaturalSearch = async () => {
    if (!query.trim()) return
    setSearching(true)
    try {
      const res = await fetch('/api/nutrition/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      })
      const data = await res.json() as { results: FoodResult[] }
      setResults(data.results ?? [])
    } finally {
      setSearching(false)
    }
  }

  const logFood = async (food: FoodResult, servingMultiplier = 1) => {
    setLogging(food.externalId)
    try {
      await fetch('/api/nutrition/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mealType,
          logDate,
          foodName: food.name,
          brand: food.brand,
          barcode: food.barcode,
          servingMultiplier,
          servingSize: food.servingSize,
          servingUnit: food.servingUnit,
          calories: food.coreNutrients.calories,
          proteinG: food.coreNutrients.proteinG,
          carbohydrateG: food.coreNutrients.carbohydrateG,
          fatG: food.coreNutrients.fatG,
          extendedNutrients: food.extendedNutrients,
          sourceProvider: food.provider,
          externalId: food.externalId,
        }),
      })
      onLogged()
    } finally {
      setLogging(null)
    }
  }

  const TABS: { id: Tab; label: string; icon: typeof Search }[] = [
    { id: 'search', label: 'Search', icon: Search },
    { id: 'barcode', label: 'Barcode', icon: Barcode },
    { id: 'photo', label: 'Photo', icon: Camera },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center p-0 sm:p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-full sm:max-w-lg bg-white dark:bg-zinc-900 rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 shrink-0">
          <div>
            <h2 className="font-bold text-lg text-zinc-900 dark:text-white capitalize">Add to {mealType}</h2>
            <p className="text-xs text-zinc-400">Search, scan a barcode, or snap a photo</p>
          </div>
          <button onClick={onClose} className="flex size-8 items-center justify-center rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400">
            <X className="size-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-zinc-100 dark:border-zinc-800 px-5 shrink-0">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
                tab === id
                  ? 'border-emerald-500 text-emerald-600 dark:text-emerald-400'
                  : 'border-transparent text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300'
              )}
            >
              <Icon className="size-4" />
              {label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {tab === 'search' && (
            <div className="p-4">
              {/* Search input */}
              <div className="flex gap-2 mb-4">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-zinc-400" />
                  <input
                    autoFocus
                    type="text"
                    value={query}
                    onChange={e => handleQueryChange(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleNaturalSearch()}
                    placeholder='e.g. "chicken breast" or "greek yogurt"'
                    className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 pl-9 pr-4 py-2.5 text-sm text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <Button size="sm" onClick={handleNaturalSearch} disabled={searching}>
                  {searching ? <Loader2 className="size-4 animate-spin" /> : 'Go'}
                </Button>
              </div>

              {searching && (
                <div className="flex justify-center py-8">
                  <Loader2 className="size-5 animate-spin text-zinc-400" />
                </div>
              )}

              {!searching && results.length > 0 && (
                <div className="flex flex-col">
                  {results.map(food => (
                    <FoodCard
                      key={`${food.provider}:${food.externalId}`}
                      food={food}
                      onLog={logFood}
                      logging={logging === food.externalId}
                    />
                  ))}
                </div>
              )}

              {!searching && query.length >= 2 && results.length === 0 && (
                <div className="py-8 text-center">
                  <p className="text-sm text-zinc-400 mb-1">No results found.</p>
                  <p className="text-xs text-zinc-300">Try a different spelling or scan the barcode instead.</p>
                </div>
              )}

              {!query && recentFoods.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <Clock className="size-3.5 text-zinc-400" />
                    <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">Recently logged</p>
                  </div>
                  <div className="flex flex-col">
                    {recentFoods.map((food, i) => (
                      <FoodCard
                        key={`recent-${i}`}
                        food={food}
                        onLog={logFood}
                        logging={logging === food.externalId}
                      />
                    ))}
                  </div>
                </div>
              )}

              {!query && recentFoods.length === 0 && (
                <div className="py-6 text-center">
                  <p className="text-xs text-zinc-400">Results come from USDA FoodData Central + Open Food Facts</p>
                </div>
              )}
            </div>
          )}

          {tab === 'barcode' && (
            <BarcodeScanner onFound={food => { setTab('search'); logFood(food) }} mealType={mealType} logDate={logDate} onLogged={onLogged} />
          )}

          {tab === 'photo' && (
            <PhotoAnalyzer mealType={mealType} logDate={logDate} onLogged={onLogged} />
          )}
        </div>
      </div>
    </div>
  )
}
