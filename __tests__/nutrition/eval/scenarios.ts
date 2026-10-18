/**
 * Coach V Nutrition Evaluation Scenarios
 *
 * 110 diverse customer conversation inputs covering the full range of real-world
 * food descriptions. These are TEST INPUTS — not foods or answers to memorize.
 *
 * Layer A (deterministic): scenarios with matchInput + layerA data are executed
 *   against the real pipeline with mocked provider responses.
 *
 * Layer B (real AI): all scenarios are available as AI conversation inputs
 *   when EVAL_REAL_AI=true; not executed in normal CI.
 *
 * Scenario categories:
 *   whole_food_simple       — plain whole foods
 *   whole_food_measured     — whole foods with count/weight/volume units
 *   packaged_branded        — packaged and branded products
 *   restaurant              — restaurant and fast-food items
 *   homemade                — homemade and mixed dishes
 *   drink                   — beverages
 *   cooking_ingredient      — cooking staples
 *   household_measurement   — vague household units (cup, bowl, handful)
 *   casual_vague            — casual or incomplete language
 *   misspelling             — common misspellings and informal names
 *   correction              — corrections and follow-up edits
 *   multi_food              — multi-ingredient meals
 *   partial_log             — partial-meal logging requests
 *   provider_failure        — expected provider failure / fallback behavior
 *   held_out                — unfamiliar/exotic foods not referenced elsewhere
 */

export type ScenarioCategory =
  | 'whole_food_simple'
  | 'whole_food_measured'
  | 'packaged_branded'
  | 'restaurant'
  | 'homemade'
  | 'drink'
  | 'cooking_ingredient'
  | 'household_measurement'
  | 'casual_vague'
  | 'misspelling'
  | 'correction'
  | 'multi_food'
  | 'partial_log'
  | 'provider_failure'
  | 'held_out'

export interface MacroRange {
  calories: [min: number, max: number]
  proteinG: [min: number, max: number]
  carbG: [min: number, max: number]
  fatG: [min: number, max: number]
}

export interface MatchInput {
  name: string
  quantity: number
  unit: string
}

export interface LayerASpec {
  /** Structured ingredient inputs for calculateNutrition */
  ingredients: MatchInput[]
  /** Keywords that must appear in the matched food name (case-insensitive) */
  expectedNameTokens: string[]
  /** Expected total macro ranges across all ingredients */
  macroRanges: MacroRange
  /** Which pipeline step should succeed */
  expectedResolved: boolean
  /** Expected conversionSource (optional assertion) */
  expectedConversionSource?: string
}

/**
 * Food identity constraints for Layer B full-workflow assessment.
 * These annotations exist ONLY in the eval dataset — never in production matching code.
 * They define what the eval considers a correct food identity match.
 */
export interface LayerBIdentitySpec {
  /**
   * ALL of these tokens must appear somewhere in the matched food name (case-insensitive, substring).
   * A match that omits any required token is an identity failure.
   */
  requiredTokens: string[]
  /**
   * If any of these tokens appear in the matched food name, it is an identity failure.
   * Use only for tokens that unambiguously indicate a different food category
   * (e.g. 'chicken' for a spinach query, 'juice' for a whole-fruit/veg query).
   * Do NOT use preparation words (raw, cooked) or brand names here.
   */
  forbiddenTokens?: string[]
  /** Human-readable explanation of why a wrong match would fail this check. */
  note?: string
}

export interface EvalScenario {
  id: string
  category: ScenarioCategory
  /** Brief human label for reports */
  label: string
  /** Natural-language user input (for Layer B AI tests) */
  userInput: string
  /** Whether V should ask for clarification before calculating */
  requiresClarification: boolean
  /** Reason clarification is required */
  clarificationReason?: string
  /**
   * Three-tier clarification classification for Layer B assessment.
   * 'never'                — conventional single-serving whole food; clarification is always a failure
   * 'acceptable_if_disclosed' — portion is variable but common; V may proceed with a stated assumption
   * 'required'             — ambiguous amount, ambiguous package, or unit-ambiguous preparation
   * Omit for scenarios where requiresClarification already captures the intent unambiguously.
   */
  clarificationClass?: 'never' | 'acceptable_if_disclosed' | 'required'
  /** True if this food is unlikely to be in normal provider results — tests fallback/failure */
  expectsNoMatch?: boolean
  /** Layer A structured spec — present on scenarios that are deterministically testable */
  layerA?: LayerASpec
  /**
   * Layer B food identity constraints — used exclusively in Layer B full-workflow eval.
   * Evaluated against the matched food name returned by the pipeline.
   * Kept here in the eval dataset only — never referenced in production matching or prompts.
   */
  layerBIdentity?: LayerBIdentitySpec
  /** Notes for the evaluator */
  notes?: string
}

// ── CATEGORY 1: Whole foods — simple ─────────────────────────────────────────

const WHOLE_FOOD_SIMPLE: EvalScenario[] = [
  {
    id: 'wfs-001',
    category: 'whole_food_simple',
    label: 'Banana',
    userInput: 'banana',
    requiresClarification: false,
    clarificationClass: 'never',
    layerBIdentity: {
      requiredTokens: ['banana'],
      forbiddenTokens: ['almond', 'butter', 'bread', 'muffin', 'chip', 'flavoring'],
      note: 'Must match banana the fruit — not banana almond butter, banana bread, or banana flavoring',
    },
    layerA: {
      ingredients: [{ name: 'banana', quantity: 1, unit: 'medium' }],
      expectedNameTokens: ['banana'],
      macroRanges: { calories: [80, 130], proteinG: [0, 2], carbG: [20, 35], fatG: [0, 1] },
      expectedResolved: true,
    },
  },
  {
    id: 'wfs-002',
    category: 'whole_food_simple',
    label: 'Apple',
    userInput: 'apple',
    requiresClarification: false,
    clarificationClass: 'never',
    layerBIdentity: {
      requiredTokens: ['apple'],
      forbiddenTokens: ['juice', 'cider', 'sauce', 'vinegar', 'butter'],
      note: 'Must match apple the fruit — not apple juice, cider, sauce, or vinegar',
    },
    layerA: {
      ingredients: [{ name: 'apple', quantity: 1, unit: 'medium' }],
      expectedNameTokens: ['apple'],
      macroRanges: { calories: [70, 120], proteinG: [0, 1], carbG: [18, 30], fatG: [0, 1] },
      expectedResolved: true,
    },
  },
  {
    id: 'wfs-003',
    category: 'whole_food_simple',
    label: 'Raw chicken breast',
    userInput: 'raw chicken breast',
    requiresClarification: false,
    clarificationClass: 'acceptable_if_disclosed',
    layerBIdentity: {
      requiredTokens: ['chicken'],
      forbiddenTokens: ['soup', 'salad', 'sandwich', 'casserole', 'burrito', 'nugget', 'wing', 'thigh', 'flavor'],
      note: 'Must match chicken breast meat — not a prepared dish containing chicken',
    },
    layerA: {
      ingredients: [{ name: 'chicken breast', quantity: 100, unit: 'g' }],
      expectedNameTokens: ['chicken', 'breast'],
      macroRanges: { calories: [100, 175], proteinG: [20, 35], carbG: [0, 3], fatG: [1, 6] },
      expectedResolved: true,
    },
  },
  {
    id: 'wfs-004',
    category: 'whole_food_simple',
    label: 'Salmon fillet',
    userInput: 'salmon fillet',
    requiresClarification: false,
    clarificationClass: 'acceptable_if_disclosed',
    layerBIdentity: {
      requiredTokens: ['salmon'],
      forbiddenTokens: ['salad', 'roll', 'sushi', 'dip', 'flavored', 'flavor', 'casserole'],
      note: 'Must match salmon the fish — not a dish containing salmon',
    },
    layerA: {
      ingredients: [{ name: 'salmon', quantity: 100, unit: 'g' }],
      expectedNameTokens: ['salmon'],
      macroRanges: { calories: [150, 230], proteinG: [18, 28], carbG: [0, 2], fatG: [5, 15] },
      expectedResolved: true,
    },
  },
  {
    id: 'wfs-005',
    category: 'whole_food_simple',
    label: 'Broccoli',
    userInput: 'broccoli',
    requiresClarification: false,
    clarificationClass: 'never',
    layerBIdentity: {
      requiredTokens: ['broccoli'],
      forbiddenTokens: ['chicken', 'beef', 'cheese', 'soup', 'stuffed', 'casserole'],
      note: 'Must match broccoli the vegetable — not a dish with broccoli as an ingredient',
    },
    layerA: {
      ingredients: [{ name: 'broccoli', quantity: 1, unit: 'cup' }],
      expectedNameTokens: ['broccoli'],
      macroRanges: { calories: [20, 55], proteinG: [2, 5], carbG: [4, 10], fatG: [0, 1] },
      expectedResolved: true,
    },
  },
  {
    id: 'wfs-006',
    category: 'whole_food_simple',
    label: 'Brown rice cooked',
    userInput: 'cooked brown rice',
    requiresClarification: false,
    layerBIdentity: {
      requiredTokens: ['rice'],
      forbiddenTokens: ['pudding', 'cake', 'crispy', 'crisp', 'milk', 'syrup'],
      note: 'Must match cooked brown rice grain — not rice pudding, rice cakes, or rice milk',
    },
    layerA: {
      ingredients: [{ name: 'brown rice cooked', quantity: 1, unit: 'cup' }],
      expectedNameTokens: ['brown', 'rice'],
      macroRanges: { calories: [180, 260], proteinG: [3, 7], carbG: [40, 55], fatG: [0, 3] },
      expectedResolved: true,
    },
  },
  {
    id: 'wfs-007',
    category: 'whole_food_simple',
    label: 'Whole milk',
    userInput: 'whole milk',
    requiresClarification: false,
    layerBIdentity: {
      requiredTokens: ['milk'],
      forbiddenTokens: ['almond', 'soy', 'oat', 'coconut', 'rice', 'hemp'],
      note: 'Must match dairy whole milk — not a plant-based milk alternative',
    },
    layerA: {
      ingredients: [{ name: 'whole milk', quantity: 1, unit: 'cup' }],
      expectedNameTokens: ['milk'],
      macroRanges: { calories: [140, 165], proteinG: [7, 10], carbG: [10, 14], fatG: [7, 10] },
      expectedResolved: true,
    },
  },
  {
    id: 'wfs-008',
    category: 'whole_food_simple',
    label: 'Cheddar cheese',
    userInput: 'cheddar cheese',
    requiresClarification: false,
    clarificationClass: 'acceptable_if_disclosed',
    layerBIdentity: {
      requiredTokens: ['cheddar'],
      note: 'Must match cheddar cheese',
    },
    layerA: {
      ingredients: [{ name: 'cheddar cheese', quantity: 1, unit: 'oz' }],
      expectedNameTokens: ['cheddar'],
      macroRanges: { calories: [100, 130], proteinG: [6, 9], carbG: [0, 2], fatG: [8, 12] },
      expectedResolved: true,
    },
  },
  {
    id: 'wfs-009',
    category: 'whole_food_simple',
    label: 'Spinach raw',
    userInput: 'raw spinach',
    requiresClarification: false,
    layerBIdentity: {
      requiredTokens: ['spinach'],
      forbiddenTokens: ['chicken', 'beef', 'pork', 'turkey', 'salmon', 'stuffed', 'pasta', 'dip', 'juice'],
      note: 'Must match spinach the vegetable — not a compound dish (stuffed chicken, spinach dip) or spinach juice',
    },
    layerA: {
      ingredients: [{ name: 'spinach raw', quantity: 1, unit: 'cup' }],
      expectedNameTokens: ['spinach'],
      macroRanges: { calories: [5, 15], proteinG: [0.5, 2], carbG: [0.5, 2], fatG: [0, 0.5] },
      expectedResolved: true,
    },
  },
  {
    id: 'wfs-010',
    category: 'whole_food_simple',
    label: 'Sweet potato',
    userInput: 'sweet potato',
    requiresClarification: false,
    clarificationClass: 'never',
    layerBIdentity: {
      requiredTokens: ['potato'],
      forbiddenTokens: ['pie', 'casserole', 'soup', 'fries', 'chip'],
      note: 'Must match sweet potato — not sweet potato pie, casserole, fries, or chips',
    },
    layerA: {
      ingredients: [{ name: 'sweet potato', quantity: 1, unit: 'medium' }],
      expectedNameTokens: ['sweet', 'potato'],
      macroRanges: { calories: [90, 140], proteinG: [1, 3], carbG: [22, 35], fatG: [0, 1] },
      expectedResolved: true,
    },
  },
]

// ── CATEGORY 2: Whole foods — count/measurement units ─────────────────────────

const WHOLE_FOOD_MEASURED: EvalScenario[] = [
  {
    id: 'wfm-001',
    category: 'whole_food_measured',
    label: '2 large eggs',
    userInput: '2 large eggs',
    requiresClarification: false,
    layerBIdentity: {
      requiredTokens: ['egg'],
      forbiddenTokens: ['salad', 'roll', 'casserole', 'quiche', 'sandwich'],
      note: 'Must match whole egg — not an egg-based dish',
    },
    layerA: {
      ingredients: [{ name: 'egg whole raw', quantity: 2, unit: 'large' }],
      expectedNameTokens: ['egg'],
      macroRanges: { calories: [120, 180], proteinG: [10, 16], carbG: [0, 2], fatG: [8, 14] },
      expectedResolved: true,
      expectedConversionSource: 'usda_foundation_portions',
    },
  },
  {
    id: 'wfm-002',
    category: 'whole_food_measured',
    label: '3 strips bacon',
    userInput: '3 strips of bacon',
    requiresClarification: false,
    layerBIdentity: {
      requiredTokens: ['bacon'],
      forbiddenTokens: ['flavor', 'flavored', 'seasoning', 'ranch'],
      note: 'Must match bacon the cured meat — not a bacon-flavored product',
    },
    layerA: {
      ingredients: [{ name: 'bacon', quantity: 3, unit: 'strip' }],
      expectedNameTokens: ['bacon'],
      macroRanges: { calories: [90, 160], proteinG: [6, 12], carbG: [0, 2], fatG: [7, 15] },
      expectedResolved: true,
    },
    notes: 'Known live fragility: FatSecret detail enrichment required for strip resolution',
  },
  {
    id: 'wfm-003',
    category: 'whole_food_measured',
    label: '1 cup cooked oatmeal',
    userInput: 'one cup of oatmeal cooked',
    requiresClarification: false,
    layerBIdentity: {
      requiredTokens: ['oat'],
      forbiddenTokens: ['cookie', 'bar', 'granola', 'muffin', 'cake'],
      note: 'Must match oats or oatmeal — not an oat-based baked good',
    },
    layerA: {
      ingredients: [{ name: 'oatmeal cooked', quantity: 1, unit: 'cup' }],
      expectedNameTokens: ['oat'],
      macroRanges: { calories: [140, 200], proteinG: [4, 8], carbG: [25, 40], fatG: [2, 5] },
      expectedResolved: true,
    },
  },
  {
    id: 'wfm-004',
    category: 'whole_food_measured',
    label: '2 tbsp peanut butter',
    userInput: '2 tablespoons of peanut butter',
    requiresClarification: false,
    layerBIdentity: {
      requiredTokens: ['peanut'],
      forbiddenTokens: ['cookie', 'cup', 'candy', 'bar'],
      note: 'Must match peanut butter — not a peanut butter cup or candy',
    },
    layerA: {
      ingredients: [{ name: 'peanut butter', quantity: 2, unit: 'tbsp' }],
      expectedNameTokens: ['peanut', 'butter'],
      macroRanges: { calories: [170, 210], proteinG: [7, 10], carbG: [5, 10], fatG: [14, 20] },
      expectedResolved: true,
    },
  },
  {
    id: 'wfm-005',
    category: 'whole_food_measured',
    label: 'Half avocado',
    userInput: 'half an avocado',
    requiresClarification: false,
    layerBIdentity: {
      requiredTokens: ['avocado'],
      forbiddenTokens: ['ranch', 'dressing', 'dip', 'toast', 'salad', 'oil'],
      note: 'Must match avocado the fruit — not avocado ranch dressing or avocado toast',
    },
    layerA: {
      ingredients: [{ name: 'avocado', quantity: 0.5, unit: 'medium' }],
      expectedNameTokens: ['avocado'],
      macroRanges: { calories: [100, 175], proteinG: [1, 3], carbG: [4, 10], fatG: [10, 18] },
      expectedResolved: true,
    },
  },
  {
    id: 'wfm-006',
    category: 'whole_food_measured',
    label: '4 oz chicken breast',
    userInput: '4 ounces of chicken breast grilled',
    requiresClarification: false,
    layerBIdentity: {
      requiredTokens: ['chicken'],
      forbiddenTokens: ['soup', 'salad', 'sandwich', 'casserole', 'nugget', 'wing', 'thigh', 'flavor'],
      note: 'Must match chicken breast meat — not a prepared dish containing chicken',
    },
    layerA: {
      ingredients: [{ name: 'chicken breast grilled', quantity: 4, unit: 'oz' }],
      expectedNameTokens: ['chicken', 'breast'],
      macroRanges: { calories: [140, 200], proteinG: [26, 36], carbG: [0, 3], fatG: [2, 7] },
      expectedResolved: true,
    },
  },
  {
    id: 'wfm-007',
    category: 'whole_food_measured',
    label: '1 tbsp olive oil',
    userInput: 'one tablespoon olive oil',
    requiresClarification: false,
    layerBIdentity: {
      requiredTokens: ['olive'],
      note: 'Must match olive oil',
    },
    layerA: {
      ingredients: [{ name: 'olive oil', quantity: 1, unit: 'tbsp' }],
      expectedNameTokens: ['olive', 'oil'],
      macroRanges: { calories: [110, 135], proteinG: [0, 0], carbG: [0, 0], fatG: [12, 16] },
      expectedResolved: true,
    },
  },
  {
    id: 'wfm-008',
    category: 'whole_food_measured',
    label: '3 oz salmon',
    userInput: '3 oz salmon',
    requiresClarification: false,
    layerBIdentity: {
      requiredTokens: ['salmon'],
      forbiddenTokens: ['salad', 'roll', 'sushi', 'dip', 'flavored', 'casserole'],
      note: 'Must match salmon the fish — not a dish with salmon as an ingredient',
    },
    layerA: {
      ingredients: [{ name: 'salmon', quantity: 3, unit: 'oz' }],
      expectedNameTokens: ['salmon'],
      macroRanges: { calories: [130, 200], proteinG: [16, 24], carbG: [0, 2], fatG: [5, 14] },
      expectedResolved: true,
    },
  },
  {
    id: 'wfm-009',
    category: 'whole_food_measured',
    label: '1/2 cup blueberries',
    userInput: 'half a cup of blueberries',
    requiresClarification: false,
    layerBIdentity: {
      requiredTokens: ['blueberr'],
      forbiddenTokens: ['muffin', 'pie', 'juice', 'jam', 'waffle'],
      note: 'Must match blueberries — not a blueberry baked good or juice',
    },
    layerA: {
      ingredients: [{ name: 'blueberries', quantity: 0.5, unit: 'cup' }],
      expectedNameTokens: ['blueberr'],
      macroRanges: { calories: [35, 55], proteinG: [0, 1], carbG: [9, 15], fatG: [0, 0.5] },
      expectedResolved: true,
    },
  },
  {
    id: 'wfm-010',
    category: 'whole_food_measured',
    label: '1 cup Greek yogurt',
    userInput: 'one cup plain Greek yogurt',
    requiresClarification: false,
    layerBIdentity: {
      requiredTokens: ['yogurt'],
      forbiddenTokens: ['ice cream', 'parfait', 'sauce', 'dip'],
      note: 'Must match yogurt — not a yogurt-based sauce or dessert',
    },
    layerA: {
      ingredients: [{ name: 'Greek yogurt plain', quantity: 1, unit: 'cup' }],
      expectedNameTokens: ['greek', 'yogurt'],
      macroRanges: { calories: [130, 200], proteinG: [15, 25], carbG: [7, 15], fatG: [0, 8] },
      expectedResolved: true,
    },
  },
]

// ── CATEGORY 3: Packaged/branded ──────────────────────────────────────────────

const PACKAGED_BRANDED: EvalScenario[] = [
  {
    id: 'pb-001',
    category: 'packaged_branded',
    label: 'Cheerios',
    userInput: 'a cup of Cheerios',
    requiresClarification: false,
    layerA: {
      ingredients: [{ name: 'Cheerios', quantity: 1, unit: 'cup' }],
      expectedNameTokens: ['cheerio'],
      macroRanges: { calories: [90, 120], proteinG: [2, 4], carbG: [18, 25], fatG: [1, 3] },
      expectedResolved: true,
    },
  },
  {
    id: 'pb-002',
    category: 'packaged_branded',
    label: 'Chobani plain Greek yogurt',
    userInput: 'Chobani plain Greek yogurt single serve',
    requiresClarification: false,
    layerA: {
      ingredients: [{ name: 'Chobani plain Greek yogurt', quantity: 1, unit: 'container' }],
      expectedNameTokens: ['chobani'],
      macroRanges: { calories: [70, 130], proteinG: [13, 20], carbG: [5, 12], fatG: [0, 5] },
      expectedResolved: true,
    },
  },
  {
    id: 'pb-003',
    category: 'packaged_branded',
    label: 'Jif peanut butter',
    userInput: '2 tablespoons Jif creamy peanut butter',
    requiresClarification: false,
    layerA: {
      ingredients: [{ name: 'Jif peanut butter', quantity: 2, unit: 'tbsp' }],
      expectedNameTokens: ['jif', 'peanut'],
      macroRanges: { calories: [170, 210], proteinG: [7, 10], carbG: [5, 10], fatG: [14, 20] },
      expectedResolved: true,
    },
  },
  {
    id: 'pb-004',
    category: 'packaged_branded',
    label: 'Kind bar dark chocolate nuts',
    userInput: 'Kind dark chocolate nuts and sea salt bar',
    requiresClarification: false,
    layerA: {
      ingredients: [{ name: 'Kind bar dark chocolate nuts', quantity: 1, unit: 'bar' }],
      expectedNameTokens: ['kind'],
      macroRanges: { calories: [170, 230], proteinG: [5, 8], carbG: [15, 22], fatG: [12, 18] },
      expectedResolved: true,
    },
  },
  {
    id: 'pb-005',
    category: 'packaged_branded',
    label: 'Quest bar chocolate chip cookie',
    userInput: 'Quest protein bar chocolate chip cookie dough',
    requiresClarification: false,
    layerA: {
      ingredients: [{ name: 'Quest protein bar chocolate chip cookie dough', quantity: 1, unit: 'bar' }],
      expectedNameTokens: ['quest'],
      macroRanges: { calories: [160, 220], proteinG: [18, 25], carbG: [20, 28], fatG: [6, 12] },
      expectedResolved: true,
    },
  },
  {
    id: 'pb-006',
    category: 'packaged_branded',
    label: "Lay's potato chips 1 oz",
    userInput: "one ounce Lays original potato chips",
    requiresClarification: false,
    layerA: {
      ingredients: [{ name: "Lays original potato chips", quantity: 1, unit: 'oz' }],
      expectedNameTokens: ['lay', 'chip'],
      macroRanges: { calories: [145, 175], proteinG: [1, 3], carbG: [14, 20], fatG: [8, 13] },
      expectedResolved: true,
    },
  },
  {
    id: 'pb-007',
    category: 'packaged_branded',
    label: 'Oreo cookies 3 cookies',
    userInput: '3 Oreo cookies',
    requiresClarification: false,
    layerA: {
      ingredients: [{ name: 'Oreo cookies', quantity: 3, unit: 'cookie' }],
      expectedNameTokens: ['oreo'],
      macroRanges: { calories: [140, 180], proteinG: [1, 3], carbG: [25, 32], fatG: [5, 9] },
      expectedResolved: true,
    },
  },
  {
    id: 'pb-008',
    category: 'packaged_branded',
    label: 'Silk unsweetened almond milk',
    userInput: 'Silk unsweetened almond milk one cup',
    requiresClarification: false,
    layerA: {
      ingredients: [{ name: 'Silk unsweetened almond milk', quantity: 1, unit: 'cup' }],
      expectedNameTokens: ['almond', 'milk'],
      macroRanges: { calories: [25, 45], proteinG: [0, 2], carbG: [1, 4], fatG: [2, 4] },
      expectedResolved: true,
    },
  },
  {
    id: 'pb-009',
    category: 'packaged_branded',
    label: 'Clif bar',
    userInput: 'Clif bar chocolate chip',
    requiresClarification: false,
    layerA: {
      ingredients: [{ name: 'Clif bar chocolate chip', quantity: 1, unit: 'bar' }],
      expectedNameTokens: ['clif'],
      macroRanges: { calories: [230, 280], proteinG: [9, 13], carbG: [40, 50], fatG: [4, 8] },
      expectedResolved: true,
    },
  },
  {
    id: 'pb-010',
    category: 'packaged_branded',
    label: 'Snickers bar (not mini)',
    userInput: 'Snickers bar',
    requiresClarification: false,
    layerA: {
      ingredients: [{ name: 'Snickers bar', quantity: 1, unit: 'bar' }],
      expectedNameTokens: ['snickers'],
      macroRanges: { calories: [230, 290], proteinG: [3, 6], carbG: [33, 42], fatG: [10, 15] },
      expectedResolved: true,
    },
    notes: 'Must not match Snickers Minis — size-diminutive penalty required',
  },
]

// ── CATEGORY 4: Restaurant meals ──────────────────────────────────────────────

const RESTAURANT: EvalScenario[] = [
  {
    id: 'rst-001',
    category: 'restaurant',
    label: "McDonald's Big Mac",
    userInput: "Big Mac from McDonald's",
    requiresClarification: false,
    layerA: {
      ingredients: [{ name: "McDonald's Big Mac", quantity: 1, unit: 'burger' }],
      expectedNameTokens: ['big mac'],
      macroRanges: { calories: [490, 620], proteinG: [24, 32], carbG: [40, 52], fatG: [24, 34] },
      expectedResolved: true,
    },
  },
  {
    id: 'rst-002',
    category: 'restaurant',
    label: 'Chipotle chicken burrito',
    userInput: 'Chipotle chicken burrito with rice and beans',
    requiresClarification: false,
    layerA: {
      ingredients: [{ name: 'Chipotle chicken burrito', quantity: 1, unit: 'burrito' }],
      expectedNameTokens: ['chipotle'],
      macroRanges: { calories: [700, 1100], proteinG: [40, 65], carbG: [70, 110], fatG: [20, 50] },
      expectedResolved: true,
    },
    notes: 'Range is wide because Chipotle burritos vary considerably by toppings',
  },
  {
    id: 'rst-003',
    category: 'restaurant',
    label: 'Starbucks latte grande',
    userInput: 'Starbucks latte grande with whole milk',
    requiresClarification: false,
    layerA: {
      ingredients: [{ name: 'Starbucks latte grande whole milk', quantity: 1, unit: 'serving' }],
      expectedNameTokens: ['starbucks', 'latte'],
      macroRanges: { calories: [160, 230], proteinG: [10, 16], carbG: [14, 22], fatG: [7, 13] },
      expectedResolved: true,
    },
  },
  {
    id: 'rst-004',
    category: 'restaurant',
    label: "Chick-fil-A grilled chicken sandwich",
    userInput: "Chick-fil-A grilled chicken sandwich",
    requiresClarification: false,
    layerA: {
      ingredients: [{ name: "Chick-fil-A grilled chicken sandwich", quantity: 1, unit: 'sandwich' }],
      expectedNameTokens: ['chick-fil-a', 'chicken', 'sandwich'],
      macroRanges: { calories: [280, 380], proteinG: [28, 38], carbG: [35, 48], fatG: [5, 12] },
      expectedResolved: true,
    },
  },
  {
    id: 'rst-005',
    category: 'restaurant',
    label: 'Dominos pepperoni pizza 2 slices',
    userInput: '2 slices of Dominos pepperoni pizza',
    requiresClarification: false,
    layerA: {
      ingredients: [{ name: "Domino's pepperoni pizza", quantity: 2, unit: 'slice' }],
      expectedNameTokens: ['domino', 'pizza', 'pepperoni'],
      macroRanges: { calories: [440, 620], proteinG: [20, 32], carbG: [48, 68], fatG: [18, 30] },
      expectedResolved: true,
    },
  },
  {
    id: 'rst-006',
    category: 'restaurant',
    label: 'Taco Bell chicken soft taco',
    userInput: 'Taco Bell chicken soft taco',
    requiresClarification: false,
    layerA: {
      ingredients: [{ name: 'Taco Bell soft taco chicken', quantity: 1, unit: 'taco' }],
      expectedNameTokens: ['taco bell'],
      macroRanges: { calories: [140, 210], proteinG: [12, 18], carbG: [16, 24], fatG: [5, 11] },
      expectedResolved: true,
    },
  },
  {
    id: 'rst-007',
    category: 'restaurant',
    label: 'Subway 6-inch turkey sub',
    userInput: 'Subway 6 inch turkey breast sandwich',
    requiresClarification: false,
    layerA: {
      ingredients: [{ name: 'Subway 6 inch turkey breast', quantity: 1, unit: 'sandwich' }],
      expectedNameTokens: ['subway', 'turkey'],
      macroRanges: { calories: [240, 340], proteinG: [18, 28], carbG: [38, 50], fatG: [3, 9] },
      expectedResolved: true,
    },
  },
  {
    id: 'rst-008',
    category: 'restaurant',
    label: 'In-N-Out double-double',
    userInput: 'In-N-Out double-double burger',
    requiresClarification: false,
    layerA: {
      ingredients: [{ name: "In-N-Out double double", quantity: 1, unit: 'burger' }],
      expectedNameTokens: ['in-n-out', 'double'],
      macroRanges: { calories: [580, 750], proteinG: [34, 45], carbG: [36, 50], fatG: [32, 46] },
      expectedResolved: true,
    },
  },
  {
    id: 'rst-009',
    category: 'restaurant',
    label: 'Panera cup chicken noodle soup',
    userInput: 'Panera chicken noodle soup cup',
    requiresClarification: false,
    layerA: {
      ingredients: [{ name: 'Panera chicken noodle soup', quantity: 1, unit: 'cup' }],
      expectedNameTokens: ['panera', 'chicken', 'soup'],
      macroRanges: { calories: [90, 160], proteinG: [7, 14], carbG: [12, 20], fatG: [2, 7] },
      expectedResolved: true,
    },
  },
  {
    id: 'rst-010',
    category: 'restaurant',
    label: "Dunkin' medium latte oat milk",
    userInput: "Dunkin medium oat milk latte",
    requiresClarification: false,
    layerA: {
      ingredients: [{ name: "Dunkin oat milk latte medium", quantity: 1, unit: 'serving' }],
      expectedNameTokens: ['dunkin'],
      macroRanges: { calories: [130, 210], proteinG: [3, 8], carbG: [20, 35], fatG: [3, 8] },
      expectedResolved: true,
    },
  },
]

// ── CATEGORY 5: Homemade/mixed dishes ─────────────────────────────────────────

const HOMEMADE: EvalScenario[] = [
  {
    id: 'hm-001',
    category: 'homemade',
    label: 'Homemade lasagna',
    userInput: 'homemade lasagna one serving',
    requiresClarification: true,
    clarificationReason: 'serving size for homemade dishes is ambiguous without recipe details',
  },
  {
    id: 'hm-002',
    category: 'homemade',
    label: 'Spaghetti bolognese',
    userInput: 'spaghetti bolognese',
    requiresClarification: false,
    layerA: {
      ingredients: [{ name: 'spaghetti with meat sauce', quantity: 1, unit: 'cup' }],
      expectedNameTokens: ['spaghetti'],
      macroRanges: { calories: [200, 380], proteinG: [10, 22], carbG: [28, 48], fatG: [6, 16] },
      expectedResolved: true,
    },
  },
  {
    id: 'hm-003',
    category: 'homemade',
    label: 'Chicken and rice bowl',
    userInput: 'chicken rice and broccoli bowl',
    requiresClarification: false,
    layerA: {
      ingredients: [
        { name: 'grilled chicken breast', quantity: 4, unit: 'oz' },
        { name: 'white rice cooked', quantity: 1, unit: 'cup' },
        { name: 'broccoli', quantity: 1, unit: 'cup' },
      ],
      expectedNameTokens: ['chicken'],
      macroRanges: { calories: [380, 580], proteinG: [35, 55], carbG: [50, 80], fatG: [5, 15] },
      expectedResolved: true,
    },
  },
  {
    id: 'hm-004',
    category: 'homemade',
    label: 'Caesar salad with chicken',
    userInput: 'Caesar salad with grilled chicken and parmesan',
    requiresClarification: false,
    layerA: {
      ingredients: [{ name: 'Caesar salad with chicken', quantity: 1, unit: 'serving' }],
      expectedNameTokens: ['caesar', 'salad'],
      macroRanges: { calories: [350, 600], proteinG: [25, 45], carbG: [10, 25], fatG: [22, 40] },
      expectedResolved: true,
    },
  },
  {
    id: 'hm-005',
    category: 'homemade',
    label: 'Turkey sandwich whole wheat',
    userInput: 'turkey and cheese sandwich on whole wheat bread',
    requiresClarification: false,
    layerA: {
      ingredients: [
        { name: 'turkey breast deli', quantity: 2, unit: 'oz' },
        { name: 'whole wheat bread', quantity: 2, unit: 'slice' },
        { name: 'cheddar cheese', quantity: 1, unit: 'slice' },
      ],
      expectedNameTokens: ['turkey'],
      macroRanges: { calories: [300, 460], proteinG: [22, 36], carbG: [30, 46], fatG: [8, 18] },
      expectedResolved: true,
    },
  },
  {
    id: 'hm-006',
    category: 'homemade',
    label: 'Beef tacos 2',
    userInput: '2 homemade beef tacos with corn tortilla',
    requiresClarification: false,
    layerA: {
      ingredients: [
        { name: 'ground beef cooked', quantity: 3, unit: 'oz' },
        { name: 'corn tortilla', quantity: 2, unit: 'piece' },
      ],
      expectedNameTokens: ['beef'],
      macroRanges: { calories: [320, 500], proteinG: [18, 28], carbG: [28, 42], fatG: [14, 26] },
      expectedResolved: true,
    },
  },
  {
    id: 'hm-007',
    category: 'homemade',
    label: 'Protein smoothie',
    userInput: 'protein smoothie with banana almond milk and protein powder',
    requiresClarification: false,
    layerA: {
      ingredients: [
        { name: 'whey protein powder', quantity: 1, unit: 'scoop' },
        { name: 'banana', quantity: 1, unit: 'medium' },
        { name: 'unsweetened almond milk', quantity: 1, unit: 'cup' },
      ],
      expectedNameTokens: ['protein'],
      macroRanges: { calories: [230, 380], proteinG: [22, 38], carbG: [25, 45], fatG: [3, 9] },
      expectedResolved: true,
    },
  },
  {
    id: 'hm-008',
    category: 'homemade',
    label: 'Tomato soup',
    userInput: 'bowl of tomato soup',
    requiresClarification: true,
    clarificationReason: 'bowl size is ambiguous; homemade vs canned affects macros significantly',
  },
]

// ── CATEGORY 6: Drinks ────────────────────────────────────────────────────────

const DRINK: EvalScenario[] = [
  {
    id: 'drk-001',
    category: 'drink',
    label: 'Black coffee',
    userInput: 'black coffee 12 oz',
    requiresClarification: false,
    layerA: {
      ingredients: [{ name: 'black coffee', quantity: 12, unit: 'fl oz' }],
      expectedNameTokens: ['coffee'],
      macroRanges: { calories: [0, 10], proteinG: [0, 1], carbG: [0, 1], fatG: [0, 0.5] },
      expectedResolved: true,
    },
  },
  {
    id: 'drk-002',
    category: 'drink',
    label: 'Orange juice 12 oz',
    userInput: '12 oz orange juice',
    requiresClarification: false,
    layerA: {
      ingredients: [{ name: 'orange juice', quantity: 12, unit: 'fl oz' }],
      expectedNameTokens: ['orange', 'juice'],
      macroRanges: { calories: [145, 200], proteinG: [1, 3], carbG: [33, 45], fatG: [0, 0.5] },
      expectedResolved: true,
    },
  },
  {
    id: 'drk-003',
    category: 'drink',
    label: 'Gatorade 20 oz',
    userInput: '20 oz Gatorade fruit punch',
    requiresClarification: false,
    layerA: {
      ingredients: [{ name: 'Gatorade fruit punch', quantity: 20, unit: 'fl oz' }],
      expectedNameTokens: ['gatorade'],
      macroRanges: { calories: [120, 160], proteinG: [0, 1], carbG: [30, 42], fatG: [0, 0.5] },
      expectedResolved: true,
    },
  },
  {
    id: 'drk-004',
    category: 'drink',
    label: 'Diet Coke can',
    userInput: 'can of Diet Coke',
    requiresClarification: false,
    layerA: {
      ingredients: [{ name: 'Diet Coke', quantity: 12, unit: 'fl oz' }],
      expectedNameTokens: ['diet', 'coke'],
      macroRanges: { calories: [0, 5], proteinG: [0, 0.2], carbG: [0, 0.5], fatG: [0, 0] },
      expectedResolved: true,
    },
  },
  {
    id: 'drk-005',
    category: 'drink',
    label: 'Red wine 5 oz',
    userInput: 'glass of red wine',
    requiresClarification: false,
    layerA: {
      ingredients: [{ name: 'red wine', quantity: 5, unit: 'fl oz' }],
      expectedNameTokens: ['red', 'wine'],
      macroRanges: { calories: [110, 150], proteinG: [0, 0.5], carbG: [2, 5], fatG: [0, 0] },
      expectedResolved: true,
    },
  },
  {
    id: 'drk-006',
    category: 'drink',
    label: 'Beer 12 oz',
    userInput: 'regular beer 12 oz',
    requiresClarification: false,
    layerA: {
      ingredients: [{ name: 'beer regular', quantity: 12, unit: 'fl oz' }],
      expectedNameTokens: ['beer'],
      macroRanges: { calories: [130, 170], proteinG: [1, 2], carbG: [10, 15], fatG: [0, 0] },
      expectedResolved: true,
    },
  },
  {
    id: 'drk-007',
    category: 'drink',
    label: 'Green tea unsweetened',
    userInput: 'unsweetened green tea 8 oz',
    requiresClarification: false,
    layerA: {
      ingredients: [{ name: 'green tea brewed', quantity: 8, unit: 'fl oz' }],
      expectedNameTokens: ['green', 'tea'],
      macroRanges: { calories: [0, 5], proteinG: [0, 0.5], carbG: [0, 1], fatG: [0, 0] },
      expectedResolved: true,
    },
  },
  {
    id: 'drk-008',
    category: 'drink',
    label: 'Coconut water',
    userInput: '11 oz coconut water',
    requiresClarification: false,
    layerA: {
      ingredients: [{ name: 'coconut water', quantity: 11, unit: 'fl oz' }],
      expectedNameTokens: ['coconut', 'water'],
      macroRanges: { calories: [55, 90], proteinG: [0, 2], carbG: [13, 22], fatG: [0, 0.5] },
      expectedResolved: true,
    },
  },
]

// ── CATEGORY 7: Cooking ingredients ──────────────────────────────────────────

const COOKING_INGREDIENT: EvalScenario[] = [
  {
    id: 'ci-001',
    category: 'cooking_ingredient',
    label: '1 cup all-purpose flour',
    userInput: 'one cup all purpose flour',
    requiresClarification: false,
    layerA: {
      ingredients: [{ name: 'all purpose flour', quantity: 1, unit: 'cup' }],
      expectedNameTokens: ['flour'],
      macroRanges: { calories: [400, 520], proteinG: [10, 16], carbG: [82, 100], fatG: [1, 3] },
      expectedResolved: true,
    },
  },
  {
    id: 'ci-002',
    category: 'cooking_ingredient',
    label: '1 tbsp butter',
    userInput: 'one tablespoon butter',
    requiresClarification: false,
    layerA: {
      ingredients: [{ name: 'butter', quantity: 1, unit: 'tbsp' }],
      expectedNameTokens: ['butter'],
      macroRanges: { calories: [95, 115], proteinG: [0, 0.2], carbG: [0, 0.1], fatG: [10, 13] },
      expectedResolved: true,
    },
  },
  {
    id: 'ci-003',
    category: 'cooking_ingredient',
    label: '2 cloves garlic',
    userInput: '2 cloves of garlic',
    requiresClarification: false,
    layerA: {
      ingredients: [{ name: 'garlic', quantity: 2, unit: 'clove' }],
      expectedNameTokens: ['garlic'],
      macroRanges: { calories: [6, 15], proteinG: [0, 0.5], carbG: [2, 4], fatG: [0, 0.1] },
      expectedResolved: true,
    },
  },
  {
    id: 'ci-004',
    category: 'cooking_ingredient',
    label: '1 tbsp honey',
    userInput: 'tablespoon of honey',
    requiresClarification: false,
    layerA: {
      ingredients: [{ name: 'honey', quantity: 1, unit: 'tbsp' }],
      expectedNameTokens: ['honey'],
      macroRanges: { calories: [58, 72], proteinG: [0, 0.1], carbG: [16, 20], fatG: [0, 0] },
      expectedResolved: true,
    },
  },
  {
    id: 'ci-005',
    category: 'cooking_ingredient',
    label: '1/2 cup heavy cream',
    userInput: 'half cup heavy cream',
    requiresClarification: false,
    layerA: {
      ingredients: [{ name: 'heavy cream', quantity: 0.5, unit: 'cup' }],
      expectedNameTokens: ['cream'],
      macroRanges: { calories: [380, 430], proteinG: [2, 4], carbG: [2, 5], fatG: [40, 48] },
      expectedResolved: true,
    },
  },
  {
    id: 'ci-006',
    category: 'cooking_ingredient',
    label: '1 tsp baking soda',
    userInput: 'one teaspoon baking soda',
    requiresClarification: false,
    layerA: {
      ingredients: [{ name: 'baking soda', quantity: 1, unit: 'tsp' }],
      expectedNameTokens: ['baking', 'soda'],
      macroRanges: { calories: [0, 5], proteinG: [0, 0], carbG: [0, 1], fatG: [0, 0] },
      expectedResolved: true,
    },
  },
]

// ── CATEGORY 8: Household measurements ────────────────────────────────────────

const HOUSEHOLD_MEASUREMENT: EvalScenario[] = [
  {
    id: 'hh-001',
    category: 'household_measurement',
    label: 'Bowl of oatmeal',
    userInput: 'a bowl of oatmeal with honey',
    requiresClarification: true,
    clarificationReason: 'bowl size varies; needs clarification on amount',
  },
  {
    id: 'hh-002',
    category: 'household_measurement',
    label: 'Handful of almonds',
    userInput: 'a handful of almonds',
    requiresClarification: false,
    layerA: {
      ingredients: [{ name: 'almonds', quantity: 1, unit: 'oz' }],
      expectedNameTokens: ['almond'],
      macroRanges: { calories: [150, 185], proteinG: [5, 8], carbG: [4, 8], fatG: [12, 18] },
      expectedResolved: true,
    },
    notes: 'A handful is approximately 1 oz / 28g — V should use this approximation',
  },
  {
    id: 'hh-003',
    category: 'household_measurement',
    label: 'Slice of pizza',
    userInput: 'a slice of pizza',
    requiresClarification: true,
    clarificationReason: 'size, toppings, and chain all affect nutrition significantly',
  },
  {
    id: 'hh-004',
    category: 'household_measurement',
    label: 'Cup of chicken broth',
    userInput: 'a cup of chicken broth',
    requiresClarification: false,
    layerA: {
      ingredients: [{ name: 'chicken broth', quantity: 1, unit: 'cup' }],
      expectedNameTokens: ['chicken', 'broth'],
      macroRanges: { calories: [8, 20], proteinG: [1, 4], carbG: [0, 2], fatG: [0, 1] },
      expectedResolved: true,
    },
  },
  {
    id: 'hh-005',
    category: 'household_measurement',
    label: 'A glass of orange juice',
    userInput: 'a glass of orange juice',
    requiresClarification: true,
    clarificationReason: 'glass size is ambiguous without specifying volume',
  },
  {
    id: 'hh-006',
    category: 'household_measurement',
    label: 'Big salad',
    userInput: 'a big salad with chicken and veggies',
    requiresClarification: true,
    clarificationReason: 'salad type, dressing, and chicken amount are unknown',
  },
  {
    id: 'hh-007',
    category: 'household_measurement',
    label: 'A spoonful of peanut butter',
    userInput: 'a spoonful of peanut butter',
    requiresClarification: false,
    layerA: {
      ingredients: [{ name: 'peanut butter', quantity: 1, unit: 'tbsp' }],
      expectedNameTokens: ['peanut', 'butter'],
      macroRanges: { calories: [85, 110], proteinG: [3, 5], carbG: [3, 6], fatG: [7, 10] },
      expectedResolved: true,
    },
    notes: 'A spoonful ≈ 1 tbsp — a reasonable V assumption without asking',
  },
  {
    id: 'hh-008',
    category: 'household_measurement',
    label: 'A small side of rice',
    userInput: 'a small side of white rice',
    requiresClarification: false,
    layerA: {
      ingredients: [{ name: 'white rice cooked', quantity: 0.5, unit: 'cup' }],
      expectedNameTokens: ['rice'],
      macroRanges: { calories: [90, 130], proteinG: [2, 4], carbG: [22, 32], fatG: [0, 1] },
      expectedResolved: true,
    },
    notes: 'A small side ≈ 1/2 cup; V should estimate and disclose the assumption',
  },
]

// ── CATEGORY 9: Casual/vague language ─────────────────────────────────────────

const CASUAL_VAGUE: EvalScenario[] = [
  {
    id: 'cv-001',
    category: 'casual_vague',
    label: 'Some trail mix',
    userInput: 'some trail mix',
    requiresClarification: true,
    clarificationReason: 'amount required',
  },
  {
    id: 'cv-002',
    category: 'casual_vague',
    label: 'Couple pieces of pizza',
    userInput: 'ate a couple pieces of pizza for dinner',
    requiresClarification: true,
    clarificationReason: 'size, toppings, and restaurant/homemade unknown',
  },
  {
    id: 'cv-003',
    category: 'casual_vague',
    label: 'Chips and guac',
    userInput: 'chips and guac',
    requiresClarification: true,
    clarificationReason: 'amount of both chips and guacamole is unknown',
  },
  {
    id: 'cv-004',
    category: 'casual_vague',
    label: 'Leftover pasta',
    userInput: 'some leftover pasta',
    requiresClarification: true,
    clarificationReason: 'type, sauce, and amount unknown',
  },
  {
    id: 'cv-005',
    category: 'casual_vague',
    label: 'Just nuts',
    userInput: 'had some nuts as a snack',
    requiresClarification: true,
    clarificationReason: 'type and amount both unknown',
  },
  {
    id: 'cv-006',
    category: 'casual_vague',
    label: 'Protein shake',
    userInput: 'protein shake after my workout',
    requiresClarification: true,
    clarificationReason: 'brand/flavor/size/water-or-milk unknown',
  },
  {
    id: 'cv-007',
    category: 'casual_vague',
    label: 'Salad for lunch',
    userInput: 'had a salad for lunch',
    requiresClarification: true,
    clarificationReason: 'type of salad, dressing, and any protein unknown',
  },
  {
    id: 'cv-008',
    category: 'casual_vague',
    label: 'Granola',
    userInput: 'had some granola with milk',
    requiresClarification: true,
    clarificationReason: 'amount of both granola and milk unknown',
  },
  {
    id: 'cv-009',
    category: 'casual_vague',
    label: 'Wrap',
    userInput: 'I had a wrap for lunch',
    requiresClarification: true,
    clarificationReason: 'fillings and size unknown',
  },
  {
    id: 'cv-010',
    category: 'casual_vague',
    label: 'Something small',
    userInput: 'I had something small before bed',
    requiresClarification: true,
    clarificationReason: 'completely unspecified food',
  },
]

// ── CATEGORY 10: Misspellings ─────────────────────────────────────────────────

const MISSPELLING: EvalScenario[] = [
  {
    id: 'ms-001',
    category: 'misspelling',
    label: 'Chicken breast (misspelled)',
    userInput: 'chiken breast grilled',
    requiresClarification: false,
    layerA: {
      ingredients: [{ name: 'chiken breast', quantity: 100, unit: 'g' }],
      expectedNameTokens: ['chicken', 'breast'],
      macroRanges: { calories: [130, 200], proteinG: [25, 38], carbG: [0, 3], fatG: [1, 6] },
      expectedResolved: true,
    },
    notes: 'Quality gate and fuzzy search must tolerate "chiken"',
  },
  {
    id: 'ms-002',
    category: 'misspelling',
    label: 'Avocado (misspelled)',
    userInput: 'avacado',
    requiresClarification: false,
    layerA: {
      ingredients: [{ name: 'avacado', quantity: 1, unit: 'medium' }],
      expectedNameTokens: ['avocado'],
      macroRanges: { calories: [190, 280], proteinG: [2, 4], carbG: [9, 16], fatG: [18, 28] },
      expectedResolved: true,
    },
    notes: '"avacado" is a very common misspelling — must not return no_match',
  },
  {
    id: 'ms-003',
    category: 'misspelling',
    label: 'Sweet potato (misspelled)',
    userInput: 'sweat potato',
    requiresClarification: false,
    layerA: {
      ingredients: [{ name: 'sweat potato', quantity: 1, unit: 'medium' }],
      expectedNameTokens: ['sweet', 'potato'],
      macroRanges: { calories: [90, 140], proteinG: [1, 3], carbG: [22, 35], fatG: [0, 1] },
      expectedResolved: true,
    },
  },
  {
    id: 'ms-004',
    category: 'misspelling',
    label: 'Edamame (redundant word)',
    userInput: 'edamame beans',
    requiresClarification: false,
    layerA: {
      ingredients: [{ name: 'edamame beans', quantity: 1, unit: 'cup' }],
      expectedNameTokens: ['edamame'],
      macroRanges: { calories: [150, 220], proteinG: [15, 22], carbG: [11, 18], fatG: [7, 12] },
      expectedResolved: true,
    },
  },
  {
    id: 'ms-005',
    category: 'misspelling',
    label: 'Acai bowl',
    userInput: 'acai bowl',
    requiresClarification: true,
    clarificationReason: 'contents vary enormously; toppings and size needed',
  },
]

// ── CATEGORY 11: Corrections ──────────────────────────────────────────────────

const CORRECTION: EvalScenario[] = [
  {
    id: 'cor-001',
    category: 'correction',
    label: 'More eggs than stated',
    userInput: 'actually make that 3 eggs not 2',
    requiresClarification: false,
    notes: 'Requires re-running calculateNutrition with corrected quantity',
  },
  {
    id: 'cor-002',
    category: 'correction',
    label: 'Almond milk not dairy',
    userInput: 'I meant almond milk not regular milk',
    requiresClarification: false,
    notes: 'Different ingredient — must re-calculate',
  },
  {
    id: 'cor-003',
    category: 'correction',
    label: 'Larger serving',
    userInput: 'that was a large coffee not a medium',
    requiresClarification: false,
    notes: 'Size correction — must re-calculate',
  },
  {
    id: 'cor-004',
    category: 'correction',
    label: 'Whole wheat not white',
    userInput: 'actually it was whole wheat bread not white',
    requiresClarification: false,
    notes: 'Variety correction — must re-calculate',
  },
  {
    id: 'cor-005',
    category: 'correction',
    label: 'Grilled not fried',
    userInput: 'I had the grilled version not fried',
    requiresClarification: false,
    notes: 'Preparation state correction — must re-calculate',
  },
]

// ── CATEGORY 12: Multi-food meals ─────────────────────────────────────────────

const MULTI_FOOD: EvalScenario[] = [
  {
    id: 'mf-001',
    category: 'multi_food',
    label: 'Eggs bacon toast coffee',
    userInput: '2 eggs, 3 strips of bacon, 2 slices of toast, and a black coffee',
    requiresClarification: false,
    layerA: {
      ingredients: [
        { name: 'egg whole scrambled', quantity: 2, unit: 'large' },
        { name: 'bacon', quantity: 3, unit: 'strip' },
        { name: 'whole wheat toast', quantity: 2, unit: 'slice' },
        { name: 'black coffee', quantity: 1, unit: 'cup' },
      ],
      expectedNameTokens: ['egg'],
      macroRanges: { calories: [380, 600], proteinG: [22, 36], carbG: [30, 50], fatG: [18, 35] },
      expectedResolved: false, // bacon may not resolve due to enrichment dependency
    },
  },
  {
    id: 'mf-002',
    category: 'multi_food',
    label: 'Chicken rice broccoli',
    userInput: '6 oz grilled chicken, 1 cup white rice, 1 cup broccoli',
    requiresClarification: false,
    layerA: {
      ingredients: [
        { name: 'chicken breast grilled', quantity: 6, unit: 'oz' },
        { name: 'white rice cooked', quantity: 1, unit: 'cup' },
        { name: 'broccoli', quantity: 1, unit: 'cup' },
      ],
      expectedNameTokens: ['chicken'],
      macroRanges: { calories: [450, 640], proteinG: [48, 65], carbG: [50, 70], fatG: [5, 12] },
      expectedResolved: true,
    },
  },
  {
    id: 'mf-003',
    category: 'multi_food',
    label: 'Oatmeal banana PB breakfast',
    userInput: 'oatmeal with half a banana and a tablespoon of peanut butter',
    requiresClarification: false,
    layerA: {
      ingredients: [
        { name: 'oatmeal cooked', quantity: 1, unit: 'cup' },
        { name: 'banana', quantity: 0.5, unit: 'medium' },
        { name: 'peanut butter', quantity: 1, unit: 'tbsp' },
      ],
      expectedNameTokens: ['oat'],
      macroRanges: { calories: [280, 400], proteinG: [8, 15], carbG: [50, 70], fatG: [7, 14] },
      expectedResolved: true,
    },
  },
  {
    id: 'mf-004',
    category: 'multi_food',
    label: 'Salad with chicken and avocado',
    userInput: 'big salad with 4 oz chicken, half an avocado, and 2 tbsp ranch dressing',
    requiresClarification: false,
    layerA: {
      ingredients: [
        { name: 'mixed greens', quantity: 2, unit: 'cup' },
        { name: 'chicken breast grilled', quantity: 4, unit: 'oz' },
        { name: 'avocado', quantity: 0.5, unit: 'medium' },
        { name: 'ranch dressing', quantity: 2, unit: 'tbsp' },
      ],
      expectedNameTokens: ['chicken'],
      macroRanges: { calories: [430, 620], proteinG: [30, 46], carbG: [8, 18], fatG: [32, 50] },
      expectedResolved: true,
    },
  },
  {
    id: 'mf-005',
    category: 'multi_food',
    label: 'Post-workout shake',
    userInput: 'protein shake with 2 scoops whey, banana, and 2 cups milk',
    requiresClarification: false,
    layerA: {
      ingredients: [
        { name: 'whey protein powder', quantity: 2, unit: 'scoop' },
        { name: 'banana', quantity: 1, unit: 'medium' },
        { name: 'whole milk', quantity: 2, unit: 'cup' },
      ],
      expectedNameTokens: ['whey', 'protein'],
      macroRanges: { calories: [500, 720], proteinG: [50, 75], carbG: [55, 80], fatG: [10, 22] },
      expectedResolved: true,
    },
  },
]

// ── CATEGORY 13: Partial-meal logging ─────────────────────────────────────────

const PARTIAL_LOG: EvalScenario[] = [
  {
    id: 'pl-001',
    category: 'partial_log',
    label: 'Log eggs skip bacon',
    userInput: 'log the eggs but skip the bacon',
    requiresClarification: false,
    notes: 'Tests includeIngredientIndexes selection from a prior calculation',
  },
  {
    id: 'pl-002',
    category: 'partial_log',
    label: 'Log just the protein shake',
    userInput: 'add just the protein shake to my log',
    requiresClarification: false,
    notes: 'Single item selection from a multi-ingredient calculation',
  },
  {
    id: 'pl-003',
    category: 'partial_log',
    label: 'Log chicken and rice, not broccoli',
    userInput: 'log the chicken and rice but not the broccoli',
    requiresClarification: false,
    notes: '2 of 3 items selected by name',
  },
  {
    id: 'pl-004',
    category: 'partial_log',
    label: 'Log only what you could identify',
    userInput: 'just log whatever you were able to identify',
    requiresClarification: false,
    notes: 'All resolved ingredients — equivalent to omitting includeIngredientIndexes',
  },
  {
    id: 'pl-005',
    category: 'partial_log',
    label: 'Log the salmon, skip the sauce',
    userInput: "log the salmon, don't worry about the sauce",
    requiresClarification: false,
    notes: 'Explicit single-ingredient selection when sauce was unresolved',
  },
]

// ── CATEGORY 14: Provider failure scenarios ────────────────────────────────────

const PROVIDER_FAILURE: EvalScenario[] = [
  {
    id: 'pf-001',
    category: 'provider_failure',
    label: 'FatSecret down → USDA fallback',
    userInput: 'banana',
    requiresClarification: false,
    layerA: {
      ingredients: [{ name: 'banana', quantity: 1, unit: 'medium' }],
      expectedNameTokens: ['banana'],
      macroRanges: { calories: [80, 130], proteinG: [0, 2], carbG: [20, 35], fatG: [0, 1] },
      expectedResolved: true,
    },
    notes: 'Run with FatSecret mocked to return empty — USDA should still resolve banana',
  },
  {
    id: 'pf-002',
    category: 'provider_failure',
    label: 'FatSecret IP restricted (Error 21)',
    userInput: 'chicken breast',
    requiresClarification: false,
    layerA: {
      ingredients: [{ name: 'chicken breast', quantity: 100, unit: 'g' }],
      expectedNameTokens: ['chicken', 'breast'],
      macroRanges: { calories: [100, 180], proteinG: [20, 35], carbG: [0, 3], fatG: [1, 6] },
      expectedResolved: true,
    },
    notes: 'Run with FatSecret returning Error 21 body — USDA should still resolve chicken',
  },
  {
    id: 'pf-003',
    category: 'provider_failure',
    label: 'USDA HTTP 400',
    userInput: "M&M's candy",
    requiresClarification: false,
    layerA: {
      ingredients: [{ name: "M&M's candy", quantity: 1, unit: 'oz' }],
      expectedNameTokens: ["m&m"],
      macroRanges: { calories: [130, 160], proteinG: [1, 2], carbG: [22, 30], fatG: [5, 8] },
      expectedResolved: true,
    },
    notes: "Apostrophe in query triggers USDA HTTP 400; USDA normalizes M&M's → 'M M s'",
  },
  {
    id: 'pf-004',
    category: 'provider_failure',
    label: 'All providers timeout',
    userInput: 'Greek yogurt',
    requiresClarification: false,
    expectsNoMatch: true,
    layerA: {
      ingredients: [{ name: 'greek yogurt', quantity: 1, unit: 'cup' }],
      expectedNameTokens: ['yogurt'],
      macroRanges: { calories: [0, 9999], proteinG: [0, 9999], carbG: [0, 9999], fatG: [0, 9999] },
      expectedResolved: false,
    },
    notes: 'Run with all providers mocked to throw AbortError — should return unresolved cleanly',
  },
  {
    id: 'pf-005',
    category: 'provider_failure',
    label: 'Obscure food with thin provider coverage',
    userInput: 'chanterelle mushrooms',
    requiresClarification: false,
    layerA: {
      ingredients: [{ name: 'chanterelle mushrooms', quantity: 1, unit: 'cup' }],
      expectedNameTokens: ['chanterelle'],
      macroRanges: { calories: [15, 40], proteinG: [1, 4], carbG: [3, 8], fatG: [0, 1] },
      expectedResolved: true,
    },
    notes: 'Obscure whole food — likely only in USDA Foundation/SR Legacy',
  },
]

// ── CATEGORY 15: Held-out unfamiliar foods ─────────────────────────────────────

const HELD_OUT: EvalScenario[] = [
  {
    id: 'ho-001',
    category: 'held_out',
    label: 'Durian fruit',
    userInput: '100g durian fruit',
    requiresClarification: false,
    layerA: {
      ingredients: [{ name: 'durian', quantity: 100, unit: 'g' }],
      expectedNameTokens: ['durian'],
      macroRanges: { calories: [120, 175], proteinG: [1, 4], carbG: [25, 38], fatG: [3, 8] },
      expectedResolved: true,
    },
    notes: 'Exotic tropical fruit — not referenced anywhere in production matching rules',
  },
  {
    id: 'ho-002',
    category: 'held_out',
    label: 'Taro root cooked',
    userInput: '1 cup cooked taro root',
    requiresClarification: false,
    layerA: {
      ingredients: [{ name: 'taro root cooked', quantity: 1, unit: 'cup' }],
      expectedNameTokens: ['taro'],
      macroRanges: { calories: [150, 230], proteinG: [0.5, 2], carbG: [35, 55], fatG: [0, 1] },
      expectedResolved: true,
    },
    notes: 'Pacific/Caribbean staple food — tests general whole-food coverage',
  },
  {
    id: 'ho-003',
    category: 'held_out',
    label: 'Jackfruit',
    userInput: '100 grams raw jackfruit',
    requiresClarification: false,
    layerA: {
      ingredients: [{ name: 'jackfruit raw', quantity: 100, unit: 'g' }],
      expectedNameTokens: ['jackfruit'],
      macroRanges: { calories: [75, 115], proteinG: [1, 3], carbG: [18, 28], fatG: [0, 1] },
      expectedResolved: true,
    },
  },
  {
    id: 'ho-004',
    category: 'held_out',
    label: 'Fenugreek seeds',
    userInput: 'one teaspoon fenugreek seeds',
    requiresClarification: false,
    layerA: {
      ingredients: [{ name: 'fenugreek seeds', quantity: 1, unit: 'tsp' }],
      expectedNameTokens: ['fenugreek'],
      macroRanges: { calories: [8, 16], proteinG: [0.5, 1.5], carbG: [1.5, 3.5], fatG: [0, 0.5] },
      expectedResolved: true,
    },
  },
  {
    id: 'ho-005',
    category: 'held_out',
    label: 'Ugali (East African maize porridge)',
    userInput: 'ugali 1 cup',
    requiresClarification: false,
    expectsNoMatch: true,
    layerA: {
      ingredients: [{ name: 'ugali', quantity: 1, unit: 'cup' }],
      expectedNameTokens: ['ugali', 'maize', 'corn'],
      macroRanges: { calories: [130, 200], proteinG: [2, 5], carbG: [28, 42], fatG: [0, 2] },
      expectedResolved: false,
    },
    notes: 'May not appear in Western food databases. Tests graceful failure and disclosure.',
  },
]

// ── Master scenario list ───────────────────────────────────────────────────────

export const ALL_SCENARIOS: EvalScenario[] = [
  ...WHOLE_FOOD_SIMPLE,
  ...WHOLE_FOOD_MEASURED,
  ...PACKAGED_BRANDED,
  ...RESTAURANT,
  ...HOMEMADE,
  ...DRINK,
  ...COOKING_INGREDIENT,
  ...HOUSEHOLD_MEASUREMENT,
  ...CASUAL_VAGUE,
  ...MISSPELLING,
  ...CORRECTION,
  ...MULTI_FOOD,
  ...PARTIAL_LOG,
  ...PROVIDER_FAILURE,
  ...HELD_OUT,
]

export const LAYER_A_SCENARIOS = ALL_SCENARIOS.filter(s => s.layerA !== undefined)
export const HELD_OUT_SCENARIOS = ALL_SCENARIOS.filter(s => s.category === 'held_out')
export const LAYER_B_ONLY_SCENARIOS = ALL_SCENARIOS.filter(s => s.layerA === undefined)

// Sanity: scenario IDs must be unique
const ids = ALL_SCENARIOS.map(s => s.id)
const dupes = ids.filter((id, i) => ids.indexOf(id) !== i)
if (dupes.length > 0) {
  throw new Error(`Duplicate scenario IDs: ${dupes.join(', ')}`)
}
