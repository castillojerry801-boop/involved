import 'server-only'
import { timingSafeEqual } from 'crypto'
import { NextRequest } from 'next/server'
import { generateAiUsageReport } from '@/lib/ai/cost-reporting'

// Read-only internal cost reporting — key-only access.
// Session-based access is intentionally disabled until a dedicated admin role is implemented.
// Access requires the x-internal-key header to match INTERNAL_REPORTING_KEY exactly.
// If INTERNAL_REPORTING_KEY is not configured, all requests are denied.

function keyMatches(provided: string, expected: string): boolean {
  try {
    const a = Buffer.from(provided, 'utf8')
    const b = Buffer.from(expected, 'utf8')
    if (a.length !== b.length) return false
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}

export async function GET(req: NextRequest) {
  const reportingKey = process.env.INTERNAL_REPORTING_KEY

  const internalKey = req.headers.get('x-internal-key')
  if (!internalKey || !reportingKey || !keyMatches(internalKey, reportingKey)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const period = req.nextUrl.searchParams.get('period') ?? undefined
  const report = await generateAiUsageReport(period)
  return Response.json(report)
}
