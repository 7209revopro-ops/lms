'use client'
/* ─────────────────────────────────────────────────────────────
   Buying on /explore with no account (2026-10-18) — POST /public/checkout/*.
     1. details — name, email, country, phone → the methods for that country
        (Tabby / Tamara already pre-scored; a decline shows their own words)
     2. method  — Card (Abzer/BillXPro), Tabby, Tamara (UAE) or Razorpay
        (India) → the gateway; Razorpay opens over the page
     3. back    — /explore/checkout/return finishes it (redirect gateways);
        Razorpay finishes here. A new account is signed in straight into the
        course; an existing one is emailed a sign-in link.
   The checkout is carried by an httpOnly cookie the API sets — nothing here
   stores who the buyer is.
───────────────────────────────────────────────────────────── */
import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowLeft, Check, CreditCard, Loader2, Lock, Mail, X } from 'lucide-react'
import { api } from '@/lib/axios'
import { loadRazorpayScript } from '@/lib/api/checkout'
import { COUNTRIES } from '@/lib/countries'
import { formatPrice } from '@/lib/formatPrice'
import { TabbyCheckoutCard } from '@/components/payments/TabbyPromo'
import { TamaraCheckoutWidget } from '@/components/payments/TamaraWidget'
import type { Academy } from '@/components/explore/ExploreKit'

type MethodId = 'card' | 'tabby' | 'tamara' | 'razorpay'
interface Prepared {
  course: { title: string; slug: string }
  amount: number; currency: 'AED' | 'INR'
  methods: Array<{ id: MethodId; available: boolean; message?: string | null }>
}
export interface CompleteResult { paid: boolean; signIn?: string | null; emailed?: boolean; /** Card (Abzer): the gateway says this attempt failed. */ failed?: boolean }

const errText = (e: unknown, fallback: string) =>
  (e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? fallback

const METHOD: Record<MethodId, { title: string; sub: string }> = {
  card:     { title: 'Credit or debit card', sub: 'Visa, Mastercard and more — paid in full' },
  tabby:    { title: 'Pay in 4 with Tabby', sub: 'Split into 4 interest-free payments' },
  tamara:   { title: 'Tamara',              sub: 'Monthly payments. No late fees.' },
  razorpay: { title: 'UPI, cards & net banking', sub: 'Secure checkout by Razorpay' },
}

/** Remembered for the return page's "back to checkout" — only the course, never the buyer. */
export const RETURN_KEY = 'explore-checkout-course'

export function GuestCheckout({ open, onClose, slug, academy }: { open: boolean; onClose: () => void; slug: string; academy: Academy }) {
  const [step, setStep] = useState<'details' | 'method' | 'emailed'>('details')
  const [f, setF] = useState({ name: '', email: '', country: academy === 'bangalore' ? 'India' : 'United Arab Emirates', phone: '' })
  const [prep, setPrep] = useState<Prepared | null>(null)
  const [method, setMethod] = useState<MethodId | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const dial = useMemo(() => COUNTRIES.find(c => c.name === f.country)?.dial ?? '', [f.country])

  /* Escape closes; the page behind does not scroll while it is open. */
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [open, busy, onClose])

  const fullPhone = () => {
    const raw = f.phone.trim()
    if (raw.startsWith('+')) return raw
    return `${dial} ${raw.replace(/^0+/, '')}`.trim()
  }

  const prepare = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr(''); setBusy(true)
    try {
      const r = await api.post<{ data: Prepared }>('/public/checkout/prepare', { slug, name: f.name, email: f.email, country: f.country, phone: fullPhone() })
      setPrep(r.data.data)
      setMethod(r.data.data.methods.find(m => m.available)?.id ?? null)
      setStep('method')
    } catch (e2) { setErr(errText(e2, 'Something went wrong — please try again.')) }
    finally { setBusy(false) }
  }

  const finish = (res: CompleteResult) => {
    if (res.signIn) { window.location.assign(res.signIn); return }
    if (res.paid) setStep('emailed')
    else setErr('We could not confirm the payment yet. If money was taken, you will receive an email shortly.')
  }

  const pay = async () => {
    if (!method || !prep) return
    setErr(''); setBusy(true)
    try { sessionStorage.setItem(RETURN_KEY, prep.course.slug) } catch { /* private mode */ }
    try {
      /* Longer than the usual 15 s: the server may ask a busy gateway again before giving up (Card: up to ~22 s). */
      const r = await api.post<{ data: { kind: 'redirect'; url: string } | { kind: 'razorpay'; razorpay: any } }>('/public/checkout/pay', { method }, { timeout: 35_000 })
      const d = r.data.data
      if (d.kind === 'redirect') { window.location.assign(d.url); return }
      /* Razorpay opens over the page; its success is verified by our server, then the checkout is finished. */
      await loadRazorpayScript()
      const o = d.razorpay
      await new Promise<void>((resolve) => {
        const rzp = new (window as any).Razorpay({
          key: o.key, amount: o.amount, currency: o.currency, order_id: o.razorpayOrderId,
          name: 'Delta Institutions', description: o.courseName,
          prefill: { name: f.name, email: f.email, contact: fullPhone() },
          theme: { color: '#0057b8' },
          handler: async (resp: any) => {
            try {
              const c = await api.post<{ data: CompleteResult }>('/public/checkout/complete', {
                gateway: 'razorpay', razorpayOrderId: resp.razorpay_order_id,
                razorpayPaymentId: resp.razorpay_payment_id, razorpaySignature: resp.razorpay_signature,
              })
              finish(c.data.data)
            } catch (e3) { setErr(errText(e3, 'Payment received but not confirmed yet — please contact support with your email.')) }
            resolve()
          },
          modal: { ondismiss: () => resolve() },
        })
        rzp.on('payment.failed', (resp: any) => { setErr(resp?.error?.description ?? 'The payment did not go through. Please try again.'); resolve() })
        rzp.open()
      })
    } catch (e2) { setErr(errText(e2, 'We could not start the payment — please try again.')) }
    finally { setBusy(false) }
  }

  const field = 'w-full rounded-xl border px-3.5 py-3 text-[15px] outline-none transition-colors focus:border-[var(--xp-blue)]'
  const fieldStyle: React.CSSProperties = { borderColor: 'var(--xp-line-2)', background: '#fff', color: 'var(--xp-text)', colorScheme: 'light' }

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="absolute inset-0" style={{ background: 'rgba(11,22,48,0.45)', backdropFilter: 'blur(3px)' }} onClick={() => !busy && onClose()} />
          <motion.div role="dialog" aria-modal="true" aria-label="Checkout"
            initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }} transition={{ type: 'spring', stiffness: 380, damping: 34 }}
            className="relative max-h-[92dvh] w-full max-w-[480px] overflow-y-auto rounded-t-3xl p-6 sm:rounded-3xl sm:p-7"
            style={{ background: 'var(--xp-card)', boxShadow: '0 40px 90px -30px rgba(11,22,48,.55)', paddingBottom: 'calc(24px + env(safe-area-inset-bottom))' }}>
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                {step === 'method' && (
                  <button onClick={() => { setStep('details'); setErr('') }} className="mb-2 inline-flex items-center gap-1 text-xs font-semibold" style={{ color: 'var(--xp-muted)' }}>
                    <ArrowLeft size={13} />Your details
                  </button>
                )}
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em]" style={{ color: 'var(--xp-muted)' }}>
                  {step === 'details' ? 'Step 1 of 2' : step === 'method' ? 'Step 2 of 2' : 'Done'}
                </p>
                <h2 className="xp-display mt-1 text-2xl font-bold" style={{ color: 'var(--xp-text)' }}>
                  {step === 'details' ? 'Your details' : step === 'method' ? 'How would you like to pay?' : 'Check your email'}
                </h2>
              </div>
              <button onClick={() => !busy && onClose()} aria-label="Close" className="rounded-full p-2 hover:bg-black/5" style={{ color: 'var(--xp-muted)' }}><X size={18} /></button>
            </div>

            {step === 'details' && (
              <form onSubmit={prepare} className="space-y-3">
                <input required autoComplete="name" placeholder="Full name" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} className={field} style={fieldStyle} />
                <input required type="email" autoComplete="email" placeholder="Email — your account and receipt go here" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} className={field} style={fieldStyle} />
                <select value={f.country} onChange={e => setF({ ...f, country: e.target.value })} aria-label="Country" className={field} style={fieldStyle}>
                  {COUNTRIES.map(c => <option key={c.name} value={c.name}>{c.flag} {c.name}</option>)}
                </select>
                <div className="flex gap-2">
                  <span className="xp-mono flex shrink-0 items-center rounded-xl border px-3 text-sm" style={{ borderColor: 'var(--xp-line-2)', color: 'var(--xp-text-2)', background: 'var(--xp-bg)' }}>{dial || '+'}</span>
                  <input required type="tel" autoComplete="tel-national" inputMode="tel" placeholder="Mobile number" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} className={field} style={fieldStyle} />
                </div>
                {err && <p className="rounded-xl px-3.5 py-2.5 text-sm" style={{ background: '#fdecec', color: '#b42318' }}>{err}</p>}
                <button type="submit" disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-2xl px-6 py-4 font-semibold text-white disabled:opacity-60"
                  style={{ background: 'linear-gradient(135deg, #0a6be0, #0057b8)' }}>
                  {busy ? <Loader2 size={18} className="animate-spin" /> : 'Continue to payment'}
                </button>
                <p className="flex items-center justify-center gap-1.5 text-center text-xs" style={{ color: 'var(--xp-muted)' }}>
                  <Lock size={12} />Your Delta account is created with this email once you pay.
                </p>
              </form>
            )}

            {step === 'method' && prep && (
              <div className="space-y-3">
                <div className="flex items-baseline justify-between rounded-2xl px-4 py-3" style={{ background: 'var(--xp-bg)' }}>
                  <span className="min-w-0 truncate pr-3 text-sm font-medium" style={{ color: 'var(--xp-text-2)' }}>{prep.course.title}</span>
                  <span className="xp-mono shrink-0 text-lg font-semibold" style={{ color: 'var(--xp-text)' }}>{formatPrice(prep.amount, prep.currency, 'en-US')}</span>
                </div>
                {prep.methods.length === 0 && (
                  <p className="rounded-xl px-3.5 py-3 text-sm" style={{ background: 'var(--xp-bg)', color: 'var(--xp-text-2)' }}>
                    Online payment is not available for your country yet — please contact your Delta counsellor.
                  </p>
                )}
                <div role="radiogroup" className="space-y-2.5">
                  {prep.methods.map(m => {
                    const on = method === m.id
                    return (
                      <div key={m.id}>
                        <button role="radio" aria-checked={on} disabled={!m.available} onClick={() => setMethod(m.id)}
                          className="flex w-full items-center gap-3 rounded-2xl border px-4 py-3.5 text-left transition-colors disabled:cursor-not-allowed"
                          style={{ borderColor: on ? 'var(--xp-blue)' : 'var(--xp-line-2)', background: on ? 'rgba(0,87,184,0.05)' : '#fff', opacity: m.available ? 1 : 0.6 }}>
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2" style={{ borderColor: on ? 'var(--xp-blue)' : 'var(--xp-line-2)' }}>
                            {on && <span className="h-2.5 w-2.5 rounded-full" style={{ background: 'var(--xp-blue)' }} />}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block font-semibold" style={{ color: 'var(--xp-text)' }}>{METHOD[m.id].title}</span>
                            <span className="block text-xs" style={{ color: 'var(--xp-muted)' }}>{METHOD[m.id].sub}</span>
                          </span>
                          {m.id === 'card' && <CreditCard size={18} style={{ color: 'var(--xp-muted)' }} />}
                        </button>
                        {/* Tabby / Tamara's own copy when they decline — QA requires their words, not ours. */}
                        {!m.available && m.message && <p className="mt-1.5 px-1 text-xs" style={{ color: '#b42318' }}>{m.message}</p>}
                        {on && m.id === 'tabby' && <div className="mt-2"><TabbyCheckoutCard price={prep.amount} currency={prep.currency} /></div>}
                        {on && m.id === 'tamara' && <div className="mt-2"><TamaraCheckoutWidget price={prep.amount} /></div>}
                      </div>
                    )
                  })}
                </div>
                {err && <p className="rounded-xl px-3.5 py-2.5 text-sm" style={{ background: '#fdecec', color: '#b42318' }}>{err}</p>}
                <button onClick={() => void pay()} disabled={busy || !method} className="flex w-full items-center justify-center gap-2 rounded-2xl px-6 py-4 font-semibold text-white disabled:opacity-60"
                  style={{ background: 'linear-gradient(135deg, #0a6be0, #0057b8)' }}>
                  {busy ? <Loader2 size={18} className="animate-spin" /> : <>Pay {formatPrice(prep.amount, prep.currency, 'en-US')}</>}
                </button>
                <p className="flex items-center justify-center gap-1.5 text-xs" style={{ color: 'var(--xp-muted)' }}><Lock size={12} />Payments are processed securely by the provider.</p>
              </div>
            )}

            {step === 'emailed' && (
              <div className="space-y-4 text-center">
                <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full" style={{ background: 'rgba(18,146,74,0.12)', color: 'var(--xp-up)' }}><Check size={26} /></span>
                <p style={{ color: 'var(--xp-text-2)' }}>Payment received. The course has been added to your Delta account.</p>
                <p className="flex items-center justify-center gap-2 text-sm font-semibold" style={{ color: 'var(--xp-text)' }}><Mail size={16} />We&apos;ve emailed {f.email} a link to open it.</p>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
