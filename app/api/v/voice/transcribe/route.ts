import 'server-only'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getOpenAI } from '@/lib/ai/client'
import { MODELS } from '@/lib/ai/models'
import { getUserEntitlement } from '@/lib/subscription/entitlements'
import { hasFeatureAccess } from '@/lib/subscription/config'
import { checkAndConsumeVUsage } from '@/lib/v/usage'
import { toFile } from 'openai'
import { buildAudioLog, flushRequestLogs } from '@/lib/ai/request-logger'

const MAX_AUDIO_BYTES = 25 * 1024 * 1024

const ALLOWED_AUDIO_PREFIXES = [
  'audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/aac',
  'audio/ogg', 'audio/wav', 'audio/flac', 'audio/x-m4a',
]

function audioExtension(mimeType: string): string {
  return mimeType.startsWith('audio/webm') ? 'webm' : 'mp4'
}

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

  if (audioFile.size > MAX_AUDIO_BYTES) {
    return Response.json({ error: 'Audio file too large (max 25 MB)' }, { status: 400 })
  }

  const audioType = (audioFile.type || '').toLowerCase()
  if (audioType !== '' && !ALLOWED_AUDIO_PREFIXES.some(p => audioType.startsWith(p))) {
    return Response.json({ error: 'Unsupported audio format' }, { status: 400 })
  }

  const effectiveType = audioType || 'audio/mp4'
  const ext = audioExtension(effectiveType)

  const openai = getOpenAI()
  const file = await toFile(audioFile, `audio.${ext}`, { type: effectiveType })

  const transcription = await openai.audio.transcriptions.create({
    model: MODELS.voice.transcription,
    file,
    language: 'en',
    response_format: 'json',
  })

  await flushRequestLogs([
    buildAudioLog(user.id, 'voice_transcription', 'voice_transcription', MODELS.voice.transcription, audioFile.size),
  ])

  return Response.json({ transcript: transcription.text })
}
