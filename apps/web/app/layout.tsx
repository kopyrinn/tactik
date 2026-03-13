import type { Metadata } from 'next'
import { Noto_Sans } from 'next/font/google'
import DemoTimerBanner from '@/components/DemoTimerBanner'
import './globals.css'

const notoSans = Noto_Sans({
  subsets: ['latin', 'cyrillic'],
  weight: ['400', '500', '600', '700', '800', '900'],
  display: 'swap',
  variable: '--font-base',
})

export const metadata: Metadata = {
  title: 'tactik.kz - Professional Video Analysis',
  description: 'Real-time collaborative telestration tool for coaches, creators, and studios',
  icons: {
    icon: '/icon.png',
    shortcut: '/icon.png',
    apple: '/apple-icon.png',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ru">
      <body className={notoSans.variable}>
        <DemoTimerBanner />
        {children}
      </body>
    </html>
  )
}
