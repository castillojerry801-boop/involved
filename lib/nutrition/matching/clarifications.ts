// When a query matches an ambiguous food category, suggest a clarification question.
// Clarification is only returned when the query is general enough to be ambiguous,
// i.e. a more specific qualifier (breast, thigh, etc.) is NOT already present.

import type { FoodMatch } from './types'

interface ClarificationTrigger {
  keywords: string[]
  question: string
  // Specificity words: if any are present in the ingredient name, skip clarification
  specificWords?: string[]
  requiresDivergentMacros?: boolean
}

const CLARIFICATION_TRIGGERS: ClarificationTrigger[] = [
  {
    keywords: ['chicken'],
    question: 'Breast, thigh, or whole chicken?',
    specificWords: ['breast', 'thigh', 'drumstick', 'wing', 'ground', 'whole', 'rotisserie'],
    requiresDivergentMacros: true,
  },
  {
    keywords: ['pasta', 'spaghetti', 'penne', 'rigatoni', 'fettuccine'],
    question: 'Dry or cooked pasta?',
    specificWords: ['dry', 'cooked', 'prepared'],
  },
  {
    keywords: ['milk'],
    question: 'Whole, 2%, or skim milk?',
    specificWords: ['whole', 'skim', 'nonfat', '2%', '1%', 'low fat', 'lowfat', 'oat', 'almond', 'soy'],
    requiresDivergentMacros: true,
  },
  {
    keywords: ['beef', 'ground'],
    question: 'Lean percentage? (80/20, 90/10, etc.)',
    specificWords: ['80', '90', '85', '93', 'lean', 'extra lean', 'steak', 'roast', 'brisket', 'sirloin', 'chuck'],
    requiresDivergentMacros: true,
  },
  {
    keywords: ['yogurt'],
    question: 'Plain or flavored? Greek or regular?',
    specificWords: ['plain', 'greek', 'flavored', 'vanilla', 'strawberry', 'blueberry', 'coconut', 'nonfat'],
  },
  {
    keywords: ['potato'],
    question: 'Raw, baked, or mashed?',
    specificWords: ['raw', 'baked', 'mashed', 'sweet', 'boiled', 'fried'],
    requiresDivergentMacros: false,
  },
]

/** Returns true if the top results have meaningfully different macros (>10% difference in calories) */
function hasDivergentMacros(topResults: FoodMatch[]): boolean {
  if (topResults.length < 2) return false
  const cals = topResults.slice(0, 3).map(r => r.calories).filter(c => c > 0)
  if (cals.length < 2) return false
  const max = Math.max(...cals)
  const min = Math.min(...cals)
  return (max - min) / max > 0.1
}

/**
 * When a query matches an ambiguous food category, suggest a clarification question.
 * Returns null if no clarification needed.
 */
export function getClarificationQuestion(
  ingredientName: string,
  topResults: FoodMatch[],
): string | null {
  const nameLower = ingredientName.toLowerCase()

  for (const trigger of CLARIFICATION_TRIGGERS) {
    // Check if any trigger keyword is present in the ingredient name
    const hasKeyword = trigger.keywords.some(kw => nameLower.includes(kw))
    if (!hasKeyword) continue

    // Check if a more specific word is already present — if so, no clarification needed
    if (trigger.specificWords) {
      const alreadySpecific = trigger.specificWords.some(sw => nameLower.includes(sw))
      if (alreadySpecific) continue
    }

    // If requiresDivergentMacros is true, only trigger if results have meaningfully different macros
    if (trigger.requiresDivergentMacros && !hasDivergentMacros(topResults)) continue

    return trigger.question
  }

  return null
}
