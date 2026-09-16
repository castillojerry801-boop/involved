import Link from 'next/link'
import { InvolvedLogo } from '@/components/logo'

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-zinc-50 dark:bg-zinc-950">
      <header className="flex h-16 items-center border-b border-zinc-100 bg-white px-6 dark:border-zinc-800 dark:bg-zinc-950">
        <Link href="/">
          <InvolvedLogo size="sm" />
        </Link>
      </header>
      <main className="flex flex-1 items-center justify-center px-6 py-12">
        {children}
      </main>
      <footer className="py-6 text-center text-xs text-zinc-400">
        © 2026 Involved. All rights reserved.
      </footer>
    </div>
  )
}
