import 'server-only'
import { getSupabaseAdmin } from '@/lib/supabase/admin'

const BUCKET = 'recipe-images'
const SIGNED_URL_TTL_SECONDS = 3600 // 1 hour

export async function generateSignedUrl(storageKey: string): Promise<string | null> {
  const { data, error } = await getSupabaseAdmin()
    .storage
    .from(BUCKET)
    .createSignedUrl(storageKey, SIGNED_URL_TTL_SECONDS)

  if (error || !data) return null
  return data.signedUrl
}

// Batch-generate signed URLs for a list of storage keys.
// Returns a map of storageKey → signedUrl. Keys with errors are omitted.
export async function generateSignedUrls(
  storageKeys: string[],
): Promise<Record<string, string>> {
  if (storageKeys.length === 0) return {}

  const { data, error } = await getSupabaseAdmin()
    .storage
    .from(BUCKET)
    .createSignedUrls(storageKeys, SIGNED_URL_TTL_SECONDS)

  if (error || !data) return {}

  const result: Record<string, string> = {}
  for (const item of data) {
    if (item.signedUrl && item.path) {
      result[item.path] = item.signedUrl
    }
  }
  return result
}

export function recipeStorageKey(userId: string, recipeId: string, ext: string): string {
  return `${userId}/${recipeId}.${ext.replace(/^\./, '')}`
}
