// Upload exercise GIFs to Supabase Storage
// Run with: node scripts/upload-exercise-gifs.mjs

import { createClient } from '@supabase/supabase-js'
import { readFileSync, readdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

// Load env from .env.local
const envFile = readFileSync(join(ROOT, '.env.local'), 'utf8')
const env = Object.fromEntries(
  envFile.split('\n')
    .filter(l => l && !l.startsWith('#'))
    .map(l => l.split('=').map((v, i) => i === 0 ? v.trim() : v.trim()))
)

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const BUCKET = 'exercise-gifs'
const GIF_DIR = join(ROOT, 'public', 'exercises')

async function main() {
  // 1. Create bucket if it doesn't exist
  console.log(`Creating bucket "${BUCKET}"...`)
  const { error: bucketError } = await supabase.storage.createBucket(BUCKET, {
    public: true,
    allowedMimeTypes: ['image/gif'],
  })
  if (bucketError && !bucketError.message.includes('already exists')) {
    console.error('Bucket error:', bucketError.message)
    process.exit(1)
  }
  console.log('Bucket ready.\n')

  // 2. Get list of GIFs
  const files = readdirSync(GIF_DIR).filter(f => f.endsWith('.gif'))
  console.log(`Found ${files.length} GIFs to upload.\n`)

  // 3. Upload in batches of 10
  const BATCH = 10
  let uploaded = 0
  let skipped = 0
  let failed = 0

  for (let i = 0; i < files.length; i += BATCH) {
    const batch = files.slice(i, i + BATCH)
    await Promise.all(batch.map(async (filename) => {
      const filePath = join(GIF_DIR, filename)
      const data = readFileSync(filePath)

      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(filename, data, {
          contentType: 'image/gif',
          upsert: false,
        })

      if (!error) {
        uploaded++
      } else if (error.message.includes('already exists') || error.message.includes('The resource already exists')) {
        skipped++
      } else {
        console.error(`  ✗ ${filename}: ${error.message}`)
        failed++
      }
    }))

    const done = Math.min(i + BATCH, files.length)
    process.stdout.write(`\rProgress: ${done}/${files.length} — ✓ ${uploaded} uploaded, ↷ ${skipped} skipped, ✗ ${failed} failed`)
  }

  console.log('\n\nDone!')

  // 4. Print the base URL to use
  const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl('0001.gif')
  const baseUrl = publicUrl.replace('/0001.gif', '')
  console.log('\nAdd this to your Vercel environment variables:')
  console.log(`\nNEXT_PUBLIC_EXERCISE_GIF_BASE_URL=${baseUrl}\n`)
  console.log('Also add it to .env.local for local testing against the CDN.')
}

main().catch(console.error)
