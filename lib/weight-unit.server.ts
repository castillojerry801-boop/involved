import 'server-only'
import { headers } from 'next/headers'

export type WeightUnit = 'lbs' | 'kg'
export const LBS_PER_KG = 2.20462

export async function getWeightUnit(): Promise<WeightUnit> {
  const h = await headers()
  const unit = h.get('x-weight-unit')
  return unit === 'kg' ? 'kg' : 'lbs'
}

export function kgToUnit(kg: number | null | undefined, unit: WeightUnit): string {
  if (kg == null) return '—'
  if (unit === 'lbs') return `${Math.round(kg * LBS_PER_KG * 10) / 10} lbs`
  return `${kg} kg`
}
