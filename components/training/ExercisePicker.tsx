'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Search, X, Plus, Loader2, Dumbbell } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ExerciseMeta } from '@/lib/exercises'

const BODY_PARTS = ['all', 'back', 'chest', 'shoulders', 'upper arms', 'lower arms', 'upper legs', 'lower legs', 'waist', 'neck', 'cardio']

interface Props {
  onSelect: (exercise: ExerciseMeta) => void
  onClose: () => void
  selectedIds?: Set<string>
  title?: string
}

export default function ExercisePicker({ onSelect, onClose, selectedIds, title = 'Add exercise' }: Props) {
  const [q, setQ] = useState('')
  const [bodyPart, setBodyPart] = useState('all')
  const [exercises, setExercises] = useState<ExerciseMeta[]>([])
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const search = useCallback(async (query: string, bp: string) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        q: query,
        includeCustom: 'true',
        limit: '60',
        ...(bp !== 'all' && { bodyPart: bp }),
      })
      const res = await fetch(`/api/training/exercises?${params}`)
      const data = await res.json() as { exercises: ExerciseMeta[] }
      setExercises(data.exercises ?? [])
    } catch {
      setExercises([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    inputRef.current?.focus()
    search('', 'all')
  }, [search])

  const handleQueryChange = (val: string) => {
    setQ(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => search(val, bodyPart), 250)
  }

  const handleBodyPart = (bp: string) => {
    setBodyPart(bp)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    search(q, bp)
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white dark:bg-zinc-950 md:inset-auto md:left-1/2 md:top-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:w-[560px] md:max-h-[80vh] md:rounded-2xl md:border md:border-zinc-200 md:dark:border-zinc-800 md:shadow-2xl">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 shrink-0">
        <div className="flex-1">
          <h2 className="font-black text-base text-zinc-900 dark:text-white">{title}</h2>
        </div>
        <button
          onClick={onClose}
          className="flex size-8 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
        >
          <X className="size-4 text-zinc-600 dark:text-zinc-400" />
        </button>
      </div>

      {/* Search */}
      <div className="px-4 py-3 shrink-0">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-zinc-400" />
          <input
            ref={inputRef}
            type="text"
            value={q}
            onChange={e => handleQueryChange(e.target.value)}
            placeholder="Search exercises..."
            className="w-full h-10 pl-9 pr-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 text-sm text-zinc-900 dark:text-white placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-white"
          />
        </div>
      </div>

      {/* Body part pills */}
      <div className="px-4 pb-2 shrink-0 overflow-x-auto scrollbar-none">
        <div className="flex gap-1.5 w-max">
          {BODY_PARTS.map(bp => (
            <button
              key={bp}
              onClick={() => handleBodyPart(bp)}
              className={cn(
                'px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap transition-colors capitalize',
                bodyPart === bp
                  ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900'
                  : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700'
              )}
            >
              {bp}
            </button>
          ))}
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="size-5 animate-spin text-zinc-400" />
          </div>
        ) : exercises.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 px-4 text-center">
            <div className="size-12 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
              <Dumbbell className="size-5 text-zinc-400" />
            </div>
            <p className="text-sm text-zinc-400">No exercises found</p>
          </div>
        ) : (
          <ul className="divide-y divide-zinc-50 dark:divide-zinc-900">
            {exercises.map(ex => {
              const already = selectedIds?.has(ex.id)
              return (
                <li key={ex.id}>
                  <button
                    onClick={() => !already && onSelect(ex)}
                    disabled={already}
                    className={cn(
                      'w-full flex items-center gap-3 px-4 py-3 text-left transition-colors',
                      already
                        ? 'opacity-40 cursor-default'
                        : 'hover:bg-zinc-50 dark:hover:bg-zinc-900/50 active:bg-zinc-100 dark:active:bg-zinc-900'
                    )}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-sm font-semibold text-zinc-900 dark:text-white truncate">{ex.name}</span>
                        {ex.isCustom && (
                          <span className="px-1.5 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 text-[10px] font-bold uppercase tracking-wide shrink-0">
                            Mine
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-zinc-400 capitalize mt-0.5">
                        {ex.bodyPart}{ex.equipment && ex.equipment !== 'bodyweight' ? ` · ${ex.equipment}` : ''}
                      </p>
                    </div>
                    {already ? (
                      <span className="text-xs text-zinc-400 shrink-0">Added</span>
                    ) : (
                      <Plus className="size-4 text-zinc-400 shrink-0" />
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* Custom exercise shortcut */}
      <div className="shrink-0 border-t border-zinc-100 dark:border-zinc-800 px-4 py-3">
        <a
          href="/training/exercises/custom"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
        >
          Can&apos;t find it? Create a custom exercise →
        </a>
      </div>
    </div>
  )
}
