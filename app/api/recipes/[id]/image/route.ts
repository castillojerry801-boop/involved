import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { generateSignedUrl, recipeStorageKey } from '@/lib/recipes/image'

const BUCKET = 'recipe-images'
const MAX_BYTES = 5 * 1024 * 1024 // 5 MB
// HEIC/HEIF excluded: bucket policy only accepts jpeg/png/webp. iOS Safari automatically
// converts camera roll photos to JPEG when using the file picker, so HEIC rarely arrives
// in practice. Users who see an error should use Settings → Camera → Formats → Most Compatible.
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const EXT_MAP: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const recipe = await prisma.recipe.findUnique({ where: { id }, select: { id: true, userId: true, status: true } })
  if (!recipe) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (recipe.userId !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (recipe.status === 'archived') {
    return NextResponse.json({ error: 'Cannot upload image for archived recipe' }, { status: 403 })
  }

  const formData = await req.formData()
  const file = formData.get('image') as File | null
  if (!file) return NextResponse.json({ error: 'No image provided' }, { status: 400 })

  if (!ALLOWED_TYPES.includes(file.type)) {
    const isHeic = file.type === 'image/heic' || file.type === 'image/heif'
    return NextResponse.json(
      {
        error: isHeic
          ? 'HEIC/HEIF images are not supported. On iPhone, go to Settings → Camera → Formats → Most Compatible to capture in JPEG, then try again.'
          : `Unsupported image type: ${file.type}. Please upload a JPEG, PNG, or WebP image.`,
      },
      { status: 400 },
    )
  }

  const bytes = await file.arrayBuffer()
  if (bytes.byteLength > MAX_BYTES) {
    return NextResponse.json({ error: 'Image must be under 5 MB' }, { status: 400 })
  }

  const ext = EXT_MAP[file.type] ?? 'jpg'
  const storageKey = recipeStorageKey(user.id, id, ext)

  const { error: uploadError } = await getSupabaseAdmin()
    .storage
    .from(BUCKET)
    .upload(storageKey, bytes, {
      contentType: file.type,
      upsert: true,
    })

  if (uploadError) {
    return NextResponse.json({ error: 'Image upload failed' }, { status: 500 })
  }

  await prisma.recipe.update({ where: { id }, data: { storageKey } })
  const signedUrl = await generateSignedUrl(storageKey)

  return NextResponse.json({ imageUrl: signedUrl }, { status: 201 })
}
