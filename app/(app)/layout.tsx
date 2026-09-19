import { AppNav } from '@/components/layout/AppNav'
import { BackgroundCarousel } from '@/components/background-carousel'
import { TimezoneSync } from '@/components/timezone-sync'
import { getUser } from '@/lib/supabase/server'
import { getUserEntitlement } from '@/lib/subscription/entitlements'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser()
  const isTrainer = user ? (await getUserEntitlement(user.id)).isTrainer : false

  return (
    <div className="min-h-screen">
      <TimezoneSync />
      <BackgroundCarousel />
      <AppNav isTrainer={isTrainer} />
      {/* Desktop: offset content for sidebar; Mobile: add bottom padding for nav */}
      {/* Mobile: top bar (12) + bottom nav (20); Desktop: sidebar (64) only */}
      <div className="md:ml-64 pt-12 pb-20 md:pt-0 md:pb-0">
        {children}
      </div>
    </div>
  )
}
