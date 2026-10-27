import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

interface PageHeaderProps {
  title: string
  subtitle?: string
  /** Renders an ArrowLeft back-link on the left */
  backHref?: string
  /** Action buttons rendered on the right */
  children?: ReactNode
  className?: string
}

export function PageHeader({ title, subtitle, backHref, children, className }: PageHeaderProps) {
  return (
    <div className={cn(
      'mb-6 flex items-center gap-3',
      'rounded-2xl border border-emerald-500 bg-zinc-900/80 backdrop-blur-sm px-5 py-4',
      className
    )}>
      {backHref && (
        <Link
          href={backHref}
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/10 hover:bg-white/20 transition-colors"
        >
          <ArrowLeft className="size-4 text-white" />
        </Link>
      )}
      <div className="min-w-0 flex-1">
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
