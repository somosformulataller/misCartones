import { PayoutTier } from '@/types/game';

// ============================================================================
// Economía. Portada TAL CUAL de La Llave Correcta (lib/game/constants.ts).
// La tabla de premios NO se toca: está calibrada por simulación sobre 20M de
// partidas para dar un RTP efectivo de 98,03 % con el corta-rachas activo.
// Lo único que cambia respecto al juego de las llaves es el nombre del
// dominio: 5 llaves → 5 bolsas de basura.
// ============================================================================

export const TICKET_COST = 2;

/** Bolsas por partida. Cada una lleva una parte del premio (ver bagSplit). */
export const TOTAL_BAGS = 5;

// Distribución "SIEMPRE gana": no existen bolsas malas. Las 5 bolsas que el
// jugador lleva a la carretilla reparten entre sí el premio de la partida,
// que se sorteó al comprar el ticket. Los pesos están calibrados para que,
// con el corta-rachas de buy-ticket, el RTP global quede en 98,03 %:
// consolación efectiva 25,5 %, bloque $2,10–$3,00 en el 68,6 % de las
// partidas, y MÁS del ticket ($2) en el 74,5 %. Los gordos son muy raros:
// $10 ≈ 1/1.100 partidas; $15, $20 y $30 ≈ 1/2.250 cada uno.
export const PAYOUT_TABLE: PayoutTier[] = [
  { payout: 0.5, weight: 610 },
  { payout: 2.1, weight: 800 },
  { payout: 2.3, weight: 360 },
  { payout: 2.5, weight: 170 },
  { payout: 2.7, weight: 90 },
  { payout: 2.9, weight: 55 },
  { payout: 3, weight: 45 },
  { payout: 3.1, weight: 30 },
  { payout: 3.3, weight: 22 },
  { payout: 3.5, weight: 16 },
  { payout: 3.8, weight: 12 },
  { payout: 4, weight: 10 },
  { payout: 4.3, weight: 8 },
  { payout: 4.8, weight: 7 },
  { payout: 5, weight: 6 },
  { payout: 6, weight: 5 },
  { payout: 7, weight: 4 },
  { payout: 8, weight: 3 },
  { payout: 9, weight: 2 },
  { payout: 10, weight: 2 },
  { payout: 15, weight: 1 },
  { payout: 20, weight: 1 },
  { payout: 30, weight: 1 },
];

export const TOTAL_WEIGHT = PAYOUT_TABLE.reduce((sum, t) => sum + t.weight, 0);

/** Consolación: por debajo de esto la partida no cuenta como "ganada" para
 *  el corta-rachas (nunca 3 seguidas). */
export const CONSOLATION_MAX = 0.5;

/** Tiempo mínimo entre dos entregas, en milisegundos. Es el viaje más corto
 *  físicamente posible (agarrar la bolsa más cercana y volver). El servidor
 *  rechaza cualquier cosa más rápida: un cliente con guion no gana dinero,
 *  pero sí puede martillar la API. */
export const MIN_MS_BETWEEN_DEPOSITS = 1200;
