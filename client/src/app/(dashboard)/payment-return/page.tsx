'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import Link from 'next/link'
import {
  CheckCircle2, XCircle, AlertCircle,
  ArrowRight, BookOpen, RotateCcw,
} from 'lucide-react'
import Spinner from '@/components/ui/Spinner'
import { useVerifyAbzerReturn } from '@/lib/api/user'
import { useVerifyTamaraReturn, useVerifyTabbyReturn } from '@/lib/api/checkout'
import { useCartStore } from '@/store/cart.store'

/* ── helpers ─────────────────────────────────────────── */
function fmt(amount: string | null, currency: string | null) {
  if (!amount || !currency) return null
  return new Intl.NumberFormat('en-AE', { style: 'currency', currency: currency ?? 'AED' }).format(parseFloat(amount))
}

/* ── inner component (needs Suspense for useSearchParams) ── */
function ReturnContent() {
  const params      = useSearchParams()
  const router      = useRouter()
  const gateway     = params.get('gateway')          // 'tabby' | 'tamara' | null (null = abzer)
  const status      = params.get('status')
  const amount      = params.get('amount')
  const currency    = params.get('currencyCode')
  const orderId     = params.get('orderId')
  const txId        = params.get('transactionId')
  const docRef      = params.get('docRefNumber')

  /* Tabby appends payment_id to the redirect URL as a query param */
  const tabbyPaymentId = params.get('payment_id')

  const isAbzer  = !gateway || gateway === 'abzer'
  const isTamara = gateway === 'tamara'
  const isTabby  = gateway === 'tabby'

  /* Abzer uses a specific success status string.
     Tamara and Tabby redirect with no status param on success (orderId present). */
  const isSuccess =
    isAbzer  ? status === 'PAYMENT_GATEWAY_SUCCESS' :
    isTamara ? (status === null || status === 'approved') && !!orderId :
    isTabby  ? !status && !!orderId :
    false

  const isCancelled =
    isAbzer  ? status === 'PAYMENT_GATEWAY_CANCEL' :
    isTamara ? status === 'cancelled' :
    isTabby  ? status === 'cancelled' :
    false

  const abzerVerify  = useVerifyAbzerReturn()
  const tamaraVerify = useVerifyTamaraReturn()
  const tabbyVerify  = useVerifyTabbyReturn()
  const calledRef    = useRef(false)
  const clearCart    = useCartStore(st => st.clearCart)
  /* Tabby redirected to the success URL but the payment has not settled —
     shown instead of a thank-you the student has not earned. */
  const [unsettled, setUnsettled] = useState(false)

  const verifyReturn = isAbzer ? abzerVerify : isTamara ? tamaraVerify : tabbyVerify
  const isVerifyPending = verifyReturn.isPending

  /* On success, call gateway-specific verify-return to fulfill the order (webhook fallback)
     and find out if the user is an express account that needs to register. */
  useEffect(() => {
    if (!isSuccess || calledRef.current) return
    if (isAbzer && !docRef) return
    if (isTamara && !orderId) return
    if (isTabby && !orderId) return
    calledRef.current = true

    const handleResult = (data: { needsRegistration: boolean; paid?: boolean } | undefined) => {
      /* Only a CONFIRMED payment empties the basket. A 200 from verify-return
         means the request was understood, not that the order settled — Tabby
         can refuse an unauthorised payment, and the gateway can be unreachable.
         `paid === false` means the student still owes for this course, so the
         cart has to survive. Gateways without the flag keep the old behaviour.

         Tabby's QA checks both halves: "Cart preserved after
         cancellation/failure; cleared after successful payment". */
      if (data?.paid !== false) clearCart()
      if (data?.paid === false) setUnsettled(true)
      if (data?.needsRegistration) {
        router.replace('/complete-registration?from=payment')
      }
    }

    if (isAbzer) {
      abzerVerify.mutate(
        { orderId: docRef!, transactionId: txId ?? undefined },
        { onSuccess: handleResult },
      )
    } else if (isTamara) {
      tamaraVerify.mutate(
        { orderId: orderId! },
        { onSuccess: handleResult },
      )
    } else if (isTabby) {
      tabbyVerify.mutate(
        { orderId: orderId!, paymentId: tabbyPaymentId ?? undefined },
        { onSuccess: handleResult },
      )
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuccess, docRef, orderId])

  /* ── Success ──────────────────────────────────────── */
  if (isSuccess) {
    /* Show spinner while verify-return is in flight */
    if (isVerifyPending) {
      return (
        <div className="flex flex-col items-center gap-4">
          <Spinner size={32} />
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Confirming your payment…</p>
        </div>
      )
    }

    /* Tabby sent us to the success URL, but the backend could not confirm the
       order settled. Saying "thank you, you're enrolled" here would be a lie,
       and the cart has deliberately been left intact so the student can retry. */
    if (unsettled) {
      return (
        <div className="flex flex-col items-center text-center gap-6 max-w-md mx-auto">
          <div className="w-24 h-24 rounded-full flex items-center justify-center"
            style={{ background: 'var(--color-primary-light)', border: '2px solid #FCD34D' }}>
            <AlertCircle size={44} style={{ color: '#D97706' }} strokeWidth={1.8} />
          </div>
          <div>
            <h1 className="text-2xl font-bold mb-2" style={{ color: 'var(--color-text-primary)', fontFamily: 'Bricolage Grotesque, sans-serif' }}>
              Payment Not Confirmed
            </h1>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
              We could not confirm this payment with the provider, so you have not been charged for
              this course and it is still in your cart. If your provider tells you the payment did
              go through, contact support and we will sort it out — do not pay twice.
            </p>
          </div>
          <div className="flex flex-col gap-3 w-full">
            <Link href="/cart"
              className="flex items-center justify-center gap-2 rounded-2xl py-3 text-sm font-semibold text-white"
              style={{ background: 'var(--color-primary)' }}>
              <RotateCcw size={16} />Back to cart
            </Link>
            <Link href="/support"
              className="flex items-center justify-center gap-2 rounded-2xl py-3 text-sm font-semibold"
              style={{ border: '1.5px solid var(--color-border)', color: 'var(--color-text-primary)' }}>
              Contact support
            </Link>
          </div>
        </div>
      )
    }

    /* A 4xx means the request itself was wrong — the order is not yours, or
       does not exist. Telling that student "your payment was received" is both
       false and alarming; it invites a support ticket about money that was
       never taken from them. Only a server-side or network failure leaves the
       genuine "paid, enrolment catching up" ambiguity worth reassuring about. */
    const verifyStatus = (verifyReturn.error as { response?: { status?: number } } | null)?.response?.status
    if (verifyReturn.isError && typeof verifyStatus === 'number' && verifyStatus >= 400 && verifyStatus < 500) {
      return (
        <div className="flex flex-col items-center text-center gap-6 max-w-md mx-auto">
          <div className="w-24 h-24 rounded-full flex items-center justify-center"
            style={{ background: 'var(--color-primary-light)', border: '2px solid #FCD34D' }}>
            <AlertCircle size={44} style={{ color: '#D97706' }} strokeWidth={1.8} />
          </div>
          <div>
            <h1 className="text-2xl font-bold mb-2" style={{ color: 'var(--color-text-primary)', fontFamily: 'Bricolage Grotesque, sans-serif' }}>
              We Could Not Check This Order
            </h1>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
              This order could not be found on your account, so we cannot confirm a payment for it.
              If you believe you were charged, contact support with the time of the attempt and we
              will trace it.
            </p>
          </div>
          <div className="flex flex-col gap-3 w-full">
            <Link href="/cart"
              className="flex items-center justify-center gap-2 rounded-2xl py-3 text-sm font-semibold text-white"
              style={{ background: 'var(--color-primary)' }}>
              <RotateCcw size={16} />Back to cart
            </Link>
            <Link href="/support"
              className="flex items-center justify-center gap-2 rounded-2xl py-3 text-sm font-semibold"
              style={{ border: '1.5px solid var(--color-border)', color: 'var(--color-text-primary)' }}>
              Contact support
            </Link>
          </div>
        </div>
      )
    }

    /* Server-side or network failure: the payment may well have gone through. */
    if (verifyReturn.isError) {
      return (
        <div className="flex flex-col items-center text-center gap-6 max-w-md mx-auto">
          <div className="w-24 h-24 rounded-full flex items-center justify-center"
            style={{ background: 'var(--color-primary-light)', border: '2px solid #FCD34D' }}>
            <AlertCircle size={44} style={{ color: '#D97706' }} strokeWidth={1.8} />
          </div>
          <div>
            <h1 className="text-2xl font-bold mb-2" style={{ color: 'var(--color-text-primary)', fontFamily: 'Bricolage Grotesque, sans-serif' }}>
              Payment Received
            </h1>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
              Your payment was received. Your enrollment is being confirmed — this usually takes just a moment.
              Check My Learning shortly or contact support if the course doesn't appear.
            </p>
          </div>
          <div className="flex flex-col gap-3 w-full">
            <Link href="/my-learning">
              <motion.button
                whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                className="w-full flex items-center justify-center gap-2 rounded-2xl px-6 py-3 text-sm font-bold text-white"
                style={{ background: 'var(--color-primary)', boxShadow: '0 4px 16px rgba(0,87,184,0.30)' }}>
                <BookOpen size={15} />Go to My Learning
                <ArrowRight size={14} />
              </motion.button>
            </Link>
          </div>
        </div>
      )
    }

    return (
      <div className="flex flex-col items-center text-center gap-6 max-w-md mx-auto">
        <motion.div
          initial={{ scale: 0, rotate: -20 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 220, damping: 14 }}
          className="w-24 h-24 rounded-full flex items-center justify-center"
          style={{ background: 'linear-gradient(135deg,#F0FDF4,#DCFCE7)', border: '2px solid #86EFAC' }}>
          <CheckCircle2 size={44} style={{ color: 'var(--color-success)' }} strokeWidth={1.8} />
        </motion.div>

        <div>
          <h1 className="text-2xl font-bold mb-2" style={{ color: 'var(--color-text-primary)', fontFamily: 'Bricolage Grotesque, sans-serif' }}>
            Payment Successful!
          </h1>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
            Your payment has been received and your course enrollment is ready.
          </p>
        </div>

        {/* Receipt card */}
        {(amount || orderId || txId) && (
          <motion.div
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
            className="w-full rounded-2xl p-5 text-left space-y-2.5"
            style={{ background: 'var(--color-bg-subtle)', border: '1px solid var(--color-border)' }}>
            {amount && currency && (
              <div className="flex justify-between text-sm">
                <span style={{ color: 'var(--color-text-muted)' }}>Amount paid</span>
                <span className="font-bold" style={{ color: 'var(--color-text-primary)' }}>{fmt(amount, currency)}</span>
              </div>
            )}
            {orderId && (
              <div className="flex justify-between text-sm">
                <span style={{ color: 'var(--color-text-muted)' }}>Order ID</span>
                <span className="font-mono text-xs" style={{ color: 'var(--color-text-secondary)' }}>{orderId}</span>
              </div>
            )}
            {txId && (
              <div className="flex justify-between text-sm">
                <span style={{ color: 'var(--color-text-muted)' }}>Transaction ID</span>
                <span className="font-mono text-xs truncate max-w-[180px]" style={{ color: 'var(--color-text-secondary)' }}>{txId}</span>
              </div>
            )}
            {docRef && (
              <div className="flex justify-between text-sm">
                <span style={{ color: 'var(--color-text-muted)' }}>Reference</span>
                <span className="font-mono text-xs" style={{ color: 'var(--color-text-secondary)' }}>{docRef}</span>
              </div>
            )}
          </motion.div>
        )}

        <motion.div
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}
          className="flex flex-col gap-3 w-full">
          <Link href="/my-learning">
            <motion.button
              whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
              className="w-full flex items-center justify-center gap-2 rounded-2xl px-6 py-3 text-sm font-bold text-white"
              style={{ background: 'var(--color-primary)', boxShadow: '0 4px 16px rgba(0,87,184,0.30)' }}>
              <BookOpen size={15} />Go to My Learning
              <ArrowRight size={14} />
            </motion.button>
          </Link>
          <Link href="/courses">
            <button className="w-full text-sm font-semibold py-2 rounded-2xl transition-colors hover:bg-[var(--color-bg-muted)]"
              style={{ color: 'var(--color-text-muted)' }}>
              Browse more courses
            </button>
          </Link>
        </motion.div>

        <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          A confirmation email will be sent to your registered address.
        </p>
      </div>
    )
  }

  /* ── Cancelled ────────────────────────────────────── */
  if (isCancelled) {
    return (
      <div className="flex flex-col items-center text-center gap-6 max-w-md mx-auto">
        <motion.div
          initial={{ scale: 0 }} animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 220, damping: 14 }}
          className="w-24 h-24 rounded-full flex items-center justify-center"
          style={{ background: 'var(--color-primary-light)', border: '2px solid #FCD34D' }}>
          <AlertCircle size={44} style={{ color: '#D97706' }} strokeWidth={1.8} />
        </motion.div>

        <div>
          <h1 className="text-2xl font-bold mb-2" style={{ color: 'var(--color-text-primary)', fontFamily: 'Bricolage Grotesque, sans-serif' }}>
            Payment Cancelled
          </h1>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
            You cancelled the payment. No charge was made. You can try again whenever you're ready.
          </p>
        </div>

        <div className="flex flex-col gap-3 w-full">
          <Link href="/courses">
            <motion.button
              whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
              className="w-full flex items-center justify-center gap-2 rounded-2xl px-6 py-3 text-sm font-bold text-white"
              style={{ background: 'var(--color-primary)', boxShadow: '0 4px 16px rgba(0,87,184,0.30)' }}>
              <RotateCcw size={14} />Back to Courses
            </motion.button>
          </Link>
        </div>
      </div>
    )
  }

  /* ── Failure ──────────────────────────────────────── */
  return (
    <div className="flex flex-col items-center text-center gap-6 max-w-md mx-auto">
      <motion.div
        initial={{ scale: 0 }} animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 220, damping: 14 }}
        className="w-24 h-24 rounded-full flex items-center justify-center"
        style={{ background: '#FEF2F2', border: '2px solid #FECACA' }}>
        <XCircle size={44} style={{ color: 'var(--color-danger)' }} strokeWidth={1.8} />
      </motion.div>

      <div>
        <h1 className="text-2xl font-bold mb-2" style={{ color: 'var(--color-text-primary)', fontFamily: 'Bricolage Grotesque, sans-serif' }}>
          Payment Failed
        </h1>
        <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
          Your payment could not be processed. No charge was made.
          Please check your card details and try again.
        </p>
      </div>

      {orderId && (
        <div className="w-full rounded-xl p-4 text-left text-sm"
          style={{ background: '#FEF2F2', border: '1px solid #FECACA' }}>
          <span style={{ color: 'var(--color-danger)' }}>Reference: </span>
          <span className="font-mono text-xs" style={{ color: '#7F1D1D' }}>{orderId}</span>
        </div>
      )}

      <div className="flex flex-col gap-3 w-full">
        <Link href="/courses">
          <motion.button
            whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
            className="w-full flex items-center justify-center gap-2 rounded-2xl px-6 py-3 text-sm font-bold text-white"
            style={{ background: 'var(--color-primary)', boxShadow: '0 4px 16px rgba(0,87,184,0.30)' }}>
            <RotateCcw size={14} />Try Again
          </motion.button>
        </Link>
        <Link href="/my-learning">
          <button className="w-full text-sm font-semibold py-2 rounded-2xl transition-colors hover:bg-[var(--color-bg-muted)]"
            style={{ color: 'var(--color-text-muted)' }}>
            Go to My Learning
          </button>
        </Link>
      </div>

      <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
        If the issue persists, please contact support.
      </p>
    </div>
  )
}

/* ── Page wrapper ─────────────────────────────────── */
export default function PaymentReturnPage() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4 py-12">
      <Suspense fallback={
        <div className="flex flex-col items-center gap-4">
          <Spinner size={32} />
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Loading payment status…</p>
        </div>
      }>
        <ReturnContent />
      </Suspense>
    </div>
  )
}
