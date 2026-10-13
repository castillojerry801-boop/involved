'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { RecipeDetailView, type RecipeDetail } from '@/components/recipes/recipe-detail'
import { createClient } from '@/lib/supabase/client'

export default function RecipeDetailPage() {
  const router = useRouter()
  const { id } = useParams<{ id: string }>()
  const [recipe, setRecipe] = useState<RecipeDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)

  useEffect(() => {
    createClient().auth.getUser().then(({ data }) => {
      setCurrentUserId(data.user?.id ?? null)
    })
  }, [])

  const fetchRecipe = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/recipes/${id}`)
      if (res.status === 404) { setError('Recipe not found'); setLoading(false); return }
      if (!res.ok) throw new Error('Failed to load recipe')
      const data = await res.json() as { recipe: RecipeDetail }
      setRecipe(data.recipe)
    } catch {
      setError('Could not load recipe. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { fetchRecipe() }, [fetchRecipe])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="size-6 animate-spin text-zinc-400" />
      </div>
    )
  }

  if (error || !recipe) {
    return (
      <div className="flex flex-col items-center gap-3 py-32 text-center px-4">
        <p className="text-sm text-zinc-500">{error ?? 'Recipe not found'}</p>
        <button onClick={() => router.back()} className="text-sm text-zinc-500 underline">Go back</button>
      </div>
    )
  }

  return (
    <RecipeDetailView
      recipe={recipe}
      currentUserId={currentUserId ?? ''}
      onBack={() => router.push('/nutrition/recipes')}
      onDeleted={() => router.push('/nutrition/recipes')}
      onRefresh={fetchRecipe}
    />
  )
}
