'use client'

import { useState } from 'react'
import { Loader2, CheckCircle2 } from 'lucide-react'

const CATEGORIES = [
  'Account & Login',
  'Apple Health & Sync',
  'Workouts & Programs',
  'Nutrition Logging',
  'V / AI Coach',
  'Subscriptions & Billing',
  'Privacy & Data',
  'Account Deletion',
  'Bug Report',
  'Other',
]

export function ContactForm() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [category, setCategory] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, category: category || 'General', message }),
      })
      const data = await res.json() as { ok?: boolean; error?: string }
      if (!res.ok) {
        setError(data.error ?? 'Something went wrong. Please try again.')
      } else {
        setSuccess(true)
      }
    } catch {
      setError('Failed to send. Please check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 dark:border-emerald-900/30 dark:bg-emerald-950/20 px-6 py-8 text-center">
        <CheckCircle2 className="mx-auto mb-3 size-8 text-emerald-500" />
        <p className="font-semibold text-zinc-900 dark:text-white">Message sent!</p>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          We'll get back to you at <span className="font-medium">{email}</span> as soon as possible.
        </p>
      </div>
    )
  }

  const inputClass =
    'w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-4 py-3 text-sm text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100 transition-shadow'

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
            Name <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Your name"
            required
            maxLength={200}
            className={inputClass}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
            Email <span className="text-red-500">*</span>
          </label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
            maxLength={320}
            className={inputClass}
          />
        </div>
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
          Category
        </label>
        <select
          value={category}
          onChange={e => setCategory(e.target.value)}
          className={inputClass}
        >
          <option value="">Select a topic…</option>
          {CATEGORIES.map(c => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
          Message <span className="text-red-500">*</span>
        </label>
        <textarea
          value={message}
          onChange={e => setMessage(e.target.value)}
          placeholder="Describe your question or issue…"
          required
          maxLength={5000}
          rows={5}
          className={inputClass + ' resize-none'}
        />
        <p className="mt-1 text-right text-[10px] text-zinc-400">{message.length}/5000</p>
      </div>

      {error && (
        <p className="rounded-xl border border-red-200 bg-red-50 dark:border-red-900/30 dark:bg-red-950/20 px-4 py-3 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-zinc-900 dark:bg-white px-5 py-3 text-sm font-semibold text-white dark:text-zinc-900 transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {loading ? <Loader2 className="size-4 animate-spin" /> : null}
        {loading ? 'Sending…' : 'Send message'}
      </button>
    </form>
  )
}
