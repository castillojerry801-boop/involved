'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { User, Settings, ChevronRight, Trophy, Target, LogOut, Sparkles, Camera, Plus, Trash2, Loader2, X, Lock } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { createClient } from '@/lib/supabase/client'
import type { Entitlement } from '@/lib/subscription/entitlements'

interface ProgressPhoto {
  id: string
  url: string
  note: string | null
  takenAt: string
}

interface PhotosData {
  photos: ProgressPhoto[]
  count: number
  limit: number | null
  canUpload: boolean
}

export default function ProfilePage() {
  const router = useRouter()
  const avatarInputRef = useRef<HTMLInputElement>(null)
  const photoInputRef = useRef<HTMLInputElement>(null)

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [entitlement, setEntitlement] = useState<Entitlement | null>(null)
  const [photosData, setPhotosData] = useState<PhotosData | null>(null)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [lightboxPhoto, setLightboxPhoto] = useState<ProgressPhoto | null>(null)
  const [noteInput, setNoteInput] = useState('')
  const [pendingPhotoFile, setPendingPhotoFile] = useState<File | null>(null)
  const [pendingPhotoPreview, setPendingPhotoPreview] = useState<string | null>(null)
  const [photoError, setPhotoError] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      setEmail(user.email ?? '')
      setName(user.user_metadata?.full_name || user.email?.split('@')[0] || 'Athlete')
    })
    fetch('/api/profile')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.profile?.avatarUrl) setAvatarUrl(data.profile.avatarUrl) })
      .catch(() => null)
    fetch('/api/subscription')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setEntitlement(data as Entitlement) })
      .catch(() => null)
    fetchPhotos()
  }, [])

  const fetchPhotos = () => {
    fetch('/api/profile/progress-photos')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setPhotosData(data as PhotosData) })
      .catch(() => null)
  }

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingAvatar(true)
    const fd = new FormData()
    fd.append('file', file)
    try {
      const res = await fetch('/api/profile/avatar', { method: 'POST', body: fd })
      const data = await res.json() as { url?: string; error?: string }
      if (data.url) setAvatarUrl(data.url)
    } finally {
      setUploadingAvatar(false)
    }
  }

  const handlePhotoFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setPendingPhotoFile(file)
    setPendingPhotoPreview(URL.createObjectURL(file))
    setNoteInput('')
    setPhotoError(null)
  }

  const handlePhotoUpload = async () => {
    if (!pendingPhotoFile) return
    setUploadingPhoto(true)
    setPhotoError(null)
    const fd = new FormData()
    fd.append('file', pendingPhotoFile)
    if (noteInput.trim()) fd.append('note', noteInput.trim())
    try {
      const res = await fetch('/api/profile/progress-photos', { method: 'POST', body: fd })
      const data = await res.json() as { photo?: ProgressPhoto; error?: string }
      if (!res.ok) { setPhotoError(data.error ?? 'Upload failed'); return }
      setPendingPhotoFile(null)
      setPendingPhotoPreview(null)
      fetchPhotos()
    } finally {
      setUploadingPhoto(false)
    }
  }

  const handleDelete = async (id: string) => {
    setDeletingId(id)
    await fetch(`/api/profile/progress-photos/${id}`, { method: 'DELETE' })
    setLightboxPhoto(null)
    fetchPhotos()
    setDeletingId(null)
  }

  const handleSignOut = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  const tierLabel = entitlement?.isPlus ? 'Involved+' : entitlement?.isTrial ? 'Trial' : 'Free'
  const tierVariant: 'accent' | 'info' | 'default' = entitlement?.isPlus ? 'accent' : entitlement?.isTrial ? 'info' : 'default'

  const MENU_SECTIONS = [
    {
      title: 'Goals',
      items: [
        { icon: Target, label: 'My goals', href: '/goals' },
        { icon: Trophy, label: 'Events & races', href: '/goals' },
      ],
    },
    {
      title: 'Account',
      items: [
        { icon: User, label: 'Edit profile', href: '/profile/edit' },
        { icon: Settings, label: 'Settings', href: '/settings' },
      ],
    },
  ]

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:px-8">

      {/* Profile header */}
      <div className="mb-8 flex items-center gap-4">
        <div className="relative shrink-0">
          <button
            onClick={() => avatarInputRef.current?.click()}
            className="relative flex size-20 items-center justify-center rounded-full bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 overflow-hidden group"
          >
            {avatarUrl ? (
              <Image src={avatarUrl} alt="Avatar" fill className="object-cover" />
            ) : (
              <User className="size-9" />
            )}
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 bg-black/55 opacity-0 group-hover:opacity-100 transition-opacity rounded-full">
              {uploadingAvatar
                ? <Loader2 className="size-5 text-white animate-spin" />
                : <>
                    <Camera className="size-4 text-white" />
                    <span className="text-[9px] font-semibold text-white leading-tight">Add photo</span>
                  </>
              }
            </div>
          </button>
          {!avatarUrl && (
            <p className="mt-1.5 text-[10px] text-zinc-400 text-center leading-tight">
              Tap to add<br />a photo
            </p>
          )}
          <input
            ref={avatarInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleAvatarChange}
          />
        </div>
        <div>
          <h1 className="text-xl font-black text-zinc-900 dark:text-white">{name || '—'}</h1>
          <p className="text-sm text-zinc-500">{email}</p>
          <Badge variant={tierVariant} className="mt-2">{tierLabel}</Badge>
          {entitlement?.isTrial && entitlement.trialDaysRemaining !== null && (
            <p className="text-xs text-zinc-400 mt-1">
              {entitlement.trialDaysRemaining} {entitlement.trialDaysRemaining === 1 ? 'day' : 'days'} left in trial
            </p>
          )}
        </div>
      </div>

      {/* Upgrade banner */}
      {!entitlement?.isPlus && (
        <Link
          href="/plus"
          className="mb-6 flex items-center gap-3 rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-5 py-4 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
        >
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-zinc-100 dark:bg-zinc-800">
            <Sparkles className="size-5 text-zinc-500" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-zinc-900 dark:text-white text-sm">
              {entitlement?.isTrial ? 'Keep Involved+ after your trial' : 'Upgrade to Involved+'}
            </p>
            <p className="text-xs text-zinc-400">
              {entitlement?.isTrial
                ? 'Subscribe to keep AI coaching, workout generation, and more.'
                : 'AI coaching, personalized workouts, meal analysis, and more.'}
            </p>
          </div>
          <ChevronRight className="size-4 text-zinc-300 dark:text-zinc-600 shrink-0" />
        </Link>
      )}

      {/* Progress photos */}
      <div className="mb-6">
        <div className="mb-3 flex items-center justify-between px-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Progress Photos</p>
          {photosData && (
            <p className="text-xs text-zinc-400">
              {photosData.count}{photosData.limit ? ` / ${photosData.limit}` : ''} photo{photosData.count !== 1 ? 's' : ''}
            </p>
          )}
        </div>

        {/* Pending upload preview */}
        {pendingPhotoPreview && (
          <div className="mb-3 rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-4">
            <div className="flex gap-3">
              <div className="size-20 shrink-0 rounded-xl overflow-hidden bg-zinc-100 dark:bg-zinc-800 relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={pendingPhotoPreview} alt="Preview" className="size-full object-cover" />
              </div>
              <div className="flex-1 min-w-0">
                <textarea
                  value={noteInput}
                  onChange={e => setNoteInput(e.target.value)}
                  placeholder="Add a note (optional)..."
                  rows={2}
                  maxLength={500}
                  className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:outline-none resize-none"
                />
                {photoError && <p className="mt-1 text-xs text-red-500">{photoError}</p>}
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={handlePhotoUpload}
                    disabled={uploadingPhoto}
                    className="flex items-center gap-1.5 rounded-lg bg-zinc-900 dark:bg-white px-3 py-1.5 text-xs font-semibold text-white dark:text-zinc-900 hover:opacity-90 disabled:opacity-50"
                  >
                    {uploadingPhoto ? <Loader2 className="size-3 animate-spin" /> : null}
                    Save photo
                  </button>
                  <button
                    onClick={() => { setPendingPhotoFile(null); setPendingPhotoPreview(null) }}
                    className="rounded-lg border border-zinc-200 dark:border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-3 gap-2">
          {/* Add button */}
          {!pendingPhotoPreview && (
            photosData?.canUpload === false ? (
              <Link
                href="/plus"
                className="aspect-square rounded-2xl border-2 border-dashed border-zinc-200 dark:border-zinc-700 flex flex-col items-center justify-center gap-1 hover:border-zinc-300 dark:hover:border-zinc-600 transition-colors"
              >
                <Lock className="size-5 text-zinc-300 dark:text-zinc-600" />
                <span className="text-[10px] text-zinc-400 text-center px-1">Upgrade for more</span>
              </Link>
            ) : (
              <button
                onClick={() => photoInputRef.current?.click()}
                className="aspect-square rounded-2xl border-2 border-dashed border-zinc-200 dark:border-zinc-700 flex flex-col items-center justify-center gap-1 hover:border-zinc-300 hover:text-zinc-600 dark:hover:border-zinc-600 dark:hover:text-zinc-300 transition-colors"
              >
                <Plus className="size-5 text-zinc-300 dark:text-zinc-600" />
                <span className="text-[10px] text-zinc-400">Add photo</span>
              </button>
            )
          )}
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handlePhotoFileChange}
          />

          {/* Photo grid */}
          {photosData?.photos.map(photo => (
            <button
              key={photo.id}
              onClick={() => setLightboxPhoto(photo)}
              className="aspect-square rounded-2xl overflow-hidden bg-zinc-100 dark:bg-zinc-800 relative"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.url} alt="Progress" className="size-full object-cover" />
              <div className="absolute bottom-0 left-0 right-0 px-1.5 py-1 bg-gradient-to-t from-black/60 to-transparent">
                <p className="text-[9px] text-white/80">
                  {new Date(photo.takenAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </p>
              </div>
            </button>
          ))}
        </div>

        {photosData?.photos.length === 0 && !pendingPhotoPreview && (
          <p className="mt-3 text-center text-xs text-zinc-400">
            Add your first progress photo to start tracking your journey.
          </p>
        )}
      </div>

      {/* Menu sections */}
      {MENU_SECTIONS.map((section) => (
        <div key={section.title} className="mb-6">
          <p className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-zinc-400">
            {section.title}
          </p>
          <Card className="p-0 overflow-hidden">
            {section.items.map(({ icon: Icon, label, href }, i) => (
              <Link
                key={label}
                href={href}
                className={`w-full flex items-center gap-3 px-5 py-4 text-left text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800 ${
                  i < section.items.length - 1 ? 'border-b border-zinc-100 dark:border-zinc-800' : ''
                }`}
              >
                <Icon className="size-5 text-zinc-400 shrink-0" />
                {label}
                <ChevronRight className="ml-auto size-4 text-zinc-300 dark:text-zinc-600" />
              </Link>
            ))}
          </Card>
        </div>
      ))}

      {/* Subscription management */}
      {entitlement?.isPlus && (
        <div className="mb-6">
          <p className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-zinc-400">Subscription</p>
          <Card className="p-0 overflow-hidden">
            <Link href="/plus" className="w-full flex items-center gap-3 px-5 py-4 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors">
              <Sparkles className="size-5 text-zinc-400 shrink-0" />
              Manage Involved+
              <ChevronRight className="ml-auto size-4 text-zinc-300 dark:text-zinc-600" />
            </Link>
          </Card>
        </div>
      )}

      {/* Sign out */}
      <button
        onClick={handleSignOut}
        className="flex w-full items-center gap-3 rounded-xl border border-red-100 bg-white px-5 py-4 text-left text-sm font-medium text-red-600 transition-colors hover:bg-red-50 dark:border-red-900/20 dark:bg-zinc-900 dark:hover:bg-red-900/10"
      >
        <LogOut className="size-5 shrink-0" />
        Sign out
      </button>

      {/* Lightbox */}
      {lightboxPhoto && (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-black/95"
          onClick={() => setLightboxPhoto(null)}
        >
          <div className="flex items-center justify-between px-4 py-4 shrink-0" onClick={e => e.stopPropagation()}>
            <div>
              <p className="text-sm font-semibold text-white">
                {new Date(lightboxPhoto.takenAt).toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' })}
              </p>
              {lightboxPhoto.note && <p className="text-xs text-zinc-400 mt-0.5">{lightboxPhoto.note}</p>}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleDelete(lightboxPhoto.id)}
                disabled={deletingId === lightboxPhoto.id}
                className="flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/20 disabled:opacity-50"
              >
                {deletingId === lightboxPhoto.id ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />}
                Delete
              </button>
              <button onClick={() => setLightboxPhoto(null)} className="rounded-full p-1.5 text-zinc-400 hover:text-white">
                <X className="size-5" />
              </button>
            </div>
          </div>
          <div className="flex-1 flex items-center justify-center p-4" onClick={e => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={lightboxPhoto.url} alt="Progress" className="max-h-full max-w-full object-contain rounded-2xl" />
          </div>
        </div>
      )}
    </div>
  )
}
