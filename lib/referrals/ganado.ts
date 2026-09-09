/**
 * Cuánto ha ganado alguien invitando, separado de lo que gana jugando.
 *
 * El saldo es UN solo número: cuando se cobra un referido, ese dinero entra
 * al mismo bolsillo del que salen los retiros y los canjes. Así que "de tus
 * $8,40 de ahora, $3 son de referidos" es una frase que no se puede
 * sostener — habría que inventar una regla sobre qué dólar se gasta primero,
 * y el número saldría de esa regla, no de los hechos.
 *
 * Lo que sí es un hecho, y es lo que se enseña: cuánto ha ENTRADO por cada
 * vía en toda su historia. Lo de jugar está en total_won; lo de invitar,
 * aquí.
 */

export interface ResumenReferidos {
  /** Todo lo ganado invitando, en toda su historia */
  total: number;
  /** Cuántos amigos distintos le han dado premio */
  cobros: number;
}

interface FilaClaim {
  amount_usd: number | string;
  /** Hay VARIAS filas por referido (una por cada $1), así que se cuentan
   *  amigos distintos, no filas. */
  referred_id?: string | null;
}

export function resumenReferidos(filas: unknown): ResumenReferidos {
  const lista = (Array.isArray(filas) ? filas : []) as FilaClaim[];
  let total = 0;
  const amigos = new Set<string>();
  for (const f of lista) {
    total += Number(f.amount_usd) || 0;
    if (f.referred_id) amigos.add(f.referred_id);
  }
  return {
    total: Math.round(total * 100) / 100,
    cobros: amigos.size,
  };
}
