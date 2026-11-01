'use client'

import { useEffect, useState } from 'react'

interface Props {
  /**
   * YMove exercise UUID. When provided the component fetches the SVG body-map
   * from the sanitized server-side proxy (/api/ymove/body-map/:ymoveId).
   * Takes precedence over exerciseId / exerciseIds.
   */
  ymoveId?: string | null
  /**
   * ExerciseDB exercise ID. When provided and ymoveId is absent, the component
   * fetches via /api/ymove/body-map/by-exercise/:exerciseId which resolves the
   * ymoveId server-side. Falls back to text-tag mode if no mapping exists.
   */
  exerciseId?: string | null
  /**
   * Ordered list of ExerciseDB exercise IDs to try when a single exerciseId is
   * not available or its mapping returns 404. Used by canonical exercise views
   * where the first implementation may be unmapped but later ones are verified.
   * Ignored when ymoveId or exerciseId is set. The component tries each in
   * sequence and uses the first that returns a valid body map.
   */
  exerciseIds?: string[]
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

// Derives the ordered candidate fetch URLs from props.
// ymoveId → single URL (highest priority)
// exerciseId → single URL
// exerciseIds → one URL per ID in order (tried sequentially on 404)
function buildCandidates(
  ymoveId?: string | null,
  exerciseId?: string | null,
  exerciseIds?: string[],
): string[] {
  if (ymoveId) return [`/api/ymove/body-map/${encodeURIComponent(ymoveId)}`]
  if (exerciseId) return [`/api/ymove/body-map/by-exercise/${encodeURIComponent(exerciseId)}`]
  if (exerciseIds && exerciseIds.length > 0) {
    return exerciseIds.map(id => `/api/ymove/body-map/by-exercise/${encodeURIComponent(id)}`)
  }
  return []
}

export function MuscleBodyMap({
  ymoveId,
  exerciseId,
  exerciseIds,
  primaryMuscles,
  secondaryMuscles = [],
  className = '',
}: Props) {
  const [svgMarkup, setSvgMarkup] = useState<string | null>(null)
  const [fetchFailed, setFetchFailed] = useState(false)
  // Index into the candidates list — advances on 404/error to try next candidate
  const [candidateIndex, setCandidateIndex] = useState(0)

  // Stable key representing the full candidate set — used to reset state when
  // the prop set changes (e.g. parent navigates to a different exercise).
  const candidatesKey = `${ymoveId ?? ''}|${exerciseId ?? ''}|${(exerciseIds ?? []).join(',')}`

  // Reset all fetch state when the candidate set changes
  useEffect(() => {
    setCandidateIndex(0)
    setSvgMarkup(null)
    setFetchFailed(false)
  }, [candidatesKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const candidates = buildCandidates(ymoveId, exerciseId, exerciseIds)
  const fetchUrl = candidates[candidateIndex] ?? null

  useEffect(() => {
    if (!fetchUrl) return

    let cancelled = false
    setSvgMarkup(null)

    fetch(fetchUrl)
      .then(res => {
        if (!res.ok) throw new Error(`${res.status}`)
        return res.text()
      })
      .then(svg => {
        if (!cancelled) setSvgMarkup(svg)
      })
      .catch(() => {
        if (cancelled) return
        // Try the next candidate if one exists; otherwise give up
        if (candidateIndex < candidates.length - 1) {
          setCandidateIndex(i => i + 1)
        } else {
          setFetchFailed(true)
        }
      })

    return () => {
      cancelled = true
    }
  }, [fetchUrl]) // eslint-disable-line react-hooks/exhaustive-deps

  // Text-tag mode: no identifiers provided, or all candidates exhausted
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

  // Loading state (between candidates or initial load)
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
