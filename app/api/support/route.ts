import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { resend, FROM_EMAIL } from '@/lib/email'

const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL ?? 'support@involvedfit.com'

// In-memory IP rate limit: 3 submissions per IP per 10 min.
// Resets on cold start — acceptable for a low-volume support form.
// Replace with Redis/Upstash if higher volume is needed.
const submissions = new Map<string, number[]>()
const LIMIT = 3
const WINDOW = 10 * 60 * 1000

function isRateLimited(ip: string): boolean {
  const now = Date.now()
  const prev = (submissions.get(ip) ?? []).filter(t => now - t < WINDOW)
  if (prev.length >= LIMIT) return true
  submissions.set(ip, [...prev, now])
  return false
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function POST(request: NextRequest) {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'

  if (isRateLimited(ip)) {
    return NextResponse.json(
      { error: 'Too many requests. Please wait a few minutes and try again.' },
      { status: 429 }
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  const { name, email, category, message } = body as Record<string, string>

  if (!name?.trim() || !email?.trim() || !message?.trim()) {
    return NextResponse.json(
      { error: 'Name, email, and message are required.' },
      { status: 400 }
    )
  }
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json(
      { error: 'Please provide a valid email address.' },
      { status: 400 }
    )
  }
  if (name.length > 200 || message.length > 5000) {
    return NextResponse.json({ error: 'Input too long.' }, { status: 400 })
  }

  const safeCategory = category?.trim() || 'General'

  const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">
        <tr><td align="center" style="padding-bottom:24px;">
          <p style="margin:0;color:#52525b;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;font-weight:600;">Involved Support</p>
        </td></tr>
        <tr><td style="background:#111111;border:1px solid #27272a;border-radius:20px;padding:36px;">
          <p style="margin:0 0 4px;color:#71717a;font-size:12px;text-transform:uppercase;letter-spacing:0.08em;">New Support Request</p>
          <h2 style="margin:0 0 24px;color:#ffffff;font-size:20px;font-weight:700;">${safeCategory}</h2>
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="padding-bottom:12px;">
                <p style="margin:0 0 2px;color:#71717a;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;">From</p>
                <p style="margin:0;color:#e4e4e7;font-size:14px;">${escapeHtml(name)} &lt;${escapeHtml(email)}&gt;</p>
              </td>
            </tr>
            <tr>
              <td style="padding-bottom:24px;">
                <p style="margin:0 0 2px;color:#71717a;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;">Message</p>
                <p style="margin:0;color:#a1a1aa;font-size:14px;line-height:1.6;white-space:pre-wrap;">${escapeHtml(message)}</p>
              </td>
            </tr>
          </table>
          <hr style="margin:0 0 20px;border:none;border-top:1px solid #27272a;" />
          <p style="margin:0;color:#52525b;font-size:12px;">Reply to this email to respond directly to ${escapeHtml(name)}.</p>
        </td></tr>
        <tr><td align="center" style="padding-top:20px;">
          <p style="margin:0;color:#3f3f46;font-size:12px;">Involved · involvedfit.com</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`

  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to: SUPPORT_EMAIL,
      replyTo: email,
      subject: `[Support] ${safeCategory} — ${name}`,
      html,
    })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json(
      { error: 'Failed to send your message. Please try again.' },
      { status: 500 }
    )
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}
