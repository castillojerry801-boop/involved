'use client'

import { X, ExternalLink } from 'lucide-react'

interface Props {
  onClose: () => void
}

const SOURCES = [
  {
    category: 'Caloric needs / BMR / TDEE',
    citation: 'Mifflin MD et al. (1990). A new predictive equation for resting energy expenditure in healthy individuals. Am J Clin Nutr, 51(2):241–7.',
    href: 'https://pubmed.ncbi.nlm.nih.gov/2305711/',
  },
  {
    category: 'Protein recommendations',
    citation: 'Thomas DT et al. (2016). Position of the Academy of Nutrition and Dietetics, Dietitians of Canada, and ACSM: Nutrition and Athletic Performance. J Acad Nutr Diet, 116(3):501–28.',
    href: 'https://pubmed.ncbi.nlm.nih.gov/26891166/',
  },
  {
    category: 'Resistance training & progressive overload',
    citation: 'American College of Sports Medicine — Physical Activity Guidelines and Resistance Training Position Stand.',
    href: 'https://www.acsm.org/education-resources/trending-topics-resources/physical-activity-guidelines',
  },
  {
    category: 'Heart rate training zones',
    citation: 'American Heart Association — Target Heart Rates for exercise intensity guidance.',
    href: 'https://www.heart.org/en/healthy-living/fitness/fitness-basics/target-heart-rates',
  },
  {
    category: 'Recovery & rest between sessions',
    citation: 'ACSM Guidelines for Exercise Testing and Prescription, 11th ed. — standard 48 h recovery principle.',
    href: 'https://www.acsm.org/education-resources/books/guidelines-for-exercise-testing-prescription',
  },
  {
    category: 'General physical activity guidelines',
    citation: 'U.S. Department of Health and Human Services. Physical Activity Guidelines for Americans, 2nd ed. (2018).',
    href: 'https://health.gov/our-work/nutrition-physical-activity/physical-activity-guidelines/current-guidelines',
  },
]

export function CoachResearchPanel({ onClose }: Props) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="relative w-full max-w-lg rounded-2xl border border-zinc-700 bg-zinc-900 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
          <div>
            <p className="font-semibold text-white text-sm">Research basis</p>
            <p className="text-xs text-zinc-400 mt-0.5">Sources Coach V draws on for evidence-based guidance</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="size-8 flex items-center justify-center rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Source list */}
        <ul className="divide-y divide-zinc-800 max-h-[60vh] overflow-y-auto">
          {SOURCES.map(s => (
            <li key={s.href} className="px-5 py-4">
              <p className="text-xs font-semibold text-emerald-400 uppercase tracking-wide mb-1">{s.category}</p>
              <p className="text-xs text-zinc-300 leading-relaxed mb-2">{s.citation}</p>
              <a
                href={s.href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-zinc-400 underline underline-offset-2 hover:text-zinc-200 transition-colors"
              >
                <ExternalLink className="size-3 shrink-0" />
                View source
              </a>
            </li>
          ))}
        </ul>

        {/* Footer disclaimer */}
        <div className="px-5 py-3 border-t border-zinc-800 bg-zinc-950/50">
          <p className="text-[10px] text-zinc-500 leading-relaxed">
            Coach V provides general fitness guidance only — not medical diagnosis or treatment.
            Always consult a qualified healthcare professional before making significant changes to your diet or exercise programme.
          </p>
        </div>
      </div>
    </div>
  )
}
