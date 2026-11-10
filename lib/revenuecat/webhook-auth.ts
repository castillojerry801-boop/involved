import { createHmac, timingSafeEqual } from 'crypto'

// RC HMAC-SHA256 signing: X-RevenueCat-Webhook-Signature: t=<timestamp>,v1=<hmac_sha256_hex>
// Message: "<timestamp>.<raw_json_body>"
// Timestamp must be within 5 minutes of now to prevent replay attacks.

const TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000

/**
 * Verify a RevenueCat webhook request.
 *
 * Authentication policy:
 *   - If REVENUECAT_WEBHOOK_SECRET is configured, the Authorization header is
 *     required and must match on every request.
 *   - If REVENUECAT_WEBHOOK_SIGNING_SECRET is configured, the HMAC signature
 *     header is additionally required and must be valid.
 *   - Both checks must pass when both env vars are set.
 *   - If neither env var is set, all requests are rejected (misconfiguration guard).
 *
 * This "AND" design prevents bypassing HMAC by supplying only the simpler
 * Authorization credential when both methods are configured.
 */
export function verifyRevenueCatSignature(
  rawBody: string,
  signatureHeader: string | null,
  authHeader: string | null,
  options?: { nowMs?: number },
): boolean {
  const now = options?.nowMs ?? Date.now()

  const webhookSecret = process.env.REVENUECAT_WEBHOOK_SECRET
  const signingSecret = process.env.REVENUECAT_WEBHOOK_SIGNING_SECRET

  // Fail closed if no authentication method is configured
  if (!webhookSecret && !signingSecret) return false

  // Authorization header is required when REVENUECAT_WEBHOOK_SECRET is configured.
  // A missing or invalid header fails the entire request — does not fall through.
  if (webhookSecret) {
    if (!authHeader || !verifyAuthHeader(authHeader, webhookSecret)) return false
  }

  // HMAC signature is additionally required when REVENUECAT_WEBHOOK_SIGNING_SECRET
  // is configured. A missing or invalid signature fails the entire request.
  if (signingSecret) {
    if (!signatureHeader || !verifyHmac(rawBody, signatureHeader, signingSecret, now)) return false
  }

  return true
}

function verifyHmac(
  rawBody: string,
  signatureHeader: string,
  signingSecret: string,
  now: number,
): boolean {
  // Parse: t=<timestamp>,v1=<hex>
  const parts: Record<string, string> = {}
  for (const part of signatureHeader.split(',')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    parts[part.slice(0, eq).trim()] = part.slice(eq + 1).trim()
  }

  const timestampStr = parts['t']
  const signature = parts['v1']
  if (!timestampStr || !signature) return false

  const timestamp = parseInt(timestampStr, 10)
  if (!Number.isFinite(timestamp)) return false

  // Reject events older than 5 minutes or more than 5 minutes in the future
  const timestampMs = timestamp * 1000
  if (Math.abs(now - timestampMs) > TIMESTAMP_TOLERANCE_MS) return false

  const message = `${timestamp}.${rawBody}`
  const expected = createHmac('sha256', signingSecret)
    .update(message, 'utf8')
    .digest('hex')

  // Constant-time comparison to prevent timing attacks
  try {
    const expectedBuf = Buffer.from(expected, 'hex')
    const receivedBuf = Buffer.from(signature, 'hex')
    if (expectedBuf.length !== receivedBuf.length) return false
    return timingSafeEqual(expectedBuf, receivedBuf)
  } catch {
    return false
  }
}

function verifyAuthHeader(authHeader: string, webhookSecret: string): boolean {
  const prefix = 'Bearer '
  const token = authHeader.startsWith(prefix)
    ? authHeader.slice(prefix.length)
    : authHeader

  try {
    const tokenBuf = Buffer.from(token)
    const secretBuf = Buffer.from(webhookSecret)
    if (tokenBuf.length !== secretBuf.length) return false
    return timingSafeEqual(tokenBuf, secretBuf)
  } catch {
    return false
  }
}
