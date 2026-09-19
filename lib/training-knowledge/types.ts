// Training Knowledge Base — TypeScript type definitions
// Content is managed in /training-knowledge/*.json
// These types enforce structural correctness on load and enable typed retrieval.

// ─── Evidence / Sources ───────────────────────────────────────────────────────

export type EvidenceType =
  | 'meta_analysis'
  | 'rct'
  | 'systematic_review'
  | 'position_stand'
  | 'textbook_consensus'
  | 'expert_consensus'
  | 'heuristic'

export interface KnowledgeSource {
  id: string
  organization?: string
  authors?: string[]
  title: string
  publication?: string
  year?: number
  doi?: string
  url?: string
  type: EvidenceType
  notes?: string
  verified: boolean
}

export interface SourcesFile {
  version: string
  lastReviewed: string
  disclaimer: string
  sources: KnowledgeSource[]
}

// ─── Programming Principles ───────────────────────────────────────────────────

export interface ProgrammingPrinciple {
  id: string
  title: string
  statement: string
  implication: string
  evidenceStrength: 'strong_consensus' | 'moderate' | 'emerging' | 'heuristic'
  sourceIds: string[]
  tags: string[]
}

export interface ProgrammingPrinciplesFile {
  version: string
  principles: ProgrammingPrinciple[]
}

// ─── Experience Levels ────────────────────────────────────────────────────────

export type ExperienceLevel = 'beginner' | 'intermediate' | 'advanced'

export interface ExperienceLevelGuidelines {
  definition: string
  characteristics: string[]
  programming: {
    sessionExerciseCount: { min: number; max: number }
    compoundsPerSession: { min: number; max: number }
    accessoriesPerSession: { min: number; max: number }
    progressionModel: string
    periodization: string
    advancedTechniques: string
    notes?: string[]
  }
  splitGuidelines: Record<string, string>
  redFlags: string[]
  sourceIds: string[]
}

export interface ExperienceLevelsFile {
  version: string
  levels: Partial<Record<ExperienceLevel, ExperienceLevelGuidelines>>
}

// ─── Goals ────────────────────────────────────────────────────────────────────

export interface GoalGuidelines {
  primaryAdaptation?: string
  keyPrinciple?: string
  approach?: string[]
  doNotDo?: string[]
  compatibleGoals?: string[]
  combinationNotes?: Record<string, string>
  interferenceRisks?: string[]
  sourceIds: string[]
  notes?: string[]
}

export interface GoalsFile {
  version: string
  goals: Record<string, GoalGuidelines>
}

// ─── Split Structures ─────────────────────────────────────────────────────────

export interface SplitStructure {
  id: string
  name: string
  daysPerWeek: number[]
  bestFor: string[]
  patternFrequency: string | Record<string, string>
  characteristics: string
  selectionLogic: string
  importantNote?: string
  notes?: string[]
}

export interface SplitStructuresFile {
  version: string
  structures: SplitStructure[]
  selectionDecisionMatrix: Record<string, string[]>
  principleNote: string
}

// ─── Periodization ────────────────────────────────────────────────────────────

export interface PeriodizationModel {
  id: string
  name: string
  description: string
  bestFor: string[]
  structure?: string
  notes?: string[]
  sourceIds: string[]
}

export interface PeriodizationFile {
  version: string
  models: PeriodizationModel[]
  principleNote: string
}

// ─── Progression Models ───────────────────────────────────────────────────────

export interface ProgressionModel {
  id: string
  name: string
  description: string
  bestFor: string[]
  example?: string
  whenToSwitch?: string
  caveat?: string
  notes?: string[]
  sourceIds: string[]
}

export interface ExerciseTypeProgressionMapping {
  pattern: string
  recommendation: string
}

export interface ProgressionModelsFile {
  version: string
  models: Record<string, ProgressionModel>
  exerciseTypeMapping: Record<string, string>
  principleNote: string
}

// ─── Volume / Intensity ───────────────────────────────────────────────────────

export interface VolumeIntensityGuidelines {
  goal: string
  repRanges: Record<string, string>
  setsPerMuscleGroupPerWeek?: { min: number; max: number; notes?: string }
  restPeriods: Record<string, string>
  proximityToFailure?: string
  intensityRange?: string
  sourceIds: string[]
  notes?: string[]
}

export interface VolumeIntensityFile {
  version: string
  guidelines: Record<string, VolumeIntensityGuidelines>
  principleNote: string
}

// ─── Cardio / Conditioning ────────────────────────────────────────────────────

export interface CardioGuidelines {
  modality: string
  intensityDescription: string
  progressionModel: string
  frequencyGuidelines?: string
  notes?: string[]
}

export interface HybridGuidelines {
  interferenceEffect: string
  mitigationStrategies: string[]
  sequencingGuidance?: string
  timingSeparation?: string
  sourceIds: string[]
  notes?: string[]
}

export interface CardioConditioningFile {
  version: string
  effortDescriptions: Record<string, string>
  cardioGuidelines: Record<string, CardioGuidelines>
  hybridGuidelines: HybridGuidelines
  principleNote: string
}

// ─── Quality Rules ────────────────────────────────────────────────────────────

export type QualityRuleSeverity = 'blocking' | 'warning' | 'informational'

export interface QualityRule {
  id: string
  severity: QualityRuleSeverity
  check: string
  description: string
  applyTo?: string[]
  exception?: string
  sourceIds?: string[]
}

export interface QualityRulesFile {
  version: string
  severityDefinitions: Record<QualityRuleSeverity, string>
  rules: QualityRule[]
}

// ─── Composite output from the selector ──────────────────────────────────────

export interface RelevantKnowledge {
  knowledgeVersion: string
  experienceGuidelines: ExperienceLevelGuidelines | null
  goalGuidelines: GoalGuidelines[]
  recommendedSplits: SplitStructure[]
  progressionModels: ProgressionModel[]
  qualityRules: QualityRule[]
  principleHighlights: string[]
}

// ─── Selector input ───────────────────────────────────────────────────────────

export interface KnowledgeRequest {
  goals: string[]
  fitnessLevel: ExperienceLevel | null
  daysPerWeek?: number
  programDurationWeeks?: number | null
  taskType: 'workout' | 'program'
}
