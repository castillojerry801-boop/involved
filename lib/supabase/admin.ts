import 'server-only'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Lazy singleton — defer construction to first request so that module
// evaluation at Next.js build time does not throw when env vars are absent.
let _admin: SupabaseClient | undefined

export function getSupabaseAdmin(): SupabaseClient {
  return (_admin ??= createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  ))
}
