// Maps user-supplied equipment strings to canonical ExerciseDB equipment values.
// ExerciseDB canonical values are: barbell, dumbbell, cable, kettlebell, leverage machine,
// body weight, resistance band, band, stationary bike, skierg machine, smith machine,
// ez barbell, trap bar, medicine ball, bosu ball, stability ball, etc.

// ─── Alias map ────────────────────────────────────────────────────────────────

// Each key is a lowercase substring that may appear in user input.
// Values are canonical ExerciseDB equipment strings.
// More specific aliases come first — the lookup checks for the longest match.
const EQUIPMENT_ALIASES: Array<[pattern: RegExp, canonical: string]> = [
  // Barbell / squat rack variants
  [/squat\s*rack|power\s*rack|j-?hooks|lifting\s*cage|full\s*cage/i, 'barbell'],
  [/olympic\s*barbell|o-?bar/i, 'olympic barbell'],
  [/trap\s*bar|hex\s*bar/i, 'trap bar'],
  [/ez[\s-]?bar|ez[\s-]?curl|curl\s*bar/i, 'ez barbell'],
  [/barbell|barbells/i, 'barbell'],

  // Leverage / plate-loaded machines
  [/lever\s*bench|leverage\s*bench|plate[\s-]?loaded\s*bench/i, 'leverage machine'],
  [/leg\s*extension\s*(and|&|\/)\s*(leg\s*)?curl|leg\s*curl\s*(and|&|\/)\s*(leg\s*)?extension/i, 'leverage machine'],
  [/leg\s*extension/i, 'leverage machine'],
  [/leg\s*curl/i, 'leverage machine'],
  [/leg\s*press/i, 'leverage machine'],
  [/leverage\s*machine|plate[\s-]?loaded/i, 'leverage machine'],
  [/hack\s*squat\s*machine/i, 'leverage machine'],
  [/seated\s*row\s*machine/i, 'leverage machine'],
  [/chest\s*press\s*machine/i, 'leverage machine'],

  // Cable
  [/cable\s*cross[\s-]?over|cable\s*machine|cable\s*station|cable\s*tower|cables/i, 'cable'],
  [/\bcable\b/i, 'cable'],

  // Cardio equipment
  [/air\s*dyne|airdyne|air\s*bike/i, 'stationary bike'],
  [/spin\s*bike|assault\s*bike|echo\s*bike/i, 'stationary bike'],
  [/stationary\s*bike|exercise\s*bike|recumbent\s*bike/i, 'stationary bike'],
  [/treadmill/i, 'body weight'],           // running — maps to body weight for search
  [/rower|rowing\s*machine|concept\s*2|erg\b/i, 'skierg machine'],
  [/ski\s*erg|skierg/i, 'skierg machine'],
  [/elliptical/i, 'elliptical machine'],
  [/stepmill|stair\s*climber|stairmaster/i, 'stepmill machine'],
  [/sled/i, 'sled machine'],

  // Smith machine
  [/smith\s*machine/i, 'smith machine'],

  // Dumbbell
  [/dumbbells?/i, 'dumbbell'],
  [/hex\s*dumbbells?/i, 'dumbbell'],

  // Kettlebell
  [/kettlebells?/i, 'kettlebell'],

  // Resistance bands
  [/resistance\s*bands?|elastic\s*bands?|loop\s*bands?/i, 'resistance band'],
  [/\bbands?\b/i, 'band'],

  // Bodyweight / pull-up infrastructure
  [/pull[\s-]?up\s*bar|chin[\s-]?up\s*bar|pull-up\s*station/i, 'body weight'],
  [/jump\s*box|plyo[\s-]?box|plyometric\s*box/i, 'body weight'],
  [/gymnastics\s*rings|rings/i, 'body weight'],
  [/dip\s*bar|dip\s*station/i, 'body weight'],
  [/body\s*weight|bodyweight|bw\b|no\s*equipment/i, 'body weight'],

  // Bench (enables dumbbell/barbell work but isn't its own ExerciseDB category — note only)
  // Do NOT add "bench" alone as canonical — it's an accessory, not a search filter.

  // Medicine ball
  [/medicine\s*ball|med\s*ball/i, 'medicine ball'],

  // BOSU / stability
  [/bosu\s*ball|bosu/i, 'bosu ball'],
  [/stability\s*ball|swiss\s*ball|exercise\s*ball/i, 'stability ball'],

  // Foam roller
  [/foam\s*roller|roller/i, 'roller'],

  // Weighted vest
  [/weighted\s*vest/i, 'weighted'],
]

// ─── Normalisation ────────────────────────────────────────────────────────────

/**
 * Convert a comma/newline separated user equipment string to a deduplicated
 * list of canonical ExerciseDB equipment values. "body weight" is always
 * included — it's always available.
 */
export function normalizeEquipmentList(input: string): string[] {
  const tokens = input.split(/[,;\n]+/).map(t => t.trim()).filter(Boolean)
  const canonical = new Set<string>(['body weight'])

  for (const token of tokens) {
    const matched = matchEquipmentToken(token)
    if (matched) canonical.add(matched)
  }

  return Array.from(canonical)
}

function matchEquipmentToken(token: string): string | null {
  for (const [pattern, canonical] of EQUIPMENT_ALIASES) {
    if (pattern.test(token)) return canonical
  }
  return null
}

/**
 * Scan free-form conversation text for equipment mentions.
 * Returns canonical equipment list when equipment is found, or null when
 * no equipment is mentioned (caller should fall back to DB profile).
 */
export function extractEquipmentFromConversation(text: string): string[] | null {
  const canonical = new Set<string>()

  // Check every alias against the full text
  for (const [pattern, eq] of EQUIPMENT_ALIASES) {
    // Reset lastIndex for global flags if any (our patterns don't use /g but be safe)
    if (pattern.test(text)) {
      canonical.add(eq)
    }
  }

  // Treat "gym" / "commercial gym" / "full gym" as full access signal
  if (/full[\s-]?gym|commercial\s*gym|gym\s*access|well[\s-]?equipped\s*gym/i.test(text)) {
    return null  // null = no restriction
  }

  if (canonical.size === 0) return null

  canonical.add('body weight')
  return Array.from(canonical)
}

// ─── Capability graph ─────────────────────────────────────────────────────────

export interface EquipmentCapability {
  movementPatterns: string[]
  bodyParts: string[]
  notes?: string
}

export const EQUIPMENT_CAPABILITIES: Record<string, EquipmentCapability> = {
  'barbell': {
    movementPatterns: ['horizontal_push', 'vertical_push', 'horizontal_pull', 'vertical_pull',
                       'squat', 'hinge', 'carry', 'core_antiextension', 'olympic_power'],
    bodyParts: ['chest', 'back', 'shoulders', 'upper legs', 'waist', 'upper arms'],
    notes: 'Full strength compound capability.',
  },
  'olympic barbell': {
    movementPatterns: ['horizontal_push', 'vertical_push', 'horizontal_pull', 'vertical_pull',
                       'squat', 'hinge', 'carry', 'olympic_power'],
    bodyParts: ['chest', 'back', 'shoulders', 'upper legs', 'waist', 'upper arms'],
  },
  'dumbbell': {
    movementPatterns: ['horizontal_push', 'incline_push', 'fly', 'vertical_push', 'shoulder_isolation',
                       'horizontal_pull', 'vertical_pull', 'bicep', 'tricep', 'forearm',
                       'squat', 'hinge', 'lunge', 'carry', 'core_antiextension'],
    bodyParts: ['chest', 'back', 'shoulders', 'upper legs', 'lower legs', 'upper arms', 'lower arms', 'waist'],
    notes: 'Broadest capability including unilateral work.',
  },
  'kettlebell': {
    movementPatterns: ['hinge', 'squat', 'carry', 'horizontal_push', 'vertical_push',
                       'core_antiextension', 'lunge'],
    bodyParts: ['upper legs', 'back', 'shoulders', 'waist', 'upper arms'],
    notes: 'Swings, carries, goblet squat, press.',
  },
  'cable': {
    movementPatterns: ['horizontal_push', 'fly', 'horizontal_pull', 'vertical_pull', 'vertical_push',
                       'shoulder_isolation', 'bicep', 'tricep', 'core_antiextension', 'core_flexion',
                       'core_rotation'],
    bodyParts: ['chest', 'back', 'shoulders', 'upper arms', 'lower arms', 'waist'],
    notes: 'Constant tension through full ROM. Best for isolation and core.',
  },
  'leverage machine': {
    movementPatterns: ['horizontal_push', 'squat', 'hinge', 'vertical_pull', 'bicep', 'tricep',
                       'calf', 'core_flexion'],
    bodyParts: ['chest', 'upper legs', 'lower legs', 'back', 'upper arms'],
    notes: 'Plate-loaded machines: leg press, chest press, leg extension, leg curl.',
  },
  'body weight': {
    movementPatterns: ['horizontal_push', 'vertical_pull', 'squat', 'hinge', 'lunge', 'calf',
                       'core_flexion', 'core_antiextension', 'core_rotation', 'core_lateral'],
    bodyParts: ['chest', 'back', 'upper legs', 'lower legs', 'waist', 'upper arms', 'shoulders'],
    notes: 'Push-up, pull-up, dip, squat, lunge, plank — always available.',
  },
  'band': {
    movementPatterns: ['horizontal_pull', 'vertical_pull', 'shoulder_isolation', 'bicep'],
    bodyParts: ['back', 'shoulders', 'upper arms'],
  },
  'resistance band': {
    movementPatterns: ['horizontal_pull', 'vertical_pull', 'horizontal_push', 'shoulder_isolation', 'bicep'],
    bodyParts: ['back', 'shoulders', 'upper arms', 'chest'],
  },
  'stationary bike': {
    movementPatterns: ['cardio'],
    bodyParts: ['cardio', 'upper legs'],
    notes: 'Air bike / Airdyne — conditioning and HIIT.',
  },
  'skierg machine': {
    movementPatterns: ['cardio', 'hinge'],
    bodyParts: ['cardio', 'back', 'upper legs'],
    notes: 'Rower — full body conditioning with posterior chain emphasis.',
  },
  'smith machine': {
    movementPatterns: ['horizontal_push', 'squat', 'hinge', 'vertical_push', 'lunge'],
    bodyParts: ['chest', 'upper legs', 'shoulders', 'back'],
  },
  'trap bar': {
    movementPatterns: ['hinge', 'carry', 'squat'],
    bodyParts: ['upper legs', 'back', 'waist'],
    notes: 'Trap bar deadlift, carries.',
  },
  'ez barbell': {
    movementPatterns: ['bicep', 'tricep', 'forearm'],
    bodyParts: ['upper arms', 'lower arms'],
    notes: 'Curl bar — bicep/tricep isolation.',
  },
  'medicine ball': {
    movementPatterns: ['core_rotation', 'core_flexion', 'horizontal_push'],
    bodyParts: ['waist', 'chest'],
  },
  'elliptical machine': {
    movementPatterns: ['cardio'],
    bodyParts: ['cardio', 'upper legs'],
  },
  'sled machine': {
    movementPatterns: ['squat', 'cardio', 'carry'],
    bodyParts: ['upper legs', 'cardio'],
  },
  'stepmill machine': {
    movementPatterns: ['cardio', 'calf'],
    bodyParts: ['cardio', 'lower legs', 'upper legs'],
  },
  'bosu ball': {
    movementPatterns: ['squat', 'core_antiextension', 'horizontal_push'],
    bodyParts: ['upper legs', 'waist', 'chest'],
  },
  'stability ball': {
    movementPatterns: ['core_antiextension', 'core_flexion', 'horizontal_push'],
    bodyParts: ['waist', 'chest'],
  },
}

/**
 * Return all movement patterns enabled by the given canonical equipment list.
 * Body weight is always included.
 */
export function getCapableMovementPatterns(equipment: string[]): Set<string> {
  const patterns = new Set<string>()
  const all = [...equipment, 'body weight']
  for (const eq of all) {
    const cap = EQUIPMENT_CAPABILITIES[eq]
    if (cap) cap.movementPatterns.forEach(p => patterns.add(p))
  }
  return patterns
}

/**
 * Build a concise capability summary string for injection into the V system
 * prompt. Tells V exactly what canonical equipment names to search with and
 * what movement patterns are available — prevents "I can't find exercises."
 */
export function buildEquipmentCapabilitySummary(equipment: string[]): string {
  const patterns = getCapableMovementPatterns(equipment)
  const lines: string[] = [
    `AVAILABLE EQUIPMENT: ${equipment.join(', ')}`,
    `ENABLED MOVEMENT PATTERNS: ${Array.from(patterns).join(', ')}`,
    '',
    'This setup supports:',
  ]

  const has = (p: string) => patterns.has(p)
  if (has('squat') && has('hinge') && has('horizontal_push') && has('horizontal_pull')) {
    lines.push('  • Full compound strength training (squat, hinge/deadlift, press, row)')
  }
  if (has('vertical_pull')) lines.push('  • Vertical pulling (pull-up, lat pulldown)')
  if (has('bicep') || has('tricep') || has('shoulder_isolation')) {
    lines.push('  • Isolation work (curls, extensions, lateral raises)')
  }
  if (has('cardio')) lines.push('  • Cardio / conditioning')
  if (has('core_flexion') || has('core_antiextension') || has('core_rotation')) {
    lines.push('  • Core training')
  }

  lines.push('')
  lines.push('When searching for exercises, use the canonical equipment names listed above exactly as written.')
  lines.push('Do not conclude an exercise is unavailable until all movement pattern alternatives are exhausted.')

  return lines.join('\n')
}
