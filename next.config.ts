import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Ensure data/ JSON files are bundled in the serverless function output
  // for routes that read them via readFileSync(join(process.cwd(), ...)).
  // Required when using `output: 'standalone'`; a no-op for standard Vercel deploys.
  outputFileTracingIncludes: {
    '/api/admin/ymove-mapping': ['./data/*.json'],
    '/api/admin/ymove-mapping/suggestions': ['./data/*.json'],
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/**',
      },
      {
        protocol: 'https',
        hostname: 'ymove-recipes.b-cdn.net',
      },
    ],
  },
};

export default nextConfig;
