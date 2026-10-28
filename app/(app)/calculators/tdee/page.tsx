'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowRight, Loader2, AlertCircle, Info, CheckCircle2 } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { BodyStatsInput } from '@/components/ui/body-stats-input'
import { ApplyTargetDialog } from '@/components/nutrition/apply-target-dialog'
import { cn } from '@/lib/utils'
import {
  calcTDEE,
  calorieProjections,
  ACTIVITY_LABELS,
  ACTIVITY_MULTIPLIERS,
  type CalculatorSex,
  type ActivityLevel,
} from '@/lib/calculators/tdee'
import {
  buildCaloriePayload,
  FALLBACK_TARGET,
  type FullNutritionTarget,
} from '@/lib/calculators/apply-targets'

type ProfileBioSex = 'male' | 'female' | 'prefer_not_to_say'

type ApplyPhase =
  | { phase: 'idle' }
  | { phase: 'loading'; calories: number }
  | { phase: 'confirm'; existing: FullNutritionTarget; proposed: FullNutritionTarget; existingId: string | null; isFirstTarget: boolean }

const ACTIVITY_LEVELS: ActivityLevel[] = [
  'sedentary', 'light', 'moderate', 'active', 'very_active',
]

export default function TDEEPage() {
  const router = useRouter()

  const [profileLoading, setProfileLoading] = useState(true)
  const [profileSex, setProfileSex] = useState<ProfileBioSex | null>(null)

  const [sex, setSex] = useState<CalculatorSex | null>(null)
  const [age, setAge] = useState('')
  const [weightKg, setWeightKg] = useState<number | null>(null)
  const [heightCm, setHeightCm] = useState<number | null>(null)
  const [activityLevel, setActivityLevel] = useState<ActivityLevel>('moderate')
  const [hasProfileStats, setHasProfileStats] = useState(false)

  const [applyPhase, setApplyPhase] = useState<ApplyPhase>({ phase: 'idle' })
  const [applyError, setApplyError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/profile')
      .then(r => r.json())
      .then(({ profile }: { profile: { weightKg?: number | null; heightCm?: number | null; biologicalSex?: ProfileBioSex | null } }) => {
        const wkg = profile.weightKg != null ? Number(profile.weightKg) : null
        const hcm = profile.heightCm != null ? Number(profile.heightCm) : null
        if (wkg && wkg > 0) setWeightKg(wkg)
        if (hcm && hcm > 0) setHeightCm(hcm)
        if (wkg || hcm) setHasProfileStats(true)
        setProfileSex(profile.biologicalSex ?? null)
        if (profile.biologicalSex === 'male') setSex('male')
        if (profile.biologicalSex === 'female') setSex('female')
      })
      .catch(() => {})
      .finally(() => setProfileLoading(false))
  }, [])

  const ageNum = useMemo(() => {
    const n = parseInt(age, 10)
    return Number.isInteger(n) && n >= 0 ? n : null
  }, [age])

  const tdeeResult = useMemo(() => {
    if (!sex || weightKg == null || heightCm == null || ageNum == null) return null
    return calcTDEE(weightKg, heightCm, ageNum, sex, activityLevel)
  }, [sex, weightKg, heightCm, ageNum, activityLevel])

  const projections = useMemo(() => {
    if (!tdeeResult?.ok) return []
    return calorieProjections(tdeeResult.tdee, tdeeResult.sex)
  }, [tdeeResult])

  const isMinor = tdeeResult != null && !tdeeResult.ok && tdeeResult.reason === 'minor'
  const hasValidationError = tdeeResult != null && !tdeeResult.ok && !isMinor

  const missingInputs =
    !sex || weightKg == null || heightCm == null || age.trim() === ''

  async function startApplyCalories(calories: number) {
    setApplyError(null)
    setApplyPhase({ phase: 'loading', calories })
    try {
      const res = await fetch('/api/nutrition/targets')
      if (!res.ok) {
        setApplyPhase({ phase: 'idle' })
        setApplyError('Unable to load current goals. Please try again.')
        return
      }
      const { target } = await res.json() as { target: (FullNutritionTarget & { id: string }) | null }
      const existing = target ?? FALLBACK_TARGET
      setApplyPhase({
        phase: 'confirm',
        existing,
        proposed: buildCaloriePayload(existing, calories),
        existingId: target?.id ?? null,
        isFirstTarget: target === null,
      })
    } catch {
      setApplyPhase({ phase: 'idle' })
      setApplyError('Unable to load current goals. Please check your connection.')
    }
  }

  async function handleApplyConfirm(): Promise<{ ok: boolean; error?: string }> {
    if (applyPhase.phase !== 'confirm') return { ok: false, error: 'Invalid state.' }
    const { proposed, existingId } = applyPhase
    // Always include existingTargetId so the server stale check runs.
    // null = first-time user (expect no current record); string = existing record ID.
    const payload = { ...proposed, existingTargetId: existingId }
    try {
      const res = await fetch('/api/nutrition/targets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string }
        return { ok: false, error: data.error ?? 'Failed to save goals.' }
      }
      router.refresh()
      return { ok: true }
    } catch {
      return { ok: false, error: 'Network error. Please try again.' }
    }
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-8 md:px-8">
      <PageHeader
        title="TDEE & BMR"
        backHref="/calculators"
        subtitle="Statistical estimates — not measured energy expenditure"
      />

      <div className="mt-6 space-y-4">

        {/* Formula variant */}
        <div className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-3">
          <div>
            <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
              Formula variant
            </p>
            <p className="text-xs text-zinc-400 mt-0.5">
              The Mifflin–St Jeor equation has two variants. Select based on your biological sex.
            </p>
          </div>

          {profileSex === 'prefer_not_to_say' && (
            <div className="flex items-start gap-2 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-800/30 px-3 py-2.5">
              <Info className="size-3.5 text-amber-500 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-700 dark:text-amber-400">
                Your profile has 'Prefer not to say' selected. Choose a variant below to calculate.
              </p>
            </div>
          )}

          <div className="flex gap-2">
            {(['male', 'female'] as CalculatorSex[]).map(s => (
              <button
                key={s}
                onClick={() => setSex(s)}
                className={cn(
                  'flex-1 rounded-xl border py-2.5 text-sm font-medium transition-all capitalize',
                  sex === s
                    ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/10 text-emerald-700 dark:text-emerald-400'
                    : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:border-zinc-300 dark:hover:border-zinc-600'
                )}
              >
                {s === 'male' ? 'Male' : 'Female'}
              </button>
            ))}
          </div>
        </div>

        {/* Age */}
        <div className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
          <label className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide block mb-2">
            Age (years)
          </label>
          <input
            type="number"
            inputMode="numeric"
            value={age}
            onChange={e => setAge(e.target.value)}
            placeholder="30"
            min={1}
            max={120}
            className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-4 py-3 text-lg font-bold text-center text-zinc-900 dark:text-white placeholder:text-zinc-300 dark:placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500"
          />
        </div>

        {/* Body stats */}
        <div className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
          {profileLoading ? (
            <div className="flex items-center justify-center gap-2 py-6">
              <Loader2 className="size-4 animate-spin text-zinc-400" />
              <span className="text-sm text-zinc-400">Loading profile…</span>
            </div>
          ) : (
            <>
              <BodyStatsInput
                weightKg={weightKg}
                heightCm={heightCm}
                onChange={(wkg, hcm) => { setWeightKg(wkg); setHeightCm(hcm) }}
              />
              {hasProfileStats && (
                <p className="text-xs text-zinc-400 mt-2">
                  Pre-populated from your profile. Changes here won't affect your profile.
                </p>
              )}
            </>
          )}
        </div>

        {/* Activity level */}
        <div className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-3">
          <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
            Activity level
          </p>
          <div className="space-y-1.5">
            {ACTIVITY_LEVELS.map(level => {
              const fullLabel = ACTIVITY_LABELS[level]
              const parenIdx = fullLabel.indexOf(' (')
              const title = parenIdx >= 0 ? fullLabel.slice(0, parenIdx) : fullLabel
              const detail = parenIdx >= 0 ? fullLabel.slice(parenIdx + 2, -1) : ''
              const active = activityLevel === level
              return (
                <button
                  key={level}
                  onClick={() => setActivityLevel(level)}
                  className={cn(
                    'w-full flex items-center gap-3 rounded-xl border px-4 py-2.5 text-left transition-all',
                    active
                      ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/10'
                      : 'border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600'
                  )}
                >
                  <div className={cn(
                    'size-3.5 rounded-full border-2 shrink-0',
                    active
                      ? 'border-emerald-500 bg-emerald-500'
                      : 'border-zinc-300 dark:border-zinc-600'
                  )} />
                  <div className="flex-1 min-w-0">
                    <p className={cn(
                      'text-sm font-medium leading-tight',
                      active ? 'text-emerald-700 dark:text-emerald-400' : 'text-zinc-700 dark:text-zinc-300'
                    )}>
                      {title}
                    </p>
                    {detail && (
                      <p className="text-xs text-zinc-400 leading-tight mt-0.5">{detail}</p>
                    )}
                  </div>
                  <span className="text-xs text-zinc-400 shrink-0">×{ACTIVITY_MULTIPLIERS[level]}</span>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* Results */}
      <div className="mt-6 space-y-4">

        {/* Prompt / validation feedback */}
        {missingInputs && !isMinor && (
          <div className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-5 py-4 text-center">
            <p className="text-sm text-zinc-400">
              {!sex
                ? 'Select a formula variant above to calculate.'
                : age.trim() === ''
                ? 'Enter your age above to calculate.'
                : 'Enter your weight and height above to calculate.'}
            </p>
          </div>
        )}

        {/* Out-of-range input error (age > 120, extreme weight/height) */}
        {hasValidationError && !tdeeResult.ok && (
          <div className="rounded-2xl border border-red-200 dark:border-red-800/40 bg-red-50 dark:bg-red-900/10 px-5 py-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="size-5 text-red-500 shrink-0 mt-0.5" />
              <p className="text-sm text-red-700 dark:text-red-400">{tdeeResult.message}</p>
            </div>
          </div>
        )}

        {/* Under-18 warning */}
        {isMinor && (
          <div className="rounded-2xl border border-amber-200 dark:border-amber-800/40 bg-amber-50 dark:bg-amber-900/10 px-5 py-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="size-5 text-amber-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">Age not supported</p>
                <p className="text-xs text-amber-600 dark:text-amber-500 mt-1 leading-relaxed">
                  The Mifflin–St Jeor equation is validated for adults aged 18 and over. Adult calorie targets
                  are not appropriate for users under 18. Please consult a registered dietitian or healthcare provider.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* BMR + TDEE summary */}
        {tdeeResult?.ok && (
          <>
            <div className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
              <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide mb-3">
                Estimated results
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-zinc-50 dark:bg-zinc-800 px-4 py-3">
                  <p className="text-xs text-zinc-400 mb-1">BMR (resting)</p>
                  <p className="text-2xl font-black text-zinc-900 dark:text-white">
                    {tdeeResult.bmr.toLocaleString()}
                  </p>
                  <p className="text-xs text-zinc-400">kcal/day</p>
                </div>
                <div className="rounded-xl bg-zinc-50 dark:bg-zinc-800 px-4 py-3">
                  <p className="text-xs text-zinc-400 mb-1">TDEE (active)</p>
                  <p className="text-2xl font-black text-emerald-600 dark:text-emerald-400">
                    {tdeeResult.tdee.toLocaleString()}
                  </p>
                  <p className="text-xs text-zinc-400">kcal/day</p>
                </div>
              </div>
              <p className="text-xs text-zinc-400 mt-3">
                Activity multiplier: ×{ACTIVITY_MULTIPLIERS[tdeeResult.activityLevel]}
                {' '}({ACTIVITY_LABELS[tdeeResult.activityLevel]})
              </p>
            </div>

            {/* Calorie projections */}
            <div className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-2">
              <div className="mb-1">
                <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
                  Calorie projections
                </p>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Tap a row to use in the Macro Goals calculator, or apply directly as your calorie goal.
                </p>
              </div>

              {applyError && (
                <div className="flex items-start gap-2 rounded-xl bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800/40 px-3 py-2.5">
                  <AlertCircle className="size-3.5 text-red-500 shrink-0 mt-0.5" />
                  <p className="text-xs text-red-700 dark:text-red-400">{applyError}</p>
                </div>
              )}

              {projections.map(proj => {
                const isLoadingThis = applyPhase.phase === 'loading' && applyPhase.calories === proj.calories
                const anyLoading = applyPhase.phase === 'loading'
                return (
                  <div key={proj.id}>
                    <Link
                      href={`/calculators/macros?calories=${proj.calories}`}
                      className="flex items-center gap-3 rounded-xl border border-zinc-100 dark:border-zinc-800 hover:border-emerald-400 dark:hover:border-emerald-600 px-4 py-3 transition-colors group"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-semibold text-zinc-900 dark:text-white">{proj.label}</p>
                          {proj.floorApplied && (
                            <span className="text-[10px] font-semibold bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-1.5 py-0.5 rounded-full leading-none">
                              Floor
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-zinc-400 leading-tight mt-0.5">{proj.description}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-xl font-black text-zinc-900 dark:text-white">
                          {proj.calories.toLocaleString()}
                        </p>
                        <p className="text-xs text-zinc-400">kcal</p>
                      </div>
                      <ArrowRight className="size-4 text-zinc-300 dark:text-zinc-600 group-hover:text-emerald-500 transition-colors shrink-0" />
                    </Link>

                    {/* Apply as calorie goal */}
                    <div className="flex items-center gap-2 mt-1 px-1">
                      <button
                        onClick={() => startApplyCalories(proj.calories)}
                        disabled={anyLoading}
                        className="flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 disabled:opacity-50 disabled:cursor-not-allowed py-1"
                      >
                        {isLoadingThis
                          ? <Loader2 className="size-3 animate-spin" />
                          : <CheckCircle2 className="size-3" />
                        }
                        Apply as calorie goal
                      </button>
                    </div>

                    {proj.floorApplied && (
                      <div className="flex items-start gap-2 mt-0.5 px-1">
                        <AlertCircle className="size-3 text-amber-500 shrink-0 mt-0.5" />
                        <p className="text-xs text-amber-600 dark:text-amber-500 leading-snug">
                          Adjusted to the recommended minimum of {proj.calories.toLocaleString()} kcal/day.
                          This floor is not automatically safe for everyone — consult a healthcare provider.
                        </p>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            <p className="text-xs text-zinc-400 text-center px-2 leading-relaxed">
              All values are statistical estimates derived from the Mifflin–St Jeor equation (1990).
              Actual energy needs depend on factors this formula does not capture.
            </p>
          </>
        )}
      </div>

      {/* Apply confirmation dialog */}
      {applyPhase.phase === 'confirm' && (
        <ApplyTargetDialog
          mode="calorie"
          existing={applyPhase.existing}
          proposed={applyPhase.proposed}
          isFirstTarget={applyPhase.isFirstTarget}
          onConfirm={handleApplyConfirm}
          onClose={() => setApplyPhase({ phase: 'idle' })}
        />
      )}
    </div>
  )
}
