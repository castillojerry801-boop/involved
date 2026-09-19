'use client'
import { useState, useEffect, useCallback } from 'react'

export type WeightUnit = 'lbs' | 'kg'

const STORAGE_KEY = 'weight_unit'
export const LBS_PER_KG = 2.20462

function writeUnitCookie(u: WeightUnit) {
  document.cookie = `weight_unit=${u}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`
}

export function useWeightUnit() {
  const [unit, setUnitState] = useState<WeightUnit>('lbs')

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as WeightUnit | null
    if (stored === 'kg' || stored === 'lbs') {
      setUnitState(stored)
      writeUnitCookie(stored)
    }
  }, [])

  const setUnit = useCallback((u: WeightUnit) => {
    setUnitState(u)
    localStorage.setItem(STORAGE_KEY, u)
    writeUnitCookie(u)
  }, [])

  // Convert stored kg value to display string in selected unit
  const toDisplay = useCallback((kg: number | null | undefined): string => {
    if (kg == null) return ''
    if (unit === 'lbs') return String(Math.round(kg * LBS_PER_KG * 10) / 10)
    return String(kg)
  }, [unit])

  // Convert typed input (in selected unit) back to kg for storage
  const fromInput = useCallback((val: string): number | undefined => {
    if (!val) return undefined
    const n = Number(val)
    if (isNaN(n) || n <= 0) return undefined
    return unit === 'lbs' ? Math.round((n / LBS_PER_KG) * 100) / 100 : n
  }, [unit])

  return { unit, setUnit, toDisplay, fromInput }
}
