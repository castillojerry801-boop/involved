/**
 * Deterministic compliance tests for Apple App Store Guideline 1.4.1 (health citations)
 * and Guideline 2.3.10 (accurate metadata / no Android-only promotion).
 *
 * No DB, no AI calls, no network requests.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const root = resolve(__dirname, '..')

function read(rel: string) {
  return readFileSync(resolve(root, rel), 'utf8')
}

// ── OG image: no Android-only promotional text ────────────────────────────────

describe('OG image — Guideline 2.3.10', () => {
  const src = read('app/opengraph-image.tsx')

  it('does not contain "Free on Android" (Android-only promotional copy)', () => {
    expect(src).not.toContain('Free on Android')
  })

  it('contains symmetric "iOS & Android" or "iOS and Android" copy', () => {
    const hasSymmetric = src.includes('iOS') && (src.includes('Android') || src.includes('android'))
    expect(hasSymmetric).toBe(true)
  })
})

// ── CalculatorSources component structure ─────────────────────────────────────

describe('CalculatorSources component — Guideline 1.4.1', () => {
  const src = read('components/calculators/calculator-sources.tsx')

  it('renders a collapsible sources element', () => {
    expect(src).toContain('<details')
    expect(src).toContain('<summary')
  })

  it('renders source links as anchor tags opening in new tab', () => {
    expect(src).toContain('target="_blank"')
    expect(src).toContain('rel="noopener noreferrer"')
  })

  it('accepts a sources prop array', () => {
    expect(src).toContain('sources: Source[]')
  })
})

// ── All 6 calculators use CalculatorSources ───────────────────────────────────

describe('Calculator pages include CalculatorSources — Guideline 1.4.1', () => {
  const calculators = [
    'app/(app)/calculators/tdee/page.tsx',
    'app/(app)/calculators/heart-rate-zones/page.tsx',
    'app/(app)/calculators/weight-goal/page.tsx',
    'app/(app)/calculators/pace/page.tsx',
    'app/(app)/calculators/macros/page.tsx',
    'app/(app)/calculators/one-rep-max/page.tsx',
  ]

  for (const path of calculators) {
    it(`${path.split('/').at(-2)} calculator imports and renders CalculatorSources`, () => {
      const src = read(path)
      expect(src).toContain('CalculatorSources')
    })
  }
})

// ── Calculator source URLs are real (not fabricated) ─────────────────────────

describe('Calculator source URLs use authoritative domains', () => {
  const paths = [
    'app/(app)/calculators/tdee/page.tsx',
    'app/(app)/calculators/heart-rate-zones/page.tsx',
    'app/(app)/calculators/weight-goal/page.tsx',
    'app/(app)/calculators/pace/page.tsx',
    'app/(app)/calculators/macros/page.tsx',
    'app/(app)/calculators/one-rep-max/page.tsx',
  ]

  const TRUSTED_DOMAINS = [
    'pubmed.ncbi.nlm.nih.gov',
    'ncbi.nlm.nih.gov/pmc',
    'heart.org',
    'ahajournals.org',
    'cdc.gov',
    'acsm.org',
    'health.gov',
    'nal.usda.gov',
    'jstor.org',
    'sciencedirect.com',
    'journals.lww.com',
    'nsca.com',
  ]

  for (const path of paths) {
    it(`${path.split('/').at(-2)}: all hrefs point to trusted authoritative domains`, () => {
      const src = read(path)
      const hrefMatches = [...src.matchAll(/href:\s*'(https?:\/\/[^']+)'/g)].map(m => m[1])
      // Only check https hrefs inside source arrays (skip navigation hrefs like /settings)
      const sourceHrefs = hrefMatches.filter(h => h.startsWith('https://'))
      expect(sourceHrefs.length).toBeGreaterThan(0)
      for (const href of sourceHrefs) {
        const trusted = TRUSTED_DOMAINS.some(d => href.includes(d))
        expect(trusted, `Untrusted domain in ${path}: ${href}`).toBe(true)
      }
    })
  }
})

// ── NSCA URL replaced with accessible journals.lww.com link ──────────────────

describe('1RM calculator — NSCA URL corrected', () => {
  const src = read('app/(app)/calculators/one-rep-max/page.tsx')

  it('does not use the NSCA member-paywalled article URL', () => {
    expect(src).not.toContain('nsca.com/education/articles/kinetic-select/testing-and-evaluation-of-strength')
  })

  it('uses the publicly accessible journals.lww.com ACSM/NSCA roundtable instead', () => {
    expect(src).toContain('journals.lww.com')
  })
})

// ── Coach V research panel component ─────────────────────────────────────────

describe('CoachResearchPanel — Guideline 1.4.1', () => {
  const src = read('components/v/CoachResearchPanel.tsx')

  it('exports CoachResearchPanel component', () => {
    expect(src).toContain('export function CoachResearchPanel')
  })

  it('includes all 6 required source categories', () => {
    expect(src).toContain('Caloric needs')
    expect(src).toContain('Protein recommendations')
    expect(src).toContain('Resistance training')
    expect(src).toContain('Heart rate training zones')
    expect(src).toContain('Recovery')
    expect(src).toMatch(/[Pp]hysical activity guidelines/)
  })

  it('includes PubMed citations for caloric needs and protein', () => {
    expect(src).toContain('pubmed.ncbi.nlm.nih.gov/2305711')
    expect(src).toContain('pubmed.ncbi.nlm.nih.gov/26891166')
  })

  it('includes AHA heart rate source', () => {
    expect(src).toContain('heart.org')
  })

  it('includes HHS physical activity guidelines', () => {
    expect(src).toContain('health.gov')
  })

  it('includes a disclaimer distinguishing fitness guidance from medical advice', () => {
    expect(src).toMatch(/not medical diagnosis|not a substitute for.*medical|consult.*healthcare/i)
  })

  it('provides an onClose prop for dismissal', () => {
    expect(src).toContain('onClose')
  })
})

// ── Coach page wires up the research panel ────────────────────────────────────

describe('Coach page — research panel integration', () => {
  const src = read('app/(app)/coach/page.tsx')

  it('imports CoachResearchPanel', () => {
    expect(src).toContain("from '@/components/v/CoachResearchPanel'")
  })

  it('renders CoachResearchPanel conditionally', () => {
    expect(src).toContain('CoachResearchPanel')
    expect(src).toContain('showResearch')
  })

  it('has an Info icon button in the header', () => {
    expect(src).toContain('Info')
    expect(src).toContain('setShowResearch(true)')
  })
})

// ── Landing page — no Android-only promotional text ───────────────────────────

describe('Landing page Android references — Guideline 2.3.10', () => {
  const src = read('app/(marketing)/page.tsx')

  it('does not contain hard-coded Android-only promotional anchor tags', () => {
    // Should not have direct <a href="play.google.com"> — only the platform-aware component
    expect(src).not.toMatch(/<a[^>]+href[^>]*play\.google/i)
  })

  it('uses platform-aware AndroidHeroBadge component', () => {
    expect(src).toContain('AndroidHeroBadge')
  })

  it('uses platform-aware AndroidFooterLink component', () => {
    expect(src).toContain('AndroidFooterLink')
  })

  it('metadata description mentions both platforms, not Android-only', () => {
    // The description should say "iOS and Android" not just "for Android"
    expect(src).not.toContain("'Free fitness app for Android'")
    expect(src).not.toContain('"Free fitness app for Android"')
  })
})

// ── AndroidDownloadLink component suppresses on iOS ───────────────────────────

describe('AndroidDownloadLink — platform detection', () => {
  const src = read('components/marketing/AndroidDownloadLink.tsx')

  it('exports AndroidHeroBadge', () => {
    expect(src).toContain('AndroidHeroBadge')
  })

  it('exports AndroidFooterLink', () => {
    expect(src).toContain('AndroidFooterLink')
  })

  it('uses platform detection to suppress on iOS', () => {
    // Uses Capacitor platform check or equivalent
    expect(src).toMatch(/platform|getPlatform|ios/i)
  })

  it('returns null or hides content on iOS', () => {
    expect(src).toMatch(/=== ['"]ios['"]|platform.*ios/i)
  })
})
