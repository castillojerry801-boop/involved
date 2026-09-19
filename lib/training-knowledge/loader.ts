import 'server-only'
import type {
  SourcesFile,
  ProgrammingPrinciplesFile,
  ExperienceLevelsFile,
  GoalsFile,
  SplitStructuresFile,
  PeriodizationFile,
  ProgressionModelsFile,
  VolumeIntensityFile,
  CardioConditioningFile,
  QualityRulesFile,
} from './types'

// Knowledge JSON files are loaded once at module import.
// They are static and immutable at runtime — no DB calls.

// eslint-disable-next-line @typescript-eslint/no-require-imports
const sources            = require('@/training-knowledge/sources.json')            as SourcesFile
// eslint-disable-next-line @typescript-eslint/no-require-imports
const principles         = require('@/training-knowledge/programming-principles.json') as ProgrammingPrinciplesFile
// eslint-disable-next-line @typescript-eslint/no-require-imports
const experienceLevels   = require('@/training-knowledge/experience-levels.json')  as ExperienceLevelsFile
// eslint-disable-next-line @typescript-eslint/no-require-imports
const goals              = require('@/training-knowledge/goals.json')              as GoalsFile
// eslint-disable-next-line @typescript-eslint/no-require-imports
const splitStructures    = require('@/training-knowledge/split-structures.json')   as SplitStructuresFile
// eslint-disable-next-line @typescript-eslint/no-require-imports
const periodization      = require('@/training-knowledge/periodization.json')      as PeriodizationFile
// eslint-disable-next-line @typescript-eslint/no-require-imports
const progressionModels  = require('@/training-knowledge/progression-models.json') as ProgressionModelsFile
// eslint-disable-next-line @typescript-eslint/no-require-imports
const volumeIntensity    = require('@/training-knowledge/volume-intensity.json')   as VolumeIntensityFile
// eslint-disable-next-line @typescript-eslint/no-require-imports
const cardioConditioning = require('@/training-knowledge/cardio-conditioning.json') as CardioConditioningFile
// eslint-disable-next-line @typescript-eslint/no-require-imports
const qualityRules       = require('@/training-knowledge/quality-rules.json')      as QualityRulesFile

export const kb = {
  sources,
  principles,
  experienceLevels,
  goals,
  splitStructures,
  periodization,
  progressionModels,
  volumeIntensity,
  cardioConditioning,
  qualityRules,
} as const

export type KnowledgeBase = typeof kb
