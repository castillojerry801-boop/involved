import 'server-only'
import { resend, FROM_EMAIL, APP_URL } from './index'

interface SendTrainerInviteOptions {
  toEmail: string
  trainerName: string
  token: string
  expiresAt: Date
}

export async function sendTrainerInvite({
  toEmail,
  trainerName,
  token,
  expiresAt,
}: SendTrainerInviteOptions) {
  const inviteUrl = `${APP_URL}/invite/${token}`
  const expireDate = expiresAt.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  })

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">

          <!-- Logo -->
          <tr>
            <td align="center" style="padding-bottom:32px;">
              <img src="${APP_URL}/icon.jpg" width="48" height="48" alt="Involved" style="border-radius:12px;display:block;" />
              <p style="margin:10px 0 0;color:#52525b;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;font-weight:600;">Involved</p>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background:#111111;border:1px solid #27272a;border-radius:20px;padding:40px 36px;">

              <p style="margin:0 0 8px;color:#71717a;font-size:13px;text-transform:uppercase;letter-spacing:0.08em;font-weight:600;">You've been invited</p>
              <h1 style="margin:0 0 16px;color:#ffffff;font-size:26px;font-weight:800;line-height:1.2;">
                ${trainerName} wants to train you
              </h1>
              <p style="margin:0 0 32px;color:#a1a1aa;font-size:15px;line-height:1.6;">
                Your trainer has invited you to connect on <strong style="color:#ffffff;">Involved</strong> — AI-powered fitness tracking, personalized programming, and direct coach communication, all in one place.
              </p>

              <!-- CTA -->
              <table cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td align="center">
                    <a href="${inviteUrl}" style="display:inline-block;background:#10b981;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:14px 36px;border-radius:12px;letter-spacing:0.01em;">
                      Accept Invitation
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Divider -->
              <hr style="margin:32px 0;border:none;border-top:1px solid #27272a;" />

              <!-- Link fallback -->
              <p style="margin:0 0 6px;color:#71717a;font-size:12px;">Or copy this link into your browser:</p>
              <p style="margin:0 0 24px;word-break:break-all;">
                <a href="${inviteUrl}" style="color:#10b981;font-size:12px;text-decoration:none;">${inviteUrl}</a>
              </p>

              <p style="margin:0;color:#52525b;font-size:12px;">
                This invitation expires <strong style="color:#71717a;">${expireDate}</strong>. If you weren't expecting this, you can safely ignore it.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top:24px;">
              <p style="margin:0;color:#3f3f46;font-size:12px;">Involved · involvedfit.com</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`

  return resend.emails.send({
    from: FROM_EMAIL,
    to: toEmail,
    subject: `${trainerName} invited you to Involved`,
    html,
  })
}
