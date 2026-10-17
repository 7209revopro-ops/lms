/* Public legal pages (/terms, /privacy). Reachable signed in or out — the
   app stores and the mobile app link here (plan.md §13.11) — so they sit
   outside the auth and dashboard shells, on the light palette. */
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-theme="light" style={{ background: 'var(--color-bg-page)', minHeight: '100vh' }}>
      <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 sm:py-14">{children}</main>
    </div>
  )
}
