'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, CheckCircle, XCircle, Loader2, AlertTriangle, Pencil, X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface VDraft {
  id:          string
  draftType:   'target_update' | 'trainer_note' | 'program_adjustment' | 'workout_edit'
  status:      'pending' | 'approved' | 'dismissed'
  description: string
  payload:     Record<string, unknown>
  createdAt:   string
  clientId:    string
  client:      { displayName: string | null } | null
}

const TARGET_TYPE_LABELS: Record<string, string> = {
  daily_calories:        'Daily calories',
  daily_protein_g:       'Daily protein (g)',
  daily_carbs_g:         'Daily carbs (g)',
  daily_fat_g:           'Daily fat (g)',
  weekly_workouts:       'Weekly workouts',
  weekly_cardio_minutes: 'Weekly cardio (min)',
  body_weight_kg:        'Body weight target (kg)',
  body_fat_pct:          'Body fat target (%)',
  custom:                'Custom',
}

// ─── Inline editors per draft type ───────────────────────────────────────────

function TargetEditor({ payload, onChange }: { payload: Record<string, unknown>; onChange: (p: Record<string, unknown>) => void }) {
  return (
    <div className="space-y-3">
      <div>
        <label className="text-xs text-zinc-500 block mb-1">Target type</label>
        <select
          value={String(payload.targetType ?? '')}
          onChange={e => onChange({ ...payload, targetType: e.target.value })}
          className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-white focus:outline-none"
        >
          {Object.entries(TARGET_TYPE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </div>
      <div className="flex gap-2">
        <div className="flex-1">
          <label className="text-xs text-zinc-500 block mb-1">Value</label>
          <input
            type="number"
            value={String(payload.targetValue ?? '')}
            onChange={e => onChange({ ...payload, targetValue: parseFloat(e.target.value) })}
            className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-white focus:outline-none"
          />
        </div>
        <div className="flex-1">
          <label className="text-xs text-zinc-500 block mb-1">Unit</label>
          <input
            type="text"
            value={String(payload.unit ?? '')}
            onChange={e => onChange({ ...payload, unit: e.target.value })}
            className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-white focus:outline-none"
          />
        </div>
      </div>
      <div>
        <label className="text-xs text-zinc-500 block mb-1">Notes (optional)</label>
        <input
          type="text"
          value={String(payload.notes ?? '')}
          onChange={e => onChange({ ...payload, notes: e.target.value || undefined })}
          placeholder="Context for the client..."
          className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-white focus:outline-none placeholder:text-zinc-400"
        />
      </div>
    </div>
  )
}

function NoteEditor({ payload, onChange }: { payload: Record<string, unknown>; onChange: (p: Record<string, unknown>) => void }) {
  return (
    <div className="space-y-3">
      <div>
        <label className="text-xs text-zinc-500 block mb-1">Note content</label>
        <textarea
          rows={4}
          value={String(payload.content ?? '')}
          onChange={e => onChange({ ...payload, content: e.target.value })}
          className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-white focus:outline-none resize-none"
        />
      </div>
      <button
        type="button"
        onClick={() => onChange({ ...payload, isPrivate: !payload.isPrivate })}
        className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors"
      >
        {payload.isPrivate !== false ? '🔒 Private (trainer only)' : '👁 Visible to client'} — click to toggle
      </button>
    </div>
  )
}

function JsonEditor({ payload, onChange }: { payload: Record<string, unknown>; onChange: (p: Record<string, unknown>) => void }) {
  const [raw, setRaw] = useState(JSON.stringify(payload, null, 2))
  const [jsonError, setJsonError] = useState(false)

  const handleChange = (val: string) => {
    setRaw(val)
    try { onChange(JSON.parse(val) as Record<string, unknown>); setJsonError(false) }
    catch { setJsonError(true) }
  }

  return (
    <div>
      <label className="text-xs text-zinc-500 block mb-1">Payload (JSON)</label>
      <textarea
        rows={8}
        value={raw}
        onChange={e => handleChange(e.target.value)}
        className={cn(
          'w-full rounded-xl border bg-zinc-50 dark:bg-zinc-800 px-3 py-2 font-mono text-xs text-zinc-900 dark:text-white focus:outline-none resize-none',
          jsonError ? 'border-red-400' : 'border-zinc-200 dark:border-zinc-700'
        )}
        spellCheck={false}
      />
      {jsonError && <p className="text-xs text-red-400 mt-1">Invalid JSON</p>}
    </div>
  )
}

// ─── Draft card ───────────────────────────────────────────────────────────────

function DraftCard({ draft, onAction }: {
  draft:    VDraft
  onAction: (id: string, action: 'approve' | 'dismiss', payload?: Record<string, unknown>) => Promise<void>
}) {
  const [acting,   setActing]   = useState<'approve' | 'dismiss' | null>(null)
  const [editing,  setEditing]  = useState(false)
  const [payload,  setPayload]  = useState<Record<string, unknown>>(draft.payload)
  const [expanded, setExpanded] = useState(false)

  const clientName = draft.client?.displayName ?? 'Unknown client'
  const isPending  = draft.status === 'pending'

  const handleAction = async (action: 'approve' | 'dismiss') => {
    setActing(action)
    await onAction(draft.id, action, action === 'approve' && editing ? payload : undefined)
    setActing(null)
    setEditing(false)
  }

  const statusColor =
    draft.status === 'approved'  ? 'border-emerald-200 dark:border-emerald-800/30' :
    draft.status === 'dismissed' ? 'border-zinc-100 dark:border-zinc-800' :
                                   'border-amber-200 dark:border-amber-700/40'

  return (
    <div className={cn('rounded-2xl border bg-white dark:bg-zinc-900', statusColor)}>
      <div className="p-4 space-y-3">

        {/* Header row */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className={cn(
                'rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize',
                draft.status === 'approved'  ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400' :
                draft.status === 'dismissed' ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500' :
                                               'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
              )}>
                {draft.status}
              </span>
              <span className="text-xs text-zinc-500 capitalize">{draft.draftType.replace(/_/g, ' ')}</span>
              <span className="text-xs text-zinc-400">· {clientName}</span>
            </div>
            <p className="text-sm text-zinc-700 dark:text-zinc-300">{draft.description}</p>
          </div>

          {/* Action buttons */}
          {isPending && (
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={() => setEditing(e => !e)}
                className={cn(
                  'flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs font-bold transition-colors',
                  editing
                    ? 'border-zinc-900 dark:border-white bg-zinc-900 dark:bg-white text-white dark:text-zinc-900'
                    : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800'
                )}
              >
                {editing ? <X className="size-3" /> : <Pencil className="size-3" />}
                {editing ? 'Cancel' : 'Edit'}
              </button>
              <button
                onClick={() => handleAction('dismiss')}
                disabled={!!acting}
                className="flex items-center gap-1 rounded-xl border border-zinc-200 dark:border-zinc-700 px-2.5 py-1.5 text-xs font-bold text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors disabled:opacity-40"
              >
                {acting === 'dismiss' ? <Loader2 className="size-3 animate-spin" /> : <XCircle className="size-3" />}
                Dismiss
              </button>
              <button
                onClick={() => handleAction('approve')}
                disabled={!!acting}
                className="flex items-center gap-1 rounded-xl bg-emerald-600 text-white px-2.5 py-1.5 text-xs font-bold hover:bg-emerald-700 transition-colors disabled:opacity-40"
              >
                {acting === 'approve' ? <Loader2 className="size-3 animate-spin" /> : <CheckCircle className="size-3" />}
                {editing ? 'Approve edited' : 'Approve'}
              </button>
            </div>
          )}
        </div>

        {/* Warning */}
        {isPending && !editing && (
          <div className="flex items-start gap-2 rounded-xl bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/30 px-3 py-2">
            <AlertTriangle className="size-3.5 text-amber-500 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-700 dark:text-amber-400">
              Approving applies these changes to the client immediately. Review before approving.
            </p>
          </div>
        )}

        {/* Inline editor */}
        {editing && (
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 p-3">
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-3">Edit before approving</p>
            {draft.draftType === 'target_update' && (
              <TargetEditor payload={payload} onChange={setPayload} />
            )}
            {draft.draftType === 'trainer_note' && (
              <NoteEditor payload={payload} onChange={setPayload} />
            )}
            {(draft.draftType === 'program_adjustment' || draft.draftType === 'workout_edit') && (
              <JsonEditor payload={payload} onChange={setPayload} />
            )}
          </div>
        )}

        {/* Payload preview (collapsed by default) */}
        {!editing && (
          <div>
            <button
              onClick={() => setExpanded(e => !e)}
              className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
            >
              {expanded ? 'Hide' : 'Show'} payload
            </button>
            {expanded && (
              <pre className="mt-2 rounded-xl bg-zinc-50 dark:bg-zinc-800 p-3 text-xs text-zinc-600 dark:text-zinc-300 overflow-x-auto">
                {JSON.stringify(draft.payload, null, 2)}
              </pre>
            )}
          </div>
        )}

        <p className="text-xs text-zinc-400">{new Date(draft.createdAt).toLocaleString()}</p>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TrainerDraftsPage() {
  const [drafts,  setDrafts]  = useState<VDraft[]>([])
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    // Fetch both pending and resolved in parallel
    const [pending, resolved] = await Promise.all([
      fetch('/api/v/trainer/drafts?status=pending').then(r => r.ok ? r.json() as Promise<{ drafts: VDraft[] }> : { drafts: [] }),
      fetch('/api/v/trainer/drafts?status=approved').then(r => r.ok ? r.json() as Promise<{ drafts: VDraft[] }> : { drafts: [] }),
    ])
    setDrafts([...(pending.drafts ?? []), ...(resolved.drafts ?? [])])
    setLoading(false)
  }

  useEffect(() => { void load() }, [])

  const handleAction = async (id: string, action: 'approve' | 'dismiss', payload?: Record<string, unknown>) => {
    await fetch(`/api/v/trainer/drafts/${id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ action, ...(payload ? { payload } : {}) }),
    })
    await load()
  }

  const pending  = drafts.filter(d => d.status === 'pending')
  const resolved = drafts.filter(d => d.status !== 'pending')

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:px-8">

      {/* Header */}
      <div className="mb-6 flex items-center gap-3">
        <Link href="/trainer" className="flex size-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors">
          <ArrowLeft className="size-4 text-zinc-600 dark:text-zinc-400" />
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-black text-zinc-900 dark:text-white">V Drafts</h1>
          <p className="text-xs text-zinc-500 mt-0.5">AI-suggested changes — approve, edit, or dismiss</p>
        </div>
        {pending.length > 0 && (
          <span className="rounded-full bg-amber-100 dark:bg-amber-900/30 px-2.5 py-1 text-xs font-semibold text-amber-700 dark:text-amber-400">
            {pending.length} pending
          </span>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="size-6 animate-spin text-zinc-300" />
        </div>
      ) : drafts.length === 0 ? (
        <div className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-6 py-16 text-center">
          <p className="text-sm font-medium text-zinc-900 dark:text-white mb-1">No drafts yet</p>
          <p className="text-sm text-zinc-400">When V suggests programming or target changes for a client, they appear here for your review.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {pending.length > 0 && (
            <section className="space-y-3">
              <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">Needs review</p>
              {pending.map(d => <DraftCard key={d.id} draft={d} onAction={handleAction} />)}
            </section>
          )}
          {resolved.length > 0 && (
            <section className="space-y-3">
              <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">Resolved</p>
              {resolved.map(d => <DraftCard key={d.id} draft={d} onAction={handleAction} />)}
            </section>
          )}
        </div>
      )}
    </div>
  )
}
