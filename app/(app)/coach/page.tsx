'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Bot, Send, Lock, Loader2, User, Dumbbell, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getGifUrl } from '@/lib/exercises'
import { cn } from '@/lib/utils'

interface TextMessage { role: 'user' | 'assistant'; content: string; type: 'text' }
interface WorkoutMessage {
  role: 'assistant'; type: 'workout'
  data: {
    workout_name: string
    description?: string
    estimated_duration_minutes: number
    exercises: Array<{
      exercise_id: string
      sets: number
      reps?: number
      duration_seconds?: number
      rest_seconds: number
      notes?: string
      exercise: { id: string; name: string; bodyPart: string; equipment: string; target: string }
    }>
  }
}

type Message = TextMessage | WorkoutMessage

interface Usage {
  tier: 'free' | 'plus'
  count: number
  limit: number | null
  remaining: number | null
  resetsAt: string
}

const PROMPTS = [
  'What should I train today?',
  'Build me an upper body workout',
  'How am I doing on nutrition today?',
  'I only have 30 minutes — what can I do?',
  'I need a full-body workout with dumbbells only',
  'What should I eat to hit my protein target?',
]

function WorkoutCard({ data }: { data: WorkoutMessage['data'] }) {
  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 flex items-start justify-between gap-2">
        <div>
          <p className="font-bold text-zinc-900 dark:text-white">{data.workout_name}</p>
          {data.description && <p className="text-xs text-zinc-500 mt-0.5">{data.description}</p>}
        </div>
        <span className="shrink-0 rounded-lg bg-zinc-100 dark:bg-zinc-800 px-2 py-1 text-xs text-zinc-500">
          ~{data.estimated_duration_minutes} min
        </span>
      </div>
      <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {data.exercises.map((ex, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3">
            <div className="size-12 shrink-0 rounded-xl bg-zinc-50 dark:bg-zinc-800 overflow-hidden flex items-center justify-center">
              {/* GIF served from our storage — never sent to OpenAI */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={getGifUrl(ex.exercise_id)} alt={ex.exercise.name} className="h-full w-auto object-contain" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-zinc-900 dark:text-white truncate">{ex.exercise.name}</p>
              <p className="text-xs text-zinc-500">
                {ex.sets} sets ·{' '}
                {ex.reps ? `${ex.reps} reps` : ex.duration_seconds ? `${ex.duration_seconds}s` : '—'}
                {' · '}{ex.rest_seconds}s rest
              </p>
              {ex.notes && <p className="text-xs text-zinc-400 italic mt-0.5">{ex.notes}</p>}
            </div>
            <div className="shrink-0 text-right">
              <p className="text-xs text-zinc-400">{ex.exercise.equipment}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="px-4 py-3 border-t border-zinc-100 dark:border-zinc-800">
        <button className="w-full rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 py-2.5 text-sm font-bold hover:opacity-90 transition-opacity flex items-center justify-center gap-2">
          <Dumbbell className="size-4" />
          Start this workout
        </button>
      </div>
    </div>
  )
}

function MessageBubble({ msg }: { msg: Message }) {
  if (msg.type === 'workout') return (
    <div className="flex gap-3">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800">
        <Bot className="size-4 text-zinc-500" />
      </div>
      <div className="flex-1 min-w-0">
        <WorkoutCard data={msg.data} />
      </div>
    </div>
  )

  const isUser = msg.role === 'user'
  return (
    <div className={cn('flex gap-3', isUser && 'flex-row-reverse')}>
      <div className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-full',
        isUser ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500'
      )}>
        {isUser ? <User className="size-4" /> : <Bot className="size-4" />}
      </div>
      <div className={cn(
        'max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap',
        isUser
          ? 'rounded-tr-sm bg-zinc-900 text-white dark:bg-white dark:text-zinc-900'
          : 'rounded-tl-sm bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100'
      )}>
        {msg.content}
      </div>
    </div>
  )
}

export default function CoachPage() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [usage, setUsage] = useState<Usage | null>(null)
  const [limitReached, setLimitReached] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const fetchUsage = useCallback(async () => {
    const res = await fetch('/api/coach')
    if (res.ok) setUsage(await res.json() as Usage)
  }, [])

  useEffect(() => { fetchUsage() }, [fetchUsage])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  // Build the conversation history for the API (text messages only)
  const apiMessages = () =>
    messages
      .filter(m => m.type === 'text')
      .map(m => ({ role: (m as TextMessage).role, content: (m as TextMessage).content }))

  const send = async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || streaming || limitReached) return

    const userMsg: TextMessage = { role: 'user', content: trimmed, type: 'text' }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setStreaming(true)

    // Add streaming placeholder
    let assistantText = ''
    const placeholderIdx = messages.length + 1
    setMessages(prev => [...prev, userMsg, { role: 'assistant', content: '', type: 'text' }])

    try {
      const res = await fetch('/api/coach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [...apiMessages(), { role: 'user', content: trimmed }] }),
      })

      if (res.status === 429) {
        setLimitReached(true)
        setMessages(prev => prev.slice(0, -1))
        return
      }
      if (!res.ok || !res.body) throw new Error('Request failed')

      // Update usage from headers
      const usageCount = res.headers.get('X-Usage-Count')
      const usageLimit = res.headers.get('X-Usage-Limit')
      if (usageCount && usage) {
        const count = parseInt(usageCount)
        setUsage(u => u ? {
          ...u, count,
          remaining: usageLimit && usageLimit !== 'unlimited' ? Math.max(0, parseInt(usageLimit) - count) : u.remaining,
        } : u)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      void placeholderIdx

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const json = line.slice(6)
          if (!json.trim()) continue
          try {
            const event = JSON.parse(json) as { type: string; content?: string; data?: WorkoutMessage['data'] }
            if (event.type === 'text' && event.content) {
              assistantText += event.content
              setMessages(prev => {
                const updated = [...prev]
                const last = updated[updated.length - 1]
                if (last?.role === 'assistant' && last.type === 'text') {
                  updated[updated.length - 1] = { ...last, content: assistantText }
                }
                return updated
              })
            } else if (event.type === 'workout' && event.data) {
              setMessages(prev => [
                ...prev,
                { role: 'assistant', type: 'workout', data: event.data! },
              ])
            }
          } catch { /* malformed event, skip */ }
        }
      }
    } catch {
      setMessages(prev => {
        const updated = [...prev]
        const last = updated[updated.length - 1]
        if (last?.role === 'assistant' && last.type === 'text' && last.content === '') {
          updated[updated.length - 1] = { ...last, content: 'Something went wrong. Please try again.' }
        }
        return updated
      })
    } finally {
      setStreaming(false)
      inputRef.current?.focus()
    }
  }

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input) }
  }

  const usedPct = usage?.limit ? Math.min((usage.count / usage.limit) * 100, 100) : 0

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] md:h-screen max-w-2xl mx-auto px-4 md:px-8">

      {/* Header */}
      <div className="py-5 flex items-center gap-3 shrink-0 border-b border-zinc-100 dark:border-zinc-800">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-zinc-900 text-white dark:bg-white dark:text-zinc-900">
          <Bot className="size-5" />
        </div>
        <div className="flex-1">
          <p className="font-black text-zinc-900 dark:text-white">Involved Coach</p>
          <p className="text-xs text-zinc-400">
            {usage
              ? usage.tier === 'plus'
                ? 'Unlimited coaching'
                : `${usage.remaining ?? '—'} of ${usage.limit} messages this month`
              : 'Loading...'}
          </p>
        </div>
        {usage?.tier === 'free' && (
          <button className="flex items-center gap-1 rounded-lg border border-zinc-200 dark:border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors">
            Upgrade <ChevronRight className="size-3" />
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto py-5 flex flex-col gap-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <div className="flex size-16 items-center justify-center rounded-3xl bg-zinc-100 dark:bg-zinc-800 mb-4">
              <Bot className="size-8 text-zinc-400" />
            </div>
            <p className="font-bold text-zinc-800 dark:text-zinc-200 mb-1">Your AI fitness coach</p>
            <p className="text-sm text-zinc-400 mb-6 max-w-xs">
              Ask about training, nutrition, or how to reach your goals. I have your targets and goals on hand.
            </p>
            <div className="flex flex-col gap-2 w-full max-w-sm">
              {PROMPTS.map(p => (
                <button
                  key={p}
                  onClick={() => send(p)}
                  disabled={streaming || limitReached}
                  className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-2.5 text-left text-sm text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-white transition-colors disabled:opacity-50"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <MessageBubble key={i} msg={msg} />
        ))}

        {streaming && messages[messages.length - 1]?.type === 'text' && (messages[messages.length - 1] as TextMessage).content === '' && (
          <div className="flex gap-3">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800">
              <Bot className="size-4 text-zinc-500" />
            </div>
            <div className="flex items-center gap-1 rounded-2xl rounded-tl-sm bg-zinc-100 dark:bg-zinc-800 px-4 py-3">
              <span className="size-1.5 rounded-full bg-zinc-400 animate-bounce [animation-delay:0ms]" />
              <span className="size-1.5 rounded-full bg-zinc-400 animate-bounce [animation-delay:150ms]" />
              <span className="size-1.5 rounded-full bg-zinc-400 animate-bounce [animation-delay:300ms]" />
            </div>
          </div>
        )}

        {limitReached && (
          <div className="mx-2 rounded-2xl border border-amber-200 bg-amber-50 dark:border-amber-800/30 dark:bg-amber-900/10 p-4">
            <div className="flex items-start gap-3">
              <Lock className="size-5 text-amber-500 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-amber-800 dark:text-amber-400 text-sm">Monthly coaching limit reached</p>
                <p className="text-xs text-amber-700 dark:text-amber-500 mt-1">
                  Your free plan includes {usage?.limit} coach messages per month. Resets {usage?.resetsAt}.
                  Upgrade to Involved+ for unlimited coaching.
                </p>
              </div>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Usage bar — free tier only */}
      {usage?.tier === 'free' && usage.limit && (
        <div className="shrink-0 pb-1">
          <div className="h-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
            <div
              className={cn('h-full rounded-full transition-all', usedPct > 80 ? 'bg-amber-500' : 'bg-emerald-500')}
              style={{ width: `${usedPct}%` }}
            />
          </div>
        </div>
      )}

      {/* Input */}
      <div className="shrink-0 pb-4 md:pb-6">
        <div className="flex items-end gap-2 rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-3 focus-within:border-zinc-400 dark:focus-within:border-zinc-500 transition-colors shadow-sm">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder={limitReached ? 'Monthly limit reached — upgrade to continue' : 'Ask your coach anything...'}
            disabled={streaming || limitReached}
            rows={1}
            className="flex-1 resize-none bg-transparent text-sm text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:outline-none disabled:opacity-40"
            style={{ maxHeight: 120 }}
            onInput={e => {
              const t = e.currentTarget
              t.style.height = 'auto'
              t.style.height = `${Math.min(t.scrollHeight, 120)}px`
            }}
          />
          <Button
            size="sm"
            onClick={() => send(input)}
            disabled={!input.trim() || streaming || limitReached}
            className="shrink-0 size-8 p-0 rounded-xl"
          >
            {streaming ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          </Button>
        </div>
      </div>
    </div>
  )
}
