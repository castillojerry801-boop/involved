'use client'

import { useEffect, useState } from 'react'
import { PageHeader } from '@/components/layout/PageHeader'
import { cn } from '@/lib/utils'
import { useWeightUnit } from '@/lib/hooks/use-weight-unit'
import { AppleHealthCard } from '@/components/settings/AppleHealthCard'

export default function SettingsPage() {
  const { unit, setUnit } = useWeightUnit()
  const [mounted, setMounted] = useState(false)

  useEffect(() => { setMounted(true) }, [])

  return (
    <div className="mx-auto max-w-lg px-4 py-8 md:px-8">
      <PageHeader title="Settings" backHref="/profile" />

      <div className="space-y-4">

        {/* Units */}
        <div className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-4">Units</p>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-zinc-900 dark:text-white">Weight unit</p>
              <p className="text-xs text-zinc-400 mt-0.5">Used across workouts, programs, and templates</p>
            </div>
            {mounted && (
              <div className="flex shrink-0 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden text-sm font-semibold">
                {(['lbs', 'kg'] as const).map(u => (
                  <button
                    key={u}
                    onClick={() => setUnit(u)}
                    className={cn(
                      'w-14 py-2 text-center uppercase transition-colors',
                      unit === u
                        ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900'
                        : 'text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300'
                    )}
                  >
                    {u}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <AppleHealthCard />

      </div>
    </div>
  )
}
