import { createAdminClient } from '@/lib/supabase/admin';
import { PlayerTag } from '@/types/game';

// Etiquetas/notas internas del staff sobre los jugadores.
// Todas las consultas toleran que la migración 004 aún no haya
// corrido: en ese caso devuelven vacío en vez de romper el panel.

export const TAG_COLORS = ['neutral', 'gold', 'green', 'red', 'blue'] as const;
export const MAX_LABEL = 40;
export const MAX_NOTE = 500;

type Admin = ReturnType<typeof createAdminClient>;

/** Etiquetas de varios jugadores a la vez: id → etiquetas */
export async function loadTagsFor(
  admin: Admin,
  playerIds: string[]
): Promise<Map<string, PlayerTag[]>> {
  const map = new Map<string, PlayerTag[]>();
  if (playerIds.length === 0) return map;
  const { data } = await admin
    .from('player_tags')
    .select('*')
    .in('player_id', playerIds)
    .order('created_at', { ascending: true });
  for (const t of (data ?? []) as PlayerTag[]) {
    const list = map.get(t.player_id);
    if (list) list.push(t);
    else map.set(t.player_id, [t]);
  }
  return map;
}

/**
 * Etiquetas ya usadas antes en CUALQUIER jugador, de la más repetida
 * a la menos: sirven de sugerencias para no reescribirlas a mano.
 */
export async function loadSuggestions(admin: Admin, exclude: string[] = []): Promise<string[]> {
  const { data } = await admin.from('player_tags').select('label').limit(1000);
  const skip = new Set(exclude.map((l) => l.toLowerCase()));
  const counts = new Map<string, { label: string; n: number }>();
  for (const row of (data ?? []) as { label: string }[]) {
    const key = row.label.toLowerCase();
    if (skip.has(key)) continue;
    const hit = counts.get(key);
    if (hit) hit.n++;
    else counts.set(key, { label: row.label, n: 1 });
  }
  return [...counts.values()]
    .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label))
    .slice(0, 12)
    .map((c) => c.label);
}
