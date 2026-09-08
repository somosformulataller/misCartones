import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient, isAdminClientConfigured } from '@/lib/supabase/admin';
import { bagSplit } from '@/lib/game/bagSplit';
import { MIN_MS_BETWEEN_DEPOSITS, TOTAL_BAGS } from '@/lib/game/constants';
import { buildWorld } from '@/lib/game/world';

interface Body {
  session_id: string;
  bag_id: number;
}

/**
 * Vaciar una bolsa en la carretilla. ES EL ÚNICO ENDPOINT QUE PAGA.
 *
 * Agarrar la bolsa es puramente visual y no toca el servidor: lo que se cobra
 * es la ENTREGA. El destino de la partida ya quedó sellado al comprar el
 * ticket, así que aquí solo se decide cuánto de ese premio suelta esta bolsa.
 *
 * ── El reclamo atómico ──
 * Es lo más importante de todo el archivo. El UPDATE solo toca la fila si
 * sigue ACTIVA y las bolsas entregadas son EXACTAMENTE las que leímos. Si otra
 * petición idéntica llegó primero, el array ya cambió, el UPDATE no toca nada
 * y esta petición NO acredita.
 *
 * Sin esto, veinte peticiones con la misma bolsa leerían todas la partida como
 * ACTIVA, todas la "completarían" y todas acreditarían el premio. En el juego
 * hermano pasó de verdad: el 19/08/2026 un jugador cobró una partida de $2,50
 * veinte veces ($50) y con tres partidas así retiró $44,75 metiendo $2.
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    if (!supabase || !isAdminClientConfigured()) {
      return NextResponse.json(
        { error: 'El juego todavía no está conectado a Supabase.', code: 'SIN_CONFIGURAR' },
        { status: 503 }
      );
    }

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const body = (await req.json()) as Body;
    const { session_id, bag_id } = body;

    if (!session_id || bag_id === undefined || bag_id < 0 || bag_id >= TOTAL_BAGS) {
      return NextResponse.json({ error: 'Parámetros inválidos' }, { status: 400 });
    }

    const { data: run, error: runError } = await supabase
      .from('game_runs')
      .select('*')
      .eq('id', session_id)
      .eq('player_id', user.id)
      .eq('game_status', 'ACTIVE')
      .single();

    if (runError || !run) {
      return NextResponse.json(
        { error: 'Partida no encontrada o ya completada' },
        { status: 404 }
      );
    }

    const entregadas: number[] = run.bags_deposited ?? [];
    if (entregadas.includes(bag_id)) {
      return NextResponse.json({ error: 'Esa bolsa ya la entregaste' }, { status: 400 });
    }

    // La bolsa tiene que EXISTIR en el escenario que generó la semilla del
    // servidor. El cliente no puede inventarse una.
    const world = buildWorld(Number(run.world_seed));
    if (!world.bags.some((b) => b.id === bag_id)) {
      return NextResponse.json({ error: 'Esa bolsa no existe' }, { status: 400 });
    }

    // Guarda de ritmo: el viaje más corto físicamente posible. Un cliente con
    // guion no gana dinero (el premio ya está sellado), pero sí puede
    // martillar la API.
    const desde = run.last_bag_at ?? run.created_at;
    const transcurrido = Date.now() - Date.parse(desde);
    if (transcurrido < MIN_MS_BETWEEN_DEPOSITS) {
      return NextResponse.json(
        { error: 'Vas demasiado rápido', code: 'MUY_RAPIDO' },
        { status: 429 }
      );
    }

    const admin = createAdminClient();
    const actualizadas = [...entregadas, bag_id];
    const finished = actualizadas.length >= TOTAL_BAGS;

    // Reparto determinista por partida: no se guarda en la base de datos, se
    // recalcula igual en cada entrega. Indexado por ORDEN DE ENTREGA, no por
    // bag_id: el jugador elige la ruta, el servidor elige los montos.
    const targetPayout = Number(run.target_payout);
    const reparto = bagSplit(targetPayout, session_id);
    const monto = reparto[entregadas.length] ?? 0;
    const acreditado = Math.round((Number(run.credited) + monto) * 100) / 100;

    // Literal de array de Postgres con el estado LEÍDO: es el cerrojo.
    const entregadasLiteral = `{${entregadas.join(',')}}`;

    const { data: reclamada } = await admin
      .from('game_runs')
      .update({
        bags_deposited: actualizadas,
        credited: acreditado,
        last_bag_at: new Date().toISOString(),
        ...(finished
          ? { game_status: 'COMPLETED', completed_at: new Date().toISOString() }
          : {}),
      })
      .eq('id', session_id)
      .eq('player_id', user.id)
      .eq('game_status', 'ACTIVE')
      .eq('bags_deposited', entregadasLiteral)
      .select('id');

    // Otra petición ganó la carrera: esta se va SIN pagar.
    if (!reclamada || reclamada.length === 0) {
      return NextResponse.json(
        { error: 'Entrega repetida', race: true },
        { status: 409 }
      );
    }

    if (monto > 0) {
      const { error: prizeError } = await admin.rpc('credit_prize', {
        p_player: user.id,
        p_payout: monto,
      });
      if (prizeError) console.error('credit_prize error:', prizeError);
    }

    if (finished) {
      await admin.from('game_history').insert({
        player_id: user.id,
        run_id: session_id,
        payout: targetPayout,
        bags_count: actualizadas.length,
      });
      await admin.from('app_events').insert({ player_id: user.id, event_type: 'game_win' });
    }

    return NextResponse.json({
      monto,
      bags_remaining: TOTAL_BAGS - actualizadas.length,
      total_credited: acreditado,
      finished,
      ...(finished ? { payout: targetPayout } : {}),
    });
  } catch (err) {
    console.error('deposit-bag error:', err);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}
