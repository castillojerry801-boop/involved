'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Sun, Utensils, Dumbbell, TrendingUp, User, Target, Activity, Users, ChefHat, MoreHorizontal, X, Settings, Calculator } from 'lucide-react'
import Image from 'next/image'
import { cn } from '@/lib/utils'
import { ThemeToggle } from '@/components/theme-toggle'
import { useState } from 'react'

const BASE_NAV_ITEMS = [
  { href: '/today',    label: 'Today',    icon: Sun },
  { href: '/nutrition',label: 'Nutrition', icon: Utensils },
  { href: '/training', label: 'Training',  icon: Dumbbell },
  { href: '/recipes',  label: 'Recipes',   icon: ChefHat },
  { href: '/health',   label: 'Health',    icon: Activity },
  { href: '/coach',    label: 'Coach',     icon: null },
  { href: '/trainer',  label: 'Trainer',   icon: Users, trainerOnly: true },
  { href: '/goals',        label: 'Goals',                icon: Target },
  { href: '/progress',     label: 'Progress',             icon: TrendingUp },
  { href: '/calculators',  label: 'Fitness Calculators',  icon: Calculator },
  { href: '/profile',      label: 'Profile',              icon: User },
]

// 5-item mobile bottom bar: Today, Training, Nutrition, Recipes, More
const MOBILE_PRIMARY = [
  { href: '/today',     label: 'Today',    icon: Sun },
  { href: '/training',  label: 'Training', icon: Dumbbell },
  { href: '/nutrition', label: 'Nutrition', icon: Utensils },
  { href: '/recipes',   label: 'Recipes',  icon: ChefHat },
]

// Items inside the More sheet
const MORE_SECONDARY = [
  { href: '/health',       label: 'Health',               icon: Activity },
  { href: '/goals',        label: 'Goals',                icon: Target },
  { href: '/progress',     label: 'Progress',             icon: TrendingUp },
  { href: '/calculators',  label: 'Fitness Calculators',  icon: Calculator },
  { href: '/profile',      label: 'Profile',              icon: User },
  { href: '/settings',     label: 'Settings',             icon: Settings },
]

export function AppNav({ isTrainer = false }: { isTrainer?: boolean }) {
  const pathname = usePathname()
  const router = useRouter()
  const [moreOpen, setMoreOpen] = useState(false)
  const navItems = BASE_NAV_ITEMS.filter(item => !('trainerOnly' in item && item.trainerOnly && !isTrainer))

  // "More" tab is active when current path doesn't match any primary mobile item
  const primaryPaths = MOBILE_PRIMARY.map(i => i.href)
  const moreActive = !primaryPaths.some(p => pathname.startsWith(p))

  function navigate(href: string) {
    setMoreOpen(false)
    router.push(href)
  }

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

      {/* Mobile bottom nav — 5 items */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex border-t border-zinc-200/50 bg-white/80 backdrop-blur-md dark:border-zinc-700/50 dark:bg-zinc-950/80">
        {MOBILE_PRIMARY.map(({ href, label, icon: Icon }) => {
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

        {/* More button */}
        <button
          onClick={() => setMoreOpen(true)}
          className={cn(
            'flex flex-1 flex-col items-center gap-0.5 py-2.5 px-1 text-[10px] font-medium transition-colors',
            moreActive
              ? 'text-zinc-900 dark:text-white'
              : 'text-zinc-400 dark:text-zinc-600'
          )}
        >
          <MoreHorizontal className={cn('size-5', moreActive && 'stroke-[2.5px]')} />
          <span>More</span>
        </button>
      </nav>

      {/* More sheet */}
      {moreOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px]"
            onClick={() => setMoreOpen(false)}
          />
          <div className="fixed bottom-0 left-0 right-0 z-50 rounded-t-2xl border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 pb-safe">

            {/* Sheet header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100 dark:border-zinc-800">
              <p className="text-sm font-bold text-zinc-900 dark:text-white">More</p>
              <button
                onClick={() => setMoreOpen(false)}
                className="flex size-7 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="px-4 py-3 space-y-1">

              {/* AI Coach — prominent section */}
              <p className="px-2 pb-1 text-[10px] font-bold uppercase tracking-widest text-zinc-400">AI Coach</p>
              <button
                onClick={() => navigate('/coach')}
                className={cn(
                  'flex w-full items-center gap-3 rounded-xl px-4 py-4 text-left transition-colors',
                  pathname.startsWith('/coach')
                    ? 'bg-zinc-900 dark:bg-white'
                    : 'bg-zinc-50 dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                )}
              >
                <Image
                  src="/icon.jpg"
                  alt="Coach V"
                  width={28}
                  height={28}
                  className={cn('size-7 shrink-0 rounded-lg object-cover', !pathname.startsWith('/coach') && 'opacity-80')}
                />
                <div>
                  <p className={cn(
                    'text-sm font-semibold leading-tight',
                    pathname.startsWith('/coach')
                      ? 'text-white dark:text-zinc-900'
                      : 'text-zinc-900 dark:text-white'
                  )}>Coach V</p>
                  <p className={cn(
                    'text-xs leading-tight mt-0.5',
                    pathname.startsWith('/coach')
                      ? 'text-zinc-300 dark:text-zinc-600'
                      : 'text-zinc-500'
                  )}>Your AI fitness coach</p>
                </div>
              </button>

              <div className="pt-2">
                <div className="border-t border-zinc-100 dark:border-zinc-800 pt-2 space-y-0.5">
                  {MORE_SECONDARY.map(({ href, label, icon: Icon }) => {
                    const active = pathname.startsWith(href)
                    return (
                      <button
                        key={href}
                        onClick={() => navigate(href)}
                        className={cn(
                          'flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-medium transition-colors',
                          active
                            ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900'
                            : 'text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100'
                        )}
                      >
                        <Icon className="size-5 shrink-0" />
                        {label}
                      </button>
                    )
                  })}

                  {/* Trainer — conditional */}
                  {isTrainer && (
                    <button
                      onClick={() => navigate('/trainer')}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-medium transition-colors',
                        pathname.startsWith('/trainer')
                          ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900'
                          : 'text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100'
                      )}
                    >
                      <Users className="size-5 shrink-0" />
                      Trainer
                    </button>
                  )}
                </div>
              </div>

            </div>

            {/* Appearance */}
            <div className="px-4 pt-2 pb-1 border-t border-zinc-100 dark:border-zinc-800 mt-1">
              <ThemeToggle className="w-full justify-between rounded-xl px-4 py-3 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900" />
            </div>

            {/* Bottom padding for home indicator */}
            <div className="h-6" />
          </div>
        </>
      )}
    </>
  )
}
