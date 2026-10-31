'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Loader2, ChefHat } from 'lucide-react'
import { HealthyRecipeCard } from './healthy-recipe-card'
import { HealthyRecipeFilters } from './healthy-recipe-filters'
import { RecipeCard, type RecipeCardData } from './recipe-card'
import type { YMoveRecipeSummary, RecipePagination } from '@/lib/ymove/recipes'

interface Filters {
  q: string
  mealType: string
  diet: string
  maxCalories: string
  minProtein: string
}

const DEFAULT_FILTERS: Filters = { q: '', mealType: '', diet: '', maxCalories: '', minProtein: '' }
const DEFAULT_PAGINATION: RecipePagination = { page: 1, pageSize: 20, total: 0, totalPages: 1 }

function RecipeSkeleton() {
  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden animate-pulse">
      <div className="h-44 bg-zinc-200 dark:bg-zinc-700" />
      <div className="p-3 space-y-2">
        <div className="h-4 bg-zinc-200 dark:bg-zinc-700 rounded w-3/4" />
        <div className="h-3 bg-zinc-200 dark:bg-zinc-700 rounded w-1/2" />
        <div className="h-3 bg-zinc-200 dark:bg-zinc-700 rounded w-1/3" />
      </div>
    </div>
  )
}

interface DiscoverTabProps {
  currentUserId: string
}

export function DiscoverTab({ currentUserId }: DiscoverTabProps) {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS)
  const [debouncedQ, setDebouncedQ] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [ymoveRecipes, setYmoveRecipes] = useState<YMoveRecipeSummary[]>([])
  const [pagination, setPagination] = useState<RecipePagination>(DEFAULT_PAGINATION)
  const [ymovePage, setYmovePage] = useState(1)
  const [ymoveLoading, setYmoveLoading] = useState(true)
  const [ymoveLoadingMore, setYmoveLoadingMore] = useState(false)
  const [ymoveError, setYmoveError] = useState(false)

  const [communityRecipes, setCommunityRecipes] = useState<RecipeCardData[]>([])
  const [targets, setTargets] = useState<{ calories: number; proteinG: number } | null>(null)

  const [savedIds, setSavedIds] = useState<Set<string>>(new Set())
  const [savePending, setSavePending] = useState<string | null>(null)

  // Fetch targets, community recipes, and saved YMove IDs on mount
  useEffect(() => {
    fetch('/api/nutrition/targets')
      .then((r) => r.ok ? r.json() : null)
      .then((d: { calories?: number; proteinG?: number } | null) => {
        if (d?.calories && d?.proteinG) setTargets({ calories: d.calories, proteinG: d.proteinG })
      })
      .catch(() => null)

    fetch('/api/recipes?view=discover')
      .then((r) => r.ok ? r.json() : null)
      .then((d: { items?: RecipeCardData[] } | null) => {
        if (d?.items?.length) setCommunityRecipes(d.items)
      })
      .catch(() => null)

    fetch('/api/ymove/recipes/saved')
      .then((r) => r.ok ? r.json() : null)
      .then((d: { savedIds?: string[] } | null) => {
        if (d?.savedIds) setSavedIds(new Set(d.savedIds))
      })
      .catch(() => null)
  }, [])

  // Debounce text search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebouncedQ(filters.q), 400)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [filters.q])

  const buildUrl = useCallback((f: Filters, p: number, q: string) => {
    const sp = new URLSearchParams()
    if (q) sp.set('q', q)
    if (f.mealType) sp.set('mealType', f.mealType)
    if (f.diet) sp.set('diet', f.diet)
    if (f.maxCalories) sp.set('maxCalories', f.maxCalories)
    if (f.minProtein) sp.set('minProtein', f.minProtein)
    sp.set('page', String(p))
    return `/api/ymove/recipes?${sp.toString()}`
  }, [])

  const fetchYMove = useCallback(async (f: Filters, p: number, q: string, append: boolean) => {
    if (append) setYmoveLoadingMore(true)
    else setYmoveLoading(true)
    setYmoveError(false)
    try {
      const res = await fetch(buildUrl(f, p, q))
      if (!res.ok) throw new Error()
      const data = await res.json() as { recipes: YMoveRecipeSummary[]; pagination: RecipePagination }
      setYmoveRecipes((prev) => append ? [...prev, ...data.recipes] : data.recipes)
      setPagination(data.pagination)
    } catch {
      if (!append) { setYmoveRecipes([]); setYmoveError(true) }
    } finally {
      setYmoveLoading(false)
      setYmoveLoadingMore(false)
    }
  }, [buildUrl])

  // Initial load + filter changes reset to page 1
  useEffect(() => {
    setYmovePage(1)
    fetchYMove(filters, 1, debouncedQ, false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQ, filters.mealType, filters.diet, filters.maxCalories, filters.minProtein])

  function handleFilterChange(key: string, value: string) {
    setFilters((prev) => ({ ...prev, [key]: value }))
  }

  function handleLoadMore() {
    const next = ymovePage + 1
    setYmovePage(next)
    fetchYMove(filters, next, debouncedQ, true)
  }

  const handleSave = useCallback(async (recipe: YMoveRecipeSummary) => {
    if (savePending) return
    setSavePending(recipe.id)
    const wantSave = !savedIds.has(recipe.id)
    try {
      const res = await fetch(`/api/ymove/recipes/${recipe.id}/save`, {
        method: wantSave ? 'POST' : 'DELETE',
      })
      if (res.ok) {
        setSavedIds((prev) => {
          const next = new Set(prev)
          wantSave ? next.add(recipe.id) : next.delete(recipe.id)
          return next
        })
      }
    } finally {
      setSavePending(null)
    }
  }, [savePending, savedIds])

  const hasMore = pagination.page < pagination.totalPages

  return (
    <div>
      <HealthyRecipeFilters
        filters={filters}
        onChange={handleFilterChange}
        goalsCalories={targets?.calories ?? null}
        goalsProtein={targets?.proteinG ?? null}
      />

      {/* Community recipes — only shown when published ones exist */}
      {communityRecipes.length > 0 && (
        <section className="mb-6">
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-400">
            From the Community
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {communityRecipes.map((r) => (
              <RecipeCard key={r.id} recipe={r} currentUserId={currentUserId} />
            ))}
          </div>
        </section>
      )}

      {/* YMove catalog count label */}
      {!ymoveLoading && pagination.total > 0 && (
        <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-400">
          {pagination.total.toLocaleString()} Recipes
        </p>
      )}

      {ymoveLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <RecipeSkeleton key={i} />)}
        </div>
      ) : ymoveError ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <p className="text-sm text-red-500">Could not load recipes.</p>
          <button
            onClick={() => fetchYMove(filters, 1, debouncedQ, false)}
            className="text-sm text-zinc-500 underline"
          >
            Retry
          </button>
        </div>
      ) : ymoveRecipes.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-20 text-center">
          <ChefHat className="size-10 text-zinc-300 dark:text-zinc-700" />
          <p className="text-sm text-zinc-500">No recipes match your filters. Try adjusting your search.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {ymoveRecipes.map((recipe) => (
              <HealthyRecipeCard
                key={recipe.id}
                recipe={recipe}
                goalsCalories={targets?.calories ?? null}
                goalsProtein={targets?.proteinG ?? null}
                savedByMe={savedIds.has(recipe.id)}
                savePending={savePending === recipe.id}
                onSave={handleSave}
              />
            ))}
          </div>

          {hasMore && (
            <div className="mt-6 flex justify-center">
              <button
                onClick={handleLoadMore}
                disabled={ymoveLoadingMore}
                className="flex items-center gap-2 rounded-xl border border-zinc-200 dark:border-zinc-700 px-5 py-2.5 text-sm text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50 transition-colors"
              >
                {ymoveLoadingMore && <Loader2 className="size-4 animate-spin" />}
                Load more
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
