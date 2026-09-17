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
import { OpenFoodFactsProvider } from './open-food-facts'
import { UsdaFoodDataProvider } from './usda-fooddata'
// import { NutritionixProvider } from './nutritionix' // uncomment when ready

export const FOOD_PROVIDERS: FoodProvider[] = [
  new UsdaFoodDataProvider(),
  new OpenFoodFactsProvider(),
  // new NutritionixProvider(),
]


export function getProvider(providerId: string): FoodProvider | undefined {
  return FOOD_PROVIDERS.find(p => p.providerId === providerId)
}

export type { FoodProvider, ExternalFoodResult, ExternalFoodDetail } from './types'
