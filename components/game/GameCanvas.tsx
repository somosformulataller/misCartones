'use client';

import { useEffect, useRef } from 'react';
import type { GameCallbacks, GameHandle } from '@/lib/pixi/game';

interface Props {
  seed: number;
  alreadyDeposited?: number[];
  muted: boolean;
  callbacks: GameCallbacks;
}

/**
 * LA ÚNICA FRONTERA entre React y el motor. Hace exactamente cuatro cosas:
 * crea el contenedor, monta la Application de Pixi, le pasa los callbacks y
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
export default function GameCanvas({ seed, alreadyDeposited, muted, callbacks }: Props) {
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

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let cancelado = false;

    // El import dinámico deja Pixi (~130 KB gz) fuera del bundle inicial:
    // solo se descarga al entrar a la pantalla de juego.
    import('@/lib/pixi/game')
      .then(({ createGame }) =>
        createGame(el, {
          seed,
          alreadyDeposited,
          reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
          callbacks: {
            onDeposit: (id) => cbRef.current.onDeposit(id),
            onPickup: (id) => cbRef.current.onPickup?.(id),
            onState: (s) => cbRef.current.onState?.(s),
            onCredit: (m, t) => cbRef.current.onCredit?.(m, t),
            onFinished: () => cbRef.current.onFinished?.(),
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
