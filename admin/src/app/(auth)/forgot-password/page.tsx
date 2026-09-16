'use client'

import { AuthShell } from '@/components/auth/AuthShell'
import { AdminForgotPasswordForm } from '@/components/auth/AdminForgotPasswordForm'

export default function AdminForgotPasswordPage() {
  return (
    <AuthShell>
      <AdminForgotPasswordForm />
    </AuthShell>
  )
}
