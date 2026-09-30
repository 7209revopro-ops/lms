/* ─────────────────────────────────────────────────────
   shareOrCopyLink — one action for "share" and "copy".

   Mobile has a native share sheet (WhatsApp, email, SMS…) that a clipboard
   copy can't match; desktop has no share sheet at all. Rather than two
   buttons for the same link, try the share sheet first and fall back to the
   clipboard wherever it isn't available — the caller shows a toast only for
   the copy case, since the OS share sheet already confirms itself.
───────────────────────────────────────────────────── */
export type ShareLinkResult = 'shared' | 'copied' | 'cancelled'

export async function shareOrCopyLink(url: string, title?: string): Promise<ShareLinkResult> {
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ url, title })
      return 'shared'
    } catch (err) {
      /* The person closed the share sheet without picking anything — that is
         a real answer, not a failure to fall back from. Anything else (share
         unsupported for this data, a browser quirk) falls through to the
         clipboard below. */
      if ((err as { name?: string })?.name === 'AbortError') return 'cancelled'
    }
  }
  await navigator.clipboard.writeText(url)
  return 'copied'
}
