import { Redirect } from 'expo-router'
import { useAuth } from '@/lib/auth'

/* A path with no screen for the current state. The usual cause is a link
   opened while signed out: the signed-in screens are hidden by the guard in
   _layout.tsx, so "/" (Home) or "/class/…" matches nothing. Never show
   "Unmatched Route" to a student — go to sign-in, or Home once signed in.
   (Found on the first device run: the development build launches with a bare
   deltalms:// URL, which is "/".) */
export default function NotFound() {
  const { state } = useAuth()
  if (state.status === 'booting') return null
  return <Redirect href={state.status === 'signedIn' ? '/' : '/sign-in'} />
}
