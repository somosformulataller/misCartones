import { TICKET_COST } from '@/lib/game/constants';
import {
  PlayPattern,
  RetentionBucket,
  RetentionPlayer,
  RetentionResponse,
} from '@/types/game';

// Métrica HISTÓRICA de recurrencia: de todos los que jugaron al menos
// una partida, cuántos volvieron 1, 2, 3… días, quiénes juegan
// seguido y quiénes dejan pasar días, y cuánto ha ganado cada uno en
// relación con lo que jugó (su RTP).
//
// Todo el cálculo vive aquí, sin tocar la base ni la red, para poder
// comprobarlo con datos de mentira. Los días son días de VENEZUELA
// (el resto del panel usa el mismo criterio): una partida de las 9 de
// la noche cuenta en su día, no en el siguiente por ser ya UTC.

/** Último tramo de la tabla: "10 o más días" */
export const MAX_BUCKET = 10;
/** Sin volver en estos días (jugando uno solo) = abandonó */
export const ABANDON_AFTER_DAYS = 3;

const caracasFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Caracas',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Día (AAAA-MM-DD) de Venezuela al que pertenece una fecha */
export const dayOf = (fecha: string | number | Date) => caracasFmt.format(new Date(fecha));

/** Días completos entre dos días AAAA-MM-DD (b − a) */
export const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

export interface GameRow {
  player_id: string;
  payout: number | string;
  created_at: string;
}
export interface PlayerRow {
  id: string;
  username: string | null;
  role?: string | null;
  balance?: number | string | null;
  tickets?: number | string | null;
}
export interface MoneyRow {
  player_id: string;
  amount_usd: number | string;
}

export interface RetentionInput {
  games: GameRow[];
  players: PlayerRow[];
  /** Compras APROBADAS (dinero real que metió) */
  purchases: MoneyRow[];
  /** Retiros PAGADOS (dinero real que se llevó) */
  withdrawals: MoneyRow[];
  /** Hoy en Venezuela; se pasa para poder fijarlo en las pruebas */
  today?: string;
}

/** Suma por jugador de una lista de montos */
function sumBy(rows: MoneyRow[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.player_id, (m.get(r.player_id) ?? 0) + Number(r.amount_usd));
  return m;
}

/** Racha de días seguidos más larga y días saltados en total */
function streakOf(days: string[]): { max: number; skipped: number } {
  let max = 1;
  let run = 1;
  let skipped = 0;
  for (let i = 1; i < days.length; i++) {
    const gap = daysBetween(days[i - 1], days[i]);
    if (gap === 1) {
      run++;
      if (run > max) max = run;
    } else {
      skipped += gap - 1;
      run = 1;
    }
  }
  return { max, skipped };
}

export function computeRetention(input: RetentionInput): RetentionResponse {
  const today = input.today ?? dayOf(Date.now());
  const recharged = sumBy(input.purchases);
  const withdrawn = sumBy(input.withdrawals);

  // El equipo (admin y atención al cliente) no es audiencia: sus
  // partidas de prueba falsearían la recurrencia.
  const staff = new Set(
    input.players.filter((p) => p.role === 'admin' || p.role === 'support').map((p) => p.id)
  );
  const profile = new Map(input.players.map((p) => [p.id, p]));

  // ── Un paso por las partidas: días, partidas y premios ──
  const acc = new Map<string, { days: Map<string, number>; games: number; won: number }>();
  const calendar = new Map<string, { players: Set<string>; games: number }>();

  for (const g of input.games) {
    if (staff.has(g.player_id)) continue;
    const day = dayOf(g.created_at);

    let e = acc.get(g.player_id);
    if (!e) acc.set(g.player_id, (e = { days: new Map(), games: 0, won: 0 }));
    e.games++;
    e.won += Number(g.payout);
    e.days.set(day, (e.days.get(day) ?? 0) + 1);

    let c = calendar.get(day);
    if (!c) calendar.set(day, (c = { players: new Set(), games: 0 }));
    c.players.add(g.player_id);
    c.games++;
  }

  const players: RetentionPlayer[] = [];
  for (const [id, e] of acc) {
    const days = [...e.days.keys()].sort();
    const { max, skipped } = streakOf(days);
    const wagered = e.games * TICKET_COST;
    const p = profile.get(id);
    const lastDay = days[days.length - 1];
    const sinceLast = daysBetween(lastDay, today);
    const pattern: PlayPattern =
      days.length === 1 ? 'unico' : skipped === 0 ? 'seguidos' : 'saltos';

    players.push({
      id,
      username: p?.username ?? null,
      days,
      days_count: days.length,
      games: e.games,
      wagered,
      won: Math.round(e.won * 100) / 100,
      rtp: wagered > 0 ? e.won / wagered : null,
      pattern,
      max_streak: max,
      skipped_days: skipped,
      first_day: days[0],
      last_day: lastDay,
      days_since_last: sinceLast,
      recharged: Math.round((recharged.get(id) ?? 0) * 100) / 100,
      withdrawn: Math.round((withdrawn.get(id) ?? 0) * 100) / 100,
      balance: Number(p?.balance ?? 0),
      tickets: Number(p?.tickets ?? 0),
      abandoned: days.length === 1 && sinceLast >= ABANDON_AFTER_DAYS,
    });
  }

  // Más recurrentes arriba; a igualdad de días, quien más jugó
  players.sort((a, b) => b.days_count - a.days_count || b.games - a.games);

  // ── Desglose por segmento de días jugados ──
  const total = players.length;
  const buckets: RetentionBucket[] = [];
  for (let d = 1; d <= MAX_BUCKET; d++) {
    const isPlus = d === MAX_BUCKET;
    const group = players.filter((p) =>
      isPlus ? p.days_count >= MAX_BUCKET : p.days_count === d
    );
    buckets.push({
      days: d,
      is_plus: isPlus,
      players: group.length,
      pct: total > 0 ? group.length / total : 0,
      consecutive: group.filter((p) => p.pattern === 'seguidos').length,
      intermittent: group.filter((p) => p.pattern === 'saltos').length,
    });
  }

  const registered = input.players.filter((p) => !staff.has(p.id)).length;
  const totalGames = players.reduce((s, p) => s + p.games, 0);
  const wagered = totalGames * TICKET_COST;
  const won = Math.round(players.reduce((s, p) => s + p.won, 0) * 100) / 100;

  return {
    buckets,
    calendar: [...calendar.entries()]
      .map(([date, c]) => ({ date, players: c.players.size, games: c.games }))
      .sort((a, b) => (a.date < b.date ? 1 : -1)),
    totals: {
      players_played: total,
      registered,
      never_played: Math.max(0, registered - total),
      one_day: players.filter((p) => p.days_count === 1).length,
      one_game: players.filter((p) => p.games === 1).length,
      abandoned: players.filter((p) => p.abandoned).length,
      consecutive: players.filter((p) => p.pattern === 'seguidos').length,
      intermittent: players.filter((p) => p.pattern === 'saltos').length,
      avg_days: total > 0 ? players.reduce((s, p) => s + p.days_count, 0) / total : 0,
      total_games: totalGames,
      wagered,
      won,
      rtp: wagered > 0 ? won / wagered : null,
      abandon_after_days: ABANDON_AFTER_DAYS,
    },
    players,
  };
}
