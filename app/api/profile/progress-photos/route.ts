import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSupabaseAdmin } from '@supabase/supabase-js'
import { getUser } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'

const admin = createSupabaseAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

const BUCKET = 'progress-photos'
const MAX_BYTES = 10 * 1024 * 1024 // 10 MB
const FREE_LIMIT = 20

export async function GET() {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const photos = await prisma.progressPhoto.findMany({
    where: { userId: user.id },
    orderBy: { takenAt: 'desc' },
    select: { id: true, url: true, note: true, takenAt: true },
  })

  const profile = await prisma.profile.findUnique({
    where: { id: user.id },
    select: { subscriptionTier: true },
  })

  const isPlus = profile?.subscriptionTier === 'plus'

  return NextResponse.json({
    photos,
    count: photos.length,
    limit: isPlus ? null : FREE_LIMIT,
    canUpload: isPlus || photos.length < FREE_LIMIT,
  })
}

export async function POST(req: NextRequest) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Check limit
  const [count, profile] = await Promise.all([
    prisma.progressPhoto.count({ where: { userId: user.id } }),
    prisma.profile.findUnique({ where: { id: user.id }, select: { subscriptionTier: true } }),
  ])

  const isPlus = profile?.subscriptionTier === 'plus'
  if (!isPlus && count >= FREE_LIMIT) {
    return NextResponse.json(
      { error: `Free plan limit is ${FREE_LIMIT} photos. Upgrade to Involved+ for unlimited.` },
      { status: 403 }
    )
  }

  const formData = await req.formData()
  const file = formData.get('file') as File | null
  const note = (formData.get('note') as string | null)?.trim().slice(0, 500) ?? null

  if (!file) return NextResponse.json({ error: 'No file' }, { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'File too large (max 10 MB)' }, { status: 413 })

  // Ensure private bucket exists
  await admin.storage.createBucket(BUCKET, { public: false }).catch(() => null)

  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg'
  const key = `${user.id}/${Date.now()}.${ext}`
  const buffer = Buffer.from(await file.arrayBuffer())

  const { error: uploadError } = await admin.storage
    .from(BUCKET)
    .upload(key, buffer, { contentType: file.type })

  if (uploadError) return NextResponse.json({ error: 'Upload failed' }, { status: 500 })

  // Generate a signed URL valid for 1 year — stored in DB, refreshed on GET if needed
  const { data: signedData } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(key, 60 * 60 * 24 * 365)

  const url = signedData?.signedUrl ?? ''

  const photo = await prisma.progressPhoto.create({
    data: { userId: user.id, storageKey: key, url, note },
    select: { id: true, url: true, note: true, takenAt: true },
  })

  return NextResponse.json({ photo })
}
