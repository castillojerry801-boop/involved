import { AppNav } from '@/components/layout/AppNav'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <AppNav />
      {/* Desktop: offset content for sidebar; Mobile: add bottom padding for nav */}
      <div className="md:ml-64 pb-20 md:pb-0">
        {children}
      </div>
    </div>
  )
}
