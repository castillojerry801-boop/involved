import { ImageResponse } from 'next/og'

export const runtime = 'edge'
export const alt = 'Involved — Workout Tracker, Calorie Counter & AI Fitness Coach'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          background: '#09090b',
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '60px',
          position: 'relative',
        }}
      >
        {/* Emerald glow */}
        <div
          style={{
            position: 'absolute',
            width: '500px',
            height: '500px',
            borderRadius: '50%',
            background: 'rgba(16, 185, 129, 0.12)',
            filter: 'blur(100px)',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
          }}
        />

        {/* Wordmark */}
        <div
          style={{
            fontSize: 108,
            fontWeight: 900,
            letterSpacing: '-4px',
            lineHeight: 1,
            marginBottom: 28,
            display: 'flex',
            color: 'white',
          }}
        >
          <span>INVOL</span>
          <span style={{ color: '#10b981' }}>V</span>
          <span>ED</span>
        </div>

        {/* Feature strip */}
        <div
          style={{
            fontSize: 26,
            color: '#a1a1aa',
            letterSpacing: '0.5px',
            marginBottom: 32,
          }}
        >
          Workouts · Calories · Barcode Scanner · AI Coach
        </div>

        {/* Badge */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            border: '1px solid rgba(16, 185, 129, 0.3)',
            borderRadius: '999px',
            padding: '8px 20px',
            background: 'rgba(16, 185, 129, 0.08)',
          }}
        >
          <span style={{ fontSize: 18, color: '#10b981', fontWeight: 700 }}>
            Free on iOS &amp; Android
          </span>
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  )
}
