import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { isAdmin } from '@/lib/admin/auth'

// GET /api/admin/grants?q=<email_or_name>
// Returns: { users: [{id, email, displayName, grants}] }
export async function GET(req: NextRequest) {
  const user = await getUser()
  if (!user || !isAdmin(user.id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const q = req.nextUrl.searchParams.get('q')?.trim() ?? ''

  const now = new Date()

  if (q.length < 2) {
    // Return users who currently have an active admin grant
    const grants = await prisma.userEntitlement.findMany({
      where: {
        source: 'admin_grant',
        status: 'active',
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      include: { profile: { select: { id: true, displayName: true } } },
      orderBy: { grantedAt: 'desc' },
    })

    return NextResponse.json({ grants: grants.map(g => ({
      id: g.id,
      userId: g.userId,
      displayName: g.profile.displayName,
      sourceRef: g.sourceRef,
      grantedAt: g.grantedAt,
      expiresAt: g.expiresAt,
      status: g.status,
    })) })
  }

  // Search by email (Supabase auth) or displayName (Profile)
  const [supabaseUsers, profileMatches] = await Promise.all([
    searchByEmail(q),
    prisma.profile.findMany({
      where: {
        displayName: { contains: q, mode: 'insensitive' },
      },
      select: { id: true, displayName: true },
      take: 10,
    }),
  ])

  // Merge results by userId, deduplicate
  const userMap = new Map<string, { id: string; email?: string; displayName?: string | null }>()

  for (const u of supabaseUsers) {
    userMap.set(u.id, { id: u.id, email: u.email, displayName: u.displayName })
  }
  for (const p of profileMatches) {
    if (!userMap.has(p.id)) userMap.set(p.id, { id: p.id, displayName: p.displayName })
  }

  const userIds = Array.from(userMap.keys())
  if (userIds.length === 0) return NextResponse.json({ users: [] })

  const existingGrants = await prisma.userEntitlement.findMany({
    where: { userId: { in: userIds }, source: 'admin_grant' },
    orderBy: { grantedAt: 'desc' },
  })

  const grantsByUser = new Map<string, typeof existingGrants>()
  for (const g of existingGrants) {
    const arr = grantsByUser.get(g.userId) ?? []
    arr.push(g)
    grantsByUser.set(g.userId, arr)
  }

  const users = Array.from(userMap.values()).map(u => ({
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    grants: (grantsByUser.get(u.id) ?? []).map(g => ({
      id: g.id,
      status: g.status,
      sourceRef: g.sourceRef,
      grantedAt: g.grantedAt,
      expiresAt: g.expiresAt,
      revokedAt: g.revokedAt,
    })),
  }))

  return NextResponse.json({ users })
}

// POST /api/admin/grants
// Body: { userId: string; reason?: string; expiresAt?: string (ISO) }
export async function POST(req: NextRequest) {
  const user = await getUser()
  if (!user || !isAdmin(user.id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: { userId?: unknown; reason?: unknown; expiresAt?: unknown }
  try {
    body = await req.json() as { userId?: unknown; reason?: unknown; expiresAt?: unknown }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { userId, reason, expiresAt } = body

  if (typeof userId !== 'string' || !userId.trim()) {
    return NextResponse.json({ error: 'userId is required' }, { status: 400 })
  }
  if (reason !== undefined && typeof reason !== 'string') {
    return NextResponse.json({ error: 'reason must be a string' }, { status: 400 })
  }

  let expiresAtDate: Date | null = null
  if (expiresAt !== undefined && expiresAt !== null) {
    if (typeof expiresAt !== 'string') {
      return NextResponse.json({ error: 'expiresAt must be an ISO date string' }, { status: 400 })
    }
    expiresAtDate = new Date(expiresAt)
    if (isNaN(expiresAtDate.getTime())) {
      return NextResponse.json({ error: 'expiresAt is not a valid date' }, { status: 400 })
    }
    if (expiresAtDate <= new Date()) {
      return NextResponse.json({ error: 'expiresAt must be in the future' }, { status: 400 })
    }
  }

  // Validate userId is a real user
  const profile = await prisma.profile.findUnique({ where: { id: userId }, select: { id: true } })
  if (!profile) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  const grant = await prisma.userEntitlement.create({
    data: {
      userId,
      source: 'admin_grant',
      status: 'active',
      sourceRef: [
        `granted_by:${user.id}`,
        reason ? `reason:${(reason as string).slice(0, 150)}` : null,
      ].filter(Boolean).join('|') || null,
      expiresAt: expiresAtDate,
    },
  })

  return NextResponse.json({ grant }, { status: 201 })
}

async function searchByEmail(q: string): Promise<{ id: string; email?: string; displayName?: string | null }[]> {
  const { createClient } = await import('@supabase/supabase-js')
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
  const { data } = await admin.auth.admin.listUsers({ perPage: 10 })
  const users = data?.users ?? []
  const matched = users.filter(u => u.email?.toLowerCase().includes(q.toLowerCase()))
  return matched.map(u => ({ id: u.id, email: u.email ?? undefined, displayName: undefined }))
}
