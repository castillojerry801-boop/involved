import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { isAdmin } from '@/lib/admin/auth'

// DELETE /api/admin/grants/:id — revoke a grant
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getUser()
  if (!user || !isAdmin(user.id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params

  const grant = await prisma.userEntitlement.findUnique({ where: { id } })
  if (!grant) {
    return NextResponse.json({ error: 'Grant not found' }, { status: 404 })
  }
  if (grant.source !== 'admin_grant') {
    return NextResponse.json({ error: 'Cannot revoke non-admin grants via this endpoint' }, { status: 400 })
  }
  if (grant.status === 'revoked') {
    return NextResponse.json({ error: 'Already revoked' }, { status: 409 })
  }

  const updated = await prisma.userEntitlement.update({
    where: { id },
    data: { status: 'revoked', revokedAt: new Date() },
  })

  return NextResponse.json({ grant: updated })
}
