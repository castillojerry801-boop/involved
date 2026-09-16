'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Sun, Utensils, Dumbbell, TrendingUp, User } from 'lucide-react'
import { cn } from '@/lib/utils'
import { InvolvedLogo } from '@/components/logo'

const navItems = [
  { href: '/today',    label: 'Today',    icon: Sun },
  { href: '/nutrition',label: 'Nutrition', icon: Utensils },
  { href: '/training', label: 'Training',  icon: Dumbbell },
  { href: '/progress', label: 'Progress',  icon: TrendingUp },
  { href: '/profile',  label: 'Profile',   icon: User },
]

export function AppNav() {
  const pathname = usePathname()

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-64 min-h-screen border-r border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-4 py-8 fixed top-0 left-0">
        <div className="mb-10 px-2">
          <InvolvedLogo size="sm" />
        </div>
        <nav className="flex flex-col gap-1 flex-1">
          {navItems.map(({ href, label, icon: Icon }) => {
            const active = pathname.startsWith(href)
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  'flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition-colors',
                  active
                    ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900'
                    : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100'
                )}
              >
                <Icon className="size-5 shrink-0" />
                {label}
              </Link>
            )
          })}
        </nav>
        <p className="px-3 text-xs text-zinc-400 dark:text-zinc-600">Involved v0.1</p>
      </aside>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex border-t border-zinc-100 bg-white/95 backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-950/95">
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = pathname.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex flex-1 flex-col items-center gap-0.5 py-2.5 px-1 text-[10px] font-medium transition-colors',
                active
                  ? 'text-zinc-900 dark:text-white'
                  : 'text-zinc-400 dark:text-zinc-600'
              )}
            >
              <Icon className={cn('size-5', active && 'stroke-[2.5px]')} />
              <span>{label}</span>
            </Link>
          )
        })}
      </nav>
    </>
  )
}
