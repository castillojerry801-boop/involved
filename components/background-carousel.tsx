'use client'

import { useState, useEffect } from 'react'
import Image from 'next/image'

// Drop additional background photos into /public/backgrounds/ and add their paths here.
// All images are rendered in grayscale automatically.
const IMAGES: { src: string; position?: string; scale?: number }[] = [
  { src: '/backgrounds/bg-1.jpg' },
  { src: '/backgrounds/bg-2.jpg' },
  { src: '/backgrounds/bg-3.jpg', position: 'center top' },              // deadlift — anchored to top so head stays visible
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
      {IMAGES.map(({ src, position, scale }, i) => (
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
            style={{
              objectPosition: position ?? 'center',
              transform: scale ? `scale(${scale})` : undefined,
              transformOrigin: 'center',
            }}
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
