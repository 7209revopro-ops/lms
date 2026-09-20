'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AlertCircle, ArrowRight } from 'lucide-react'
import Link from 'next/link'
import { AuthShell } from '@/components/auth/AuthShell'
import Spinner from '@/components/ui/Spinner'
import { api } from '@/lib/axios'

/**
 * Arriving from the Root portal.
 *
 * The portal signs somebody in once and sends them here with a single-use
 * token in the address. This page hands that token to our own server, which
 * asks the portal whether it is good, and ends with the ordinary admin
 * session — the same cookies a password sign-in would have set.
 *
 * There is nothing to click. Somebody landing here has already decided to
 * come, and a button saying "continue" would only be a second decision about
 * the same thing.
 */
function Redeem() {
  const router = useRouter()
  const params = useSearchParams()
  const token = params.get('token')
  const [error, setError] = useState<string | null>(null)

  /*
   * Once, even under React's development double-mount.
   *
   * The token is single-use: a second attempt spends nothing and gets a
   * refusal, which would replace a working sign-in with "invalid or expired"
   * on the screen of somebody who had in fact just signed in.
   */
  const tried = useRef(false)

  useEffect(() => {
    if (tried.current) return
    tried.current = true

    if (!token) {
      setError('This sign-in link has no token in it. Open the LMS from the portal again.')
      return
    }

    void (async () => {
      try {
        await api.post('/admin/auth/sso-login', { token })
        // replace, not push: the address holds a spent token, and Back should
        // not return to a page that will now refuse.
        router.replace('/')
        router.refresh()
      } catch (err) {
        const message =
          (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error
            ?.message ?? 'That sign-in could not be completed. Open the LMS from the portal again.'
        setError(message)
      }
    })()
  }, [token, router])

  if (error) {
    return (
      <div className="space-y-4 text-center">
        <AlertCircle className="mx-auto h-8 w-8 text-red-500" />
        <div>
          <p className="font-medium">Could not sign you in</p>
          {/* The server's own words. It knows whether the token was spent, the
              account is unknown here, or the portal could not be reached — and
              each of those needs a different thing done about it. */}
          <p className="mt-1 text-sm text-muted-foreground">{error}</p>
        </div>
        <Link
          href="/login"
          className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
        >
          Sign in with your email instead <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-4 text-center">
      <Spinner />
      <p className="text-sm text-muted-foreground">Signing you in…</p>
    </div>
  )
}

export default function SsoPage() {
  return (
    <AuthShell>
      {/* useSearchParams needs a boundary, or the whole route opts out of
          static rendering at build time. */}
      <Suspense fallback={<Spinner />}>
        <Redeem />
      </Suspense>
    </AuthShell>
  )
}
