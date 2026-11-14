import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { prisma } from '@/lib/prisma'
import { getUserEntitlement } from '@/lib/subscription/entitlements'

const BUCKET = 'progress-photos'
const MAX_BYTES = 10 * 1024 * 1024 // 10 MB
const FREE_LIMIT = 20

const SIGNED_URL_TTL = 60 * 60 // 1 hour — regenerated on every GET, never stored long-lived

export async function GET() {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [photos, entitlement] = await Promise.all([
    prisma.progressPhoto.findMany({
      where: { userId: user.id },
      orderBy: { takenAt: 'desc' },
      select: { id: true, storageKey: true, note: true, takenAt: true },
    }),
    getUserEntitlement(user.id),
  ])

  const isPlus = entitlement.isPlus

  // Generate short-lived signed URLs on each request rather than returning the
  // 1-year URLs stored at upload time. This limits the exposure window and lets
  // us revoke access by deleting the storage file.
  let signedUrls: Array<string | null> = photos.map(() => null)
  if (photos.length > 0) {
    const { data } = await getSupabaseAdmin()
      .storage.from(BUCKET)
      .createSignedUrls(photos.map(p => p.storageKey), SIGNED_URL_TTL)
    if (data) signedUrls = data.map(d => d.signedUrl)
  }

  const photosWithUrls = photos.map((photo, i) => ({
    id: photo.id,
    url: signedUrls[i] ?? '',
    note: photo.note,
    takenAt: photo.takenAt,
  }))

  return NextResponse.json({
    photos: photosWithUrls,
    count: photos.length,
    limit: isPlus ? null : FREE_LIMIT,
    canUpload: isPlus || photos.length < FREE_LIMIT,
  })
}

export async function POST(req: NextRequest) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Check limit
  const [count, entitlement] = await Promise.all([
    prisma.progressPhoto.count({ where: { userId: user.id } }),
    getUserEntitlement(user.id),
  ])

  const isPlus = entitlement.isPlus
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
  await getSupabaseAdmin().storage.createBucket(BUCKET, { public: false }).catch(() => null)

  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg'
  const key = `${user.id}/${Date.now()}.${ext}`
  const buffer = Buffer.from(await file.arrayBuffer())

  const { error: uploadError } = await getSupabaseAdmin().storage
    .from(BUCKET)
    .upload(key, buffer, { contentType: file.type })

  if (uploadError) return NextResponse.json({ error: 'Upload failed' }, { status: 500 })

  // 1-hour URL for the immediate POST response; GET always regenerates fresh URLs
  const { data: signedData } = await getSupabaseAdmin().storage
    .from(BUCKET)
    .createSignedUrl(key, SIGNED_URL_TTL)

  const url = signedData?.signedUrl ?? ''

  const photo = await prisma.progressPhoto.create({
    data: { userId: user.id, storageKey: key, url, note },
    select: { id: true, url: true, note: true, takenAt: true },
  })

  return NextResponse.json({ photo })
}
