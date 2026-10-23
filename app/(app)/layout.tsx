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
      {/* Desktop: offset content for sidebar; Mobile: bottom nav only */}
      <div className="md:ml-64 pb-20 md:pb-0">
        {children}
      </div>
    </div>
  )
}
