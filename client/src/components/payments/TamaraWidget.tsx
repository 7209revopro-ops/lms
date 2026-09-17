'use client'

import { useEffect, useRef, useState } from 'react'

/* ─────────────────────────────────────────────────────────────────────────────
   Tamara on-site messaging ("split into 3 payments").

   Tamara's widget model is not Tabby's, in three ways worth knowing before
   touching this:

     • ONE script and ONE custom element for every placement. The position is
       chosen by the `inline-type` attribute, not by instantiating different
       classes. There is no separate product/cart/checkout widget.
     • Configuration is GLOBAL — `window.tamaraWidgetConfig` must exist before
       the script parses. It is not passed per element.
     • THE DEFAULT LANGUAGE IS ARABIC. An English storefront that forgets to
       set `lang: 'en'` renders Arabic promo copy next to English prices.

   A malformed public key does not throw — the SDK only console.warns and the
   widget silently renders nothing, which is why `tamaraWidgetsEnabled()`
   shape-checks the key rather than merely testing for truthiness.
───────────────────────────────────────────────────────────────────────────── */

const SCRIPT_SRC = 'https://cdn.tamara.co/widget-v2/tamara-widget.js'

export const TAMARA_PUBLIC_KEY = process.env['NEXT_PUBLIC_TAMARA_PUBLIC_KEY'] ?? ''

/* The SDK validates the key against this and warns-but-continues on failure,
   so we check it ourselves and simply do not render rather than leaving an
   invisible dead element on a payment page. */
const PUBLIC_KEY_RE = /^[0-9a-z]{8}-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{12}$/

export function tamaraWidgetsEnabled(): boolean {
  return PUBLIC_KEY_RE.test(TAMARA_PUBLIC_KEY)
}

declare global {
  interface Window {
    tamaraWidgetConfig?: { lang: string; country: string; publicKey: string }
    TamaraWidgetV2?: { refresh: () => void }
  }
}

let loader: Promise<void> | null = null

function loadWidgetScript(lang: 'en' | 'ar'): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  if (loader) return loader

  loader = new Promise<void>((resolve, reject) => {
    /* Must be set BEFORE the script runs — it reads this at parse time. */
    window.tamaraWidgetConfig = {
      lang,
      country:   'AE',
      publicKey: TAMARA_PUBLIC_KEY,
    }

    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`)
    if (existing) {
      if (existing.dataset['loaded'] === 'true') { resolve(); return }
      existing.addEventListener('load',  () => resolve())
      existing.addEventListener('error', () => reject(new Error('Tamara widget script failed')))
      return
    }

    const el = document.createElement('script')
    el.src   = SCRIPT_SRC
    el.defer = true
    el.addEventListener('load',  () => { el.dataset['loaded'] = 'true'; resolve() })
    el.addEventListener('error', () => reject(new Error('Tamara widget script failed')))
    document.head.appendChild(el)
  })

  /* A failed load must not be cached as permanently broken. */
  loader.catch(() => { loader = null })
  return loader
}

/* Placement codes from Tamara's own snippet generator. */
const INLINE_TYPE = {
  product:  '2',   // product detail page, shows the instalment split
  checkout: '3',   // checkout / payment-method step
  concise:  '5',   // compact split, for dense layouts like a cart row
} as const

interface TamaraWidgetProps {
  /** Amount in AED major units. Tamara wants DDDD.dd, not a formatted string. */
  price:      number
  placement?: keyof typeof INLINE_TYPE
  lang?:      'en' | 'ar'
  className?: string
}

export function TamaraWidget({
  price,
  placement = 'product',
  lang      = 'en',
  className,
}: TamaraWidgetProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!tamaraWidgetsEnabled()) return
    if (!Number.isFinite(price) || price <= 0) return

    let cancelled = false
    loadWidgetScript(lang)
      .then(() => {
        if (cancelled || !hostRef.current) return
        /* The element is created imperatively rather than rendered by React:
           it is a custom element whose attributes the SDK reads once on
           upgrade, and re-creating it is the documented way to re-render on a
           price change. Leaving React to patch attributes in place gives a
           widget still showing the previous amount. */
        hostRef.current.innerHTML = ''
        const el = document.createElement('tamara-widget')
        el.setAttribute('type', 'tamara-summary')
        el.setAttribute('inline-type', INLINE_TYPE[placement])
        el.setAttribute('inline-variant', 'text')
        el.setAttribute('amount', price.toFixed(2))
        hostRef.current.appendChild(el)
        window.TamaraWidgetV2?.refresh()
        setFailed(false)
      })
      .catch(() => { if (!cancelled) setFailed(true) })

    return () => { cancelled = true }
    /* price drives re-creation — a cart total that changes must not leave a
       stale instalment figure on screen. */
  }, [price, placement, lang])

  if (!tamaraWidgetsEnabled() || failed) return null
  return <div ref={hostRef} className={className} />
}

export function TamaraProductWidget(props: Omit<TamaraWidgetProps, 'placement'>) {
  return <TamaraWidget {...props} placement="product" />
}

export function TamaraCartWidget(props: Omit<TamaraWidgetProps, 'placement'>) {
  return <TamaraWidget {...props} placement="concise" />
}

export function TamaraCheckoutWidget(props: Omit<TamaraWidgetProps, 'placement'>) {
  return <TamaraWidget {...props} placement="checkout" />
}
