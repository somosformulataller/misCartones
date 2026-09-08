import { PAYOUT_TABLE, TOTAL_WEIGHT, CONSOLATION_MAX } from './constants';
import { PayoutTier } from '@/types/game';

// ============================================================================
// Portado TAL CUAL de La Llave Correcta (lib/game/rng.ts).
// ============================================================================

/**
 * Sorteo uniforme en [0, 1) con RNG CRIPTOGRÁFICO. El destino de cada partida
 * (cuánto paga) se sella con esto; con Math.random() —el PRNG xorshift128+ de
 * V8— un atacante que observe suficientes resultados podría reconstruir el
 * estado del generador y predecir qué compra cae en un premio grande.
 * crypto.getRandomValues no es reconstruible.
 */
function azar(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] / 2 ** 32; // [0, 1)
}

/** Sorteo ponderado siguiendo la matriz de probabilidad del RTP 98 %. */
export function drawPayoutTier(): PayoutTier {
  const roll = azar() * TOTAL_WEIGHT;
  let cumulative = 0;
  for (const tier of PAYOUT_TABLE) {
    cumulative += tier.weight;
    if (roll < cumulative) return tier;
  }
  return PAYOUT_TABLE[0];
}

// Tramos ganadores ($2,10+) para el corta-rachas de buy-ticket: tras 2
// consolaciones seguidas, el siguiente sorteo sale de aquí.
const WIN_TIERS = PAYOUT_TABLE.filter((t) => t.payout > CONSOLATION_MAX);
const WIN_WEIGHT = WIN_TIERS.reduce((s, t) => s + t.weight, 0);

export function drawWinningTier(): PayoutTier {
  const roll = azar() * WIN_WEIGHT;
  let cumulative = 0;
  for (const tier of WIN_TIERS) {
    cumulative += tier.weight;
    if (roll < cumulative) return tier;
  }
  return WIN_TIERS[0];
}

/**
 * EL SORTEO DE PRODUCCIÓN: tabla + corta-rachas. Es lo que llama buy-ticket.
 *
 * ⚠️ El corta-rachas NO es un detalle de experiencia de usuario: es parte de
 * la economía. La tabla por sí sola paga un RTP del 96,59 %. Son los premios
 * que este resorteo convierte los que la suben hasta el 98,03 % de producción.
 * Si se quita, o si `ultimos2` deja de llegar bien, el RTP cae 1,4 puntos y
 * nada avisa: el juego simplemente empieza a pagar menos de lo prometido.
 *
 * Vive aquí, y no dentro de la ruta, justamente para que las pruebas puedan
 * medir el RTP REAL (ver scripts/pruebas.mjs).
 *
 * @param ultimos2 Premios de las 2 partidas anteriores del jugador.
 */
export function drawSessionTier(ultimos2: number[]): PayoutTier {
  const tier = drawPayoutTier();
  const rachaMala =
    ultimos2.length === 2 && ultimos2.every((p) => p <= CONSOLATION_MAX);
  if (tier.payout <= CONSOLATION_MAX && rachaMala) {
    // Nunca 3 consolaciones seguidas.
    return drawWinningTier();
  }
  return tier;
}

/** Semilla del escenario. La emite el SERVIDOR: es lo que impide que el
 *  cliente se invente bolsas de más o las mueva de sitio. */
export function drawWorldSeed(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  // Se guarda como BIGINT en Postgres, pero cabe de sobra en un entero de 32
  // bits sin signo, que es lo que mulberry32 espera.
  return buf[0];
}

/** Simula N partidas y calcula el RTP real. Se usa en las pruebas. */
export function simulateRTP(iterations = 100_000): number {
  let totalIn = 0;
  let totalOut = 0;
  for (let i = 0; i < iterations; i++) {
    totalIn += 2;
    totalOut += drawPayoutTier().payout;
  }
  return totalOut / totalIn;
}
