import 'server-only'
import { NextResponse } from 'next/server'
import { createClient as createSupabaseAdmin } from '@supabase/supabase-js'
import { getUser } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'

const admin = createSupabaseAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

export async function DELETE() {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const userId = user.id

  // 1. Collect progress photo storage keys before deleting rows
  const photos = await prisma.progressPhoto.findMany({
    where: { userId },
    select: { storageKey: true },
  })

  // 2. Delete storage files (best-effort — don't abort if storage fails)
  if (photos.length > 0) {
    await admin.storage
      .from('progress-photos')
      .remove(photos.map(p => p.storageKey))
      .catch(() => null)
  }

  // Delete all avatar files under this user's prefix
  const { data: avatarFiles } = await admin.storage
    .from('avatars')
    .list(userId)
    .catch(() => ({ data: null }))

  if (avatarFiles && avatarFiles.length > 0) {
    await admin.storage
      .from('avatars')
      .remove(avatarFiles.map(f => `${userId}/${f.name}`))
      .catch(() => null)
  }

  // 3. Delete Profile row — cascades all user data in Prisma DB
  await prisma.profile.delete({ where: { id: userId } })

  // 4. Delete the Supabase auth user
  const { error: authDeleteError } = await admin.auth.admin.deleteUser(userId)
  if (authDeleteError) {
    // Auth deletion failed but DB is already cleared — log and continue.
    // The orphaned auth row will have no profile and cannot access data.
    console.error('account-delete: auth.admin.deleteUser failed', authDeleteError.message)
  }

  return NextResponse.json({ ok: true })
}
