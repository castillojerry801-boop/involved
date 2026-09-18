// Involved Food Provider Abstraction
//
// Every external food data source implements FoodProvider.
// Adding a new provider (barcode database, restaurant API, etc.)
// means implementing this interface and registering it in index.ts.
// No database migrations needed to add a provider.
//
// The search result types are normalized so callers never need to
// know which provider returned a result — they just work with
// ExternalFoodResult and ExternalFoodDetail.

// ─────────────────────────────────────────────────────────────────────
// Core nutrients always present on external results.
// Extended nutrients are open-ended — use the keys as-is.
// ─────────────────────────────────────────────────────────────────────

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
  [key: string]: number | undefined // open-ended for future nutrients
}

// ─────────────────────────────────────────────────────────────────────
// Search result — lightweight summary returned by search()
// ─────────────────────────────────────────────────────────────────────

export interface ExternalFoodResult {
  provider: string       // e.g., "usda_fooddata_central"
  externalId: string     // ID in the provider's system
  name: string
  brand?: string
  barcode?: string
  servingSize: number
  servingUnit: string
  coreNutrients: CoreNutrients
}

// ─────────────────────────────────────────────────────────────────────
// Full detail — returned by getById() and searchByBarcode()
// Includes extended nutrients and ingredients.
// ─────────────────────────────────────────────────────────────────────

export interface ExternalFoodDetail extends ExternalFoodResult {
  servingsPerContainer?: number
  extendedNutrients?: ExtendedNutrients
  ingredientsText?: string
  // Open Food Facts extras
  nutriScore?: string        // A/B/C/D/E or null
  novaGroup?: number         // 1–4
  imageUrl?: string
  incompleteData?: boolean   // true when core nutrients are partially missing
}

// ─────────────────────────────────────────────────────────────────────
// FoodProvider — the interface every external source must implement
// ─────────────────────────────────────────────────────────────────────

export interface FoodProvider {
  /** Human-readable name for logging and attribution */
  readonly name: string

  /** Stable identifier stored as source_provider in food_items */
  readonly providerId: string

  /**
   * Search for foods by text query.
   * Returns lightweight results suitable for a search results list.
   * Implementations should respect a reasonable result limit (e.g., 20).
   */
  search(query: string, options?: { limit?: number }): Promise<ExternalFoodResult[]>

  /**
   * Fetch full detail for a specific food by its external ID.
   * Returns null if not found.
   */
  getById(externalId: string): Promise<ExternalFoodDetail | null>

  /**
   * Look up a food by barcode (UPC, EAN, GTIN).
   * Returns null if the barcode is not in this provider's database.
   * Not all providers support barcode lookup — return null by default.
   */
  searchByBarcode(barcode: string): Promise<ExternalFoodDetail | null>
}
