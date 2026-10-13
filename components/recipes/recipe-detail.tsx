'use client'

import { useState, useCallback, useRef } from 'react'
import Image from 'next/image'
import {
  Clock, ChefHat, Bookmark, BookmarkCheck, Share2,
  AlertTriangle, CheckCircle2, Link2, Loader2, ArrowLeft, Trash2, Edit3
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { RecipeStatus } from '@prisma/client'

export interface RecipeDetail {
  id: string
  userId: string
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
  sharingConsent: boolean
  creatorName: string | null
  rejectionReason: string | null
  isAiGenerated: boolean
  createdAt: string
  updatedAt: string
  savedByMe: boolean
  saveCount: number
  ingredients: Array<{
    id: string
    foodItemId: string | null
    name: string
    quantity: number
    unit: string
    notes: string | null
    snapshotCalories: number | null
    snapshotProteinG: number | null
    snapshotCarbG: number | null
    snapshotFatG: number | null
  }>
  steps: Array<{ id: string; sortOrder: number; body: string }>
}

const MEAL_OPTIONS = [
  { id: 'breakfast', label: 'Breakfast' },
  { id: 'lunch',     label: 'Lunch' },
  { id: 'dinner',    label: 'Dinner' },
  { id: 'snack',     label: 'Snack' },
] as const

interface LogModalProps {
  recipe: RecipeDetail
  onClose: () => void
  onLogged: () => void
}

function LogModal({ recipe, onClose, onLogged }: LogModalProps) {
  const today = new Date()
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

  const [mealType, setMealType] = useState<'breakfast' | 'lunch' | 'dinner' | 'snack'>('lunch')
  const [logDate, setLogDate] = useState(todayStr)
  const [servings, setServings] = useState(1)
  const [manualCal, setManualCal] = useState('')
  const [manualPro, setManualPro] = useState('')
  const [manualCarb, setManualCarb] = useState('')
  const [manualFat, setManualFat] = useState('')
  const [logging, setLogging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submittingRef = useRef(false)
  const idempotencyKey = useRef(
    typeof crypto !== 'undefined' ? crypto.randomUUID() : Math.random().toString(36)
  )

  const incomplete = !recipe.nutritionComplete

  const preview = recipe.nutritionComplete && recipe.cachedCalPerServing != null
    ? {
        cal:  Math.round(recipe.cachedCalPerServing * servings),
        pro:  Math.round((recipe.cachedProteinGPerServing ?? 0) * servings * 10) / 10,
        carb: Math.round((recipe.cachedCarbGPerServing ?? 0) * servings * 10) / 10,
        fat:  Math.round((recipe.cachedFatGPerServing ?? 0) * servings * 10) / 10,
      }
    : null

  const handleLog = useCallback(async () => {
    if (submittingRef.current) return
    submittingRef.current = true
    setLogging(true)
    setError(null)

    const body: Record<string, unknown> = {
      mealType,
      logDate,
      servingMultiplier: servings,
      idempotencyKey: idempotencyKey.current,
    }

    if (incomplete) {
      const cal = parseFloat(manualCal), pro = parseFloat(manualPro)
      const carb = parseFloat(manualCarb), fat = parseFloat(manualFat)
      if (isNaN(cal) || isNaN(pro) || isNaN(carb) || isNaN(fat)) {
        setError('Please fill in all nutrition values')
        submittingRef.current = false
        setLogging(false)
        return
      }
      body.manualNutrition = { calories: cal, proteinG: pro, carbG: carb, fatG: fat }
    }

    const res = await fetch(`/api/recipes/${recipe.id}/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const data = await res.json().catch(() => ({})) as { message?: string }
      setError(data.message ?? 'Failed to log recipe')
      submittingRef.current = false
      setLogging(false)
      return
    }

    onLogged()
  }, [mealType, logDate, servings, incomplete, manualCal, manualPro, manualCarb, manualFat, recipe.id, onLogged])

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl bg-white dark:bg-zinc-900 shadow-xl px-5 py-5 space-y-4">
        <h3 className="font-bold text-zinc-900 dark:text-white">Log {recipe.name}</h3>

        {/* Incomplete nutrition warning */}
        {incomplete && (
          <div className="flex gap-2 rounded-xl bg-amber-50 dark:bg-amber-950/20 px-3 py-2.5 text-sm text-amber-700 dark:text-amber-400">
            <AlertTriangle className="size-4 shrink-0 mt-0.5" />
            <span>Some ingredients are unmatched. Enter nutrition manually to continue.</span>
          </div>
        )}

        {/* Date */}
        <div>
          <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Date</label>
          <input
            type="date"
            value={logDate}
            max={todayStr}
            onChange={(e) => e.target.value && setLogDate(e.target.value)}
            className="mt-1 w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-white focus:outline-none"
          />
        </div>

        {/* Meal type */}
        <div>
          <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Meal</label>
          <div className="mt-1 grid grid-cols-4 gap-1">
            {MEAL_OPTIONS.map(({ id, label }) => (
              <button
                key={id}
                onClick={() => setMealType(id)}
                className={cn(
                  'rounded-lg py-1.5 text-xs font-semibold transition-colors',
                  mealType === id
                    ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900'
                    : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Servings */}
        <div>
          <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Servings</label>
          <div className="mt-1 flex items-center gap-3">
            <button
              onClick={() => setServings((s) => Math.max(0.5, Math.round((s - 0.5) * 10) / 10))}
              className="flex size-8 items-center justify-center rounded-full border border-zinc-200 dark:border-zinc-700 text-zinc-500"
            >—</button>
            <input
              type="number" min={0.5} step={0.5}
              value={servings}
              onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v) && v > 0) setServings(Math.round(v * 10) / 10) }}
              className="w-16 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-2 py-1.5 text-sm text-center text-zinc-900 dark:text-white focus:outline-none"
            />
            <button
              onClick={() => setServings((s) => Math.round((s + 0.5) * 10) / 10)}
              className="flex size-8 items-center justify-center rounded-full border border-zinc-200 dark:border-zinc-700 text-zinc-500"
            >+</button>
          </div>
        </div>

        {/* Nutrition preview or manual entry */}
        {preview && (
          <p className="text-sm text-zinc-500">
            <span className="font-semibold text-zinc-900 dark:text-white">{preview.cal} cal</span>
            {' · '}P {preview.pro}g · C {preview.carb}g · F {preview.fat}g
          </p>
        )}

        {incomplete && (() => {
          const cal = parseFloat(manualCal), pro = parseFloat(manualPro)
          const carb = parseFloat(manualCarb), fat = parseFloat(manualFat)
          const manualPreview = (!isNaN(cal) && !isNaN(pro) && !isNaN(carb) && !isNaN(fat))
            ? {
                cal:  Math.round(cal * servings),
                pro:  Math.round(pro * servings * 10) / 10,
                carb: Math.round(carb * servings * 10) / 10,
                fat:  Math.round(fat * servings * 10) / 10,
              }
            : null
          return (
            <div className="space-y-2">
              <p className="text-xs text-zinc-500">
                Enter nutrition for 1 serving. Your logged total will be multiplied by the number of servings.
              </p>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: 'Calories / serving', value: manualCal, set: setManualCal },
                  { label: 'Protein / serving (g)', value: manualPro, set: setManualPro },
                  { label: 'Carbs / serving (g)', value: manualCarb, set: setManualCarb },
                  { label: 'Fat / serving (g)', value: manualFat, set: setManualFat },
                ].map(({ label, value, set }) => (
                  <div key={label}>
                    <label className="text-xs text-zinc-400">{label}</label>
                    <input
                      type="number" min={0} step={1}
                      value={value}
                      onChange={(e) => set(e.target.value)}
                      placeholder="0"
                      className="mt-0.5 w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-1.5 text-sm text-zinc-900 dark:text-white focus:outline-none"
                    />
                  </div>
                ))}
              </div>
              {manualPreview && (
                <p className="text-sm text-zinc-500">
                  Total: <span className="font-semibold text-zinc-900 dark:text-white">{manualPreview.cal} cal</span>
                  {' · '}P {manualPreview.pro}g · C {manualPreview.carb}g · F {manualPreview.fat}g
                </p>
              )}
            </div>
          )
        })()}

        {error && <p className="text-sm text-red-500">{error}</p>}

        <button
          onClick={handleLog}
          disabled={logging}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 py-3 text-sm font-bold hover:opacity-90 disabled:opacity-50"
        >
          {logging && <Loader2 className="size-4 animate-spin" />}
          Log This Meal
        </button>
      </div>
    </div>
  )
}

// ── Submit-for-community modal ─────────────────────────────────────────────────

interface SubmitModalProps {
  recipe: RecipeDetail
  onClose: () => void
  onSubmitted: () => void
}

function SubmitModal({ recipe, onClose, onSubmitted }: SubmitModalProps) {
  const [consent, setConsent] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async () => {
    if (!consent) { setError('You must agree to share this recipe'); return }
    setSubmitting(true)
    const res = await fetch(`/api/recipes/${recipe.id}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sharingConsent: true }),
    })
    if (!res.ok) {
      const d = await res.json().catch(() => ({})) as { error?: string }
      setError(d.error ?? 'Failed to submit')
      setSubmitting(false)
      return
    }
    onSubmitted()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl bg-white dark:bg-zinc-900 shadow-xl px-5 py-5 space-y-4">
        <h3 className="font-bold text-zinc-900 dark:text-white">Share with Community</h3>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Your recipe will be submitted for review. Once approved, it will appear in Discover for all Involved members.
        </p>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Your name (&ldquo;{recipe.creatorName ?? 'You'}&rdquo;) will be credited as the creator.
        </p>
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            className="mt-0.5 size-4 rounded"
          />
          <span className="text-sm text-zinc-700 dark:text-zinc-300">
            I agree to share this recipe with the Involved community under a non-exclusive license. I confirm this is my own original recipe or I have rights to share it.
          </span>
        </label>
        {error && <p className="text-sm text-red-500">{error}</p>}
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-xl border border-zinc-200 dark:border-zinc-700 py-2.5 text-sm text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || !consent}
            className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 py-2.5 text-sm font-bold disabled:opacity-50"
          >
            {submitting && <Loader2 className="size-4 animate-spin" />}
            Submit
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main detail view ──────────────────────────────────────────────────────────

interface RecipeDetailViewProps {
  recipe: RecipeDetail
  currentUserId: string
  onBack?: () => void
  onDeleted?: () => void
  onEdit?: () => void
  onRefresh?: () => void
}

export function RecipeDetailView({ recipe, currentUserId, onBack, onDeleted, onEdit, onRefresh }: RecipeDetailViewProps) {
  const [showLog, setShowLog] = useState(false)
  const [showSubmit, setShowSubmit] = useState(false)
  const [savePending, setSavePending] = useState(false)
  const [savedByMe, setSavedByMe] = useState(recipe.savedByMe)
  const [deleting, setDeleting] = useState(false)
  // Yield multiplier: how many servings to prepare (scales ingredient display only — original recipe unchanged)
  const [prepServings, setPrepServings] = useState(recipe.servings)
  const yieldMultiplier = recipe.servings > 0 ? prepServings / recipe.servings : 1
  const isOwner = recipe.userId === currentUserId
  const totalMinutes = (recipe.prepMinutes ?? 0) + (recipe.cookMinutes ?? 0)
  const unresolvedCount = recipe.ingredients.filter(
    (i) => !(
      i.snapshotCalories != null && Number.isFinite(i.snapshotCalories) && i.snapshotCalories >= 0 &&
      i.snapshotProteinG != null && Number.isFinite(i.snapshotProteinG) && i.snapshotProteinG >= 0 &&
      i.snapshotCarbG    != null && Number.isFinite(i.snapshotCarbG)    && i.snapshotCarbG    >= 0 &&
      i.snapshotFatG     != null && Number.isFinite(i.snapshotFatG)     && i.snapshotFatG     >= 0
    ),
  ).length

  const handleSave = useCallback(async () => {
    if (savePending) return
    setSavePending(true)
    const res = await fetch(`/api/recipes/${recipe.id}/save`, { method: 'POST' })
    if (res.ok) {
      const d = await res.json() as { saved: boolean }
      setSavedByMe(d.saved)
    }
    setSavePending(false)
  }, [recipe.id, savePending])

  const handleDelete = useCallback(async () => {
    if (!confirm('Delete this recipe?')) return
    setDeleting(true)
    const res = await fetch(`/api/recipes/${recipe.id}`, { method: 'DELETE' })
    if (res.ok) {
      onDeleted?.()
    } else {
      const d = await res.json().catch(() => ({})) as { error?: string }
      alert(d.error ?? 'Could not delete recipe')
      setDeleting(false)
    }
  }, [recipe.id, onDeleted])

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 md:px-8 md:py-8">

      {/* Nav */}
      {onBack && (
        <button onClick={onBack} className="mb-5 flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">
          <ArrowLeft className="size-4" /> Back
        </button>
      )}

      {/* Hero image */}
      <div className="relative mb-6 h-64 rounded-2xl overflow-hidden bg-zinc-100 dark:bg-zinc-800">
        {recipe.imageUrl ? (
          <Image src={recipe.imageUrl} alt={recipe.name} fill className="object-cover" sizes="(max-width: 672px) 100vw, 672px" />
        ) : (
          <div className="flex h-full items-center justify-center">
            <ChefHat className="size-12 text-zinc-300 dark:text-zinc-600" />
          </div>
        )}
      </div>

      {/* Title + actions */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-black text-zinc-900 dark:text-white">{recipe.name}</h1>
          {recipe.creatorName && recipe.status === 'published' && !isOwner && (
            <p className="mt-0.5 text-sm text-zinc-500">by {recipe.creatorName}</p>
          )}
          {recipe.description && (
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{recipe.description}</p>
          )}
        </div>
        <div className="flex gap-1 shrink-0">
          {recipe.status === 'published' && !isOwner && (
            <button
              onClick={handleSave}
              disabled={savePending}
              className="flex size-9 items-center justify-center rounded-xl border border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-40"
            >
              {savedByMe ? <BookmarkCheck className="size-4 text-emerald-500" /> : <Bookmark className="size-4" />}
            </button>
          )}
          {isOwner && onEdit && (
            <button onClick={onEdit} className="flex size-9 items-center justify-center rounded-xl border border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800">
              <Edit3 className="size-4" />
            </button>
          )}
          {isOwner && (recipe.status === 'draft' || recipe.status === 'private' || recipe.status === 'rejected') && (
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="flex size-9 items-center justify-center rounded-xl border border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:text-red-500 hover:border-red-200 dark:hover:border-red-800 disabled:opacity-40"
            >
              {deleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
            </button>
          )}
        </div>
      </div>

      {/* Meta */}
      <div className="flex flex-wrap gap-3 mb-5 text-sm text-zinc-500">
        {totalMinutes > 0 && (
          <span className="flex items-center gap-1"><Clock className="size-3.5" /> {totalMinutes} min</span>
        )}
        <span>{recipe.servings} serving{recipe.servings !== 1 ? 's' : ''}</span>
      </div>

      {/* Rejection banner */}
      {recipe.status === 'rejected' && recipe.rejectionReason && (
        <div className="mb-5 rounded-xl bg-red-50 dark:bg-red-950/20 px-4 py-3 text-sm text-red-600 dark:text-red-400">
          <strong>Submission rejected:</strong> {recipe.rejectionReason}
        </div>
      )}

      {/* Nutrition */}
      {recipe.nutritionComplete && recipe.cachedCalPerServing != null ? (
        <div className="mb-6 rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/80 p-4">
          <p className="text-xs font-bold uppercase tracking-widest text-zinc-400 mb-2">Per Serving</p>
          <div className="flex gap-5">
            <div>
              <p className="text-2xl font-black text-zinc-900 dark:text-white">{Math.round(recipe.cachedCalPerServing)}</p>
              <p className="text-xs text-zinc-400">cal</p>
            </div>
            {[
              { label: 'Protein', value: recipe.cachedProteinGPerServing, color: 'text-sky-500' },
              { label: 'Carbs',   value: recipe.cachedCarbGPerServing,    color: 'text-amber-500' },
              { label: 'Fat',     value: recipe.cachedFatGPerServing,     color: 'text-orange-500' },
            ].map(({ label, value, color }) => (
              <div key={label}>
                <p className={`text-base font-black ${color}`}>{value?.toFixed(1)}g</p>
                <p className="text-xs text-zinc-400">{label}</p>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="mb-6 flex items-start gap-2 rounded-xl bg-amber-50 dark:bg-amber-950/20 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
          <AlertTriangle className="size-4 shrink-0 mt-0.5" />
          <span>
            {unresolvedCount > 0
              ? `${unresolvedCount} ingredient${unresolvedCount > 1 ? 's' : ''} not yet matched to the food database — nutrition cannot be calculated.`
              : 'Nutrition information is not yet complete for this recipe.'}
          </span>
        </div>
      )}

      {/* Ingredients */}
      {recipe.ingredients.length > 0 && (
        <section className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-bold text-zinc-900 dark:text-white">Ingredients</h2>
            {/* Yield adjuster: scales ingredient quantities for batch cooking */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-zinc-400">Makes</span>
              <button
                onClick={() => setPrepServings((s) => Math.max(1, s - 1))}
                className="flex size-6 items-center justify-center rounded-full border border-zinc-200 dark:border-zinc-700 text-zinc-500 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-700"
              >−</button>
              <span className="text-sm font-semibold text-zinc-900 dark:text-white w-6 text-center">{prepServings}</span>
              <button
                onClick={() => setPrepServings((s) => s + 1)}
                className="flex size-6 items-center justify-center rounded-full border border-zinc-200 dark:border-zinc-700 text-zinc-500 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-700"
              >+</button>
              <span className="text-xs text-zinc-400">serving{prepServings !== 1 ? 's' : ''}</span>
              {prepServings !== recipe.servings && (
                <button
                  onClick={() => setPrepServings(recipe.servings)}
                  className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 underline ml-1"
                >reset</button>
              )}
            </div>
          </div>
          {prepServings !== recipe.servings && (
            <p className="mb-2 text-xs text-zinc-400">
              Quantities scaled {yieldMultiplier === Math.round(yieldMultiplier) ? `${Math.round(yieldMultiplier)}×` : `${yieldMultiplier.toFixed(2)}×`} for {prepServings} serving{prepServings !== 1 ? 's' : ''}. Nutrition per serving is unchanged.
            </p>
          )}
          <ul className="space-y-2">
            {recipe.ingredients.map((ing) => {
              const nutritionOk = (
                ing.snapshotCalories != null && Number.isFinite(ing.snapshotCalories) && ing.snapshotCalories >= 0 &&
                ing.snapshotProteinG != null && ing.snapshotCarbG != null && ing.snapshotFatG != null
              )
              const scaledQty = ing.quantity * yieldMultiplier
              const displayQty = Number.isInteger(scaledQty)
                ? String(scaledQty)
                : (Math.round(scaledQty * 100) / 100).toString()
              return (
                <li key={ing.id} className="flex items-start gap-2 text-sm">
                  {nutritionOk
                    ? ing.foodItemId
                      ? <CheckCircle2 className="size-4 shrink-0 mt-0.5 text-emerald-500" />
                      : <Link2 className="size-4 shrink-0 mt-0.5 text-amber-500" />
                    : <AlertTriangle className="size-4 shrink-0 mt-0.5 text-amber-400" />}
                  <span className="text-zinc-700 dark:text-zinc-300">
                    <span className="font-medium">{displayQty} {ing.unit}</span> {ing.name}
                    {ing.notes && <span className="text-zinc-400 ml-1">({ing.notes})</span>}
                  </span>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {/* Steps */}
      {recipe.steps.length > 0 && (
        <section className="mb-8">
          <h2 className="text-base font-bold text-zinc-900 dark:text-white mb-3">Instructions</h2>
          <ol className="space-y-4">
            {recipe.steps.map((step, idx) => (
              <li key={step.id} className="flex gap-3">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-xs font-black mt-0.5">
                  {idx + 1}
                </span>
                <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* Action buttons */}
      <div className="space-y-2">
        <button
          onClick={() => setShowLog(true)}
          className="flex w-full items-center justify-center rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 py-3 text-sm font-bold hover:opacity-90"
        >
          Log This Meal
        </button>

        {isOwner && (recipe.status === 'draft' || recipe.status === 'private' || recipe.status === 'rejected') && (
          <button
            onClick={() => setShowSubmit(true)}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-zinc-200 dark:border-zinc-700 py-2.5 text-sm font-semibold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800"
          >
            <Share2 className="size-4" />
            Share with Community
          </button>
        )}
        {isOwner && recipe.status === 'pending' && (
          <p className="text-center text-sm text-amber-600 dark:text-amber-400">Pending community review</p>
        )}
      </div>

      {showLog && (
        <LogModal
          recipe={recipe}
          onClose={() => setShowLog(false)}
          onLogged={() => { setShowLog(false); onRefresh?.() }}
        />
      )}

      {showSubmit && (
        <SubmitModal
          recipe={recipe}
          onClose={() => setShowSubmit(false)}
          onSubmitted={() => { setShowSubmit(false); onRefresh?.() }}
        />
      )}
    </div>
  )
}
