import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/admin/', '/aluno/', '/api/', '/auth/'],
    },
    sitemap: 'https://studio-brenno-mancini-spinning.vercel.app/sitemap.xml',
  };
}
