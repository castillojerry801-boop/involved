'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { User, Settings, ChevronRight, Trophy, Target, LogOut } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { createClient } from '@/lib/supabase/client'

export default function ProfilePage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')

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
  }, [])

  const handleSignOut = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

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
          <Badge variant="default" className="mt-2">Free plan</Badge>
        </div>
      </div>

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
