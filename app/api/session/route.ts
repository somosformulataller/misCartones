import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { TOTAL_BAGS } from '@/lib/game/constants';

/** Partida en curso del jugador, para reanudarla si cerró la app a mitad.
 *  Nunca devuelve el premio ni el reparto. */
export async function GET() {
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ run: null });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ run: null });

  const { data: run } = await supabase
    .from('game_runs')
    .select('id, world_seed, bags_deposited, credited')
    .eq('player_id', user.id)
    .eq('game_status', 'ACTIVE')
    .maybeSingle();

  if (!run) return NextResponse.json({ run: null });

  const entregadas: number[] = run.bags_deposited ?? [];
  return NextResponse.json({
    run: {
      session_id: run.id,
      world_seed: Number(run.world_seed),
      bags_deposited: entregadas,
      bags_remaining: TOTAL_BAGS - entregadas.length,
      total_credited: Number(run.credited),
    },
  });
}
