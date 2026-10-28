import { CircleRing } from './circle-ring'
import { ConcentricMacroRings } from './concentric-macro-rings'
import { cn } from '@/lib/utils'

interface MacroData { consumed: number; target: number }

export interface NutritionRingsSummaryProps {
  calories: MacroData
  protein:  MacroData
  carbs:    MacroData
  fat:      MacroData
  loading?: boolean
}

// Calorie ring color thresholds (unrounded ratio):
//   < 75%  → emerald (green)
//   75–100% → amber  (yellow)
//   > 100%  → red
function calorieRingClass(consumed: number, target: number): string {
  if (!target) return 'text-emerald-500'
  const ratio = consumed / target
  if (ratio > 1.0)   return 'text-red-500'
  if (ratio >= 0.75) return 'text-amber-400'
  return 'text-emerald-500'
}

const MACRO_DEFS = [
  { key: 'protein' as const, label: 'Protein', color: 'text-sky-500'    },
  { key: 'carbs'   as const, label: 'Carbs',   color: 'text-amber-500'  },
  { key: 'fat'     as const, label: 'Fat',     color: 'text-orange-500' },
]

// Shared horizontal summary: [calorie ring] [concentric macro rings] [legend]
// gap-1.5 keeps rings tight enough to leave ~76px for the legend at 256px
// (Nutrition desktop sidebar md:w-72 p-4), while text-xs gives comfortable
// readability at 375px+ iPhone widths.
export function NutritionRingsSummary({
  calories, protein, carbs, fat, loading = false,
}: NutritionRingsSummaryProps) {
  const macroMap = { protein, carbs, fat }

  const ringClass = loading
    ? 'text-zinc-300 dark:text-zinc-600'
    : calorieRingClass(calories.consumed, calories.target)

  const remaining = calories.target - calories.consumed

  return (
    <div className="flex items-center justify-center gap-1.5">

      {/* ── Calorie ring ────────────────────────────────────────────────── */}
      <div className="flex flex-col items-center shrink-0">
        <div className="relative">
          <CircleRing
            value={loading ? 0 : calories.consumed}
            max={calories.target}
            size={90} stroke={9}
            className={ringClass}
          />
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-[17px] font-black text-zinc-900 dark:text-white leading-none tabular-nums">
              {loading ? '—' : calories.consumed.toLocaleString()}
            </span>
            <span className="text-[9px] text-zinc-400 mt-0.5 leading-none">
              {loading ? '' : `/ ${calories.target.toLocaleString()} cal`}
            </span>
          </div>
        </div>
        <p className={cn(
          'mt-1 text-[11px] font-medium text-center leading-tight tabular-nums',
          remaining < 0 ? 'text-red-500' : 'text-zinc-500',
        )}>
          {loading
            ? ' '
            : remaining > 0
              ? `${remaining.toLocaleString()} left`
              : remaining === 0
                ? 'Goal reached!'
                : `${Math.abs(remaining).toLocaleString()} over`}
        </p>
      </div>

      {/* ── Concentric macro rings ──────────────────────────────────────── */}
      <div className="shrink-0">
        <ConcentricMacroRings
          protein={{ consumed: loading ? 0 : protein.consumed, target: protein.target }}
          carbs={{ consumed: loading ? 0 : carbs.consumed,   target: carbs.target }}
          fat={{ consumed: loading ? 0 : fat.consumed,     target: fat.target }}
          size={82}
        />
      </div>

      {/* ── Macro legend ────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-2 min-w-0">
        {MACRO_DEFS.map(({ key, label, color }) => {
          const data   = macroMap[key]
          const isOver = !loading && data.target > 0 && data.consumed > data.target
          const excess = isOver ? Math.round((data.consumed - data.target) * 10) / 10 : 0
          return (
            <div key={key} className="flex flex-col gap-0.5">
              <span className={cn('text-xs font-bold leading-none', color)}>
                {label}
              </span>
              <span className="text-xs leading-none text-zinc-500 dark:text-zinc-400">
                {loading
                  ? '—'
                  : isOver
                    ? <>{data.consumed}g <span className="text-red-400">{excess}g over</span></>
                    : `${data.consumed}g / ${data.target}g`}
              </span>
            </div>
          )
        })}
      </div>

    </div>
  )
}
