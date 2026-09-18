import 'server-only'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getOpenAI } from '@/lib/ai/client'
import { MODELS } from '@/lib/ai/models'
import { getUserEntitlement } from '@/lib/subscription/entitlements'
import { hasFeatureAccess } from '@/lib/subscription/config'
import { checkAndConsumeVUsage } from '@/lib/v/usage'
import { toFile } from 'openai'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const entitlement = await getUserEntitlement(user.id)
  const tier = entitlement.tier

  if (!hasFeatureAccess(tier, 'voice_logging')) {
    return Response.json({ error: 'Involved+ required for voice logging' }, { status: 403 })
  }

  const usage = await checkAndConsumeVUsage(user.id, tier, 'voice_transcription')
  if (!usage.allowed) {
    return Response.json({ error: 'limit_reached', limit: usage.limit }, { status: 429 })
  }

  const formData = await req.formData()
  const audioFile = formData.get('audio')
  if (!audioFile || !(audioFile instanceof Blob)) {
    return Response.json({ error: 'audio file is required' }, { status: 400 })
  }

  const openai = getOpenAI()
  const file = await toFile(audioFile, 'audio.webm', { type: audioFile.type || 'audio/webm' })

  const transcription = await openai.audio.transcriptions.create({
    model: MODELS.voice.transcription,
    file,
    language: 'en',
    response_format: 'json',
  })

  return Response.json({ transcript: transcription.text })
}
