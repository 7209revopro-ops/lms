'use client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiPost, apiGet } from '@/lib/axios'

/* ─── Razorpay types ────────────────────────────────── */

declare global {
  interface Window {
    Razorpay: new (options: RazorpayOptions) => RazorpayInstance
  }
}

interface RazorpayOptions {
  key:          string
  amount:       number
  currency:     string
  order_id:     string
  name?:        string
  description?: string
  prefill?: { name?: string; email?: string }
  theme?:  { color?: string }
  handler: (response: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) => void
  modal?: { ondismiss?: () => void }
}

interface RazorpayInstance {
  open:  () => void
  close: () => void
  on:    (event: string, handler: (response: any) => void) => void
}

function loadRazorpayScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window !== 'undefined' && window.Razorpay) { resolve(); return }
    const s = document.createElement('script')
    s.src     = 'https://checkout.razorpay.com/v1/checkout.js'
    s.onload  = () => resolve()
    s.onerror = () => reject(new Error('Failed to load Razorpay checkout script'))
    document.head.appendChild(s)
  })
}

interface RazorpayCreateOrderResult {
  razorpayOrderId: string
  amount:          number
  currency:        string
  key:             string
  courseName:      string
  userEmail:       string
  userName:        string
}

interface UseRazorpayCheckoutOptions {
  onSuccess?: () => void
  onDismiss?: () => void
  onError?:   (msg: string) => void
}

export function useRazorpayCheckout(opts: UseRazorpayCheckoutOptions = {}) {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({ courseId, couponCode }: { courseId: string; couponCode?: string }) => {
      /* 1. Create Razorpay order on backend */
      const orderData = await apiPost<RazorpayCreateOrderResult>(
        '/checkout/razorpay/create-order',
        { courseId, couponCode },
      )

      /* 2. Load Razorpay JS if not already present */
      await loadRazorpayScript()

      /* 3. Open payment modal — resolve on success, reject on failure/dismiss */
      await new Promise<void>((resolve, reject) => {
        const rzp = new window.Razorpay({
          key:         orderData.key,
          amount:      orderData.amount,
          currency:    orderData.currency,
          order_id:    orderData.razorpayOrderId,
          name:        'Delta LMS',
          description: orderData.courseName,
          prefill: {
            name:  orderData.userName,
            email: orderData.userEmail,
          },
          theme: { color: '#FF6B1A' },
          handler: async (response) => {
            try {
              /* 4. Verify signature on backend */
              await apiPost('/checkout/razorpay/verify', {
                razorpayOrderId:   response.razorpay_order_id,
                razorpayPaymentId: response.razorpay_payment_id,
                razorpaySignature: response.razorpay_signature,
              })
              resolve()
            } catch (err: any) {
              reject(new Error(err?.response?.data?.error?.message ?? 'Payment verification failed'))
            }
          },
          modal: {
            ondismiss: () => {
              opts.onDismiss?.()
              reject(new Error('DISMISSED'))
            },
          },
        })

        rzp.on('payment.failed', (resp: any) => {
          reject(new Error(resp?.error?.description ?? 'Payment failed'))
        })

        rzp.open()
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['enrollments'] })
      qc.invalidateQueries({ queryKey: ['courseProgress'] })
      opts.onSuccess?.()
    },
    onError: (err: Error) => {
      if (err.message !== 'DISMISSED') {
        opts.onError?.(err.message)
      }
    },
  })
}

/* ─── Gateway config — which gateways this user should use ── */

export interface GatewayConfig {
  gateways: ('tabby' | 'abzer' | 'tamara' | 'razorpay')[]
  currency: 'AED' | 'INR' | 'USD'
}

export function useGatewayConfig() {
  return useQuery({
    queryKey: ['checkout', 'config'],
    queryFn:  () => apiGet<GatewayConfig>('/checkout/config'),
    staleTime: 5 * 60_000,
    retry: false,
  })
}

/* ─── Tamara pre-checkout eligibility check ─────────── */
export interface TamaraEligibility {
  available:       boolean
  rejectionReason: string | null
  message:         string | null
  /** AED amount the student will actually be charged, in major units. */
  amount:          number
  currency:        string
}

export function useTamaraPrescore(courseId: string, enabled = true) {
  return useQuery({
    queryKey: ['checkout', 'tamara-prescore', courseId],
    queryFn:  () => apiPost<TamaraEligibility>('/checkout/tamara/prescore', { courseId }),
    enabled:  !!courseId && enabled,
    staleTime: 5 * 60_000,
    retry:    false,
  })
}

/* ─── Tabby background pre-scoring (eligibility check) ───────────────────────
   Tabby's QA requires this to run before the option is offered, and requires
   the decline wording to be Tabby's own — the backend resolves `message` from
   the rejection reason so the UI never invents its own copy. */
export interface TabbyEligibility {
  available:       boolean
  rejectionReason: string | null
  message:         string | null
  /** AED amount the student will actually be charged, in major units. */
  amount:          number
  currency:        string
}

export function useTabbyPrescore(courseId: string, enabled = true) {
  return useQuery({
    queryKey: ['checkout', 'tabby-prescore', courseId],
    queryFn:  () => apiPost<TabbyEligibility>('/checkout/tabby/prescore', { courseId }),
    enabled:  !!courseId && enabled,
    staleTime: 5 * 60_000,
    retry:    false,
  })
}

/* ─── Tabby checkout (UAE redirect-based) ───────────── */

interface TabbyCreateOrderResult {
  checkoutUrl: string
  checkoutId:  string
}

interface UseTabbyCheckoutOptions {
  onError?: (msg: string) => void
}

/* Tabby's hosted checkout lives on these hosts only — .ai for UAE, .sa for KSA.
   Parsed rather than prefix-matched, so `https://checkout.tabby.ai.evil.test/`
   and `https://evil.test/?x=https://checkout.tabby.ai` both fail. */
const TABBY_CHECKOUT_HOSTS = new Set(['checkout.tabby.ai', 'checkout.tabby.sa'])

export function isTabbyCheckoutUrl(raw: string): boolean {
  try {
    const u = new URL(raw)
    return u.protocol === 'https:' && TABBY_CHECKOUT_HOSTS.has(u.hostname.toLowerCase())
  } catch {
    return false
  }
}

export function useTabbyCheckout(opts: UseTabbyCheckoutOptions = {}) {
  return useMutation({
    mutationFn: async ({ courseId, slug, couponCode }: { courseId: string; slug: string; couponCode?: string }) => {
      const result = await apiPost<TabbyCreateOrderResult>(
        '/checkout/tabby/create-order',
        { courseId, slug, couponCode },
      )
      /* Redirect to Tabby's hosted checkout page.
         The URL is server-supplied, but it is still the one place this app
         navigates the browser somewhere it was told to. Pinning the
         destination to Tabby's own checkout hosts means a compromised or
         spoofed API response cannot turn the Pay button into a phishing
         redirect — the student would land on a page asking for card details
         that looks exactly like a legitimate checkout. */
      if (!isTabbyCheckoutUrl(result.checkoutUrl)) {
        throw new Error('Checkout could not be started securely. Please try another payment method.')
      }
      window.location.href = result.checkoutUrl
    },
    onError: (err: Error) => {
      opts.onError?.(err.message)
    },
  })
}

/* ─── Abzer checkout (UAE redirect-based) ───────────── */

interface AbzerCreateOrderResult {
  checkoutUrl:  string
  abzerOrderId: string
}

interface UseAbzerCheckoutOptions {
  onError?: (msg: string) => void
}

export function useAbzerCheckout(opts: UseAbzerCheckoutOptions = {}) {
  return useMutation({
    mutationFn: async ({ courseId, slug, couponCode }: { courseId: string; slug: string; couponCode?: string }) => {
      const result = await apiPost<AbzerCreateOrderResult>(
        '/checkout/abzer/create-order',
        { courseId, slug, couponCode },
      )
      window.location.href = result.checkoutUrl
    },
    onError: (err: Error) => {
      opts.onError?.(err.message)
    },
  })
}

/* ─── Tamara checkout (UAE BNPL redirect-based) ─────── */

interface TamaraCreateOrderResult {
  checkoutUrl:      string
  tamaraCheckoutId: string
}

interface UseTamaraCheckoutOptions {
  onError?: (msg: string) => void
}

/* Tamara's hosted checkout. `checkout` for production, `checkout-sandbox` for
   the test environment; parsed rather than prefix-matched so
   `https://checkout.tamara.co.evil.test/` fails. */
const TAMARA_CHECKOUT_HOSTS = new Set([
  'checkout.tamara.co', 'checkout-sandbox.tamara.co', 'checkout.tamara.sa',
])

export function isTamaraCheckoutUrl(raw: string): boolean {
  try {
    const u = new URL(raw)
    return u.protocol === 'https:' && TAMARA_CHECKOUT_HOSTS.has(u.hostname.toLowerCase())
  } catch {
    return false
  }
}

export function useTamaraCheckout(opts: UseTamaraCheckoutOptions = {}) {
  return useMutation({
    mutationFn: async ({ courseId, slug, couponCode }: { courseId: string; slug: string; couponCode?: string }) => {
      const result = await apiPost<TamaraCreateOrderResult>(
        '/checkout/tamara/create-order',
        { courseId, slug, couponCode },
      )
      /* Same reasoning as the Tabby redirect: this is the one place the app
         sends the browser somewhere it was told to, so the destination is
         pinned to Tamara's own hosts. A spoofed API response cannot turn the
         Pay button into a page that asks for card details. */
      if (!isTamaraCheckoutUrl(result.checkoutUrl)) {
        throw new Error('Checkout could not be started securely. Please try another payment method.')
      }
      window.location.href = result.checkoutUrl
    },
    onError: (err: Error) => {
      opts.onError?.(err.message)
    },
  })
}

/* ─── Stripe checkout ───────────────────────────────── */
export interface CheckoutSession {
  url: string
}

export function useCheckout() {
  return useMutation({
    mutationFn: ({ courseId, couponCode }: { courseId: string; couponCode?: string }) =>
      apiPost<CheckoutSession>('/checkout', { courseId, couponCode }),
    onSuccess: ({ url }) => {
      window.location.href = url
    },
  })
}

/* ─── Coupon validation ──────────────────────────────── */
export interface CouponInfo {
  code:          string
  discountType:  'percent' | 'fixed'
  discountValue: number
}

export function useValidateCoupon(code: string, courseId: string) {
  return useQuery({
    queryKey: ['coupon', code, courseId],
    queryFn:  () => apiGet<CouponInfo>('/coupons/validate', { code, courseId }),
    enabled:  code.length >= 2 && !!courseId,
    retry:    false,
    staleTime: 60_000,
  })
}

/* ─── Order history ─────────────────────────────────── */
export interface MyOrder {
  id:                  string
  courseId:            string | { id: string; title: string; slug: string; thumbnailUrl?: string }
  gateway:             'razorpay' | 'stripe' | 'tabby' | 'abzer' | 'tamara'
  amount:              number
  currency:            string
  status:              'pending' | 'paid' | 'refunded' | 'cancelled'
  discountAmount:      number
  razorpayPaymentId?:  string
  tabbyPaymentId?:     string
  abzerPaymentId?:     string
  tamaraPaymentId?:    string
  stripeInvoiceUrl?:   string
  refundedAt?:         string
  createdAt:           string
}

/* ─── Tabby return-URL verify hook ──────────────────── */
export function useVerifyTabbyReturn() {
  return useMutation({
    mutationFn: async (input: { orderId: string; paymentId?: string }) => {
      /* `paid` is the real outcome. A 200 here only means the request was
         understood — fulfilment can still have been refused (payment not
         authorised, or it did not belong to this order). */
      const res = await apiPost<{ needsRegistration: boolean; paid: boolean }>(
        '/checkout/tabby/verify-return', input,
      )
      return res
    },
  })
}

/* ─── Tamara return-URL verify hook ─────────────────── */
export function useVerifyTamaraReturn() {
  return useMutation({
    mutationFn: async (input: { orderId: string }) => {
      /* `paid` is the real outcome — a 200 only means the request was
         understood. Tamara can leave an order at `approved` (not paid) or
         refuse the authorise entirely. */
      const res = await apiPost<{ needsRegistration: boolean; paid: boolean }>(
        '/checkout/tamara/verify-return', input,
      )
      return res
    },
  })
}

export const orderKeys = {
  mine: ['orders', 'mine'] as const,
}

export function useMyOrders() {
  return useQuery({
    queryKey: orderKeys.mine,
    queryFn:  () => apiGet<MyOrder[]>('/orders/me'),
    staleTime: 30_000,
  })
}
