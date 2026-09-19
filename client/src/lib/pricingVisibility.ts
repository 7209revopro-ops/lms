/* ─────────────────────────────────────────────────────
   TEMPORARY: pricing and payment are hidden in the student app.

   ONE SWITCH, ON PURPOSE. Set this to `true` and every price, every payment
   method and every checkout route back into view. Reverting a hide that was
   scattered as `{false && …}` across a dozen files means finding all twelve,
   and the one that gets missed is the one a student sees.

       export const SHOW_PRICING = true   // ← restore

   WHAT IT HIDES: course prices on cards, category and learning-path lists, the
   course page and the cart; the price-based sorts and filters, which are
   meaningless with no prices on screen; and the payment surfaces — Abzer,
   Razorpay, Tabby and Tamara — including their BNPL promos and the checkout
   buttons that lead to them.

   WHAT IT DOES NOT HIDE, deliberately:

     · THE ORDER HISTORY. Those are receipts for money a student actually paid.
       A receipt with the amount removed is worse than no receipt, and hiding
       what someone was charged is not the same kind of act as not quoting a
       price. If that is wanted too it should be asked for explicitly.

     · THE "Free" LABEL — see below.

     · ANYTHING ON THE SERVER. Prices are still on the wire, orders still work,
       the gateways are still configured. This is a blindfold on the UI, not a
       kill switch: it stops the app OFFERING a purchase, it does not stop one.
       Anyone who reaches a checkout URL directly still transacts. If the
       intent is to stop selling rather than to stop advertising, that belongs
       in the backend and this flag will not do it.
───────────────────────────────────────────────────── */
export const SHOW_PRICING = false

/* "Free" is a price and hides with the rest.

   It reads as the opposite — it is the ONE label a student is glad to see —
   but leaving it up while every other course shows nothing tells them, by
   omission, exactly which courses cost money. That is the pricing information
   the switch exists to withhold, published as a gap.

   Split from SHOW_PRICING so that if someone later decides free courses should
   be badged during the blackout, it is one word here and not a re-audit of
   every call site. */
export const SHOW_FREE_BADGE = SHOW_PRICING
