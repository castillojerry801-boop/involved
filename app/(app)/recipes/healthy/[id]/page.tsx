'use client'

import { useState, useEffect, use } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { ArrowLeft, Clock, Users, ChefHat, Loader2, UtensilsCrossed } from 'lucide-react'
import { HealthyLogModal } from '@/components/recipes/healthy-log-modal'
import { cn } from '@/lib/utils'
import type { YMoveRecipeDetail } from '@/lib/ymove/recipes'

const DIET_LABELS: Record<string, string> = {
  high_protein:  'High Protein',
  low_carb:      'Low Carb',
  vegetarian:    'Vegetarian',
  vegan:         'Vegan',
  keto:          'Keto',
  paleo:         'Paleo',
  mediterranean: 'Mediterranean',
}

function MacroTile({ label, value, unit, className }: { label: string; value: number; unit: string; className?: string }) {
  return (
    <div className="flex-1 rounded-2xl bg-zinc-50 dark:bg-zinc-800 p-3 text-center">
      <p className={cn('text-lg font-black', className)}>{Math.round(value * 10) / 10}</p>
      <p className="text-[10px] font-medium text-zinc-400 uppercase tracking-wide">{unit}</p>
      <p className="text-[10px] text-zinc-500 mt-0.5">{label}</p>
    </div>
  )
}

export default function HealthyRecipeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)

  const [recipe,    setRecipe]    = useState<YMoveRecipeDetail | null>(null)
  const [loading,   setLoading]   = useState(true)
  const [notFound,  setNotFound]  = useState(false)
  const [showLog,   setShowLog]   = useState(false)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/ymove/recipes/${id}`)
      .then((r) => {
        if (r.status === 404) { setNotFound(true); setLoading(false); return null }
        if (!r.ok) throw new Error('fetch failed')
        return r.json() as Promise<{ recipe: YMoveRecipeDetail }>
      })
      .then((data) => {
        if (data) setRecipe(data.recipe)
        setLoading(false)
      })
      .catch(() => { setLoading(false); setNotFound(true) })
  }, [id])

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto">
        {/* Skeleton image */}
        <div className="aspect-video w-full bg-zinc-200 dark:bg-zinc-800 animate-pulse" />
        <div className="px-4 py-6 space-y-4">
          <div className="h-7 bg-zinc-200 dark:bg-zinc-800 rounded animate-pulse w-3/4" />
          <div className="h-4 bg-zinc-200 dark:bg-zinc-800 rounded animate-pulse w-full" />
          <div className="h-4 bg-zinc-200 dark:bg-zinc-800 rounded animate-pulse w-2/3" />
          <div className="grid grid-cols-4 gap-2 mt-4">
            {[0,1,2,3].map(i => (
              <div key={i} className="h-16 bg-zinc-200 dark:bg-zinc-800 rounded-2xl animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (notFound || !recipe) {
    return (
      <div className="flex flex-col items-center gap-4 py-24 px-4 text-center">
        <UtensilsCrossed className="size-12 text-zinc-300 dark:text-zinc-700" />
        <p className="font-semibold text-zinc-700 dark:text-zinc-300">Recipe not found</p>
        <Link
          href="/recipes/healthy"
          className="text-sm text-emerald-500 hover:text-emerald-600 font-medium"
        >
          ← Back to Healthy Recipes
        </Link>
      </div>
    )
  }

  const totalMin = (recipe.prepTimeMin ?? 0) + (recipe.cookTimeMin ?? 0)

  return (
    <div className="max-w-2xl mx-auto pb-28 md:pb-8">
      {/* Hero image */}
      <div className="relative aspect-video w-full bg-zinc-100 dark:bg-zinc-800">
        {recipe.imageUrl ? (
          <Image
            src={recipe.imageUrl}
            alt={recipe.title}
            fill
            className="object-cover"
            priority
            sizes="(max-width: 768px) 100vw, 672px"
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <ChefHat className="size-16 text-zinc-300 dark:text-zinc-600" />
          </div>
        )}

        {/* Back button overlay */}
        <Link
          href="/recipes/healthy"
          className="absolute top-4 left-4 flex size-9 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm hover:bg-black/70 transition-colors"
        >
          <ArrowLeft className="size-4" />
        </Link>
      </div>

      <div className="px-4 py-5 md:px-0 space-y-5">
        {/* Title + description */}
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-white leading-tight mb-2">
            {recipe.title}
          </h1>
          {recipe.description && (
            <p className="text-sm text-zinc-500 leading-relaxed">{recipe.description}</p>
          )}
        </div>

        {/* Meta row */}
        <div className="flex flex-wrap gap-3 text-xs text-zinc-500">
          <span className="flex items-center gap-1">
            <Users className="size-3.5" />
            {recipe.servings} serving{recipe.servings !== 1 ? 's' : ''}
          </span>
          {totalMin > 0 && (
            <span className="flex items-center gap-1">
              <Clock className="size-3.5" />
              {totalMin} min
              {recipe.prepTimeMin != null && recipe.cookTimeMin != null && (
                <span className="text-zinc-400">
                  ({recipe.prepTimeMin} prep · {recipe.cookTimeMin} cook)
                </span>
              )}
            </span>
          )}
          {recipe.difficulty && (
            <span className="capitalize">{recipe.difficulty}</span>
          )}
          {recipe.cuisineType && (
            <span className="capitalize">{recipe.cuisineType}</span>
          )}
        </div>

        {/* Macros card — per serving */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-zinc-400 mb-2">Per serving</p>
          <div className="flex gap-2">
            <MacroTile label="Calories" value={recipe.calories} unit="kcal" className="text-zinc-900 dark:text-white" />
            <MacroTile label="Protein"  value={recipe.protein}  unit="g"    className="text-sky-500" />
            <MacroTile label="Carbs"    value={recipe.carbs}    unit="g"    className="text-amber-500" />
            <MacroTile label="Fat"      value={recipe.fat}      unit="g"    className="text-orange-500" />
          </div>
        </div>

        {/* Diet tags */}
        {recipe.dietTags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {recipe.dietTags.map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 px-3 py-1 text-xs font-medium"
              >
                {DIET_LABELS[tag] ?? tag}
              </span>
            ))}
          </div>
        )}

        {/* Ingredients */}
        {recipe.ingredients.length > 0 && (
          <section>
            <h2 className="text-base font-bold text-zinc-900 dark:text-white mb-3">Ingredients</h2>
            <ul className="space-y-2">
              {recipe.ingredients
                .slice()
                .sort((a, b) => a.order - b.order)
                .map((ing, idx) => (
                  <li key={ing.id || idx} className="flex items-start gap-2 text-sm">
                    <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800 text-[10px] font-bold text-zinc-500 mt-0.5">
                      {idx + 1}
                    </span>
                    <span className="text-zinc-700 dark:text-zinc-300">
                      {ing.quantity != null && (
                        <span className="font-medium">
                          {ing.quantity % 1 === 0 ? ing.quantity : ing.quantity}{' '}
                        </span>
                      )}
                      {ing.unit && <span className="text-zinc-500">{ing.unit} </span>}
                      {ing.name}
                    </span>
                  </li>
                ))}
            </ul>
          </section>
        )}

        {/* Instructions */}
        {recipe.instructions.length > 0 && (
          <section>
            <h2 className="text-base font-bold text-zinc-900 dark:text-white mb-3">Instructions</h2>
            <ol className="space-y-3">
              {recipe.instructions.map((step, idx) => (
                <li key={idx} className="flex gap-3 text-sm">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs font-bold mt-0.5">
                    {idx + 1}
                  </span>
                  <p className="text-zinc-700 dark:text-zinc-300 leading-relaxed pt-0.5">{step}</p>
                </li>
              ))}
            </ol>
          </section>
        )}
      </div>

      {/* Desktop add button */}
      <div className="hidden md:flex justify-start px-0 pb-4">
        <button
          onClick={() => setShowLog(true)}
          className="flex items-center gap-2 rounded-2xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 px-6 py-3 text-sm font-bold hover:opacity-90 transition-opacity"
        >
          Add to Food Log
        </button>
      </div>

      {/* Mobile sticky bottom bar */}
      <div className="fixed bottom-16 left-0 right-0 md:hidden bg-white/90 dark:bg-zinc-900/90 backdrop-blur-sm border-t border-zinc-200/50 dark:border-zinc-700/50 px-4 py-3 z-40">
        <button
          onClick={() => setShowLog(true)}
          className="w-full flex items-center justify-center gap-2 rounded-2xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 py-3.5 text-sm font-bold hover:opacity-90 transition-opacity"
        >
          Add to Food Log
        </button>
      </div>

      {showLog && (
        <HealthyLogModal
          recipe={recipe}
          onLogged={() => {}}
          onClose={() => setShowLog(false)}
        />
      )}
    </div>
  )
}
