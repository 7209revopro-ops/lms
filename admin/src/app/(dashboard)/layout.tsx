'use client'

import { useUIStore } from '@/store/ui.store'
import { AdminSidebar } from '@/components/layout/AdminSidebar'
import { AdminTopbar } from '@/components/layout/AdminTopbar'
import { DeleteModal } from '@/components/courses/DeleteModal'
import { Toaster } from '@/components/ui/Toaster'
import { AdminGuard } from '@/components/auth/AdminGuard'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { sidebarCollapsed } = useUIStore()

  /* ── Why the offset is CSS and not a JS media query ────────────────────
     This used to read `useIsMobile()` and animate `marginLeft` with framer.
     `useIsMobile` is false on the server AND on the first client render — it
     can only learn the real width from an effect — so on a phone the first
     paint put a 240px margin on a 375px screen, leaving 135px of content,
     and then sprang back to 0 once the effect landed. Every hard load
     thrashed.

     A `lg:` class has no such blind spot: it is already correct in the HTML
     the server sends. The collapse width rides on a custom property so the
     topbar (a sibling, not a child of <main>) can follow the same number,
     and the CSS transition keeps the collapse/expand slide. */
  return (
    <AdminGuard>
      <div
        className="min-h-dvh"
        style={{
          background: '#080A12',
          '--admin-sb': sidebarCollapsed ? '68px' : '240px',
        } as React.CSSProperties}
      >
        <AdminSidebar />
        <AdminTopbar />

        <main className="min-h-dvh pt-[60px] transition-[margin-left] duration-300 ease-out lg:ml-[var(--admin-sb)]">
          <div className="px-4 py-4 sm:px-6 sm:py-6">
            {children}
          </div>
        </main>

        <DeleteModal />
        <Toaster />
      </div>
    </AdminGuard>
  )
}
