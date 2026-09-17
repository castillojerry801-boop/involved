'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2, CheckCircle, AlertCircle, ScanLine } from 'lucide-react'

interface FoodResult {
  externalId: string
  name: string
  brand?: string
  servingSize: number
  servingUnit: string
  coreNutrients: { calories: number; proteinG: number; carbohydrateG: number; fatG: number }
  extendedNutrients?: Record<string, number>
}

interface Props {
  mealType: string
  logDate: string
  onFound: (food: FoodResult) => void
  onLogged: () => void
}

export function BarcodeScanner({ onFound }: Props) {
  const scannerRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'idle' | 'scanning' | 'found' | 'notfound' | 'error'>('idle')
  const [foundFood, setFoundFood] = useState<FoodResult | null>(null)
  const [lastScanned, setLastScanned] = useState('')
  const scannerInstanceRef = useRef<{ clear: () => void; stop: () => Promise<void>; start: (...args: unknown[]) => Promise<void> } | null>(null)

  useEffect(() => {
    let html5QrCode: { stop: () => Promise<void>; clear: () => void; start: (...args: unknown[]) => Promise<void> } | null = null

    async function startScanner() {
      const { Html5Qrcode } = await import('html5-qrcode')
      if (!scannerRef.current) return

      html5QrCode = new Html5Qrcode('barcode-reader') as unknown as { stop: () => Promise<void>; clear: () => void; start: (...args: unknown[]) => Promise<void> }
      scannerInstanceRef.current = html5QrCode

      setStatus('scanning')

      await html5QrCode.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 150 } },
        async (decodedText: string) => {
          if (decodedText === lastScanned) return
          setLastScanned(decodedText)

          await html5QrCode!.stop()
          setStatus('idle')

          const res = await fetch(`/api/nutrition/barcode?upc=${encodeURIComponent(decodedText)}`)
          if (res.ok) {
            const data = await res.json() as { result: FoodResult }
            setFoundFood(data.result)
            setStatus('found')
          } else {
            setStatus('notfound')
          }
        },
        () => {},
      )
    }

    startScanner().catch(() => setStatus('error'))

    return () => {
      html5QrCode?.stop().catch(() => {})
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="p-4 flex flex-col items-center gap-4">
      {/* Scanner viewport */}
      <div
        id="barcode-reader"
        ref={scannerRef}
        className="w-full rounded-xl overflow-hidden bg-zinc-900"
      />

      {status === 'scanning' && (
        <div className="flex items-center gap-2 text-sm text-zinc-500">
          <ScanLine className="size-4 animate-pulse" />
          Point camera at a barcode
        </div>
      )}

      {status === 'found' && foundFood && (
        <div className="w-full rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 p-4">
          <div className="flex items-start gap-3">
            <CheckCircle className="size-5 text-emerald-500 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-semibold text-sm text-zinc-900 dark:text-white">{foundFood.name}</p>
              {foundFood.brand && <p className="text-xs text-zinc-500">{foundFood.brand}</p>}
              <p className="text-xs text-zinc-500 mt-1">
                {foundFood.coreNutrients.calories} cal · {foundFood.servingSize} {foundFood.servingUnit}
              </p>
              <p className="text-xs text-zinc-400 mt-0.5">
                P {foundFood.coreNutrients.proteinG}g · C {foundFood.coreNutrients.carbohydrateG}g · F {foundFood.coreNutrients.fatG}g
              </p>
            </div>
          </div>
          <button
            onClick={() => onFound(foundFood)}
            className="mt-3 w-full rounded-xl bg-emerald-500 py-2.5 text-sm font-semibold text-white hover:bg-emerald-600 transition-colors"
          >
            Add to meal
          </button>
        </div>
      )}

      {status === 'notfound' && (
        <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400">
          <AlertCircle className="size-4" />
          Barcode not found in database. Try searching by name.
        </div>
      )}

      {status === 'error' && (
        <div className="flex items-center gap-2 text-sm text-red-500">
          <AlertCircle className="size-4" />
          Camera access required for barcode scanning.
        </div>
      )}
    </div>
  )
}
