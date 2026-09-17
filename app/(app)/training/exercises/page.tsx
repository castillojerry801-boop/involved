import { Metadata } from 'next'
import { searchExercises } from '@/lib/exercises'
import { ExerciseBrowser } from '@/components/training/exercise-browser'

export const metadata: Metadata = { title: 'Exercise Library' }

async function search(query: string, bodyPart: string) {
  'use server'
  return searchExercises(query, bodyPart, 60)
}

export default function ExerciseLibraryPage() {
  const initial = searchExercises('', 'all', 60)

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:px-8 md:py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-black text-zinc-900 dark:text-white">Exercise Library</h1>
        <p className="text-sm text-zinc-500">1,394 exercises with animated guides</p>
      </div>
      <ExerciseBrowser initialExercises={initial} onSearch={search} />
    </div>
  )
}
