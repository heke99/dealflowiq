import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: {
    default: 'DealFlowIQ',
    template: '%s · DealFlowIQ',
  },
  description: 'Real estate deal sourcing, underwriting, rent intelligence and buyer matching for investors and communities.',
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  )
}
