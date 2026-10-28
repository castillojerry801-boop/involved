import { cn } from '@/lib/utils'

interface CircleRingProps {
  value: number
  max: number
  size: number
  stroke: number
  className: string
  trackClassName?: string
}

export function CircleRing({ value, max, size, stroke, className, trackClassName }: CircleRingProps) {
  const r             = (size - stroke) / 2
  const circumference = 2 * Math.PI * r
  const filled        = Math.min(value / Math.max(max, 1), 1)
  const offset        = circumference * (1 - filled)
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}
      style={{ transform: 'rotate(-90deg)', overflow: 'visible' }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke="currentColor" strokeWidth={stroke}
        className={cn('text-zinc-200 dark:text-zinc-700', trackClassName)} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke="currentColor" strokeWidth={stroke}
        strokeLinecap="round" className={className}
        style={{ strokeDasharray: circumference, strokeDashoffset: offset, transition: 'stroke-dashoffset 0.6s ease' }} />
    </svg>
  )
}
