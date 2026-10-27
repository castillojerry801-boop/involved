import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

interface PageHeaderProps {
  title: string
  subtitle?: string
  children?: ReactNode  // action buttons rendered on the right
  className?: string
}

export function PageHeader({ title, subtitle, children, className }: PageHeaderProps) {
  return (
    <div className={cn(
      'mb-6 flex items-center justify-between gap-3',
      'rounded-2xl border border-emerald-500/60 bg-zinc-900/80 backdrop-blur-sm px-5 py-4',
      className
    )}>
      <div className="min-w-0">
        <h1 className="text-2xl font-black text-white">{title}</h1>
        {subtitle && <p className="text-sm text-zinc-300 mt-0.5">{subtitle}</p>}
      </div>
      {children && (
        <div className="flex items-center gap-2 shrink-0">
          {children}
        </div>
      )}
    </div>
  )
}
