'use client'

import { useState, useRef, useCallback, useId } from 'react'
import { X, Plus, Camera, Loader2, ChevronUp, ChevronDown, AlertTriangle, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { RecipeIngredientRow, toApiIngredient, hasValidNutrition, type IngredientDraft } from './recipe-ingredient-row'
import type { RecipeDetail } from './recipe-detail'

interface RecipeFormData {
  name: string
  description: string
  servings: number
  prepMinutes: string
  cookMinutes: string
}

interface CreateRecipeModalProps {
  onClose: () => void
  onCreated: (recipeId: string) => void
  editingRecipe?: RecipeDetail
}

function makeIngredient(): IngredientDraft {
  return {
    key: Math.random().toString(36).slice(2),
    foodItemId: null,
    name: '',
    quantity: 1,
    unit: '',
    notes: '',
    snapshotCalories: null,
    snapshotProteinG: null,
    snapshotCarbG: null,
    snapshotFatG: null,
  }
}

// Convert a persisted RecipeIngredient to an editable IngredientDraft.
// _baseFood is absent; synthesizeBaseFood() will reconstruct it on first quantity/unit change.
export function ingredientToDraft(ing: RecipeDetail['ingredients'][0]): IngredientDraft {
  return {
    key: Math.random().toString(36).slice(2),
    foodItemId: ing.foodItemId,
    name: ing.name,
    quantity: ing.quantity,
    unit: ing.unit,
    notes: ing.notes ?? '',
    snapshotCalories: ing.snapshotCalories,
    snapshotProteinG: ing.snapshotProteinG,
    snapshotCarbG: ing.snapshotCarbG,
    snapshotFatG: ing.snapshotFatG,
  }
}

export function CreateRecipeModal({ onClose, onCreated, editingRecipe }: CreateRecipeModalProps) {
  const isEditing = !!editingRecipe

  const [form, setForm] = useState<RecipeFormData>(() => isEditing ? {
    name: editingRecipe!.name,
    description: editingRecipe!.description ?? '',
    servings: editingRecipe!.servings,
    prepMinutes: editingRecipe!.prepMinutes != null ? String(editingRecipe!.prepMinutes) : '',
    cookMinutes: editingRecipe!.cookMinutes != null ? String(editingRecipe!.cookMinutes) : '',
  } : {
    name: '',
    description: '',
    servings: 1,
    prepMinutes: '',
    cookMinutes: '',
  })

  const [ingredients, setIngredients] = useState<IngredientDraft[]>(() =>
    isEditing && editingRecipe!.ingredients.length > 0
      ? editingRecipe!.ingredients.map(ingredientToDraft)
      : [makeIngredient()]
  )

  const [steps, setSteps] = useState<string[]>(() =>
    isEditing && editingRecipe!.steps.length > 0
      ? editingRecipe!.steps.map((s) => s.body)
      : ['']
  )

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Populated when the API returns 409 (published/pending recipe requires revise: true)
  const [reviseWarning, setReviseWarning] = useState<string | null>(null)
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(
    isEditing ? (editingRecipe!.imageUrl ?? null) : null
  )
  const [uploadingImage, setUploadingImage] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const labelId = useId()

  const unresolvedCount = ingredients.filter(
    (i) => i.name.trim() && !hasValidNutrition(i),
  ).length
  const hasIngredients = ingredients.some((i) => i.name.trim())

  const handleImagePick = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImageFile(file)
    setImagePreview(URL.createObjectURL(file))
  }, [])

  const handleSubmit = useCallback(async (revise = false) => {
    if (!form.name.trim()) { setError('Recipe name is required'); return }
    setSaving(true)
    setError(null)
    setReviseWarning(null)

    try {
      if (isEditing) {
        // Edit mode: single PATCH with all fields
        const cleanIngredients = ingredients
          .filter((i) => i.name.trim() && i.quantity > 0)
          .map(toApiIngredient)
        const cleanSteps = steps.map((s) => s.trim()).filter(Boolean)

        const patchBody: Record<string, unknown> = {
          name: form.name.trim(),
          description: form.description.trim() || null,
          servings: form.servings,
          prepMinutes: form.prepMinutes ? parseInt(form.prepMinutes) : null,
          cookMinutes: form.cookMinutes ? parseInt(form.cookMinutes) : null,
          ingredients: cleanIngredients,
          steps: cleanSteps.map((body, i) => ({ sortOrder: i, body })),
        }
        if (revise) patchBody.revise = true

        const patchRes = await fetch(`/api/recipes/${editingRecipe!.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patchBody),
        })

        if (patchRes.status === 409) {
          const d = await patchRes.json() as { message?: string }
          setReviseWarning(
            d.message ?? 'This recipe requires re-review before changes take effect.',
          )
          setSaving(false)
          return
        }

        if (!patchRes.ok) {
          const d = await patchRes.json().catch(() => ({})) as { error?: string }
          throw new Error(d.error ?? 'Failed to save recipe')
        }

        if (imageFile) {
          setUploadingImage(true)
          const fd = new FormData()
          fd.append('image', imageFile)
          await fetch(`/api/recipes/${editingRecipe!.id}/image`, { method: 'POST', body: fd })
          setUploadingImage(false)
        }

        onCreated(editingRecipe!.id)
      } else {
        // Create mode: POST recipe, then PATCH with ingredients + steps
        const createRes = await fetch('/api/recipes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: form.name.trim(),
            description: form.description.trim() || null,
            servings: form.servings,
            prepMinutes: form.prepMinutes ? parseInt(form.prepMinutes) : null,
            cookMinutes: form.cookMinutes ? parseInt(form.cookMinutes) : null,
          }),
        })
        if (!createRes.ok) throw new Error('Failed to create recipe')
        const { recipe } = await createRes.json() as { recipe: { id: string } }

        const cleanIngredients = ingredients
          .filter((i) => i.name.trim() && i.quantity > 0)
          .map(toApiIngredient)
        const cleanSteps = steps.map((s) => s.trim()).filter(Boolean)

        if (cleanIngredients.length > 0 || cleanSteps.length > 0) {
          await fetch(`/api/recipes/${recipe.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ingredients: cleanIngredients,
              steps: cleanSteps.map((body, i) => ({ sortOrder: i, body })),
            }),
          })
        }

        if (imageFile) {
          setUploadingImage(true)
          const fd = new FormData()
          fd.append('image', imageFile)
          await fetch(`/api/recipes/${recipe.id}/image`, { method: 'POST', body: fd })
          setUploadingImage(false)
        }

        onCreated(recipe.id)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setSaving(false)
      setUploadingImage(false)
    }
  }, [form, ingredients, steps, imageFile, isEditing, editingRecipe, onCreated])

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full sm:max-w-xl max-h-[92dvh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-white dark:bg-zinc-900 shadow-xl">

        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-5 py-4">
          <h2 id={labelId} className="text-base font-bold text-zinc-900 dark:text-white">
            {isEditing ? 'Edit Recipe' : 'New Recipe'}
          </h2>
          <button
            onClick={onClose}
            className="flex size-7 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="px-5 py-5 space-y-5">

          {/* Photo */}
          <div>
            <button
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                'relative w-full h-40 rounded-xl border-2 border-dashed flex items-center justify-center overflow-hidden transition-colors',
                imagePreview
                  ? 'border-transparent'
                  : 'border-zinc-200 dark:border-zinc-700 hover:border-zinc-300',
              )}
            >
              {imagePreview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={imagePreview} alt="Recipe photo" className="h-full w-full object-cover" />
              ) : (
                <div className="flex flex-col items-center gap-1 text-zinc-400">
                  <Camera className="size-6" />
                  <span className="text-sm">Add photo</span>
                </div>
              )}
              {imagePreview && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 hover:opacity-100 transition-opacity">
                  <span className="text-white text-sm font-semibold">Change photo</span>
                </div>
              )}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={handleImagePick}
            />
          </div>

          {/* Basic info */}
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-1">Recipe Name</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Chicken Stir-Fry"
                className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-4 py-2.5 text-sm text-zinc-900 dark:text-white placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-400"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-1">Description</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Brief description (optional)"
                rows={2}
                className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-4 py-2.5 text-sm text-zinc-900 dark:text-white placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-400 resize-none"
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-1">Servings</label>
                <input
                  type="number" min={1} step={1}
                  value={form.servings}
                  onChange={(e) => setForm((f) => ({ ...f, servings: parseInt(e.target.value) || 1 }))}
                  className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2.5 text-sm text-zinc-900 dark:text-white text-center focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-1">Prep (min)</label>
                <input
                  type="number" min={0} step={5}
                  value={form.prepMinutes}
                  onChange={(e) => setForm((f) => ({ ...f, prepMinutes: e.target.value }))}
                  placeholder="—"
                  className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2.5 text-sm text-zinc-900 dark:text-white text-center focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-1">Cook (min)</label>
                <input
                  type="number" min={0} step={5}
                  value={form.cookMinutes}
                  onChange={(e) => setForm((f) => ({ ...f, cookMinutes: e.target.value }))}
                  placeholder="—"
                  className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2.5 text-sm text-zinc-900 dark:text-white text-center focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* Ingredients */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Ingredients</label>
              {hasIngredients && unresolvedCount > 0 && (
                <span className="flex items-center gap-1 text-xs text-amber-500">
                  <AlertTriangle className="size-3" />
                  {unresolvedCount} unmatched
                </span>
              )}
            </div>
            <div className="space-y-2">
              {ingredients.map((ing, idx) => (
                <RecipeIngredientRow
                  key={ing.key}
                  ingredient={ing}
                  onChange={(updated) => {
                    setIngredients((prev) => prev.map((i) => i.key === ing.key ? updated : i))
                  }}
                  onRemove={() => {
                    if (ingredients.length === 1) {
                      setIngredients([makeIngredient()])
                    } else {
                      setIngredients((prev) => prev.filter((_, i) => i !== idx))
                    }
                  }}
                />
              ))}
            </div>
            <button
              onClick={() => setIngredients((prev) => [...prev, makeIngredient()])}
              className="mt-2 flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
            >
              <Plus className="size-3.5" /> Add ingredient
            </button>
          </div>

          {/* Steps */}
          <div>
            <label className="block text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">Instructions</label>
            <div className="space-y-2">
              {steps.map((step, idx) => (
                <div key={idx} className="flex gap-2 items-start">
                  <span className="mt-2.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800 text-xs font-bold text-zinc-500">
                    {idx + 1}
                  </span>
                  <textarea
                    value={step}
                    onChange={(e) => setSteps((prev) => prev.map((s, i) => i === idx ? e.target.value : s))}
                    placeholder={`Step ${idx + 1}`}
                    rows={2}
                    className="flex-1 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-white placeholder-zinc-400 focus:outline-none resize-none"
                  />
                  <div className="flex flex-col gap-0.5 mt-1">
                    <button
                      disabled={idx === 0}
                      onClick={() => setSteps((p) => { const s = [...p]; [s[idx - 1], s[idx]] = [s[idx], s[idx - 1]]; return s })}
                      className="flex size-6 items-center justify-center rounded text-zinc-300 hover:text-zinc-500 disabled:opacity-30"
                    >
                      <ChevronUp className="size-3.5" />
                    </button>
                    <button
                      disabled={idx === steps.length - 1}
                      onClick={() => setSteps((p) => { const s = [...p]; [s[idx + 1], s[idx]] = [s[idx], s[idx + 1]]; return s })}
                      className="flex size-6 items-center justify-center rounded text-zinc-300 hover:text-zinc-500 disabled:opacity-30"
                    >
                      <ChevronDown className="size-3.5" />
                    </button>
                    {steps.length > 1 && (
                      <button
                        onClick={() => setSteps((p) => p.filter((_, i) => i !== idx))}
                        className="flex size-6 items-center justify-center rounded text-zinc-300 hover:text-red-400 transition-colors"
                      >
                        <Trash2 className="size-3" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <button
              onClick={() => setSteps((prev) => [...prev, ''])}
              className="mt-2 flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
            >
              <Plus className="size-3.5" /> Add step
            </button>
          </div>

          {/* Error */}
          {error && (
            <p className="rounded-xl bg-red-50 dark:bg-red-950/20 px-4 py-3 text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          )}

          {/* Published recipe revise confirmation */}
          {reviseWarning && (
            <div className="rounded-xl bg-amber-50 dark:bg-amber-950/20 px-4 py-3 space-y-3">
              <div className="flex gap-2 text-sm text-amber-700 dark:text-amber-400">
                <AlertTriangle className="size-4 shrink-0 mt-0.5" />
                <span>{reviseWarning}</span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setReviseWarning(null)}
                  className="flex-1 rounded-xl border border-amber-200 dark:border-amber-800 py-2 text-sm font-medium text-amber-700 dark:text-amber-400"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleSubmit(true)}
                  disabled={saving}
                  className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-amber-600 text-white py-2 text-sm font-semibold disabled:opacity-60"
                >
                  {saving && <Loader2 className="size-3.5 animate-spin" />}
                  Confirm &amp; Save
                </button>
              </div>
            </div>
          )}

          {/* Footer */}
          <div className="pb-2 space-y-2">
            {isEditing ? (
              <div className="flex gap-2">
                <button
                  onClick={onClose}
                  className="flex-1 rounded-xl border border-zinc-200 dark:border-zinc-700 py-3 text-sm font-semibold text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleSubmit()}
                  disabled={saving || !form.name.trim() || !!reviseWarning}
                  className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 py-3 text-sm font-bold hover:opacity-90 disabled:opacity-50 transition-opacity"
                >
                  {(saving || uploadingImage) && <Loader2 className="size-4 animate-spin" />}
                  {uploadingImage ? 'Uploading…' : saving ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            ) : (
              <>
                <button
                  onClick={() => handleSubmit()}
                  disabled={saving || !form.name.trim()}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 py-3 text-sm font-bold hover:opacity-90 disabled:opacity-50 transition-opacity"
                >
                  {(saving || uploadingImage) && <Loader2 className="size-4 animate-spin" />}
                  {uploadingImage ? 'Uploading photo…' : saving ? 'Saving…' : 'Save Recipe'}
                </button>
                <p className="text-center text-xs text-zinc-400">
                  Recipes are private by default. You can share with the community later.
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
