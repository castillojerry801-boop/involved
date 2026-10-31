'use client'

import Image from 'next/image'
import Link from 'next/link'
import { ChefHat, Clock, Bookmark, BookmarkCheck } from 'lucide-react'
import type { YMoveRecipeSummary } from '@/lib/ymove/recipes'

const DIET_LABELS: Record<string, string> = {
  high_protein:  'High Protein',
  low_carb:      'Low Carb',
  vegetarian:    'Vegetarian',
  vegan:         'Vegan',
  keto:          'Keto',
  paleo:         'Paleo',
  mediterranean: 'Mediterranean',
}

interface HealthyRecipeCardProps {
  recipe: YMoveRecipeSummary
  goalsCalories?: number | null
  goalsProtein?: number | null
  savedByMe?: boolean
  savePending?: boolean
  onSave?: (recipe: YMoveRecipeSummary) => void
}

export function HealthyRecipeCard({ recipe, goalsCalories, goalsProtein, savedByMe, savePending, onSave }: HealthyRecipeCardProps) {
  const totalMin = (recipe.prepTimeMin ?? 0) + (recipe.cookTimeMin ?? 0)

  const fitsGoals =
    goalsCalories != null &&
    goalsCalories > 0 &&
    goalsProtein != null &&
    goalsProtein > 0 &&
    recipe.calories <= goalsCalories * 0.35 &&
    recipe.protein >= goalsProtein * 0.25

  const visibleTags = recipe.dietTags.slice(0, 2)

  return (
    <Link
      href={`/recipes/healthy/${recipe.id}`}
      className="group block rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden shadow-sm hover:shadow-md transition-shadow"
    >
      {/* Image */}
      <div className="relative h-44 bg-zinc-100 dark:bg-zinc-800">
        {recipe.imageUrl ? (
          <Image
            src={recipe.imageUrl}
            alt={recipe.title}
            fill
            className="object-cover"
            sizes="(max-width: 640px) 100vw, 50vw"
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <ChefHat className="size-10 text-zinc-300 dark:text-zinc-600" />
          </div>
        )}

        {fitsGoals && (
          <span className="absolute top-2 left-2 rounded-full bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 text-[10px] font-semibold border border-emerald-200 dark:border-emerald-700/50">
            Fits goals
          </span>
        )}

        {onSave && (
          <button
            onClick={(e) => { e.preventDefault(); onSave(recipe) }}
            disabled={savePending}
            aria-label={savedByMe ? 'Unsave recipe' : 'Save recipe'}
            className="absolute top-2 right-2 flex size-7 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm hover:bg-black/70 transition-colors disabled:opacity-50"
          >
            {savedByMe
              ? <BookmarkCheck className="size-3.5 text-emerald-400" />
              : <Bookmark className="size-3.5" />}
          </button>
        )}

        {totalMin > 0 && (
          <span className="absolute bottom-2 right-2 flex items-center gap-1 rounded-full bg-black/60 text-white px-2 py-0.5 text-[10px] font-medium backdrop-blur-sm">
            <Clock className="size-3" />
            {totalMin} min
          </span>
        )}
      </div>

      {/* Body */}
      <div className="p-3">
        <p className="font-semibold text-sm text-zinc-900 dark:text-white line-clamp-2 leading-snug mb-2">
          {recipe.title}
        </p>

        {/* Macros */}
        <div className="flex items-center gap-1.5 text-xs mb-2 flex-wrap">
          <span className="font-bold text-zinc-800 dark:text-zinc-200">
            {Math.round(recipe.calories)} cal
          </span>
          <span className="text-zinc-300 dark:text-zinc-600">·</span>
          <span className="text-sky-500">P {Math.round(recipe.protein * 10) / 10}g</span>
          <span className="text-zinc-300 dark:text-zinc-600">·</span>
          <span className="text-amber-500">C {Math.round(recipe.carbs * 10) / 10}g</span>
          <span className="text-zinc-300 dark:text-zinc-600">·</span>
          <span className="text-orange-500">F {Math.round(recipe.fat * 10) / 10}g</span>
        </div>

        {/* Diet tags */}
        {visibleTags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {visibleTags.map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 px-2 py-0.5 text-[10px] font-medium"
              >
                {DIET_LABELS[tag] ?? tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </Link>
  )
}
