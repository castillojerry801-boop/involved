'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import type { LucideIcon } from 'lucide-react'

export default function AdminNavLink({
  href,
  label,
  Icon,
}: {
  href: string
  label: string
  Icon: LucideIcon
}) {
  const pathname = usePathname()
  // Exact match for /admin root to avoid it being active on all sub-pages
  const active = href === '/admin' ? pathname === '/admin' : pathname.startsWith(href)

  return (
    <Link
      href={href}
      className={cn(
        'flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
        active
          ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900'
          : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100',
      )}
    >
      <Icon className="size-3.5 shrink-0" />
      {label}
    </Link>
  )
}
