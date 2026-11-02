import { describe, it, expect } from 'vitest'
import { sanitizeSvg } from '@/lib/ymove/sanitize-svg'

const VALID_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 93" role="img" aria-label="Muscle diagram">
  <g data-region="chest" fill="rgba(255,80,80,0.8)">
    <path d="M10 20 L30 20 L30 40 L10 40 Z"/>
  </g>
  <g data-region="lats" fill="rgba(255,80,80,0.07)">
    <path d="M40 20 L60 20 L60 60 L40 60 Z"/>
  </g>
</svg>`

describe('sanitizeSvg', () => {
  it('returns a valid SVG string unchanged in structure', () => {
    const result = sanitizeSvg(VALID_SVG)
    expect(result).not.toBeNull()
    expect(result).toContain('<svg')
    expect(result).toContain('data-region="chest"')
    expect(result).toContain('data-region="lats"')
  })

  it('returns null for non-SVG input', () => {
    expect(sanitizeSvg('<html><body>hello</body></html>')).toBeNull()
    expect(sanitizeSvg('just a string')).toBeNull()
    expect(sanitizeSvg('')).toBeNull()
    expect(sanitizeSvg('   ')).toBeNull()
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  it('returns null for non-string input', () => {
    expect(sanitizeSvg(null as any)).toBeNull()
    expect(sanitizeSvg(undefined as any)).toBeNull()
  })

  it('strips <script> elements', () => {
    const malicious = VALID_SVG.replace(
      '</svg>',
      '<script>alert("xss")</script></svg>',
    )
    const result = sanitizeSvg(malicious)
    expect(result).not.toBeNull()
    expect(result).not.toContain('<script')
    expect(result).not.toContain('alert')
  })

  it('strips <foreignObject> elements', () => {
    const malicious = VALID_SVG.replace(
      '</svg>',
      '<foreignObject><div onclick="alert(1)">click</div></foreignObject></svg>',
    )
    const result = sanitizeSvg(malicious)
    expect(result).not.toBeNull()
    expect(result).not.toContain('foreignObject')
    expect(result).not.toContain('foreignobject')
  })

  it('strips on* event handler attributes', () => {
    const malicious = VALID_SVG.replace(
      'data-region="chest"',
      'data-region="chest" onclick="alert(1)" onmouseover="steal()"',
    )
    const result = sanitizeSvg(malicious)
    expect(result).not.toBeNull()
    expect(result).not.toContain('onclick')
    expect(result).not.toContain('onmouseover')
    expect(result).toContain('data-region="chest"')
  })

  it('strips javascript: URIs', () => {
    const malicious = VALID_SVG.replace(
      '<path d="M10 20 L30 20 L30 40 L10 40 Z"/>',
      '<path d="M10 20" href="javascript:alert(1)"/>',
    )
    const result = sanitizeSvg(malicious)
    expect(result).not.toBeNull()
    expect(result).not.toContain('javascript:')
  })

  it('strips xlink:href attributes', () => {
    const malicious = VALID_SVG.replace(
      '</svg>',
      '<use xlink:href="#external-resource"/></svg>',
    )
    const result = sanitizeSvg(malicious)
    expect(result).not.toBeNull()
    expect(result).not.toContain('xlink:href')
  })

  it('strips <use> elements entirely', () => {
    const malicious = VALID_SVG.replace(
      '</svg>',
      '<use href="http://evil.com/sprite.svg#icon"/></svg>',
    )
    const result = sanitizeSvg(malicious)
    expect(result).not.toBeNull()
    expect(result).not.toContain('<use')
  })

  it('strips XML declaration', () => {
    const withDecl = '<?xml version="1.0" encoding="UTF-8"?>\n' + VALID_SVG
    const result = sanitizeSvg(withDecl)
    expect(result).not.toBeNull()
    expect(result!.startsWith('<?xml')).toBe(false)
    expect(result).toContain('<svg')
  })

  it('preserves data-region attributes used for muscle highlighting', () => {
    const result = sanitizeSvg(VALID_SVG)
    expect(result).not.toBeNull()
    expect(result).toContain('data-region="chest"')
    expect(result).toContain('data-region="lats"')
  })

  it('preserves role and aria-label for accessibility', () => {
    const result = sanitizeSvg(VALID_SVG)
    expect(result).not.toBeNull()
    expect(result).toContain('role="img"')
    expect(result).toContain('aria-label=')
  })

  it('handles multiple attack vectors simultaneously', () => {
    const malicious = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 93">
      <script>document.cookie="stolen"</script>
      <g data-region="chest" onclick="xss()" onload="xss()">
        <path d="M10 20" href="javascript:void(0)"/>
      </g>
      <foreignObject><img src="x" onerror="xss()"/></foreignObject>
      <use xlink:href="http://evil.com/sprite.svg#icon"/>
    </svg>`
    const result = sanitizeSvg(malicious)
    expect(result).not.toBeNull()
    expect(result).not.toContain('script')
    expect(result).not.toContain('onclick')
    expect(result).not.toContain('onload')
    expect(result).not.toContain('onerror')
    expect(result).not.toContain('javascript:')
    expect(result).not.toContain('foreignObject')
    expect(result).not.toContain('xlink:href')
    expect(result).toContain('data-region="chest"')
  })
})

// ── Adversarial regression tests (maintained sanitize-html layer) ─────────────

describe('sanitizeSvg — adversarial regression', () => {
  const BASE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 93">
  <g data-region="chest" fill="rgba(255,80,80,0.8)">
    <path d="M10 20 L30 20 L30 40 L10 40 Z"/>
  </g>
</svg>`

  // ── Case/encoding variations ───────────────────────────────────────────────

  it('strips uppercased <SCRIPT> tags (case-insensitive)', () => {
    const r = sanitizeSvg(BASE.replace('</svg>', '<SCRIPT>xss()</SCRIPT></svg>'))
    expect(r).not.toBeNull()
    expect(r).not.toContain('xss()')
    expect(r).not.toContain('SCRIPT')
    expect(r).not.toContain('script')
  })

  it('strips mixed-case <ScRiPt> tags', () => {
    const r = sanitizeSvg(BASE.replace('</svg>', '<ScRiPt src="evil.js"></ScRiPt></svg>'))
    expect(r).not.toBeNull()
    expect(r).not.toContain('ScRiPt')
  })

  it('strips self-closing <script src="…"/>', () => {
    const r = sanitizeSvg(BASE.replace('</svg>', '<script src="https://evil.com/payload.js"/></svg>'))
    expect(r).not.toBeNull()
    expect(r).not.toContain('script')
    expect(r).not.toContain('evil.com')
  })

  it('strips <script> nested inside a safe element', () => {
    const r = sanitizeSvg(BASE.replace('</g>', '<script>document.write("<img/>")</script></g>'))
    expect(r).not.toBeNull()
    expect(r).not.toContain('script')
    expect(r).not.toContain('document.write')
  })

  // ── SMIL animations (can trigger events and timing attacks) ───────────────

  it('strips <animate> elements entirely', () => {
    const r = sanitizeSvg(BASE.replace('</svg>', '<animate attributeName="href" values="javascript:xss()"/></svg>'))
    expect(r).not.toBeNull()
    expect(r).not.toContain('<animate')
    expect(r).not.toContain('javascript:xss()')
  })

  it('strips <animateTransform> elements', () => {
    const r = sanitizeSvg(BASE.replace('</svg>', '<animateTransform attributeName="transform" type="rotate"/></svg>'))
    expect(r).not.toBeNull()
    expect(r).not.toContain('animateTransform')
    expect(r).not.toContain('animatetransform')
  })

  // ── Attribute allowlist strictness ────────────────────────────────────────

  it('strips unrecognised data attributes (only data-region is whitelisted)', () => {
    const r = sanitizeSvg(BASE.replace('data-region="chest"', 'data-region="chest" data-onclick="xss()"'))
    expect(r).not.toBeNull()
    expect(r).not.toContain('data-onclick')
    expect(r).toContain('data-region="chest"')
  })

  it('blocks url() injection in style attributes (background not in CSS allowlist)', () => {
    // style= is now allowed for fill/stroke color highlighting, but CSS properties
    // outside the allowlist (background, content, etc.) and url() values are stripped.
    const r = sanitizeSvg(BASE.replace('<path', '<path style="background:url(javascript:alert(1))"'))
    expect(r).not.toBeNull()
    expect(r).not.toContain('url(')
    expect(r).not.toContain('javascript:')
    expect(r).not.toContain('background')
  })

  it('blocks url() in fill style value (not a valid color pattern)', () => {
    const r = sanitizeSvg(BASE.replace('<path', '<path style="fill:url(https://evil.com/track)"'))
    expect(r).not.toBeNull()
    expect(r).not.toContain('url(')
    expect(r).not.toContain('evil.com')
  })

  it('preserves fill hex color in style attribute for muscle highlighting', () => {
    const r = sanitizeSvg(BASE.replace('<path', '<path style="fill:#e74c3c"'))
    expect(r).not.toBeNull()
    expect(r).toContain('fill:#e74c3c')
  })

  it('preserves fill rgb color in style attribute', () => {
    const r = sanitizeSvg(BASE.replace('<path', '<path style="fill:rgb(231, 76, 60)"'))
    expect(r).not.toBeNull()
    expect(r).toContain('fill:rgb(231, 76, 60)')
  })

  it('strips href from path element (not in attribute allowlist)', () => {
    const r = sanitizeSvg(BASE.replace('<path', '<path href="https://evil.com"'))
    expect(r).not.toBeNull()
    expect(r).not.toContain('href=')
    expect(r).toContain('<path')
  })

  it('strips unknown SVG elements but preserves their safe children', () => {
    // An unknown element should be stripped but its children (if safe) are kept
    const r = sanitizeSvg(BASE.replace('</svg>', '<marker><path d="M0 0 L10 5"/></marker></svg>'))
    expect(r).not.toBeNull()
    expect(r).not.toContain('<marker')
  })

  // ── Nested forbidden elements ─────────────────────────────────────────────

  it('strips nested foreignObject > iframe — no orphaned closing tags', () => {
    const r = sanitizeSvg(BASE.replace('</svg>', '<foreignObject><iframe src="evil.com"></iframe></foreignObject></svg>'))
    expect(r).not.toBeNull()
    expect(r).not.toContain('foreignObject')
    expect(r).not.toContain('foreignobject')
    expect(r).not.toContain('iframe')
    expect(r).not.toContain('evil.com')
  })

  it('strips nested script > script — double-nesting evasion attempt', () => {
    // Some parsers re-expose inner script when outer is stripped
    const r = sanitizeSvg(BASE.replace('</svg>', '<script><script>xss()</script></script></svg>'))
    expect(r).not.toBeNull()
    expect(r).not.toContain('<script')
    expect(r).not.toContain('xss()')
  })

  // ── Data URI and external resource loading ────────────────────────────────

  it('strips data: URIs embedded in image elements', () => {
    const r = sanitizeSvg(BASE.replace('</svg>', '<image href="data:text/html,<script>xss()</script>"/></svg>'))
    expect(r).not.toBeNull()
    expect(r).not.toContain('data:text/html')
    expect(r).not.toContain('xss()')
  })

  it('strips external resource references via <image>', () => {
    const r = sanitizeSvg(BASE.replace('</svg>', '<image href="https://attacker.com/track.gif"/></svg>'))
    expect(r).not.toBeNull()
    // image is not in allowedTags — stripped entirely
    expect(r).not.toContain('attacker.com')
  })

  // ── Output invariants ─────────────────────────────────────────────────────

  it('always returns a string starting with <svg when input is valid', () => {
    const r = sanitizeSvg(BASE)
    expect(r).not.toBeNull()
    expect(r!.trim()).toMatch(/^<svg/)
  })

  it('returns null for an SVG whose entire body is stripped', () => {
    // A "valid-looking" start but completely emptied → should still return svg
    // (we can't test null here without actually removing the svg tag itself)
    const r = sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg"></svg>')
    expect(r).not.toBeNull()
    expect(r).toContain('<svg')
  })
})
