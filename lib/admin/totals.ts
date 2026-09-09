import type { SupabaseClient } from '@supabase/supabase-js';

// Los totales del Resumen del panel: cuántos jugadores hay, cuánto se
// les debe y cuánto se ha jugado y pagado en TODA la historia.
//
// Antes esto se sumaba sobre la lista de jugadores que el panel ya
// pedía para otra cosa, y esa lista venía con `.limit(200)`. Mientras
// hubo menos de 200 jugadores el número era correcto; al pasar de 200
// empezó a mentir en silencio, que es la peor forma de mentir: el
// 17/08/2026, con 524 jugadores, el panel daba RTP 98,9% (el de los
// 200 más nuevos) contra el 97,3% real, y $58 de saldo en billeteras
// contra $284 reales.
//
// La regla que se saca de ahí: un total NUNCA se calcula sobre una
// consulta con límite. O lo suma la base entera, o se lee la tabla
// completa a mano.
//
// Camino normal: `get_admin_totals()` (migración 005) — una llamada,
// la base suma. Camino de respaldo: leerlo por tandas desde aquí, por
// si el código llega desplegado antes que la migración o si el panel
// está funcionando sin clave de servicio.

/** PostgREST devuelve como mucho 1.000 filas por respuesta */
const TANDA = 1000;

export interface TotalesGlobales {
  /** Cuentas registradas (incluye las del equipo, como antes) */
  jugadores: number;
  /** Partidas TERMINADAS: cada una consumió un ticket */
  partidas: number;
  /** Premios pagados por el juego */
  premios: number;
  /** Dinero que los jugadores tienen en su billetera (deuda nuestra) */
  saldo_billeteras: number;
  /** Tickets comprados que todavía no se han jugado */
  tickets_sin_jugar: number;
}

const CERO: TotalesGlobales = {
  jugadores: 0,
  partidas: 0,
  premios: 0,
  saldo_billeteras: 0,
  tickets_sin_jugar: 0,
};

/** Céntimos exactos: sumar decimales en coma flotante deja colas de 0,00000004 */
const redondear = (n: number) => Math.round(n * 100) / 100;

interface FilaJugador {
  balance: number | string | null;
  tickets: number | string | null;
}
interface FilaPartida {
  payout: number | string | null;
}

/**
 * Recorre una tabla ENTERA en tandas de 1.000 y va acumulando. Se
 * ordena por `id` (clave primaria) y no por fecha: si dos filas
 * comparten el instante de creación, el orden entre tandas puede
 * bailar y una fila se contaría dos veces o ninguna.
 */
async function porTandas<T>(
  db: SupabaseClient,
  tabla: string,
  columnas: string,
  acumular: (filas: T[]) => void
): Promise<void> {
  for (let desde = 0; ; desde += TANDA) {
    const { data, error } = await db
      .from(tabla)
      .select(columnas)
      .order('id', { ascending: true })
      .range(desde, desde + TANDA - 1);
    if (error) throw error;
    const filas = (data ?? []) as T[];
    acumular(filas);
    if (filas.length < TANDA) return;
  }
}

/** Respaldo: sumar leyendo las tablas completas desde aquí */
async function totalesPorTandas(db: SupabaseClient): Promise<TotalesGlobales> {
  const t = { ...CERO };

  await porTandas<FilaJugador>(db, 'players', 'id, balance, tickets', (filas) => {
    t.jugadores += filas.length;
    for (const p of filas) {
      t.saldo_billeteras += Number(p.balance ?? 0);
      t.tickets_sin_jugar += Number(p.tickets ?? 0);
    }
  });

  await porTandas<FilaPartida>(db, 'game_history', 'id, payout', (filas) => {
    t.partidas += filas.length;
    for (const g of filas) t.premios += Number(g.payout ?? 0);
  });

  t.saldo_billeteras = redondear(t.saldo_billeteras);
  t.premios = redondear(t.premios);
  return t;
}

/** Los totales de TODA la app, sumados en la base cuando se puede */
export async function leerTotales(db: SupabaseClient): Promise<TotalesGlobales> {
  const { data, error } = await db.rpc('get_admin_totals');
  if (error || !data) return totalesPorTandas(db);

  const d = data as Record<string, number | string | null>;
  return {
    jugadores: Number(d.jugadores ?? 0),
    partidas: Number(d.partidas ?? 0),
    premios: redondear(Number(d.premios ?? 0)),
    saldo_billeteras: redondear(Number(d.saldo_billeteras ?? 0)),
    tickets_sin_jugar: Number(d.tickets_sin_jugar ?? 0),
  };
}
