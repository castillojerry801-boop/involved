'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ChefHat, Plus, Loader2, ArrowRight, Leaf } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/layout/PageHeader'
import { RecipeCard, type RecipeCardData } from '@/components/recipes/recipe-card'
import { CreateRecipeModal } from '@/components/recipes/create-recipe-modal'
import { createClient } from '@/lib/supabase/client'

type TabId = 'discover' | 'saved' | 'mine'

const TABS: { id: TabId; label: string }[] = [
  { id: 'discover', label: 'Discover' },
  { id: 'saved',    label: 'Saved' },
  { id: 'mine',     label: 'My Recipes' },
]

export default function RecipesPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const initialTab = (searchParams.get('tab') as TabId | null) ?? 'discover'

  const [tab, setTab] = useState<TabId>(initialTab)
  const [recipes, setRecipes] = useState<RecipeCardData[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [savePending, setSavePending] = useState<string | null>(null)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)

  useEffect(() => {
    createClient().auth.getUser().then(({ data }) => {
      setCurrentUserId(data.user?.id ?? null)
    })
  }, [])

  const fetchRecipes = useCallback(async (view: TabId, cursor?: string) => {
    const isInitial = !cursor
    if (isInitial) setLoading(true)
    else setLoadingMore(true)
    setError(null)

    try {
      const url = `/api/recipes?view=${view}${cursor ? `&cursor=${cursor}` : ''}`
      const res = await fetch(url)
      if (!res.ok) throw new Error('Failed to load recipes')
      const data = await res.json() as { items: RecipeCardData[]; nextCursor: string | null }

      setRecipes((prev) => isInitial ? data.items : [...prev, ...data.items])
      setNextCursor(data.nextCursor)
    } catch {
      setError('Could not load recipes. Please try again.')
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [])

  useEffect(() => {
    fetchRecipes(tab)
  }, [tab, fetchRecipes])

  const handleSave = useCallback(async (id: string) => {
    if (savePending) return
    setSavePending(id)
    const res = await fetch(`/api/recipes/${id}/save`, { method: 'POST' })
    if (res.ok) {
      const { saved } = await res.json() as { saved: boolean }
      setRecipes((prev) =>
        prev.map((r) =>
          r.id === id
            ? { ...r, savedByMe: saved, saveCount: (r.saveCount ?? 0) + (saved ? 1 : -1) }
            : r,
        ),
      )
    }
    setSavePending(null)
  }, [savePending])

  const handleCreated = useCallback((recipeId: string) => {
    setShowCreate(false)
    router.push(`/recipes/${recipeId}`)
  }, [router])

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 md:px-8 md:py-8">

      {/* Header */}
      <PageHeader title="Recipes">
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus className="size-4" />
          New
        </Button>
      </PageHeader>

      {/* Healthy Recipes banner */}
      <Link
        href="/recipes/healthy"
        className="mb-5 flex items-center gap-3 rounded-2xl border border-emerald-500/20 bg-gradient-to-r from-emerald-500/10 to-emerald-500/5 dark:from-emerald-500/10 dark:to-transparent px-4 py-3.5 hover:from-emerald-500/15 hover:to-emerald-500/10 transition-colors"
      >
        <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/20">
          <Leaf className="size-4 text-emerald-500" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-zinc-900 dark:text-white text-sm">Healthy Recipes</p>
          <p className="text-xs text-zinc-500">2,999+ curated recipes from YMove</p>
        </div>
        <ArrowRight className="size-4 text-zinc-400 shrink-0" />
      </Link>

      {/* Tabs */}
      <div className="mb-5 flex rounded-xl border border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 p-1 gap-1">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={[
              'flex-1 rounded-lg py-2 text-sm font-semibold transition-colors',
              tab === id
                ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-sm'
                : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300',
            ].join(' ')}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="size-6 animate-spin text-zinc-400" />
        </div>
      ) : error ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <p className="text-sm text-red-500">{error}</p>
          <button
            onClick={() => fetchRecipes(tab)}
            className="text-sm text-zinc-500 underline"
          >
            Retry
          </button>
        </div>
      ) : recipes.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-20 text-center">
          <ChefHat className="size-10 text-zinc-300 dark:text-zinc-700" />
          <p className="text-sm text-zinc-500">
            {tab === 'discover' && 'No community recipes yet. Be the first to share one!'}
            {tab === 'saved' && "You haven't saved any recipes yet."}
            {tab === 'mine' && "You haven't created any recipes yet."}
          </p>
          {tab === 'mine' && (
            <button
              onClick={() => setShowCreate(true)}
              className="mt-1 flex items-center gap-1.5 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 px-4 py-2 text-sm font-semibold"
            >
              <Plus className="size-4" /> Create Recipe
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {recipes.map((recipe) => (
              <RecipeCard
                key={recipe.id}
                recipe={recipe}
                currentUserId={currentUserId ?? ''}
                onSave={handleSave}
                savePending={savePending === recipe.id}
              />
            ))}
          </div>

          {nextCursor && (
            <div className="mt-6 flex justify-center">
              <button
                onClick={() => fetchRecipes(tab, nextCursor)}
                disabled={loadingMore}
                className="flex items-center gap-2 rounded-xl border border-zinc-200 dark:border-zinc-700 px-5 py-2.5 text-sm text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50"
              >
                {loadingMore && <Loader2 className="size-4 animate-spin" />}
                Load more
              </button>
            </div>
          )}
        </>
      )}

      {showCreate && (
        <CreateRecipeModal
          onClose={() => setShowCreate(false)}
          onCreated={handleCreated}
        />
      )}
    </div>
  )
}
