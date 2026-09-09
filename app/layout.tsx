import type { Metadata, Viewport } from 'next';
import { Pixelify_Sans } from 'next/font/google';
import { PlayerProvider } from '@/components/providers/PlayerProvider';
import RegistrarSW from '@/components/pwa/RegistrarSW';
import './globals.css';

/**
 * La tipografía de la interfaz: una fuente de píxeles, la misma idea que la de
 * Minecraft — retícula fija, sin curvas, sin antialias que la suavice.
 *
 * Se probó Silkscreen primero y se descartó: sus minúsculas son versalitas,
 * así que TODA la pantalla salía en mayúsculas. En inglés pasa; en español,
 * con tildes y frases largas, grita y se lee peor. Pixelify Sans tiene caja
 * baja de verdad, que es lo que tiene la fuente de Minecraft.
 *
 * Se carga con `next/font`, que la descarga en el build y la sirve desde
 * nuestro dominio: ni una petición a Google desde el teléfono del jugador, y
 * ninguna pantalla en blanco esperando a una fuente de fuera.
 *
 * Va como variable CSS y no como clase global a propósito. En un bloque de
 * texto largo —los términos, un aviso de tres líneas— una fuente de píxeles
 * se lee mal; ahí manda la del sistema. La de píxeles es para lo que es la
 * interfaz: títulos, botones, etiquetas y cifras.
 */
const pixel = Pixelify_Sans({
  weight: ['400', '500', '700'],
  subsets: ['latin'],
  variable: '--font-pixel',
  display: 'swap',
});

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
    <html lang="es" className={pixel.variable}>
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
