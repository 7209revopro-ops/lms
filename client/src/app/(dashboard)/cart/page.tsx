'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Link from 'next/link'
import {
  ShoppingCart, Trash2, ArrowRight, BookOpen,
  Sparkles, X, Tag, AlertCircle,
  CheckCircle2, GraduationCap,
} from 'lucide-react'
import { useCartStore, type CartItem } from '@/store/cart.store'
import { useRazorpayCheckout, useTabbyCheckout, useAbzerCheckout, useTamaraCheckout, useGatewayConfig, useValidateCoupon, useTabbyPrescore, useTamaraPrescore } from '@/lib/api/checkout'
import { TabbyCartPromo } from '@/components/payments/TabbyPromo'
import { TamaraCartWidget } from '@/components/payments/TamaraWidget'
import { TabbyLogo } from '@/components/payments/TabbyLogo'
import Spinner from '@/components/ui/Spinner'
import { useCheckoutCurrency, coursePriceIn } from '@/lib/coursePrice'
import { formatPrice } from '@/lib/formatPrice'

/* ── helpers ─────────────────────────────────────────── */
function fmt(cents: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents)
}

/* ── Coupon input ────────────────────────────────────── */
function CouponRow({
  courseId,
  onApply,
}: {
  courseId: string
  onApply: (code: string, discount: number) => void
}) {
  const [code,    setCode]    = useState('')
  const [applied, setApplied] = useState(false)
  const { data, isLoading, isError } = useValidateCoupon(code, courseId)

  const handleApply = () => {
    if (!data) return
    const savings = data.discountType === 'percent'
      ? data.discountValue   // percent value
      : data.discountValue   // fixed cents
    onApply(code, savings)
    setApplied(true)
  }

  return (
    <div className="flex items-center gap-2 mt-2">
      <div className="relative flex-1">
        <Tag size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-muted)' }} />
        <input
          value={code}
          onChange={e => { setCode(e.target.value.toUpperCase()); setApplied(false) }}
          placeholder="Coupon code"
          className="w-full rounded-xl py-1.5 pl-8 pr-3 text-xs"
          style={{ background: 'var(--color-bg-page)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }}
        />
      </div>
      <button
        onClick={handleApply}
        disabled={!data || applied || isLoading}
        className="flex items-center gap-1 rounded-xl px-3 py-1.5 text-xs font-semibold transition-all disabled:opacity-50"
        style={{ background: applied ? '#F0FDF4' : 'rgba(0,87,184,0.10)', color: applied ? '#16A34A' : '#0057b8' }}>
        {isLoading
          ? <Spinner size={10} />
          : applied
            ? <><CheckCircle2 size={10} />Applied</>
            : 'Apply'}
      </button>
      {isError && code.length >= 2 && (
        <span className="text-[10px]" style={{ color: 'var(--color-danger)' }}>Invalid</span>
      )}
      {data && !applied && (
        <span className="text-[10px] font-semibold" style={{ color: 'var(--color-success)' }}>
          {data.discountType === 'percent' ? `${data.discountValue}% off` : `$${data.discountValue / 100} off`}
        </span>
      )}
    </div>
  )
}

/* ── Single cart item card ───────────────────────────── */
function CartItemCard({ item, onRemove }: { item: CartItem; onRemove: () => void }) {
  const checkout        = useRazorpayCheckout()
  const [tabbyError, setTabbyError] = useState<string | null>(null)
  const tabbyCheckout   = useTabbyCheckout({ onError: msg => setTabbyError(msg) })
  const abzerCheckout   = useAbzerCheckout()
  const tamaraCheckout  = useTamaraCheckout()
  const { data: gatewayConfig } = useGatewayConfig()
  const isUAE           = gatewayConfig?.currency === 'AED'
  const gateways        = gatewayConfig?.gateways ?? []
  const itemCurrency    = useCheckoutCurrency()
  const isFree          = item.isFree || !item.price || item.price === 0

  /* Tabby background pre-scoring. QA requires it to run before the option is
     offered, and requires us to add no availability rules of our own on top —
     whether Tabby can be used is Tabby's answer, not ours. It also hands back
     the AED figure Tabby will charge, which is what the snippet must quote. */
  const tabbyOffered    = isUAE && gateways.includes('tabby') && !isFree
  const { data: tabbyScore } = useTabbyPrescore(item.id, tabbyOffered)
  const tabbyRejected   = tabbyScore?.available === false && !!tabbyScore?.message
  const tabbyAmount     = tabbyScore?.amount ?? 0

  /* Same gate for Tamara — eligibility decides whether the option is offered
     at all, and the AED figure comes back with it so the widget quotes the
     number the student will actually be charged. */
  const tamaraOffered   = isUAE && gateways.includes('tamara') && !isFree
  const { data: tamaraScore } = useTamaraPrescore(item.id, tamaraOffered)
  const tamaraRejected  = tamaraScore?.available === false
  const tamaraAmount    = tamaraScore?.amount ?? 0
  const [coupon,  setCoupon]  = useState<string | undefined>(undefined)
  const [buying,  setBuying]  = useState(false)

  const handleBuy = async () => {
    if (isFree) return
    setBuying(true)
    if (isUAE) {
      abzerCheckout.mutate({ courseId: item.id, slug: item.slug, couponCode: coupon })
      return
    }
    try {
      await checkout.mutateAsync({ courseId: item.id, couponCode: coupon })
    } catch {
      setBuying(false)
    }
  }

  const handleAbzerBuy = () => {
    if (isFree) return
    abzerCheckout.mutate({ courseId: item.id, slug: item.slug, couponCode: coupon })
  }

  const handleTamaraBuy = () => {
    if (isFree) return
    tamaraCheckout.mutate({ courseId: item.id, slug: item.slug, couponCode: coupon })
  }

  const handleTabbyBuy = () => {
    if (isFree) return
    tabbyCheckout.mutate({ courseId: item.id, slug: item.slug, couponCode: coupon })
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -20, scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 300, damping: 28 }}
      className="rounded-2xl bg-[var(--color-bg-surface)] p-4"
      style={{ border: '1px solid var(--color-border)', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>

      <div className="flex gap-3">
        {/* Thumbnail */}
        <Link href={`/courses/${item.slug}`} className="flex-shrink-0">
          <div className="h-16 w-24 overflow-hidden rounded-xl"
            style={{ background: 'var(--color-bg-subtle)' }}>
            {item.thumbnailUrl
              ? <img src={item.thumbnailUrl} alt={item.title} className="h-full w-full object-cover" />
              : <div className="flex h-full w-full items-center justify-center">
                  <BookOpen size={20} style={{ color: 'var(--color-text-muted)' }} />
                </div>}
          </div>
        </Link>

        {/* Info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <Link href={`/courses/${item.slug}`}>
                <h3 className="line-clamp-2 text-sm font-bold leading-snug hover:text-[#0057b8] transition-colors"
                  style={{ color: 'var(--color-text-primary)' }}>
                  {item.title}
                </h3>
              </Link>
              {item.instructorName && (
                <p className="mt-0.5 text-xs" style={{ color: 'var(--color-text-muted)' }}>{item.instructorName}</p>
              )}
            </div>
            <button onClick={onRemove} aria-label="Remove from cart"
              className="flex-shrink-0 flex h-7 w-7 items-center justify-center rounded-xl transition-colors hover:bg-[var(--color-hover-danger)]"
              style={{ color: 'var(--color-text-muted)' }}>
              <X size={13} />
            </button>
          </div>

          {/* Price + action */}
          <div className="mt-2.5 flex items-center justify-between gap-2 flex-wrap">
            <div>
              {isFree ? (
                <span className="text-base font-bold" style={{ color: 'var(--color-success)' }}>Free</span>
              ) : (
                <span className="text-base font-bold" style={{ color: 'var(--color-text-primary)' }}>
                  {(() => { const p = coursePriceIn(item, itemCurrency); return formatPrice(p.amount, p.currency) })()}
                </span>
              )}
            </div>

            {isFree ? (
              <Link href={`/courses/${item.slug}`}>
                <motion.button
                  whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                  className="flex items-center gap-1.5 rounded-xl px-4 py-1.5 text-xs font-bold text-white"
                  style={{ background: 'var(--color-success)' }}>
                  <GraduationCap size={11} />Enroll Free
                </motion.button>
              </Link>
            ) : (
              <div className="flex flex-col gap-1">
                <motion.button
                  whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                  onClick={handleBuy}
                  disabled={buying || checkout.isPending || abzerCheckout.isPending}
                  className="flex items-center gap-1.5 rounded-xl px-4 py-1.5 text-xs font-bold text-white disabled:opacity-60 transition-all"
                  style={{ background: 'var(--color-primary)', boxShadow: '0 2px 8px rgba(0,87,184,0.25)' }}>
                  {buying || checkout.isPending || abzerCheckout.isPending
                    ? <><Spinner size={11} />Processing…</>
                    : isUAE
                      ? <><ArrowRight size={11} />Pay · Abzer</>
                      : <><ArrowRight size={11} />Checkout</>}
                </motion.button>
                {tamaraOffered && !tamaraRejected && (
                  <button
                    onClick={handleTamaraBuy}
                    disabled={tamaraCheckout.isPending}
                    className="flex items-center gap-1.5 rounded-xl px-4 py-1.5 text-xs font-bold transition-all disabled:opacity-60"
                    style={{ border: '1.5px solid #1EB59A', color: '#1EB59A' }}>
                    {tamaraCheckout.isPending
                      ? <><Spinner size={11} />Processing…</>
                      : <><ArrowRight size={11} />Pay in 3 · Tamara</>}
                  </button>
                )}
                {tabbyOffered && !tabbyRejected && (
                  <button
                    onClick={handleTabbyBuy}
                    disabled={tabbyCheckout.isPending}
                    className="flex items-center gap-1.5 rounded-xl px-4 py-1.5 text-xs font-bold transition-all disabled:opacity-60"
                    style={{ border: '1.5px solid #3D1D8E', color: '#3D1D8E' }}>
                    {tabbyCheckout.isPending
                      ? <><Spinner size={11} />Processing…</>
                      : <>Pay in 4 with <TabbyLogo height={13} /></>}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Tabby on-site messaging. QA: the cart snippet must show for ALL
          amounts with no limits of our own, and must track the amount as the
          basket changes — TabbyCartPromo re-initialises whenever `price` moves.
          The figure comes from pre-scoring rather than the cart, so it always
          matches what Tabby's own checkout will quote. */}
      {tabbyOffered && tabbyAmount > 0 && (
        <div className="mt-2">
          <TabbyCartPromo price={tabbyAmount} currency={tabbyScore?.currency ?? 'AED'} />
        </div>
      )}

      {tamaraOffered && !tamaraRejected && tamaraAmount > 0 && (
        <div className="mt-2">
          <TamaraCartWidget price={tamaraAmount} />
        </div>
      )}

      {tamaraRejected && tamaraScore?.message && (
        <p className="mt-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>
          {tamaraScore.message}
        </p>
      )}

      {/* A Tabby decline is a business outcome, not an error — Tabby supplies
          the exact wording and QA checks it is shown rather than swallowed. */}
      {tabbyRejected && (
        <p className="mt-2 flex items-start gap-1.5 text-xs" style={{ color: 'var(--color-text-muted)' }}>
          <TabbyLogo height={12} className="mt-px flex-shrink-0" />
          <span>{tabbyScore?.message}</span>
        </p>
      )}

      {tabbyError && (
        <p className="mt-2 flex items-start gap-1.5 text-xs" style={{ color: 'var(--color-text-muted)' }}>
          <TabbyLogo height={12} className="mt-px flex-shrink-0" />
          <span>{tabbyError}</span>
        </p>
      )}

      {/* Coupon row — only for paid courses */}
      {!isFree && (
        <CouponRow
          courseId={item.id}
          onApply={(code) => setCoupon(code)}
        />
      )}

      {checkout.isError && (
        <p className="mt-2 flex items-center gap-1 text-xs" style={{ color: 'var(--color-danger)' }}>
          <AlertCircle size={10} />
          {(checkout.error as any)?.message ?? 'Checkout failed. Please try again.'}
        </p>
      )}
    </motion.div>
  )
}

/* ── Page ────────────────────────────────────────────── */
export default function CartPage() {
  const items     = useCartStore(s => s.items)
  const removeItem = useCartStore(s => s.removeItem)
  const clearCart = useCartStore(s => s.clearCart)

  const paidItems = items.filter(i => !i.isFree && i.price && i.price > 0)
  const freeItems = items.filter(i => i.isFree || !i.price || i.price === 0)

  /* Sum in the student's checkout currency. Items saved before the
     per-currency fields existed resolve to their USD price — if any such
     item is mixed in, fall back to a plain USD total rather than adding
     apples to oranges. */
  const currency   = useCheckoutCurrency()
  const parts      = paidItems.map(i => coursePriceIn(i, currency))
  const uniform    = parts.every(p => p.currency === currency)
  const totalCurrency = uniform ? currency : 'USD'
  const total      = uniform
    ? parts.reduce((sum, p) => sum + p.amount, 0)
    : paidItems.reduce((sum, i) => sum + (i.price ?? 0), 0)

  return (
    <div className="mx-auto max-w-2xl">
      {/* ── Header ──────────────────────── */}
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
        className="mb-6 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <ShoppingCart size={14} style={{ color: 'var(--color-primary)' }} />
            <span className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'var(--color-primary)' }}>
              Cart
            </span>
          </div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text-primary)', fontFamily: 'Bricolage Grotesque, sans-serif' }}>
            Your Cart
            {items.length > 0 && (
              <span className="ml-2 inline-flex items-center justify-center rounded-lg px-2 py-0.5 text-sm font-bold"
                style={{ background: 'var(--color-bg-subtle)', color: 'var(--color-text-secondary)' }}>
                {items.length}
              </span>
            )}
          </h1>
        </div>

        {items.length > 0 && (
          <button onClick={clearCart}
            className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-[var(--color-hover-danger)]"
            style={{ color: 'var(--color-danger)', border: '1px solid rgba(239,68,68,0.18)' }}>
            <Trash2 size={11} />Clear all
          </button>
        )}
      </motion.div>

      {/* ── Empty state ─────────────────── */}
      {items.length === 0 && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          className="flex flex-col items-center gap-4 py-20">
          <div className="flex h-20 w-20 items-center justify-center rounded-3xl"
            style={{ background: 'var(--color-bg-subtle)', border: '1px solid var(--color-border)' }}>
            <ShoppingCart size={32} style={{ color: 'var(--color-text-muted)' }} />
          </div>
          <div className="text-center">
            <p className="text-base font-bold" style={{ color: 'var(--color-text-primary)' }}>Your cart is empty</p>
            <p className="mt-1 text-sm" style={{ color: 'var(--color-text-muted)' }}>Browse the catalog to find courses you love</p>
          </div>
          <Link href="/courses">
            <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
              className="flex items-center gap-2 rounded-2xl px-6 py-2.5 text-sm font-bold text-white"
              style={{ background: 'var(--color-primary)', boxShadow: '0 4px 14px rgba(0,87,184,0.30)' }}>
              <Sparkles size={14} />Browse Catalog
            </motion.button>
          </Link>
        </motion.div>
      )}

      {/* ── Cart items ──────────────────── */}
      {items.length > 0 && (
        <div className="space-y-3">
          <AnimatePresence mode="popLayout">
            {items.map(item => (
              <CartItemCard
                key={item.id}
                item={item}
                onRemove={() => removeItem(item.id)}
              />
            ))}
          </AnimatePresence>

          {/* ── Order summary ─────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
            className="mt-4 rounded-2xl p-5"
            style={{ background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
            <h2 className="mb-3 text-sm font-bold" style={{ color: 'var(--color-text-primary)' }}>Order Summary</h2>

            <div className="space-y-2 text-sm">
              {paidItems.length > 0 && (
                <div className="flex justify-between" style={{ color: 'var(--color-text-muted)' }}>
                  <span>{paidItems.length} paid course{paidItems.length !== 1 ? 's' : ''}</span>
                  <span className="font-semibold" style={{ color: 'var(--color-text-primary)' }}>{formatPrice(total, totalCurrency)}</span>
                </div>
              )}
              {freeItems.length > 0 && (
                <div className="flex justify-between" style={{ color: 'var(--color-text-muted)' }}>
                  <span>{freeItems.length} free course{freeItems.length !== 1 ? 's' : ''}</span>
                  <span className="font-semibold" style={{ color: 'var(--color-success)' }}>Free</span>
                </div>
              )}
            </div>

            {paidItems.length > 0 && (
              <div className="mt-3 flex items-center justify-between pt-3"
                style={{ borderTop: '1px solid var(--color-border)' }}>
                <span className="text-sm font-bold" style={{ color: 'var(--color-text-primary)' }}>Total</span>
                <span className="text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>{formatPrice(total, totalCurrency)}</span>
              </div>
            )}

            <p className="mt-3 text-[11px] text-center" style={{ color: 'var(--color-text-muted)' }}>
              Each course has its own checkout. Click <strong>Checkout</strong> on individual paid courses above.
            </p>

            <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--color-border)' }}>
              <Link href="/courses" className="flex items-center justify-center gap-1.5 text-xs font-semibold transition-colors hover:opacity-70"
                style={{ color: 'var(--color-primary)' }}>
                <Sparkles size={11} />Continue shopping
              </Link>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  )
}
