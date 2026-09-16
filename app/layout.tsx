import type { Metadata, Viewport } from 'next'
import { Geist } from 'next/font/google'
import './globals.css'

const geist = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: {
    default: 'Involved — Real Habits. Real Progress.',
    template: '%s | Involved',
  },
  description: 'The fitness platform built for real people. Training programs, AI coaching, and progress tracking for every goal.',
  applicationName: 'Involved',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${geist.variable} h-full`}>
      <body className="min-h-full bg-zinc-50 dark:bg-zinc-950 antialiased">
        {children}
      </body>
    </html>
  )
}
