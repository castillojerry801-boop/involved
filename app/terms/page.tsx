import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

export const metadata: Metadata = {
  title: 'Terms of Service — Involved',
  description: 'Terms and conditions for using the Involved fitness app.',
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

export default function TermsPage() {
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
          <h1 className="text-4xl font-black tracking-tight text-zinc-900 dark:text-white">Terms of Service</h1>
          <p className="mt-3 text-sm text-zinc-400">Last updated: {UPDATED}</p>
          <p className="mt-4 text-[15px] text-zinc-600 dark:text-zinc-400 leading-relaxed">
            These Terms of Service (&ldquo;Terms&rdquo;) govern your access to and use of Involved (&ldquo;the Service&rdquo;),
            operated by GameFloHQ LLC (&ldquo;Company,&rdquo; &ldquo;we,&rdquo; &ldquo;our,&rdquo; or &ldquo;us&rdquo;). Please read
            them carefully before using the Service.
          </p>
          <p className="mt-3 text-[13px] text-zinc-400 leading-relaxed italic">
            Note: This is product-ready draft language. Final terms should be reviewed by qualified legal
            counsel before full public launch.
          </p>
        </div>

        <hr className="mb-10 border-zinc-200 dark:border-zinc-800" />

        {/* 1. Acceptance */}
        <Section id="acceptance" title="1. Acceptance of Terms">
          <P>
            By creating an account or using Involved, you agree to be bound by these Terms. If you do not
            agree, do not use the Service. We may update these Terms from time to time; continued use of
            the Service after changes are posted constitutes acceptance of the updated Terms.
          </P>
        </Section>

        {/* 2. Eligibility */}
        <Section id="eligibility" title="2. Eligibility">
          <P>
            You must be at least 13 years old (or the minimum age of digital consent in your jurisdiction)
            to use Involved. By using the Service, you represent that you meet this requirement. If you are
            using Involved on behalf of another person (e.g., as a trainer managing a client), you represent
            that you have the authority to bind that person to these Terms.
          </P>
        </Section>

        {/* 3. Account Responsibility */}
        <Section id="accounts" title="3. Account &amp; Accurate Information">
          <P>
            You are responsible for maintaining the security of your account credentials. Do not share your
            password with others. You are responsible for all activity that occurs under your account.
          </P>
          <P>
            You agree to provide accurate, current, and complete information during registration and to keep
            your account information up to date.
          </P>
        </Section>

        {/* 4. Acceptable Use */}
        <Section id="acceptable-use" title="4. Acceptable Use">
          <P>You agree not to:</P>
          <UL items={[
            'Use the Service for any unlawful purpose',
            'Attempt to gain unauthorized access to any part of the Service',
            'Upload, transmit, or share content that is illegal, harmful, abusive, or violates the rights of others',
            'Scrape, reverse-engineer, or attempt to extract source code from the Service',
            'Impersonate another person or entity',
            'Interfere with the integrity or performance of the Service',
          ]} />
        </Section>

        {/* 5. Fitness & Training */}
        <Section id="fitness" title="5. Fitness &amp; Training — Disclaimer">
          <P>
            <strong className="text-zinc-700 dark:text-zinc-300">Exercise involves inherent risk of injury.</strong>{' '}
            Involved provides training programs, workout templates, and coaching guidance for informational
            and planning purposes only. This content does not account for your individual health conditions,
            physical limitations, or medical history.
          </P>
          <P>
            You are solely responsible for determining whether any exercise, program, or activity is
            appropriate and safe for you. You should:
          </P>
          <UL items={[
            'Consult a qualified physician or healthcare professional before beginning any new exercise program, especially if you have existing health conditions or concerns',
            'Stop exercising and seek medical attention if you experience pain, dizziness, shortness of breath, chest discomfort, or other concerning symptoms',
            'Use proper form and technique, and reduce load or intensity if in doubt',
            'In any emergency, call emergency services (911 in the U.S.) — Involved is not a substitute for emergency response',
          ]} />
          <P>
            To the fullest extent permitted by applicable law, GameFloHQ LLC is not responsible for injuries
            or adverse outcomes resulting from improper exercise execution, ignoring medical guidance, or
            failure to exercise reasonable care.
          </P>
        </Section>

        {/* 6. Nutrition */}
        <Section id="nutrition" title="6. Nutrition Information — Disclaimer">
          <P>
            Calorie and macronutrient values in Involved come from third-party food databases (FatSecret,
            Nutritionix, USDA FoodData Central, Open Food Facts, NIH DSLD) and AI-assisted estimates.
            These values are estimates and may not be perfectly accurate:
          </P>
          <UL items={[
            'Database values can differ from actual product formulations',
            'Restaurant portions and recipes vary by location and preparation',
            'AI-generated estimates from meal photos are approximations and may have meaningful error margins',
          ]} />
          <P>
            Nutrition information in Involved is for general tracking purposes and should not be used as the
            sole basis for medical dietary decisions. Consult a registered dietitian or healthcare provider
            for medical nutrition guidance.
          </P>
        </Section>

        {/* 7. AI Coach */}
        <Section id="ai-coach" title="7. AI Coach (V) — Disclaimer">
          <P>
            V, the Involved AI Coach, generates fitness and nutrition guidance using OpenAI&apos;s language
            models. AI-generated outputs:
          </P>
          <UL items={[
            'May contain errors, inaccuracies, or outdated information',
            'Are informational only and do not constitute professional fitness, medical, or dietary advice',
            'Should not replace the judgment of a qualified personal trainer, physician, or registered dietitian',
            'May not account for your full medical history, individual limitations, or unique circumstances',
          ]} />
          <P>
            You remain responsible for all decisions and actions you take based on AI-generated content.
            When in doubt, consult a qualified professional.
          </P>
          <P>
            Messages and context you provide to V may be processed by OpenAI to generate responses, in
            accordance with OpenAI&apos;s data policies.
          </P>
        </Section>

        {/* 8. Apple Health */}
        <Section id="apple-health" title="8. Apple Health &amp; Connected Health Platforms">
          <P>
            If you connect Involved to Apple Health or another health platform, you authorize Involved to
            read the specific data types you approve. You can revoke these permissions at any time through
            iOS Settings.
          </P>
          <P>
            Involved does not control the accuracy of data provided by Apple Health or other connected
            platforms. Health and fitness data from these platforms is used solely to display activity
            information and personalize your experience within Involved.
          </P>
        </Section>

        {/* 9. User Content */}
        <Section id="user-content" title="9. User Content">
          <P>
            You retain ownership of content you create in Involved, including workout logs, notes, and
            photos. By using the Service, you grant GameFloHQ LLC a limited license to store, process, and
            display your content solely to operate the Service.
          </P>
          <P>
            Progress photos are private to your account and are not shared with trainers or other users
            unless you explicitly choose to share them. Trainers connected to your account do not
            automatically receive access to your private progress photos.
          </P>
        </Section>

        {/* 10. Intellectual Property */}
        <Section id="ip" title="10. Intellectual Property">
          <P>
            Involved, its design, branding, software, and original content are owned by GameFloHQ LLC and
            protected by applicable intellectual property laws. Nothing in these Terms grants you any right
            to use our trademarks, logos, or proprietary content outside the Service.
          </P>
        </Section>

        {/* 11. Subscriptions */}
        <Section id="subscriptions" title="11. Subscriptions &amp; Paid Features">
          <P>
            Involved may offer paid subscription plans (&ldquo;Involved+&rdquo;) with additional features.
          </P>
          <UL items={[
            'Subscription pricing and billing terms will be clearly disclosed before purchase',
            'Subscriptions may auto-renew unless cancelled before the renewal date',
            'Cancellation is handled through the applicable platform (App Store for iOS subscriptions)',
            'Trial periods, if offered, will convert to a paid subscription unless cancelled before the trial ends',
            'We do not control refund policies for App Store purchases — refer to Apple\'s refund policies',
          ]} />
          <P>
            We reserve the right to change pricing or subscription terms with reasonable notice to active
            subscribers.
          </P>
        </Section>

        {/* 12. Termination */}
        <Section id="termination" title="12. Termination">
          <P>
            You may stop using Involved at any time. Account deletion will be available through the app.
            Until self-service deletion is implemented, contact{' '}
            <a href="mailto:support@involvedfit.com" className="text-emerald-600 dark:text-emerald-400 hover:underline">
              support@involvedfit.com
            </a>{' '}
            to request deletion.
          </P>
          <P>
            We reserve the right to suspend or terminate your account if you violate these Terms or engage
            in conduct that harms users, the Service, or third parties. We will provide notice where
            reasonably practicable.
          </P>
          <P>
            Upon termination, your right to use the Service ends. Provisions that by their nature should
            survive termination (including disclaimers, limitations of liability, and governing law) will
            continue to apply.
          </P>
        </Section>

        {/* 13. Disclaimers */}
        <Section id="disclaimers" title="13. Disclaimers">
          <P>
            THE SERVICE IS PROVIDED &ldquo;AS IS&rdquo; AND &ldquo;AS AVAILABLE&rdquo; WITHOUT WARRANTIES OF ANY KIND,
            EXPRESS OR IMPLIED, INCLUDING WITHOUT LIMITATION WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
            PARTICULAR PURPOSE, OR NON-INFRINGEMENT. WE DO NOT WARRANT THAT THE SERVICE WILL BE
            UNINTERRUPTED, ERROR-FREE, OR SECURE.
          </P>
        </Section>

        {/* 14. Limitation of Liability */}
        <Section id="liability" title="14. Limitation of Liability">
          <P>
            TO THE FULLEST EXTENT PERMITTED BY APPLICABLE LAW, GAMEFLOQHQ LLC SHALL NOT BE LIABLE FOR ANY
            INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES ARISING OUT OF OR RELATED TO
            YOUR USE OF THE SERVICE. OUR TOTAL LIABILITY TO YOU FOR ANY CAUSE OF ACTION SHALL NOT EXCEED
            THE GREATER OF (A) $100 OR (B) THE AMOUNT YOU PAID US IN THE TWELVE MONTHS PRIOR TO THE
            CLAIM.
          </P>
          <P>
            Some jurisdictions do not allow certain limitations of liability, so the above may not apply
            to you in full.
          </P>
        </Section>

        {/* 15. Governing Law */}
        <Section id="governing-law" title="15. Governing Law">
          <P>
            These Terms are governed by and construed in accordance with the laws of the State of Utah,
            United States, without regard to its conflict of law principles. Any disputes arising under
            these Terms shall be subject to the exclusive jurisdiction of the courts located in Utah,
            unless otherwise required by applicable law.
          </P>
        </Section>

        {/* 16. Apple */}
        <Section id="apple" title="16. Apple App Store — Additional Terms">
          <P>
            If you download Involved from the Apple App Store, the following also applies:
          </P>
          <UL items={[
            'These Terms are between you and GameFloHQ LLC only — not Apple, Inc.',
            'Apple is not responsible for the Service or its content.',
            'Apple has no obligation to provide maintenance or support for Involved.',
            'In the event of any failure of the Service to conform to applicable warranties, you may notify Apple, and Apple will refund your App Store purchase price (if any). To the maximum extent permitted by law, Apple has no other warranty obligation regarding the Service.',
            'Apple is not responsible for addressing any claims you or a third party may have relating to the Service.',
            'Your use of Involved must comply with the Apple App Store Terms of Service.',
          ]} />
        </Section>

        {/* 17. Contact */}
        <Section id="contact" title="17. Contact">
          <P>Questions about these Terms? Contact us:</P>
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
          <Link href="/privacy" className="hover:text-zinc-900 dark:hover:text-white transition-colors">Privacy Policy</Link>
          <Link href="/support" className="hover:text-zinc-900 dark:hover:text-white transition-colors">Support</Link>
          <Link href="/" className="hover:text-zinc-900 dark:hover:text-white transition-colors">Home</Link>
        </div>

      </div>
    </div>
  )
}
