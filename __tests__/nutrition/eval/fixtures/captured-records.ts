/**
 * Reference-accuracy fixtures for Coach V nutrition evaluation.
 *
 * Each record represents what a real provider would return for a well-known food.
 * The `food` field is an ExternalFoodResult shaped as the provider would deliver it.
 * The `referenceMacros` are the macros the pipeline MUST produce for
 * `referenceQuantity referenceUnit` — computed from the fixture's own coreNutrients
 * and serving data, not from a separate lookup table.
 *
 * captureStatus:
 *   'needs_capture' — macro values sourced from published USDA FoodData Central
 *                     tables (Foundation / SR Legacy datasets, widely available).
 *                     To replace with live API records, run the capture script:
 *                     npx tsx __tests__/nutrition/eval/capture-records.ts
 *   'verified'      — confirmed via a live API call; capturedAt set to ISO date.
 *
 * IMPORTANT: This file belongs exclusively to the eval layer.
 * These values MUST NOT be imported into production matching, provider, or prompt code.
 * No nutrition hardcoding in production. Ever.
 *
 * Tolerance field: 0.15 = ±15%, which accommodates the gap between published tables
 * and the specific record returned by a live API call. Tighten once verified.
 */

import type { ExternalFoodResult } from '../../../../lib/nutrition/providers/types'

export interface CapturedRecord {
  label: string
  source: 'usda_fooddata' | 'fatsecret' | 'open_food_facts'
  externalId: string
  capturedAt: string
  captureStatus: 'verified' | 'needs_capture'
  food: ExternalFoodResult
  referenceQuantity: number
  referenceUnit: string
  referenceMacros: {
    calories: number
    proteinG: number
    carbG: number
    fatG: number
  }
  tolerance: number
  note?: string
}

// ── Records ───────────────────────────────────────────────────────────────────
// Categories covered: poultry, fish, vegetable, grain, tuber, dairy, fat, cheese,
// legume-spread, fruit, egg, leafy-green, yogurt, cereal, nut.
// Units covered: grams, ounces, millilitres/cups, count (large/medium/each).

export const CAPTURED_RECORDS: CapturedRecord[] = [
  // ── Whole proteins ──────────────────────────────────────────────────────────

  {
    label: 'Chicken breast, raw — 100g',
    source: 'usda_fooddata',
    externalId: 'usda-chicken-breast-raw-100g',
    capturedAt: 'NEEDS_CAPTURE',
    captureStatus: 'needs_capture',
    food: {
      provider: 'usda_fooddata',
      externalId: 'usda-chicken-breast-raw-100g',
      name: 'Chicken, broilers or fryers, breast, meat only, raw',
      servingSize: 100,
      servingUnit: 'g',
      fdcDataType: 'Foundation',
      coreNutrients: { calories: 165, proteinG: 31.0, carbohydrateG: 0, fatG: 3.6 },
      isGeneric: true,
    },
    referenceQuantity: 100,
    referenceUnit: 'g',
    referenceMacros: { calories: 165, proteinG: 31.0, carbG: 0, fatG: 3.6 },
    tolerance: 0.15,
    note: 'USDA Foundation dataset. FDC ID ~331960. Verify via capture script.',
  },

  {
    label: 'Chicken breast, raw — 4 oz',
    source: 'usda_fooddata',
    externalId: 'usda-chicken-breast-raw-100g',
    capturedAt: 'NEEDS_CAPTURE',
    captureStatus: 'needs_capture',
    food: {
      provider: 'usda_fooddata',
      externalId: 'usda-chicken-breast-raw-100g',
      name: 'Chicken, broilers or fryers, breast, meat only, raw',
      servingSize: 100,
      servingUnit: 'g',
      fdcDataType: 'Foundation',
      coreNutrients: { calories: 165, proteinG: 31.0, carbohydrateG: 0, fatG: 3.6 },
      isGeneric: true,
    },
    referenceQuantity: 4,
    referenceUnit: 'oz',
    // 4 oz = 113.398g → factor = 1.13398 → round(165*1.13398) = 187
    referenceMacros: { calories: 187, proteinG: 35.1, carbG: 0, fatG: 4.1 },
    tolerance: 0.15,
    note: 'Tests oz→g conversion. 4 oz ≈ 113g.',
  },

  {
    label: 'Salmon, Atlantic, raw — 100g',
    source: 'usda_fooddata',
    externalId: 'usda-salmon-atlantic-raw-100g',
    capturedAt: 'NEEDS_CAPTURE',
    captureStatus: 'needs_capture',
    food: {
      provider: 'usda_fooddata',
      externalId: 'usda-salmon-atlantic-raw-100g',
      name: 'Fish, salmon, Atlantic, wild, raw',
      servingSize: 100,
      servingUnit: 'g',
      fdcDataType: 'Foundation',
      coreNutrients: { calories: 142, proteinG: 19.8, carbohydrateG: 0, fatG: 6.3 },
      isGeneric: true,
    },
    referenceQuantity: 100,
    referenceUnit: 'g',
    referenceMacros: { calories: 142, proteinG: 19.8, carbG: 0, fatG: 6.3 },
    tolerance: 0.15,
    note: 'Wild Atlantic salmon, USDA Foundation.',
  },

  // ── Egg — count unit via householdUnit ──────────────────────────────────────

  {
    label: 'Large egg, whole, raw — 1 large',
    source: 'usda_fooddata',
    externalId: 'usda-egg-whole-raw-large',
    capturedAt: 'NEEDS_CAPTURE',
    captureStatus: 'needs_capture',
    food: {
      provider: 'usda_fooddata',
      externalId: 'usda-egg-whole-raw-large',
      name: 'Egg, whole, raw, fresh',
      servingSize: 50,
      servingUnit: 'g',
      householdUnit: 'large',
      unitsPerServing: 1,
      householdServingText: '1 large (50g)',
      fdcDataType: 'Foundation',
      coreNutrients: { calories: 71, proteinG: 6.3, carbohydrateG: 0.36, fatG: 4.75 },
      isGeneric: true,
    },
    referenceQuantity: 1,
    referenceUnit: 'large',
    // factor = 1/1 = 1 → macros = coreNutrients × 1
    referenceMacros: { calories: 71, proteinG: 6.3, carbG: 0.36, fatG: 4.75 },
    tolerance: 0.15,
    note: 'Tests householdUnit=large count resolution (Step 5 in factor engine).',
  },

  {
    label: 'Large egg, whole, raw — 2 large',
    source: 'usda_fooddata',
    externalId: 'usda-egg-whole-raw-large',
    capturedAt: 'NEEDS_CAPTURE',
    captureStatus: 'needs_capture',
    food: {
      provider: 'usda_fooddata',
      externalId: 'usda-egg-whole-raw-large',
      name: 'Egg, whole, raw, fresh',
      servingSize: 50,
      servingUnit: 'g',
      householdUnit: 'large',
      unitsPerServing: 1,
      householdServingText: '1 large (50g)',
      fdcDataType: 'Foundation',
      coreNutrients: { calories: 71, proteinG: 6.3, carbohydrateG: 0.36, fatG: 4.75 },
      isGeneric: true,
    },
    referenceQuantity: 2,
    referenceUnit: 'large',
    // factor = 2/1 = 2
    referenceMacros: { calories: 142, proteinG: 12.6, carbG: 0.72, fatG: 9.5 },
    tolerance: 0.15,
    note: 'Tests scaling from householdUnit: 2 large eggs = 2× per-egg macros.',
  },

  // ── Vegetables ──────────────────────────────────────────────────────────────

  {
    label: 'Broccoli, raw — 100g',
    source: 'usda_fooddata',
    externalId: 'usda-broccoli-raw-100g',
    capturedAt: 'NEEDS_CAPTURE',
    captureStatus: 'needs_capture',
    food: {
      provider: 'usda_fooddata',
      externalId: 'usda-broccoli-raw-100g',
      name: 'Broccoli, raw',
      servingSize: 100,
      servingUnit: 'g',
      fdcDataType: 'Foundation',
      coreNutrients: { calories: 34, proteinG: 2.82, carbohydrateG: 6.64, fatG: 0.37 },
      isGeneric: true,
    },
    referenceQuantity: 100,
    referenceUnit: 'g',
    referenceMacros: { calories: 34, proteinG: 2.82, carbG: 6.64, fatG: 0.37 },
    tolerance: 0.15,
  },

  {
    label: 'Spinach, raw — 100g',
    source: 'usda_fooddata',
    externalId: 'usda-spinach-raw-100g',
    capturedAt: 'NEEDS_CAPTURE',
    captureStatus: 'needs_capture',
    food: {
      provider: 'usda_fooddata',
      externalId: 'usda-spinach-raw-100g',
      name: 'Spinach, raw',
      servingSize: 100,
      servingUnit: 'g',
      fdcDataType: 'Foundation',
      coreNutrients: { calories: 23, proteinG: 2.86, carbohydrateG: 3.63, fatG: 0.39 },
      isGeneric: true,
    },
    referenceQuantity: 100,
    referenceUnit: 'g',
    referenceMacros: { calories: 23, proteinG: 2.86, carbG: 3.63, fatG: 0.39 },
    tolerance: 0.15,
  },

  {
    label: 'Sweet potato, raw — 100g',
    source: 'usda_fooddata',
    externalId: 'usda-sweet-potato-raw-100g',
    capturedAt: 'NEEDS_CAPTURE',
    captureStatus: 'needs_capture',
    food: {
      provider: 'usda_fooddata',
      externalId: 'usda-sweet-potato-raw-100g',
      name: 'Sweet potato, raw, unprepared',
      servingSize: 100,
      servingUnit: 'g',
      fdcDataType: 'Foundation',
      coreNutrients: { calories: 86, proteinG: 1.57, carbohydrateG: 20.1, fatG: 0.05 },
      isGeneric: true,
    },
    referenceQuantity: 100,
    referenceUnit: 'g',
    referenceMacros: { calories: 86, proteinG: 1.57, carbG: 20.1, fatG: 0.05 },
    tolerance: 0.15,
  },

  // ── Grains ──────────────────────────────────────────────────────────────────

  {
    label: 'Brown rice, cooked — 100g',
    source: 'usda_fooddata',
    externalId: 'usda-brown-rice-cooked-100g',
    capturedAt: 'NEEDS_CAPTURE',
    captureStatus: 'needs_capture',
    food: {
      provider: 'usda_fooddata',
      externalId: 'usda-brown-rice-cooked-100g',
      name: 'Rice, brown, long-grain, cooked',
      servingSize: 100,
      servingUnit: 'g',
      fdcDataType: 'Foundation',
      coreNutrients: { calories: 112, proteinG: 2.31, carbohydrateG: 23.0, fatG: 0.85 },
      isGeneric: true,
    },
    referenceQuantity: 100,
    referenceUnit: 'g',
    referenceMacros: { calories: 112, proteinG: 2.31, carbG: 23.0, fatG: 0.85 },
    tolerance: 0.15,
  },

  {
    label: 'Oats, dry — 100g',
    source: 'usda_fooddata',
    externalId: 'usda-oats-dry-100g',
    capturedAt: 'NEEDS_CAPTURE',
    captureStatus: 'needs_capture',
    food: {
      provider: 'usda_fooddata',
      externalId: 'usda-oats-dry-100g',
      name: 'Oats',
      servingSize: 100,
      servingUnit: 'g',
      fdcDataType: 'Foundation',
      coreNutrients: { calories: 389, proteinG: 16.9, carbohydrateG: 66.3, fatG: 6.9 },
      isGeneric: true,
    },
    referenceQuantity: 100,
    referenceUnit: 'g',
    referenceMacros: { calories: 389, proteinG: 16.9, carbG: 66.3, fatG: 6.9 },
    tolerance: 0.15,
    note: 'Dry oats. Note: cooked oats have very different per-gram values.',
  },

  // ── Dairy / volume unit ──────────────────────────────────────────────────────

  {
    label: 'Whole milk — 1 cup (244ml)',
    source: 'usda_fooddata',
    externalId: 'usda-whole-milk-100ml',
    capturedAt: 'NEEDS_CAPTURE',
    captureStatus: 'needs_capture',
    food: {
      provider: 'usda_fooddata',
      externalId: 'usda-whole-milk-100ml',
      name: 'Milk, whole, 3.25% milkfat, with added vitamin D',
      servingSize: 100,
      servingUnit: 'ml',
      fdcDataType: 'Foundation',
      coreNutrients: { calories: 61, proteinG: 3.15, carbohydrateG: 4.80, fatG: 3.25 },
      isGeneric: true,
    },
    referenceQuantity: 1,
    referenceUnit: 'cup',
    // 1 cup = 236.588ml → factor = 2.36588 → cal = 61*2.36588 ≈ 144
    referenceMacros: { calories: 144, proteinG: 7.45, carbG: 11.35, fatG: 7.69 },
    tolerance: 0.15,
    note: 'Tests volume→volume (cup input, ml-basis food). Factor = 236.588/100.',
  },

  {
    label: 'Greek yogurt, plain, whole milk — 100g',
    source: 'usda_fooddata',
    externalId: 'usda-greek-yogurt-whole-100g',
    capturedAt: 'NEEDS_CAPTURE',
    captureStatus: 'needs_capture',
    food: {
      provider: 'usda_fooddata',
      externalId: 'usda-greek-yogurt-whole-100g',
      name: 'Yogurt, Greek, plain, whole milk',
      servingSize: 100,
      servingUnit: 'g',
      fdcDataType: 'Foundation',
      coreNutrients: { calories: 97, proteinG: 9.0, carbohydrateG: 3.6, fatG: 5.0 },
      isGeneric: true,
    },
    referenceQuantity: 100,
    referenceUnit: 'g',
    referenceMacros: { calories: 97, proteinG: 9.0, carbG: 3.6, fatG: 5.0 },
    tolerance: 0.15,
  },

  // ── Fats / oils — tbsp unit ──────────────────────────────────────────────────

  {
    label: 'Olive oil — 1 tablespoon',
    source: 'usda_fooddata',
    externalId: 'usda-olive-oil-100g',
    capturedAt: 'NEEDS_CAPTURE',
    captureStatus: 'needs_capture',
    food: {
      provider: 'usda_fooddata',
      externalId: 'usda-olive-oil-100g',
      name: 'Oil, olive, salad or cooking',
      servingSize: 100,
      servingUnit: 'g',
      // householdUnit enables Step 5 (householdUnit match) in the factor engine.
      // USDA: 1 tbsp olive oil ≈ 13.5g → 100g / 13.5g ≈ 7.41 tbsp per 100g serving.
      householdUnit: 'tbsp',
      unitsPerServing: 7.41,
      fdcDataType: 'Foundation',
      coreNutrients: { calories: 884, proteinG: 0, carbohydrateG: 0, fatG: 100 },
      isGeneric: true,
    },
    referenceQuantity: 1,
    referenceUnit: 'tbsp',
    // factor = 1 / 7.41 = 0.1350 → cal = 884 * 0.1350 ≈ 119, fat = 100 * 0.1350 ≈ 13.5
    referenceMacros: { calories: 119, proteinG: 0, carbG: 0, fatG: 13.5 },
    tolerance: 0.15,
    note: 'Tests householdUnit=tbsp count resolution (Step 5). 1 tbsp ≈ 13.5g olive oil.',
  },

  // ── Cheese ──────────────────────────────────────────────────────────────────

  {
    label: 'Cheddar cheese — 100g',
    source: 'usda_fooddata',
    externalId: 'usda-cheddar-100g',
    capturedAt: 'NEEDS_CAPTURE',
    captureStatus: 'needs_capture',
    food: {
      provider: 'usda_fooddata',
      externalId: 'usda-cheddar-100g',
      name: 'Cheese, cheddar',
      servingSize: 100,
      servingUnit: 'g',
      fdcDataType: 'Foundation',
      coreNutrients: { calories: 403, proteinG: 24.9, carbohydrateG: 1.28, fatG: 33.1 },
      isGeneric: true,
    },
    referenceQuantity: 100,
    referenceUnit: 'g',
    referenceMacros: { calories: 403, proteinG: 24.9, carbG: 1.28, fatG: 33.1 },
    tolerance: 0.15,
  },

  // ── Nut butter ──────────────────────────────────────────────────────────────

  {
    label: 'Peanut butter, smooth — 2 tbsp',
    source: 'usda_fooddata',
    externalId: 'usda-peanut-butter-smooth-100g',
    capturedAt: 'NEEDS_CAPTURE',
    captureStatus: 'needs_capture',
    food: {
      provider: 'usda_fooddata',
      externalId: 'usda-peanut-butter-smooth-100g',
      name: 'Peanut butter, smooth style, without salt',
      servingSize: 100,
      servingUnit: 'g',
      // USDA: 1 tbsp PB ≈ 16g → 100g / 16g = 6.25 tbsp per 100g serving.
      householdUnit: 'tbsp',
      unitsPerServing: 6.25,
      fdcDataType: 'Foundation',
      coreNutrients: { calories: 598, proteinG: 22.5, carbohydrateG: 21.6, fatG: 50.4 },
      isGeneric: true,
    },
    referenceQuantity: 2,
    referenceUnit: 'tbsp',
    // factor = 2 / 6.25 = 0.32 → cal = 598*0.32 ≈ 191, fat = 50.4*0.32 ≈ 16.1
    referenceMacros: { calories: 191, proteinG: 7.2, carbG: 6.91, fatG: 16.13 },
    tolerance: 0.15,
    note: 'Tests householdUnit=tbsp (Step 5). 2 tbsp PB ≈ 32g via 6.25 tbsp/100g serving.',
  },

  // ── Fruit — count unit ───────────────────────────────────────────────────────

  {
    label: 'Banana, raw — 100g',
    source: 'usda_fooddata',
    externalId: 'usda-banana-raw-100g',
    capturedAt: 'NEEDS_CAPTURE',
    captureStatus: 'needs_capture',
    food: {
      provider: 'usda_fooddata',
      externalId: 'usda-banana-raw-100g',
      name: 'Bananas, raw',
      servingSize: 100,
      servingUnit: 'g',
      fdcDataType: 'Foundation',
      coreNutrients: { calories: 89, proteinG: 1.09, carbohydrateG: 22.8, fatG: 0.33 },
      isGeneric: true,
    },
    referenceQuantity: 100,
    referenceUnit: 'g',
    referenceMacros: { calories: 89, proteinG: 1.09, carbG: 22.8, fatG: 0.33 },
    tolerance: 0.15,
  },

  // ── Almonds — oz unit ────────────────────────────────────────────────────────

  {
    label: 'Almonds — 1 oz (28g)',
    source: 'usda_fooddata',
    externalId: 'usda-almonds-raw-100g',
    capturedAt: 'NEEDS_CAPTURE',
    captureStatus: 'needs_capture',
    food: {
      provider: 'usda_fooddata',
      externalId: 'usda-almonds-raw-100g',
      name: 'Nuts, almonds',
      servingSize: 100,
      servingUnit: 'g',
      fdcDataType: 'Foundation',
      coreNutrients: { calories: 579, proteinG: 21.2, carbohydrateG: 21.6, fatG: 49.9 },
      isGeneric: true,
    },
    referenceQuantity: 1,
    referenceUnit: 'oz',
    // 1 oz = 28.3495g → factor = 0.283495 → cal = 579*0.283495 ≈ 164
    referenceMacros: { calories: 164, proteinG: 6.01, carbG: 6.12, fatG: 14.15 },
    tolerance: 0.15,
    note: 'Tests oz→g conversion for a 1-oz nut serving.',
  },
]
