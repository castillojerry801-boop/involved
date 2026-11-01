import { redirect } from 'next/navigation'
import { getUser } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/admin/auth'
import { Settings } from 'lucide-react'
import AdminNavLink from './AdminNavLink'
import type { AdminNavIcon } from './AdminNavLink'

const ADMIN_NAV: Array<{ href: string; label: string; icon: AdminNavIcon }> = [
  { href: '/admin',                 label: 'Access',    icon: 'shield'     },
  { href: '/admin/ymove-mapping',   label: 'Mapping',   icon: 'git-merge'  },
  { href: '/admin/ymove-hierarchy', label: 'Hierarchy', icon: 'layers'     },
  { href: '/admin/ymove-catalog',   label: 'Catalog',   icon: 'book-open'  },
  { href: '/admin/ymove-browse',    label: 'Browse',    icon: 'eye'        },
]

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser()
  if (!user || !isAdmin(user.id)) redirect('/')

  return (
    <div className="min-h-screen">
      <nav className="sticky top-0 z-30 border-b border-zinc-200/60 bg-white/90 backdrop-blur-md dark:border-zinc-800/60 dark:bg-zinc-950/90">
        <div className="mx-auto flex max-w-6xl items-center gap-0.5 overflow-x-auto px-4 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <span className="mr-3 flex shrink-0 items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-zinc-400">
            <Settings className="size-3" />
            Admin
          </span>
          {ADMIN_NAV.map(({ href, label, icon }) => (
            <AdminNavLink key={href} href={href} label={label} icon={icon} />
          ))}
        </div>
      </nav>
      {children}
    </div>
  )
}
