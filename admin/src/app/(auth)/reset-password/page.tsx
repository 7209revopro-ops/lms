'use client'

import { Suspense } from 'react'
import { AuthShell } from '@/components/auth/AuthShell'
import { AdminResetPasswordForm } from '@/components/auth/AdminResetPasswordForm'

export default function AdminResetPasswordPage() {
  return (
    <AuthShell>
      <Suspense fallback={<div className="h-[420px]" />}>
        <AdminResetPasswordForm />
      </Suspense>
    </AuthShell>
  )
}
