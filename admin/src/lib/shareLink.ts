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
  await copyText(url)
  return 'copied'
}

/* The clipboard, with the old hidden-textarea route for a browser that
   refuses the API — embedded and in-app browsers, a page without clipboard
   permission — so "Copy" works there too instead of failing outright.
   Throws only when neither route copied anything. */
export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
  } catch (err) {
    if (typeof document === 'undefined') throw err
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.top = '-1000px'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    if (!ok) throw err
  }
}
