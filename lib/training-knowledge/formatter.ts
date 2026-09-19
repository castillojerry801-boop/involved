import 'server-only'
import type { RelevantKnowledge, KnowledgeRequest } from './types'
import { selectRelevantKnowledge } from './selector'

// Converts a RelevantKnowledge object into a compact, prompt-ready string.
// This string is injected into the V system prompt only for training/program tasks.
// When the knowledge base has no content yet (empty shells), returns an empty string
// so the system prompt is unaffected until content is populated and reviewed.
export function formatKnowledgeSnippet(knowledge: RelevantKnowledge): string {
  const parts: string[] = []

  if (knowledge.principleHighlights.length === 0 &&
      knowledge.goalGuidelines.length === 0 &&
      !knowledge.experienceGuidelines &&
      knowledge.qualityRules.length === 0) {
    return ''
  }

  parts.push(`TRAINING KNOWLEDGE [v${knowledge.knowledgeVersion}]:`)

  if (knowledge.principleHighlights.length > 0) {
    parts.push('\nFOUNDATIONAL PRINCIPLES:')
    knowledge.principleHighlights.forEach(h => parts.push(`  • ${h}`))
  }

  if (knowledge.experienceGuidelines) {
    const eg = knowledge.experienceGuidelines
    parts.push('\nEXPERIENCE LEVEL GUIDELINES:')
    parts.push(`  ${eg.definition}`)
    if (eg.programming.notes?.length) {
      eg.programming.notes.forEach(n => parts.push(`  • ${n}`))
    }
    if (eg.redFlags.length) {
      parts.push('  Avoid:')
      eg.redFlags.forEach(f => parts.push(`    - ${f}`))
    }
  }

  if (knowledge.goalGuidelines.length > 0) {
    parts.push('\nGOAL-SPECIFIC GUIDANCE:')
    knowledge.goalGuidelines.forEach(g => {
      if (g.keyPrinciple) parts.push(`  • ${g.keyPrinciple}`)
      if (g.doNotDo?.length) {
        g.doNotDo.forEach(d => parts.push(`  DO NOT: ${d}`))
      }
      if (g.notes?.length) {
        g.notes.forEach(n => parts.push(`  Note: ${n}`))
      }
    })
  }

  if (knowledge.recommendedSplits.length > 0) {
    parts.push('\nRECOMMENDED SPLIT STRUCTURES:')
    knowledge.recommendedSplits.forEach(s => {
      parts.push(`  ${s.name}: ${s.selectionLogic}`)
      if (s.importantNote) parts.push(`    Note: ${s.importantNote}`)
    })
  }

  if (knowledge.progressionModels.length > 0) {
    parts.push('\nPROGRESSION MODELS:')
    knowledge.progressionModels.forEach(m => {
      parts.push(`  ${m.name}: ${m.description}`)
      if (m.caveat) parts.push(`    Caveat: ${m.caveat}`)
    })
  }

  const blocking = knowledge.qualityRules.filter(r => r.severity === 'blocking')
  const warnings = knowledge.qualityRules.filter(r => r.severity === 'warning')
  const info = knowledge.qualityRules.filter(r => r.severity === 'informational')

  if (blocking.length + warnings.length + info.length > 0) {
    parts.push('\nQUALITY RULES:')
    blocking.forEach(r => parts.push(`  [BLOCKING] ${r.description}${r.exception ? ` Exception: ${r.exception}` : ''}`))
    warnings.forEach(r => parts.push(`  [WARNING] ${r.description}${r.exception ? ` Exception: ${r.exception}` : ''}`))
    info.forEach(r => parts.push(`  [INFO] ${r.description}`))
  }

  return parts.join('\n')
}

// Convenience function: select + format in one call.
// Returns empty string when knowledge base content is not yet populated.
export function buildTrainingKnowledgeSnippet(req: KnowledgeRequest): string {
  const knowledge = selectRelevantKnowledge(req)
  return formatKnowledgeSnippet(knowledge)
}
