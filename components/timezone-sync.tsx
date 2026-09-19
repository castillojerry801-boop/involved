'use client'
import { useEffect } from 'react'

// Runs on the client to write the browser's real timezone into a cookie.
// The server reads this cookie on the next request (preferred over x-vercel-ip-timezone).
export function TimezoneSync() {
  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    document.cookie = `tz=${encodeURIComponent(tz)}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`
  }, [])
  return null
}
