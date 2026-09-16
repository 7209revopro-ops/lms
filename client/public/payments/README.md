# Payment provider logos

Drop official brand assets here. They are served from `/payments/<file>`.

## tabby-logo.svg  (REQUIRED before Tabby QA)

Tabby's QA checklist requires "Tabby logo appears next to payment method name".

Get the official SVG from Tabby's Marketing Toolkit — the Figma deck linked from
https://docs.tabby.ai/marketing/toolkit — and save it here as `tabby-logo.svg`.

`client/src/components/payments/TabbyLogo.tsx` picks it up automatically and
falls back to a plain purple wordmark while the file is missing. The trademark is
deliberately not redrawn in code: a from-memory approximation fails the same QA
check a missing logo does.
