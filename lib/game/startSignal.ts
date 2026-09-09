'use client';

import { useSyncExternalStore } from 'react';

// Señal "iniciar juego" entre la barra inferior (BarraJugar, vive en el
// layout) y la partida (vive en /juego). Si la pantalla del juego aún
// no montó (se está navegando hacia /juego), la señal queda pendiente
// y se consume al montar — pero caduca rápido: una señal vieja no
// debe arrancar una partida cuando el jugador vuelva más tarde.

type Listener = () => void;

let listener: Listener | null = null;
let pendingAt = 0;

const PENDING_TTL_MS = 4000;

/** La pantalla del juego se suscribe al montar; devuelve cómo desuscribirse */
export function onGameStart(fn: Listener): () => void {
  listener = fn;
  if (pendingAt && Date.now() - pendingAt < PENDING_TTL_MS) fn();
  pendingAt = 0;
  return () => {
    if (listener === fn) listener = null;
  };
}

/** La barra pide arrancar: directo si el juego está montado, pendiente si no */
export function requestGameStart() {
  if (listener) listener();
  else pendingAt = Date.now();
}

// ── Estado "hay partida en curso" (GameBoard → PlayBar) ──
// Mientras se juega, la barra inferior esconde su botón: «Iniciar
// juego» no debe quedarse visible con la partida ya andando.

let gameActive = false;
const activeListeners = new Set<Listener>();

export function setGameActive(value: boolean) {
  if (gameActive === value) return;
  gameActive = value;
  activeListeners.forEach((l) => l());
}

/** Lectura puntual (fuera de React): ¿hay partida en curso? */
export function isGameActive(): boolean {
  return gameActive;
}

export function useGameActive(): boolean {
  return useSyncExternalStore(
    (cb) => {
      activeListeners.add(cb);
      return () => activeListeners.delete(cb);
    },
    () => gameActive,
    () => false
  );
}
