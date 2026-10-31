'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ChefHat, Plus, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/layout/PageHeader'
import { RecipeCard, type RecipeCardData } from '@/components/recipes/recipe-card'
import { DiscoverTab } from '@/components/recipes/discover-tab'
import { HealthyRecipeCard } from '@/components/recipes/healthy-recipe-card'
import { CreateRecipeModal } from '@/components/recipes/create-recipe-modal'
import { createClient } from '@/lib/supabase/client'
import type { YMoveRecipeSummary } from '@/lib/ymove/recipes'

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
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)

  // Shared state for Saved + Mine tabs (community recipes from /api/recipes)
  const [communityItems, setCommunityItems] = useState<RecipeCardData[]>([])
  const [communityLoading, setCommunityLoading] = useState(false)
  const [communityLoadingMore, setCommunityLoadingMore] = useState(false)
  const [communityNextCursor, setCommunityNextCursor] = useState<string | null>(null)
  const [communityError, setCommunityError] = useState<string | null>(null)
  const [communitySavePending, setCommunitySavePending] = useState<string | null>(null)

  // YMove saved recipes — shown in Saved tab
  const [ymoveSaved, setYmoveSaved] = useState<YMoveRecipeSummary[]>([])
  const [ymoveSavePending, setYmoveSavePending] = useState<string | null>(null)

  useEffect(() => {
    createClient().auth.getUser().then(({ data }) => {
      setCurrentUserId(data.user?.id ?? null)
    })
  }, [])

  // Clear community + ymove state on tab change so stale content doesn't flash
  useEffect(() => {
    setCommunityItems([])
    setCommunityNextCursor(null)
    setCommunityError(null)
    setYmoveSaved([])
  }, [tab])

  const fetchCommunity = useCallback(async (view: 'saved' | 'mine', cursor?: string) => {
    const isInitial = !cursor
    if (isInitial) setCommunityLoading(true)
    else setCommunityLoadingMore(true)
    setCommunityError(null)
    try {
      const url = `/api/recipes?view=${view}${cursor ? `&cursor=${cursor}` : ''}`
      const res = await fetch(url)
      if (!res.ok) throw new Error('Failed to load recipes')
      const data = await res.json() as { items: RecipeCardData[]; nextCursor: string | null }
      setCommunityItems((prev) => isInitial ? data.items : [...prev, ...data.items])
      setCommunityNextCursor(data.nextCursor)
    } catch {
      setCommunityError('Could not load recipes. Please try again.')
    } finally {
      setCommunityLoading(false)
      setCommunityLoadingMore(false)
    }
  }, [])

  const fetchYMoveSaved = useCallback(async () => {
    try {
      const res = await fetch('/api/ymove/recipes/saved')
      if (res.ok) {
        const data = await res.json() as { savedRecipes: YMoveRecipeSummary[] }
        setYmoveSaved(data.savedRecipes ?? [])
      }
    } catch {
      // silent — ymove saves are supplemental
    }
  }, [])

  useEffect(() => {
    if (tab === 'saved') {
      fetchCommunity('saved')
      fetchYMoveSaved()
    } else if (tab === 'mine') {
      fetchCommunity('mine')
    }
    // Discover tab manages its own state via DiscoverTab component
  }, [tab, fetchCommunity, fetchYMoveSaved])

  const handleCommunitySave = useCallback(async (id: string) => {
    if (communitySavePending) return
    setCommunitySavePending(id)
    const res = await fetch(`/api/recipes/${id}/save`, { method: 'POST' })
    if (res.ok) {
      const { saved } = await res.json() as { saved: boolean }
      setCommunityItems((prev) =>
        prev.map((r) =>
          r.id === id
            ? { ...r, savedByMe: saved, saveCount: (r.saveCount ?? 0) + (saved ? 1 : -1) }
            : r,
        ),
      )
    }
    setCommunitySavePending(null)
  }, [communitySavePending])

  const handleYMoveSaveToggle = useCallback(async (recipe: YMoveRecipeSummary) => {
    if (ymoveSavePending) return
    setYmoveSavePending(recipe.id)
    try {
      // In the Saved tab the recipe is always saved, so this is always an unsave.
      const res = await fetch(`/api/ymove/recipes/${recipe.id}/save`, { method: 'DELETE' })
      if (res.ok) setYmoveSaved((prev) => prev.filter((r) => r.id !== recipe.id))
    } finally {
      setYmoveSavePending(null)
    }
  }, [ymoveSavePending])

  const handleCreated = useCallback((recipeId: string) => {
    setShowCreate(false)
    router.push(`/recipes/${recipeId}`)
  }, [router])

  const isEmpty = !communityLoading && !communityError && communityItems.length === 0

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 md:px-8 md:py-8">

      <PageHeader title="Recipes">
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus className="size-4" />
          New
        </Button>
      </PageHeader>

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

      {/* ── Discover ──────────────────────────────────────────────────── */}
      {tab === 'discover' && (
        <DiscoverTab currentUserId={currentUserId ?? ''} />
      )}

      {/* ── Saved ─────────────────────────────────────────────────────── */}
      {tab === 'saved' && (
        <>
          {communityLoading && ymoveSaved.length === 0 ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="size-6 animate-spin text-zinc-400" />
            </div>
          ) : communityError ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <p className="text-sm text-red-500">{communityError}</p>
              <button
                onClick={() => fetchCommunity('saved')}
                className="text-sm text-zinc-500 underline"
              >
                Retry
              </button>
            </div>
          ) : (
            <>
              {/* YMove saves */}
              {ymoveSaved.length > 0 && (
                <section className="mb-6">
                  {communityItems.length > 0 && (
                    <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-400">
                      Curated Recipes
                    </p>
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {ymoveSaved.map((recipe) => (
                      <HealthyRecipeCard
                        key={recipe.id}
                        recipe={recipe}
                        savedByMe
                        savePending={ymoveSavePending === recipe.id}
                        onSave={handleYMoveSaveToggle}
                      />
                    ))}
                  </div>
                </section>
              )}

              {/* Community saves */}
              {communityItems.length > 0 && (
                <section>
                  {ymoveSaved.length > 0 && (
                    <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-400">
                      Community Recipes
                    </p>
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {communityItems.map((recipe) => (
                      <RecipeCard
                        key={recipe.id}
                        recipe={recipe}
                        currentUserId={currentUserId ?? ''}
                        onSave={handleCommunitySave}
                        savePending={communitySavePending === recipe.id}
                      />
                    ))}
                  </div>
                  {communityNextCursor && (
                    <div className="mt-6 flex justify-center">
                      <button
                        onClick={() => fetchCommunity('saved', communityNextCursor)}
                        disabled={communityLoadingMore}
                        className="flex items-center gap-2 rounded-xl border border-zinc-200 dark:border-zinc-700 px-5 py-2.5 text-sm text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50"
                      >
                        {communityLoadingMore && <Loader2 className="size-4 animate-spin" />}
                        Load more
                      </button>
                    </div>
                  )}
                </section>
              )}

              {/* Empty state */}
              {ymoveSaved.length === 0 && communityItems.length === 0 && !communityLoading && (
                <div className="flex flex-col items-center gap-3 py-20 text-center">
                  <ChefHat className="size-10 text-zinc-300 dark:text-zinc-700" />
                  <p className="text-sm text-zinc-500">
                    {"You haven't saved any recipes yet. Bookmark recipes from Discover to save them here."}
                  </p>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* ── My Recipes ────────────────────────────────────────────────── */}
      {tab === 'mine' && (
        <>
          {communityLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="size-6 animate-spin text-zinc-400" />
            </div>
          ) : communityError ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <p className="text-sm text-red-500">{communityError}</p>
              <button
                onClick={() => fetchCommunity('mine')}
                className="text-sm text-zinc-500 underline"
              >
                Retry
              </button>
            </div>
          ) : isEmpty ? (
            <div className="flex flex-col items-center gap-3 py-20 text-center">
              <ChefHat className="size-10 text-zinc-300 dark:text-zinc-700" />
              <p className="text-sm text-zinc-500">{"You haven't created any recipes yet."}</p>
              <button
                onClick={() => setShowCreate(true)}
                className="mt-1 flex items-center gap-1.5 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 px-4 py-2 text-sm font-semibold"
              >
                <Plus className="size-4" /> Create Recipe
              </button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {communityItems.map((recipe) => (
                  <RecipeCard
                    key={recipe.id}
                    recipe={recipe}
                    currentUserId={currentUserId ?? ''}
                    onSave={handleCommunitySave}
                    savePending={communitySavePending === recipe.id}
                  />
                ))}
              </div>
              {communityNextCursor && (
                <div className="mt-6 flex justify-center">
                  <button
                    onClick={() => fetchCommunity('mine', communityNextCursor)}
                    disabled={communityLoadingMore}
                    className="flex items-center gap-2 rounded-xl border border-zinc-200 dark:border-zinc-700 px-5 py-2.5 text-sm text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50"
                  >
                    {communityLoadingMore && <Loader2 className="size-4 animate-spin" />}
                    Load more
                  </button>
                </div>
              )}
            </>
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
