import { createAdminClient } from '@/lib/supabase/admin';

type Admin = ReturnType<typeof createAdminClient>;

/** Retiro que llama la atención por su monto suelto. El mayor retiro
 *  real visto hasta el 19/08/2026 fue de $20. */
const MONTO_ALTO = 25;
/** Cuántas veces lo cobrado puede pasar a lo depositado antes de avisar.
 *  Un jugador con suerte llega a 3× sin nada raro; más que eso merece
 *  una mirada (no un bloqueo). */
const VECES_LO_DEPOSITADO = 3;
/** Demasiadas solicitudes en un día: patrón de prueba/abuso. */
const RETIROS_POR_DIA = 4;

const LABEL = 'Retiro para revisar';

/**
 * Avisa al equipo cuando un retiro se sale del patrón normal. NO
 * bloquea nada: el retiro sigue su curso y alguien lo mira si quiere.
 *
 * El aviso se deja como etiqueta interna en la ficha del jugador
 * (player_tags), que solo ve el panel — nunca el jugador. Se usa esa
 * vía a propósito: `withdrawals.admin_note` viaja al navegador del
 * jugador, así que no sirve para notas internas.
 *
 * Nunca lanza: un fallo aquí no puede tumbar un retiro legítimo.
 */
export async function avisarSiRetiroRaro(
  admin: Admin,
  playerId: string,
  monto: number
): Promise<void> {
  try {
    const motivos: string[] = [];

    if (monto >= MONTO_ALTO) motivos.push(`monto alto ($${monto.toFixed(2)})`);

    // Lo depositado de verdad (compras aprobadas) contra lo cobrado.
    const [comprasRes, retirosRes] = await Promise.all([
      admin
        .from('ticket_purchases')
        .select('amount_usd')
        .eq('player_id', playerId)
        .eq('status', 'aprobado')
        .limit(2000),
      admin
        .from('withdrawals')
        .select('amount_usd, status, created_at')
        .eq('player_id', playerId)
        .limit(500),
    ]);

    const depositado = (comprasRes.data ?? []).reduce(
      (a, c) => a + (Number(c.amount_usd) || 0),
      0
    );
    const cobrado = (retirosRes.data ?? [])
      .filter((w) => w.status === 'pagado')
      .reduce((a, w) => a + (Number(w.amount_usd) || 0), 0);

    if (depositado > 0 && cobrado + monto > depositado * VECES_LO_DEPOSITADO) {
      motivos.push(
        `cobró $${(cobrado + monto).toFixed(2)} habiendo depositado $${depositado.toFixed(2)}`
      );
    }
    if (depositado === 0) motivos.push('sin ningún depósito aprobado');

    const desde = Date.now() - 86_400_000;
    const ultimoDia = (retirosRes.data ?? []).filter(
      (w) => Date.parse(w.created_at) >= desde
    ).length;
    if (ultimoDia >= RETIROS_POR_DIA) motivos.push(`${ultimoDia} retiros en 24 h`);

    if (!motivos.length) return;

    const hoy = new Date().toLocaleDateString('es-VE', { timeZone: 'America/Caracas' });
    const nota = `${hoy} — Retiro de $${monto.toFixed(2)}: ${motivos.join('; ')}. Aviso automático, NO bloquea el retiro: revisar antes de pagar.`.slice(0, 500);

    // Una sola etiqueta por jugador: si ya existe, se actualiza con el
    // aviso más reciente en vez de llenar la ficha de etiquetas.
    const { data: previa } = await admin
      .from('player_tags')
      .select('id')
      .eq('player_id', playerId)
      .eq('label', LABEL)
      .limit(1);

    if (previa && previa.length) {
      await admin
        .from('player_tags')
        .update({ note: nota, updated_at: new Date().toISOString() })
        .eq('id', previa[0].id);
    } else {
      await admin
        .from('player_tags')
        .insert({ player_id: playerId, label: LABEL, color: 'gold', note: nota });
    }
  } catch {
    /* un aviso perdido no puede tumbar un retiro */
  }
}
