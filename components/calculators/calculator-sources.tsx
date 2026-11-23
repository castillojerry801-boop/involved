import { ExternalLink } from 'lucide-react'

interface Source {
  label: string
  href:  string
}

interface Props {
  sources: Source[]
}

/**
 * Collapsible "Sources" row added to each Fitness Calculator to satisfy
 * App Store Review Guideline 1.4.1 (health/medical citation requirement).
 * Uses a native <details> element — no JS required.
 */
export function CalculatorSources({ sources }: Props) {
  return (
    <details className="text-xs text-zinc-400 mt-1">
      <summary className="cursor-pointer select-none list-none flex items-center gap-1 hover:text-zinc-500 dark:hover:text-zinc-300 transition-colors w-fit">
        <ExternalLink className="size-3 shrink-0" />
        <span>Sources &amp; methodology</span>
      </summary>
      <ul className="mt-2 space-y-1 pl-4 border-l border-zinc-200 dark:border-zinc-700">
        {sources.map(s => (
          <li key={s.href}>
            <a
              href={s.href}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
            >
              {s.label}
            </a>
          </li>
        ))}
      </ul>
    </details>
  )
}
