'use client'

import { useState, useRef, useCallback } from 'react'
import { Mic, MicOff, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { VoiceIntent } from '@/app/api/v/voice/intent/route'

export interface VoiceMicProps {
  workoutId: string
  workoutExerciseId: string
  setId: string
  exerciseName?: string
  onApplied?: (action: string) => void
  disabled?: boolean
}

type MicState = 'idle' | 'recording' | 'processing' | 'error'

export function VoiceMic({
  workoutId,
  workoutExerciseId,
  setId,
  exerciseName,
  onApplied,
  disabled,
}: VoiceMicProps) {
  const [state, setState] = useState<MicState>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

  const stopAndProcess = useCallback(async () => {
    const mr = mediaRecorderRef.current
    if (!mr || mr.state === 'inactive') return
    mr.stop()
  }, [])

  const startRecording = useCallback(async () => {
    setErrorMsg(null)

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      setErrorMsg('Mic access denied')
      setState('error')
      return
    }

    chunksRef.current = []
    const mr = new MediaRecorder(stream, { mimeType: 'audio/webm' })
    mediaRecorderRef.current = mr

    mr.ondataavailable = e => {
      if (e.data.size > 0) chunksRef.current.push(e.data)
    }

    mr.onstop = async () => {
      stream.getTracks().forEach(t => t.stop())
      setState('processing')

      const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
      if (blob.size < 1000) {
        setState('idle')
        return
      }

      try {
        const fd = new FormData()
        fd.append('audio', blob, 'audio.webm')
        const txRes = await fetch('/api/v/voice/transcribe', { method: 'POST', body: fd })
        if (!txRes.ok) {
          const e = await txRes.json() as { error?: string }
          throw new Error(e.error ?? 'Transcription failed')
        }
        const { transcript } = await txRes.json() as { transcript: string }

        const intentRes = await fetch('/api/v/voice/intent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transcript, exerciseName }),
        })
        if (!intentRes.ok) {
          const e = await intentRes.json() as { error?: string }
          throw new Error(e.error ?? 'Intent failed')
        }
        const { intent } = await intentRes.json() as { intent: VoiceIntent }

        if (intent.action === 'unknown') {
          setErrorMsg(`Didn't understand: "${transcript}"`)
          setState('error')
          return
        }

        const applyRes = await fetch('/api/v/voice/apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ intent, workoutId, workoutExerciseId, setId }),
        })
        if (!applyRes.ok) {
          const e = await applyRes.json() as { error?: string }
          throw new Error(e.error ?? 'Apply failed')
        }
        const result = await applyRes.json() as { action: string }
        setState('idle')
        onApplied?.(result.action)
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'Voice logging failed')
        setState('error')
      }
    }

    mr.start()
    setState('recording')
  }, [workoutId, workoutExerciseId, setId, exerciseName, onApplied])

  const handleClick = () => {
    if (disabled || state === 'processing') return
    if (state === 'recording') {
      stopAndProcess()
    } else {
      startRecording()
    }
  }

  return (
    <div className="flex flex-col items-center">
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled || state === 'processing'}
        title={state === 'recording' ? 'Tap to stop' : 'Log by voice'}
        className={cn(
          'flex size-7 shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-40',
          state === 'recording'
            ? 'bg-red-500 text-white animate-pulse'
            : state === 'error'
            ? 'text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20'
            : 'text-zinc-300 dark:text-zinc-600 hover:text-zinc-500 dark:hover:text-zinc-400'
        )}
      >
        {state === 'processing' ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : state === 'recording' ? (
          <MicOff className="size-3.5" />
        ) : (
          <Mic className="size-3.5" />
        )}
      </button>
      {state === 'error' && errorMsg && (
        <p className="text-[9px] text-red-400 text-center max-w-[80px] mt-0.5 leading-tight">{errorMsg}</p>
      )}
    </div>
  )
}
