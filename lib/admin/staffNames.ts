import { createAdminClient } from '@/lib/supabase/admin';

// Poner nombre a las firmas del panel (migración 005).
//
// Las columnas `handled_by` / `sender_id` guardan un UUID; el panel
// tiene que enseñar «Aprobado por Estefanía». Se resuelve pidiendo los
// nombres de los ids que de verdad aparecen en lo que se está
// mostrando, no la lista del equipo: alguien que atendió cien compras
// y luego dejó de ser staff —o volvió a ser jugador— tiene que seguir
// saliendo con su nombre.
//
// Ante cualquier fallo devuelve un mapa vacío: el panel enseña «—» y
// no se cae. Ninguna firma vale una pantalla en blanco.

type Admin = ReturnType<typeof createAdminClient>;

/** ids → nombre visible. Los ids repetidos o nulos se ignoran. */
export async function loadNamesFor(
  admin: Admin,
  ids: (string | null | undefined)[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unicos = [...new Set(ids.filter((v): v is string => !!v))];
  if (unicos.length === 0) return map;
  try {
    const { data, error } = await admin
      .from('players')
      .select('id, username')
      .in('id', unicos);
    if (error) return map;
    for (const p of data ?? []) {
      if (p.username) map.set(p.id, p.username);
    }
  } catch {}
  return map;
}

/** El nombre, o null si no se sabe (firma vieja, cuenta borrada) */
export const nombreDe = (map: Map<string, string>, id: string | null | undefined) =>
  (id && map.get(id)) || null;
