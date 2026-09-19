import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSupabaseAdmin } from '@supabase/supabase-js'
import { getUser } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'

const admin = createSupabaseAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

const BUCKET = 'avatars'
const MAX_BYTES = 5 * 1024 * 1024 // 5 MB

export async function POST(req: NextRequest) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const formData = await req.formData()
  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'No file' }, { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'File too large (max 5 MB)' }, { status: 413 })

  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg'
  const key = `${user.id}/avatar.${ext}`
  const buffer = Buffer.from(await file.arrayBuffer())

  // Ensure bucket exists
  await admin.storage.createBucket(BUCKET, { public: true }).catch(() => null)

  const { error: uploadError } = await admin.storage
    .from(BUCKET)
    .upload(key, buffer, { contentType: file.type, upsert: true })

  if (uploadError) {
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }

  const { data: { publicUrl } } = admin.storage.from(BUCKET).getPublicUrl(key)
  // Bust cache with a timestamp
  const url = `${publicUrl}?t=${Date.now()}`

  await prisma.profile.update({
    where: { id: user.id },
    data: { avatarUrl: url },
  })

  return NextResponse.json({ url })
}
