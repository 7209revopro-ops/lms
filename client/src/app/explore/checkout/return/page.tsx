'use client'
/* ─────────────────────────────────────────────────────────────
   /explore/checkout/return — where Card (Abzer/BillXPro), Tabby and Tamara
   send a buyer from /explore back (2026-10-18). Asks the API to finish the
   checkout (the httpOnly checkout cookie says whose), waiting a little for
   the gateway's webhook when the redirect beats it. Paid → a new account is
   signed in straight into the course; an existing one is told to check email.

   Cancelled / declined: Tabby's QA requires its own sentences, word for word,
   and the way back to checkout — the other gateways get plain ones.
───────────────────────────────────────────────────────────── */
import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { AlertCircle, Check, Loader2, Mail } from 'lucide-react'
import { api } from '@/lib/axios'
import { RETURN_KEY, type CompleteResult } from '@/components/explore/GuestCheckout'

const TABBY_CANCEL  = 'You aborted the payment. Please retry or choose another payment method.'
const TABBY_FAILURE = 'Sorry, Tabby is unable to approve this purchase. Please use an alternative payment method for your order'

function ReturnInner() {
  const q = useSearchParams()
  const gateway = q.get('gateway') ?? ''
  const status  = q.get('status')
  /* Tamara returns OUR order as lmsOrder (its own orderId rides alongside) — order.service returnUrls. */
  const orderId = q.get('lmsOrder') ?? q.get('orderId') ?? ''
  const [state, setState] = useState<'working' | 'emailed' | 'pending' | 'error'>('working')
  const [msg, setMsg] = useState('')
  const [slug, setSlug] = useState<string | null>(null)
  useEffect(() => { try { setSlug(sessionStorage.getItem(RETURN_KEY)) } catch { /* private mode */ } }, [])

  const stopped = status === 'cancelled' || status === 'failed'
  useEffect(() => {
    if (stopped || !orderId) return
    let alive = true
    ;(async () => {
      /* The redirect often arrives before the gateway's webhook — ask a few times before saying "pending". */
      for (let i = 0; i < 6 && alive; i++) {
        try {
          const r = await api.post<{ data: CompleteResult }>('/public/checkout/complete', {
            gateway, orderId, paymentId: q.get('payment_id') ?? undefined,
          })
          const d = r.data.data
          if (d.paid) {
            if (d.signIn) { window.location.replace(d.signIn); return }
            if (alive) setState('emailed')
            return
          }
        } catch (e) {
          const m = (e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message
          if (alive) { setMsg(m ?? 'We could not confirm this payment.'); setState('error') }
          return
        }
        await new Promise(r => setTimeout(r, 2500))
      }
      if (alive) setState('pending')
    })()
    return () => { alive = false }
  }, [gateway, orderId, stopped, q])

  const back = slug ? `/explore/${slug}?buy=1` : '/explore'
  const card = (icon: React.ReactNode, title: string, body: React.ReactNode, cta?: React.ReactNode) => (
    <div className="mx-auto max-w-[480px] rounded-3xl border p-8 text-center" style={{ borderColor: 'var(--xp-line)', background: 'var(--xp-card)' }}>
      <div className="mb-4 flex justify-center">{icon}</div>
      <h1 className="xp-display text-2xl font-bold" style={{ color: 'var(--xp-text)' }}>{title}</h1>
      <div className="mt-3 text-[15px] leading-relaxed" style={{ color: 'var(--xp-text-2)' }}>{body}</div>
      {cta && <div className="mt-6">{cta}</div>}
    </div>
  )
  const btn = (href: string, label: string) => (
    <Link href={href} className="inline-flex rounded-2xl px-6 py-3.5 font-semibold text-white" style={{ background: 'linear-gradient(135deg, #0a6be0, #0057b8)' }}>{label}</Link>
  )
  const bad = <span className="flex h-14 w-14 items-center justify-center rounded-full" style={{ background: '#fdecec', color: '#b42318' }}><AlertCircle size={26} /></span>

  if (status === 'cancelled') {
    return card(bad, 'Payment cancelled', gateway === 'tabby' ? TABBY_CANCEL : 'You cancelled the payment — no money was taken. You can try again or choose another payment method.', btn(back, 'Back to checkout'))
  }
  if (status === 'failed') {
    return card(bad, 'Payment not completed', gateway === 'tabby' ? TABBY_FAILURE : 'The payment did not go through and no money was taken. Please try again or choose another payment method.', btn(back, 'Back to checkout'))
  }
  if (!orderId) return card(bad, 'Nothing to confirm', 'This page is opened after a payment. Start from the course page.', btn('/explore', 'All courses'))
  if (state === 'working') return card(<Loader2 size={34} className="animate-spin" style={{ color: 'var(--xp-blue)' }} />, 'Confirming your payment…', 'This takes a few seconds. Please keep this page open.')
  if (state === 'emailed') {
    return card(<span className="flex h-14 w-14 items-center justify-center rounded-full" style={{ background: 'rgba(18,146,74,0.12)', color: 'var(--xp-up)' }}><Check size={26} /></span>,
      'You’re enrolled', <>Payment received — the course has been added to your Delta account. <span className="mt-3 flex items-center justify-center gap-2 font-semibold" style={{ color: 'var(--xp-text)' }}><Mail size={16} />Check your email for the link to open it.</span></>)
  }
  if (state === 'pending') {
    return card(<Loader2 size={34} style={{ color: 'var(--xp-muted)' }} />, 'Payment being confirmed',
      'We have not had the confirmation from the payment provider yet. If your payment went through, you will receive an email within a few minutes with your access.', btn('/explore', 'All courses'))
  }
  return card(bad, 'Something went wrong', msg || 'We could not confirm this payment.', btn(back, 'Back to checkout'))
}

export default function GuestReturnPage() {
  return (
    <main className="flex min-h-[100dvh] items-center px-4 py-16">
      <Suspense fallback={null}><ReturnInner /></Suspense>
    </main>
  )
}
