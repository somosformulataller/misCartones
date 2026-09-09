import type { Metadata, Viewport } from 'next';
import { PlayerProvider } from '@/components/providers/PlayerProvider';
import './globals.css';

export const metadata: Metadata = {
  title: 'Mis Cartones',
  description: 'Recoge las bolsas de basura y llévalas a la carretilla.',
};

export const viewport: Viewport = {
  themeColor: '#4fc3f7',
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
      </body>
    </html>
  );
}
