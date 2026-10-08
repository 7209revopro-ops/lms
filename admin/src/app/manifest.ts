import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name:             'Delta Institutions Admin',
    short_name:       'Delta Institutions Admin',
    description:      'Administration portal for the Delta Institutions learning platform.',
    start_url:        '/',
    scope:            '/',
    display:          'standalone',
    orientation:      'landscape-primary',
    background_color: '#0D0F1A',
    theme_color:      '#0D0F1A',
    categories:       ['business', 'education', 'productivity'],
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    ],
    shortcuts: [
      {
        name:        'Courses',
        short_name:  'Courses',
        description: 'Manage course catalogue',
        url:         '/courses',
      },
      {
        name:        'Users',
        short_name:  'Users',
        description: 'Manage platform users',
        url:         '/users',
      },
      {
        name:        'Analytics',
        short_name:  'Analytics',
        description: 'View platform metrics',
        url:         '/analytics',
      },
    ],
  }
}
