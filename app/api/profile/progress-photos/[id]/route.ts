import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSupabaseAdmin } from '@supabase/supabase-js'
import { getUser } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'

const admin = createSupabaseAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const photo = await prisma.progressPhoto.findUnique({
    where: { id },
    select: { userId: true, storageKey: true },
  })

  if (!photo || photo.userId !== user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  await admin.storage.from('progress-photos').remove([photo.storageKey])
  await prisma.progressPhoto.delete({ where: { id } })

  return NextResponse.json({ success: true })
}
