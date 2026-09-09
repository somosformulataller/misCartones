'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * El evento que Chrome dispara cuando la app cumple los requisitos para
 * instalarse. No está en las tipificaciones del DOM porque no es estándar
 * todavía, así que se declara lo que se usa.
 */
interface EventoInstalar extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

type Plataforma = 'ios' | 'android' | 'escritorio';

/** Instrucciones a mano, para cuando el navegador no ofrece el diálogo. */
const PASOS: Record<Plataforma, { titulo: string; pasos: string[] }> = {
  ios: {
    titulo: 'Instalar en iPhone',
    pasos: [
      'Abre esta página en Safari (en otros navegadores el iPhone no deja instalar).',
      'Toca el botón Compartir, el cuadrado con la flecha hacia arriba.',
      'Baja y elige «Añadir a pantalla de inicio».',
      'Toca «Añadir». El icono queda junto a tus otras apps.',
    ],
  },
  android: {
    titulo: 'Instalar en Android',
    pasos: [
      'Toca los tres puntos ⋮ arriba a la derecha del navegador.',
      'Elige «Instalar aplicación» o «Añadir a pantalla de inicio».',
      'Confirma. El icono queda junto a tus otras apps.',
    ],
  },
  escritorio: {
    titulo: 'Instalar en la computadora',
    pasos: [
      'Mira el ícono de instalar al final de la barra de direcciones.',
      'Si no está, abre el menú del navegador y busca «Instalar Mis Cartones».',
    ],
  },
};

/**
 * Botón de «descargar la app» del login.
 *
 * Va en el login a propósito: es la pantalla que todo el mundo ve, la ven
 * antes de tener nada que perder, y una vez instalada se entra tocando un
 * icono en vez de recordar una dirección.
 *
 * Cuando el navegador ofrece el diálogo nativo, se usa ese. Cuando no —el
 * iPhone nunca lo ofrece—, el botón enseña los pasos a mano en vez de
 * desaparecer: un botón que a veces existe y a veces no es peor que uno que
 * siempre está y explica.
 */
export default function BotonInstalar() {
  const [evento, setEvento] = useState<EventoInstalar | null>(null);
  const [instalada, setInstalada] = useState(true); // hasta saberlo, no se pinta
  const [plataforma, setPlataforma] = useState<Plataforma>('escritorio');
  const [abierto, setAbierto] = useState(false);

  useEffect(() => {
    const enApp =
      window.matchMedia('(display-mode: standalone)').matches ||
      // Safari en iOS no soporta display-mode y lo dice por su cuenta.
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
    const ua = window.navigator.userAgent;
    const cual: Plataforma = /iphone|ipad|ipod/i.test(ua)
      ? 'ios'
      : /android/i.test(ua)
        ? 'android'
        : 'escritorio';

    // Se lee el entorno una vez, al montar. No hay forma de saberlo antes: en
    // el servidor no existe ni la ventana ni el navegador.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setInstalada(enApp);
    setPlataforma(cual);

    const alOfrecer = (e: Event) => {
      // Sin esto Chrome saca su propia barrita abajo, y quedan dos sitios
      // desde donde instalar diciendo cosas distintas.
      e.preventDefault();
      setEvento(e as EventoInstalar);
    };
    const alInstalar = () => {
      setEvento(null);
      setInstalada(true);
    };
    window.addEventListener('beforeinstallprompt', alOfrecer);
    window.addEventListener('appinstalled', alInstalar);
    return () => {
      window.removeEventListener('beforeinstallprompt', alOfrecer);
      window.removeEventListener('appinstalled', alInstalar);
    };
  }, []);

  const instalar = useCallback(async () => {
    if (!evento) {
      setAbierto(true);
      return;
    }
    await evento.prompt();
    const { outcome } = await evento.userChoice;
    // El evento es de un solo uso: si dijeron que no, se suelta y el botón
    // pasa a enseñar los pasos a mano.
    setEvento(null);
    if (outcome === 'accepted') setInstalada(true);
  }, [evento]);

  // Ya está instalada: quien la abrió desde el icono no necesita que le
  // ofrezcan instalarla otra vez.
  if (instalada) return null;

  const guia = PASOS[plataforma];

  return (
    <div className="instalar-pwa">
      <button type="button" className="instalar-pwa__boton" onClick={instalar}>
        <span aria-hidden>⬇️</span>
        Descargar la app
      </button>
      <p className="instalar-pwa__nota">
        Se instala en tu teléfono y abre sin el navegador. No ocupa casi nada.
      </p>

      {abierto && (
        <div
          className="instalar-pwa__fondo"
          role="dialog"
          aria-modal="true"
          aria-label={guia.titulo}
          onClick={() => setAbierto(false)}
        >
          <div className="instalar-pwa__hoja" onClick={(e) => e.stopPropagation()}>
            <h2 className="instalar-pwa__titulo">{guia.titulo}</h2>
            <ol className="instalar-pwa__pasos">
              {guia.pasos.map((paso) => (
                <li key={paso}>{paso}</li>
              ))}
            </ol>
            <button
              type="button"
              className="instalar-pwa__cerrar"
              onClick={() => setAbierto(false)}
            >
              Entendido
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
