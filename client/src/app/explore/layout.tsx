import type { Metadata } from 'next'
import './explore.css'

/* /explore — the public course catalogue (2026-10-18). No login: middleware.ts lists it as
   public and lib/axios.ts never treats a signed-out visitor here as an expired session. */
export const metadata: Metadata = {
  title: 'Explore courses',
  description: 'Every Delta Institutions course — trading, AI, digital marketing and more — with its full module list. Enrol online.',
  openGraph: {
    title: 'Explore courses · Delta Institutions',
    description: 'Every Delta Institutions course with its full module list. Enrol online.',
    type: 'website',
  },
}

export default function ExploreLayout({ children }: { children: React.ReactNode }) {
  return <div className="xp-root">{children}</div>
}
