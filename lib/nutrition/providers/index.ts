// Involved Food Provider Registry
//
// Register active food providers here. The search service (lib/nutrition/search.ts)
// will use this registry to fan out searches and barcode lookups.
//
// To add a provider:
//   1. Create lib/nutrition/providers/your-provider.ts implementing FoodProvider
//   2. Import and add an instance to the PROVIDERS array below
//   3. No database migrations required

import type { FoodProvider } from './types'
import { FatSecretProvider } from './fatsecret'
import { OpenFoodFactsProvider } from './open-food-facts'
import { UsdaFoodDataProvider } from './usda-fooddata'

// Priority order: FatSecret (best global DB + barcode) → USDA (authoritative whole foods) → Open Food Facts (fallback)
export const FOOD_PROVIDERS: FoodProvider[] = [
  new FatSecretProvider(),
  new UsdaFoodDataProvider(),
  new OpenFoodFactsProvider(),
]


export function getProvider(providerId: string): FoodProvider | undefined {
  return FOOD_PROVIDERS.find(p => p.providerId === providerId)
}

export type { FoodProvider, ExternalFoodResult, ExternalFoodDetail } from './types'
