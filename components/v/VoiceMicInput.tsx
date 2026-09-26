'use client'

import { useState, useRef, useCallback } from 'react'
import { Mic, MicOff, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface VoiceMicInputProps {
  onTranscript: (text: string) => void
  disabled?: boolean
  className?: string
}

type MicState = 'idle' | 'recording' | 'processing' | 'error'

export function VoiceMicInput({ onTranscript, disabled, className }: VoiceMicInputProps) {
  const [state, setState] = useState<MicState>('idle')
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

  const stopAndProcess = useCallback(() => {
    const mr = mediaRecorderRef.current
    if (!mr || mr.state === 'inactive') return
    mr.stop()
  }, [])

  const startRecording = useCallback(async () => {
    setState('idle')

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
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
        const res = await fetch('/api/v/voice/transcribe', { method: 'POST', body: fd })
        if (!res.ok) {
          setState('error')
          return
        }
        const { transcript } = await res.json() as { transcript: string }
        if (transcript?.trim()) onTranscript(transcript.trim())
        setState('idle')
      } catch {
        setState('error')
      }
    }

    mr.start()
    setState('recording')
  }, [onTranscript])

  const handleClick = () => {
    if (disabled || state === 'processing') return
    if (state === 'recording') stopAndProcess()
    else void startRecording()
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled || state === 'processing'}
      title={state === 'recording' ? 'Tap to stop recording' : 'Speak your message'}
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-xl transition-colors disabled:opacity-40',
        state === 'recording'
          ? 'bg-red-500 text-white animate-pulse'
          : state === 'error'
          ? 'text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20'
          : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300',
        className
      )}
    >
      {state === 'processing' ? (
        <Loader2 className="size-4 animate-spin" />
      ) : state === 'recording' ? (
        <MicOff className="size-4" />
      ) : (
        <Mic className="size-4" />
      )}
    </button>
  )
}
