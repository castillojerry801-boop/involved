import type { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      disallow: [
        '/api/',
        '/today',
        '/training/',
        '/nutrition/',
        '/health/',
        '/coach/',
        '/goals/',
        '/progress/',
        '/profile/',
        '/settings/',
        '/recipes/',
        '/calculators/',
        '/admin/',
        '/trainer/',
        '/onboarding/',
        '/login',
        '/signup',
        '/invite/',
        '/plus/',
        '/auth/',
      ],
    },
    sitemap: 'https://www.involvedfit.com/sitemap.xml',
  }
}
