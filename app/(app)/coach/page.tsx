import type { Metadata } from 'next'
import { Bot, Zap, Lock } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

export const metadata: Metadata = { title: 'Coach' }

const SUGGESTED_PROMPTS = [
  'Build me a 4-week Spartan prep plan',
  'What should I do for active recovery today?',
  'How do I improve my grip strength?',
  'Explain progressive overload for beginners',
  'What\'s a good substitute for box jumps?',
  'How many days a week should I train for a 5K?',
]

export default function CoachPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:px-8">
      {/* Header */}
      <div className="mb-8 flex items-start gap-4">
        <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-zinc-900 text-white dark:bg-white dark:text-zinc-900">
          <Bot className="size-7" />
        </div>
        <div>
          <h1 className="text-2xl font-black text-zinc-900 dark:text-white">Involved Coach</h1>
          <p className="text-sm text-zinc-500">Your personal AI fitness coach. Ask anything.</p>
          <Badge variant="success" className="mt-2">
            <Zap className="size-3 mr-1" />
            Available now
          </Badge>
        </div>
      </div>

      {/* Chat area placeholder */}
      <div className="mb-6 rounded-2xl border border-zinc-100 bg-white dark:border-zinc-800 dark:bg-zinc-900 min-h-72 flex items-center justify-center">
        <div className="text-center px-8 py-12">
          <Bot className="mx-auto mb-4 size-12 text-zinc-300 dark:text-zinc-600" />
          <p className="font-semibold text-zinc-700 dark:text-zinc-300">Chat interface coming next phase</p>
          <p className="mt-1 text-sm text-zinc-400">
            The AI coaching engine is being built. Try one of the prompts below to see what&apos;s planned.
          </p>
        </div>
      </div>

      {/* Suggested prompts */}
      <div className="mb-6">
        <p className="mb-3 text-sm font-medium text-zinc-500">Suggested questions</p>
        <div className="flex flex-col gap-2">
          {SUGGESTED_PROMPTS.map((prompt) => (
            <button
              key={prompt}
              className="w-full rounded-xl border border-zinc-100 bg-white px-4 py-3 text-left text-sm text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
              disabled
            >
              {prompt}
            </button>
          ))}
        </div>
      </div>

      {/* Usage meter — architecture preview */}
      <Card className="border-zinc-100 dark:border-zinc-800">
        <div className="flex items-start justify-between mb-3">
          <div>
            <p className="text-sm font-semibold text-zinc-900 dark:text-white">Monthly coach usage</p>
            <p className="text-xs text-zinc-500">Free plan · Resets Oct 1</p>
          </div>
          <Lock className="size-4 text-zinc-400" />
        </div>
        <div className="h-2 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
          <div className="h-full w-[32%] rounded-full bg-emerald-500" />
        </div>
        <div className="mt-2 flex justify-between text-xs text-zinc-400">
          <span>8 of 25 interactions used</span>
          <span>17 remaining</span>
        </div>
        <div className="mt-4 pt-4 border-t border-zinc-100 dark:border-zinc-800">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-zinc-900 dark:text-white">Involved+</p>
              <p className="text-xs text-zinc-500">Unlimited coaching + advanced features</p>
            </div>
            <Button size="sm" variant="secondary">Upgrade</Button>
          </div>
        </div>
      </Card>
    </div>
  )
}
