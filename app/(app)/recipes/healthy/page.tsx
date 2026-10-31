'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Loader2, Salad } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { HealthyRecipeCard } from '@/components/recipes/healthy-recipe-card'
import { HealthyRecipeFilters } from '@/components/recipes/healthy-recipe-filters'
import type { YMoveRecipeSummary, RecipePagination } from '@/lib/ymove/recipes'

interface Filters {
  q: string
  mealType: string
  diet: string
  maxCalories: string
  minProtein: string
}

interface UserTargets {
  calories: number
  proteinG: number
}

const DEFAULT_FILTERS: Filters = { q: '', mealType: '', diet: '', maxCalories: '', minProtein: '' }
const DEFAULT_PAGINATION: RecipePagination = { page: 1, pageSize: 20, total: 0, totalPages: 1 }

// Skeleton card placeholder
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

export default function HealthyRecipesPage() {
  const [filters,     setFilters]     = useState<Filters>(DEFAULT_FILTERS)
  const [page,        setPage]        = useState(1)
  const [recipes,     setRecipes]     = useState<YMoveRecipeSummary[]>([])
  const [pagination,  setPagination]  = useState<RecipePagination>(DEFAULT_PAGINATION)
  const [loading,     setLoading]     = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error,       setError]       = useState<string | null>(null)
  const [targets,     setTargets]     = useState<UserTargets | null>(null)

  // Debounce text search
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [debouncedQ, setDebouncedQ] = useState('')

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebouncedQ(filters.q), 400)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [filters.q])

  // Fetch user targets once
  useEffect(() => {
    fetch('/api/nutrition/targets')
      .then((r) => r.ok ? r.json() : null)
      .then((data: { calories?: number; proteinG?: number } | null) => {
        if (data?.calories && data?.proteinG) {
          setTargets({ calories: data.calories, proteinG: data.proteinG })
        }
      })
      .catch(() => null)
  }, [])

  const buildUrl = useCallback((f: Filters, p: number, q: string) => {
    const sp = new URLSearchParams()
    if (q)              sp.set('q', q)
    if (f.mealType)     sp.set('mealType', f.mealType)
    if (f.diet)         sp.set('diet', f.diet)
    if (f.maxCalories)  sp.set('maxCalories', f.maxCalories)
    if (f.minProtein)   sp.set('minProtein', f.minProtein)
    sp.set('page', String(p))
    return `/api/ymove/recipes?${sp.toString()}`
  }, [])

  const fetchRecipes = useCallback(async (f: Filters, p: number, q: string, append: boolean) => {
    if (append) setLoadingMore(true)
    else        setLoading(true)
    setError(null)
    try {
      const res = await fetch(buildUrl(f, p, q))
      if (!res.ok) throw new Error('Failed to load recipes')
      const data = await res.json() as { recipes: YMoveRecipeSummary[]; pagination: RecipePagination }
      setRecipes((prev) => append ? [...prev, ...data.recipes] : data.recipes)
      setPagination(data.pagination)
    } catch {
      setError('Could not load recipes. Please try again.')
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [buildUrl])

  // Initial load and filter changes — reset to page 1
  useEffect(() => {
    setPage(1)
    fetchRecipes(filters, 1, debouncedQ, false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQ, filters.mealType, filters.diet, filters.maxCalories, filters.minProtein])

  function handleFilterChange(key: string, value: string) {
    setFilters((prev) => ({ ...prev, [key]: value }))
  }

  function handleLoadMore() {
    const next = page + 1
    setPage(next)
    fetchRecipes(filters, next, debouncedQ, true)
  }

  const hasMore = pagination.page < pagination.totalPages

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 md:px-8 md:py-8">
      <PageHeader
        title="Healthy Recipes"
        backHref="/recipes"
        subtitle={pagination.total > 0 ? `${pagination.total.toLocaleString()} recipes` : undefined}
      />

      <HealthyRecipeFilters
        filters={filters}
        onChange={handleFilterChange}
        goalsCalories={targets?.calories ?? null}
        goalsProtein={targets?.proteinG ?? null}
      />

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <RecipeSkeleton key={i} />)}
        </div>
      ) : error ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <p className="text-sm text-red-500">{error}</p>
          <button
            onClick={() => fetchRecipes(filters, page, debouncedQ, false)}
            className="text-sm text-zinc-500 underline"
          >
            Retry
          </button>
        </div>
      ) : recipes.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-20 text-center">
          <Salad className="size-10 text-zinc-300 dark:text-zinc-700" />
          <p className="text-sm text-zinc-500">
            No recipes match your filters. Try adjusting your search.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {recipes.map((recipe) => (
              <HealthyRecipeCard
                key={recipe.id}
                recipe={recipe}
                goalsCalories={targets?.calories ?? null}
                goalsProtein={targets?.proteinG ?? null}
              />
            ))}
          </div>

          {hasMore && (
            <div className="mt-6 flex justify-center">
              <button
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="flex items-center gap-2 rounded-xl border border-zinc-200 dark:border-zinc-700 px-5 py-2.5 text-sm text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50 transition-colors"
              >
                {loadingMore && <Loader2 className="size-4 animate-spin" />}
                Load more
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
