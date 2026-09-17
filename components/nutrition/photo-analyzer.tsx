'use client'

import { useState, useRef } from 'react'
import { Camera, Upload, Loader2, CheckCircle, AlertCircle, RotateCcw } from 'lucide-react'
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
  notes?: string
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
}

export function PhotoAnalyzer({ mealType, logDate, onLogged }: Props) {
  const [preview, setPreview] = useState<string | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [logging, setLogging] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [cameraActive, setCameraActive] = useState(false)
  const streamRef = useRef<MediaStream | null>(null)

  const handleFile = (file: File) => {
    const reader = new FileReader()
    reader.onload = e => {
      setPreview(e.target?.result as string)
      setResult(null)
      setError(null)
    }
    reader.readAsDataURL(file)
  }

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      streamRef.current = stream
      if (videoRef.current) videoRef.current.srcObject = stream
      setCameraActive(true)
    } catch {
      setError('Camera access denied. Please upload a photo instead.')
    }
  }

  const capturePhoto = () => {
    if (!videoRef.current) return
    const canvas = document.createElement('canvas')
    canvas.width = videoRef.current.videoWidth
    canvas.height = videoRef.current.videoHeight
    canvas.getContext('2d')?.drawImage(videoRef.current, 0, 0)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
    setPreview(dataUrl)
    setCameraActive(false)
    streamRef.current?.getTracks().forEach(t => t.stop())
    setResult(null)
    setError(null)
  }

  const analyze = async () => {
    if (!preview) return
    setAnalyzing(true)
    setError(null)
    try {
      const res = await fetch('/api/nutrition/ai-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: preview }),
      })
      if (!res.ok) throw new Error('Analysis failed')
      const data = await res.json() as AnalysisResult
      setResult(data)
    } catch {
      setError('Could not analyze the photo. Make sure your Anthropic API key is set up.')
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
    } finally {
      setLogging(false)
    }
  }

  const reset = () => {
    setPreview(null)
    setResult(null)
    setError(null)
    setCameraActive(false)
    streamRef.current?.getTracks().forEach(t => t.stop())
  }

  return (
    <div className="p-4 flex flex-col gap-4">
      {/* Camera / upload area */}
      {!preview && !cameraActive && (
        <div className="flex flex-col items-center gap-3">
          <div className="w-full rounded-xl border-2 border-dashed border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 p-10 flex flex-col items-center gap-3 text-center">
            <Camera className="size-10 text-zinc-300" />
            <div>
              <p className="font-medium text-sm text-zinc-700 dark:text-zinc-300">Take or upload a photo of your meal</p>
              <p className="text-xs text-zinc-400 mt-1">Claude AI will estimate the calories and nutrients</p>
            </div>
          </div>
          <div className="flex gap-2 w-full">
            <Button variant="secondary" className="flex-1" onClick={startCamera}>
              <Camera className="size-4" />
              Take photo
            </Button>
            <Button variant="secondary" className="flex-1" onClick={() => fileRef.current?.click()}>
              <Upload className="size-4" />
              Upload
            </Button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
          </div>
        </div>
      )}

      {/* Live camera */}
      {cameraActive && (
        <div className="flex flex-col gap-3">
          <video ref={videoRef} autoPlay playsInline className="w-full rounded-xl bg-zinc-900" />
          <Button onClick={capturePhoto} className="w-full">
            <Camera className="size-4" />
            Capture
          </Button>
        </div>
      )}

      {/* Preview + analyze */}
      {preview && !cameraActive && (
        <div className="flex flex-col gap-3">
          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt="Food preview" className="w-full rounded-xl object-cover max-h-64" />
            <button onClick={reset} className="absolute top-2 right-2 flex size-7 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70">
              <RotateCcw className="size-3.5" />
            </button>
          </div>

          {!result && (
            <Button onClick={analyze} disabled={analyzing} className="w-full">
              {analyzing ? <><Loader2 className="size-4 animate-spin" /> Analyzing...</> : <>Analyze with AI</>}
            </Button>
          )}
        </div>
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
                    <p className="text-xs text-zinc-400">{food.estimatedAmount}</p>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    food.confidence === 'high' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400' :
                    food.confidence === 'medium' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400' :
                    'bg-zinc-100 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-400'
                  }`}>
                    {food.confidence} confidence
                  </span>
                </div>
                <p className="text-xs text-zinc-500 mt-1.5">
                  {food.calories} cal · P {food.proteinG}g · C {food.carbohydrateG}g · F {food.fatG}g
                </p>
                {food.notes && <p className="text-xs text-zinc-400 mt-1 italic">{food.notes}</p>}
              </div>
            ))}
          </div>

          <p className="text-xs text-zinc-400 italic">{result.disclaimer}</p>

          <Button onClick={logAll} disabled={logging} className="w-full">
            {logging ? <><Loader2 className="size-4 animate-spin" /> Logging...</> : <>Log all items</>}
          </Button>
        </div>
      )}
    </div>
  )
}
