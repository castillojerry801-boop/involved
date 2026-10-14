import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getProvider } from '@/lib/nutrition/providers'

// GET /api/nutrition/food?provider=nih_dsld&id=12345
// Fetches full food detail from the named provider. Used by the UI to load
// DSLD nutrition data (not available in search stubs) before allowing logging.
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const providerId = req.nextUrl.searchParams.get('provider')?.trim()
  const foodId     = req.nextUrl.searchParams.get('id')?.trim()

  if (!providerId || !foodId) {
    return NextResponse.json({ error: 'Missing provider or id' }, { status: 400 })
  }

  const provider = getProvider(providerId)
  if (!provider) {
    return NextResponse.json({ error: `Unknown provider: ${providerId}` }, { status: 400 })
  }

  const detail = await provider.getById(foodId).catch(() => null)
  if (!detail) {
    return NextResponse.json({ error: 'Food not found' }, { status: 404 })
  }

  return NextResponse.json({ food: detail })
}
