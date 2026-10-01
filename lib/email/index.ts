import 'server-only'
import { Resend } from 'resend'

// Lazy singleton — avoids throwing at module evaluation time in environments
// where RESEND_API_KEY is not set (e.g. Vercel preview branches without secrets).
let _resend: Resend | undefined
export const resend: Resend = new Proxy({} as Resend, {
  get(_, prop: string | symbol) {
    if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY)
    return (_resend as unknown as Record<string | symbol, unknown>)[prop]
  },
})

export const FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? 'Involved <noreply@involvedfit.com>'
export const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://involvedfit.com'
