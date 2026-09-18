import 'server-only'
import { NextRequest } from 'next/server'
import { searchExercises } from '@/lib/exercises'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const q = searchParams.get('q') ?? ''
  const bodyPart = searchParams.get('bodyPart') ?? 'all'
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '20'), 100)
  const offset = parseInt(searchParams.get('offset') ?? '0')

  const results = searchExercises(q, bodyPart, limit, offset)
  return Response.json(results)
}
