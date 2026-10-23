/**
 * Unit tests for lib/audio/recorder.ts
 *
 * getSupportedAudioMimeType: runtime MIME detection — prefers webm on Chrome/Android,
 * falls back to mp4 for iOS WKWebView, returns '' in SSR/server context.
 *
 * audioMimeTypeToExtension: maps container format to file extension for Whisper API.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { getSupportedAudioMimeType, audioMimeTypeToExtension } from '../../lib/audio/recorder'

function setMediaRecorder(impl: { isTypeSupported: (t: string) => boolean } | undefined) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any
  if (impl === undefined) {
    g.MediaRecorder = undefined
  } else {
    g.MediaRecorder = impl
  }
}

describe('getSupportedAudioMimeType', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let original: any

  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    original = (globalThis as any).MediaRecorder
  })

  afterEach(() => {
    setMediaRecorder(original)
  })

  it('returns audio/webm;codecs=opus when that type is supported (Chrome/Android)', () => {
    setMediaRecorder({ isTypeSupported: (t: string) => t === 'audio/webm;codecs=opus' })
    expect(getSupportedAudioMimeType()).toBe('audio/webm;codecs=opus')
  })

  it('falls back to audio/webm when codec-specific variant is not supported', () => {
    setMediaRecorder({ isTypeSupported: (t: string) => t === 'audio/webm' })
    expect(getSupportedAudioMimeType()).toBe('audio/webm')
  })

  it('falls back to audio/mp4 for iOS WKWebView (only mp4 supported)', () => {
    setMediaRecorder({ isTypeSupported: (t: string) => t === 'audio/mp4' })
    expect(getSupportedAudioMimeType()).toBe('audio/mp4')
  })

  it('returns empty string when MediaRecorder is not available (SSR)', () => {
    setMediaRecorder(undefined)
    expect(getSupportedAudioMimeType()).toBe('')
  })

  it('returns empty string when no preferred type is supported', () => {
    setMediaRecorder({ isTypeSupported: () => false })
    expect(getSupportedAudioMimeType()).toBe('')
  })

  it('always checks webm variants before mp4 (preference order)', () => {
    const checked: string[] = []
    setMediaRecorder({ isTypeSupported: (t: string) => { checked.push(t); return false } })
    getSupportedAudioMimeType()
    expect(checked.indexOf('audio/webm;codecs=opus')).toBeLessThan(checked.indexOf('audio/mp4'))
    expect(checked.indexOf('audio/webm')).toBeLessThan(checked.indexOf('audio/mp4'))
  })
})

describe('audioMimeTypeToExtension', () => {
  it('maps audio/webm to webm', () => {
    expect(audioMimeTypeToExtension('audio/webm')).toBe('webm')
  })

  it('maps audio/webm;codecs=opus to webm', () => {
    expect(audioMimeTypeToExtension('audio/webm;codecs=opus')).toBe('webm')
  })

  it('maps audio/mp4 to mp4', () => {
    expect(audioMimeTypeToExtension('audio/mp4')).toBe('mp4')
  })

  it('maps empty string to mp4 (safe fallback for Whisper)', () => {
    expect(audioMimeTypeToExtension('')).toBe('mp4')
  })

  it('maps audio/aac to mp4 (mp4 container extension)', () => {
    expect(audioMimeTypeToExtension('audio/aac')).toBe('mp4')
  })

  it('maps audio/ogg to mp4 (non-webm maps to mp4 fallback)', () => {
    expect(audioMimeTypeToExtension('audio/ogg')).toBe('mp4')
  })
})
