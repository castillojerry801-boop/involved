import type { Metadata } from 'next'
import { Plus, ChevronRight, Search } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

export const metadata: Metadata = { title: 'Nutrition' }

const DEMO_MEALS = [
  {
    name: 'Breakfast',
    time: '7:42 AM',
    calories: 520,
    items: ['Greek Yogurt (plain, 1 cup)', 'Blueberries (½ cup)', 'Granola (¼ cup)'],
  },
  {
    name: 'Lunch',
    time: '12:15 PM',
    calories: 720,
    items: ['Grilled Chicken Breast (6 oz)', 'Brown Rice (1 cup)', 'Mixed Vegetables (1 cup)'],
  },
  {
    name: 'Dinner',
    time: null,
    calories: 0,
    items: [],
  },
  {
    name: 'Snacks',
    time: null,
    calories: 400,
    items: ['Protein Shake (1 serving)', 'Apple (1 medium)'],
  },
]

const DEMO_TOTALS = {
  calories:  { consumed: 1640, target: 2200 },
  proteinG:  { consumed: 132,  target: 170 },
  carbsG:    { consumed: 180,  target: 220 },
  fatG:      { consumed: 52,   target: 70 },
}

function pct(consumed: number, target: number) {
  return Math.min(Math.round((consumed / target) * 100), 100)
}

export default function NutritionPage() {
  const { calories, proteinG, carbsG, fatG } = DEMO_TOTALS
  const remaining = calories.target - calories.consumed

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 md:px-8 md:py-8">

      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-zinc-900 dark:text-white">Nutrition</h1>
          <p className="text-sm text-zinc-500">Today's food log</p>
        </div>
        <Button size="sm">
          <Plus className="size-4" />
          Add food
        </Button>
      </div>

      {/* Daily summary card */}
      <Card className="mb-6">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-zinc-400 mb-1">Daily total</p>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-black text-zinc-900 dark:text-white">
                {calories.consumed.toLocaleString()}
              </span>
              <span className="text-sm text-zinc-400">/ {calories.target.toLocaleString()} cal</span>
            </div>
            <p className="text-sm text-zinc-500 mt-0.5">
              {remaining > 0 ? `${remaining.toLocaleString()} remaining` : 'Target reached'}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-zinc-400 mb-1">Targets</p>
            <button className="text-xs font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-white">Edit</button>
          </div>
        </div>

        {/* Calorie bar */}
        <div className="mb-5 h-3 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
          <div
            className="h-full rounded-full bg-emerald-500"
            style={{ width: `${pct(calories.consumed, calories.target)}%` }}
          />
        </div>

        {/* Macro summary */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Protein', consumed: proteinG.consumed, target: proteinG.target, color: 'bg-sky-400', textColor: 'text-sky-500' },
            { label: 'Carbs',   consumed: carbsG.consumed,   target: carbsG.target,   color: 'bg-amber-400', textColor: 'text-amber-500' },
            { label: 'Fat',     consumed: fatG.consumed,     target: fatG.target,     color: 'bg-orange-400', textColor: 'text-orange-500' },
          ].map(({ label, consumed, target, color, textColor }) => (
            <div key={label} className="flex flex-col gap-1.5">
              <p className="text-xs text-zinc-400">{label}</p>
              <p className={`text-base font-black ${textColor}`}>{consumed}g</p>
              <div className="h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                <div className={`h-full rounded-full ${color}`} style={{ width: `${pct(consumed, target)}%` }} />
              </div>
              <p className="text-xs text-zinc-400">of {target}g</p>
            </div>
          ))}
        </div>
      </Card>

      {/* Food search shortcut */}
      <button className="mb-6 flex w-full items-center gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3 text-left text-sm text-zinc-400 shadow-sm transition-colors hover:border-zinc-300 dark:border-zinc-700 dark:bg-zinc-900">
        <Search className="size-4 shrink-0" />
        Search foods, brands, or scan barcode...
      </button>

      {/* Meals */}
      <div className="flex flex-col gap-3">
        {DEMO_MEALS.map((meal) => (
          <Card key={meal.name} className="p-0 overflow-hidden">
            {/* Meal header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-100 dark:border-zinc-800">
              <div className="flex items-center gap-2">
                <p className="font-semibold text-sm text-zinc-900 dark:text-white">{meal.name}</p>
                {meal.time && (
                  <span className="text-xs text-zinc-400">{meal.time}</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {meal.calories > 0 && (
                  <span className="text-sm font-semibold text-zinc-600 dark:text-zinc-400">
                    {meal.calories} cal
                  </span>
                )}
                <button className="flex size-7 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800">
                  <Plus className="size-4" />
                </button>
              </div>
            </div>

            {/* Food items */}
            {meal.items.length > 0 ? (
              <div className="px-5 py-2">
                {meal.items.map((item) => (
                  <button
                    key={item}
                    className="flex w-full items-center justify-between py-2 text-left text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200 border-b border-zinc-50 dark:border-zinc-800/50 last:border-0"
                  >
                    {item}
                    <ChevronRight className="size-4 shrink-0 text-zinc-300 dark:text-zinc-600" />
                  </button>
                ))}
              </div>
            ) : (
              <div className="px-5 py-4">
                <p className="text-sm text-zinc-400">No foods logged yet</p>
              </div>
            )}
          </Card>
        ))}
      </div>

      {/* Coming soon */}
      <div className="mt-6 rounded-2xl border border-dashed border-zinc-200 bg-white p-6 text-center dark:border-zinc-800 dark:bg-zinc-900">
        <p className="font-semibold text-zinc-900 dark:text-white">Food search & barcode scanning</p>
        <p className="mt-1 text-sm text-zinc-500">
          Search from thousands of foods, scan barcodes, or add your own — coming in the next phase.
        </p>
      </div>
    </div>
  )
}
