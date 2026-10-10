import type { Metadata, Viewport } from 'next'
import { Bricolage_Grotesque, DM_Sans, JetBrains_Mono } from 'next/font/google'
import { Providers } from './providers'
import { PwaRegister } from '@/components/PwaRegister'
import './globals.css'

/* ─── Fonts ─────────────────────────────────────── */
const displayFont = Bricolage_Grotesque({
  subsets: ['latin'],
  variable: '--font-display',
  weight: ['200', '300', '400', '500', '600', '700', '800'],
  display: 'swap',
})

const bodyFont = DM_Sans({
  subsets: ['latin'],
  variable: '--font-body',
  weight: ['300', '400', '500', '600', '700'],
  style: ['normal', 'italic'],
  display: 'swap',
})

const monoFont = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  weight: ['400', '500'],
  display: 'swap',
})

/* ─── Metadata ──────────────────────────────────── */
export const metadata: Metadata = {
  title: { template: '%s | Delta Institutions', default: 'Delta Institutions | Leading Trading Academy' },
  description: 'UAE leading trading academy. Begin your learning journey at Delta Institutions.',
  icons: {
    icon:     [{ url: '/icons/icone.png', type: 'image/png' }],
    shortcut: '/icons/icone.png',
    apple:    '/icons/icone.png',
  },
  manifest:    '/manifest.webmanifest',
  applicationName: 'Delta Institutions',
  appleWebApp: {
    capable:    true,
    title:      'Delta Institutions',
    statusBarStyle: 'default',
  },
}

export const viewport: Viewport = {
  themeColor: '#0057b8',
  width: 'device-width',
  initialScale: 1,
}

/* Runs before the first paint, ahead of React and ahead of the stylesheet
   being applied to any pixels. Without it a dark-theme user gets a white
   flash on every navigation: the server cannot know the preference (it lives
   in localStorage, not a cookie), so the document starts light and only turns
   dark once the store rehydrates — which is after paint.

   Deliberately inline and dependency-free so it cannot be deferred, and
   wrapped in try/catch because a browser with storage disabled must still
   render the app rather than a blank page. */
const THEME_BOOT = `
(function(){try{
  var p = localStorage.getItem('lms-theme');
  if (p) { try { p = JSON.parse(p).state.preference } catch (e) { } }
  if (p !== 'light' && p !== 'dark') {
    p = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  document.documentElement.setAttribute('data-theme', p);
}catch(e){document.documentElement.setAttribute('data-theme','light')}})();
`

const GTAG_INIT = `window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', 'G-7WQCSFLT8D');`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      /* The boot script sets data-theme before React hydrates, so the server
         markup and the client markup differ on this attribute by design. */
      suppressHydrationWarning
      className={`${displayFont.variable} ${bodyFont.variable} ${monoFont.variable}`}
    >
      <head>
        {/* Google tag (gtag.js) — G-7WQCSFLT8D. Plain tags first in <head>, as
            Google asks, so they are in the page's HTML and its tag check finds them. */}
        <script async src="https://www.googletagmanager.com/gtag/js?id=G-7WQCSFLT8D" />
        <script dangerouslySetInnerHTML={{ __html: GTAG_INIT }} />
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body>
        <Providers>{children}</Providers><PwaRegister />
      </body>
    </html>
  )
}
