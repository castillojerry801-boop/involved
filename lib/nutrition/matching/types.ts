export type MatchConfidence = 'confident' | 'plausible' | 'ambiguous' | 'no_match'

export interface FoodMatch {
  provider: string
  externalId: string
  internalId?: string           // DB UUID if already in library cache
  name: string
  brand?: string
  servingSize: number
  servingUnit: string
  householdUnit?: string
  unitsPerServing?: number
  householdServingText?: string
  calories: number
  proteinG: number
  carbohydrateG: number
  fatG: number
  isGeneric: boolean
  fdcDataType?: string
  matchScore: number
  matchReasons: string[]        // e.g. ["All query words match", "USDA Foundation food"]
}

export interface MatchResult {
  confidence: MatchConfidence
  topMatch: FoodMatch | null
  alternatives: FoodMatch[]     // top 3 alternatives excluding topMatch
  clarificationQuestion?: string // e.g. "Breast, thigh, or whole chicken?"
  matchNote?: string            // e.g. "Matched to USDA generic olive oil"
  // Always present: top 6 scored results (regardless of confidence level).
  // Used by the recipe ingredient row to populate the dropdown on no_match without
  // a second round-trip to /api/nutrition/search.
  rawResults?: FoodMatch[]
}

export interface MatchRequest {
  ingredientName: string
  quantity?: number
  unit?: string
  preparationState?: string
}
