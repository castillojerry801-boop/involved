'use client'

import { useState, useEffect } from 'react'
import { getGifUrl } from '@/lib/exercises'
import { Play, X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface MediaResponse {
  source: 'ymove' | 'exercisedb'
  ymoveId?: string
  videoUrl?: string
  videoHlsUrl?: string
  fallbackGifUrl: string
}

interface Props {
  exerciseId: string
  exerciseName: string
  className?: string
  imgClassName?: string
  /** Which ymove thumbnail crop to use. 'square' for lists; 'default' (3:4) for detail views. */
  crop?: 'default' | 'square' | 'portrait' | 'landscape'
  /** Show a play button overlay that loads inline video from ymove on click. */
  showVideo?: boolean
}

/**
 * Progressive exercise media component.
 *
 * Immediately shows the ExerciseDB GIF (or ymove thumbnail once loaded).
 * With showVideo=true, overlays a play button that fetches and plays
 * the ymove HD video inline on click.
 */
export function ExerciseMedia({
  exerciseId,
  exerciseName,
  className,
  imgClassName,
  crop = 'square',
  showVideo = false,
}: Props) {
  const [media, setMedia] = useState<MediaResponse | null>(null)
  const [playing, setPlaying] = useState(false)
  const [videoSrc, setVideoSrc] = useState<string | null>(null)
  const [videoLoading, setVideoLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/training/exercises/${exerciseId}/media`)
      .then(r => r.ok ? r.json() : null)
      .then((data: MediaResponse | null) => {
        if (!cancelled) setMedia(data)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [exerciseId])

  async function handlePlay() {
    if (videoSrc) { setPlaying(true); return }
    setVideoLoading(true)
    try {
      const res = await fetch(`/api/training/exercises/${exerciseId}/media?video=true`)
      if (res.ok) {
        const data: MediaResponse = await res.json()
        if (data.videoUrl) {
          setVideoSrc(data.videoUrl)
          setPlaying(true)
          return
        }
      }
    } finally {
      setVideoLoading(false)
    }
  }

  const gifSrc = getGifUrl(exerciseId)
  // Thumbnail served through our proxy — raw ymove URLs require the API key header.
  const thumbSrc = media?.ymoveId
    ? `/api/ymove/thumbnail/${media.ymoveId}?crop=${crop}`
    : null

  if (playing && videoSrc) {
    return (
      <div className={cn('relative overflow-hidden bg-black', className)}>
        {/* Portrait 9:16 container */}
        <video
          src={videoSrc}
          autoPlay
          loop
          playsInline
          controls
          className={cn('h-full w-full object-contain', imgClassName)}
          aria-label={`${exerciseName} demonstration`}
        />
        <button
          onClick={() => setPlaying(false)}
          className="absolute top-2 right-2 flex size-7 items-center justify-center rounded-full bg-black/50 text-white"
          aria-label="Close video"
        >
          <X className="size-3.5" />
        </button>
      </div>
    )
  }

  const hasYmove = media?.source === 'ymove' && !!media.ymoveId

  return (
    <div className={cn('relative', className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={thumbSrc ?? gifSrc}
        alt={exerciseName}
        className={cn('h-full w-auto object-contain', imgClassName)}
        onError={e => {
          const img = e.currentTarget
          if (img.src !== gifSrc) img.src = gifSrc
        }}
      />
      {showVideo && hasYmove && (
        <button
          onClick={handlePlay}
          disabled={videoLoading}
          className="absolute inset-0 flex items-center justify-center bg-black/0 hover:bg-black/20 transition-colors group"
          aria-label={`Play ${exerciseName} video`}
        >
          <div className={cn(
            'flex size-10 items-center justify-center rounded-full bg-white/90 shadow-md',
            'opacity-0 group-hover:opacity-100 transition-opacity',
            videoLoading && 'opacity-100 animate-pulse',
          )}>
            <Play className="size-4 text-zinc-900 fill-zinc-900 ml-0.5" />
          </div>
        </button>
      )}
    </div>
  )
}
