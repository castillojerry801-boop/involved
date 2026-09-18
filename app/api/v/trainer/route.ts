import 'server-only'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getUserEntitlement } from '@/lib/subscription/entitlements'
import { buildVTrainerContext, trainerContextToPrompt } from '@/lib/v/trainer-context'
import { prisma } from '@/lib/prisma'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

/**
 * POST /api/v/trainer
 *
 * V capabilities for trainers. V can:
 * - Summarize a client's training history
 * - Identify adherence issues
 * - Draft program adjustments (NOT auto-apply — always returns a draft)
 *
 * Significant changes are returned as VTrainerDraft records requiring
 * trainer approval. V never silently modifies client data.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const ent = await getUserEntitlement(user.id)
  if (!ent.isTrainer) return Response.json({ error: 'Trainer subscription required' }, { status: 403 })

  const body = await req.json() as {
    message:        string
    focusClientId?: string
  }

  if (!body.message?.trim()) {
    return Response.json({ error: 'message is required' }, { status: 400 })
  }

  try {
    const ctx = await buildVTrainerContext(user.id, body.focusClientId)
    const contextPrompt = trainerContextToPrompt(ctx)

    const system = `You are V, an AI fitness assistant for an Involved trainer.
You have access to the trainer's client roster and the selected client's authorized data.

${contextPrompt}

CRITICAL RULES:
- You may only analyze data the trainer is authorized to see.
- If asked to change client programming, targets, or plans: describe the proposed change clearly and state it will be saved as a draft for trainer review. Do NOT describe it as done.
- If a draft is appropriate, end your response with a JSON block formatted exactly as:
  \`\`\`draft
  { "draftType": "program_adjustment"|"workout_edit"|"target_update"|"trainer_note", "description": "one sentence", "payload": { ... } }
  \`\`\`
- For read-only summaries and analysis, no draft block is needed.
- Never invent data you don't have — acknowledge when information is missing.`

    const response = await anthropic.messages.create({
      model:      process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6',
      max_tokens: 1024,
      system,
      messages:   [{ role: 'user', content: body.message }],
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : ''

    // Extract and save draft if V produced one
    let draftId: string | null = null
    const draftMatch = text.match(/```draft\s*([\s\S]*?)```/)
    if (draftMatch && body.focusClientId) {
      try {
        const draftData = JSON.parse(draftMatch[1].trim())
        const draft = await prisma.vTrainerDraft.create({
          data: {
            trainerId:   user.id,
            clientId:    body.focusClientId,
            draftType:   draftData.draftType,
            description: draftData.description,
            payload:     draftData.payload,
            status:      'pending',
          },
        })
        draftId = draft.id
      } catch {
        // Malformed draft block — ignore, don't fail the response
      }
    }

    // Strip the raw draft block from the user-facing text
    const cleanedText = text.replace(/```draft[\s\S]*?```/g, '').trim()

    return Response.json({ message: cleanedText, draftId })
  } catch (err) {
    console.error('v/trainer error:', err)
    return Response.json({ error: 'V request failed' }, { status: 500 })
  }
}
