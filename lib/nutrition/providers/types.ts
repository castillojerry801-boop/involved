// Involved Food Provider Abstraction
//
// Every external food data source implements FoodProvider.
// Adding a new provider means implementing this interface and registering
// it in index.ts. No database migrations needed to add a provider.

export interface CoreNutrients {
  calories: number
  proteinG: number
  carbohydrateG: number
  fatG: number
}

export interface ExtendedNutrients {
  fiberG?: number
  sugarG?: number
  sodiumMg?: number
  saturatedFatG?: number
  transFatG?: number
  cholesterolMg?: number
  potassiumMg?: number
  calciumMg?: number
  ironMg?: number
  vitaminDMcg?: number
  vitaminCMg?: number
  vitaminAMcg?: number
  [key: string]: number | undefined
}

export interface ExternalFoodResult {
  provider: string
  externalId: string
  name: string
  brand?: string
  barcode?: string
  servingSize: number
  servingUnit: string
  /** Human-readable serving label, e.g. "1 medium", "1 cup", "1 bar (65g)". */
  householdServingText?: string
  coreNutrients: CoreNutrients
}

export interface ExternalFoodDetail extends ExternalFoodResult {
  servingsPerContainer?: number
  extendedNutrients?: ExtendedNutrients
  ingredientsText?: string
  nutriScore?: string
  novaGroup?: number
  imageUrl?: string
  incompleteData?: boolean
}

export interface AutocompleteResult {
  id?: string
  name: string
  brand?: string
}

export interface FoodProvider {
  readonly name: string
  readonly providerId: string
  search(query: string, options?: { limit?: number }): Promise<ExternalFoodResult[]>
  getById(externalId: string): Promise<ExternalFoodDetail | null>
  searchByBarcode(barcode: string): Promise<ExternalFoodDetail | null>
  autocomplete?(query: string, options?: { limit?: number }): Promise<AutocompleteResult[]>
}
