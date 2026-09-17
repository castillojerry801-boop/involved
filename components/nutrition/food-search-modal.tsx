'use client'

import { useState, useRef, useCallback } from 'react'
import { Search, Barcode, Camera, X, Plus, ChevronRight, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { BarcodeScanner } from './barcode-scanner'
import { PhotoAnalyzer } from './photo-analyzer'

type Tab = 'search' | 'barcode' | 'photo'
type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack'

interface FoodResult {
  externalId: string
  name: string
  brand?: string
  servingSize: number
  servingUnit: string
  coreNutrients: {
    calories: number
    proteinG: number
    carbohydrateG: number
    fatG: number
  }
  extendedNutrients?: Record<string, number>
}

interface Props {
  mealType: MealType
  logDate: string
  onLogged: () => void
  onClose: () => void
}

export function FoodSearchModal({ mealType, logDate, onLogged, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('search')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<FoodResult[]>([])
  const [searching, setSearching] = useState(false)
  const [logging, setLogging] = useState<string | null>(null)
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

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
          foodName: food.brand ? `${food.name} (${food.brand})` : food.name,
          servingMultiplier,
          servingSize: food.servingSize,
          servingUnit: food.servingUnit,
          calories: food.coreNutrients.calories,
          proteinG: food.coreNutrients.proteinG,
          carbohydrateG: food.coreNutrients.carbohydrateG,
          fatG: food.coreNutrients.fatG,
          extendedNutrients: food.extendedNutrients,
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
                    placeholder='e.g. "chicken breast" or "2 eggs and toast"'
                    className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 pl-9 pr-4 py-2.5 text-sm text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <Button size="sm" onClick={handleNaturalSearch} disabled={searching}>
                  {searching ? <Loader2 className="size-4 animate-spin" /> : 'Go'}
                </Button>
              </div>

              {/* Results */}
              {searching && (
                <div className="flex justify-center py-8">
                  <Loader2 className="size-5 animate-spin text-zinc-400" />
                </div>
              )}
              {!searching && results.length > 0 && (
                <div className="flex flex-col divide-y divide-zinc-100 dark:divide-zinc-800">
                  {results.map(food => (
                    <div key={food.externalId} className="flex items-center gap-3 py-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-zinc-900 dark:text-white truncate">{food.name}</p>
                        {food.brand && <p className="text-xs text-zinc-400 truncate">{food.brand}</p>}
                        <p className="text-xs text-zinc-500 mt-0.5">
                          {food.coreNutrients.calories} cal · {food.servingSize} {food.servingUnit}
                          {' · '}P {food.coreNutrients.proteinG}g · C {food.coreNutrients.carbohydrateG}g · F {food.coreNutrients.fatG}g
                        </p>
                      </div>
                      <button
                        onClick={() => logFood(food)}
                        disabled={logging === food.externalId}
                        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50 transition-colors"
                      >
                        {logging === food.externalId ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {!searching && query.length >= 2 && results.length === 0 && (
                <p className="text-center text-sm text-zinc-400 py-8">No results found. Try a different search.</p>
              )}
            </div>
          )}

          {tab === 'barcode' && (
            <BarcodeScanner onFound={food => logFood(food)} mealType={mealType} logDate={logDate} onLogged={onLogged} />
          )}

          {tab === 'photo' && (
            <PhotoAnalyzer mealType={mealType} logDate={logDate} onLogged={onLogged} />
          )}
        </div>
      </div>
    </div>
  )
}
