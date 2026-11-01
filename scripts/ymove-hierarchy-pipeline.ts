#!/usr/bin/env tsx
/**
 * Read-only hierarchical YMove matching pipeline.
 *
 * Organises the exercise library as:
 *   L1  Movement Family  (fam_squat, fam_arms, …)
 *   L2  Equipment-Specific Exercise  (canonical × equipment family)
 *   L3  Meaningful Variation  (angle / grip / laterality / stance / modifier)
 *
 * SAFETY GUARANTEES
 *   ✓ Zero database writes.  All Prisma calls are SELECT only.
 *   ✓ Zero mapping changes.
 *   ✓ Zero curation changes.
 *   ✓ Deterministic.  Same DB state → same output every run.
 *
 * Output: data/ymove-hierarchy-suggestions.json  (human review required)
 *
 * Usage:
 *   npx tsx scripts/ymove-hierarchy-pipeline.ts
 *   npx tsx scripts/ymove-hierarchy-pipeline.ts --family fam_squat
 *   npx tsx scripts/ymove-hierarchy-pipeline.ts --canonical inv_bench_press
 *   npx tsx scripts/ymove-hierarchy-pipeline.ts --id 0025
 *   npx tsx scripts/ymove-hierarchy-pipeline.ts --report-only
 */

import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { PrismaClient } from '@prisma/client'

// Load .env.local before Prisma instantiation
try {
  const envFile = readFileSync('.env.local', 'utf8')
  for (const line of envFile.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx < 1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '')
    if (key && !(key in process.env)) process.env[key] = val
  }
} catch { /* absent */ }

import {
  type EqFamily,
  type MovementClass,
  type MovementSubclass,
  type CatalogEntry,
  type ExerciseMeta,
  type ScoredMatch,
  type ConflictInfo,
  type MisclassificationResult,
  SCORE_HIGH_PRIORITY,
  SCORE_REVIEW,
  SCORE_WEAK_MIN,
  normalizeExdbEquipment,
  normalizeYmoveEquipment,
  inferEquipmentFromName,
  movementClassFromPattern,
  movementClassFromYmove,
  detectMovementSubclass,
  detectMisclassification,
  scoreCandidate,
  classifyTier,
  SOFT_RELATED,
} from '../lib/ymove/hierarchy-scorer'

const prisma = new PrismaClient()

// ── Local types ───────────────────────────────────────────────────────────────

type ReviewTier =
  | 'high_priority'       // score ≥85, compatible, no conflict
  | 'review'              // score 65–84, compatible
  | 'weak'                // score 55–64, low confidence
  | 'unmatched'           // score <55 or no compatible catalog entry
  | 'needs_manual_review' // conflict with existing protected mapping
  | 'protected'           // already has a mapping — pipeline does not overwrite
  | 'misclassified'       // wrong canonical family — pipeline does not match

interface ExerciseResult {
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
  tier:             ReviewTier
}

interface L2Node {
  canonicalId:      string
  canonicalName:    string
  movementFamilyId: string
  equipmentFamily:  EqFamily
  exercises:        ExerciseResult[]
  l2Tier:           ReviewTier
}

interface ProtectedMapping {
  ymoveId:         string
  verifiedAt:      string | null
  source:          'db_verified' | 'db_unverified' | 'json_baseline'
  sharedWithDbIds: string[]
}

interface MisclassificationRecord {
  exerciseDbId:     string
  name:             string
  canonicalId:      string
  canonicalName:    string
  technicalPattern: string
  exdbTarget:       string
  exdbBodyPart:     string
  reason:           string
  canonicalCorrectionSuggested: string | null
}

interface ProtectedMappingRecord {
  exerciseDbId:     string
  ymoveId:          string
  verifiedAt:       string | null
  source:           'db_verified' | 'db_unverified' | 'json_baseline'
  sharedWithDbIds:  string[]
  intentionalShare: boolean
}

interface PipelineOutput {
  version:             3
  generatedAt:         string
  metadata:            PipelineMetadata
  misclassifications:  MisclassificationRecord[]
  protectedMappings:   ProtectedMappingRecord[]
  l2Nodes:             L2Node[]
  orphanedNoCanonical: ExerciseResult[]   // no canonical assignment (9 exercises)
  orphanedUnknownEq:   ExerciseResult[]   // canonical exists but equipment unknown (103 exercises)
  summary:             PipelineSummary
}

interface PipelineMetadata {
  exdbTotal:                  number
  exdbWithCanonical:          number   // 1,385
  exdbOrphanedNoCanonical:    number   // 9
  exdbOrphanedUnknownEq:      number   // 103
  exdbInL2Nodes:              number   // 1,282
  l2NodeCount:                number   // 601
  catalogSize:                number
  catalogWithEquipment:       number
  productionMappingsTotal:    number
  productionMappingsVerified: number
  jsonBaselineMappings:       number
  sharedYmoveIds:             number
  misclassificationsDetected: number
}

interface PipelineSummary {
  l2NodesTotal:           number
  exercisesInL2Nodes:     number
  protected:              number
  highPriority:           number
  review:                 number
  weak:                   number
  unmatched:              number
  misclassified:          number
  needsManualReview:      number
  conflictsWithProtected: number
}

// ── Main ──────────────────────────────────────────────────────────────────────

interface RawExercise  { id: string; name: string; equipment: string; bodyPart: string; target: string }
interface Canonical    { id: string; name: string; movementFamilyId: string; technicalPattern?: string; implementations: Array<{ source: { provider: string; exerciseId: string } }> }

async function main() {
  const args            = process.argv.slice(2)
  const _fi = args.indexOf('--family');    const familyFilter    = _fi    >= 0 ? (args[_fi    + 1] ?? null) : null
  const _ci = args.indexOf('--canonical'); const canonicalFilter = _ci >= 0 ? (args[_ci + 1] ?? null) : null
  const _ii = args.indexOf('--id');        const idFilter        = _ii    >= 0 ? (args[_ii    + 1] ?? null) : null
  const reportOnly      = args.includes('--report-only')

  console.log('\n══ YMove Hierarchy Pipeline v3 ══════════════════════════════════')
  console.log('  READ-ONLY  |  No writes  |  No mapping changes')
  console.log('  Thresholds: high_priority≥85  review≥65  weak≥55  unmatched<55')
  console.log('═══════════════════════════════════════════════════════════════════\n')

  // ── Load files ──────────────────────────────────────────────────────────────
  const exdbAll: RawExercise[] = JSON.parse(readFileSync(join(process.cwd(), 'data/exercises.json'), 'utf8'))
  const lib = JSON.parse(readFileSync(join(process.cwd(), 'data/involved-exercise-library.json'), 'utf8')) as { canonicalExercises: Canonical[] }
  const jsonBaseline: Record<string, string | null> = JSON.parse(readFileSync(join(process.cwd(), 'data/ymove-exercise-mapping.json'), 'utf8'))

  const canonicals    = lib.canonicalExercises
  const canonicalMap  = new Map<string, Canonical>(canonicals.map(c => [c.id, c]))
  const dbToCanonical = new Map<string, Canonical>()
  for (const can of canonicals) {
    for (const impl of can.implementations ?? []) {
      if (impl.source.provider === 'ExerciseDB') dbToCanonical.set(impl.source.exerciseId, can)
    }
  }

  // ── Load DB ─────────────────────────────────────────────────────────────────
  console.log('Loading production catalog and mappings from DB…')
  const [catalogRows, mappingRows] = await Promise.all([
    prisma.ymoveExerciseCatalog.findMany({
      select: { ymoveId: true, name: true, equipment: true, category: true, primaryMuscleGroup: true, thumbnailMediaId: true, curationStatus: true },
    }),
    prisma.ymoveMapping.findMany({
      select: { exerciseDbId: true, ymoveId: true, verifiedAt: true },
    }),
  ])

  const catalog: CatalogEntry[] = catalogRows.map(r => ({
    ymoveId: r.ymoveId, name: r.name, equipment: r.equipment,
    category: r.category, primaryMuscleGroup: r.primaryMuscleGroup,
    thumbnailMediaId: r.thumbnailMediaId, curationStatus: r.curationStatus,
  }))

  console.log(`  Catalog entries:     ${catalog.length}`)
  console.log(`  Production mappings: ${mappingRows.length}`)

  // ── Build protection set ────────────────────────────────────────────────────
  const productionById = new Map<string, { ymoveId: string | null; verifiedAt: Date | null; source: 'db_verified' | 'db_unverified' }>(
    mappingRows.map(r => [r.exerciseDbId, {
      ymoveId:    r.ymoveId ?? null,
      verifiedAt: r.verifiedAt ?? null,
      source:     r.verifiedAt ? 'db_verified' : 'db_unverified',
    }]),
  )

  // Build reverse map: ymoveId → all DB exerciseDbIds that hold it
  const ymoveToDbIds = new Map<string, string[]>()
  for (const [dbId, m] of productionById) {
    if (m.ymoveId) { const a = ymoveToDbIds.get(m.ymoveId) ?? []; a.push(dbId); ymoveToDbIds.set(m.ymoveId, a) }
  }
  for (const [dbId, jId] of Object.entries(jsonBaseline)) {
    if (!jId) continue
    if (!productionById.has(dbId)) { const a = ymoveToDbIds.get(jId) ?? []; a.push(dbId); ymoveToDbIds.set(jId, a) }
  }
  const sharedYmoveIds = new Set([...ymoveToDbIds.entries()].filter(([, ids]) => ids.length > 1).map(([id]) => id))

  // ── Index catalog by equipment family ───────────────────────────────────────
  const catalogByEq = new Map<EqFamily | 'unknown', CatalogEntry[]>()
  for (const entry of catalog) {
    const fam = normalizeYmoveEquipment(entry.equipment) ?? inferEquipmentFromName(entry.name) ?? 'unknown'
    const arr = catalogByEq.get(fam as EqFamily | 'unknown') ?? []
    arr.push(entry)
    catalogByEq.set(fam as EqFamily | 'unknown', arr)
  }
  const catalogWithEquipment = [...catalogByEq.entries()]
    .filter(([k]) => k !== 'unknown').reduce((s, [, arr]) => s + arr.length, 0)

  // ── Protected mapping record builder ────────────────────────────────────────
  const allProtectedRecords: ProtectedMappingRecord[] = []

  function buildProtection(dbId: string): ProtectedMapping | null {
    const dbMap = productionById.get(dbId)
    if (dbMap?.ymoveId) {
      const shared = (ymoveToDbIds.get(dbMap.ymoveId) ?? []).filter(id => id !== dbId)
      const rec: ProtectedMappingRecord = {
        exerciseDbId: dbId, ymoveId: dbMap.ymoveId,
        verifiedAt: dbMap.verifiedAt?.toISOString() ?? null,
        source: dbMap.source, sharedWithDbIds: shared,
        intentionalShare: sharedYmoveIds.has(dbMap.ymoveId),
      }
      allProtectedRecords.push(rec)
      return { ymoveId: dbMap.ymoveId, verifiedAt: dbMap.verifiedAt?.toISOString() ?? null, source: dbMap.source, sharedWithDbIds: shared }
    }
    const jId = jsonBaseline[dbId]
    if (jId && !productionById.has(dbId)) {
      const shared = (ymoveToDbIds.get(jId) ?? []).filter(id => id !== dbId)
      const rec: ProtectedMappingRecord = {
        exerciseDbId: dbId, ymoveId: jId, verifiedAt: null, source: 'json_baseline',
        sharedWithDbIds: shared, intentionalShare: sharedYmoveIds.has(jId),
      }
      allProtectedRecords.push(rec)
      return { ymoveId: jId, verifiedAt: null, source: 'json_baseline', sharedWithDbIds: shared }
    }
    return null
  }

  // ── Score each exercise ──────────────────────────────────────────────────────
  const exdbMap = new Map(exdbAll.map(e => [e.id, e]))
  const l2NodeMap   = new Map<string, L2Node>()
  const orphNoCanon: ExerciseResult[] = []
  const orphUnknEq:  ExerciseResult[] = []
  const allMisclassifications: MisclassificationRecord[] = []

  for (const dbex of exdbAll) {
    const can = dbToCanonical.get(dbex.id)

    // Apply CLI filters
    if (familyFilter    && can?.movementFamilyId !== familyFilter)    continue
    if (canonicalFilter && can?.id !== canonicalFilter)               continue
    if (idFilter        && dbex.id !== idFilter)                      continue

    const eqFam   = normalizeExdbEquipment(dbex.equipment)
    const pattern = can?.technicalPattern ?? null
    const mvClass = movementClassFromPattern(pattern)
    const mvSub   = detectMovementSubclass(pattern, dbex.name)

    const misclassResult = can ? detectMisclassification(pattern, dbex.target, dbex.bodyPart) : null
    if (misclassResult && can) {
      allMisclassifications.push({
        exerciseDbId: dbex.id, name: dbex.name,
        canonicalId: can.id, canonicalName: can.name,
        technicalPattern: pattern ?? '?',
        exdbTarget: dbex.target, exdbBodyPart: dbex.bodyPart,
        reason: misclassResult.reason,
        canonicalCorrectionSuggested: misclassResult.canonicalCorrectionSuggested,
      })
    }

    const protection = buildProtection(dbex.id)

    // Score against compatible catalog entries
    let topSuggestion: ScoredMatch | null = null
    let otherSuggestions: ScoredMatch[] = []

    if (!misclassResult && eqFam) {
      const families: (EqFamily | 'unknown')[] = [eqFam, ...(SOFT_RELATED[eqFam] ?? [])]
      const candidates: CatalogEntry[] = families.flatMap(f => catalogByEq.get(f) ?? [])

      const meta: ExerciseMeta = {
        exerciseDbId: dbex.id, name: dbex.name, equipment: dbex.equipment,
        equipmentFamily: eqFam, target: dbex.target, bodyPart: dbex.bodyPart,
        technicalPattern: pattern, movementClass: mvClass, movementSubclass: mvSub,
      }

      const scored = candidates
        .map(entry => scoreCandidate(entry, meta))
        .filter(s => !s.hardBlock && s.score >= SCORE_WEAK_MIN)  // threshold: <55 = unmatched
        .sort((a, b) => b.score - a.score)

      topSuggestion    = scored[0] ?? null
      otherSuggestions = scored.slice(1, 5)
    }

    // Detect conflict with protected mapping
    let protectedConflict: ConflictInfo | null = null
    if (!protection && topSuggestion) {
      const owners = ymoveToDbIds.get(topSuggestion.ymoveId) ?? []
      for (const ownerId of owners) {
        if (ownerId === dbex.id) continue
        const ownerMap = productionById.get(ownerId)
        const ownerInJson = jsonBaseline[ownerId]
        if (ownerMap || ownerInJson) {
          const verifiedAt = ownerMap?.verifiedAt?.toISOString() ?? null
          protectedConflict = { conflictingYmoveId: topSuggestion.ymoveId, conflictingDbId: ownerId, verifiedAt }
          break
        }
      }
    }

    const tier: ReviewTier =
      protection                                       ? 'protected'           :
      misclassResult                                   ? 'misclassified'       :
      protectedConflict                                ? 'needs_manual_review' :
      !topSuggestion                                   ? 'unmatched'           :
      topSuggestion.tier === 'high_priority'           ? 'high_priority'       :
      topSuggestion.tier === 'review'                  ? 'review'              :
      topSuggestion.tier === 'weak'                    ? 'weak'                :
      'unmatched'

    const result: ExerciseResult = {
      exerciseDbId: dbex.id, name: dbex.name,
      equipment: dbex.equipment, equipmentFamily: eqFam,
      canonicalId: can?.id ?? '', canonicalName: can?.name ?? '',
      movementFamilyId: can?.movementFamilyId ?? '',
      technicalPattern: pattern, movementClass: mvClass, movementSubclass: mvSub,
      protected: protection, misclassified: misclassResult ?? null,
      protectedConflict, topSuggestion, otherSuggestions, tier,
    }

    if (!can) { orphNoCanon.push(result); continue }
    if (!eqFam) { orphUnknEq.push(result); continue }

    const nodeKey = `${can.id}|${eqFam}`
    if (!l2NodeMap.has(nodeKey)) {
      l2NodeMap.set(nodeKey, {
        canonicalId: can.id, canonicalName: can.name,
        movementFamilyId: can.movementFamilyId, equipmentFamily: eqFam,
        exercises: [], l2Tier: 'unmatched',
      })
    }
    l2NodeMap.get(nodeKey)!.exercises.push(result)
  }

  // ── L2 node tier (best non-protected exercise determines the node tier) ──────
  for (const node of l2NodeMap.values()) {
    const tiers = node.exercises.map(e => e.tier)
    node.l2Tier =
      tiers.some(t => t === 'high_priority')    ? 'high_priority'       :
      tiers.some(t => t === 'needs_manual_review') ? 'needs_manual_review' :
      tiers.some(t => t === 'review')           ? 'review'              :
      tiers.some(t => t === 'weak')             ? 'weak'                :
      tiers.every(t => t === 'protected')       ? 'protected'           :
      tiers.every(t => t === 'misclassified')   ? 'misclassified'       :
      'unmatched'
  }

  const l2Nodes = [...l2NodeMap.values()].sort(
    (a, b) => a.movementFamilyId.localeCompare(b.movementFamilyId) ||
              a.canonicalId.localeCompare(b.canonicalId) ||
              a.equipmentFamily.localeCompare(b.equipmentFamily),
  )

  // ── Summary ──────────────────────────────────────────────────────────────────
  const allExercises = l2Nodes.flatMap(n => n.exercises)
  const count = (tier: ReviewTier) => allExercises.filter(e => e.tier === tier).length

  const metadata: PipelineMetadata = {
    exdbTotal:                  exdbAll.length,
    exdbWithCanonical:          dbToCanonical.size,
    exdbOrphanedNoCanonical:    orphNoCanon.length,
    exdbOrphanedUnknownEq:      orphUnknEq.length,
    exdbInL2Nodes:              allExercises.length,
    l2NodeCount:                l2Nodes.length,
    catalogSize:                catalog.length,
    catalogWithEquipment,
    productionMappingsTotal:    mappingRows.length,
    productionMappingsVerified: mappingRows.filter(r => r.verifiedAt).length,
    jsonBaselineMappings:       Object.values(jsonBaseline).filter(v => v !== null).length,
    sharedYmoveIds:             sharedYmoveIds.size,
    misclassificationsDetected: allMisclassifications.length,
  }

  const summary: PipelineSummary = {
    l2NodesTotal:           l2Nodes.length,
    exercisesInL2Nodes:     allExercises.length,
    protected:              count('protected'),
    highPriority:           count('high_priority'),
    review:                 count('review'),
    weak:                   count('weak'),
    unmatched:              count('unmatched'),
    misclassified:          count('misclassified'),
    needsManualReview:      count('needs_manual_review'),
    conflictsWithProtected: allExercises.filter(e => e.protectedConflict !== null).length,
  }

  // ── Console report ───────────────────────────────────────────────────────────
  console.log()
  console.log('══ Library Reconciliation ════════════════════════════════════════')
  console.log(`  ExerciseDB total:                  ${metadata.exdbTotal}`)
  console.log(`  With canonical assignment:         ${metadata.exdbWithCanonical}`)
  console.log(`  Orphaned — no canonical:           ${metadata.exdbOrphanedNoCanonical}  (v.2 duplicates, etc.)`)
  console.log(`  Orphaned — unknown equipment:      ${metadata.exdbOrphanedUnknownEq}  (medicine ball, sled, rope…)`)
  console.log(`  In L2 nodes (scored):              ${metadata.exdbInL2Nodes}`)
  console.log(`  L2 nodes (canonical × equipment):  ${metadata.l2NodeCount}`)
  console.log()
  console.log('══ YMove Catalog ═════════════════════════════════════════════════')
  console.log(`  Catalog size:                      ${metadata.catalogSize}`)
  console.log(`  With identifiable equipment:       ${metadata.catalogWithEquipment}`)
  console.log()
  console.log('══ Production Mappings ═══════════════════════════════════════════')
  console.log(`  DB total:                          ${metadata.productionMappingsTotal}`)
  console.log(`  DB verified (verifiedAt set):      ${metadata.productionMappingsVerified}`)
  console.log(`  JSON baseline (non-null):          ${metadata.jsonBaselineMappings}`)
  console.log(`  Shared YMove IDs (intentional):    ${metadata.sharedYmoveIds}`)
  console.log()
  console.log('══ Match Results ═════════════════════════════════════════════════')
  console.log(`  Protected (existing mapping):      ${summary.protected}`)
  console.log(`  High priority  (score ≥85):        ${summary.highPriority}`)
  console.log(`  Needs manual review (conflict):    ${summary.needsManualReview}`)
  console.log(`  Review         (score 65–84):      ${summary.review}`)
  console.log(`  Weak           (score 55–64):      ${summary.weak}`)
  console.log(`  Unmatched      (score <55):        ${summary.unmatched}`)
  console.log(`  Misclassified  (family error):     ${summary.misclassified}`)
  console.log(`  Conflicts flagged:                 ${summary.conflictsWithProtected}`)
  console.log()
  console.log('══ Misclassifications ════════════════════════════════════════════')
  for (const m of allMisclassifications) {
    console.log(`  ${m.exerciseDbId}  "${m.name}"`)
    console.log(`    ↳ ${m.reason}`)
    if (m.canonicalCorrectionSuggested) {
      console.log(`    ↳ Suggested correction: ${m.canonicalCorrectionSuggested}`)
    }
  }
  console.log()

  // ── Representative family reports ────────────────────────────────────────────
  const REPORT_FAMILIES = [
    { label: 'Bench Press', canonicalId: 'inv_bench_press' },
    { label: 'Squat',       canonicalId: 'inv_squat'       },
    { label: 'Deadlift',    canonicalId: 'inv_deadlift'    },
    { label: 'Biceps Curl', canonicalId: 'inv_biceps_curl' },
    { label: 'Row',         canonicalId: 'inv_row'         },
  ]

  const EQ_ORDER = ['barbell', 'trap_bar', 'dumbbell', 'smith', 'cable', 'kettlebell', 'machine', 'bodyweight', 'band', 'weighted']

  for (const { label, canonicalId } of REPORT_FAMILIES) {
    const nodes = l2Nodes
      .filter(n => n.canonicalId === canonicalId)
      .sort((a, b) => (EQ_ORDER.indexOf(a.equipmentFamily) || 99) - (EQ_ORDER.indexOf(b.equipmentFamily) || 99))

    if (!nodes.length) continue
    console.log(`── ${label} (${canonicalId}) ────────────────────────────────────`)

    for (const node of nodes) {
      const ex = node.exercises
      const hp  = ex.filter(e => e.tier === 'high_priority').length
      const nmr = ex.filter(e => e.tier === 'needs_manual_review').length
      const rv  = ex.filter(e => e.tier === 'review').length
      const wk  = ex.filter(e => e.tier === 'weak').length
      const um  = ex.filter(e => e.tier === 'unmatched').length
      const pr  = ex.filter(e => e.tier === 'protected').length
      const mc  = ex.filter(e => e.tier === 'misclassified').length
      console.log(`  L2 [${node.equipmentFamily.padEnd(12)}] ${ex.length.toString().padStart(2)} IDs | hp:${hp} nmr:${nmr} rv:${rv} wk:${wk} um:${um} pr:${pr} mc:${mc}`)

      // Show best non-protected suggestion
      const best = ex.filter(e => e.topSuggestion && e.tier !== 'protected' && e.tier !== 'misclassified')
        .sort((a, b) => (b.topSuggestion?.score ?? 0) - (a.topSuggestion?.score ?? 0))[0]
      if (best?.topSuggestion) {
        const s = best.topSuggestion
        console.log(`    best: "${s.name}" [${s.score}/${s.tier}]  ${s.matchReasons.join(', ')}`)
        if (s.penaltyReasons.length) console.log(`    ⚠    ${s.penaltyReasons.slice(0, 2).join('; ')}`)
      }

      // Show first conflict if any
      const conflict = ex.find(e => e.protectedConflict)
      if (conflict?.protectedConflict) {
        const c = conflict.protectedConflict
        console.log(`    ⛔  CONFLICT: "${conflict.topSuggestion?.name}" protected by ${c.conflictingDbId}${c.verifiedAt ? ' (verified)' : ''}`)
      }
    }
    console.log()
  }

  // ── Write output ─────────────────────────────────────────────────────────────
  const output: PipelineOutput = {
    version:             3,
    generatedAt:         new Date().toISOString(),
    metadata,
    misclassifications:  allMisclassifications,
    protectedMappings:   allProtectedRecords,
    l2Nodes,
    orphanedNoCanonical: orphNoCanon,
    orphanedUnknownEq:   orphUnknEq,
    summary,
  }

  if (!reportOnly) {
    const outPath = join(process.cwd(), 'data/ymove-hierarchy-suggestions.json')
    writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n', 'utf8')
    console.log(`Output written → data/ymove-hierarchy-suggestions.json`)
  } else {
    console.log('(--report-only: no file written)')
  }

  console.log('\nREAD-ONLY run complete. No database changes were made.\n')
}

main()
  .catch(err => { console.error(err); process.exit(1) })
  .finally(() => prisma.$disconnect())
