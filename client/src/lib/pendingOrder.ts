/* ─────────────────────────────────────────────────────────────
   The order a buyer was just sent to a hosted payment page for.

   BillXPro (Card / Abzer) sends the buyer back to the return URL configured
   in its merchant console — not the one we pass per payment, which is not
   part of its API (v5.1) — so the address it returns to may name no order of
   ours at all (seen 2026-10-26: a PAID payment landed on /payment-return
   with no order id and read "Payment Failed — no charge was made").
   Remembering the order in this tab lets the return page ask the server
   about the right one. Only an id: the server decides what it means, after
   checking the order belongs to whoever asks.
───────────────────────────────────────────────────────────── */
const KEY = 'checkout-pending-order'
const MAX_AGE_MS = 3 * 60 * 60 * 1000

export type PendingGateway = 'abzer' | 'tabby' | 'tamara'
/** 'explore' — the public /explore checkout (guest cookie, signs the buyer in); 'app' — a signed-in student. */
export type PendingSource = 'explore' | 'app'
export interface PendingOrder { orderId: string; gateway: PendingGateway; source: PendingSource; at: number }

export function rememberPendingOrder(orderId: string | undefined, gateway: PendingGateway, source: PendingSource): void {
  if (!orderId) return
  try { sessionStorage.setItem(KEY, JSON.stringify({ orderId, gateway, source, at: Date.now() })) } catch { /* private mode */ }
}

/** The remembered order, if it is for this gateway and recent enough. */
export function readPendingOrder(gateway: PendingGateway): PendingOrder | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as PendingOrder
    if (p.gateway !== gateway || !/^[a-f0-9]{24}$/i.test(p.orderId) || Date.now() - p.at > MAX_AGE_MS) return null
    return p
  } catch { return null }
}

export function forgetPendingOrder(): void {
  try { sessionStorage.removeItem(KEY) } catch { /* private mode */ }
}
