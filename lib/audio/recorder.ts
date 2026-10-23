const PREFERRED_AUDIO_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
] as const

/**
 * Returns the best audio MIME type the current platform's MediaRecorder supports.
 * Returns '' when MediaRecorder is unavailable (SSR/server context).
 * iOS WKWebView supports audio/mp4; Chrome/Android supports audio/webm.
 */
export function getSupportedAudioMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return ''
  for (const type of PREFERRED_AUDIO_MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(type)) return type
  }
  return ''
}

/**
 * Maps a MIME type string to a file extension for the Whisper API.
 * Falls back to 'mp4' for unknown types — Whisper accepts both webm and mp4.
 */
export function audioMimeTypeToExtension(mimeType: string): 'webm' | 'mp4' {
  return mimeType.startsWith('audio/webm') ? 'webm' : 'mp4'
}
