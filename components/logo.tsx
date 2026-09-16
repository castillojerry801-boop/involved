'use client'

import Image from 'next/image'
import { cn } from '@/lib/utils'

interface InvolvedLogoProps {
  className?: string
  /** 'wordmark' uses the full PNG asset; 'inline' renders text (works on any bg) */
  variant?: 'wordmark' | 'inline'
  size?: 'sm' | 'md' | 'lg'
  /** Only used with variant="inline" */
  scheme?: 'dark' | 'light'
}

// The actual logo is dark-background only — use in marketing, splash, etc.
const wordmarkSizes = {
  sm: { width: 120, height: 40  },
  md: { width: 180, height: 60  },
  lg: { width: 280, height: 93  },
}

// Inline text variant: "INVOL" + emerald "V" + "ED"
// Works on any background (light sidebar, dark header, etc.)
const inlineSizes = {
  sm: 'text-lg',
  md: 'text-2xl',
  lg: 'text-4xl',
}

export function InvolvedLogo({
  className,
  variant = 'inline',
  size = 'md',
  scheme = 'dark',
}: InvolvedLogoProps) {
  if (variant === 'wordmark') {
    const { width, height } = wordmarkSizes[size]
    return (
      <Image
        src="/involved-logo-custom.jpg"
        alt="Involved"
        width={width}
        height={height}
        className={cn('select-none object-contain', className)}
        priority
      />
    )
  }

  // Inline variant — text with emerald V mark
  return (
    <span
      className={cn(
        'font-black uppercase tracking-[0.08em] select-none leading-none',
        inlineSizes[size],
        scheme === 'dark' ? 'text-zinc-950 dark:text-white' : 'text-white',
        className
      )}
    >
      INVOL
      {/* The V — emerald, slightly heavier to match the brand mark */}
      <span className="text-emerald-500">V</span>
      ED
    </span>
  )
}
