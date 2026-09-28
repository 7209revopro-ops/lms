import type { Metadata, Viewport } from 'next'
import { Providers } from './providers'
import './globals.css'

export const metadata: Metadata = {
  title: { template: '%s — Delta Admin', default: 'Delta Institutions Admin' },
  description: 'Delta Institutions administration portal',
  /* Same Delta 'd' mark the client uses (client/public/icons/icone.png,
     copied in verbatim), not the generic blue-triangle icon.svg placeholder
     — a browser tab told the two apps apart only by which one had the real
     logo. */
  icons: {
    icon:     [{ url: '/icons/icone.png', type: 'image/png' }],
    shortcut: '/icons/icone.png',
    apple:    '/icons/icone.png',
  },
  manifest:        '/manifest.webmanifest',
  applicationName: 'Delta Institutions Admin',
  appleWebApp: {
    capable:        true,
    title:          'Delta Admin',
    statusBarStyle: 'default',
  },
}

export const viewport: Viewport = {
  themeColor:   '#0057b8',
  width:        'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
