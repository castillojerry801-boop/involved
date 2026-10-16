/**
 * Tests for isOptional / isToTaste field flow through the recipe ingredient system.
 *
 * These tests cover:
 * 1. toApiIngredient() preserves isOptional and isToTaste in the API payload
 * 2. ingredientToDraft() reads isOptional and isToTaste from persisted data
 * 3. makeIngredient-equivalent defaults both to false
 */
import { describe, it, expect } from 'vitest'
import { toApiIngredient, hasValidNutrition, type IngredientDraft } from '../../components/recipes/recipe-ingredient-row'
import { ingredientToDraft } from '../../components/recipes/create-recipe-modal'
import type { RecipeDetail } from '../../components/recipes/recipe-detail'

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeIngredient(overrides: Partial<IngredientDraft> = {}): IngredientDraft {
  return {
    key: 'test-key',
    foodItemId: null,
    name: 'salt',
    quantityText: '1',
    quantity: 1,
    unit: 'tsp',
    notes: '',
    isOptional: false,
    isToTaste: false,
    snapshotCalories: 0,
    snapshotProteinG: 0,
    snapshotCarbG: 0,
    snapshotFatG: 0,
    ...overrides,
  }
}

type PersistedIngredient = RecipeDetail['ingredients'][0]

function makePersistedIngredient(overrides: Partial<PersistedIngredient> = {}): PersistedIngredient {
  return {
    id: 'ing-uuid-1',
    foodItemId: null,
    name: 'garlic',
    quantity: 2,
    unit: 'clove',
    notes: null,
    isOptional: false,
    isToTaste: false,
    snapshotCalories: 8,
    snapshotProteinG: 0.4,
    snapshotCarbG: 1.8,
    snapshotFatG: 0.04,
    ...overrides,
  }
}

// ── toApiIngredient passthrough ────────────────────────────────────────────────

describe('toApiIngredient — isOptional and isToTaste passthrough', () => {
  it('preserves isOptional: true in API payload', () => {
    const ing = makeIngredient({ isOptional: true })
    const payload = toApiIngredient(ing)
    expect(payload.isOptional).toBe(true)
  })

  it('preserves isOptional: false in API payload', () => {
    const ing = makeIngredient({ isOptional: false })
    const payload = toApiIngredient(ing)
    expect(payload.isOptional).toBe(false)
  })

  it('preserves isToTaste: true in API payload', () => {
    const ing = makeIngredient({ isToTaste: true })
    const payload = toApiIngredient(ing)
    expect(payload.isToTaste).toBe(true)
  })

  it('preserves isToTaste: false in API payload', () => {
    const ing = makeIngredient({ isToTaste: false })
    const payload = toApiIngredient(ing)
    expect(payload.isToTaste).toBe(false)
  })

  it('strips client-only fields (key, _baseFood, quantityText, _displayName, _matchedFoodName)', () => {
    const ing = makeIngredient({
      _baseFood: { servingSize: 100, servingUnit: 'g', calories: 0, proteinG: 0, carbohydrateG: 0, fatG: 0 },
      _displayName: 'my salt',
      _matchedFoodName: 'Sodium Chloride',
    })
    const payload = toApiIngredient(ing)
    expect('key' in payload).toBe(false)
    expect('_baseFood' in payload).toBe(false)
    expect('quantityText' in payload).toBe(false)
    expect('_displayName' in payload).toBe(false)
    expect('_matchedFoodName' in payload).toBe(false)
  })

  it('both flags can be true simultaneously', () => {
    const ing = makeIngredient({ isOptional: true, isToTaste: true })
    const payload = toApiIngredient(ing)
    expect(payload.isOptional).toBe(true)
    expect(payload.isToTaste).toBe(true)
  })
})

// ── ingredientToDraft reads from persisted data ────────────────────────────────

describe('ingredientToDraft — reads isOptional and isToTaste from persisted record', () => {
  it('reads isOptional: true from DB record', () => {
    const persisted = makePersistedIngredient({ isOptional: true })
    const draft = ingredientToDraft(persisted)
    expect(draft.isOptional).toBe(true)
  })

  it('reads isOptional: false from DB record', () => {
    const persisted = makePersistedIngredient({ isOptional: false })
    const draft = ingredientToDraft(persisted)
    expect(draft.isOptional).toBe(false)
  })

  it('reads isToTaste: true from DB record', () => {
    const persisted = makePersistedIngredient({ isToTaste: true })
    const draft = ingredientToDraft(persisted)
    expect(draft.isToTaste).toBe(true)
  })

  it('defaults isOptional to false when not present (old record)', () => {
    const persisted = makePersistedIngredient()
    // Simulate old record without these fields
    const withoutFlags = { ...persisted } as Partial<PersistedIngredient>
    delete withoutFlags.isOptional
    delete withoutFlags.isToTaste
    const draft = ingredientToDraft(withoutFlags as PersistedIngredient)
    expect(draft.isOptional).toBe(false)
    expect(draft.isToTaste).toBe(false)
  })

  it('preserves nutrition snapshot from persisted record', () => {
    const persisted = makePersistedIngredient({ isOptional: true })
    const draft = ingredientToDraft(persisted)
    expect(draft.snapshotCalories).toBe(8)
    expect(draft.snapshotProteinG).toBe(0.4)
    expect(draft.quantity).toBe(2)
    expect(draft.unit).toBe('clove')
  })

  it('sets quantityText to string of quantity', () => {
    const persisted = makePersistedIngredient({ quantity: 2.5 })
    const draft = ingredientToDraft(persisted)
    expect(draft.quantityText).toBe('2.5')
  })
})

// ── Default state ──────────────────────────────────────────────────────────────

describe('new ingredient defaults', () => {
  it('new ingredient has isOptional: false by default', () => {
    const ing = makeIngredient()
    expect(ing.isOptional).toBe(false)
  })

  it('new ingredient has isToTaste: false by default', () => {
    const ing = makeIngredient()
    expect(ing.isToTaste).toBe(false)
  })

  it('to-taste ingredient still passes hasValidNutrition when nutrition is present', () => {
    const ing = makeIngredient({ isToTaste: true })
    // hasValidNutrition doesn't care about isToTaste — it just checks snapshot values
    expect(hasValidNutrition(ing)).toBe(true)
  })
})
