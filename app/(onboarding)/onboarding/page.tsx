'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, ChevronRight, Loader2, Minus, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { BodyStatsInput } from '@/components/ui/body-stats-input'

// ─── Constants ────────────────────────────────────────────────────────────────

const FITNESS_LEVELS = [
  {
    id: 'beginner',
    label: 'Beginner',
    desc: 'New to structured training or returning after a long break',
  },
  {
    id: 'intermediate',
    label: 'Intermediate',
    desc: 'Consistent for 1–2 years, comfortable with compound lifts',
  },
  {
    id: 'advanced',
    label: 'Advanced',
    desc: 'Trained seriously for 3+ years, chasing specific performance goals',
  },
] as const

const GOAL_TYPES = [
  { id: 'strength',  label: 'Get stronger',        desc: 'Build strength and hit new PRs' },
  { id: 'body_comp', label: 'Change my body comp',  desc: 'Lose fat, gain muscle, or both' },
  { id: 'endurance', label: 'Improve endurance',    desc: 'Run longer, ride farther, recover faster' },
  { id: 'habit',     label: 'Build a training habit', desc: 'Show up consistently, week after week' },
  { id: 'custom',    label: 'Something else',       desc: 'Set your own goal' },
] as const

const EQUIPMENT_OPTIONS = [
  { id: 'barbell',       label: 'Barbell' },
  { id: 'dumbbell',      label: 'Dumbbells' },
  { id: 'cable',         label: 'Cable machine' },
  { id: 'kettlebell',    label: 'Kettlebell' },
  { id: 'smith machine', label: 'Smith machine' },
  { id: 'resistance band', label: 'Resistance bands' },
  { id: 'pull-up bar',   label: 'Pull-up bar' },
  { id: 'cardio',        label: 'Cardio machines' },
  { id: 'body weight',   label: 'Bodyweight only' },
] as const

// ─── State ────────────────────────────────────────────────────────────────────

type FitnessLevel = 'beginner' | 'intermediate' | 'advanced'

interface FormState {
  displayName:    string
  fitnessLevel:   FitnessLevel | null
  goalType:       string | null
  goalTitle:      string
  equipment:      Set<string>
  weeklyWorkouts: number
  weightKg:       number | null
  heightCm:       number | null
}

const TOTAL_STEPS = 5

// ─── Step subcomponents ───────────────────────────────────────────────────────

function StepHeader({ step, title, subtitle }: { step: number; title: string; subtitle?: string }) {
  return (
    <div className="mb-6">
      <p className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-1">Step {step} of {TOTAL_STEPS}</p>
      <h2 className="text-2xl font-black text-zinc-900 dark:text-white">{title}</h2>
      {subtitle && <p className="text-sm text-zinc-500 mt-1">{subtitle}</p>}
    </div>
  )
}

function ProgressBar({ step }: { step: number }) {
  return (
    <div className="flex gap-1 mb-8">
      {Array.from({ length: TOTAL_STEPS }, (_, i) => (
        <div
          key={i}
          className={cn(
            'h-1 flex-1 rounded-full transition-all',
            i < step ? 'bg-emerald-500' : 'bg-zinc-200 dark:bg-zinc-800'
          )}
        />
      ))}
    </div>
  )
}

function NextButton({ onClick, disabled, label = 'Continue' }: { onClick: () => void; disabled?: boolean; label?: string }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center justify-center gap-2 rounded-2xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 px-6 py-3.5 text-sm font-black hover:opacity-90 disabled:opacity-30 transition-opacity mt-6"
    >
      {label} <ChevronRight className="size-4" />
    </button>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function OnboardingPage() {
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [saving, setSaving] = useState(false)

  const [form, setForm] = useState<FormState>({
    displayName:    '',
    fitnessLevel:   null,
    goalType:       null,
    goalTitle:      '',
    equipment:      new Set(),
    weeklyWorkouts: 3,
    weightKg:       null,
    heightCm:       null,
  })

  function next() { setStep(s => s + 1) }

  function toggleEquipment(id: string) {
    setForm(f => {
      const next = new Set(f.equipment)
      if (next.has(id)) next.delete(id); else next.add(id)
      return { ...f, equipment: next }
    })
  }

  async function finish() {
    setSaving(true)
    try {
      await fetch('/api/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName:    form.displayName.trim(),
          fitnessLevel:   form.fitnessLevel,
          goalType:       form.goalType ?? 'custom',
          goalTitle:      form.goalTitle.trim(),
          equipment:      Array.from(form.equipment),
          weeklyWorkouts: form.weeklyWorkouts,
          weightKg:       form.weightKg ?? undefined,
          heightCm:       form.heightCm ?? undefined,
        }),
      })
      router.push('/today')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="w-full max-w-md">
      <ProgressBar step={step} />

      {/* Step 1: Name */}
      {step === 1 && (
        <div>
          <StepHeader step={1} title="What should we call you?" subtitle="This is how V and your trainer will address you." />
          <input
            type="text"
            value={form.displayName}
            onChange={e => setForm(f => ({ ...f, displayName: e.target.value }))}
            placeholder="Your name"
            autoFocus
            className="w-full rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-4 text-lg font-medium text-zinc-900 dark:text-white placeholder:text-zinc-300 focus:outline-none focus:border-zinc-400"
            onKeyDown={e => { if (e.key === 'Enter' && form.displayName.trim()) next() }}
          />
          <NextButton onClick={next} disabled={!form.displayName.trim()} />
        </div>
      )}

      {/* Step 2: Fitness level */}
      {step === 2 && (
        <div>
          <StepHeader step={2} title="Where are you right now?" subtitle="Be honest — V adapts your training to this." />
          <div className="space-y-2.5">
            {FITNESS_LEVELS.map(level => {
              const selected = form.fitnessLevel === level.id
              return (
                <button
                  key={level.id}
                  onClick={() => { setForm(f => ({ ...f, fitnessLevel: level.id })); setTimeout(next, 160) }}
                  className={cn(
                    'w-full text-left rounded-2xl border px-4 py-4 transition-all',
                    selected
                      ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/10'
                      : 'border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:border-zinc-300 dark:hover:border-zinc-600'
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-bold text-zinc-900 dark:text-white">{level.label}</p>
                      <p className="text-xs text-zinc-500 mt-0.5">{level.desc}</p>
                    </div>
                    {selected && <Check className="size-5 text-emerald-500 shrink-0" />}
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Step 3: Goal */}
      {step === 3 && (
        <div>
          <StepHeader step={3} title="What's your main focus?" subtitle="V will build your training and nutrition around this." />
          <div className="space-y-2 mb-4">
            {GOAL_TYPES.map(g => {
              const selected = form.goalType === g.id
              return (
                <button
                  key={g.id}
                  onClick={() => setForm(f => ({ ...f, goalType: g.id, goalTitle: f.goalTitle || g.label }))}
                  className={cn(
                    'w-full text-left rounded-2xl border px-4 py-3.5 transition-all',
                    selected
                      ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/10'
                      : 'border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:border-zinc-300 dark:hover:border-zinc-600'
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-bold text-zinc-900 dark:text-white">{g.label}</p>
                      <p className="text-xs text-zinc-500">{g.desc}</p>
                    </div>
                    {selected && <Check className="size-5 text-emerald-500 shrink-0" />}
                  </div>
                </button>
              )
            })}
          </div>

          {form.goalType && (
            <div>
              <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wide block mb-1.5">
                Describe your goal
              </label>
              <input
                type="text"
                value={form.goalTitle}
                onChange={e => setForm(f => ({ ...f, goalTitle: e.target.value }))}
                placeholder="e.g. Squat 2× my bodyweight by summer"
                className="w-full rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-3 text-sm text-zinc-900 dark:text-white placeholder:text-zinc-300 focus:outline-none focus:border-zinc-400"
              />
            </div>
          )}

          <NextButton onClick={next} disabled={!form.goalType || !form.goalTitle.trim()} />
        </div>
      )}

      {/* Step 4: Equipment */}
      {step === 4 && (
        <div>
          <StepHeader step={4} title="What do you have access to?" subtitle="V will only suggest exercises you can actually do." />
          <div className="grid grid-cols-2 gap-2 mb-2">
            {EQUIPMENT_OPTIONS.map(eq => {
              const selected = form.equipment.has(eq.id)
              return (
                <button
                  key={eq.id}
                  onClick={() => toggleEquipment(eq.id)}
                  className={cn(
                    'flex items-center gap-2 rounded-2xl border px-4 py-3 text-sm font-medium transition-all text-left',
                    selected
                      ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/10 text-emerald-700 dark:text-emerald-400'
                      : 'border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:border-zinc-300 dark:hover:border-zinc-600'
                  )}
                >
                  <span className={cn('flex size-4 shrink-0 items-center justify-center rounded-full border', selected ? 'border-emerald-500 bg-emerald-500' : 'border-zinc-300 dark:border-zinc-600')}>
                    {selected && <Check className="size-2.5 text-white" />}
                  </span>
                  {eq.label}
                </button>
              )
            })}
          </div>
          <p className="text-xs text-zinc-400 text-center mb-2">Select all that apply</p>
          <NextButton
            onClick={next}
            label={form.equipment.size > 0 ? `Continue with ${form.equipment.size} selected` : 'Skip for now'}
          />
        </div>
      )}

      {/* Step 5: Weekly target + body stats */}
      {step === 5 && (
        <div>
          <StepHeader step={5} title="Last few details" subtitle="These help V calibrate your programming." />

          {/* Weekly workouts */}
          <div className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 mb-3">
            <p className="text-sm font-bold text-zinc-900 dark:text-white mb-3">How many days per week do you want to train?</p>
            <div className="flex items-center justify-between">
              <button
                onClick={() => setForm(f => ({ ...f, weeklyWorkouts: Math.max(1, f.weeklyWorkouts - 1) }))}
                className="flex size-10 items-center justify-center rounded-full border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
              >
                <Minus className="size-4 text-zinc-600 dark:text-zinc-400" />
              </button>
              <div className="text-center">
                <p className="text-4xl font-black text-zinc-900 dark:text-white">{form.weeklyWorkouts}</p>
                <p className="text-xs text-zinc-400">days / week</p>
              </div>
              <button
                onClick={() => setForm(f => ({ ...f, weeklyWorkouts: Math.min(7, f.weeklyWorkouts + 1) }))}
                className="flex size-10 items-center justify-center rounded-full border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
              >
                <Plus className="size-4 text-zinc-600 dark:text-zinc-400" />
              </button>
            </div>
          </div>

          {/* Optional body stats */}
          <div className="rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 mb-1">
            <p className="text-xs text-zinc-400 mb-3">Used to personalise nutrition estimates and progress tracking.</p>
            <BodyStatsInput
              weightKg={form.weightKg}
              heightCm={form.heightCm}
              onChange={(wkg, hcm) => setForm(f => ({ ...f, weightKg: wkg, heightCm: hcm }))}
            />
          </div>

          <button
            onClick={finish}
            disabled={saving}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 text-white px-6 py-4 text-sm font-black hover:bg-emerald-700 disabled:opacity-50 transition-colors mt-6"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            {saving ? 'Setting up your account…' : "Let's go"}
          </button>
        </div>
      )}
    </div>
  )
}
