'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Loader2, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

type FitnessLevel = 'beginner' | 'intermediate' | 'advanced'

interface ProfileData {
  displayName:  string | null
  username:     string | null
  bio:          string | null
  fitnessLevel: FitnessLevel | null
  heightCm:     number | null
  weightKg:     number | null
}

const FITNESS_LEVELS: { id: FitnessLevel; label: string }[] = [
  { id: 'beginner',     label: 'Beginner' },
  { id: 'intermediate', label: 'Intermediate' },
  { id: 'advanced',     label: 'Advanced' },
]

export default function ProfileEditPage() {
  const router = useRouter()
  const [loading, setLoading]   = useState(true)
  const [saving,  setSaving]    = useState(false)
  const [saved,   setSaved]     = useState(false)
  const [error,   setError]     = useState<string | null>(null)

  const [form, setForm] = useState({
    displayName:  '',
    username:     '',
    bio:          '',
    fitnessLevel: null as FitnessLevel | null,
    heightCm:     '',
    weightKg:     '',
  })

  useEffect(() => {
    fetch('/api/profile')
      .then(r => r.json() as Promise<{ profile: ProfileData }>)
      .then(({ profile }) => {
        setForm({
          displayName:  profile.displayName  ?? '',
          username:     profile.username     ?? '',
          bio:          profile.bio          ?? '',
          fitnessLevel: profile.fitnessLevel ?? null,
          heightCm:     profile.heightCm != null ? String(profile.heightCm)  : '',
          weightKg:     profile.weightKg != null ? String(profile.weightKg)  : '',
        })
      })
      .finally(() => setLoading(false))
  }, [])

  const handleSave = async () => {
    if (!form.displayName.trim()) { setError('Name is required'); return }
    setSaving(true)
    setError(null)

    const r = await fetch('/api/profile', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        displayName:  form.displayName,
        username:     form.username,
        bio:          form.bio,
        fitnessLevel: form.fitnessLevel,
        heightCm:     form.heightCm  ? parseFloat(form.heightCm)  : null,
        weightKg:     form.weightKg  ? parseFloat(form.weightKg)  : null,
      }),
    })

    if (r.ok) {
      setSaved(true)
      setTimeout(() => router.push('/profile'), 800)
    } else {
      const d = await r.json() as { error?: string }
      setError(d.error ?? 'Failed to save')
    }
    setSaving(false)
  }

  if (loading) return (
    <div className="flex justify-center py-20">
      <Loader2 className="size-6 animate-spin text-zinc-400" />
    </div>
  )

  return (
    <div className="mx-auto max-w-lg px-4 py-8 md:px-8">

      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <Link href="/profile" className="flex size-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors">
          <ArrowLeft className="size-4 text-zinc-600 dark:text-zinc-400" />
        </Link>
        <h1 className="text-xl font-black text-zinc-900 dark:text-white">Edit profile</h1>
      </div>

      <div className="space-y-4">

        {/* Identity */}
        <div className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-4">
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">Identity</p>

          <div>
            <label className="text-xs text-zinc-500 block mb-1.5">Name <span className="text-red-400">*</span></label>
            <input
              type="text"
              value={form.displayName}
              onChange={e => setForm(f => ({ ...f, displayName: e.target.value }))}
              placeholder="Your name"
              className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2.5 text-sm text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:outline-none focus:border-zinc-400"
            />
          </div>

          <div>
            <label className="text-xs text-zinc-500 block mb-1.5">Username</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-zinc-400">@</span>
              <input
                type="text"
                value={form.username}
                onChange={e => setForm(f => ({ ...f, username: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') }))}
                placeholder="yourhandle"
                className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 pl-7 pr-3 py-2.5 text-sm text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:outline-none focus:border-zinc-400"
              />
            </div>
            <p className="text-[11px] text-zinc-400 mt-1">3–30 characters, letters, numbers, underscores</p>
          </div>

          <div>
            <label className="text-xs text-zinc-500 block mb-1.5">Bio</label>
            <textarea
              value={form.bio}
              onChange={e => setForm(f => ({ ...f, bio: e.target.value }))}
              placeholder="A sentence about you..."
              rows={2}
              maxLength={500}
              className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2.5 text-sm text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:outline-none focus:border-zinc-400 resize-none"
            />
          </div>
        </div>

        {/* Fitness */}
        <div className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-3">
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">Fitness level</p>
          <div className="flex gap-2">
            {FITNESS_LEVELS.map(level => (
              <button
                key={level.id}
                onClick={() => setForm(f => ({ ...f, fitnessLevel: level.id }))}
                className={cn(
                  'flex-1 rounded-xl border py-2.5 text-sm font-medium transition-all',
                  form.fitnessLevel === level.id
                    ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/10 text-emerald-700 dark:text-emerald-400'
                    : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:border-zinc-300 dark:hover:border-zinc-600'
                )}
              >
                {level.label}
              </button>
            ))}
          </div>
        </div>

        {/* Body stats */}
        <div className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-4">
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">Body stats</p>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-xs text-zinc-500 block mb-1.5">Weight (kg)</label>
              <input
                type="number"
                value={form.weightKg}
                onChange={e => setForm(f => ({ ...f, weightKg: e.target.value }))}
                placeholder="75"
                className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2.5 text-sm text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:outline-none focus:border-zinc-400"
              />
            </div>
            <div className="flex-1">
              <label className="text-xs text-zinc-500 block mb-1.5">Height (cm)</label>
              <input
                type="number"
                value={form.heightCm}
                onChange={e => setForm(f => ({ ...f, heightCm: e.target.value }))}
                placeholder="178"
                className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2.5 text-sm text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:outline-none focus:border-zinc-400"
              />
            </div>
          </div>
        </div>

        {/* Error */}
        {error && (
          <p className="rounded-xl bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-800/30 px-4 py-3 text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}

        {/* Save */}
        <button
          onClick={handleSave}
          disabled={saving || saved}
          className={cn(
            'flex w-full items-center justify-center gap-2 rounded-2xl px-6 py-3.5 text-sm font-black transition-all',
            saved
              ? 'bg-emerald-600 text-white'
              : 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 hover:opacity-90 disabled:opacity-50'
          )}
        >
          {saving && <Loader2 className="size-4 animate-spin" />}
          {saved  && <Check className="size-4" />}
          {saved ? 'Saved' : saving ? 'Saving…' : 'Save changes'}
        </button>

      </div>
    </div>
  )
}
