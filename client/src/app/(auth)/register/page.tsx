import { AuthPage } from '@/components/auth/AuthPage'

/* Full Registration only — the Express Account option is hidden for everyone
   (the user, 2026-10-22). It used to be hidden only on `/register?flow=full`,
   the link staff hand out; that link still works, it is simply what every
   sign-up now is. Everything past the form is unchanged: full registration →
   pending → admin approval. (Buying on /explore needs no sign-up at all: the
   account is made when the course is paid for.) */
export default function RegisterPage() {
  return <AuthPage initialMode="register" lockFull />
}
