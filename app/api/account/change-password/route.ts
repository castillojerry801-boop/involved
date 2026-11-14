import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { getUser, createClient } from '@/lib/supabase/server'

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
  if (newPassword.length < 8) {
    return NextResponse.json({ error: 'New password must be at least 8 characters' }, { status: 400 })
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
    return NextResponse.json({ error: 'Failed to update password. Please try again.' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
