'use client'

import { useState } from 'react'

/* ─────────────────────────────────────────────────────────────────────────────
   Tabby logo for the payment-method row.

   QA checks for it: "Tabby logo appears next to payment method name".

   The official artwork lives in Tabby's Marketing Toolkit (the Figma deck
   linked from docs.tabby.ai/marketing/toolkit) and is a trademark, so it is
   not reproduced here by hand — a redrawn-from-memory wordmark would fail the
   same QA check a missing one does. Drop the real file at

       client/public/payments/tabby-logo.svg

   and it is picked up automatically. Until then this renders Tabby's wordmark
   in their brand purple so the checkout never looks broken.
───────────────────────────────────────────────────────────────────────────── */

export const TABBY_BRAND_PURPLE = '#3D1D8E'

interface TabbyLogoProps {
  /** Rendered height in px. Tabby's own snippets sit comfortably at 14–20. */
  height?:   number
  className?: string
}

export function TabbyLogo({ height = 14, className }: TabbyLogoProps) {
  const [missing, setMissing] = useState(false)

  if (missing) {
    return (
      <span
        className={className}
        style={{
          color:         TABBY_BRAND_PURPLE,
          fontSize:      height,
          fontWeight:    800,
          letterSpacing: '-0.02em',
          lineHeight:    1,
        }}
      >
        tabby
      </span>
    )
  }

  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src="/payments/tabby-logo.svg"
      alt="Tabby"
      height={height}
      style={{ height, width: 'auto', display: 'block' }}
      className={className}
      onError={() => setMissing(true)}
    />
  )
}
