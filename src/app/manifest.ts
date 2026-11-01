import type { MetadataRoute } from 'next';

export const dynamic = 'force-static';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Studio Brenno Mancini Spinning',
    short_name: 'Studio Mancini',
    description: 'Consulte a agenda e gerencie suas reservas no Studio Brenno Mancini.',
    start_url: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#171a18',
    theme_color: '#171a18',
    icons: [
      {
        src: '/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/apple-touch-icon.png',
        sizes: '180x180',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
    ],
  };
}
