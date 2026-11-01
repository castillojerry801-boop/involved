'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Shield, GitMerge, Layers, BookOpen, Eye } from 'lucide-react'
import { cn } from '@/lib/utils'

const ICONS = { shield: Shield, 'git-merge': GitMerge, layers: Layers, 'book-open': BookOpen, eye: Eye } as const

export type AdminNavIcon = keyof typeof ICONS

export default function AdminNavLink({
  href,
  label,
  icon,
}: {
  href: string
  label: string
  icon: AdminNavIcon
}) {
  const pathname = usePathname()
  const active = href === '/admin' ? pathname === '/admin' : pathname.startsWith(href)
  const Icon = ICONS[icon]

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
