import type { RecipeStatus } from '@prisma/client'

// Returns true if this user can read the given recipe.
// Owners can always see their own recipe. Others can only see published recipes.
export function canReadRecipe(
  recipeUserId: string,
  recipeStatus: RecipeStatus,
  requesterId: string,
): boolean {
  if (recipeUserId === requesterId) return true
  return recipeStatus === 'published'
}

// Returns true if this user is allowed to mutate the given recipe.
export function canMutateRecipe(recipeUserId: string, requesterId: string): boolean {
  return recipeUserId === requesterId
}

// Returns true if the recipe can be freely edited without moderation side-effects.
export function isFreelyEditable(status: RecipeStatus): boolean {
  return status === 'draft' || status === 'private' || status === 'rejected'
}

// Returns true if editing should move the recipe back into review.
export function requiresReviseOnEdit(status: RecipeStatus): boolean {
  return status === 'pending' || status === 'published'
}

// Returns true if the recipe can be hard-deleted by the owner.
export function canHardDelete(status: RecipeStatus): boolean {
  return status === 'draft' || status === 'private' || status === 'rejected' || status === 'pending'
}
