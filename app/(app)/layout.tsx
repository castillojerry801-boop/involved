import { AppNav } from '@/components/layout/AppNav'
import { BackgroundCarousel } from '@/components/background-carousel'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <BackgroundCarousel />
      <AppNav />
      {/* Desktop: offset content for sidebar; Mobile: add bottom padding for nav */}
      {/* Mobile: top bar (12) + bottom nav (20); Desktop: sidebar (64) only */}
      <div className="md:ml-64 pt-12 pb-20 md:pt-0 md:pb-0">
        {children}
      </div>
    </div>
  )
}
