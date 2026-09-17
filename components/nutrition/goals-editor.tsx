'use client'

import { useState } from 'react'
import { X, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Target {
  calories: number
  proteinG: number
  carbohydrateG: number
  fatG: number
}

interface Props {
  current: Target
  onSaved: (target: Target) => void
  onClose: () => void
}

export function GoalsEditor({ current, onSaved, onClose }: Props) {
  const [values, setValues] = useState({
    calories: current.calories,
    proteinG: current.proteinG,
    carbohydrateG: current.carbohydrateG,
    fatG: current.fatG,
  })
  const [saving, setSaving] = useState(false)

  const set = (key: keyof typeof values, val: string) => {
    const n = parseInt(val, 10)
    if (!isNaN(n) && n >= 0) setValues(v => ({ ...v, [key]: n }))
  }

  const save = async () => {
    setSaving(true)
    await fetch('/api/nutrition/targets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    })
    onSaved(values)
    setSaving(false)
    onClose()
  }

  // Rough macro calorie check
  const macroCals = values.proteinG * 4 + values.carbohydrateG * 4 + values.fatG * 9

  const fields = [
    { key: 'calories' as const, label: 'Daily Calories', unit: 'cal', color: 'text-emerald-500' },
    { key: 'proteinG' as const, label: 'Protein', unit: 'g', color: 'text-sky-500' },
    { key: 'carbohydrateG' as const, label: 'Carbohydrates', unit: 'g', color: 'text-amber-500' },
    { key: 'fatG' as const, label: 'Fat', unit: 'g', color: 'text-orange-500' },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full sm:max-w-md bg-white dark:bg-zinc-900 rounded-t-2xl sm:rounded-2xl shadow-2xl">
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-zinc-100 dark:border-zinc-800">
          <div>
            <h2 className="font-bold text-lg text-zinc-900 dark:text-white">Daily Goals</h2>
            <p className="text-xs text-zinc-400">Set your nutrition targets</p>
          </div>
          <button onClick={onClose} className="flex size-8 items-center justify-center rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400">
            <X className="size-4" />
          </button>
        </div>

        <div className="p-5 flex flex-col gap-4">
          {fields.map(({ key, label, unit, color }) => (
            <div key={key}>
              <div className="flex items-center justify-between mb-1.5">
                <label className={`text-sm font-semibold ${color}`}>{label}</label>
                <span className="text-xs text-zinc-400">{unit}</span>
              </div>
              <input
                type="number"
                min={0}
                value={values[key]}
                onChange={e => set(key, e.target.value)}
                className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-4 py-2.5 text-sm text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
          ))}

          {/* Macro calorie check */}
          <div className="rounded-xl bg-zinc-50 dark:bg-zinc-800 px-4 py-3 text-xs text-zinc-500">
            Macros add up to ~{macroCals} cal
            {Math.abs(macroCals - values.calories) > 50 && (
              <span className="ml-1 text-amber-500">
                ({macroCals > values.calories ? '+' : ''}{macroCals - values.calories} vs your calorie goal)
              </span>
            )}
          </div>

          <Button onClick={save} disabled={saving} className="w-full mt-1">
            {saving ? <><Loader2 className="size-4 animate-spin" /> Saving...</> : 'Save goals'}
          </Button>
        </div>
      </div>
    </div>
  )
}
