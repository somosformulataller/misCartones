'use client';

import { usePathname } from 'next/navigation';

/**
 * El fondo de las pantallas de dentro: la misma calle del juego que hay
 * detrás del registro, pero YA DESENFOCADA en el propio archivo.
 *
 * El desenfoque no se hace aquí con `backdrop-filter` a propósito. Esa
 * propiedad, aplicada a cada tarjeta de una lista que se desplaza, es de lo
 * más caro que se le puede pedir a un teléfono de gama baja — y el teléfono
 * de gama baja es el de casi todos los jugadores. Así que se hace UNA vez,
 * al generar la imagen (`scripts/foto-escena.mjs`), y aquí solo queda una
 * foto de 14 KB: las tarjetas únicamente tienen que ser translúcidas, que no
 * cuesta nada.
 *
 * NO sale en el panel de administración. Ahí se trabaja: son tablas densas y
 * turnos largos leyendo cifras, y una calle de colores por detrás es ruido
 * puro. El panel se queda con su fondo liso.
 */
export default function FondoJuego() {
  const ruta = usePathname();
  if (ruta?.startsWith('/admin')) return null;

  return (
    <div className="fondo-juego" aria-hidden>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/escena-difusa.jpg" alt="" className="fondo-juego-foto" />
      <div className="fondo-juego-velo" />
    </div>
  );
}
