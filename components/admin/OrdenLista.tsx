'use client';

import { useCallback, useSyncExternalStore } from 'react';

// Orden de las listas de trabajo del panel (chats, compras, retiros).
//
// Por defecto, EL MÁS ANTIGUO ARRIBA: son colas de atención, y quien
// lleva más tiempo esperando es a quien hay que atender primero. Con
// los recientes arriba, un pago del mediodía se queda enterrado bajo
// los de la tarde y el jugador espera horas.
//
// Cada persona del equipo puede invertirlo y su elección se recuerda en
// SU navegador (no es un ajuste global: a quien revisa lo de hoy le
// sirve el orden contrario que a quien vacía la cola).

export type Orden = 'antiguos' | 'recientes';

const ORDEN_POR_DEFECTO: Orden = 'antiguos';

// La preferencia vive en localStorage, que para React es un sistema
// externo: se lee con useSyncExternalStore en vez de con un efecto que
// haga setState. Así el servidor pinta el orden por defecto, el
// navegador cambia al guardado sin parpadeo de hidratación, y dos
// listas abiertas a la vez se enteran del cambio.
const oyentes = new Set<() => void>();

function avisar() {
  for (const o of oyentes) o();
}

function suscribir(cb: () => void) {
  oyentes.add(cb);
  // Otra pestaña del panel también cuenta
  window.addEventListener('storage', cb);
  return () => {
    oyentes.delete(cb);
    window.removeEventListener('storage', cb);
  };
}

function leer(clave: string): Orden {
  try {
    const guardado = localStorage.getItem(`orden:${clave}`);
    if (guardado === 'antiguos' || guardado === 'recientes') return guardado;
  } catch {}
  return ORDEN_POR_DEFECTO;
}

/** Recuerda la preferencia de esta lista en el navegador de quien mira */
export function useOrden(clave: string): [Orden, (o: Orden) => void] {
  const orden = useSyncExternalStore(
    suscribir,
    () => leer(clave),
    () => ORDEN_POR_DEFECTO
  );

  const cambiar = useCallback(
    (o: Orden) => {
      try {
        localStorage.setItem(`orden:${clave}`, o);
      } catch {}
      avisar();
    },
    [clave]
  );

  return [orden, cambiar];
}

/**
 * Ordena por fecha sin tocar la lista original. Las filas sin fecha
 * van al final en los dos sentidos: son casos raros (una conversación
 * abierta y nunca escrita) y no deben encabezar ninguna cola.
 */
export function ordenar<T>(
  filas: readonly T[],
  orden: Orden,
  fecha: (f: T) => string | null | undefined
): T[] {
  return [...filas].sort((a, b) => {
    const fa = fecha(a);
    const fb = fecha(b);
    if (!fa && !fb) return 0;
    if (!fa) return 1;
    if (!fb) return -1;
    return orden === 'antiguos' ? fa.localeCompare(fb) : fb.localeCompare(fa);
  });
}

/** Los dos botones de orden, para meter en la fila de filtros */
export function OrdenToggle({
  orden,
  onChange,
  etiqueta = 'Orden',
}: {
  orden: Orden;
  onChange: (o: Orden) => void;
  etiqueta?: string;
}) {
  return (
    <span className="orden-toggle" role="group" aria-label={etiqueta}>
      <button
        className={`btn-mini ${orden === 'antiguos' ? 'btn-mini-active' : ''}`}
        onClick={() => onChange('antiguos')}
        title="El que lleva más tiempo esperando, arriba"
      >
        ↑ Antiguos primero
      </button>
      <button
        className={`btn-mini ${orden === 'recientes' ? 'btn-mini-active' : ''}`}
        onClick={() => onChange('recientes')}
        title="Lo último que entró, arriba"
      >
        ↓ Recientes primero
      </button>
    </span>
  );
}
