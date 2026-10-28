interface MacroData {
  consumed: number
  target: number
}

interface ConcentricMacroRingsProps {
  protein: MacroData
  carbs: MacroData
  fat: MacroData
  size?: number
}

const RING_DEFS = [
  { id: 'protein', color: 'text-sky-400'    },
  { id: 'carbs',   color: 'text-amber-400'  },
  { id: 'fat',     color: 'text-orange-400' },
] as const

// Three concentric progress rings: protein (outer), carbs (middle), fat (inner).
// stroke=5, gap=3 — each ring fits cleanly within the SVG viewport at default size=90.
export function ConcentricMacroRings({ protein, carbs, fat, size = 90 }: ConcentricMacroRingsProps) {
  const center = size / 2
  const stroke = 5
  const gap    = 3

  const r0 = center - stroke / 2       // protein: outermost edge sits at the SVG boundary
  const r1 = r0 - stroke - gap         // carbs
  const r2 = r1 - stroke - gap         // fat

  const rings = [
    { ...RING_DEFS[0], r: r0, data: protein },
    { ...RING_DEFS[1], r: r1, data: carbs   },
    { ...RING_DEFS[2], r: r2, data: fat     },
  ]

  return (
    <svg
      width={size} height={size} viewBox={`0 0 ${size} ${size}`}
      style={{ transform: 'rotate(-90deg)', overflow: 'visible' }}
      aria-label="Macro progress: protein, carbs, fat"
    >
      {rings.map(({ id, color, r, data }) => {
        const C      = 2 * Math.PI * r
        const filled = Math.min(data.consumed / Math.max(data.target, 1), 1)
        const offset = C * (1 - filled)
        return (
          <g key={id}>
            {/* Track */}
            <circle cx={center} cy={center} r={r} fill="none"
              stroke="currentColor" strokeWidth={stroke}
              className="text-zinc-200 dark:text-zinc-700" />
            {/* Progress arc — omitted at 0 to avoid stray round-linecap dots */}
            {data.consumed > 0 && (
              <circle cx={center} cy={center} r={r} fill="none"
                stroke="currentColor" strokeWidth={stroke}
                strokeLinecap="round" className={color}
                style={{ strokeDasharray: C, strokeDashoffset: offset, transition: 'stroke-dashoffset 0.6s ease' }} />
            )}
          </g>
        )
      })}
    </svg>
  )
}
