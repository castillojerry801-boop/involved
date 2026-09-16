import type { Metadata } from 'next'
import { User, Settings, ChevronRight, Trophy, Target, LogOut } from 'lucide-react'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

export const metadata: Metadata = { title: 'Profile' }

const DEMO_STATS = [
  { label: 'Workouts', value: '47' },
  { label: 'PRs set', value: '12' },
  { label: 'Day streak', value: '7' },
]

const MENU_SECTIONS = [
  {
    title: 'Goals',
    items: [
      { icon: Target, label: 'My goals', href: '/goals' },
      { icon: Trophy, label: 'Events & races', href: '/events' },
    ],
  },
  {
    title: 'Account',
    items: [
      { icon: User, label: 'Edit profile', href: '/profile/edit' },
      { icon: Settings, label: 'Settings', href: '/settings' },
    ],
  },
]

export default function ProfilePage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:px-8">
      {/* Profile header */}
      <div className="mb-8 flex items-center gap-4">
        <div className="flex size-20 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-white dark:bg-white dark:text-zinc-900">
          <User className="size-9" />
        </div>
        <div>
          <h1 className="text-xl font-black text-zinc-900 dark:text-white">Athlete</h1>
          <p className="text-sm text-zinc-500">athlete@example.com</p>
          <Badge variant="default" className="mt-2">Free plan</Badge>
        </div>
      </div>

      {/* Stats */}
      <Card className="mb-6">
        <div className="grid grid-cols-3 divide-x divide-zinc-100 dark:divide-zinc-800">
          {DEMO_STATS.map(({ label, value }) => (
            <div key={label} className="px-4 text-center first:pl-0 last:pr-0">
              <p className="text-2xl font-black text-zinc-900 dark:text-white">{value}</p>
              <p className="text-xs text-zinc-500">{label}</p>
            </div>
          ))}
        </div>
      </Card>

      {/* Menu sections */}
      {MENU_SECTIONS.map((section) => (
        <div key={section.title} className="mb-6">
          <p className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-zinc-400">
            {section.title}
          </p>
          <Card className="p-0 overflow-hidden">
            {section.items.map(({ icon: Icon, label }, i) => (
              <button
                key={label}
                className={`w-full flex items-center gap-3 px-5 py-4 text-left text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800 ${
                  i < section.items.length - 1 ? 'border-b border-zinc-100 dark:border-zinc-800' : ''
                }`}
              >
                <Icon className="size-5 text-zinc-400 shrink-0" />
                {label}
                <ChevronRight className="ml-auto size-4 text-zinc-300 dark:text-zinc-600" />
              </button>
            ))}
          </Card>
        </div>
      ))}

      {/* Sign out */}
      <button className="flex w-full items-center gap-3 rounded-xl border border-red-100 bg-white px-5 py-4 text-left text-sm font-medium text-red-600 transition-colors hover:bg-red-50 dark:border-red-900/20 dark:bg-zinc-900 dark:hover:bg-red-900/10">
        <LogOut className="size-5 shrink-0" />
        Sign out
      </button>
    </div>
  )
}
