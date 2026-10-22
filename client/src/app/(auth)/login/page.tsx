import { AuthPage } from '@/components/auth/AuthPage'

/* Mirrors register/page.tsx: sign-up is Full Registration only (2026-10-22), so a
   hop from Sign in to Sign up never shows the Express Account tab either. */
export default function LoginPage() {
  return <AuthPage initialMode="login" lockFull />
}
