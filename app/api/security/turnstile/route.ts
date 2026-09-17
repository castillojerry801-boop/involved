import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const { token } = await req.json() as { token?: string }

  if (!token) {
    return NextResponse.json({ success: false, error: 'Missing token' }, { status: 400 })
  }

  const secret = process.env.TURNSTILE_SECRET_KEY
  if (!secret) {
    console.error('TURNSTILE_SECRET_KEY is not set')
    return NextResponse.json({ success: false, error: 'Configuration error' }, { status: 500 })
  }

  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret, response: token }),
  })

  const data = await res.json() as { success: boolean; 'error-codes'?: string[] }

  if (!data.success) {
    return NextResponse.json({ success: false }, { status: 403 })
  }

  return NextResponse.json({ success: true })
}
