import 'server-only'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import type {
  EqFamily,
  MovementClass,
  MovementSubclass,
  ScoredMatch,
  MisclassificationResult,
} from './hierarchy-scorer'

// ── Types matching the pipeline output ───────────────────────────────────────

export interface ProtectedMapping {
  ymoveId:          string
  verifiedAt:       string | null
  source:           string
  sharedWithDbIds:  string[]
  thumbnailMediaId: string | null   // injected by API route from YMove catalog DB
}

export interface ConflictInfo {
  conflictingYmoveId: string
  conflictingDbId:    string
  verifiedAt:         string | null
}

export interface HierarchyExercise {
  exerciseDbId:     string
  name:             string
  equipment:        string
  equipmentFamily:  EqFamily | null
  canonicalId:      string
  canonicalName:    string
  movementFamilyId: string
  technicalPattern: string | null
  movementClass:    MovementClass
  movementSubclass: MovementSubclass
  protected:        ProtectedMapping | null
  misclassified:    MisclassificationResult | null
  protectedConflict: ConflictInfo | null
  topSuggestion:    ScoredMatch | null
  otherSuggestions: ScoredMatch[]
  tier:             string
}

export interface HierarchyL2Node {
  canonicalId:      string
  canonicalName:    string
  movementFamilyId: string
  equipmentFamily:  EqFamily | null
  exercises:        HierarchyExercise[]
  l2Tier:           string
}

export interface HierarchyFileSummary {
  l2NodesTotal:          number
  exercisesInL2Nodes:    number
  protected:             number
  highPriority:          number
  review:                number
  weak:                  number
  unmatched:             number
  misclassified:         number
  needsManualReview:     number
  conflictsWithProtected: number
}

export interface HierarchyFile {
  version:          3
  generatedAt:      string
  metadata:         Record<string, number>
  summary:          HierarchyFileSummary
  l2Nodes:          HierarchyL2Node[]
  misclassifications: unknown[]
  protectedMappings: unknown[]
  orphanedNoCanonical: unknown[]
  orphanedUnknownEq:   unknown[]
}

const HIERARCHY_PATH = join(process.cwd(), 'data/ymove-hierarchy-suggestions.json')

let _cached: HierarchyFile | null | 'not-loaded' = 'not-loaded'

export function loadHierarchySuggestions(): HierarchyFile | null {
  if (_cached !== 'not-loaded') return _cached
  if (!existsSync(HIERARCHY_PATH)) {
    _cached = null
    return null
  }
  try {
    const raw  = readFileSync(HIERARCHY_PATH, 'utf8')
    const data = JSON.parse(raw) as HierarchyFile
    if (data.version !== 3 || !Array.isArray(data.l2Nodes)) {
      _cached = null
      return null
    }
    _cached = data
    return data
  } catch {
    _cached = null
    return null
  }
}

export function invalidateHierarchyCache(): void {
  _cached = 'not-loaded'
}
