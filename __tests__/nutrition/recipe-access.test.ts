import { describe, it, expect } from 'vitest'
import {
  canReadRecipe,
  canMutateRecipe,
  isFreelyEditable,
  requiresReviseOnEdit,
  canHardDelete,
} from '../../lib/recipes/access'
import type { RecipeStatus } from '@prisma/client'

const OWNER = 'user-owner'
const OTHER = 'user-other'

// ── canReadRecipe ──────────────────────────────────────────────────────────────

describe('canReadRecipe — owner access', () => {
  const OWNER_VISIBLE: RecipeStatus[] = ['draft', 'private', 'pending', 'published', 'rejected', 'archived']
  it.each(OWNER_VISIBLE)('owner can read their own %s recipe', (status) => {
    expect(canReadRecipe(OWNER, status, OWNER)).toBe(true)
  })
})

describe('canReadRecipe — public access', () => {
  it('other users can read published recipes', () => {
    expect(canReadRecipe(OWNER, 'published', OTHER)).toBe(true)
  })

  const NOT_PUBLIC: RecipeStatus[] = ['draft', 'private', 'pending', 'rejected', 'archived']
  it.each(NOT_PUBLIC)('other users cannot read %s recipes', (status) => {
    expect(canReadRecipe(OWNER, status, OTHER)).toBe(false)
  })
})

// ── canMutateRecipe ────────────────────────────────────────────────────────────

describe('canMutateRecipe', () => {
  it('allows owner to mutate', () => {
    expect(canMutateRecipe(OWNER, OWNER)).toBe(true)
  })
  it('blocks other users from mutating', () => {
    expect(canMutateRecipe(OWNER, OTHER)).toBe(false)
  })
})

// ── isFreelyEditable ──────────────────────────────────────────────────────────

describe('isFreelyEditable', () => {
  it.each(['draft', 'private', 'rejected'] as RecipeStatus[])('%s is freely editable', (s) => {
    expect(isFreelyEditable(s)).toBe(true)
  })
  it.each(['pending', 'published', 'archived'] as RecipeStatus[])('%s is NOT freely editable', (s) => {
    expect(isFreelyEditable(s)).toBe(false)
  })
})

// ── requiresReviseOnEdit ──────────────────────────────────────────────────────

describe('requiresReviseOnEdit', () => {
  it.each(['pending', 'published'] as RecipeStatus[])('%s requires revise flag', (s) => {
    expect(requiresReviseOnEdit(s)).toBe(true)
  })
  it.each(['draft', 'private', 'rejected', 'archived'] as RecipeStatus[])('%s does NOT require revise', (s) => {
    expect(requiresReviseOnEdit(s)).toBe(false)
  })
})

// ── canHardDelete ─────────────────────────────────────────────────────────────

describe('canHardDelete', () => {
  it.each(['draft', 'private', 'rejected', 'pending'] as RecipeStatus[])(
    'owner can hard-delete %s recipe',
    (s) => { expect(canHardDelete(s)).toBe(true) },
  )
  it.each(['published', 'archived'] as RecipeStatus[])(
    'owner cannot hard-delete %s recipe',
    (s) => { expect(canHardDelete(s)).toBe(false) },
  )
})

// ── status transition rules (documented invariants) ───────────────────────────

describe('status transition invariants', () => {
  it('draft → pending requires sharingConsent (enforced in submit route, not access lib)', () => {
    // Submittable statuses: draft, private, rejected
    const submittable: RecipeStatus[] = ['draft', 'private', 'rejected']
    const notSubmittable: RecipeStatus[] = ['pending', 'published', 'archived']
    // isFreelyEditable covers the submittable states; requiresReviseOnEdit covers the locked ones
    submittable.forEach((s) => expect(isFreelyEditable(s)).toBe(true))
    notSubmittable.forEach((s) => expect(isFreelyEditable(s)).toBe(false))
  })

  it('published recipes require revise=true to edit — prevents silent modifications', () => {
    expect(requiresReviseOnEdit('published')).toBe(true)
  })

  it('published recipes cannot be hard-deleted by owner — must go through moderation', () => {
    expect(canHardDelete('published')).toBe(false)
    expect(canHardDelete('archived')).toBe(false)
  })
})
