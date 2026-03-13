import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'TACTIK.KZ',
    short_name: 'TACTIK',
    description: 'Real-time collaborative telestration tool for coaches, creators, and studios',
    start_url: '/',
    display: 'standalone',
    background_color: '#071738',
    theme_color: '#071738',
    icons: [
      {
        src: '/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: '/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
      },
      {
        src: '/apple-icon.png',
        sizes: '180x180',
        type: 'image/png',
      },
    ],
  };
}
