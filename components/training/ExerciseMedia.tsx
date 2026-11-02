'use client'

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { getGifUrl } from '@/lib/exercises'
import { Play, X, VideoOff } from 'lucide-react'
import { cn } from '@/lib/utils'

interface MediaResponse {
  source: 'ymove' | 'exercisedb'
  ymoveId?: string
  videoUrl?: string
  videoHlsUrl?: string
  fallbackGifUrl: string
  /**
   * Thumbnail media UUID — different from ymoveId (exercise UUID).
   * The client passes this through the /api/ymove/thumbnail proxy which adds the API key.
   * null means the metadata fetch failed or the URL couldn't be parsed.
   */
  thumbnailMediaId?: string | null
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
  /**
   * When true, tapping play opens the video in a fullscreen portal modal instead
   * of replacing the thumbnail inline. Use for compact containers (e.g. workout cards)
   * where the container size would make inline video unreadable.
   */
  videoModal?: boolean
}

function VideoModal({ src, exerciseName, onClose }: {
  src: string
  exerciseName: string
  onClose: () => void
}) {
  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/90 p-4"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-sm"
        onClick={e => e.stopPropagation()}
      >
        <video
          src={src}
          autoPlay
          loop
          playsInline
          controls
          className="w-full rounded-2xl"
          style={{ maxHeight: '80vh' }}
          aria-label={`${exerciseName} demonstration`}
        />
        <button
          onClick={onClose}
          className="absolute top-2 right-2 flex size-8 items-center justify-center rounded-full bg-black/60 text-white"
          aria-label="Close video"
        >
          <X className="size-4" />
        </button>
        <p className="mt-3 text-center text-sm font-semibold text-white">{exerciseName}</p>
      </div>
    </div>,
    document.body,
  )
}

/**
 * Progressive exercise media component.
 *
 * Immediately shows the ExerciseDB GIF (or ymove thumbnail once loaded).
 * With showVideo=true, overlays a play button that fetches and plays
 * the ymove HD video. With videoModal=true, the video opens in a fullscreen
 * portal instead of replacing the thumbnail inline.
 */
export function ExerciseMedia({
  exerciseId,
  exerciseName,
  className,
  imgClassName,
  crop = 'square',
  showVideo = false,
  videoModal = false,
}: Props) {
  const [media, setMedia] = useState<MediaResponse | null>(null)
  const [playing, setPlaying] = useState(false)
  const [videoSrc, setVideoSrc] = useState<string | null>(null)
  const [videoLoading, setVideoLoading] = useState(false)
  const [videoError, setVideoError] = useState(false)

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

  async function handlePlay(e?: React.MouseEvent) {
    // Prevent parent click handlers (e.g. collapse buttons in workout session) from
    // firing when the user taps the play overlay.
    e?.stopPropagation()
    if (videoSrc) { setPlaying(true); return }
    setVideoError(false)
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
      // Provider returned no playable URL — show feedback instead of silently doing nothing.
      setVideoError(true)
    } finally {
      setVideoLoading(false)
    }
  }

  const gifSrc = getGifUrl(exerciseId)
  // Thumbnail served through the proxy (adds API key). Media UUID ≠ exercise UUID.
  const thumbSrc = media?.thumbnailMediaId
    ? `/api/ymove/thumbnail/${media.thumbnailMediaId}?crop=${crop}`
    : null

  // Inline video — only when videoModal=false (default behavior)
  if (playing && videoSrc && !videoModal) {
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
    <>
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
            onClick={videoError ? undefined : handlePlay}
            disabled={videoLoading || videoError}
            className="absolute inset-0 flex items-center justify-center bg-black/0 hover:bg-black/20 transition-colors group"
            aria-label={videoError ? `No video available for ${exerciseName}` : `Play ${exerciseName} video`}
          >
            {videoError ? (
              <div className="flex flex-col items-center gap-1.5">
                <div className="flex size-10 items-center justify-center rounded-full bg-black/60 shadow-md">
                  <VideoOff className="size-4 text-white/80" />
                </div>
                <span className="rounded px-1.5 py-0.5 bg-black/50 text-[10px] text-white/80 leading-none">
                  No video
                </span>
              </div>
            ) : (
              <div className={cn(
                'flex size-10 items-center justify-center rounded-full bg-white/90 shadow-md',
                'opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity',
                videoLoading && 'opacity-100 animate-pulse',
              )}>
                <Play className="size-4 text-zinc-900 fill-zinc-900 ml-0.5" />
              </div>
            )}
          </button>
        )}
      </div>
      {/* Modal portal — only active when videoModal=true and a video is playing */}
      {videoModal && playing && videoSrc && (
        <VideoModal src={videoSrc} exerciseName={exerciseName} onClose={() => setPlaying(false)} />
      )}
    </>
  )
}
