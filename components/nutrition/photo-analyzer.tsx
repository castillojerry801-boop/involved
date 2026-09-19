'use client'

import { useState, useRef } from 'react'
import { Camera, Upload, Loader2, CheckCircle, CheckCircle2, AlertCircle, RotateCcw } from 'lucide-react'
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
  onClose: () => void
}

export function PhotoAnalyzer({ mealType, logDate, onLogged, onClose }: Props) {
  const [preview, setPreview] = useState<string | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [logging, setLogging] = useState(false)
  const [loggedSummary, setLoggedSummary] = useState<{ count: number; totalCal: number } | null>(null)

  // Two separate inputs: one opens the camera, one opens the gallery/file picker
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const uploadInputRef = useRef<HTMLInputElement>(null)

  const handleFile = (file: File) => {
    const reader = new FileReader()
    reader.onload = e => {
      setPreview(e.target?.result as string)
      setResult(null)
      setError(null)
    }
    reader.readAsDataURL(file)
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
  }

  // ── Success screen ─────────────────────────────────────────────────────────

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
            {/* capture="environment" on iOS opens the rear camera directly */}
            <Button variant="secondary" className="flex-1" onClick={() => cameraInputRef.current?.click()}>
              <Camera className="size-4" />
              Take photo
            </Button>
            <Button variant="secondary" className="flex-1" onClick={() => uploadInputRef.current?.click()}>
              <Upload className="size-4" />
              Upload
            </Button>
          </div>

          {/* Camera input — triggers native iOS camera */}
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])}
          />
          {/* Upload input — opens photo library / file picker */}
          <input
            ref={uploadInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])}
          />
        </div>
      )}

      {/* Preview + analyze */}
      {preview && (
        <div className="flex flex-col gap-3">
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

          {!result && (
            <Button onClick={analyze} disabled={analyzing} className="w-full">
              {analyzing
                ? <><Loader2 className="size-4 animate-spin" /> Analyzing...</>
                : 'Analyze with AI'}
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
                {food.notes && <p className="text-xs text-zinc-400 mt-1 italic">{food.notes}</p>}
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
