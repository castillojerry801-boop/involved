import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { ContactForm } from '@/components/support/ContactForm'

export const metadata: Metadata = {
  title: 'Support — Involved',
  description: 'Get help with Involved — FAQ and contact support.',
}

const FAQ: { category: string; items: { q: string; a: string }[] }[] = [
  {
    category: 'Account & Login',
    items: [
      {
        q: 'I forgot my password. How do I reset it?',
        a: 'On the login screen, tap "Forgot password?" and enter your email address. You\'ll receive a reset link within a few minutes. Check your spam folder if it doesn\'t arrive.',
      },
      {
        q: 'How do I change my email address?',
        a: 'Account email changes are not yet available in-app. Contact support@involvedfit.com with your current email and the new address you\'d like to use.',
      },
      {
        q: 'How do I delete my account?',
        a: 'In-app account deletion is coming soon. To delete your account now, email support@involvedfit.com with the subject "Account Deletion Request." We\'ll process it promptly and confirm when it\'s done.',
      },
    ],
  },
  {
    category: 'Apple Health & Sync',
    items: [
      {
        q: 'How do I connect Apple Health?',
        a: 'Go to Health in the bottom navigation, then tap "Connect Apple Health." You\'ll be prompted to grant the permissions Involved needs. You can approve or deny individual data types.',
      },
      {
        q: 'Why isn\'t my data syncing from Apple Health?',
        a: 'Open Health settings in the app and tap "Sync now." If data still doesn\'t appear, check that permissions are still enabled in iPhone Settings → Privacy & Security → Health → Involved. Steps and calorie data require an Xcode/TestFlight build with the latest native code.',
      },
      {
        q: 'How do I disconnect Apple Health?',
        a: 'Go to Health in the app and tap the disconnect option. You can also revoke permissions any time via iPhone Settings → Privacy & Security → Health → Involved.',
      },
      {
        q: 'Why do my steps show "—" on the Today screen?',
        a: 'Step count data is synced from Apple Health during a sync. Make sure Apple Health is connected, permission is granted for Step Count, and you\'ve tapped "Sync now." The data will appear after a successful sync.',
      },
    ],
  },
  {
    category: 'Workouts & Programs',
    items: [
      {
        q: 'How do I start a workout?',
        a: 'Go to Training → tap the + button to log a workout, or select a planned workout from your Today screen. You can also follow a saved template or program.',
      },
      {
        q: 'Can I create my own program?',
        a: 'Yes. Go to Training → Programs → New Program. You can also ask V (the AI Coach) to generate a program based on your goals, equipment, and schedule.',
      },
      {
        q: 'How do I track my personal records?',
        a: 'Personal records are tracked automatically. When you log a set that exceeds your previous best for an exercise, it\'s recorded as a new PR. You can review exercise history from the exercise detail view.',
      },
    ],
  },
  {
    category: 'Nutrition Logging',
    items: [
      {
        q: 'How do I log food?',
        a: 'Go to Nutrition and tap the + button. You can search by name, scan a barcode, or describe a meal to get an AI-assisted estimate.',
      },
      {
        q: 'Can I scan barcodes to log food?',
        a: 'Yes. In the food log, tap the barcode icon and point your camera at a product barcode. Involved searches multiple food databases to find a match.',
      },
      {
        q: 'How accurate are the AI calorie estimates from meal photos?',
        a: 'AI photo estimates are approximations based on what\'s visible in the image. Factors like portion size, hidden ingredients, and cooking methods affect accuracy. Use them as a starting point and adjust if needed.',
      },
      {
        q: 'How do I set my calorie and macro goals?',
        a: 'Go to Nutrition → tap your targets at the top, or visit Goals in your Profile to set or update your daily nutrition targets.',
      },
    ],
  },
  {
    category: 'V / AI Coach',
    items: [
      {
        q: 'What can I ask V?',
        a: 'V can answer training and nutrition questions, generate custom workouts and programs, suggest exercise substitutions, help you understand your progress, and give guidance on technique, recovery, and goal-setting.',
      },
      {
        q: 'Can V replace a personal trainer?',
        a: 'V provides intelligent, personalized guidance but is not a licensed personal trainer or healthcare professional. For complex training needs, injury rehab, or medical concerns, work with qualified professionals.',
      },
      {
        q: 'Are V\'s recommendations always correct?',
        a: 'V uses advanced AI but can make mistakes. Always apply your own judgment, especially for anything involving health or injury risk. If a recommendation doesn\'t feel right, ask V to explain its reasoning or consult a professional.',
      },
    ],
  },
  {
    category: 'Subscriptions & Billing',
    items: [
      {
        q: 'What\'s included in Involved+?',
        a: 'Involved+ includes AI workout and program generation, unlimited V Coach messages, meal photo analysis, and additional features. See the Involved+ page in the app for current details.',
      },
      {
        q: 'How do I cancel my subscription?',
        a: 'For iOS subscriptions, go to iPhone Settings → [Your Name] → Subscriptions → Involved. Cancellations take effect at the end of the current billing period.',
      },
      {
        q: 'How do I request a refund?',
        a: 'For App Store purchases, refunds are handled by Apple. Visit reportaproblem.apple.com or contact Apple Support directly.',
      },
    ],
  },
  {
    category: 'Privacy & Data',
    items: [
      {
        q: 'Does Involved sell my health data?',
        a: 'No. Involved does not sell your personal or health data. HealthKit data is used only to power features within the app.',
      },
      {
        q: 'Who can see my progress photos?',
        a: 'Progress photos are private to your account. Trainers connected to you do not automatically see your progress photos unless you choose to share them.',
      },
      {
        q: 'How do I request a copy of my data?',
        a: 'Email support@involvedfit.com with the subject "Data Request" and we\'ll help you access or export your data.',
      },
    ],
  },
]

export default function SupportPage() {
  return (
    <div className="min-h-screen bg-white dark:bg-zinc-950">
      <div className="mx-auto max-w-3xl px-5 py-10 md:px-8 md:py-16">

        {/* Back */}
        <Link
          href="/"
          className="mb-8 inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors"
        >
          <ArrowLeft className="size-4" />
          Involved
        </Link>

        {/* Header */}
        <div className="mb-12">
          <h1 className="text-4xl font-black tracking-tight text-zinc-900 dark:text-white">
            How can we help?
          </h1>
          <p className="mt-3 text-[15px] text-zinc-500 dark:text-zinc-400">
            Browse the FAQ below or send us a message — we typically respond within one business day.
          </p>
        </div>

        {/* FAQ */}
        <section className="mb-16">
          <h2 className="mb-6 text-2xl font-bold text-zinc-900 dark:text-white">
            Frequently Asked Questions
          </h2>
          <div className="space-y-8">
            {FAQ.map(group => (
              <div key={group.category}>
                <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-400">
                  {group.category}
                </p>
                <div className="divide-y divide-zinc-100 dark:divide-zinc-800 rounded-2xl border border-zinc-100 dark:border-zinc-800 overflow-hidden">
                  {group.items.map(item => (
                    <details
                      key={item.q}
                      className="group bg-white dark:bg-zinc-900"
                    >
                      <summary className="flex cursor-pointer items-center justify-between gap-4 px-5 py-4 text-sm font-medium text-zinc-900 dark:text-white select-none hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors list-none">
                        {item.q}
                        <span className="shrink-0 text-zinc-400 transition-transform group-open:rotate-45 text-lg leading-none">+</span>
                      </summary>
                      <p className="px-5 pb-4 pt-0 text-[14px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                        {item.a}
                      </p>
                    </details>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Contact form */}
        <section id="contact">
          <h2 className="mb-2 text-2xl font-bold text-zinc-900 dark:text-white">Contact Support</h2>
          <p className="mb-6 text-[15px] text-zinc-500 dark:text-zinc-400">
            Can&apos;t find what you need? Send us a message and we&apos;ll get back to you.
          </p>
          <ContactForm />
          <p className="mt-4 text-xs text-zinc-400">
            You can also email us directly at{' '}
            <a href="mailto:support@involvedfit.com" className="text-emerald-600 dark:text-emerald-400 hover:underline">
              support@involvedfit.com
            </a>.
          </p>
        </section>

        <hr className="my-10 border-zinc-200 dark:border-zinc-800" />

        <div className="flex flex-wrap gap-4 text-sm text-zinc-400">
          <Link href="/privacy" className="hover:text-zinc-900 dark:hover:text-white transition-colors">Privacy Policy</Link>
          <Link href="/terms" className="hover:text-zinc-900 dark:hover:text-white transition-colors">Terms of Service</Link>
          <Link href="/" className="hover:text-zinc-900 dark:hover:text-white transition-colors">Home</Link>
        </div>

      </div>
    </div>
  )
}
