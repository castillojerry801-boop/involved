/**
 * Scoring Audit — startsWith bias and extra-word penalty interaction
 *
 * Documents two confirmed scoring defects found during Phase 0 evaluation:
 *   1. startsWith bias: awards +80 to compound foods that start with the query term,
 *      beating correct simple records that only score +60 (contains).
 *   2. extra-word penalty miss: the semantic scorer's extra-word penalty protects
 *      against wrong FatSecret compound foods ONLY when USDA returns a better record.
 *      Without USDA, extra-word penalty does not prevent the wrong FatSecret match.
 *
 * IMPORTANT: This file documents defects only. It does NOT modify production scoring.
 * Proposed corrections are staged here for review before any production change.
 *
 * Sources:
 *   lib/nutrition/search-utils.ts  — scoreResult, passesQualityGate
 *   lib/nutrition/matching/scorer.ts — extra-word penalty
 */

// ── Reproduction: banana scoring bias ────────────────────────────────────────
//
// Query: "banana"
//
// FatSecret result: "Banana Raw Almond Butter"
//   combinedNorm = "banana raw almond butter"
//   combinedNorm.startsWith("banana ") → TRUE → +80 base score
//   provider bonus: fatsecret +15
//   total before semantic: ~95
//
// USDA result: "Bananas, raw"
//   combinedNorm = "bananas, raw"
//   qNorm = "banana"
//   "bananas, raw".startsWith("banana ") → FALSE (starts with "bananas")
//   "bananas, raw".includes("banana") → TRUE → +60 base score
//   provider bonus: usda_fooddata +12
//   total before semantic: ~72
//
// BUG: "Banana Raw Almond Butter" (score ~95) beats "Bananas, raw" (score ~72)
//      even though "Bananas, raw" is the correct food.
//
// Why it happens:
//   The startsWith check uses the full normalized query string (no plural stemming).
//   "bananas" !== "banana" so USDA's plural form misses the +80 bonus.
//   "Banana Raw Almond Butter" starts with "banana " so it gets the bonus.
//
// Semantic scorer partial mitigation:
//   The extra-word penalty in scorer.ts penalizes "raw", "almond", "butter" (+6 penalty)
//   and "bananas, raw" gets isGeneric +15 and raw +12 bonuses.
//   Net: USDA "Bananas, raw" total ~141 vs FatSecret "Banana Raw Almond Butter" ~152.
//   USDA loses by ~11 points. Wrong food is selected.

// ── Reproduction: FatSecret compound food quality gate bypass ─────────────────
//
// passesQualityGate (lib/nutrition/search-utils.ts) — multi-token rule:
//   REQUIRES: first non-stop-word token from query appears in food name
//             AND ≥ ceil(n/2) tokens match
//
// "egg whole raw" → "Steak Tartare (Raw Ground Beef and Egg)"
//   first token = "egg"; "egg" appears in "steak tartare" → PASSES quality gate
//   Token match: "egg"(1/3) = 1, ceil(3/2) = 2 → FAILS token count
//   Wait — let me recalculate: tokens = ["egg","whole","raw"], n=3, need ≥2
//   "steak tartare (raw ground beef and egg)" contains: "egg"✓, "whole"✗, "raw"✓ → 2/3 ≥ 2 → PASSES
//
// All 7 wrong FatSecret compound food matches pass the quality gate because:
//   - The primary ingredient word appears in the compound dish name (it's an ingredient)
//   - "raw" is a common word appearing in many dish names
//
// The quality gate was designed for brand/variant disambiguation, not compound-vs-simple food distinction.

// ── Proposed generalized correction strategy ─────────────────────────────────
//
// The core issue is that startsWith fires on the FIRST word of a compound dish name
// when the compound dish starts with the query ingredient.
// "Banana Raw Almond Butter" starts with "banana" but is NOT "banana".
//
// PROPOSED FIX (scoreResult in lib/nutrition/search-utils.ts):
//
//   BEFORE:
//     if (combinedNorm.startsWith(qNorm + ' ') || combinedNorm.startsWith(qNorm + ','))
//       score += 80
//     else if (combinedNorm.includes(qNorm))
//       score += 60
//
//   AFTER:
//     if (combinedNorm.startsWith(qNorm + ' ') || combinedNorm.startsWith(qNorm + ',')) {
//       // Guard: if the food has ≥2 significant extra words beyond the query, it's a compound dish.
//       // Demote to contains(+60) to avoid compound dishes beating the correct simple food.
//       const extraWords = countSignificantExtraWords(combinedNorm, qNorm)
//       score += extraWords >= 2 ? 60 : 80
//     } else if (combinedNorm.includes(qNorm)) {
//       score += 60
//     }
//
//   Where countSignificantExtraWords removes stop words (raw, cooked, plain, whole, large, etc.)
//   and counts remaining words in the food name that aren't in the query.
//   "banana raw almond butter": extra significant words = ["almond", "butter"] = 2 → demote to +60
//   "bananas, raw": extra significant words = [] (plural stem + "raw" is a stop) = 0 → keep +60
//
// EFFECT:
//   "Banana Raw Almond Butter": +60 base + 15 FS bonus = 75 before semantic scorer
//   "Bananas, raw": +60 base + 12 USDA bonus = 72 before semantic scorer
//   Semantic scorer: isGeneric(+15) + raw(+12) - no extra words penalty for "bananas, raw"
//   Net: USDA "Bananas, raw" wins as intended.
//
// VERIFICATION NEEDED before applying:
//   - No regression on legitimate compound-food queries ("peanut butter", "olive oil")
//     → "peanut butter": qNorm="peanut butter", matches exactly, startsWith would need
//       the food to start with "peanut butter " — correct matches would score +80, correct.
//   - No regression on multi-word queries ("brown rice", "sweet potato")
//     → Same logic: if the exact phrase starts the food name AND there are ≥2 extra words,
//       demote. "brown rice" → "Brown Rice Cakes" would demote correctly.
//   - Fragile edge: queries like "chicken breast" for "chicken breast, grilled" should keep +80
//     since "grilled" is a prep modifier (and is in PREP_MODIFIER_WORDS in scorer.ts).
//     The fix must NOT count PREP_MODIFIER_WORDS as significant extra words.
//
// STATUS: PROPOSED — not yet applied to production.
//         Requires regression test suite run before merge.

// ── Proposed extra-word penalty improvement ───────────────────────────────────
//
// The current extra-word penalty in scorer.ts:
//   const extraWords = foodWords.filter(
//     w => !wordInText(w, req.ingredientName) && !PREP_MODIFIER_WORDS.has(w),
//   )
//   if (extraWords.length > 0) {
//     const penalty = Math.min(extraWords.length * 2, 15)
//     score -= penalty
//   }
//
// This is CORRECT behavior but insufficient alone when:
//   1. USDA is unavailable (extra-word penalty only helps if a better USDA record is also present)
//   2. The startsWith +80 bonus overrides the semantic penalty
//
// The two fixes are complementary:
//   - startsWith guard: prevents the wrong food from gaining an excessive base score
//   - extra-word penalty: penalizes compound dishes even after base scoring
//
// Together they create two layers of defense against compound-dish false matches.

export {}
