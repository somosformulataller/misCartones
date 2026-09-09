import { createAdminClient } from '@/lib/supabase/admin';
import { fetchAllRows } from '@/lib/admin/fetchAll';
import { AudienceCounts, DayAudience, PresenceIds } from '@/types/game';

// Contadores de audiencia para el panel: usuarios registrados por
// ventana de tiempo y usuarios ACTIVOS. Activo = jugó al menos una
// partida o hizo una recarga aprobada en la ventana (navegar por la
// app NO cuenta). Las ventanas usan el día de Venezuela (UTC-4).

const CARACAS_OFFSET_MS = 4 * 3_600_000;

/** ISO de la medianoche de hace `daysAgo` días en Venezuela */
export function caracasDayStartIso(daysAgo: number): string {
  const shifted = new Date(Date.now() - CARACAS_OFFSET_MS);
  return new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate() - daysAgo) +
      CARACAS_OFFSET_MS
  ).toISOString();
}

/** Límites ISO [desde, hasta) de un día calendario de Venezuela (YYYY-MM-DD) */
export function caracasDayBoundsIso(date: string): { from: string; to: string } | null {
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const fromMs = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) + CARACAS_OFFSET_MS;
  if (!Number.isFinite(fromMs)) return null;
  return {
    from: new Date(fromMs).toISOString(),
    to: new Date(fromMs + 86_400_000).toISOString(),
  };
}

type Db = ReturnType<typeof createAdminClient>;

/** Registrados y activos de UN día concreto (calendario del panel).
 *  Activo del día = jugó al menos una partida o recargó ese día. */
export async function loadDayAudience(db: Db, date: string): Promise<DayAudience | null> {
  try {
    const bounds = caracasDayBoundsIso(date);
    if (!bounds) return null;
    const [regRes, gameRows, rechargeRows] = await Promise.all([
      db
        .from('players')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', bounds.from)
        .lt('created_at', bounds.to),
      fetchAllRows<{ player_id: string }>((from, to) =>
        db
          .from('game_history')
          .select('player_id')
          .gte('created_at', bounds.from)
          .lt('created_at', bounds.to)
          .order('created_at', { ascending: true })
          .range(from, to)
      ),
      fetchAllRows<{ player_id: string }>((from, to) =>
        db
          .from('ticket_purchases')
          .select('player_id')
          .eq('status', 'aprobado')
          .gte('created_at', bounds.from)
          .lt('created_at', bounds.to)
          .order('created_at', { ascending: true })
          .range(from, to)
      ),
    ]);
    const played = new Set<string>();
    const recharged = new Set<string>();
    for (const r of gameRows) played.add(r.player_id);
    for (const r of rechargeRows) recharged.add(r.player_id);
    const active = new Set([...played, ...recharged]);
    return {
      date,
      registered: regRes.count ?? 0,
      active: active.size,
      active_ids: [...active],
      recharged: recharged.size,
      recharged_ids: [...recharged],
      played_ids: [...played],
    };
  } catch {
    return null;
  }
}

/** Estado actual para las etiquetas del panel: quiénes tienen una
 *  partida EN CURSO ahora mismo y quiénes han comprado tickets
 *  (aprobados) alguna vez. */
export async function loadPresence(db: Db): Promise<PresenceIds | null> {
  try {
    const [sessionRows, purchaseRows] = await Promise.all([
      fetchAllRows<{ player_id: string }>((from, to) =>
        db
          .from('game_runs')
          .select('player_id')
          .eq('game_status', 'ACTIVE')
          .order('created_at', { ascending: true })
          .range(from, to)
      ),
      fetchAllRows<{ player_id: string }>((from, to) =>
        db
          .from('ticket_purchases')
          .select('player_id')
          .eq('status', 'aprobado')
          .order('created_at', { ascending: true })
          .range(from, to)
      ),
    ]);
    const playing = new Set<string>();
    const purchased = new Set<string>();
    for (const r of sessionRows) playing.add(r.player_id);
    for (const r of purchaseRows) purchased.add(r.player_id);
    return { playing_ids: [...playing], purchased_ids: [...purchased] };
  } catch {
    return null;
  }
}

export async function loadAudience(db: Db): Promise<AudienceCounts | null> {
  try {
    const hoy = caracasDayStartIso(0);
    const semana = caracasDayStartIso(6);
    const mes = caracasDayStartIso(29);
    const anio = caracasDayStartIso(364);

    const regCount = async (since?: string) => {
      let q = db.from('players').select('id', { count: 'exact', head: true });
      if (since) q = q.gte('created_at', since);
      const { count } = await q;
      return count ?? 0;
    };

    // Las dos listas van paginadas: con más de 1000 partidas en la
    // ventana, una sola petición devolvería un trozo y los "activos"
    // saldrían cortos (PostgREST tope 1000 — ver fetchAll.ts).
    const [rTotal, rHoy, rSemana, rMes, rAnio, gameRows, rechargeRows] = await Promise.all([
      regCount(),
      regCount(hoy),
      regCount(semana),
      regCount(mes),
      regCount(anio),
      fetchAllRows<{ player_id: string; created_at: string }>((from, to) =>
        db
          .from('game_history')
          .select('player_id, created_at')
          .gte('created_at', anio)
          .order('created_at', { ascending: true })
          .range(from, to)
      ),
      fetchAllRows<{ player_id: string; created_at: string }>((from, to) =>
        db
          .from('ticket_purchases')
          .select('player_id, created_at')
          .eq('status', 'aprobado')
          .gte('created_at', anio)
          .order('created_at', { ascending: true })
          .range(from, to)
      ),
    ]);

    // Activo = jugador distinto con al menos una partida o recarga
    // aprobada en la ventana; recargador = con al menos una recarga.
    // Comparación por epoch (los ISO de la BD traen zona).
    const tHoy = Date.parse(hoy);
    const tSemana = Date.parse(semana);
    const tMes = Date.parse(mes);
    const makeSets = () => ({
      hoy: new Set<string>(),
      semana: new Set<string>(),
      mes: new Set<string>(),
      anio: new Set<string>(),
    });
    const sets = makeSets();
    const rechargeSets = makeSets();
    const add = (target: ReturnType<typeof makeSets>, playerId: string, createdAt: string) => {
      const t = Date.parse(createdAt);
      target.anio.add(playerId);
      if (t >= tMes) target.mes.add(playerId);
      if (t >= tSemana) target.semana.add(playerId);
      if (t >= tHoy) target.hoy.add(playerId);
    };
    for (const r of gameRows) add(sets, r.player_id, r.created_at);
    for (const r of rechargeRows) {
      add(sets, r.player_id, r.created_at);
      add(rechargeSets, r.player_id, r.created_at);
    }

    return {
      registered: { hoy: rHoy, semana: rSemana, mes: rMes, anio: rAnio, total: rTotal },
      active: {
        hoy: sets.hoy.size,
        semana: sets.semana.size,
        mes: sets.mes.size,
        anio: sets.anio.size,
      },
      recharged: {
        hoy: rechargeSets.hoy.size,
        semana: rechargeSets.semana.size,
        mes: rechargeSets.mes.size,
        anio: rechargeSets.anio.size,
      },
    };
  } catch {
    return null;
  }
}
