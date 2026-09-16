'use client'

import { useState, useEffect } from 'react'
import Image from 'next/image'

// Drop additional background photos into /public/backgrounds/ and add their paths here.
// All images are rendered in grayscale automatically.
const IMAGES = [
  '/backgrounds/bg-1.jpg',
  '/backgrounds/bg-2.jpg',
  '/backgrounds/bg-3.jpg',
]

const INTERVAL_MS = 12000
const FADE_MS = 2000

export function BackgroundCarousel() {
  const [current, setCurrent] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrent(c => (c + 1) % IMAGES.length)
    }, INTERVAL_MS)
    return () => clearInterval(timer)
  }, [])

  return (
    <div className="fixed inset-0 -z-10 overflow-hidden">
      {IMAGES.map((src, i) => (
        <div
          key={src}
          className="absolute inset-0 transition-opacity"
          style={{
            transitionDuration: `${FADE_MS}ms`,
            opacity: i === current ? 1 : 0,
          }}
        >
          <Image
            src={src}
            alt=""
            fill
            className="object-cover grayscale"
            priority={i === 0}
            sizes="100vw"
          />
        </div>
      ))}
      {/* Overlay — lighter in light mode, darker in dark mode */}
      <div className="absolute inset-0 bg-white/40 dark:bg-black/65" />
    </div>
  )
}
