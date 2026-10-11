import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name:             'Delta Institutions',
    short_name:       'Delta',
    id:               '/',
    description:      'Expert-led courses, hands-on projects, and a community that grows with you.',
    start_url:        '/',
    scope:            '/',
    display:          'standalone',
    orientation:      'portrait',
    background_color: '#FFFFFF',
    theme_color:      '#0057b8',
    categories:       ['education', 'productivity'],
    /* The Delta "d". The old /icons/icon.svg (a LearnOS triangle) was listed
       here with sizes 'any' — browsers that prefer SVG installed THAT. The
       maskable one keeps the logo inside the 80% safe circle, so Android's
       round / squircle masks do not clip it. */
    icons: [
      { src: '/icon-192.png',          sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png',          sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
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
