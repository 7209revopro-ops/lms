import type { Metadata } from 'next'
import { TERMS_SECTIONS as SECTIONS } from '@/lib/legal/terms'

export const metadata: Metadata = {
  title: 'Terms & Conditions',
  description: 'The terms students agree to when they register with Delta Institutions.',
}

/* The same text the registration form shows in its Terms dialog — one source,
   so the page and the checkbox can never disagree. */
export default function TermsPage() {
  return (
    <article className="space-y-8" style={{ color: 'var(--color-text-primary)' }}>
      <header className="space-y-2">
        <h1 className="text-3xl font-bold" style={{ fontFamily: 'Bricolage Grotesque, sans-serif' }}>Terms &amp; Conditions</h1>
        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Delta Institutions</p>
      </header>
      {SECTIONS.map((s, i) => (
        <section key={s.title} className="space-y-3">
          <h2 className="text-lg font-semibold">{i + 1}. {s.title}</h2>
          {s.content.map((p, j) => (
            <p key={j} className="text-[15px] leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>{p}</p>
          ))}
        </section>
      ))}
    </article>
  )
}
