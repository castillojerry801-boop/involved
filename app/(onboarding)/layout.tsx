import Image from 'next/image'

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex flex-col">
      <header className="flex h-14 items-center px-6 border-b border-zinc-100 dark:border-zinc-900 bg-white dark:bg-zinc-950">
        <div className="rounded-lg bg-zinc-950 px-3 py-1.5">
          <Image src="/involved-logo-custom.jpg" alt="Involved" width={88} height={29} className="object-contain" priority />
        </div>
      </header>
      <main className="flex-1 flex items-start justify-center px-4 py-8">
        {children}
      </main>
    </div>
  )
}
