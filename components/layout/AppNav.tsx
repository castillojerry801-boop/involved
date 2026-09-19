'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Sun, Utensils, Dumbbell, TrendingUp, User, Target, Activity, Users } from 'lucide-react'
import Image from 'next/image'
import { cn } from '@/lib/utils'
import { ThemeToggle } from '@/components/theme-toggle'

const navItems = [
  { href: '/today',    label: 'Today',    icon: Sun },
  { href: '/nutrition',label: 'Nutrition', icon: Utensils },
  { href: '/training', label: 'Training',  icon: Dumbbell },
  { href: '/health',   label: 'Health',    icon: Activity },
  { href: '/coach',    label: 'Coach',     icon: null },
  { href: '/trainer',  label: 'Trainer',   icon: Users },
  { href: '/goals',    label: 'Goals',     icon: Target },
  { href: '/progress', label: 'Progress',  icon: TrendingUp },
  { href: '/profile',  label: 'Profile',   icon: User },
]

// Subset shown in the mobile bottom bar — keep to 5 to avoid crowding
const mobileNavItems = [
  { href: '/today',    label: 'Today',    icon: Sun },
  { href: '/training', label: 'Training',  icon: Dumbbell },
  { href: '/health',   label: 'Health',    icon: Activity },
  { href: '/coach',    label: 'Coach',     icon: null },
  { href: '/profile',  label: 'Profile',   icon: User },
]

export function AppNav() {
  const pathname = usePathname()

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-64 min-h-screen border-r border-zinc-200/50 dark:border-zinc-700/50 bg-white/80 dark:bg-zinc-950/80 backdrop-blur-md px-4 py-8 fixed top-0 left-0 z-40">
        <div className="mb-10 -mx-2">
          <div className="rounded-xl bg-zinc-950 px-3 py-2.5">
            <Image
              src="/involved-logo-custom.jpg"
              alt="Involved"
              width={140}
              height={47}
              className="w-full object-contain"
              priority
            />
          </div>
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
                {Icon
                  ? <Icon className="size-5 shrink-0" />
                  : <Image src="/icon.jpg" alt="Coach" width={20} height={20} className="size-5 shrink-0 rounded-md object-cover" />
                }
                {label}
              </Link>
            )
          })}
        </nav>
        <div className="flex flex-col gap-2 border-t border-zinc-200/50 dark:border-zinc-700/50 pt-4 mt-2">
          <ThemeToggle />
          <p className="px-3 text-xs text-zinc-400 dark:text-zinc-600">Involved v0.1</p>
        </div>
      </aside>

      {/* Mobile: top bar with theme toggle */}
      <header className="md:hidden fixed top-0 left-0 right-0 z-50 flex items-center justify-end px-4 h-12 bg-white/80 dark:bg-zinc-950/80 backdrop-blur-md border-b border-zinc-200/50 dark:border-zinc-700/50">
        <ThemeToggle className="py-1.5 text-xs gap-1.5" />
      </header>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex border-t border-zinc-200/50 bg-white/80 backdrop-blur-md dark:border-zinc-700/50 dark:bg-zinc-950/80">
        {mobileNavItems.map(({ href, label, icon: Icon }) => {
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
              {Icon
                ? <Icon className={cn('size-5', active && 'stroke-[2.5px]')} />
                : <Image src="/icon.jpg" alt="Coach" width={20} height={20} className={cn('size-5 rounded-md object-cover', !active && 'opacity-50')} />
              }
              <span>{label}</span>
            </Link>
          )
        })}
      </nav>
    </>
  )
}
