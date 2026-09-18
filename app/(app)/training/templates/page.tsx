'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Plus, Dumbbell, Play, Trash2, Loader2 } from 'lucide-react'

interface Template {
  id: string
  name: string
  description: string | null
  updatedAt: string
  exercises: Array<{ exerciseId: string; trackingType: string }>
}

function TemplateCard({ template, onDelete }: { template: Template; onDelete: (id: string) => void }) {
  const router = useRouter()
  const [starting, setStarting] = useState(false)
  const [deleting, setDeleting] = useState(false)

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

  const del = async (e: React.MouseEvent) => {
    e.preventDefault()
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
        <button
          onClick={del}
          disabled={deleting}
          className="flex size-8 items-center justify-center rounded-full hover:bg-red-50 dark:hover:bg-red-900/20 text-zinc-300 hover:text-red-500 transition-colors disabled:opacity-40"
        >
          {deleting ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
        </button>
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
            After a quick workout, save it as a template to reuse later.
          </p>
          <Link href="/training/log" className="flex items-center gap-1.5 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 px-4 py-2.5 text-sm font-bold hover:opacity-90 transition-opacity">
            <Plus className="size-4" /> Log workout
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {templates.map(t => (
            <TemplateCard key={t.id} template={t} onDelete={handleDelete} />
          ))}
        </div>
      )}
    </div>
  )
}
