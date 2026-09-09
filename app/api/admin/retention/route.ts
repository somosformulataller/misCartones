import { NextResponse } from 'next/server';
import { createAdminClient, isAdminClientConfigured } from '@/lib/supabase/admin';
import { requireStaff } from '@/lib/admin/guard';
import { fetchAllRows } from '@/lib/admin/fetchAll';
import { computeRetention, GameRow, MoneyRow, PlayerRow } from '@/lib/admin/retention';

// Métrica histórica de recurrencia (área 'metricas' del panel).
// Sin filtros de período: mira TODA la historia de la app.
//
// Las cuatro consultas van paginadas: PostgREST corta en 1000 filas
// por petición y game_history ya pasa de eso, así que un `.limit()`
// grande devolvería un recuento corto sin avisar (ver fetchAll.ts).
export async function GET() {
  try {
    const { error } = await requireStaff('metricas');
    if (error) return error;

    if (!isAdminClientConfigured()) {
      return NextResponse.json(
        { error: 'Falta SUPABASE_SECRET_KEY en el servidor' },
        { status: 503 }
      );
    }
    const db = createAdminClient();

    const [games, players, purchases, withdrawals] = await Promise.all([
      fetchAllRows<GameRow>((from, to) =>
        db
          .from('game_history')
          .select('player_id, payout, created_at')
          .order('created_at', { ascending: true })
          .range(from, to)
      ),
      fetchAllRows<PlayerRow>((from, to) =>
        db
          .from('players')
          .select('id, username, role, balance, tickets')
          .order('created_at', { ascending: true })
          .range(from, to)
      ),
      fetchAllRows<MoneyRow>((from, to) =>
        db
          .from('ticket_purchases')
          .select('player_id, amount_usd')
          .eq('status', 'aprobado')
          .order('created_at', { ascending: true })
          .range(from, to)
      ),
      fetchAllRows<MoneyRow>((from, to) =>
        db
          .from('withdrawals')
          .select('player_id, amount_usd')
          .eq('status', 'pagado')
          .order('created_at', { ascending: true })
          .range(from, to)
      ),
    ]);

    return NextResponse.json(computeRetention({ games, players, purchases, withdrawals }));
  } catch {
    return NextResponse.json({ error: 'Error del servidor' }, { status: 500 });
  }
}
