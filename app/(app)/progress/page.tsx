import type { Metadata } from 'next'
import { TrendingUp, Calendar, Dumbbell, Scale } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

export const metadata: Metadata = { title: 'Progress' }

const DEMO_METRICS = [
  { label: 'Workouts this month', value: '14', unit: '', change: '+3 vs last month', positive: true },
  { label: 'Avg. weekly workouts', value: '3.5', unit: '/week', change: 'On track', positive: true },
  { label: 'Body weight', value: '178', unit: 'lbs', change: '-2.4 lbs (30 days)', positive: true },
  { label: 'Avg. daily calories', value: '2,140', unit: 'cal', change: 'Target: 2,200', positive: null },
]

const DEMO_PBs = [
  { exercise: 'Back Squat', weight: '225 lbs', date: 'Sep 8' },
  { exercise: 'Deadlift', weight: '275 lbs', date: 'Aug 29' },
  { exercise: 'Bench Press', weight: '185 lbs', date: 'Sep 3' },
]

const MONTHS = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep']
const DEMO_WORKOUT_COUNTS = [8, 11, 9, 13, 12, 14]

const maxCount = Math.max(...DEMO_WORKOUT_COUNTS)

export default function ProgressPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-6 md:px-8 md:py-8">

      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-zinc-900 dark:text-white">Progress</h1>
          <p className="text-sm text-zinc-500">Last 30 days</p>
        </div>
        <Button size="sm" variant="secondary">
          <Calendar className="size-4" />
          Range
        </Button>
      </div>

      {/* Key metrics */}
      <div className="mb-4 grid grid-cols-2 gap-3">
        {DEMO_METRICS.map(({ label, value, unit, change, positive }) => (
          <Card key={label} className="py-4">
            <p className="text-xs text-zinc-400 mb-1">{label}</p>
            <p className="text-2xl font-black text-zinc-900 dark:text-white leading-none">
              {value}
              {unit && <span className="text-sm font-normal text-zinc-400 ml-0.5">{unit}</span>}
            </p>
            {change && (
              <p className={`text-xs mt-1.5 font-medium ${
                positive === true ? 'text-emerald-600' :
                positive === false ? 'text-red-500' :
                'text-zinc-400'
              }`}>
                {change}
              </p>
            )}
          </Card>
        ))}
      </div>

      {/* Workout volume chart */}
      <Card className="mb-4">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-xs font-bold uppercase tracking-widest text-zinc-400">Workout volume</p>
          <Badge variant="default">6 months</Badge>
        </div>
        <div className="flex items-end gap-2 h-24">
          {DEMO_WORKOUT_COUNTS.map((count, i) => (
            <div key={MONTHS[i]} className="flex flex-1 flex-col items-center gap-1">
              <div className="w-full flex items-end justify-center" style={{ height: 80 }}>
                <div
                  className="w-full rounded-t-md bg-emerald-500"
                  style={{ height: `${(count / maxCount) * 80}px` }}
                />
              </div>
              <p className="text-[10px] text-zinc-400">{MONTHS[i]}</p>
            </div>
          ))}
        </div>
      </Card>

      {/* Personal bests */}
      <Card className="mb-4">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-xs font-bold uppercase tracking-widest text-zinc-400">Personal bests</p>
          <Dumbbell className="size-4 text-zinc-300" />
        </div>
        <div className="flex flex-col gap-0">
          {DEMO_PBs.map(({ exercise, weight, date }) => (
            <div
              key={exercise}
              className="flex items-center justify-between py-3 border-b border-zinc-100 dark:border-zinc-800 last:border-0"
            >
              <p className="text-sm font-semibold text-zinc-900 dark:text-white">{exercise}</p>
              <div className="flex items-center gap-3">
                <p className="text-sm font-black text-emerald-600">{weight}</p>
                <p className="text-xs text-zinc-400">{date}</p>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Body measurements — coming soon */}
      <div className="rounded-2xl border border-dashed border-zinc-200 bg-white p-6 text-center dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-2 flex justify-center">
          <Scale className="size-6 text-zinc-300" />
        </div>
        <p className="font-semibold text-zinc-900 dark:text-white">Body measurements & photos</p>
        <p className="mt-1 text-sm text-zinc-500">
          Log body weight, measurements, and progress photos to see your full picture — coming next.
        </p>
      </div>
    </div>
  )
}
