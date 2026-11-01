'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Search, CheckCircle, XCircle, Copy, Link, FileText,
  RefreshCw, ChevronLeft, ChevronRight, VideoOff, AlertTriangle,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

type CurationStatus = 'pending_review' | 'approved' | 'rejected' | 'duplicate'

interface CatalogItem {
  ymoveId:          string
  name:             string
  slug:             string | null
  category:         string | null
  equipment:        string | null
  difficulty:       string | null
  primaryMuscleGroup: string | null
  hasVideo:         boolean
  thumbnailMediaId: string | null
  syncedAt:         string
  curationStatus:   CurationStatus
  verifiedMediaFor: string | null
  isDuplicateOf:    string | null
  canonicalId:      string | null
  curatorNotes:     string | null
  curatedAt:        string | null
  curatedBy:        string | null
}

interface StatusCounts {
  pending_review: number
  approved:       number
  rejected:       number
  duplicate:      number
}

interface CatalogResponse {
  items:    CatalogItem[]
  total:    number
  page:     number
  pageSize: number
  counts:   StatusCounts
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_TABS: { value: CurationStatus | 'all'; label: string }[] = [
  { value: 'all',            label: 'All'       },
  { value: 'pending_review', label: 'Pending'   },
  { value: 'approved',       label: 'Approved'  },
  { value: 'rejected',       label: 'Rejected'  },
  { value: 'duplicate',      label: 'Duplicate' },
]

const STATUS_COLORS: Record<CurationStatus, string> = {
  pending_review: 'border-yellow-700/50 bg-yellow-900/20 text-yellow-300',
  approved:       'border-green-700/50  bg-green-900/20  text-green-300',
  rejected:       'border-red-700/40    bg-red-900/20    text-red-300',
  duplicate:      'border-zinc-700      bg-zinc-800      text-zinc-400',
}

const PAGE_SIZE = 20

// ── Action modal ──────────────────────────────────────────────────────────────

interface ActionModalProps {
  item:    CatalogItem
  onClose: () => void
  onDone:  () => void
}

function ActionModal({ item, onClose, onDone }: ActionModalProps) {
  const [saving,        setSaving]        = useState(false)
  const [error,         setError]         = useState<string | null>(null)
  const [dupTarget,     setDupTarget]     = useState('')
  const [exerciseId,    setExerciseId]    = useState(item.verifiedMediaFor ?? '')
  const [notes,         setNotes]         = useState(item.curatorNotes ?? '')
  const [canonicalId,   setCanonicalId]   = useState(item.canonicalId ?? '')

  async function send(body: Record<string, unknown>) {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/ymove-catalog/${encodeURIComponent(item.ymoveId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = await res.json() as { error?: string }
        setError(data.error ?? `HTTP ${res.status}`)
        return
      }
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-lg rounded-lg border border-zinc-700 bg-zinc-900 p-5 shadow-xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-zinc-100">{item.name}</p>
            <p className="mt-0.5 font-mono text-[10px] text-zinc-500">{item.ymoveId}</p>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 text-lg leading-none">✕</button>
        </div>

        {error && (
          <div className="mb-3 flex items-center gap-2 rounded border border-red-800 bg-red-900/20 px-3 py-2 text-xs text-red-300">
            <AlertTriangle className="size-3.5 shrink-0" />
            {error}
          </div>
        )}

        <div className="space-y-4">
          {/* Quick actions */}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => send({ action: 'approve' })}
              disabled={saving}
              className="flex items-center gap-1.5 rounded border border-green-700 bg-green-900/30 px-3 py-1.5 text-xs text-green-300 hover:bg-green-900/50 disabled:opacity-50"
            >
              <CheckCircle className="size-3.5" /> Approve
            </button>
            <button
              onClick={() => send({ action: 'reject' })}
              disabled={saving}
              className="flex items-center gap-1.5 rounded border border-red-700/50 bg-red-900/20 px-3 py-1.5 text-xs text-red-300 hover:bg-red-900/40 disabled:opacity-50"
            >
              <XCircle className="size-3.5" /> Reject
            </button>
            <button
              onClick={() => send({ action: 'reset' })}
              disabled={saving}
              className="flex items-center gap-1.5 rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-700 disabled:opacity-50"
            >
              <RefreshCw className="size-3.5" /> Reset
            </button>
          </div>

          {/* Mark duplicate */}
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">Mark duplicate of (YMove UUID)</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={dupTarget}
                onChange={e => setDupTarget(e.target.value)}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                className="flex-1 rounded border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 font-mono text-[11px] text-zinc-200 placeholder-zinc-600 focus:border-zinc-500 focus:outline-none"
              />
              <button
                onClick={() => send({ action: 'mark_duplicate', isDuplicateOf: dupTarget })}
                disabled={saving || !dupTarget.trim()}
                className="flex items-center gap-1 rounded border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 disabled:opacity-50"
              >
                <Copy className="size-3.5" /> Mark
              </button>
            </div>
          </div>

          {/* Link exercise */}
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">Link to ExerciseDB exercise ID</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={exerciseId}
                onChange={e => setExerciseId(e.target.value)}
                placeholder="e.g. 0025"
                className="flex-1 rounded border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 font-mono text-[11px] text-zinc-200 placeholder-zinc-600 focus:border-zinc-500 focus:outline-none"
              />
              <button
                onClick={() => send({ action: 'link_exercise', verifiedMediaFor: exerciseId })}
                disabled={saving || !exerciseId.trim()}
                className="flex items-center gap-1 rounded border border-blue-700/50 bg-blue-900/20 px-2.5 py-1.5 text-xs text-blue-300 hover:bg-blue-900/40 disabled:opacity-50"
              >
                <Link className="size-3.5" /> Link
              </button>
            </div>
            {item.verifiedMediaFor && (
              <p className="mt-1 text-[10px] text-zinc-500">Currently: <span className="text-zinc-400 font-mono">{item.verifiedMediaFor}</span></p>
            )}
          </div>

          {/* Curator notes */}
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">Curator notes</label>
            <div className="flex gap-2">
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={2}
                maxLength={500}
                className="flex-1 resize-none rounded border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 focus:border-zinc-500 focus:outline-none"
              />
              <button
                onClick={() => send({ action: 'set_notes', notes })}
                disabled={saving}
                className="flex items-center gap-1 self-start rounded border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 disabled:opacity-50"
              >
                <FileText className="size-3.5" /> Save
              </button>
            </div>
          </div>

          {/* Set canonical */}
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">Canonical group ID (optional)</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={canonicalId}
                onChange={e => setCanonicalId(e.target.value)}
                placeholder="e.g. squat/barbell-back-squat"
                className="flex-1 rounded border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 font-mono text-[11px] text-zinc-200 placeholder-zinc-600 focus:border-zinc-500 focus:outline-none"
              />
              <button
                onClick={() => send({ action: 'set_canonical', canonicalId: canonicalId || null })}
                disabled={saving}
                className="flex items-center gap-1 rounded border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 disabled:opacity-50"
              >
                Set
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Catalog item row ──────────────────────────────────────────────────────────

interface ItemRowProps {
  item:     CatalogItem
  selected: boolean
  onToggle: () => void
  onAction: () => void
}

function ItemRow({ item, selected, onToggle, onAction }: ItemRowProps) {
  const [imgError, setImgError] = useState(false)

  return (
    <div className={cn(
      'flex items-center gap-3 rounded-lg border px-3 py-2.5',
      selected ? 'border-blue-700/60 bg-blue-900/10' : 'border-zinc-800 bg-zinc-900/40',
    )}>
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        className="size-4 cursor-pointer accent-blue-500 shrink-0"
      />

      {/* Thumbnail */}
      <div className="size-10 shrink-0 overflow-hidden rounded bg-zinc-800">
        {item.thumbnailMediaId && !imgError ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/ymove/thumbnail/${item.thumbnailMediaId}?crop=square`}
            alt={item.name}
            className="size-10 object-cover"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="flex size-10 items-center justify-center text-zinc-600">
            <VideoOff className="size-4" />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-zinc-100">{item.name}</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="font-mono text-[10px] text-zinc-600">{item.ymoveId}</span>
          {item.category   && <span className="text-[10px] text-zinc-500">{item.category}</span>}
          {item.equipment  && <span className="text-[10px] text-zinc-500">{item.equipment}</span>}
          {!item.hasVideo  && <span className="text-[10px] text-zinc-600">no video</span>}
        </div>
        {item.verifiedMediaFor && (
          <p className="mt-0.5 text-[10px] text-blue-400">→ exercise {item.verifiedMediaFor}</p>
        )}
        {item.isDuplicateOf && (
          <p className="mt-0.5 font-mono text-[10px] text-zinc-500">dup of {item.isDuplicateOf}</p>
        )}
        {item.curatorNotes && (
          <p className="mt-0.5 text-[10px] italic text-zinc-500 truncate">{item.curatorNotes}</p>
        )}
      </div>

      {/* Status badge */}
      <div className="shrink-0">
        <span className={cn('rounded border px-1.5 py-0.5 text-[10px]', STATUS_COLORS[item.curationStatus])}>
          {item.curationStatus.replace('_', ' ')}
        </span>
      </div>

      {/* Action */}
      <button
        onClick={onAction}
        className="shrink-0 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-700"
      >
        Edit
      </button>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function YMoveCatalogPage() {
  const [data,         setData]         = useState<CatalogResponse | null>(null)
  const [loading,      setLoading]      = useState(false)
  const [error,        setError]        = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<CurationStatus | 'all'>('pending_review')
  const [q,            setQ]            = useState('')
  const [page,         setPage]         = useState(1)
  const [selected,     setSelected]     = useState<Set<string>>(new Set())
  const [actionItem,   setActionItem]   = useState<CatalogItem | null>(null)
  const [bulkWorking,  setBulkWorking]  = useState(false)
  const [bulkResult,   setBulkResult]   = useState<string | null>(null)
  const queuedFetch    = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchPage = useCallback(async (opts?: { status?: CurationStatus | 'all'; search?: string; p?: number }) => {
    const s  = opts?.status ?? statusFilter
    const sq = opts?.search ?? q
    const pg = opts?.p ?? page

    const params = new URLSearchParams({ page: String(pg), pageSize: String(PAGE_SIZE) })
    if (s !== 'all') params.set('status', s)
    if (sq)          params.set('q', sq)

    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/ymove-catalog?${params}`)
      if (!res.ok) {
        setError(res.status === 403 ? 'Access denied.' : `HTTP ${res.status}`)
        return
      }
      const json = await res.json() as CatalogResponse
      setData(json)
      setSelected(new Set())
      setBulkResult(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed')
    } finally {
      setLoading(false)
    }
  }, [statusFilter, q, page])

  useEffect(() => { void fetchPage() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function handleTabChange(s: CurationStatus | 'all') {
    setStatusFilter(s)
    setPage(1)
    setSelected(new Set())
    void fetchPage({ status: s, p: 1 })
  }

  function handleSearch(value: string) {
    setQ(value)
    setPage(1)
    if (queuedFetch.current) clearTimeout(queuedFetch.current)
    queuedFetch.current = setTimeout(() => {
      void fetchPage({ search: value, p: 1 })
    }, 350)
  }

  function handlePageChange(next: number) {
    setPage(next)
    void fetchPage({ p: next })
  }

  function toggleSelect(id: string) {
    setSelected(prev => {
      const s = new Set(prev)
      if (s.has(id)) s.delete(id); else s.add(id)
      return s
    })
  }

  function toggleSelectAll() {
    if (!data) return
    const allIds = data.items.map(i => i.ymoveId)
    const allSelected = allIds.every(id => selected.has(id))
    if (allSelected) {
      setSelected(prev => { const s = new Set(prev); allIds.forEach(id => s.delete(id)); return s })
    } else {
      setSelected(prev => new Set([...prev, ...allIds]))
    }
  }

  async function handleBulk(action: 'approve' | 'reject') {
    if (selected.size === 0) return
    setBulkWorking(true)
    setBulkResult(null)
    try {
      const res = await fetch('/api/admin/ymove-catalog/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ymoveIds: [...selected], confirm: true }),
      })
      const data2 = await res.json() as { applied?: number; skipped?: number; errors?: unknown[]; error?: string }
      if (!res.ok) {
        setBulkResult(`Error: ${data2.error ?? `HTTP ${res.status}`}`)
      } else {
        setBulkResult(`Applied ${data2.applied ?? 0} · Skipped ${data2.skipped ?? 0}`)
        void fetchPage()
      }
    } catch (err) {
      setBulkResult(`Error: ${err instanceof Error ? err.message : 'Request failed'}`)
    } finally {
      setBulkWorking(false)
    }
  }

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 1
  const allOnPageSelected = !!(data?.items.length && data.items.every(i => selected.has(i.ymoveId)))

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-zinc-100">YMove Catalog Curation</h1>
        <p className="mt-0.5 text-sm text-zinc-500">
          Review and curate YMove exercises. Changes are admin-only and do not affect public features.
        </p>
      </div>

      {/* Status tabs */}
      <div className="mb-4 flex flex-wrap gap-1 border-b border-zinc-800 pb-3">
        {STATUS_TABS.map(tab => {
          const count = tab.value === 'all'
            ? (data ? data.total : null)
            : (data?.counts[tab.value as CurationStatus] ?? null)
          return (
            <button
              key={tab.value}
              onClick={() => handleTabChange(tab.value as CurationStatus | 'all')}
              className={cn(
                'flex items-center gap-1.5 rounded px-3 py-1.5 text-sm',
                statusFilter === tab.value
                  ? 'bg-zinc-700 text-zinc-100'
                  : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200',
              )}
            >
              {tab.label}
              {count !== null && (
                <span className={cn(
                  'rounded px-1.5 py-0.5 text-[10px] font-mono',
                  statusFilter === tab.value ? 'bg-zinc-600 text-zinc-200' : 'bg-zinc-800 text-zinc-500',
                )}>
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Search + bulk controls */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            value={q}
            onChange={e => handleSearch(e.target.value)}
            placeholder="Search by name…"
            className="w-full rounded border border-zinc-700 bg-zinc-800 py-1.5 pl-8 pr-3 text-sm text-zinc-200 placeholder-zinc-500 focus:border-zinc-500 focus:outline-none"
          />
        </div>

        {selected.size > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-500">{selected.size} selected</span>
            <button
              onClick={() => handleBulk('approve')}
              disabled={bulkWorking}
              className="flex items-center gap-1 rounded border border-green-700 bg-green-900/30 px-2.5 py-1.5 text-xs text-green-300 hover:bg-green-900/50 disabled:opacity-50"
            >
              <CheckCircle className="size-3.5" /> Approve all
            </button>
            <button
              onClick={() => handleBulk('reject')}
              disabled={bulkWorking}
              className="flex items-center gap-1 rounded border border-red-700/50 bg-red-900/20 px-2.5 py-1.5 text-xs text-red-300 hover:bg-red-900/40 disabled:opacity-50"
            >
              <XCircle className="size-3.5" /> Reject all
            </button>
          </div>
        )}

        {bulkResult && (
          <span className={cn('text-xs', bulkResult.startsWith('Error') ? 'text-red-400' : 'text-green-400')}>
            {bulkResult}
          </span>
        )}
      </div>

      {/* Error state */}
      {error && (
        <div className="mb-4 flex items-center gap-2 rounded border border-red-800 bg-red-900/20 px-4 py-3 text-sm text-red-300">
          <AlertTriangle className="size-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Select-all row */}
      {data && data.items.length > 0 && (
        <div className="mb-2 flex items-center gap-2 px-3">
          <input
            type="checkbox"
            checked={allOnPageSelected}
            onChange={toggleSelectAll}
            className="size-4 cursor-pointer accent-blue-500"
          />
          <span className="text-xs text-zinc-500">Select page ({data.items.length})</span>
        </div>
      )}

      {/* Item list */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <RefreshCw className="size-5 animate-spin text-zinc-500" />
        </div>
      ) : data?.items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16">
          <CheckCircle className="mb-3 size-8 text-green-500/50" />
          <p className="text-sm text-zinc-400">No exercises match this filter.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {data?.items.map(item => (
            <ItemRow
              key={item.ymoveId}
              item={item}
              selected={selected.has(item.ymoveId)}
              onToggle={() => toggleSelect(item.ymoveId)}
              onAction={() => setActionItem(item)}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {data && totalPages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-3">
          <button
            onClick={() => handlePageChange(page - 1)}
            disabled={page === 1 || loading}
            className="flex items-center gap-1 rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 disabled:opacity-40"
          >
            <ChevronLeft className="size-3.5" /> Prev
          </button>
          <span className="text-xs text-zinc-500">
            Page {page} of {totalPages} · {data.total} total
          </span>
          <button
            onClick={() => handlePageChange(page + 1)}
            disabled={page >= totalPages || loading}
            className="flex items-center gap-1 rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 disabled:opacity-40"
          >
            Next <ChevronRight className="size-3.5" />
          </button>
        </div>
      )}

      {/* Action modal */}
      {actionItem && (
        <ActionModal
          item={actionItem}
          onClose={() => setActionItem(null)}
          onDone={() => { setActionItem(null); void fetchPage() }}
        />
      )}
    </div>
  )
}
