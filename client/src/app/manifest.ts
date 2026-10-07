import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name:             'LearnOS | Learn Without Limits',
    short_name:       'Delta Institutions',
    description:      'Expert-led courses, hands-on projects, and a community that grows with you.',
    start_url:        '/',
    scope:            '/',
    display:          'standalone',
    orientation:      'portrait',
    background_color: '#FFFFFF',
    theme_color:      '#0057b8',
    categories:       ['education', 'productivity'],
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    ],
    shortcuts: [
      {
        name:        'My Learning',
        short_name:  'Learning',
        description: 'Continue your enrolled courses',
        url:         '/my-learning',
      },
      {
        name:        'Browse Courses',
        short_name:  'Courses',
        description: 'Explore the course catalogue',
        url:         '/courses',
      },
      {
        name:        'Search',
        short_name:  'Search',
        description: 'Find courses and topics',
        url:         '/search',
      },
    ],
  }
}
