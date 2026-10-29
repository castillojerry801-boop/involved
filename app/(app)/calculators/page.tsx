'use client'

import Link from 'next/link'
import { Flame, PieChart, Dumbbell, Scale, Heart, Timer, ChevronRight } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'

const CALCULATOR_GROUPS: Array<{
  group: string
  items: Array<{
    href:        string
    icon:        React.ElementType
    iconBg:      string
    iconColor:   string
    title:       string
    description: string
  }>
}> = [
  {
    group: 'Nutrition & Body Composition',
    items: [
      {
        href:        '/calculators/tdee',
        icon:        Flame,
        iconBg:      'bg-orange-100 dark:bg-orange-900/20',
        iconColor:   'text-orange-500',
        title:       'TDEE & BMR',
        description: 'Estimate your daily calorie needs from body stats and activity level.',
      },
      {
        href:        '/calculators/macros',
        icon:        PieChart,
        iconBg:      'bg-emerald-100 dark:bg-emerald-900/20',
        iconColor:   'text-emerald-500',
        title:       'Macro Goals',
        description: 'Distribute calories into protein, carbohydrate, and fat targets.',
      },
      {
        href:        '/calculators/weight-goal',
        icon:        Scale,
        iconBg:      'bg-sky-100 dark:bg-sky-900/20',
        iconColor:   'text-sky-500',
        title:       'Weight-Goal Timeline',
        description: 'Estimate weeks to your target weight at a selected weekly rate.',
      },
    ],
  },
  {
    group: 'Training & Performance',
    items: [
      {
        href:        '/calculators/one-rep-max',
        icon:        Dumbbell,
        iconBg:      'bg-violet-100 dark:bg-violet-900/20',
        iconColor:   'text-violet-500',
        title:       'Estimated 1-Rep Max',
        description: 'Estimate your one-rep maximum and view training load percentages.',
      },
      {
        href:        '/calculators/heart-rate-zones',
        icon:        Heart,
        iconBg:      'bg-rose-100 dark:bg-rose-900/20',
        iconColor:   'text-rose-500',
        title:       'Heart Rate Zones',
        description: 'Calculate five training zones from age or a measured max heart rate.',
      },
      {
        href:        '/calculators/pace',
        icon:        Timer,
        iconBg:      'bg-indigo-100 dark:bg-indigo-900/20',
        iconColor:   'text-indigo-500',
        title:       'Running Pace',
        description: 'Calculate pace, speed, finish time, and race projections.',
      },
    ],
  },
]

export default function CalculatorsHubPage() {
  return (
    <div className="mx-auto max-w-lg px-4 py-8 md:px-8">
      <PageHeader
        title="Fitness Calculators"
        subtitle="Estimates for reference — not medical advice"
      />
      <div className="mt-6 space-y-6">
        {CALCULATOR_GROUPS.map(({ group, items }) => (
          <div key={group}>
            <p className="text-[11px] font-semibold text-zinc-400 uppercase tracking-widest mb-2 px-1">
              {group}
            </p>
            <div className="space-y-2">
              {items.map(({ href, icon: Icon, iconBg, iconColor, title, description }) => (
                <Link
                  key={href}
                  href={href}
                  className="flex items-center gap-4 rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-4 transition-colors hover:border-zinc-200 dark:hover:border-zinc-700 active:opacity-80"
                >
                  <div className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${iconBg}`}>
                    <Icon className={`size-5 ${iconColor}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-zinc-900 dark:text-white">{title}</p>
                    <p className="text-xs text-zinc-400 mt-0.5 leading-tight">{description}</p>
                  </div>
                  <ChevronRight className="size-4 text-zinc-300 dark:text-zinc-600 shrink-0" />
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
