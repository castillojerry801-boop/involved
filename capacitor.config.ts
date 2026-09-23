import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.involved.app',
  appName: 'Involved',
  webDir: 'out',
  server: {
    url: process.env.CAPACITOR_SERVER_URL || 'https://www.involvedfit.com',
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
