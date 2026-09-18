'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Zap, Trash2, Loader2, MoreVertical } from 'lucide-react'

export function ProgramActions({ programId, isActive }: { programId: string; isActive: boolean }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState<string | null>(null)

  const activate = async () => {
    setLoading('activate')
    setOpen(false)
    await fetch(`/api/programs/${programId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: true }),
    })
    setLoading(null)
    router.refresh()
  }

  const del = async () => {
    if (!confirm('Delete this program? This cannot be undone.')) return
    setLoading('delete')
    setOpen(false)
    await fetch(`/api/programs/${programId}`, { method: 'DELETE' })
    setLoading(null)
    router.push('/training/programs')
  }

  return (
    <div className="relative shrink-0">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex size-8 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
      >
        {loading ? <Loader2 className="size-4 animate-spin text-zinc-500" /> : <MoreVertical className="size-4 text-zinc-500" />}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-9 z-50 w-44 rounded-xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-lg overflow-hidden">
            {!isActive && (
              <button onClick={activate} className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors">
                <Zap className="size-4 text-emerald-500" />
                Set as active
              </button>
            )}
            <button onClick={del} className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
              <Trash2 className="size-4" />
              Delete program
            </button>
          </div>
        </>
      )}
    </div>
  )
}
