import type { Metadata } from 'next'
import { CMA_TERMS_SECTIONS as SECTIONS, CMA_TERMS_INTRO, CMA_TERMS_VERSION, CMA_TERMS_PDF } from '@/lib/legal/cmaTerms'

export const metadata: Metadata = {
  title: 'CMA (US) Terms & Conditions',
  description: 'The terms students agree to when they register for the Delta Commerce Academy CMA (US) course.',
}

/* The same text the registration form shows when CMA (US) is picked. */
export default function CmaTermsPage() {
  return (
    <article className="space-y-8" style={{ color: 'var(--color-text-primary)' }}>
      <header className="space-y-2">
        <h1 className="text-3xl font-bold" style={{ fontFamily: 'Bricolage Grotesque, sans-serif' }}>CMA (US) Terms &amp; Conditions</h1>
        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
          Delta Commerce Academy · CMA (US) examination coaching / preparatory course · Version date {CMA_TERMS_VERSION} ·{' '}
          <a href={CMA_TERMS_PDF} target="_blank" rel="noopener noreferrer" className="font-semibold underline">Download PDF</a>
        </p>
        <p className="text-[15px] leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>{CMA_TERMS_INTRO}</p>
      </header>
      {SECTIONS.map((s, i) => (
        <section key={s.title} className="space-y-3">
          <h2 className="text-lg font-semibold">{i + 1}. {s.title}</h2>
          {s.content.map((p, j) => (
            <p key={j} className="text-[15px] leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
              <span className="font-semibold">{i + 1}.{j + 1}.</span> {p}
            </p>
          ))}
        </section>
      ))}
    </article>
  )
}
