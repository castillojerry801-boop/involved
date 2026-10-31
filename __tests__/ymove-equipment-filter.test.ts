import { describe, it, expect } from 'vitest'
import {
  filterQueueByEquipment,
  getEquipmentCountMap,
  getSortedEquipmentOptions,
} from '@/lib/ymove/equipment-filter'

// Minimal ReviewerSuggestion shape for filter testing
interface Item { equipment: string; exerciseDbId: string }

function makeItems(specs: Array<{ equipment: string; id: string }>): Item[] {
  return specs.map(s => ({ equipment: s.equipment, exerciseDbId: s.id }))
}

const SAMPLE = makeItems([
  { equipment: 'barbell',          id: 'EX001' },
  { equipment: 'barbell',          id: 'EX002' },
  { equipment: 'dumbbell',         id: 'EX003' },
  { equipment: 'dumbbell',         id: 'EX004' },
  { equipment: 'dumbbell',         id: 'EX005' },
  { equipment: 'body weight',      id: 'EX006' },
  { equipment: 'cable',            id: 'EX007' },
  { equipment: 'leverage machine', id: 'EX008' },
  { equipment: 'band',             id: 'EX009' },
  { equipment: 'smith machine',    id: 'EX010' },
  { equipment: 'kettlebell',       id: 'EX011' },
  { equipment: 'resistance band',  id: 'EX012' },
  { equipment: 'ez barbell',       id: 'EX013' },
])

// ── filterQueueByEquipment ────────────────────────────────────────────────────

describe('filterQueueByEquipment', () => {
  it('returns all items when filter is empty string', () => {
    const result = filterQueueByEquipment(SAMPLE, '')
    expect(result.length).toBe(SAMPLE.length)
  })

  it('filters by barbell exactly', () => {
    const result = filterQueueByEquipment(SAMPLE, 'barbell')
    expect(result.map(i => i.exerciseDbId)).toEqual(['EX001', 'EX002'])
  })

  it('filters by dumbbell exactly', () => {
    const result = filterQueueByEquipment(SAMPLE, 'dumbbell')
    expect(result.map(i => i.exerciseDbId)).toEqual(['EX003', 'EX004', 'EX005'])
  })

  it('filters by body weight (value with space)', () => {
    const result = filterQueueByEquipment(SAMPLE, 'body weight')
    expect(result.map(i => i.exerciseDbId)).toEqual(['EX006'])
  })

  it('filters by leverage machine (multi-word)', () => {
    const result = filterQueueByEquipment(SAMPLE, 'leverage machine')
    expect(result.map(i => i.exerciseDbId)).toEqual(['EX008'])
  })

  it('filters by cable', () => {
    const result = filterQueueByEquipment(SAMPLE, 'cable')
    expect(result.map(i => i.exerciseDbId)).toEqual(['EX007'])
  })

  it('filters by band (distinct from resistance band)', () => {
    const result = filterQueueByEquipment(SAMPLE, 'band')
    expect(result.map(i => i.exerciseDbId)).toEqual(['EX009'])
  })

  it('filters by resistance band (distinct from band)', () => {
    const result = filterQueueByEquipment(SAMPLE, 'resistance band')
    expect(result.map(i => i.exerciseDbId)).toEqual(['EX012'])
  })

  it('filters by kettlebell', () => {
    const result = filterQueueByEquipment(SAMPLE, 'kettlebell')
    expect(result.map(i => i.exerciseDbId)).toEqual(['EX011'])
  })

  it('filters by smith machine', () => {
    const result = filterQueueByEquipment(SAMPLE, 'smith machine')
    expect(result.map(i => i.exerciseDbId)).toEqual(['EX010'])
  })

  it('filters by ez barbell', () => {
    const result = filterQueueByEquipment(SAMPLE, 'ez barbell')
    expect(result.map(i => i.exerciseDbId)).toEqual(['EX013'])
  })

  it('returns empty array for unknown equipment', () => {
    const result = filterQueueByEquipment(SAMPLE, 'trampoline')
    expect(result).toEqual([])
  })

  it('is case-sensitive — uppercase does not match lowercase DB values', () => {
    const result = filterQueueByEquipment(SAMPLE, 'Barbell')
    expect(result).toEqual([])
  })

  it('returns empty array for empty items list', () => {
    const result = filterQueueByEquipment([], 'barbell')
    expect(result).toEqual([])
  })

  it('preserves order of matching items', () => {
    const items = makeItems([
      { equipment: 'dumbbell', id: 'Z001' },
      { equipment: 'barbell',  id: 'A001' },
      { equipment: 'dumbbell', id: 'A002' },
    ])
    const result = filterQueueByEquipment(items, 'dumbbell')
    expect(result.map(i => i.exerciseDbId)).toEqual(['Z001', 'A002'])
  })
})

// ── getEquipmentCountMap ──────────────────────────────────────────────────────

describe('getEquipmentCountMap', () => {
  it('counts each equipment category correctly', () => {
    const counts = getEquipmentCountMap(SAMPLE)
    expect(counts['barbell']).toBe(2)
    expect(counts['dumbbell']).toBe(3)
    expect(counts['body weight']).toBe(1)
    expect(counts['cable']).toBe(1)
    expect(counts['band']).toBe(1)
    expect(counts['resistance band']).toBe(1)
  })

  it('treats band and resistance band as distinct keys', () => {
    const counts = getEquipmentCountMap(SAMPLE)
    expect(counts['band']).toBe(1)
    expect(counts['resistance band']).toBe(1)
  })

  it('returns empty object for empty array', () => {
    expect(getEquipmentCountMap([])).toEqual({})
  })

  it('handles a single item', () => {
    const result = getEquipmentCountMap([{ equipment: 'kettlebell', exerciseDbId: 'K1' }])
    expect(result).toEqual({ kettlebell: 1 })
  })
})

// ── getSortedEquipmentOptions ─────────────────────────────────────────────────

describe('getSortedEquipmentOptions', () => {
  it('returns options sorted by count descending', () => {
    const options = getSortedEquipmentOptions(SAMPLE)
    const counts = options.map(o => o.count)
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]).toBeLessThanOrEqual(counts[i - 1])
    }
  })

  it('dumbbell (3) ranks above barbell (2)', () => {
    const options = getSortedEquipmentOptions(SAMPLE)
    const dIdx = options.findIndex(o => o.value === 'dumbbell')
    const bIdx = options.findIndex(o => o.value === 'barbell')
    expect(dIdx).toBeLessThan(bIdx)
  })

  it('includes all distinct equipment values from the data', () => {
    const options = getSortedEquipmentOptions(SAMPLE)
    const values = options.map(o => o.value)
    expect(values).toContain('barbell')
    expect(values).toContain('dumbbell')
    expect(values).toContain('body weight')
    expect(values).toContain('cable')
    expect(values).toContain('leverage machine')
    expect(values).toContain('band')
    expect(values).toContain('resistance band')
    expect(values).toContain('smith machine')
    expect(values).toContain('kettlebell')
    expect(values).toContain('ez barbell')
    expect(values.length).toBe(10)
  })

  it('returns correct counts in each option', () => {
    const options = getSortedEquipmentOptions(SAMPLE)
    expect(options.find(o => o.value === 'dumbbell')?.count).toBe(3)
    expect(options.find(o => o.value === 'barbell')?.count).toBe(2)
    expect(options.find(o => o.value === 'cable')?.count).toBe(1)
  })

  it('returns empty array for empty input', () => {
    expect(getSortedEquipmentOptions([])).toEqual([])
  })
})

// ── Equipment + status filtering (combined) ───────────────────────────────────

describe('equipment + status filtering combined', () => {
  interface StatusItem extends Item { queueStatus: string }

  function makeStatusItems(
    specs: Array<{ equipment: string; id: string; status: string }>,
  ): StatusItem[] {
    return specs.map(s => ({ equipment: s.equipment, exerciseDbId: s.id, queueStatus: s.status }))
  }

  const STATUS_SAMPLE = makeStatusItems([
    { equipment: 'barbell',   id: 'EX001', status: 'unmapped'            },
    { equipment: 'barbell',   id: 'EX002', status: 'verified'            },
    { equipment: 'dumbbell',  id: 'EX003', status: 'approved_unverified' },
    { equipment: 'dumbbell',  id: 'EX004', status: 'verified'            },
    { equipment: 'cable',     id: 'EX005', status: 'unmapped'            },
  ])

  it('equipment filter applied after status filter returns correct subset', () => {
    // Simulate: status filter keeps only verified items, then equipment filter for barbell
    const verifiedItems = STATUS_SAMPLE.filter(i => i.queueStatus === 'verified')
    const result = filterQueueByEquipment(verifiedItems, 'barbell')
    expect(result.map(i => i.exerciseDbId)).toEqual(['EX002'])
  })

  it('equipment filter returns empty when no items match both equipment and status', () => {
    const verifiedItems = STATUS_SAMPLE.filter(i => i.queueStatus === 'verified')
    const result = filterQueueByEquipment(verifiedItems, 'cable')
    expect(result).toEqual([])
  })

  it('all dumbbell items found when status not filtered', () => {
    const result = filterQueueByEquipment(STATUS_SAMPLE, 'dumbbell')
    expect(result.map(i => i.exerciseDbId)).toEqual(['EX003', 'EX004'])
  })
})

// ── Queue advancement after filter ────────────────────────────────────────────

describe('queue advancement after decision', () => {
  it('removing a verified item from the full set updates the filtered set', () => {
    const fullQueue = makeItems([
      { equipment: 'barbell', id: 'EX001' },
      { equipment: 'barbell', id: 'EX002' },
      { equipment: 'dumbbell', id: 'EX003' },
    ])

    // Simulate handleDecision({ type: 'verified', exerciseDbId: 'EX001' })
    const updated = fullQueue.filter(i => i.exerciseDbId !== 'EX001')
    const filtered = filterQueueByEquipment(updated, 'barbell')
    expect(filtered.map(i => i.exerciseDbId)).toEqual(['EX002'])
  })

  it('filter persists correctly after multiple decisions', () => {
    let queue = makeItems([
      { equipment: 'barbell', id: 'EX001' },
      { equipment: 'barbell', id: 'EX002' },
      { equipment: 'barbell', id: 'EX003' },
    ])

    queue = queue.filter(i => i.exerciseDbId !== 'EX001')
    let filtered = filterQueueByEquipment(queue, 'barbell')
    expect(filtered.length).toBe(2)

    queue = queue.filter(i => i.exerciseDbId !== 'EX002')
    filtered = filterQueueByEquipment(queue, 'barbell')
    expect(filtered.length).toBe(1)
    expect(filtered[0].exerciseDbId).toBe('EX003')
  })
})

// ── Empty category behavior ───────────────────────────────────────────────────

describe('empty category behavior', () => {
  it('unknown equipment key returns empty array (not an error)', () => {
    expect(() => filterQueueByEquipment(SAMPLE, 'unicycle')).not.toThrow()
    expect(filterQueueByEquipment(SAMPLE, 'unicycle')).toEqual([])
  })

  it('count map returns 0 for unknown key (undefined in map)', () => {
    const counts = getEquipmentCountMap(SAMPLE)
    expect(counts['unicycle']).toBeUndefined()
  })

  it('getSortedEquipmentOptions does not include equipment with 0 items', () => {
    const options = getSortedEquipmentOptions(SAMPLE)
    expect(options.every(o => o.count > 0)).toBe(true)
  })
})
