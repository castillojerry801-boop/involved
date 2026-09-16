import { BackgroundCarousel } from '@/components/background-carousel'

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <BackgroundCarousel />
      {children}
    </>
  )
}
