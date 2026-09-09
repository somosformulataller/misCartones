'use client';

import { useEffect } from 'react';

/**
 * Registra el service worker. No pinta nada: va en el layout raíz solo por el
 * efecto.
 *
 * Se hace después de `load` a propósito. El registro pelea por el mismo hilo
 * y la misma red que la primera pantalla, y aquí la primera pantalla es un
 * juego en 3D en un teléfono barato: adelantar el service worker medio
 * segundo no le sirve a nadie, y retrasar el primer cuadro sí se nota.
 */
export default function RegistrarSW() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    // En desarrollo estorba: deja servidas versiones viejas de los chunks y
    // uno se pasa la tarde persiguiendo un cambio que sí guardó.
    if (process.env.NODE_ENV !== 'production') return;

    const registrar = () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // Que falle no rompe nada: se pierde la instalación y el modo sin
        // conexión, el juego sigue igual. No hay nada que decirle al jugador.
      });
    };
    if (document.readyState === 'complete') registrar();
    else window.addEventListener('load', registrar, { once: true });
    return () => window.removeEventListener('load', registrar);
  }, []);

  return null;
}
