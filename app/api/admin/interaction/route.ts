import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, isAdminClientConfigured } from '@/lib/supabase/admin';
import { requireStaff } from '@/lib/admin/guard';
import { fetchAllRows } from '@/lib/admin/fetchAll';
import {
  caracasDayBoundsIso,
  caracasDayStartIso,
  loadAudience,
  loadDayAudience,
  loadPresence,
} from '@/lib/admin/audience';

interface InteractionPlayer {
  id: string;
  username: string | null;
  balance: number;
  games: number;
  created_at?: string;
}

// ── Caché en memoria del RPC pesado ──
// `get_interaction_stats()` reagrega app_events y game_history enteras
// en cada llamada (~128ms) y el panel la pide muy seguido. El resultado
// es el mismo para todos los admins, así que se guarda unos segundos y
// se reutiliza: se recalcula como mucho una vez cada CACHE_TTL_MS.
// NO toca la base — no borra, no escribe: solo evita repetir el cálculo.
// La memoria es por instancia del servidor; en el peor caso cada
// instancia recalcula una vez por ventana. El acceso sigue protegido
// por requireStaff() en cada request, antes de usar estos datos.
const CACHE_TTL_MS = 45_000;
let statsCache: { at: number; data: InteractionPlayer[] } | null = null;

async function getInteractionStatsCached(
  db: ReturnType<typeof createAdminClient>
): Promise<{ data: InteractionPlayer[] | null; error: unknown }> {
  const now = Date.now();
  if (statsCache && now - statsCache.at < CACHE_TTL_MS) {
    return { data: statsCache.data, error: null };
  }
  const { data, error } = await db.rpc('get_interaction_stats');
  if (!error) {
    statsCache = { at: now, data: (data ?? []) as InteractionPlayer[] };
    return { data: statsCache.data, error: null };
  }
  // Si el RPC falla pero hay un cálculo previo (aunque esté vencido),
  // se sirve ese en vez de romper el panel — resiliencia ante caídas.
  if (statsCache) return { data: statsCache.data, error: null };
  return { data: null, error };
}

// Interacción de los jugadores (staff con área 'interacciones'):
// sesiones, partidas, última actividad + un resumen con tops
// (saldo, jugadas, recargas, retiros), contadores globales y
// audiencia (registrados/activos). Con ?range=hoy|7d|30d los tops y
// contadores se limitan a ese período (día de Venezuela); sin range
// cubren desde el inicio. «Más saldo» siempre es el saldo actual.
// Con ?player=<id> devuelve además los últimos eventos de ese
// jugador (su flujo en la app).
export async function GET(req: NextRequest) {
  try {
    const { error } = await requireStaff('interacciones');
    if (error) return error;

    if (!isAdminClientConfigured()) {
      return NextResponse.json(
        { error: 'Falta SUPABASE_SECRET_KEY en el servidor' },
        { status: 503 }
      );
    }
    const db = createAdminClient();

    const { data, error: rpcError } = await getInteractionStatsCached(db);
    if (rpcError) {
      return NextResponse.json({ error: 'No se pudo cargar la interacción' }, { status: 500 });
    }

    const playerId = req.nextUrl.searchParams.get('player');
    let events = null;
    if (playerId) {
      const { data: rows } = await db
        .from('app_events')
        .select('id, player_id, event_type, path, created_at')
        .eq('player_id', playerId)
        .order('created_at', { ascending: false })
        .limit(50);
      events = rows ?? [];
    }

    // ── Resumen: tops y contadores ──
    const players = (data ?? []) as InteractionPlayer[];
    const nameOf = new Map(players.map((p) => [p.id, p.username]));
    let summary = null;
    // Detalle por jugador: con un período elegido, solo quienes
    // estuvieron activos en él — jugaron o recargaron — o se
    // registraron en él (sin período se listan todos)
    let visiblePlayers = players;
    let presence = null;

    {
      // Período elegido: un día del calendario (?date=YYYY-MM-DD, que
      // manda sobre el rango) o hoy / últimos 7 días / 30 días / todo
      const dateParam = req.nextUrl.searchParams.get('date');
      const dayBounds = dateParam ? caracasDayBoundsIso(dateParam) : null;
      const range = req.nextUrl.searchParams.get('range');
      const sinceIso = dayBounds
        ? dayBounds.from
        : range === 'hoy'
        ? caracasDayStartIso(0)
        : range === '7d'
        ? caracasDayStartIso(6)
        : range === '30d'
        ? caracasDayStartIso(29)
        : null;
      const untilIso = dayBounds?.to ?? null;

      // Las listas van paginadas: PostgREST devuelve como mucho 1000
      // filas por petición, así que sin paginar los contadores del
      // período salían cortos en silencio (ver lib/admin/fetchAll.ts).
      const purchasesQ = fetchAllRows<{ player_id: string; origin: string | null }>((from, to) => {
        let q = db
          .from('ticket_purchases')
          .select('player_id, origin')
          .eq('status', 'aprobado')
          .order('created_at', { ascending: true })
          .range(from, to);
        if (sinceIso) q = q.gte('created_at', sinceIso);
        if (untilIso) q = q.lt('created_at', untilIso);
        return q;
      });
      const withdrawalsQ = fetchAllRows<{ player_id: string }>((from, to) => {
        let q = db
          .from('withdrawals')
          .select('player_id')
          .eq('status', 'pagado')
          .order('created_at', { ascending: true })
          .range(from, to);
        if (sinceIso) q = q.gte('created_at', sinceIso);
        if (untilIso) q = q.lt('created_at', untilIso);
        return q;
      });
      // Partidas del período (solo hace falta con filtro: sin él,
      // los totales del RPC ya lo cubren)
      const gamesQ = sinceIso
        ? fetchAllRows<{ player_id: string }>((from, to) => {
            let q = db
              .from('game_history')
              .select('player_id')
              .gte('created_at', sinceIso)
              .order('created_at', { ascending: true })
              .range(from, to);
            if (untilIso) q = q.lt('created_at', untilIso);
            return q;
          })
        : null;
      const [purchaseRows, withdrawalRows, gameRows, audience, dayAudience, presenceData] =
        await Promise.all([
          purchasesQ,
          withdrawalsQ,
          gamesQ ?? Promise.resolve(null),
          loadAudience(db),
          dateParam ? loadDayAudience(db, dateParam) : Promise.resolve(null),
          loadPresence(db),
        ]);
      presence = presenceData;

      const countBy = (rows: { player_id: string }[]) => {
        const m = new Map<string, number>();
        for (const r of rows) m.set(r.player_id, (m.get(r.player_id) ?? 0) + 1);
        return m;
      };
      const top = (m: Map<string, number>) =>
        [...m.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([id, value]) => ({
            id,
            username: nameOf.get(id) ?? id.slice(0, 8),
            value,
          }));

      const gamesByPlayer = gameRows ? countBy(gameRows) : null;

      summary = {
        top_balance: [...players]
          .filter((p) => Number(p.balance) > 0)
          .sort((a, b) => Number(b.balance) - Number(a.balance))
          .slice(0, 5)
          .map((p) => ({ id: p.id, username: p.username, value: Number(p.balance) })),
        top_games: gamesByPlayer
          ? top(gamesByPlayer)
          : [...players]
              .filter((p) => p.games > 0)
              .sort((a, b) => b.games - a.games)
              .slice(0, 5)
              .map((p) => ({ id: p.id, username: p.username, value: p.games })),
        top_purchases: top(countBy(purchaseRows)),
        top_withdrawals: top(countBy(withdrawalRows)),
        total_games: gameRows ? gameRows.length : players.reduce((s, p) => s + p.games, 0),
        players_played: gamesByPlayer
          ? gamesByPlayer.size
          : players.filter((p) => p.games > 0).length,
        manual_recharges: purchaseRows.filter((r) => r.origin === 'manual').length,
        auto_recharges: purchaseRows.filter((r) => r.origin === 'auto').length,
        audience,
        day_audience: dayAudience,
      };

      if (sinceIso) {
        // Activo = jugó o recargó en el período (navegar no cuenta)
        const activeIds = new Set<string>();
        for (const r of gameRows ?? []) activeIds.add(r.player_id);
        for (const r of purchaseRows) activeIds.add(r.player_id);
        // Interactuó en el período O se registró en él (para que el
        // filtro "Registrados" del panel los muestre aunque no hayan
        // hecho nada más ese día)
        const sinceMs = Date.parse(sinceIso);
        const untilMs = untilIso ? Date.parse(untilIso) : Infinity;
        visiblePlayers = players.filter((p) => {
          if (activeIds.has(p.id)) return true;
          const t = p.created_at ? Date.parse(p.created_at) : NaN;
          return Number.isFinite(t) && t >= sinceMs && t < untilMs;
        });
      }
    }

    return NextResponse.json({ players: visiblePlayers, events, summary, presence });
  } catch {
    return NextResponse.json({ error: 'Error del servidor' }, { status: 500 });
  }
}
