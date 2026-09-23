import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.involved.app',
  appName: 'Involved',
  webDir: 'out',
  server: {
    // Production: set CAPACITOR_SERVER_URL to your Vercel deployment URL
    // Development: http://localhost:3000
    url: process.env.CAPACITOR_SERVER_URL || 'http://localhost:3000',
    cleartext: false,
    androidScheme: 'https',
  },
  ios: {
    contentInset: 'always',
    scrollEnabled: true,
    limitsNavigationsToAppBoundDomains: true,
  },
}

export default config
