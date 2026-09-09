// Programa de afiliados (referidos).
//
// OJO: estos valores son los que se MUESTRAN en pantalla. Los que
// mandan de verdad están dentro del RPC `claim_referral` (migración 004),
// porque el cliente puede llamar los RPC directo y no se le puede dejar
// decidir cuánto cobra. Si cambias uno, cambia el otro.

/** Lo máximo que gana quien invita por cada referido (los 3 tramos) */
export const REFERRAL_REWARD_USD = 3;

/** Partidas del referido para completar el premio entero ($3) */
export const REFERRAL_GAMES_REQUIRED = 30;

/** Se abona por cada tramo cumplido */
export const REFERRAL_TRAMO_USD = 1;

/** Cada cuántas partidas del referido se libera un tramo de $1 */
export const REFERRAL_TRAMO_GAMES = 10;

/** A cuánto da derecho lo que ya jugó el referido (0, 1, 2 o 3 dólares).
 *  $1 por cada bloque de 10 partidas, con tope en REFERRAL_REWARD_USD. */
export function montoGanadoReferido(partidas: number): number {
  const tramos = Math.floor(Math.max(0, partidas) / REFERRAL_TRAMO_GAMES);
  return Math.min(REFERRAL_REWARD_USD, tramos * REFERRAL_TRAMO_USD);
}

/** El link que comparte el jugador */
export function referralLink(codigo: string, origin?: string): string {
  const base = origin || 'https://mis-cartones-6jbq.vercel.app';
  return `${base}/auth/login?ref=${codigo}`;
}
