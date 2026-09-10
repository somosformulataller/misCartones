'use client';

import { useEffect, useRef } from 'react';
import type { GameCallbacks, GameHandle } from '@/lib/three/game';

interface Props {
  seed: number;
  alreadyDeposited?: number[];
  muted: boolean;
  /** false = calle apagada (sin partida). Cambiarlo no remonta el motor. */
  encendida: boolean;
  callbacks: GameCallbacks;
}

/**
 * LA ÚNICA FRONTERA entre React y el motor. Hace exactamente cuatro cosas:
 * crea el contenedor, monta el motor 3D, le pasa los callbacks y
 * LA DESTRUYE en la limpieza del efecto.
 *
 * Lo último es lo importante. Si la Application no se destruye, cambiar de
 * pantalla y volver deja el contexto WebGL vivo y crea otro: a la tercera
 * partida el teléfono se muere. Y como React 19 en StrictMode monta cada
 * efecto DOS veces a propósito durante el desarrollo, aquí se nota enseguida
 * si está mal — por eso el `cancelado`, que cubre el caso de que la limpieza
 * llegue antes de que termine el `await` de la inicialización.
 *
 * El motor NUNCA vuelve a renderizar React: los callbacks solo saltan al
 * recoger y al entregar, no en cada fotograma.
 */
export default function GameCanvas({
  seed,
  alreadyDeposited,
  muted,
  encendida,
  callbacks,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const handleRef = useRef<GameHandle | null>(null);
  // Los callbacks se leen por referencia para que cambiarlos no remonte el
  // motor: remontar es tirar el contexto WebGL y volverlo a crear. La ref se
  // actualiza en un efecto, no durante el render (escribir refs mientras se
  // renderiza rompe con el renderizado concurrente de React 19).
  const cbRef = useRef(callbacks);
  useEffect(() => {
    cbRef.current = callbacks;
  }, [callbacks]);

  // Encender y apagar la calle NO remonta el motor: es subirle o bajarle la
  // luz al que ya está. La ref deja leer el valor vigente cuando el motor
  // termina de cargar, que llega tarde, detrás de un import asíncrono.
  const encendidaRef = useRef(encendida);
  useEffect(() => {
    encendidaRef.current = encendida;
    handleRef.current?.setEncendida(encendida);
  }, [encendida]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let cancelado = false;

    // El import dinámico deja three.js (~100 KB gz) fuera del bundle inicial:
    // solo se descarga al entrar a la pantalla de juego.
    import('@/lib/three/game')
      .then(({ createGame }) =>
        createGame(el, {
          seed,
          alreadyDeposited,
          encendida: encendidaRef.current,
          // Lo que tapa el marcador desde el borde de arriba del lienzo: el
          // ciudadano se para por debajo, en vez de esconderse detrás. Se miden
          // sus FILAS, no la caja de .hud: esa cubre el lienzo entero (inset 0)
          // y lleva dentro el aviso de abajo.
          tapadoArriba: () => {
            let abajo = -Infinity;
            document.querySelectorAll('.hud > .hud-fila, .hud > .hud-bolsas').forEach((fila) => {
              abajo = Math.max(abajo, fila.getBoundingClientRect().bottom);
            });
            return Number.isFinite(abajo) ? abajo - el.getBoundingClientRect().top : 0;
          },
          reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
          callbacks: {
            onDeposit: (id) => cbRef.current.onDeposit(id),
            onPickup: (id) => cbRef.current.onPickup?.(id),
            onState: (s) => cbRef.current.onState?.(s),
            onCredit: (m, t, o) => cbRef.current.onCredit?.(m, t, o),
            onFinished: (o) => cbRef.current.onFinished?.(o),
            onError: (m) => cbRef.current.onError?.(m),
          },
        })
      )
      .then((h) => {
        if (cancelado) {
          h.destroy();
          return;
        }
        handleRef.current = h;
        h.setMuted(muted);
        h.setEncendida(encendidaRef.current);
      })
      .catch((err) => {
        console.error('No se pudo iniciar el motor:', err);
        cbRef.current.onError?.('No se pudo iniciar el juego en este dispositivo.');
      });

    return () => {
      cancelado = true;
      handleRef.current?.destroy();
      handleRef.current = null;
    };
    // `muted` a propósito fuera: se aplica abajo sin remontar el motor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed]);

  useEffect(() => {
    handleRef.current?.setMuted(muted);
  }, [muted]);

  return <div ref={ref} className="absolute inset-0 overflow-hidden" />;
}
