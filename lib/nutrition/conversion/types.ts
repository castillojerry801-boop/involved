import type { ConversionSource } from '@prisma/client'

export type ConversionResult = {
  grams: number                    // absolute gram weight for this ingredient
  factor: number                   // food.macros × factor = ingredient macros
  conversionSource: ConversionSource
  portionDescription: string       // e.g. "1 tbsp (13.5g)" or "3 lb (1360.8g)"
  confidence: 'high' | 'medium' | 'low'
  preparationState?: string
  notes: string[]                  // e.g. ["USDA Foundation portion", "Raw weight assumed"]
}

export type ConversionError = {
  kind: 'conversion_error'
  errorCode:
    | 'unit_incompatible'     // e.g. cup for a gram-basis food with no portion data
    | 'unit_unknown'          // unrecognized unit string
    | 'portion_not_found'     // household unit not in DB and not USDA-fetchable
    | 'density_unavailable'   // volume→weight but no density data
    | 'ambiguous_preparation' // multiple prep-state variants exist, user must specify
    | 'identity_rejected'     // topMatch failed food-form or preparation-state identity check
  message: string
  suggestions?: string[]
}

export function isConversionError(r: ConversionResult | ConversionError): r is ConversionError {
  return (r as ConversionError).kind === 'conversion_error'
}
