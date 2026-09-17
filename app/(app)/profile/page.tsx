'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { User, Settings, ChevronRight, Trophy, Target, LogOut, Sparkles } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { createClient } from '@/lib/supabase/client'
import type { Entitlement } from '@/lib/subscription/entitlements'

export default function ProfilePage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [entitlement, setEntitlement] = useState<Entitlement | null>(null)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      setEmail(user.email ?? '')
      setName(
        user.user_metadata?.full_name ||
        user.email?.split('@')[0] ||
        'Athlete'
      )
    })
    fetch('/api/subscription')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setEntitlement(data as Entitlement) })
      .catch(() => null)
  }, [])

  const handleSignOut = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  const tierLabel =
    entitlement?.isPlus   ? 'Involved+'  :
    entitlement?.isTrial  ? 'Trial'      :
    'Free'

  const tierVariant: 'accent' | 'info' | 'default' =
    entitlement?.isPlus  ? 'accent' :
    entitlement?.isTrial ? 'info'   :
    'default'

  const MENU_SECTIONS = [
    {
      title: 'Goals',
      items: [
        { icon: Target, label: 'My goals', href: '/goals' },
        { icon: Trophy, label: 'Events & races', href: '/goals' },
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

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:px-8">

      {/* Profile header */}
      <div className="mb-8 flex items-center gap-4">
        <div className="flex size-20 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-white dark:bg-white dark:text-zinc-900">
          <User className="size-9" />
        </div>
        <div>
          <h1 className="text-xl font-black text-zinc-900 dark:text-white">{name || '—'}</h1>
          <p className="text-sm text-zinc-500">{email}</p>
          <Badge variant={tierVariant} className="mt-2">{tierLabel}</Badge>
          {entitlement?.isTrial && entitlement.trialDaysRemaining !== null && (
            <p className="text-xs text-zinc-400 mt-1">
              {entitlement.trialDaysRemaining} {entitlement.trialDaysRemaining === 1 ? 'day' : 'days'} left in trial
            </p>
          )}
        </div>
      </div>

      {/* Upgrade banner — shown for free and trial users */}
      {!entitlement?.isPlus && (
        <Link
          href="/plus"
          className="mb-6 flex items-center gap-3 rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-5 py-4 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
        >
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-zinc-100 dark:bg-zinc-800">
            <Sparkles className="size-5 text-zinc-500" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-zinc-900 dark:text-white text-sm">
              {entitlement?.isTrial ? 'Keep Involved+ after your trial' : 'Upgrade to Involved+'}
            </p>
            <p className="text-xs text-zinc-400">
              {entitlement?.isTrial
                ? 'Subscribe to keep AI coaching, workout generation, and more.'
                : 'AI coaching, personalized workouts, meal analysis, and more.'}
            </p>
          </div>
          <ChevronRight className="size-4 text-zinc-300 dark:text-zinc-600 shrink-0" />
        </Link>
      )}

      {/* Menu sections */}
      {MENU_SECTIONS.map((section) => (
        <div key={section.title} className="mb-6">
          <p className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-zinc-400">
            {section.title}
          </p>
          <Card className="p-0 overflow-hidden">
            {section.items.map(({ icon: Icon, label, href }, i) => (
              <Link
                key={label}
                href={href}
                className={`w-full flex items-center gap-3 px-5 py-4 text-left text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800 ${
                  i < section.items.length - 1 ? 'border-b border-zinc-100 dark:border-zinc-800' : ''
                }`}
              >
                <Icon className="size-5 text-zinc-400 shrink-0" />
                {label}
                <ChevronRight className="ml-auto size-4 text-zinc-300 dark:text-zinc-600" />
              </Link>
            ))}
          </Card>
        </div>
      ))}

      {/* Subscription management — plus users only */}
      {entitlement?.isPlus && (
        <div className="mb-6">
          <p className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-zinc-400">
            Subscription
          </p>
          <Card className="p-0 overflow-hidden">
            <Link
              href="/plus"
              className="w-full flex items-center gap-3 px-5 py-4 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
            >
              <Sparkles className="size-5 text-zinc-400 shrink-0" />
              Manage Involved+
              <ChevronRight className="ml-auto size-4 text-zinc-300 dark:text-zinc-600" />
            </Link>
          </Card>
        </div>
      )}

      {/* Sign out */}
      <button
        onClick={handleSignOut}
        className="flex w-full items-center gap-3 rounded-xl border border-red-100 bg-white px-5 py-4 text-left text-sm font-medium text-red-600 transition-colors hover:bg-red-50 dark:border-red-900/20 dark:bg-zinc-900 dark:hover:bg-red-900/10"
      >
        <LogOut className="size-5 shrink-0" />
        Sign out
      </button>
    </div>
  )
}
