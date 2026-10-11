'use client'

import { useEffect } from 'react'
import { motion } from 'framer-motion'
import { useUIStore } from '@/store/ui.store'
import { ClientSidebar } from '@/components/layout/ClientSidebar'
import { ClientTopbar } from '@/components/layout/ClientTopbar'
import { MobileTabBar } from '@/components/layout/MobileTabBar'
import { NotificationsSheet } from '@/components/notifications/NotificationsSheet'
import { MissedPopup } from '@/components/notifications/MissedPopup'
import { RightSidebar, RightSidebarToggle } from '@/components/layout/RightSidebar'
import { VerifyEmailBanner } from '@/components/auth/VerifyEmailBanner'
import { EnrollmentStatusBanner } from '@/components/auth/EnrollmentStatusBanner'
import { InstallCapture } from '@/components/pwa/InstallCapture'
import { AnnouncementPopup } from '@/components/announcements/AnnouncementPopup'
import { Toaster } from '@/components/ui/Toaster'
import { RootPortalHistoryBridge } from '@/components/RootPortalHistoryBridge'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { rightPanelOpen } = useUIStore()

  return (
    <div className="min-h-screen" style={{ background: 'var(--color-bg-page)' }}>
      <RootPortalHistoryBridge />
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
        {/* Below lg the bottom tab bar floats over the page: reserve its height
            (64px + its 10px gap + the iPhone home indicator) so nothing ends
            up underneath it. */}
        <div className={`px-4 py-6 pb-[calc(96px+env(safe-area-inset-bottom))] sm:px-8 sm:py-8 sm:pb-[calc(104px+env(safe-area-inset-bottom))] lg:pb-8 transition-[padding] duration-300 ease-out ${
          rightPanelOpen ? 'lg:pr-[344px]' : 'lg:pr-8'
        }`}>
          <div className="mx-auto w-full max-w-[1240px]">
            <VerifyEmailBanner />
            <EnrollmentStatusBanner />
            {children}
          </div>
        </div>
      </motion.main>

      <MobileTabBar />
      <NotificationsSheet />
      <MissedPopup />
      <RightSidebar />
      <RightSidebarToggle />
      <InstallCapture />
      <AnnouncementPopup />
      <Toaster />
    </div>
  )
}
