import { describe, it, expect } from 'vitest'
import { formatDuration } from '@/lib/training/format'

describe('formatDuration', () => {
  it('formats zero seconds as 0m', () => {
    expect(formatDuration(0)).toBe('0m')
  })

  it('formats sub-hour durations in minutes', () => {
    expect(formatDuration(60)).toBe('1m')
    expect(formatDuration(2700)).toBe('45m')
    expect(formatDuration(3540)).toBe('59m')
  })

  it('formats exactly 1 hour', () => {
    expect(formatDuration(3600)).toBe('1h 0m')
  })

  it('formats hours with remainder minutes', () => {
    expect(formatDuration(3660)).toBe('1h 1m')
    expect(formatDuration(5400)).toBe('1h 30m')
    expect(formatDuration(9000)).toBe('2h 30m')
  })

  it('formats multi-hour durations', () => {
    expect(formatDuration(7200)).toBe('2h 0m')
    expect(formatDuration(7260)).toBe('2h 1m')
  })

  it('rounds down to whole minutes', () => {
    // 90 seconds → 1m (floor 1.5min)
    expect(formatDuration(90)).toBe('1m')
    // 3659 seconds → floor(60.98) = 60min → 1h 0m (crosses the hour boundary)
    expect(formatDuration(3659)).toBe('1h 0m')
  })
})
