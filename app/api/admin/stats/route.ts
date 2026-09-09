import { NextResponse } from 'next/server';
import { createAdminClient, isAdminClientConfigured } from '@/lib/supabase/admin';
import { requireStaff } from '@/lib/admin/guard';
import { hasArea } from '@/lib/admin/areas';
import { leerTotales } from '@/lib/admin/totals';
import { leerTodo } from '@/lib/admin/tandas';
import { TICKET_COST } from '@/lib/game/constants';

interface FilaCompra {
  amount_usd: number | string | null;
  created_at: string;
  validated_at: string | null;
}
interface FilaRetiro {
  amount_usd: number | string | null;
  status: string;
  created_at: string;
  paid_at: string | null;
}

/** El filtro del Resumen llega como mucho a 30 días; se deja algo de
 *  margen para que el borde del período nunca quede fuera. */
const DIAS_FINANZAS = 32;
const enElUltimoMes = (iso: string | null) =>
  !!iso && Date.now() - Date.parse(iso) < DIAS_FINANZAS * 24 * 60 * 60 * 1000;

// Dashboard del administrador. La identidad se verifica con la
// SESIÓN (staff del panel); las LECTURAS van con la clave del
// servidor: así los totales suman TODOS los jugadores y no dependen
// de que alguna política RLS de lectura esté bien puesta — en el juego
// hermano faltaba una y el resumen entero salía en cero.
//
// Los totales del Resumen los calcula `leerTotales` sobre la base
// ENTERA. No se suman aquí a partir de ninguna consulta con límite:
// ese fue el fallo que el 17/08/2026 hizo que el panel del juego
// hermano enseñara el RTP de los 200 jugadores más nuevos como si
// fuera el de la app.
// El staff restringido recibe solo lo de sus áreas: sin 'resumen' no
// ve las estadísticas; sin 'partidas' no ve las últimas partidas.
export async function GET() {
  try {
    const { staff, error } = await requireStaff(['resumen', 'partidas']);
    if (error) return error;

    const canResumen = hasArea(staff!.role, staff!.panelAreas, 'resumen');
    const canPartidas = hasArea(staff!.role, staff!.panelAreas, 'partidas');

    if (!isAdminClientConfigured()) {
      return NextResponse.json(
        { error: 'Falta SUPABASE_SECRET_KEY en el servidor' },
        { status: 503 }
      );
    }
    const db = createAdminClient();

    // Las compras y los retiros se leen POR TANDAS: en cuanto pasan de
    // 1.000 una consulta normal se corta ahí sin decir nada. Allá eso
    // dejó "Total recargado" sin contar las recargas del día.
    const [totales, activeRes, recentRes, approvedPurchases, withdrawalRows] =
      await Promise.all([
        canResumen ? leerTotales(db) : Promise.resolve(null),
        db
          .from('game_runs')
          .select('id', { count: 'exact', head: true })
          .eq('game_status', 'ACTIVE'),
        canPartidas
          ? db
              .from('game_history')
              .select('id, player_id, payout, bags_count, created_at, players(username)')
              .order('created_at', { ascending: false })
              .limit(20)
          : Promise.resolve({ data: [] }),
        leerTodo<FilaCompra>(db, 'ticket_purchases', 'id, amount_usd, created_at, validated_at', (q) =>
          q.eq('status', 'aprobado')
        ),
        leerTodo<FilaRetiro>(db, 'withdrawals', 'id, amount_usd, status, created_at, paid_at', (q) =>
          q.in('status', ['pendiente', 'pagado'])
        ),
      ]);

    // Apostado = una partida terminada consumió un ticket de $2. Sale
    // del historial de partidas, no de los contadores del jugador:
    // esos se desfasan (partidas empezadas y nunca terminadas, ajustes
    // hechos a mano) y para el RTP no sirven.
    const totalWagered = (totales?.partidas ?? 0) * TICKET_COST;
    const totalPaid = totales?.premios ?? 0;
    const totalCollected = approvedPurchases.reduce((s, r) => s + Number(r.amount_usd ?? 0), 0);
    const paidWithdrawals = withdrawalRows.filter((w) => w.status === 'pagado');
    const totalWithdrawn = paidWithdrawals.reduce((s, w) => s + Number(w.amount_usd ?? 0), 0);
    const pendingWithdrawals = withdrawalRows
      .filter((w) => w.status === 'pendiente')
      .reduce((s, w) => s + Number(w.amount_usd ?? 0), 0);
    const balanceOwed = totales?.saldo_billeteras ?? 0;
    const ticketsCirculating = totales?.tickets_sin_jugar ?? 0;

    const recentGames = (recentRes.data ?? []).map((g) => {
      const { players: playerRel, ...rest } = g as typeof g & {
        players: { username: string | null } | null;
      };
      return { ...rest, username: playerRel?.username ?? null };
    });

    return NextResponse.json({
      stats: canResumen
        ? {
            total_players: totales?.jugadores ?? 0,
            total_tickets: totales?.partidas ?? 0,
            total_wagered: totalWagered,
            total_paid: totalPaid,
            rtp_real: totalWagered > 0 ? totalPaid / totalWagered : null,
            active_sessions: activeRes.count ?? 0,
            // Finanzas reales (dinero, no créditos)
            total_collected: totalCollected,      // compras aprobadas ($)
            total_withdrawn: totalWithdrawn,      // retiros ya pagados ($)
            pending_withdrawals: pendingWithdrawals, // retiros por pagar ($)
            balance_owed: balanceOwed,            // saldo en billeteras ($)
            tickets_circulating: ticketsCirculating, // tickets sin jugar
            house_profit: Math.round((totalWagered - totalPaid) * 100) / 100,
          }
        : null,
      recent_games: recentGames,
      // Movimientos aprobados/pagados para los filtros por período
      // del Resumen (el cliente calcula día / ayer / 7d / 30d)
      // Solo lo del último mes: el filtro del Resumen no ofrece nada
      // más largo que 30 días, y mandarle al navegador la historia
      // entera (más de 1.000 movimientos y subiendo) es peso que nadie
      // mira. Los totales de arriba sí salen de TODO.
      finance: canResumen
        ? {
            purchases: approvedPurchases
              .filter((p) => enElUltimoMes(p.validated_at ?? p.created_at))
              .map((p) => ({
                amount_usd: Number(p.amount_usd ?? 0),
                created_at: p.created_at,
                validated_at: p.validated_at,
              })),
            withdrawals: paidWithdrawals
              .filter((w) => enElUltimoMes(w.paid_at ?? w.created_at))
              .map((w) => ({
                amount_usd: Number(w.amount_usd ?? 0),
                created_at: w.created_at,
                paid_at: w.paid_at,
              })),
          }
        : undefined,
    });
  } catch {
    return NextResponse.json({ error: 'Error del servidor' }, { status: 500 });
  }
}
