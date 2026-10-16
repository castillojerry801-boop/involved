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
  /**
   * Internal DB UUID. Present only on library/cached search results.
   * Use this as foodItemId when linking recipe ingredients to a FoodItem.
   * Distinct from externalId, which is the original provider's identifier used for dedup.
   */
  internalId?: string
  name: string
  brand?: string
  barcode?: string
  servingSize: number
  servingUnit: string
  /** Human-readable serving label, e.g. "1 medium", "1 cup", "1 bar (65g)". */
  householdServingText?: string
  /** Countable unit noun, e.g. "large egg", "strip", "slice". Singular form. */
  householdUnit?: string
  /** How many household units equal one DB serving (e.g. 1 for "1 large egg", 2 for "2 strips"). */
  unitsPerServing?: number
  coreNutrients: CoreNutrients
  /**
   * True when coreNutrients are placeholder zeros because the provider does not return
   * nutrition in search stubs (e.g. NIH DSLD). A detail fetch is required before logging.
   * Distinct from a food that genuinely has zero calories.
   */
  incompleteData?: boolean
  /**
   * True for FatSecret items with food_type='Generic' (non-branded whole foods).
   * Used to boost generic results in recipe ingredient searches.
   */
  isGeneric?: boolean
  /**
   * USDA FDC data type, e.g. 'Foundation', 'SR Legacy', 'Survey (FNDDS)', 'Branded'.
   * Required by resolveIngredientFactor Step 7 to decide whether to fetch USDA household
   * portions for count-unit resolution (e.g. "3 piece eggs"). Only present on USDA results.
   */
  fdcDataType?: string
}

export interface ExternalFoodDetail extends ExternalFoodResult {
  servingsPerContainer?: number
  extendedNutrients?: ExtendedNutrients
  ingredientsText?: string
  nutriScore?: string
  novaGroup?: number
  imageUrl?: string
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
