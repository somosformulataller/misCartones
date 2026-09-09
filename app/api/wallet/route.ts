import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { compraParaJugador } from '@/lib/payments/constants';
import { resumenReferidos } from '@/lib/referrals/ganado';
import { inicioDiaCaracasISO } from '@/lib/wallet/limiteRetiros';

// Billetera del jugador: perfil (saldo + tickets), historial de
// compras y de retiros. Todo con RLS: solo lo propio.
export async function GET() {
  try {
    const supabase = await createClient();
    if (!supabase) {
      return NextResponse.json(
        { error: 'El sistema no está configurado todavía.', code: 'SIN_CONFIGURAR' },
        { status: 503 }
      );
    }
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

    // Inicio del día en Caracas: el límite de retiros diarios cuenta las
    // partidas y los retiros desde esta medianoche local.
    const inicioDia = inicioDiaCaracasISO();

    const [
      playerRes,
      purchasesRes,
      withdrawalsRes,
      referidosRes,
      partidasHoyRes,
      retirosHoyRes,
    ] = await Promise.all([
      supabase.from('players').select('*').eq('id', user.id).single(),
      supabase
        .from('ticket_purchases')
        .select(
          'id, player_id, quantity, amount_usd, amount_ves, exchange_rate_used, reference, status, origin, status_note, created_at, validated_at'
        )
        // Propietario explícito, no solo RLS: si una regresión dejara
        // inactivas las políticas _own_read (ya pasó el 30/07 con las de
        // la 002), esto impide filtrar las compras de todos.
        .eq('player_id', user.id)
        .order('created_at', { ascending: false })
        .limit(25),
      supabase
        .from('withdrawals')
        // Sin `admin_note`: es una nota INTERNA del equipo (avisos de
        // revisión, motivos de una decisión) y viajaba tal cual al
        // navegador del jugador — se veía en la respuesta aunque la
        // pantalla no la pintara. Las compras ya se filtraban
        // (compraParaJugador); los retiros se habían quedado fuera.
        .select('id, player_id, amount_usd, status, reference, created_at, paid_at')
        .eq('player_id', user.id)
        .order('created_at', { ascending: false })
        .limit(15),
      // Premios de referido cobrados: para poder decirle cuánto de lo
      // que ha ganado vino de invitar y cuánto de jugar. La política
      // referral_claims_propios deja leer los suyos.
      supabase
        .from('referral_claims')
        .select('amount_usd, referred_id')
        .eq('referrer_id', user.id)
        .limit(500),
      // Partidas jugadas hoy (game_history, RLS propio): fija el nivel de
      // retiros del día. head:true → solo el conteo, no las filas.
      supabase
        .from('game_history')
        .select('id', { count: 'exact', head: true })
        .eq('player_id', user.id)
        .gte('created_at', inicioDia),
      // Retiros de hoy que ocupan cupo: pendientes o ya pagados. Los
      // rechazados no cuentan (liberan cupo).
      supabase
        .from('withdrawals')
        .select('id', { count: 'exact', head: true })
        .eq('player_id', user.id)
        .in('status', ['pendiente', 'pagado'])
        .gte('created_at', inicioDia),
    ]);

    return NextResponse.json({
      player: playerRes.data ?? null,
      // Las notas internas (montos que no cuadran, avisos para el
      // equipo) no salen de aquí: el jugador solo ve la de duplicado.
      purchases: (purchasesRes.data ?? []).map(compraParaJugador),
      withdrawals: withdrawalsRes.data ?? [],
      referidos: resumenReferidos(referidosRes.data),
      // Datos del límite de retiros diarios (para la barra de niveles)
      partidasHoy: partidasHoyRes.count ?? 0,
      retirosHoy: retirosHoyRes.count ?? 0,
    });
  } catch {
    return NextResponse.json({ error: 'Error del servidor' }, { status: 500 });
  }
}
