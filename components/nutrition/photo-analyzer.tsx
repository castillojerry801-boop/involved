'use client'

import { useState, useRef } from 'react'
import { Camera, Upload, Loader2, CheckCircle, CheckCircle2, AlertCircle, RotateCcw, Mic, MicOff } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface FoodEstimate {
  name: string
  estimatedAmount: string
  calories: number
  proteinG: number
  carbohydrateG: number
  fatG: number
  fiberG?: number
  sodiumMg?: number
  confidence: 'high' | 'medium' | 'low'
  portionSource?: 'user_stated' | 'visual_estimate' | 'standard_portion'
  foodSource?: 'user_stated' | 'visual_identified' | 'ai_inferred'
  brandSource?: 'user_stated' | 'visual_label' | 'unknown'
  cookingMethodSource?: 'user_stated' | 'visual_inferred' | 'assumed'
  notes?: string
  conflictNote?: string
}

interface AnalysisResult {
  foods: FoodEstimate[]
  totalCalories: number
  disclaimer: string
}

interface Props {
  mealType: string
  logDate: string
  onLogged: () => void
  onClose: () => void
}

export function PhotoAnalyzer({ mealType, logDate, onLogged, onClose }: Props) {
  const [preview, setPreview] = useState<string | null>(null)
  const [userContext, setUserContext] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [logging, setLogging] = useState(false)
  const [loggedSummary, setLoggedSummary] = useState<{ count: number; totalCal: number } | null>(null)
  const [isRecording, setIsRecording] = useState(false)
  const [micError, setMicError] = useState<string | null>(null)
  const [transcribing, setTranscribing] = useState(false)

  const cameraInputRef = useRef<HTMLInputElement>(null)
  const uploadInputRef = useRef<HTMLInputElement>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])

  const handleFile = (file: File) => {
    const reader = new FileReader()
    reader.onload = e => {
      const dataUrl = e.target?.result as string
      const img = new window.Image()
      img.onload = () => {
        const MAX = 1024
        let { width, height } = img
        if (width > MAX || height > MAX) {
          if (width > height) { height = Math.round(height * MAX / width); width = MAX }
          else { width = Math.round(width * MAX / height); height = MAX }
        }
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        canvas.getContext('2d')!.drawImage(img, 0, 0, width, height)
        setPreview(canvas.toDataURL('image/jpeg', 0.82))
        setResult(null)
        setError(null)
      }
      img.src = dataUrl
    }
    reader.readAsDataURL(file)
  }

  const startRecording = async () => {
    setMicError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      audioChunksRef.current = []
      recorder.ondataavailable = e => { if (e.data.size > 0) audioChunksRef.current.push(e.data) }
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
        const fd = new FormData()
        fd.append('audio', blob)
        setTranscribing(true)
        try {
          const res = await fetch('/api/v/voice/transcribe', { method: 'POST', body: fd })
          if (res.status === 403) { setMicError('Voice input requires Involved+'); return }
          if (res.status === 429) { setMicError('Voice limit reached for today'); return }
          if (!res.ok) { setMicError('Transcription failed — type your notes instead'); return }
          const { transcript } = await res.json() as { transcript: string }
          if (transcript?.trim()) {
            setUserContext(prev => prev.trim() ? `${prev.trim()} ${transcript.trim()}` : transcript.trim())
          }
        } finally {
          setTranscribing(false)
        }
      }
      recorder.start()
      mediaRecorderRef.current = recorder
      setIsRecording(true)
    } catch {
      setMicError('Microphone access denied')
    }
  }

  const stopRecording = () => {
    mediaRecorderRef.current?.stop()
    setIsRecording(false)
  }

  const analyze = async () => {
    if (!preview) return
    setAnalyzing(true)
    setError(null)
    try {
      const res = await fetch('/api/nutrition/ai-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: preview,
          userContext: userContext.trim() || undefined,
        }),
      })
      if (!res.ok) throw new Error('Analysis failed')
      const data = await res.json() as AnalysisResult
      setResult(data)
    } catch {
      setError('Could not analyze the photo. Try again or log manually.')
    } finally {
      setAnalyzing(false)
    }
  }

  const logAll = async () => {
    if (!result) return
    setLogging(true)
    try {
      await Promise.all(
        result.foods.map(food =>
          fetch('/api/nutrition/log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              mealType,
              logDate,
              foodName: `${food.name} (AI estimate)`,
              servingMultiplier: 1,
              servingSize: 1,
              servingUnit: food.estimatedAmount,
              calories: food.calories,
              proteinG: food.proteinG,
              carbohydrateG: food.carbohydrateG,
              fatG: food.fatG,
              extendedNutrients: {
                ...(food.fiberG ? { fiber_g: food.fiberG } : {}),
                ...(food.sodiumMg ? { sodium_mg: food.sodiumMg } : {}),
              },
              sourceProvider: 'ai_vision',
            }),
          })
        )
      )
      onLogged()
      setLoggedSummary({ count: result.foods.length, totalCal: result.totalCalories })
      setTimeout(onClose, 1800)
    } finally {
      setLogging(false)
    }
  }

  const reset = () => {
    setPreview(null)
    setResult(null)
    setError(null)
    setLoggedSummary(null)
    setUserContext('')
    setMicError(null)
  }

  // ── Success screen ──────────────────────────────────────────────────────────

  if (loggedSummary) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-14 px-6 text-center">
        <div className="flex size-16 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/40">
          <CheckCircle2 className="size-8 text-emerald-500" />
        </div>
        <div>
          <p className="font-bold text-zinc-900 dark:text-white text-base">
            {loggedSummary.count} {loggedSummary.count === 1 ? 'item' : 'items'} logged
          </p>
          <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400 mt-1">
            ~{loggedSummary.totalCal} cal
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 flex flex-col gap-4">
      {/* Camera / upload area */}
      {!preview && (
        <div className="flex flex-col items-center gap-3">
          <div className="w-full rounded-xl border-2 border-dashed border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 p-10 flex flex-col items-center gap-3 text-center">
            <Camera className="size-10 text-zinc-300" />
            <div>
              <p className="font-medium text-sm text-zinc-700 dark:text-zinc-300">Take or upload a photo of your meal</p>
              <p className="text-xs text-zinc-400 mt-1">AI will estimate the calories and macros from the image</p>
            </div>
          </div>

          <div className="flex gap-2 w-full">
            <Button variant="secondary" className="flex-1" onClick={() => cameraInputRef.current?.click()}>
              <Camera className="size-4" />
              Take photo
            </Button>
            <Button variant="secondary" className="flex-1" onClick={() => uploadInputRef.current?.click()}>
              <Upload className="size-4" />
              Upload
            </Button>
          </div>

          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])}
          />
          <input
            ref={uploadInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])}
          />
        </div>
      )}

      {/* Preview */}
      {preview && (
        <div className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="Food preview" className="w-full rounded-xl object-cover max-h-72" />
          <button
            onClick={reset}
            className="absolute top-2 right-2 flex size-7 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
          >
            <RotateCcw className="size-3.5" />
          </button>
        </div>
      )}

      {/* Context field — shown after image is selected, before analysis */}
      {preview && !result && (
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Anything V should know?
          </label>
          <div className="relative">
            <textarea
              value={userContext}
              onChange={e => setUserContext(e.target.value)}
              placeholder="Optional — add portions, ingredients, brands, sauces, cooking methods, or anything the photo might not show."
              rows={2}
              className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 pr-10 text-sm text-zinc-900 dark:text-white placeholder:text-zinc-400 resize-none focus:outline-none focus:ring-2 focus:ring-emerald-500 dark:focus:ring-emerald-500"
            />
            <button
              type="button"
              onClick={isRecording ? stopRecording : startRecording}
              disabled={transcribing}
              title={isRecording ? 'Stop recording' : 'Describe with voice'}
              className={`absolute right-2 bottom-2 flex size-7 items-center justify-center rounded-full transition-colors disabled:opacity-40 ${
                isRecording
                  ? 'bg-red-500 text-white animate-pulse'
                  : transcribing
                  ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-400'
                  : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-300 hover:bg-emerald-500 hover:text-white'
              }`}
            >
              {isRecording ? <MicOff className="size-3.5" /> : <Mic className="size-3.5" />}
            </button>
          </div>
          {micError && (
            <p className="text-xs text-amber-600 dark:text-amber-400">{micError}</p>
          )}
          {transcribing && (
            <p className="text-xs text-zinc-400 flex items-center gap-1">
              <Loader2 className="size-3 animate-spin" /> Transcribing...
            </p>
          )}
        </div>
      )}

      {/* Analyze button */}
      {preview && !result && (
        <Button onClick={analyze} disabled={analyzing || isRecording || transcribing} className="w-full">
          {analyzing
            ? <><Loader2 className="size-4 animate-spin" /> Analyzing...</>
            : 'Analyze with AI'}
        </Button>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 p-3 text-sm text-red-600 dark:text-red-400">
          <AlertCircle className="size-4 shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <CheckCircle className="size-4 text-emerald-500" />
            <p className="text-sm font-semibold text-zinc-900 dark:text-white">
              ~{result.totalCalories} calories detected
            </p>
          </div>

          <div className="flex flex-col gap-2">
            {result.foods.map((food, i) => (
              <div key={i} className="rounded-xl border border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-zinc-900 dark:text-white">{food.name}</p>
                    <p className="text-xs text-zinc-400">
                      {food.estimatedAmount}
                      {food.portionSource === 'user_stated' && (
                        <span className="ml-1.5 text-emerald-500 dark:text-emerald-400">· from your notes</span>
                      )}
                    </p>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${
                    food.confidence === 'high'   ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400' :
                    food.confidence === 'medium' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400' :
                    'bg-zinc-100 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-400'
                  }`}>
                    {food.confidence}
                  </span>
                </div>
                <p className="text-xs text-zinc-500 mt-1.5">
                  {food.calories} cal · P {food.proteinG}g · C {food.carbohydrateG}g · F {food.fatG}g
                </p>
                {food.conflictNote && (
                  <div className="flex items-start gap-1.5 mt-1.5 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-2 py-1.5">
                    <AlertCircle className="size-3.5 shrink-0 mt-0.5 text-amber-500" />
                    <p className="text-xs text-amber-700 dark:text-amber-400">{food.conflictNote}</p>
                  </div>
                )}
                {food.notes && !food.conflictNote && (
                  <p className="text-xs text-zinc-400 mt-1 italic">{food.notes}</p>
                )}
              </div>
            ))}
          </div>

          <p className="text-xs text-zinc-400 italic">{result.disclaimer}</p>

          <div className="flex gap-2">
            <Button variant="secondary" onClick={reset} className="flex-1">
              Retake
            </Button>
            <Button onClick={logAll} disabled={logging} className="flex-1">
              {logging ? <><Loader2 className="size-4 animate-spin" /> Logging...</> : 'Log all items'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
