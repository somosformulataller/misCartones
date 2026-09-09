import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient, isAdminClientConfigured } from '@/lib/supabase/admin';
import { drawSessionTier, drawWorldSeed } from '@/lib/game/rng';
import { TOTAL_BAGS } from '@/lib/game/constants';

/**
 * Inicia una partida consumiendo 1 ticket.
 *
 * Aquí se SELLA el destino de la partida con el RNG del servidor. A partir de
 * este momento el premio está decidido y nada de lo que haga el jugador lo
 * cambia: recoger las bolsas solo desencadena la narrativa y va cobrando el
 * reparto. El cliente NUNCA recibe `target_payout`.
 */
export async function POST() {
  try {
    const supabase = await createClient();

    // Sin base de datos no se puede cobrar el ticket ni sellar el premio, así
    // que no se juega: el cliente recibe este código y lo dice en pantalla.
    if (!supabase || !isAdminClientConfigured()) {
      return NextResponse.json(
        {
          error: 'El juego todavía no está conectado a Supabase.',
          code: 'SIN_CONFIGURAR',
        },
        { status: 503 }
      );
    }

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      // Con `code` y no solo con el 401: quien llama necesita distinguir
      // "tu sesión caducó, vuelve a entrar" de "en esta app todavía no hay
      // manera de entrar". Son la misma respuesta HTTP y piden cosas
      // distintas al jugador.
      return NextResponse.json(
        { error: 'No has iniciado sesión.', code: 'SIN_SESION' },
        { status: 401 }
      );
    }

    const { data: player, error: playerError } = await supabase
      .from('players')
      .select('id, tickets, role, blocked')
      .eq('id', user.id)
      .single();

    if (playerError || !player) {
      return NextResponse.json({ error: 'Jugador no encontrado' }, { status: 404 });
    }

    // El administrador NO juega: evita mezclar la banca con el juego.
    if (player.role === 'admin') {
      return NextResponse.json(
        { error: 'La cuenta de administrador no puede jugar.' },
        { status: 403 }
      );
    }

    if (player.blocked) {
      return NextResponse.json(
        { error: 'Tu cuenta está suspendida.', blocked: true },
        { status: 403 }
      );
    }

    // ¿Ya hay una partida activa? Se reanuda con su estado COMPLETO y no se
    // cobra otro ticket.
    const { data: existing } = await supabase
      .from('game_runs')
      .select('id, world_seed, bags_deposited')
      .eq('player_id', user.id)
      .eq('game_status', 'ACTIVE')
      .maybeSingle();

    if (existing) {
      const entregadas: number[] = existing.bags_deposited ?? [];
      return NextResponse.json(
        {
          error: 'Ya tienes una partida activa',
          session_id: existing.id,
          world_seed: Number(existing.world_seed),
          bags_deposited: entregadas,
          bags_remaining: TOTAL_BAGS - entregadas.length,
        },
        { status: 409 }
      );
    }

    if ((player.tickets ?? 0) < 1) {
      return NextResponse.json(
        { error: 'No tienes tickets. Compra tickets para jugar.', code: 'NO_TICKETS' },
        { status: 400 }
      );
    }

    const admin = createAdminClient();

    // Corta-rachas: NUNCA 3 consolaciones seguidas. La regla vive en
    // `drawSessionTier` (lib/game/rng.ts) y NO es cosmética: la tabla sola
    // paga 96,59 % y son estos resorteos los que la suben al 98,03 % de
    // producción. Aquí solo se le entregan los dos últimos premios.
    const { data: last2 } = await admin
      .from('game_history')
      .select('payout')
      .eq('player_id', user.id)
      .order('created_at', { ascending: false })
      .limit(2);

    const tier = drawSessionTier((last2 ?? []).map((g) => Number(g.payout)));

    const worldSeed = drawWorldSeed();

    const { data: run, error: runError } = await admin
      .from('game_runs')
      .insert({
        player_id: user.id,
        target_payout: tier.payout,
        world_seed: worldSeed,
        bags_deposited: [],
        game_status: 'ACTIVE',
      })
      .select('id')
      .single();

    if (runError || !run) {
      console.error('game_runs insert error:', runError);
      return NextResponse.json({ error: 'Error al crear la partida' }, { status: 500 });
    }

    // Consumir el ticket (RPC atómico; suma total_wagered).
    const { data: remaining, error: spendError } = await admin.rpc('spend_ticket', {
      p_player: user.id,
    });

    if (spendError) {
      // Rollback: borrar la partida creada.
      await admin.from('game_runs').delete().eq('id', run.id);
      if (spendError.message?.includes('SIN_TICKETS')) {
        return NextResponse.json(
          { error: 'No tienes tickets. Compra tickets para jugar.', code: 'NO_TICKETS' },
          { status: 400 }
        );
      }
      return NextResponse.json({ error: 'Error al usar el ticket' }, { status: 500 });
    }

    await admin.from('app_events').insert({ player_id: user.id, event_type: 'game_start' });

    return NextResponse.json({
      session_id: run.id,
      world_seed: worldSeed,
      bags_remaining: TOTAL_BAGS,
      tickets: Number(remaining),
    });
  } catch (err) {
    console.error('buy-ticket error:', err);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}
