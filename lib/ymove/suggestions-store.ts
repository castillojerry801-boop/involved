import 'server-only'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import type { SuggestionsFile } from './pipeline'

const SUGGESTIONS_PATH = join(process.cwd(), 'data/ymove-suggested-mappings.json')

export function loadSuggestions(): SuggestionsFile | null {
  if (!existsSync(SUGGESTIONS_PATH)) return null
  try {
    const raw  = readFileSync(SUGGESTIONS_PATH, 'utf8')
    const data = JSON.parse(raw) as SuggestionsFile
    if (data.version !== 1 || !Array.isArray(data.suggestions)) return null
    return data
  } catch {
    return null
  }
}
