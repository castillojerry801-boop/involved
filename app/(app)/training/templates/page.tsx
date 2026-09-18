'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Plus, Dumbbell, Play, Trash2, Loader2, Pencil, Copy, MoreHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Template {
  id: string
  name: string
  description: string | null
  updatedAt: string
  exercises: Array<{ exerciseId: string; trackingType: string }>
  equipmentProfile?: { id: string; name: string } | null
}

function TemplateCard({ template, onDelete, onDuplicate }: {
  template: Template
  onDelete: (id: string) => void
  onDuplicate: (id: string, copy: Template) => void
}) {
  const router = useRouter()
  const [starting, setStarting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [duplicating, setDuplicating] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen])

  const startWorkout = async (e: React.MouseEvent) => {
    e.preventDefault()
    setStarting(true)
    try {
      const res = await fetch(`/api/templates/${template.id}/start`, { method: 'POST' })
      const data = await res.json() as { workoutId?: string }
      if (data.workoutId) router.push(`/training/workout/${data.workoutId}`)
    } finally {
      setStarting(false)
    }
  }

  const duplicate = async () => {
    setMenuOpen(false)
    setDuplicating(true)
    try {
      const res = await fetch(`/api/templates/${template.id}/duplicate`, { method: 'POST' })
      const data = await res.json() as { template: Template }
      if (res.ok) onDuplicate(template.id, data.template)
    } finally {
      setDuplicating(false)
    }
  }

  const del = async () => {
    setMenuOpen(false)
    if (!confirm(`Delete "${template.name}"?`)) return
    setDeleting(true)
    try {
      await fetch(`/api/templates/${template.id}`, { method: 'DELETE' })
      onDelete(template.id)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="flex items-center gap-3 rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-4">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-zinc-50 dark:bg-zinc-800">
        <Dumbbell className="size-5 text-zinc-400" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm text-zinc-900 dark:text-white truncate">{template.name}</p>
        <p className="text-xs text-zinc-400">
          {template.exercises.length} exercise{template.exercises.length !== 1 ? 's' : ''}
          {template.equipmentProfile ? ` · ${template.equipmentProfile.name}` : ''}
          {template.description ? ` · ${template.description}` : ''}
        </p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={startWorkout}
          disabled={starting}
          className="flex size-8 items-center justify-center rounded-full bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 hover:opacity-80 transition-opacity disabled:opacity-40"
        >
          {starting ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
        </button>

        <div ref={menuRef} className="relative">
          <button
            onClick={() => setMenuOpen(v => !v)}
            className="flex size-8 items-center justify-center rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            {duplicating || deleting
              ? <Loader2 className="size-3.5 animate-spin text-zinc-400" />
              : <MoreHorizontal className="size-4 text-zinc-400" />}
          </button>
          {menuOpen && (
            <div className={cn(
              'absolute right-0 top-9 z-20 min-w-[140px] rounded-xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-lg overflow-hidden',
            )}>
              <Link
                href={`/training/templates/${template.id}/edit`}
                onClick={() => setMenuOpen(false)}
                className="flex items-center gap-2 px-3 py-2.5 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
              >
                <Pencil className="size-3.5 text-zinc-400" /> Edit
              </Link>
              <button
                onClick={duplicate}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
              >
                <Copy className="size-3.5 text-zinc-400" /> Duplicate
              </button>
              <button
                onClick={del}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
              >
                <Trash2 className="size-3.5" /> Delete
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/templates')
      .then(r => r.ok ? r.json() as Promise<{ templates: Template[] }> : null)
      .then(data => { if (data) setTemplates(data.templates) })
      .finally(() => setLoading(false))
  }, [])

  const handleDelete = (id: string) => setTemplates(prev => prev.filter(t => t.id !== id))
  const handleDuplicate = (_id: string, copy: Template) => setTemplates(prev => [copy, ...prev])

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:px-8">
      <div className="mb-8 flex items-center gap-3">
        <Link href="/training" className="flex size-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors">
          <ArrowLeft className="size-4 text-zinc-600 dark:text-zinc-400" />
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-black text-zinc-900 dark:text-white">Saved templates</h1>
          <p className="text-sm text-zinc-500">Reusable single-session workouts</p>
        </div>
        <Link
          href="/training/templates/new"
          className="flex items-center gap-1.5 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 px-3 py-2 text-sm font-bold hover:opacity-90"
        >
          <Plus className="size-3.5" /> New
        </Link>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="size-6 animate-spin text-zinc-400" /></div>
      ) : templates.length === 0 ? (
        <div className="flex flex-col items-center py-16 text-center">
          <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-zinc-100 dark:bg-zinc-800">
            <Dumbbell className="size-7 text-zinc-400" />
          </div>
          <p className="font-bold text-zinc-900 dark:text-white mb-1">No saved templates</p>
          <p className="text-sm text-zinc-400 max-w-xs mb-6">
            Create a template to quickly start a workout with your favourite exercises.
          </p>
          <Link href="/training/templates/new" className="flex items-center gap-1.5 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 px-4 py-2.5 text-sm font-bold hover:opacity-90 transition-opacity">
            <Plus className="size-4" /> Create template
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {templates.map(t => (
            <TemplateCard key={t.id} template={t} onDelete={handleDelete} onDuplicate={handleDuplicate} />
          ))}
        </div>
      )}
    </div>
  )
}
