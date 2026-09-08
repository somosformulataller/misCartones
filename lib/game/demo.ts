import { drawPayoutTier, drawWorldSeed } from './rng';
import { bagSplit } from './bagSplit';
import { TOTAL_BAGS } from './constants';
import type { ResultadoEntrega } from '@/lib/three/game';

/**
 * Partida LOCAL para cuando todavía no hay Supabase conectado.
 *
 * No es un juego de mentira: usa el MISMO rng y el MISMO bagSplit que el
 * servidor, así que el RTP y el reparto son los de producción. Lo único que
 * falta es el dinero real y el reclamo atómico — que por definición necesitan
 * base de datos.
 *
 * Existe para que se pueda trabajar el juego entero (la Fase 1 y la Fase 3,
 * que son las que deciden si esto se siente bien) sin montar nada más.
 */
export function createDemoRun() {
  const tier = drawPayoutTier();
  const sessionId =
    typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `demo-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  const seed = drawWorldSeed();
  const reparto = bagSplit(tier.payout, sessionId);
  let entregadas = 0;

  return {
    sessionId,
    seed,
    payout: tier.payout,
    async deposit(): Promise<ResultadoEntrega> {
      const monto = reparto[entregadas] ?? 0;
      entregadas++;
      return { monto, finished: entregadas >= TOTAL_BAGS };
    },
  };
}
