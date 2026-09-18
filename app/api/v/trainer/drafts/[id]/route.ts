import 'server-only'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { getUserEntitlement } from '@/lib/subscription/entitlements'

type Params = { params: Promise<{ id: string }> }

/**
 * PATCH /api/v/trainer/drafts/[id]
 * Trainer approves or dismisses a V draft.
 * Approval applies the payload change; dismissal discards it.
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const ent = await getUserEntitlement(user.id)
  if (!ent.isTrainer) return Response.json({ error: 'Trainer subscription required' }, { status: 403 })

  const { id } = await params
  const body = await req.json() as { action: 'approve' | 'dismiss'; payload?: Record<string, unknown> }

  if (!['approve', 'dismiss'].includes(body.action)) {
    return Response.json({ error: 'action must be approve or dismiss' }, { status: 400 })
  }

  const draft = await prisma.vTrainerDraft.findUnique({ where: { id } })
  if (!draft || draft.trainerId !== user.id) {
    return Response.json({ error: 'Draft not found' }, { status: 404 })
  }
  if (draft.status !== 'pending') {
    return Response.json({ error: 'Draft already reviewed' }, { status: 409 })
  }

  const status = body.action === 'approve' ? 'approved' : 'dismissed'

  await prisma.$transaction(async tx => {
    await tx.vTrainerDraft.update({
      where: { id },
      data:  { status, reviewedAt: new Date() },
    })

    // Apply the payload if approved — trainer may have edited the payload before approving
    if (body.action === 'approve') {
      const effectiveDraft = body.payload
        ? { ...draft, payload: body.payload }
        : draft
      if (body.payload) {
        await tx.vTrainerDraft.update({ where: { id }, data: { payload: body.payload as never } })
      }
      await applyDraftPayload(tx, effectiveDraft)
    }
  })

  return Response.json({ ok: true, status })
}

async function applyDraftPayload(
  tx: Omit<typeof prisma, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>,
  draft: { draftType: string; payload: unknown; clientId: string; trainerId: string },
) {
  const payload = draft.payload as Record<string, unknown>

  switch (draft.draftType) {
    case 'target_update': {
      if (payload.targetType && payload.targetValue !== undefined && payload.unit) {
        await tx.trainerClientTarget.create({
          data: {
            trainerId:    draft.trainerId,
            clientId:     draft.clientId,
            targetType:   payload.targetType as never,
            targetValue:  Number(payload.targetValue),
            unit:         String(payload.unit),
            notes:        payload.notes ? String(payload.notes) : null,
            effectiveDate: new Date(),
          },
        })
      }
      break
    }
    case 'trainer_note': {
      if (payload.content) {
        await tx.trainerNote.create({
          data: {
            trainerId: draft.trainerId,
            clientId:  draft.clientId,
            content:   String(payload.content),
            isPrivate: payload.isPrivate !== false,
          },
        })
      }
      break
    }
    // program_adjustment and workout_edit: these involve complex program mutations
    // that are surfaced as approved drafts — the trainer UI handles actual application
    // by presenting the approved payload as a pre-filled edit form.
    default:
      break
  }
}
