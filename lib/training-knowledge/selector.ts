import 'server-only'
import { kb } from './loader'
import type { KnowledgeRequest, RelevantKnowledge } from './types'

// Returns the subset of training knowledge relevant to this specific request.
// Neither the caller nor V receives the full knowledge base — only what applies.
// When content is not yet populated (empty JSON shells), returns safe empty defaults.
export function selectRelevantKnowledge(req: KnowledgeRequest): RelevantKnowledge {
  const version = kb.principles.version ?? '0.0.0'

  // Experience level guidelines
  const experienceGuidelines =
    req.fitnessLevel && kb.experienceLevels.levels
      ? (kb.experienceLevels.levels[req.fitnessLevel] ?? null)
      : null

  // Goal guidelines — one entry per requested goal, filtering to known goals
  const goalGuidelines = req.goals
    .map(g => kb.goals.goals?.[g])
    .filter(Boolean) as RelevantKnowledge['goalGuidelines']

  // Split structures applicable to the requested day count and goals
  const recommendedSplits = (kb.splitStructures.structures ?? []).filter(s => {
    if (req.daysPerWeek === undefined) return true
    return s.daysPerWeek.includes(req.daysPerWeek)
  })

  // Progression models relevant to the current goals
  const allModels = Object.values(kb.progressionModels.models ?? {})
  const progressionModels = allModels.filter(m => {
    if (!req.goals.length) return true
    return m.bestFor.some(tag =>
      req.goals.some(g => tag.includes(g)) ||
      (req.fitnessLevel && tag.includes(req.fitnessLevel))
    )
  })

  // Quality rules — filter to those applicable to the current goals and task
  const qualityRules = (kb.qualityRules.rules ?? []).filter(rule => {
    if (!rule.applyTo?.length) return true
    return rule.applyTo.some(t => req.goals.includes(t) || t === req.taskType)
  })

  // Surface foundational principle statements for inclusion in the knowledge snippet
  const principleHighlights = (kb.principles.principles ?? [])
    .filter(p => p.tags.includes('foundational') || req.goals.some(g => p.tags.includes(`goal_${g}`)))
    .map(p => `${p.title}: ${p.statement}`)

  return {
    knowledgeVersion: version,
    experienceGuidelines,
    goalGuidelines,
    recommendedSplits,
    progressionModels,
    qualityRules,
    principleHighlights,
  }
}
