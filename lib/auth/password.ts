// NIST SP 800-63B: minimum length is the most effective single control.
// No complexity requirements — any character is valid, passphrases are encouraged.
export const MIN_PASSWORD_LENGTH = 15

export function validatePassword(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters. Try a passphrase — a few words together work great.`
  }
  return null
}
