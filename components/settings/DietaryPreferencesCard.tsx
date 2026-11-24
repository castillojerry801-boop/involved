'use client'

import { useState, useEffect, useCallback } from 'react'
import { cn } from '@/lib/utils'
import {
  ALL_DIETARY_APPROACHES,
  ALL_ALLERGEN_SEVERITIES,
  detectDietaryConflicts,
  type DietaryApproach,
  type AllergenSeverity,
} from '@/lib/nutrition/dietary-conflicts'

const APPROACH_LABELS: Record<DietaryApproach, string> = {
  keto:          'Keto',
  carnivore:     'Carnivore',
  vegan:         'Vegan',
  vegetarian:    'Vegetarian',
  mediterranean: 'Mediterranean',
  paleo:         'Paleo',
  low_carb:      'Low Carb',
  high_protein:  'High Protein',
  plant_based:   'Plant-Based',
  gluten_free:   'Gluten-Free',
  dairy_free:    'Dairy-Free',
}

const SEVERITY_LABELS: Record<AllergenSeverity, string> = {
  allergy:     'Allergy',
  intolerance: 'Intolerance',
  dislike:     'Dislike',
}

interface AllergenRow { name: string; severity: AllergenSeverity; notes: string }
interface ExclusionRow { ingredient: string; reason: string }

interface Preference {
  approaches: DietaryApproach[]
  mealsPerDay: number | null
  snacksPerDay: number | null
  notes: string | null
  allergens: Array<{ id: string; name: string; severity: string; notes: string | null }>
  exclusions: Array<{ id: string; ingredient: string; reason: string | null }>
}

export function DietaryPreferencesCard() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  // Form state
  const [approaches, setApproaches] = useState<DietaryApproach[]>([])
  const [mealsPerDay, setMealsPerDay] = useState<string>('')
  const [snacksPerDay, setSnacksPerDay] = useState<string>('')
  const [notes, setNotes] = useState<string>('')
  const [allergens, setAllergens] = useState<AllergenRow[]>([])
  const [exclusions, setExclusions] = useState<ExclusionRow[]>([])

  const loadPreference = useCallback(async () => {
    try {
      const res = await fetch('/api/nutrition/preferences')
      if (!res.ok) return
      const data = await res.json() as { preference: Preference | null }
      const pref = data.preference
      if (pref) {
        setApproaches(pref.approaches)
        setMealsPerDay(pref.mealsPerDay != null ? String(pref.mealsPerDay) : '')
        setSnacksPerDay(pref.snacksPerDay != null ? String(pref.snacksPerDay) : '')
        setNotes(pref.notes ?? '')
        setAllergens(pref.allergens.map(a => ({
          name: a.name,
          severity: a.severity as AllergenSeverity,
          notes: a.notes ?? '',
        })))
        setExclusions(pref.exclusions.map(e => ({
          ingredient: e.ingredient,
          reason: e.reason ?? '',
        })))
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadPreference() }, [loadPreference])

  function toggleApproach(a: DietaryApproach) {
    setApproaches(prev =>
      prev.includes(a) ? prev.filter(x => x !== a) : [...prev, a],
    )
    setSaved(false)
    setError(null)
  }

  const conflicts = detectDietaryConflicts(approaches)

  async function handleSave() {
    if (conflicts.length > 0) return
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const body = {
        approaches,
        mealsPerDay:  mealsPerDay  ? parseInt(mealsPerDay,  10) : null,
        snacksPerDay: snacksPerDay ? parseInt(snacksPerDay, 10) : null,
        notes: notes.trim() || null,
        allergens: allergens
          .filter(a => a.name.trim())
          .map(a => ({ name: a.name.trim(), severity: a.severity, notes: a.notes.trim() || null })),
        exclusions: exclusions
          .filter(e => e.ingredient.trim())
          .map(e => ({ ingredient: e.ingredient.trim(), reason: e.reason.trim() || null })),
      }
      const res = await fetch('/api/nutrition/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = await res.json() as { error?: string }
        setError(data.error ?? 'Failed to save preferences')
        return
      }
      setSaved(true)
    } catch {
      setError('Failed to save preferences')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return null

  return (
    <div className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
      <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-4">Dietary Preferences</p>

      {/* Approaches */}
      <div className="mb-5">
        <p className="text-sm font-semibold text-zinc-900 dark:text-white mb-1">Eating style</p>
        <p className="text-xs text-zinc-400 mb-3">Select all that apply. Coach V uses these when building meal plans.</p>
        <div className="flex flex-wrap gap-2">
          {ALL_DIETARY_APPROACHES.map(a => (
            <button
              key={a}
              onClick={() => toggleApproach(a)}
              className={cn(
                'px-3 py-1.5 rounded-full text-xs font-semibold transition-colors border',
                approaches.includes(a)
                  ? 'bg-zinc-900 text-white border-zinc-900 dark:bg-white dark:text-zinc-900 dark:border-white'
                  : 'bg-zinc-50 text-zinc-500 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700 hover:border-zinc-400',
              )}
            >
              {APPROACH_LABELS[a]}
            </button>
          ))}
        </div>
        {conflicts.length > 0 && (
          <div className="mt-2 rounded-lg bg-red-50 dark:bg-red-900/20 px-3 py-2">
            {conflicts.map((c, i) => (
              <p key={i} className="text-xs text-red-600 dark:text-red-400">
                <span className="font-semibold">{APPROACH_LABELS[c.approaches[0]]}</span> and{' '}
                <span className="font-semibold">{APPROACH_LABELS[c.approaches[1]]}</span> are incompatible: {c.reason}
              </p>
            ))}
          </div>
        )}
      </div>

      {/* Meal pattern */}
      <div className="flex gap-4 mb-5 pt-4 border-t border-zinc-100 dark:border-zinc-800">
        <div className="flex-1">
          <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Meals / day</label>
          <input
            type="number"
            min={1}
            max={20}
            placeholder="e.g. 3"
            value={mealsPerDay}
            onChange={e => { setMealsPerDay(e.target.value); setSaved(false) }}
            className="mt-1 w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-transparent px-3 py-2 text-sm text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-white"
          />
        </div>
        <div className="flex-1">
          <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Snacks / day</label>
          <input
            type="number"
            min={0}
            max={20}
            placeholder="e.g. 1"
            value={snacksPerDay}
            onChange={e => { setSnacksPerDay(e.target.value); setSaved(false) }}
            className="mt-1 w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-transparent px-3 py-2 text-sm text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-white"
          />
        </div>
      </div>

      {/* Allergens */}
      <div className="mb-5 pt-4 border-t border-zinc-100 dark:border-zinc-800">
        <div className="flex items-center justify-between mb-2">
          <div>
            <p className="text-sm font-semibold text-zinc-900 dark:text-white">Allergens & intolerances</p>
            <p className="text-xs text-zinc-400 mt-0.5">Unknown allergen status is treated as unverified — not safe.</p>
          </div>
          <button
            onClick={() => { setAllergens(prev => [...prev, { name: '', severity: 'allergy', notes: '' }]); setSaved(false) }}
            className="text-xs font-semibold text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors"
          >
            + Add
          </button>
        </div>
        {allergens.length === 0 && (
          <p className="text-xs text-zinc-400 italic">None added</p>
        )}
        <div className="space-y-2">
          {allergens.map((a, i) => (
            <div key={i} className="flex gap-2 items-start">
              <input
                placeholder="e.g. peanuts"
                value={a.name}
                onChange={e => {
                  const next = [...allergens]
                  next[i] = { ...next[i], name: e.target.value }
                  setAllergens(next)
                  setSaved(false)
                }}
                className="flex-1 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-transparent px-3 py-1.5 text-xs text-zinc-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-zinc-900 dark:focus:ring-white"
              />
              <select
                value={a.severity}
                onChange={e => {
                  const next = [...allergens]
                  next[i] = { ...next[i], severity: e.target.value as AllergenSeverity }
                  setAllergens(next)
                  setSaved(false)
                }}
                className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2 py-1.5 text-xs text-zinc-900 dark:text-white focus:outline-none"
              >
                {ALL_ALLERGEN_SEVERITIES.map(s => (
                  <option key={s} value={s}>{SEVERITY_LABELS[s]}</option>
                ))}
              </select>
              <button
                onClick={() => { setAllergens(prev => prev.filter((_, j) => j !== i)); setSaved(false) }}
                className="text-zinc-400 hover:text-red-500 transition-colors px-1 py-1.5 text-xs"
                aria-label="Remove allergen"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Exclusions */}
      <div className="mb-5 pt-4 border-t border-zinc-100 dark:border-zinc-800">
        <div className="flex items-center justify-between mb-2">
          <div>
            <p className="text-sm font-semibold text-zinc-900 dark:text-white">Ingredient exclusions</p>
            <p className="text-xs text-zinc-400 mt-0.5">Specific ingredients to avoid (not medical — use Allergens for those)</p>
          </div>
          <button
            onClick={() => { setExclusions(prev => [...prev, { ingredient: '', reason: '' }]); setSaved(false) }}
            className="text-xs font-semibold text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors"
          >
            + Add
          </button>
        </div>
        {exclusions.length === 0 && (
          <p className="text-xs text-zinc-400 italic">None added</p>
        )}
        <div className="space-y-2">
          {exclusions.map((e, i) => (
            <div key={i} className="flex gap-2 items-center">
              <input
                placeholder="e.g. cilantro"
                value={e.ingredient}
                onChange={ev => {
                  const next = [...exclusions]
                  next[i] = { ...next[i], ingredient: ev.target.value }
                  setExclusions(next)
                  setSaved(false)
                }}
                className="flex-1 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-transparent px-3 py-1.5 text-xs text-zinc-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-zinc-900 dark:focus:ring-white"
              />
              <input
                placeholder="reason (optional)"
                value={e.reason}
                onChange={ev => {
                  const next = [...exclusions]
                  next[i] = { ...next[i], reason: ev.target.value }
                  setExclusions(next)
                  setSaved(false)
                }}
                className="w-32 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-transparent px-3 py-1.5 text-xs text-zinc-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-zinc-900 dark:focus:ring-white"
              />
              <button
                onClick={() => { setExclusions(prev => prev.filter((_, j) => j !== i)); setSaved(false) }}
                className="text-zinc-400 hover:text-red-500 transition-colors px-1 py-1.5 text-xs"
                aria-label="Remove exclusion"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Notes */}
      <div className="mb-5 pt-4 border-t border-zinc-100 dark:border-zinc-800">
        <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Notes for Coach V</label>
        <textarea
          rows={3}
          maxLength={1000}
          placeholder='e.g. "I meal-prep on Sundays" or "I hate the texture of mushrooms"'
          value={notes}
          onChange={e => { setNotes(e.target.value); setSaved(false) }}
          className="mt-1 w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-transparent px-3 py-2 text-sm text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-white resize-none"
        />
        <p className="text-right text-[10px] text-zinc-400 mt-0.5">{notes.length}/1000</p>
      </div>

      {/* Save */}
      <div className="flex items-center gap-3 pt-4 border-t border-zinc-100 dark:border-zinc-800">
        <button
          onClick={handleSave}
          disabled={saving || conflicts.length > 0}
          className={cn(
            'px-5 py-2 rounded-xl text-sm font-semibold transition-colors',
            saving || conflicts.length > 0
              ? 'bg-zinc-200 text-zinc-400 dark:bg-zinc-700 dark:text-zinc-500 cursor-not-allowed'
              : 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 hover:opacity-90',
          )}
        >
          {saving ? 'Saving…' : 'Save preferences'}
        </button>
        {saved && <p className="text-xs font-semibold text-green-600 dark:text-green-400">Saved</p>}
        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>
    </div>
  )
}
