'use client'

import { useTheme } from 'next-themes'
import { Sun, Moon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  if (!mounted) return null

  const isDark = theme === 'dark'

  return (
    <button
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      aria-label="Toggle theme"
      className={cn(
        'flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
        'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900',
        'dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100',
        className,
      )}
    >
      {isDark ? <Sun className="size-5 shrink-0" /> : <Moon className="size-5 shrink-0" />}
      <span>{isDark ? 'Light mode' : 'Dark mode'}</span>
    </button>
  )
}
