import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const { token } = await req.json() as { token?: string }

  if (!token) {
    return NextResponse.json({ success: false, error: 'Missing token' }, { status: 400 })
  }

  // Skip verification in development — Cloudflare rejects localhost tokens
  if (process.env.NODE_ENV === 'development') {
    return NextResponse.json({ success: true })
  }

  const secret = process.env.TURNSTILE_SECRET_KEY
  if (!secret) {
    console.warn('TURNSTILE_SECRET_KEY is not set — skipping bot check')
    return NextResponse.json({ success: true })
  }

  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret, response: token }),
  })

  const data = await res.json() as { success: boolean; 'error-codes'?: string[] }

  if (!data.success) {
    console.warn('Turnstile verification failed:', data['error-codes'])
    return NextResponse.json({ success: false, error: 'Bot check failed' }, { status: 403 })
  }

  return NextResponse.json({ success: true })
}
