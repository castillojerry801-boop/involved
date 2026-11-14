import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { getUser, createClient } from '@/lib/supabase/server'
import { validatePassword } from '@/lib/auth/password'

export async function POST(req: NextRequest) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!user.email) return NextResponse.json({ error: 'Account has no email address' }, { status: 400 })

  const { currentPassword, newPassword } = await req.json() as {
    currentPassword?: string
    newPassword?: string
  }

  if (!currentPassword || !newPassword) {
    return NextResponse.json({ error: 'Both current and new passwords are required' }, { status: 400 })
  }
  const passwordError = validatePassword(newPassword)
  if (passwordError) {
    return NextResponse.json({ error: passwordError }, { status: 400 })
  }
  if (currentPassword === newPassword) {
    return NextResponse.json({ error: 'New password must be different from the current password' }, { status: 400 })
  }

  const supabase = await createClient()

  // Verify current password before allowing the change.
  // signInWithPassword refreshes the session in the cookie store on success.
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: currentPassword,
  })

  if (signInError) {
    return NextResponse.json({ error: 'Current password is incorrect' }, { status: 401 })
  }

  const { error: updateError } = await supabase.auth.updateUser({ password: newPassword })

  if (updateError) {
    const reasons = (updateError as { reasons?: string[] }).reasons
    const isBreached =
      reasons?.includes('breached') === true ||
      updateError.message.toLowerCase().includes('breach') ||
      updateError.message.toLowerCase().includes('compromised')
    if (isBreached) {
      return NextResponse.json(
        { error: 'This password has appeared in a known data breach. Please choose a different password.' },
        { status: 422 }
      )
    }
    return NextResponse.json({ error: 'Failed to update password. Please try again.' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
