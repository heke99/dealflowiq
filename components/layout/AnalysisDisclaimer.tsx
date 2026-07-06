import Link from 'next/link'

export function AnalysisDisclaimer({ className }: { className?: string }) {
  return (
    <p className={`text-xs leading-5 text-slate-500 ${className || ''}`}>
      Estimates only — not financial advice. Verify all data independently.{' '}
      <Link href="/disclaimer" className="underline hover:text-slate-300">Full disclaimer</Link>
    </p>
  )
}
