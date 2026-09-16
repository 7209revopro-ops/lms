'use client'

import { useEffect, useRef, useState } from 'react'

/* ─────────────────────────────────────────────────────────────────────────────
   Tabby on-site messaging (promo snippets).

   Tabby's go-live QA checks for these explicitly and fails an integration that
   ships without them:

     • "Product and cart snippets/pop-ups present per documentation"
     • "Product snippets displayed for all items without amount limitations"
     • "Cart snippet shown for all amounts without limitations"
     • "Cart snippet amount updates when items are added, removed, or deleted"
     • "Snippets fit mobile web width and scale appropriately for desktop"

   Two widgets, both from Tabby's own CDN:
     TabbyPromo — product and cart pages, near the price
     TabbyCard  — checkout, under the Tabby payment option

   Only the PUBLIC key (pk_…) is ever used here. QA also checks the inverse:
   "No secret keys (sk_) visible in page source or browser network traffic".
───────────────────────────────────────────────────────────────────────────── */

type TabbyWidgetConfig = {
  selector:     string
  currency:     string
  price:        string
  lang:         string
  publicKey:    string
  merchantCode: string
  source?:      string
}

declare global {
  interface Window {
    TabbyPromo?: new (config: TabbyWidgetConfig) => unknown
    TabbyCard?:  new (config: TabbyWidgetConfig) => unknown
  }
}

const SCRIPTS = {
  promo: 'https://checkout.tabby.ai/tabby-promo.js',
  card:  'https://checkout.tabby.ai/tabby-card.js',
} as const

/* One in-flight promise per script so a page with a product snippet AND a cart
   snippet doesn't fetch the same bundle twice. */
const loaders = new Map<string, Promise<void>>()

function loadScript(src: string): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  const cached = loaders.get(src)
  if (cached) return cached

  const promise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`)
    if (existing) {
      if (existing.dataset['loaded'] === 'true') { resolve(); return }
      existing.addEventListener('load',  () => resolve())
      existing.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)))
      return
    }
    const el = document.createElement('script')
    el.src   = src
    el.async = true
    el.addEventListener('load',  () => { el.dataset['loaded'] = 'true'; resolve() })
    el.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)))
    document.head.appendChild(el)
  })

  /* A failed load must not be cached as permanently broken — a student on a
     flaky connection should get the snippet on the next render. */
  promise.catch(() => loaders.delete(src))
  loaders.set(src, promise)
  return promise
}

export const TABBY_PUBLIC_KEY    = process.env['NEXT_PUBLIC_TABBY_PUBLIC_KEY']    ?? ''
export const TABBY_MERCHANT_CODE = process.env['NEXT_PUBLIC_TABBY_MERCHANT_CODE'] ?? ''

/* Whether the snippets can render at all. Deliberately NOT a price check:
   Tabby requires the messaging on every amount and decides eligibility itself. */
export function tabbySnippetsEnabled(): boolean {
  return Boolean(TABBY_PUBLIC_KEY && TABBY_MERCHANT_CODE)
}

interface TabbyWidgetProps {
  /** Amount in major units (AED), e.g. 730.33 */
  price:     number
  currency?: string
  lang?:     'en' | 'ar'
  /** 'product' on a course page, 'cart' in the cart. Ignored by TabbyCard. */
  source?:   'product' | 'cart'
  variant?:  'promo' | 'card'
  className?: string
}

let widgetSeq = 0

export function TabbyWidget({
  price,
  currency = 'AED',
  lang     = 'en',
  source   = 'product',
  variant  = 'promo',
  className,
}: TabbyWidgetProps) {
  /* A stable, unique DOM id — Tabby's widgets take a CSS selector, not a node. */
  const idRef = useRef<string>('')
  if (!idRef.current) idRef.current = `tabby-${variant}-${++widgetSeq}`

  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!tabbySnippetsEnabled()) return
    if (!Number.isFinite(price) || price <= 0) return

    let cancelled = false
    const src = variant === 'card' ? SCRIPTS.card : SCRIPTS.promo

    loadScript(src)
      .then(() => {
        if (cancelled) return
        const Widget = variant === 'card' ? window.TabbyCard : window.TabbyPromo
        if (!Widget) { setFailed(true); return }

        /* Re-instantiating is how Tabby's widgets re-render on a price change,
           which is what keeps the cart snippet honest as items are added and
           removed. The container is emptied first so a stale amount can't be
           left behind next to the new one. */
        const host = document.getElementById(idRef.current)
        if (host) host.innerHTML = ''

        new Widget({
          selector:     `#${idRef.current}`,
          currency,
          price:        price.toFixed(2),
          lang,
          publicKey:    TABBY_PUBLIC_KEY,
          merchantCode: TABBY_MERCHANT_CODE,
          ...(variant === 'promo' && { source }),
        })
        setFailed(false)
      })
      .catch(() => { if (!cancelled) setFailed(true) })

    return () => { cancelled = true }
    /* price drives re-initialisation — QA checks the cart snippet tracks the
       basket total as it changes. */
  }, [price, currency, lang, source, variant])

  /* Nothing configured, or Tabby's CDN is unreachable: render nothing rather
     than an empty bordered box. The payment option itself is unaffected. */
  if (!tabbySnippetsEnabled() || failed) return null

  return <div id={idRef.current} className={className} />
}

/* Convenience wrappers so call sites read as what they are. */
export function TabbyProductPromo(props: Omit<TabbyWidgetProps, 'variant' | 'source'>) {
  return <TabbyWidget {...props} variant="promo" source="product" />
}

export function TabbyCartPromo(props: Omit<TabbyWidgetProps, 'variant' | 'source'>) {
  return <TabbyWidget {...props} variant="promo" source="cart" />
}

export function TabbyCheckoutCard(props: Omit<TabbyWidgetProps, 'variant' | 'source'>) {
  return <TabbyWidget {...props} variant="card" />
}
