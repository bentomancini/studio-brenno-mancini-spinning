import type { ReactNode } from 'react';
import type { Metadata, Viewport } from 'next';
import '@fontsource/barlow-condensed/latin-700.css';
import '@fontsource/source-sans-3/latin-400.css';
import '@fontsource/source-sans-3/latin-600.css';
import '@fontsource/source-sans-3/latin-700.css';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Studio Brenno Mancini Spinning', template: '%s | Studio Brenno Mancini' },
  description: 'Consulte a agenda e gerencie suas reservas de spinning no Studio Brenno Mancini.',
  robots: { index: false, follow: false },
  icons: {
    icon: [
      { url: '/icon.svg', type: 'image/svg+xml' },
    ],
    apple: [
      { url: '/apple-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Studio Mancini',
  },
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#171A18', colorScheme: 'light' };
export default function Layout({ children }: { children: ReactNode }) {
  return <html lang="pt-BR"><body><a className="skip-link" href="#conteudo">Pular para o conteúdo</a>{children}</body></html>;
}
