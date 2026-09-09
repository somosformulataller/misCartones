import type { Metadata, Viewport } from 'next';
import { PlayerProvider } from '@/components/providers/PlayerProvider';
import RegistrarSW from '@/components/pwa/RegistrarSW';
import './globals.css';

export const metadata: Metadata = {
  title: 'Mis Cartones',
  description: 'Recoge las bolsas de basura y llévalas a la carretilla.',
  // El manifiesto lo enlaza Next solo, desde app/manifest.ts.
  applicationName: 'Mis Cartones',
  // iOS no lee el manifiesto: el nombre bajo el icono, la barra de estado y
  // el arranque a pantalla completa se le dicen aparte.
  appleWebApp: {
    capable: true,
    title: 'Mis Cartones',
    statusBarStyle: 'black-translucent',
  },
  icons: {
    icon: [
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180' }],
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  // El mismo verde que el manifiesto: instalada, la app pinta con esto la
  // barra del sistema, y un color distinto se ve como un borde mal pegado.
  themeColor: '#0c2e24',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="antialiased">
        {/* El perfil del jugador se carga UNA vez, en la raíz, y de ahí lo
            leen todas las pantallas. Si cada una lo pidiera por su cuenta, el
            saldo saltaría al navegar y habría cuatro peticiones donde va una. */}
        <PlayerProvider>{children}</PlayerProvider>
        <RegistrarSW />
      </body>
    </html>
  );
}
