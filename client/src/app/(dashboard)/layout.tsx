'use client'

import { useEffect } from 'react'
import { motion } from 'framer-motion'
import { useUIStore } from '@/store/ui.store'
import { ClientSidebar } from '@/components/layout/ClientSidebar'
import { ClientTopbar } from '@/components/layout/ClientTopbar'
import { RightSidebar, RightSidebarToggle } from '@/components/layout/RightSidebar'
import { VerifyEmailBanner } from '@/components/auth/VerifyEmailBanner'
import { EnrollmentStatusBanner } from '@/components/auth/EnrollmentStatusBanner'
import { InstallPrompt } from '@/components/pwa/InstallPrompt'
import { AnnouncementPopup } from '@/components/announcements/AnnouncementPopup'
import { Toaster } from '@/components/ui/Toaster'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { rightPanelOpen } = useUIStore()

  return (
    <div className="min-h-screen" style={{ background: 'var(--color-bg-page)' }}>
      {/* Mobile drawer only — desktop sidebar removed */}
      <ClientSidebar />

      <ClientTopbar />

      {/* The header is fixed, so main has to reserve its height. Both read the
          same token — hand-written values here drifted 1px under the real
          header and clipped whatever sat at the top of the page. */}
      <motion.main className="min-h-screen" style={{ paddingTop: 'var(--app-header-h)' }}>
        {/* Two nested containers, because these are two separate jobs and
            combining them fights itself: the OUTER one reserves the fixed
            right panel's width as padding, the INNER one caps the reading
            width. Done as `mx-auto` + `lg:mr-[…]` on one element, the auto
            margin wins the cascade and the content slides under the panel. */}
        <div className={`px-4 py-6 sm:px-8 sm:py-8 transition-[padding] duration-300 ease-out ${
          rightPanelOpen ? 'lg:pr-[344px]' : 'lg:pr-8'
        }`}>
          <div className="mx-auto w-full max-w-[1240px]">
            <VerifyEmailBanner />
            <EnrollmentStatusBanner />
            {children}
          </div>
        </div>
      </motion.main>

      <RightSidebar />
      <RightSidebarToggle />
      <InstallPrompt />
      <AnnouncementPopup />
      <Toaster />
    </div>
  )
}
