import { createAdminClient } from '@/lib/supabase/admin';

/**
 * ¿Se le cobró al jugador lo que faltó en sus pagos cortos?
 *
 * El equipo compensa: si alguien paga Bs. 773 por un ticket de Bs.
 * 1.546, se le aprueba la compra y se le descuenta el dólar que falta
 * de su saldo de premios. Son dos pasos sueltos, y el segundo se puede
 * olvidar — en el juego hermano pasó, y no se notó hasta que alguien
 * cuadró la cuenta a mano.
 *
 * Esto lo deduce solo, sin que nadie tenga que apretar nada: compara
 * lo que faltó en el banco con el saldo que no tiene explicación en el
 * juego. La aritmética es la misma que se haría a mano:
 *
 *     lo que ganó + lo que ganó invitando − lo retirado − lo canjeado
 *       − lo que tiene hoy
 *
 * Si ese hueco cubre lo que dejó de pagar, ya se le cobró.
 *
 * No depende de que alguien anotara la compensación: depende de que el
 * dinero no esté. Por eso funciona también hacia atrás, con las que se
 * hicieran antes de que existiera la bitácora.
 */

/** Menos de esto no se persigue: son redondeos de la tasa del día. */
const TOLERANCIA = 0.05;

export interface CompraCorta {
  id: string;
  reference: string | null;
  created_at: string;
  /** Dólares que faltaron en el banco */
  falta: number;
  /** Si el hueco del saldo alcanza a cubrirla (las más viejas primero) */
  cobrado: boolean;
}

export interface Compensacion {
  /** Total que se dejó de cobrar en el banco */
  faltante: number;
  /** Saldo que salió sin explicación en el juego = lo que se le cobró */
  descontado: number;
  /** Lo que aún NO se le ha cobrado */
  pendiente: number;
  cortas: CompraCorta[];
  /** Descuentos de saldo anotados en la bitácora */
  ajustes: number;
}

interface FilaCompra {
  id: string;
  reference: string | null;
  amount_ves: number | string | null;
  exchange_rate_used: number | string | null;
  bank_response: unknown;
  created_at: string;
}

/** Lo que el banco dice que entró por esa compra, en bolívares. */
function montoDelBanco(bank: unknown): number | null {
  if (!bank || typeof bank !== 'object') return null;
  const b = bank as Record<string, unknown>;
  // El movimiento puede venir suelto o envuelto, según quién lo guardó
  const mov = (b.movimiento ?? b.mov ?? b) as Record<string, unknown>;
  const n = Number(mov?.monto ?? mov?.amount);
  return Number.isFinite(n) ? n : null;
}

export async function revisarCompensacion(
  admin: ReturnType<typeof createAdminClient>,
  playerId: string
): Promise<Compensacion | null> {
  const [compras, jugador, juegos, canjes, retiros, ajustes, referidos] = await Promise.all([
    admin
      .from('ticket_purchases')
      .select('id, reference, amount_ves, exchange_rate_used, bank_response, created_at')
      .eq('player_id', playerId)
      .eq('status', 'aprobado')
      .order('created_at', { ascending: true })
      .limit(500),
    admin.from('players').select('balance').eq('id', playerId).maybeSingle(),
    admin.from('game_history').select('payout, run_id').eq('player_id', playerId).limit(5000),
    admin.from('ticket_redemptions').select('amount_usd').eq('player_id', playerId).limit(2000),
    admin.from('withdrawals').select('amount_usd, status').eq('player_id', playerId).limit(500),
    admin
      .from('manual_adjustments')
      .select('delta, tipo')
      .eq('player_id', playerId)
      .eq('tipo', 'saldo')
      .limit(200),
    // Premios de referido: en este juego SIEMPRE entran al saldo.
    admin
      .from('referral_claims')
      .select('amount_usd')
      .eq('referrer_id', playerId)
      .limit(500),
  ]);

  if (!jugador.data) return null;

  // ── 1. Lo que faltó en el banco, compra por compra ──
  const cortas: CompraCorta[] = [];
  for (const c of (compras.data ?? []) as FilaCompra[]) {
    const pagado = montoDelBanco(c.bank_response);
    const esperado = Number(c.amount_ves);
    const tasa = Number(c.exchange_rate_used);
    if (pagado === null || !Number.isFinite(esperado) || !tasa) continue;
    const falta = (esperado - pagado) / tasa;
    if (falta > TOLERANCIA) {
      cortas.push({
        id: c.id,
        reference: c.reference,
        created_at: c.created_at,
        falta: Math.round(falta * 100) / 100,
        cobrado: false,
      });
    }
  }
  const faltante = Math.round(cortas.reduce((a, c) => a + c.falta, 0) * 100) / 100;

  // ── 2. El saldo que no tiene explicación en el juego ──
  // El premio se cuenta UNA vez por partida. La base ya lo garantiza
  // (game_history_run_unico), pero contar por run_id de todos modos
  // hace que un historial duplicado no invente un hueco que no existe.
  const vistas = new Set<string>();
  let premios = 0;
  for (const j of juegos.data ?? []) {
    const r = String((j as { run_id: string }).run_id);
    if (vistas.has(r)) continue;
    vistas.add(r);
    premios += Number((j as { payout: number }).payout);
  }
  const canjeado = (canjes.data ?? []).reduce(
    (a, r) => a + Number((r as { amount_usd: number }).amount_usd),
    0
  );
  const retirado = (retiros.data ?? [])
    .filter((r) => (r as { status: string }).status !== 'cancelado')
    .reduce((a, r) => a + Number((r as { amount_usd: number }).amount_usd), 0);
  // Los dólares por referido entran al saldo sin ser premio de una
  // partida: si no se suman aquí, ese dinero parece salido de la nada
  // y el cuadre daría por cobrado lo que no lo está.
  const porReferidos = (referidos.data ?? []).reduce(
    (a, r) => a + Number((r as { amount_usd: number }).amount_usd),
    0
  );
  const saldo = Number(jugador.data.balance ?? 0);
  const descontado =
    Math.round((premios + porReferidos - retirado - canjeado - saldo) * 100) / 100;

  // ── 3. Repartir lo cobrado entre las compras ──
  // De la más vieja a la más nueva, marcando las que alcanza a cubrir.
  // Si una no cabe se salta y se sigue: así lo que queda señalado como
  // pendiente es lo MENOS que se dejó de cobrar, nunca de más.
  let bolsa = Math.max(0, descontado);
  for (const c of cortas) {
    if (bolsa + TOLERANCIA >= c.falta) {
      c.cobrado = true;
      bolsa = Math.round((bolsa - c.falta) * 100) / 100;
    }
  }
  const pendiente =
    Math.round(cortas.filter((c) => !c.cobrado).reduce((a, c) => a + c.falta, 0) * 100) / 100;

  return {
    faltante,
    descontado,
    pendiente,
    cortas,
    ajustes: (ajustes.data ?? []).filter((a) => Number((a as { delta: number }).delta) < 0).length,
  };
}
