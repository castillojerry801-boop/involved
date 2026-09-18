'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ArrowLeft, Plus, Zap, Trash2, Loader2, Pencil, Check, ChevronRight, Weight } from 'lucide-react'
import { cn } from '@/lib/utils'

interface WeightConfig {
  unit: 'lbs' | 'kg'
  type: 'fixed' | 'range'
  values?: number[]
  min?: number
  max?: number
  increment?: number
}

interface EquipmentOption { value: string; count: number }

interface EquipmentItem {
  equipment: string
  availableWeights?: WeightConfig | null
}

interface EquipmentProfile {
  id: string
  name: string
  isActive: boolean
  items: EquipmentItem[]
  updatedAt: string
}

// Equipment types that commonly have trackable weights
const WEIGHTED_EQUIPMENT = new Set([
  'barbell', 'dumbbell', 'cable', 'kettlebell', 'medicine ball',
  'ez barbell', 'band', 'weighted', 'smith machine',
])

function isWeightable(equipment: string) {
  const lower = equipment.toLowerCase()
  return [...WEIGHTED_EQUIPMENT].some(w => lower.includes(w))
}

// ─── Weight Config Input ──────────────────────────────────────────────────────

function WeightConfigInput({
  equipment, value, onChange,
}: { equipment: string; value: WeightConfig | null | undefined; onChange: (v: WeightConfig | null) => void }) {
  const [open, setOpen] = useState(!!value)
  const unit = value?.unit ?? 'lbs'
  const type = value?.type ?? 'fixed'

  if (!isWeightable(equipment)) return null

  const update = (patch: Partial<WeightConfig>) => {
    onChange({ unit, type, ...value, ...patch } as WeightConfig)
  }

  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={() => {
          if (open) { onChange(null); setOpen(false) }
          else { setOpen(true); if (!value) onChange({ unit: 'lbs', type: 'fixed', values: [] }) }
        }}
        className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
      >
        <Weight className="size-3" />
        {open ? 'Remove weight config' : 'Add weight config'}
      </button>

      {open && value && (
        <div className="mt-2 rounded-xl border border-zinc-100 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 p-3 space-y-2.5">
          {/* Unit + type */}
          <div className="flex gap-2">
            <div className="flex rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden text-xs">
              {(['lbs', 'kg'] as const).map(u => (
                <button key={u} type="button"
                  onClick={() => update({ unit: u })}
                  className={cn('px-2.5 py-1 font-medium transition-colors',
                    unit === u ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900' : 'text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-700'
                  )}>
                  {u}
                </button>
              ))}
            </div>
            <div className="flex rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden text-xs">
              {(['fixed', 'range'] as const).map(t => (
                <button key={t} type="button"
                  onClick={() => update({ type: t })}
                  className={cn('px-2.5 py-1 font-medium capitalize transition-colors',
                    type === t ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900' : 'text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-700'
                  )}>
                  {t}
                </button>
              ))}
            </div>
          </div>

          {type === 'fixed' ? (
            <div>
              <label className="text-[10px] text-zinc-400 block mb-1">Weights ({unit}) — comma separated</label>
              <input
                type="text"
                placeholder={`e.g. 5, 10, 15, 20, 25, 30, 35`}
                defaultValue={value.values?.join(', ') ?? ''}
                onBlur={e => {
                  const nums = e.target.value.split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n) && n > 0)
                  update({ values: nums })
                }}
                className="w-full rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-2.5 py-1.5 text-xs text-zinc-900 dark:text-white focus:outline-none focus:border-zinc-400"
              />
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-1.5">
              {([['min', 'Min'], ['max', 'Max'], ['increment', 'Step']] as const).map(([field, label]) => (
                <div key={field}>
                  <label className="text-[10px] text-zinc-400 block mb-1">{label} ({unit})</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    defaultValue={value[field as keyof WeightConfig] as number | undefined}
                    onBlur={e => {
                      const n = parseFloat(e.target.value)
                      update({ [field]: isNaN(n) ? undefined : n })
                    }}
                    className="w-full rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-2 py-1.5 text-xs text-zinc-900 dark:text-white focus:outline-none focus:border-zinc-400"
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Equipment picker checklist ───────────────────────────────────────────────

function EquipmentChecklist({
  options, selectedItems, onChange,
}: {
  options: EquipmentOption[]
  selectedItems: EquipmentItem[]
  onChange: (items: EquipmentItem[]) => void
}) {
  const selectedMap = new Map(selectedItems.map(i => [i.equipment, i]))

  const toggle = (v: string) => {
    if (selectedMap.has(v)) {
      onChange(selectedItems.filter(i => i.equipment !== v))
    } else {
      onChange([...selectedItems, { equipment: v }])
    }
  }

  const updateWeights = (equipment: string, weights: WeightConfig | null) => {
    onChange(selectedItems.map(i => i.equipment === equipment ? { ...i, availableWeights: weights } : i))
  }

  return (
    <div className="space-y-1">
      <div className="grid grid-cols-2 gap-1.5 max-h-64 overflow-y-auto">
        {options.map(eq => {
          const selected = selectedMap.has(eq.value)
          return (
            <button
              key={eq.value}
              type="button"
              onClick={() => toggle(eq.value)}
              className={cn(
                'flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-xs font-medium capitalize transition-colors',
                selected
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                  : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800'
              )}
            >
              <span className={cn(
                'flex size-4 shrink-0 items-center justify-center rounded',
                selected ? 'bg-emerald-500 text-white' : 'border border-zinc-300 dark:border-zinc-600'
              )}>
                {selected && <Check className="size-2.5" />}
              </span>
              <span className="truncate">{eq.value}</span>
              <span className="ml-auto text-zinc-300 dark:text-zinc-600 shrink-0">{eq.count}</span>
            </button>
          )
        })}
      </div>

      {/* Weight config for selected weightable items */}
      {selectedItems.filter(i => isWeightable(i.equipment)).length > 0 && (
        <div className="mt-3 space-y-2">
          <p className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wide">Weight configuration (optional)</p>
          {selectedItems.filter(i => isWeightable(i.equipment)).map(item => (
            <div key={item.equipment} className="rounded-xl border border-zinc-100 dark:border-zinc-800 px-3 pt-2.5 pb-3">
              <p className="text-xs font-semibold capitalize text-zinc-700 dark:text-zinc-300">{item.equipment}</p>
              <WeightConfigInput
                equipment={item.equipment}
                value={item.availableWeights}
                onChange={w => updateWeights(item.equipment, w)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Create / edit form ───────────────────────────────────────────────────────

function ProfileForm({
  options, initial, onSave, onCancel,
}: {
  options: EquipmentOption[]
  initial?: { name: string; items: EquipmentItem[] }
  onSave: (name: string, items: EquipmentItem[], isActive: boolean) => Promise<void>
  onCancel: () => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [selectedItems, setSelectedItems] = useState<EquipmentItem[]>(initial?.items ?? [])
  const [setActive, setSetActive] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSave = async () => {
    if (!name.trim()) { setError('Give this profile a name.'); return }
    setSaving(true)
    setError('')
    try {
      await onSave(name.trim(), selectedItems, setActive)
    } catch {
      setError('Failed to save. Try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-4 space-y-4">
      <div>
        <label className="text-xs font-semibold text-zinc-500 block mb-1">Profile name</label>
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g. Home Gym, Commercial Gym, Travel"
          className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-white focus:outline-none focus:border-zinc-400"
        />
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-semibold text-zinc-500">Available equipment</label>
          <span className="text-xs text-zinc-400">{selectedItems.length} selected</span>
        </div>
        <EquipmentChecklist options={options} selectedItems={selectedItems} onChange={setSelectedItems} />
      </div>

      {!initial && (
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={setActive} onChange={e => setSetActive(e.target.checked)}
            className="rounded border-zinc-300" />
          <span className="text-xs text-zinc-600 dark:text-zinc-400">Set as active profile</span>
        </label>
      )}

      {error && <p className="text-xs text-red-500">{error}</p>}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 py-2.5 text-sm font-bold hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {saving && <Loader2 className="size-4 animate-spin" />}
          Save
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-xl border border-zinc-200 dark:border-zinc-700 px-4 py-2.5 text-sm text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

// ─── Profile card ─────────────────────────────────────────────────────────────

function ProfileCard({
  profile, options, onActivate, onDelete, onEdit,
}: {
  profile: EquipmentProfile
  options: EquipmentOption[]
  onActivate: () => void
  onDelete: () => void
  onEdit: (name: string, items: EquipmentItem[]) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [activating, setActivating] = useState(false)

  const handleDelete = async () => {
    if (!confirm(`Delete "${profile.name}"?`)) return
    setDeleting(true)
    onDelete()
  }

  const handleActivate = async () => {
    setActivating(true)
    onActivate()
    setActivating(false)
  }

  if (editing) {
    return (
      <ProfileForm
        options={options}
        initial={{ name: profile.name, items: profile.items }}
        onSave={async (name, items) => { await onEdit(name, items); setEditing(false) }}
        onCancel={() => setEditing(false)}
      />
    )
  }

  const weightedCount = profile.items.filter(i => i.availableWeights).length

  return (
    <div className={cn(
      'rounded-2xl border bg-white dark:bg-zinc-900 p-4 transition-colors',
      profile.isActive
        ? 'border-emerald-200 dark:border-emerald-800/50'
        : 'border-zinc-100 dark:border-zinc-800'
    )}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-xl',
            profile.isActive ? 'bg-emerald-50 dark:bg-emerald-900/30' : 'bg-zinc-50 dark:bg-zinc-800'
          )}>
            <Zap className={cn('size-4', profile.isActive ? 'text-emerald-600 dark:text-emerald-400' : 'text-zinc-400')} />
          </div>
          <div className="min-w-0">
            <p className="font-bold text-sm text-zinc-900 dark:text-white truncate">{profile.name}</p>
            <p className="text-xs text-zinc-400">
              {profile.items.length} equipment type{profile.items.length !== 1 ? 's' : ''}
              {weightedCount > 0 && ` · ${weightedCount} with weights`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={() => setEditing(true)}
            className="flex size-7 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-600 transition-colors">
            <Pencil className="size-3.5" />
          </button>
          <button onClick={handleDelete} disabled={deleting}
            className="flex size-7 items-center justify-center rounded-full text-zinc-300 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-500 transition-colors">
            {deleting ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
          </button>
        </div>
      </div>

      {/* Equipment chips */}
      {profile.items.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {profile.items.slice(0, 8).map(item => (
            <span key={item.equipment}
              className={cn(
                'rounded-full px-2 py-0.5 text-[11px] capitalize',
                item.availableWeights
                  ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400'
                  : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400'
              )}
            >
              {item.equipment}
              {item.availableWeights && ' ⚖'}
            </span>
          ))}
          {profile.items.length > 8 && (
            <span className="rounded-full bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-400">
              +{profile.items.length - 8} more
            </span>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        {profile.isActive ? (
          <span className="flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
            <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Active
          </span>
        ) : (
          <button
            onClick={handleActivate}
            disabled={activating}
            className="flex items-center gap-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50"
          >
            {activating ? <Loader2 className="size-3 animate-spin" /> : <Zap className="size-3" />}
            Set active
          </button>
        )}
        <Link
          href={`/training/exercises?profileId=${profile.id}`}
          className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
        >
          Exercises I can do here <ChevronRight className="size-3" />
        </Link>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function EquipmentProfilesPage() {
  const [profiles, setProfiles] = useState<EquipmentProfile[]>([])
  const [equipmentOptions, setEquipmentOptions] = useState<EquipmentOption[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)

  useEffect(() => {
    Promise.all([
      fetch('/api/equipment-profiles').then(r => r.json() as Promise<{ profiles: EquipmentProfile[] }>),
      fetch('/api/training/exercises/equipment').then(r => r.json() as Promise<{ equipment: EquipmentOption[] }>),
    ]).then(([pd, ed]) => {
      setProfiles(pd.profiles)
      setEquipmentOptions(ed.equipment)
    }).finally(() => setLoading(false))
  }, [])

  const handleCreate = async (name: string, items: EquipmentItem[], isActive: boolean) => {
    const res = await fetch('/api/equipment-profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, equipmentItems: items, isActive }),
    })
    const data = await res.json() as { profile: EquipmentProfile }
    if (isActive) {
      setProfiles(prev => [data.profile, ...prev.map(p => ({ ...p, isActive: false }))])
    } else {
      setProfiles(prev => [data.profile, ...prev])
    }
    setShowCreate(false)
  }

  const handleActivate = async (profileId: string) => {
    await fetch(`/api/equipment-profiles/${profileId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: true }),
    })
    setProfiles(prev => prev.map(p => ({ ...p, isActive: p.id === profileId })))
  }

  const handleDelete = async (profileId: string) => {
    await fetch(`/api/equipment-profiles/${profileId}`, { method: 'DELETE' })
    setProfiles(prev => prev.filter(p => p.id !== profileId))
  }

  const handleEdit = async (profileId: string, name: string, items: EquipmentItem[]) => {
    const res = await fetch(`/api/equipment-profiles/${profileId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, equipmentItems: items }),
    })
    const data = await res.json() as { profile: EquipmentProfile }
    setProfiles(prev => prev.map(p => p.id === profileId ? { ...p, ...data.profile } : p))
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:px-8">
      <div className="mb-6 flex items-center gap-3">
        <Link href="/training" className="flex size-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors">
          <ArrowLeft className="size-4 text-zinc-600 dark:text-zinc-400" />
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-black text-zinc-900 dark:text-white">Equipment profiles</h1>
          <p className="text-sm text-zinc-500">Filter exercises by what&apos;s available to you</p>
        </div>
        {!showCreate && (
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 px-3 py-2 text-sm font-bold hover:opacity-90 transition-opacity"
          >
            <Plus className="size-4" /> New
          </button>
        )}
      </div>

      {showCreate && (
        <div className="mb-4">
          <ProfileForm
            options={equipmentOptions}
            onSave={handleCreate}
            onCancel={() => setShowCreate(false)}
          />
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="size-6 animate-spin text-zinc-400" /></div>
      ) : profiles.length === 0 && !showCreate ? (
        <div className="flex flex-col items-center py-16 text-center">
          <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-zinc-100 dark:bg-zinc-800">
            <Zap className="size-7 text-zinc-400" />
          </div>
          <p className="font-bold text-zinc-900 dark:text-white mb-1">No equipment profiles</p>
          <p className="text-sm text-zinc-400 max-w-xs mb-6">
            Create profiles for your gym locations to filter exercises by what&apos;s available.
          </p>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 px-4 py-2.5 text-sm font-bold hover:opacity-90 transition-opacity"
          >
            <Plus className="size-4" /> Create first profile
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {profiles.map(profile => (
            <ProfileCard
              key={profile.id}
              profile={profile}
              options={equipmentOptions}
              onActivate={() => handleActivate(profile.id)}
              onDelete={() => handleDelete(profile.id)}
              onEdit={(name, items) => handleEdit(profile.id, name, items)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
