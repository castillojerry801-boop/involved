'use client'
import { useState, useEffect, useCallback } from 'react'

export type DistanceUnit = 'mi' | 'km'

const STORAGE_KEY = 'distance_unit'

// 1 km = 0.6213711922 miles (exact per spec)
export const MI_PER_KM = 0.6213711922

function writeUnitCookie(u: DistanceUnit) {
  document.cookie = `distance_unit=${u}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`
}

/**
 * Convert meters to a display string in the given unit.
 * Returns a number-only string (no suffix); callers append the unit label.
 */
export function formatDistanceM(m: number, unit: DistanceUnit): string {
  const km = m / 1000
  if (unit === 'mi') return (km * MI_PER_KM).toFixed(2)
  return km.toFixed(2)
}

export function useDistanceUnit() {
  const [unit, setUnitState] = useState<DistanceUnit>('mi')

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as DistanceUnit | null
    if (stored === 'mi' || stored === 'km') {
      setUnitState(stored)
      writeUnitCookie(stored)
    }
  }, [])

  const setUnit = useCallback((u: DistanceUnit) => {
    setUnitState(u)
    localStorage.setItem(STORAGE_KEY, u)
    writeUnitCookie(u)
  }, [])

  const metersToDisplay = useCallback((m: number | null | undefined): string => {
    if (m == null) return ''
    return formatDistanceM(m, unit)
  }, [unit])

  return { unit, setUnit, metersToDisplay }
}
