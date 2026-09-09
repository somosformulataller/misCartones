import { diaCaracas } from '@/lib/payments/constants';

// ── Límite de retiros diarios por jugador ──
// Cuantas más partidas juega hoy, más retiros puede pedir en el día:
//   · hasta 30 partidas  → 1 retiro
//   · 31 a 50 partidas   → 2 retiros
//   · más de 50          → 3 retiros (tope diario)
// "Hoy" es el día en hora de Caracas: se reinicia cada medianoche local.
// El servidor cuenta las partidas de game_history y los retiros
// (pendiente/pagado) del día; los rechazados no cuentan (liberan cupo).

export interface RetiroNivel {
  nivel: 1 | 2 | 3;
  /** Texto del escalón en la barra (pedido por el equipo) */
  partidasLabel: string;
  /** Retiros que desbloquea */
  retiros: number;
}

export const RETIRO_NIVELES: RetiroNivel[] = [
  { nivel: 1, partidasLabel: 'menos de 30 partidas', retiros: 1 },
  { nivel: 2, partidasLabel: '31-50 partidas', retiros: 2 },
  { nivel: 3, partidasLabel: 'más de 50 partidas', retiros: 3 },
];

export const MAX_RETIROS_DIA = 3;

/** Retiros permitidos hoy según las partidas jugadas hoy. Coincide con
 *  el número de nivel alcanzado (1, 2 o 3). */
export function retirosPermitidos(partidas: number): number {
  if (partidas > 50) return 3;
  if (partidas >= 31) return 2;
  return 1;
}

/** Instante UTC de la medianoche de Caracas (inicio del día local). El
 *  reinicio diario del límite cuelga de aquí. Caracas es UTC-4 fijo. */
export function inicioDiaCaracasISO(ahora: Date = new Date()): string {
  return new Date(`${diaCaracas(ahora)}T00:00:00-04:00`).toISOString();
}
