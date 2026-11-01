'use client'

import { useEffect, useState } from 'react'

interface Props {
  /**
   * YMove exercise UUID. When provided the component fetches the SVG body-map
   * from the sanitized server-side proxy (/api/ymove/body-map/:ymoveId).
   * Takes precedence over exerciseId.
   */
  ymoveId?: string | null
  /**
   * ExerciseDB exercise ID. When provided and ymoveId is absent, the component
   * fetches via /api/ymove/body-map/by-exercise/:exerciseId which resolves the
   * ymoveId server-side. Falls back to text-tag mode if no mapping exists.
   */
  exerciseId?: string | null
  /** Primary muscles — shown in text-tag fallback and as the label when SVG renders. */
  primaryMuscles: string[]
  /** Secondary muscles — clearly distinct from primary in both SVG and text-tag modes. */
  secondaryMuscles?: string[]
  className?: string
}

function MuscleTag({
  label,
  variant,
}: {
  label: string
  variant: 'primary' | 'secondary'
}) {
  const base = 'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize'
  const styles =
    variant === 'primary'
      ? `${base} bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200`
      : `${base} bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400`
  return <span className={styles}>{label.replace(/-/g, ' ')}</span>
}

function TextTagFallback({
  primaryMuscles,
  secondaryMuscles,
}: {
  primaryMuscles: string[]
  secondaryMuscles: string[]
}) {
  return (
    <div className="flex flex-col gap-2">
      {primaryMuscles.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {primaryMuscles.map(m => (
            <MuscleTag key={m} label={m} variant="primary" />
          ))}
        </div>
      )}
      {secondaryMuscles.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <span className="text-xs text-zinc-400 dark:text-zinc-500 self-center">also involves:</span>
          {secondaryMuscles.map(m => (
            <MuscleTag key={m} label={m} variant="secondary" />
          ))}
        </div>
      )}
    </div>
  )
}

export function MuscleBodyMap({
  ymoveId,
  exerciseId,
  primaryMuscles,
  secondaryMuscles = [],
  className = '',
}: Props) {
  const [svgMarkup, setSvgMarkup] = useState<string | null>(null)
  const [fetchFailed, setFetchFailed] = useState(false)

  // Resolve which URL to fetch — ymoveId route takes precedence over exerciseId route
  const fetchUrl = ymoveId
    ? `/api/ymove/body-map/${encodeURIComponent(ymoveId)}`
    : exerciseId
      ? `/api/ymove/body-map/by-exercise/${encodeURIComponent(exerciseId)}`
      : null

  useEffect(() => {
    if (!fetchUrl) return

    let cancelled = false
    setSvgMarkup(null)
    setFetchFailed(false)

    fetch(fetchUrl)
      .then(res => {
        if (!res.ok) throw new Error(`${res.status}`)
        return res.text()
      })
      .then(svg => {
        if (!cancelled) setSvgMarkup(svg)
      })
      .catch(() => {
        if (!cancelled) setFetchFailed(true)
      })

    return () => {
      cancelled = true
    }
  }, [fetchUrl])

  // Text-tag mode: no identifier provided, or fetch failed/404
  if (!fetchUrl || fetchFailed) {
    return (
      <div className={className}>
        <TextTagFallback
          primaryMuscles={primaryMuscles}
          secondaryMuscles={secondaryMuscles}
        />
      </div>
    )
  }

  // Loading state
  if (!svgMarkup) {
    return (
      <div className={`${className} flex items-center justify-center`}>
        <div className="h-40 w-32 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-800" />
      </div>
    )
  }

  // SVG mode — markup is sanitized server-side before reaching this component
  return (
    <div className={className}>
      <div
        // SVG is sanitized server-side via sanitizeSvg() before the proxy returns it
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: svgMarkup }}
        className="[&>svg]:h-auto [&>svg]:w-full [&>svg]:max-w-[200px]"
        role="img"
        aria-label={
          primaryMuscles.length > 0
            ? `Muscle diagram: ${primaryMuscles.join(', ')}`
            : 'Muscle diagram'
        }
      />
      {(primaryMuscles.length > 0 || secondaryMuscles.length > 0) && (
        <div className="mt-2">
          <TextTagFallback
            primaryMuscles={primaryMuscles}
            secondaryMuscles={secondaryMuscles}
          />
        </div>
      )}
    </div>
  )
}
