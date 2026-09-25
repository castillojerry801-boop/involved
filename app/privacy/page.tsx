import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

export const metadata: Metadata = {
  title: 'Privacy Policy — Involved',
  description: 'How Involved collects, uses, and protects your information.',
}

const UPDATED = 'September 25, 2026'

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="mb-10">
      <h2 className="mb-4 text-xl font-bold text-zinc-900 dark:text-white">{title}</h2>
      <div className="space-y-3 text-zinc-600 dark:text-zinc-400 leading-relaxed">
        {children}
      </div>
    </section>
  )
}

function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="mt-5 mb-2 font-semibold text-zinc-800 dark:text-zinc-200">{children}</h3>
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-[15px]">{children}</p>
}

function UL({ items }: { items: string[] }) {
  return (
    <ul className="ml-5 space-y-1 list-disc text-[15px]">
      {items.map((item, i) => <li key={i}>{item}</li>)}
    </ul>
  )
}

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-white dark:bg-zinc-950">
      <div className="mx-auto max-w-3xl px-5 py-10 md:px-8 md:py-16">

        {/* Back link */}
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
          <h1 className="text-4xl font-black tracking-tight text-zinc-900 dark:text-white">Privacy Policy</h1>
          <p className="mt-3 text-sm text-zinc-400">Last updated: {UPDATED}</p>
          <p className="mt-4 text-[15px] text-zinc-600 dark:text-zinc-400 leading-relaxed">
            Involved (&ldquo;Involved,&rdquo; &ldquo;we,&rdquo; &ldquo;our,&rdquo; or &ldquo;us&rdquo;) is operated by
            GameFloHQ LLC. This Privacy Policy explains how we collect, use, and protect information you provide
            when you use the Involved mobile app and related services (collectively, the &ldquo;Service&rdquo;).
          </p>
          <p className="mt-3 text-[15px] text-zinc-600 dark:text-zinc-400 leading-relaxed">
            By using Involved, you agree to the practices described in this policy. If you do not agree,
            please do not use the Service.
          </p>
        </div>

        <hr className="mb-10 border-zinc-200 dark:border-zinc-800" />

        {/* 1. Information We Collect */}
        <Section id="information-we-collect" title="1. Information We Collect">
          <H3>Account &amp; Profile Information</H3>
          <UL items={[
            'Name and display name',
            'Email address',
            'Profile photo (optional)',
            'Authentication and session data',
            'Fitness level, goals, and onboarding preferences',
          ]} />

          <H3>Fitness &amp; Training Data</H3>
          <UL items={[
            'Workouts you log, including exercises, sets, reps, and weights',
            'Training programs and templates you create or follow',
            'Exercise history and personal records',
            'Fitness goals and weekly targets',
            'Training schedule and completed sessions',
          ]} />

          <H3>Nutrition Data</H3>
          <UL items={[
            'Foods and meals you log, including calories and macronutrients (protein, carbohydrates, fat)',
            'Barcode scans used to identify food items',
            'Meal photos you submit for AI-assisted nutrition analysis',
            'Nutrition goals and daily targets',
            'AI-generated calorie and macro estimates based on photos or descriptions',
          ]} />

          <H3>Apple Health / HealthKit Data</H3>
          <P>
            If you connect Apple Health, Involved may access, with your explicit permission, the following
            HealthKit data types:
          </P>
          <UL items={[
            'Workouts and activity data',
            'Daily step count',
            'Active energy burned (all-day)',
            'Resting / basal energy burned',
            'Heart rate (from workouts)',
            'Resting heart rate',
            'Body mass / body weight',
            'Other fitness metrics you explicitly authorize through iOS Settings',
          ]} />
          <P>
            HealthKit data is accessed only when you grant permission through the iOS Health permission dialog.
            You can revoke these permissions at any time via the iOS Health app or iPhone Settings.
          </P>

          <H3>Progress Photos</H3>
          <UL items={[
            'Photos you voluntarily upload as progress photos or profile photos',
            'Meal photos you submit for nutrition analysis',
            'Notes you attach to progress photos',
          ]} />
          <P>
            Progress photos are private to your account and are not shared with trainers or other users
            unless you explicitly choose to share them.
          </P>

          <H3>AI Coach Interactions</H3>
          <UL items={[
            'Messages and questions you send to V, the Involved AI Coach',
            'Workout and program generation requests',
            'Nutrition and meal analysis requests',
            'Context about your training history and goals used to personalize AI responses',
          ]} />

          <H3>Device &amp; Technical Information</H3>
          <UL items={[
            'App version and device type',
            'Operating system version',
            'IP address and approximate location (derived from IP for timezone purposes)',
            'Session and authentication logs',
            'Error and diagnostic information used to improve the Service',
          ]} />
        </Section>

        {/* 2. How We Use Your Information */}
        <Section id="how-we-use" title="2. How We Use Your Information">
          <P>We use the information we collect to:</P>
          <UL items={[
            'Provide, operate, and maintain the Involved Service',
            'Personalize training programs, nutrition guidance, and AI Coach responses to you',
            'Sync and display Apple Health data within the app',
            'Analyze your nutrition from food logs, barcodes, or meal photos',
            'Generate AI-powered workout and program recommendations',
            'Send transactional communications (e.g., trainer invitations)',
            'Respond to support requests',
            'Detect and prevent fraud, abuse, or security issues',
            'Improve and develop new features',
            'Comply with legal obligations',
          ]} />
        </Section>

        {/* 3. HealthKit-Specific Disclosures */}
        <Section id="healthkit" title="3. HealthKit — Specific Disclosures">
          <P>The following commitments apply specifically to data obtained through Apple HealthKit:</P>
          <UL items={[
            'Involved does not sell HealthKit data.',
            'Involved does not use HealthKit data for advertising or marketing purposes.',
            'Involved does not share HealthKit data with third parties except as strictly necessary to provide the Service (e.g., storing data in our secure database on your behalf).',
            'HealthKit data is used only to provide fitness tracking, activity display, personalized coaching, and related app features.',
            'You can revoke Health permissions at any time via iOS Settings → Privacy & Security → Health → Involved.',
          ]} />
        </Section>

        {/* 4. Service Providers */}
        <Section id="service-providers" title="4. Third-Party Service Providers">
          <P>
            We share information with the following categories of service providers, solely to operate the Service:
          </P>

          <H3>Infrastructure &amp; Database</H3>
          <UL items={[
            'Supabase — authentication, database, and file storage',
            'Vercel — app hosting and serverless compute',
          ]} />

          <H3>Artificial Intelligence</H3>
          <UL items={[
            'OpenAI — powers V, the AI Coach; workout and program generation; and nutrition analysis. Messages you send to V and related context may be processed by OpenAI to generate responses.',
          ]} />

          <H3>Nutrition Data</H3>
          <P>
            Involved uses the following food databases to power nutrition search and barcode lookups.
            Search queries may be sent to these services:
          </P>
          <UL items={[
            'FatSecret — food search and barcode lookups',
            'Nutritionix — food search and restaurant data',
            'USDA FoodData Central — food composition data',
            'Open Food Facts — packaged food database',
            'NIH Dietary Supplement Label Database (DSLD) — supplement data',
          ]} />

          <H3>Email</H3>
          <UL items={[
            'Resend — transactional email delivery (e.g., trainer invitations, support confirmations)',
          ]} />

          <P>
            We do not sell your personal information to third parties. Service providers access only the
            data necessary to perform their functions and are prohibited from using it for any other purpose.
          </P>
        </Section>

        {/* 5. Data Retention */}
        <Section id="data-retention" title="5. Data Retention">
          <P>
            We retain your data for as long as your account is active or as needed to provide the Service.
            If you delete your account, we will delete your personal data in accordance with our standard
            deletion process, subject to any legal obligations to retain certain records.
          </P>
          <P>
            Health and fitness data synced from Apple Health is stored in our database until you disconnect
            Apple Health or delete your account.
          </P>
        </Section>

        {/* 6. Security */}
        <Section id="security" title="6. Security">
          <P>
            We implement reasonable technical and organizational measures to protect your information,
            including encrypted connections (HTTPS/TLS), secure authentication through Supabase, and
            role-based access controls. However, no system is perfectly secure, and we cannot guarantee
            absolute security of your data.
          </P>
          <P>
            If you believe your account has been compromised, contact us immediately at{' '}
            <a href="mailto:support@involvedfit.com" className="text-emerald-600 dark:text-emerald-400 hover:underline">
              support@involvedfit.com
            </a>.
          </P>
        </Section>

        {/* 7. Your Rights & Choices */}
        <Section id="your-rights" title="7. Your Rights &amp; Choices">
          <H3>Access &amp; Correction</H3>
          <P>
            You may access and update your profile information within the app at any time through Profile →
            Edit Profile.
          </P>

          <H3>Apple Health Permissions</H3>
          <P>
            You can manage or revoke HealthKit permissions at any time via iOS Settings → Privacy &amp;
            Security → Health → Involved.
          </P>

          <H3>Account Deletion</H3>
          <P>
            You have the right to delete your account and associated data. Account deletion is planned
            as a feature to be implemented before full public launch. Until then, you may request deletion
            by emailing{' '}
            <a href="mailto:support@involvedfit.com" className="text-emerald-600 dark:text-emerald-400 hover:underline">
              support@involvedfit.com
            </a>{' '}
            with the subject &ldquo;Account Deletion Request.&rdquo; We will process your request promptly.
          </P>

          <H3>Communications</H3>
          <P>
            Involved sends transactional emails (e.g., invitations, support replies). We do not send
            marketing emails without your consent.
          </P>
        </Section>

        {/* 8. Children */}
        <Section id="children" title="8. Children&apos;s Privacy">
          <P>
            Involved is not directed at children under 13 years of age (or under 16 where required by
            applicable law). We do not knowingly collect personal information from children under these
            ages. If you believe we have inadvertently collected information from a child, please contact
            us and we will delete it promptly.
          </P>
        </Section>

        {/* 9. Not Medical Advice */}
        <Section id="not-medical" title="9. Not Medical Advice">
          <P>
            Involved is a fitness and wellness app. The information, AI-generated recommendations,
            and data displays within Involved are for general fitness and informational purposes only.
            They do not constitute medical advice, diagnosis, or treatment. Always consult a qualified
            healthcare professional before making decisions about your health.
          </P>
        </Section>

        {/* 10. Changes */}
        <Section id="changes" title="10. Changes to This Policy">
          <P>
            We may update this Privacy Policy from time to time. If we make material changes, we will
            notify you by updating the &ldquo;Last updated&rdquo; date at the top of this page. Your continued
            use of Involved after such changes constitutes acceptance of the updated policy.
          </P>
        </Section>

        {/* 11. Contact */}
        <Section id="contact" title="11. Contact Us">
          <P>If you have questions about this Privacy Policy or your data, please contact us:</P>
          <P>
            <strong className="text-zinc-800 dark:text-zinc-200">GameFloHQ LLC</strong><br />
            Email:{' '}
            <a href="mailto:support@involvedfit.com" className="text-emerald-600 dark:text-emerald-400 hover:underline">
              support@involvedfit.com
            </a><br />
            Website:{' '}
            <a href="https://involvedfit.com" className="text-emerald-600 dark:text-emerald-400 hover:underline">
              involvedfit.com
            </a>
          </P>
        </Section>

        <hr className="mb-8 border-zinc-200 dark:border-zinc-800" />

        <p className="text-xs text-zinc-400 dark:text-zinc-600">
          This is product-ready draft language. Final Terms and Privacy Policy should be reviewed by
          qualified legal counsel before full public launch.
        </p>

        <div className="mt-8 flex flex-wrap gap-4 text-sm text-zinc-400">
          <Link href="/terms" className="hover:text-zinc-900 dark:hover:text-white transition-colors">Terms of Service</Link>
          <Link href="/support" className="hover:text-zinc-900 dark:hover:text-white transition-colors">Support</Link>
          <Link href="/" className="hover:text-zinc-900 dark:hover:text-white transition-colors">Home</Link>
        </div>

      </div>
    </div>
  )
}
