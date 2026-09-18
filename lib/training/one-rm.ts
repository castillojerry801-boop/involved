// Epley formula: 1RM = weight × (1 + reps / 30)
// Only reliable for 1–12 reps; beyond 12 the estimate drifts significantly.

export function estimated1RM(weightKg: number, reps: number): number {
  if (weightKg <= 0 || reps <= 0) return 0
  if (reps === 1) return weightKg
  return Math.round((weightKg * (1 + reps / 30)) * 100) / 100
}

export function isValid1RMEstimate(reps: number): boolean {
  return reps >= 1 && reps <= 12
}
