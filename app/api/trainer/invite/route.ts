import 'server-only'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { createInvitation } from '@/lib/trainer/relationships'
import { sendTrainerInvite } from '@/lib/email/send-trainer-invite'

// GET: list pending invitations sent by this trainer, OR look up by token.
// Token lookup is PUBLIC — the 64-char random token is the access credential.
// Only non-sensitive fields (trainer name, status, expiry) are returned.
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')

  if (token) {
    // Public branch — no auth required.
    const inv = await prisma.trainerInvitation.findUnique({
      where: { token },
      include: {
        trainer: {
          include: { profile: { select: { displayName: true } } },
        },
      },
    })
    if (!inv) return Response.json({ error: 'Invitation not found' }, { status: 404 })
    // Only expose the minimum needed for an unauthenticated recipient to recognise
    // the invitation. invitedEmail is omitted — the recipient knows their own email
    // and there is no UI that displays it back.
    return Response.json({
      invitation: {
        trainerName: inv.trainer.profile?.displayName ?? null,
        status:      inv.status,
        expiresAt:   inv.expiresAt,
      },
    })
  }

  // Authenticated branch — trainer listing their own sent invitations.
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const invitations = await prisma.trainerInvitation.findMany({
    where:   { trainerId: user.id },
    orderBy: { sentAt: 'desc' },
  })

  return Response.json({ invitations })
}

// POST: send an invitation to a client by email
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { email } = await req.json() as { email?: string }
  if (!email?.trim()) {
    return Response.json({ error: 'email is required' }, { status: 400 })
  }

  const normalizedEmail = email.trim().toLowerCase()

  // Prevent self-invitation
  const authUser = await createClient().then(s => s.auth.getUser())
  if (normalizedEmail === authUser.data.user?.email?.toLowerCase()) {
    return Response.json({ error: 'Cannot invite yourself' }, { status: 400 })
  }

  // Get trainer's display name for the email
  const trainerProfile = await prisma.profile.findUnique({
    where: { id: user.id },
    select: { displayName: true },
  })
  const trainerName = trainerProfile?.displayName ?? 'Your trainer'

  try {
    const { token, expiresAt } = await createInvitation(user.id, normalizedEmail)

    let emailSent = false
    try {
      await sendTrainerInvite({ toEmail: normalizedEmail, trainerName, token, expiresAt })
      emailSent = true
    } catch {
      // Email delivery failed — invitation still exists; trainer can share the link.
    }

    return Response.json({ ok: true, token, expiresAt, emailSent })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to create invitation'
    const status = msg.includes('Seat limit') || msg.includes('subscription required') ? 403 : 500
    return Response.json({ error: msg }, { status })
  }
}
