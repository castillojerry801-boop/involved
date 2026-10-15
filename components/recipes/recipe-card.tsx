'use client'

import Image from 'next/image'
import Link from 'next/link'
import { Clock, ChefHat, Bookmark, BookmarkCheck } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { RecipeStatus } from '@prisma/client'

export interface RecipeCardData {
  id: string
  name: string
  description: string | null
  servings: number
  prepMinutes: number | null
  cookMinutes: number | null
  status: RecipeStatus
  imageUrl: string | null
  cachedCalPerServing: number | null
  cachedProteinGPerServing: number | null
  cachedCarbGPerServing: number | null
  cachedFatGPerServing: number | null
  nutritionComplete: boolean
  creatorName: string | null
  userId: string
  savedByMe: boolean
  saveCount?: number
  _count?: { ingredients: number; saves: number }
}

interface RecipeCardProps {
  recipe: RecipeCardData
  currentUserId: string
  onSave?: (id: string) => void
  savePending?: boolean
  href?: string
}

const STATUS_BADGE: Partial<Record<RecipeStatus, { label: string; className: string }>> = {
  draft:    { label: 'Draft',    className: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400' },
  private:  { label: 'Private',  className: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400' },
  pending:  { label: 'In Review', className: 'bg-amber-50 text-amber-600 dark:bg-amber-950/30 dark:text-amber-400' },
  rejected: { label: 'Rejected', className: 'bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400' },
}

export function RecipeCard({ recipe, currentUserId, onSave, savePending, href }: RecipeCardProps) {
  const isOwner = recipe.userId === currentUserId
  const totalMinutes = (recipe.prepMinutes ?? 0) + (recipe.cookMinutes ?? 0)
  const badge = STATUS_BADGE[recipe.status]
  const detailHref = href ?? `/recipes/${recipe.id}`

  return (
    <div className="group relative rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden shadow-sm hover:shadow-md transition-shadow">
      {/* Image area */}
      <Link href={detailHref} className="block">
        <div className="relative h-44 bg-zinc-100 dark:bg-zinc-800">
          {recipe.imageUrl ? (
            <Image
              src={recipe.imageUrl}
              alt={recipe.name}
              fill
              className="object-cover"
              sizes="(max-width: 640px) 100vw, 50vw"
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <ChefHat className="size-10 text-zinc-300 dark:text-zinc-600" />
            </div>
          )}

          {/* Status badge for owner */}
          {isOwner && badge && (
            <span className={cn('absolute top-2 left-2 rounded-full px-2 py-0.5 text-xs font-semibold', badge.className)}>
              {badge.label}
            </span>
          )}
        </div>
      </Link>

      {/* Body */}
      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <Link href={detailHref} className="flex-1 min-w-0">
            <h3 className="font-semibold text-zinc-900 dark:text-white truncate">{recipe.name}</h3>
            {recipe.description && (
              <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400 line-clamp-2">{recipe.description}</p>
            )}
          </Link>

          {/* Save button — only for published recipes by non-owners */}
          {recipe.status === 'published' && !isOwner && onSave && (
            <button
              onClick={() => onSave(recipe.id)}
              disabled={savePending}
              aria-label={recipe.savedByMe ? 'Unsave recipe' : 'Save recipe'}
              className="shrink-0 flex size-8 items-center justify-center rounded-full text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-40"
            >
              {recipe.savedByMe
                ? <BookmarkCheck className="size-4 text-emerald-500" />
                : <Bookmark className="size-4" />}
            </button>
          )}
        </div>

        {/* Meta row */}
        <div className="mt-3 flex items-center gap-3 text-xs text-zinc-400 dark:text-zinc-500">
          {totalMinutes > 0 && (
            <span className="flex items-center gap-1">
              <Clock className="size-3" />
              {totalMinutes} min
            </span>
          )}
          <span>{recipe.servings} serving{recipe.servings !== 1 ? 's' : ''}</span>
          {recipe.creatorName && recipe.status === 'published' && !isOwner && (
            <span className="truncate">by {recipe.creatorName}</span>
          )}
        </div>

        {/* Nutrition row */}
        {recipe.nutritionComplete && recipe.cachedCalPerServing != null ? (
          <div className="mt-2 flex gap-3 text-xs">
            <span className="font-semibold text-zinc-700 dark:text-zinc-300">{Math.round(recipe.cachedCalPerServing)} cal</span>
            <span className="text-sky-500">P {recipe.cachedProteinGPerServing?.toFixed(0)}g</span>
            <span className="text-amber-500">C {recipe.cachedCarbGPerServing?.toFixed(0)}g</span>
            <span className="text-orange-500">F {recipe.cachedFatGPerServing?.toFixed(0)}g</span>
          </div>
        ) : recipe.status !== 'draft' ? (
          <p className="mt-2 text-xs text-zinc-400 italic">Nutrition not complete</p>
        ) : null}
      </div>
    </div>
  )
}
