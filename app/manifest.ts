import type { MetadataRoute } from 'next';

/**
 * El manifiesto de la PWA. Next lo sirve en `/manifest.webmanifest` y mete el
 * <link> en todas las páginas: no hay que enlazarlo a mano.
 *
 * `display: 'standalone'` es lo que hace que, una vez instalada, la app abra
 * sin la barra del navegador — que es la mitad de por qué se instala.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Mis Cartones',
    short_name: 'Mis Cartones',
    description: 'Recoge las bolsas, llena la carretilla y cobra tus premios.',
    // Se abre en el juego, no en el lobby: quien la instaló ya sabe a qué
    // viene, y si no hay sesión la propia pantalla lo manda a entrar.
    start_url: '/juego',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0c2e24',
    theme_color: '#0c2e24',
    lang: 'es',
    dir: 'ltr',
    categories: ['games', 'entertainment'],
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      // El «maskable» es el que Android recorta a la forma del sistema: sin
      // él, el icono sale metido dentro de un cuadrito blanco.
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Jugar', short_name: 'Jugar', url: '/juego' },
      { name: 'Mi billetera', short_name: 'Billetera', url: '/billetera' },
      { name: 'Comprar tickets', short_name: 'Comprar', url: '/comprar' },
    ],
  };
}
