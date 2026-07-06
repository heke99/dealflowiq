import type { ReactNode } from 'react'

export const LEGAL_LAST_UPDATED = 'July 6, 2026'
export const SUPPORT_EMAIL = 'support@dealflowiq.com'

export function LegalArticle({ title, intro, children }: { title: string; intro: string; children: ReactNode }) {
  return (
    <article className="mx-auto max-w-3xl">
      <div className="inline-flex rounded-full border border-white/10 bg-white/[0.04] px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
        Last updated: {LEGAL_LAST_UPDATED}
      </div>
      <h1 className="mt-5 text-4xl font-bold tracking-tight sm:text-5xl">{title}</h1>
      <p className="mt-4 text-lg leading-8 text-slate-300">{intro}</p>
      <div className="mt-10 space-y-10">{children}</div>
    </article>
  )
}

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-xl font-bold text-white">{title}</h2>
      <div className="mt-3 space-y-3 text-sm leading-7 text-slate-400">{children}</div>
    </section>
  )
}

export function LegalList({ items }: { items: string[] }) {
  return (
    <ul className="list-disc space-y-2 pl-5">
      {items.map((item) => <li key={item}>{item}</li>)}
    </ul>
  )
}
