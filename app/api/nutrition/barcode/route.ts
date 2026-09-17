import { NextRequest, NextResponse } from 'next/server'
import { FOOD_PROVIDERS } from '@/lib/nutrition/providers'

export async function GET(req: NextRequest) {
  const upc = req.nextUrl.searchParams.get('upc')
  if (!upc) return NextResponse.json({ error: 'Missing upc' }, { status: 400 })

  for (const provider of FOOD_PROVIDERS) {
    const result = await provider.searchByBarcode(upc)
    if (result) return NextResponse.json({ result })
  }

  return NextResponse.json({ error: 'Not found' }, { status: 404 })
}
