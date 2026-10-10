import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

export const metadata: Metadata = {
  title: 'Delete Your Account — Involved',
  description: 'How to delete your Involved account and what data is removed.',
}

export default function DeleteAccountPage() {
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
        <div className="mb-10">
          <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-zinc-400">GameFloHQ LLC</p>
          <h1 className="text-4xl font-black tracking-tight text-zinc-900 dark:text-white">Delete Your Account</h1>
          <p className="mt-4 text-[15px] text-zinc-600 dark:text-zinc-400 leading-relaxed">
            You can delete your Involved account at any time. Deletion is immediate and permanent —
            your personal data and fitness history will be removed from our systems.
          </p>
        </div>

        <hr className="mb-10 border-zinc-200 dark:border-zinc-800" />

        {/* In-app deletion */}
        <section className="mb-10">
          <h2 className="mb-4 text-xl font-bold text-zinc-900 dark:text-white">Delete in the app</h2>
          <p className="mb-4 text-[15px] text-zinc-600 dark:text-zinc-400 leading-relaxed">
            Account deletion is available directly inside Involved. You do not need to contact support to delete your account.
          </p>
          <ol className="ml-5 space-y-2 list-decimal text-[15px] text-zinc-600 dark:text-zinc-400">
            <li>Open the Involved app and sign in to your account.</li>
            <li>Tap <strong className="text-zinc-800 dark:text-zinc-200">Profile</strong> (bottom navigation).</li>
            <li>Scroll to the bottom of the screen.</li>
            <li>Tap <strong className="text-zinc-800 dark:text-zinc-200">Delete account</strong>.</li>
            <li>Read the confirmation message and tap <strong className="text-zinc-800 dark:text-zinc-200">Delete account</strong> again to confirm.</li>
          </ol>
          <p className="mt-4 text-[15px] text-zinc-600 dark:text-zinc-400 leading-relaxed">
            Deletion begins immediately and cannot be undone.
          </p>
        </section>

        {/* What gets deleted */}
        <section className="mb-10">
          <h2 className="mb-4 text-xl font-bold text-zinc-900 dark:text-white">What gets deleted</h2>
          <p className="mb-3 text-[15px] text-zinc-600 dark:text-zinc-400">
            When you delete your account, the following data is permanently removed:
          </p>
          <ul className="ml-5 space-y-1 list-disc text-[15px] text-zinc-600 dark:text-zinc-400">
            <li>Your profile, display name, and account credentials</li>
            <li>All workouts, sets, reps, and personal records</li>
            <li>All training programs and templates</li>
            <li>All nutrition logs, calorie and macro targets, food favorites, and saved meals</li>
            <li>All progress photos and avatar images (including files in storage)</li>
            <li>All Apple Health / HealthKit and Android Health Connect synced data</li>
            <li>AI Coach (V) usage history and conversation context</li>
            <li>Trainer/client relationships, notes, and performance targets</li>
            <li>Equipment profiles, fitness goals, and preferences</li>
          </ul>
        </section>

        {/* What is retained */}
        <section className="mb-10">
          <h2 className="mb-4 text-xl font-bold text-zinc-900 dark:text-white">What is not deleted</h2>
          <p className="text-[15px] text-zinc-600 dark:text-zinc-400 leading-relaxed">
            Food items you contributed to the shared community food catalog are <strong className="text-zinc-800 dark:text-zinc-200">anonymized</strong> rather
            than deleted. Your authorship is removed, but the food entry itself remains so other users who
            rely on it are not affected. No personal information is retained in these anonymized records.
          </p>
        </section>

        {/* Partial deletion */}
        <section className="mb-10">
          <h2 className="mb-4 text-xl font-bold text-zinc-900 dark:text-white">Partial data removal</h2>
          <p className="mb-3 text-[15px] text-zinc-600 dark:text-zinc-400 leading-relaxed">
            If you want to remove specific data without deleting your entire account, you have the following options:
          </p>
          <ul className="ml-5 space-y-3 list-disc text-[15px] text-zinc-600 dark:text-zinc-400">
            <li>
              <strong className="text-zinc-800 dark:text-zinc-200">Disconnect Apple Health (iOS)</strong> — go to Health in the app and tap the
              disconnect option, or revoke permissions in iPhone Settings → Privacy &amp; Security → Health → Involved.
              Previously synced health data remains in Involved until account deletion.
            </li>
            <li>
              <strong className="text-zinc-800 dark:text-zinc-200">Disconnect Android Health Connect</strong> — go to Health in the app and tap
              the disconnect option, or revoke permissions in the Health Connect app or Android Settings →
              Apps → Involved → Permissions.
              Previously synced health data remains in Involved until account deletion.
            </li>
            <li>
              <strong className="text-zinc-800 dark:text-zinc-200">Delete individual nutrition logs or progress photos</strong> — you can remove
              specific entries at any time from within the app.
            </li>
          </ul>
          <p className="mt-4 text-[15px] text-zinc-600 dark:text-zinc-400 leading-relaxed">
            For a complete data removal, account deletion is the only option.
          </p>
        </section>

        {/* Email alternative */}
        <section className="mb-10">
          <h2 className="mb-4 text-xl font-bold text-zinc-900 dark:text-white">Delete by email</h2>
          <p className="text-[15px] text-zinc-600 dark:text-zinc-400 leading-relaxed">
            If you are unable to access the app or encounter a problem with in-app deletion, you can request
            account deletion by email. Send a message to{' '}
            <a
              href="mailto:support@involvedfit.com?subject=Account%20Deletion%20Request"
              className="text-emerald-600 dark:text-emerald-400 hover:underline"
            >
              support@involvedfit.com
            </a>{' '}
            with the subject <strong className="text-zinc-800 dark:text-zinc-200">Account Deletion Request</strong> and include the email
            address associated with your account. We will process the request and confirm when deletion is complete.
          </p>
        </section>

        <hr className="mb-8 border-zinc-200 dark:border-zinc-800" />

        <div className="flex flex-wrap gap-4 text-sm text-zinc-400">
          <Link href="/privacy" className="hover:text-zinc-900 dark:hover:text-white transition-colors">Privacy Policy</Link>
          <Link href="/support" className="hover:text-zinc-900 dark:hover:text-white transition-colors">Support</Link>
          <Link href="/" className="hover:text-zinc-900 dark:hover:text-white transition-colors">Home</Link>
        </div>

      </div>
    </div>
  )
}
