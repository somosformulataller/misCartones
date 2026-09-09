import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Leer una tabla ENTERA, pase lo que pase con el tamaño.
 *
 * PostgREST devuelve como mucho 1.000 filas por respuesta, y lo hace en
 * silencio: no avisa, no da error, simplemente faltan filas. Pedir
 * `.limit(5000)` tampoco sirve — el tope del servidor manda.
 *
 * Esto ya nos mordió dos veces:
 *  · 17/08/2026 — los totales del Resumen salían de una lista con
 *    `.limit(200)`. Con 524 jugadores el panel enseñaba el RTP de los
 *    200 más nuevos (98,9%) como si fuera el de la app (97,3%).
 *  · 24/08/2026 — "Total recargado" dejó de contar las recargas del
 *    día: había 1.071 compras aprobadas y la consulta devolvía 1.000.
 *    Las que se caían eran las últimas, así que lo de hoy no aparecía.
 *
 * La regla: un total NUNCA se calcula sobre una consulta con límite. O
 * lo suma la base entera, o se lee por tandas con esto.
 *
 * Se ordena por `id` (clave primaria) y no por fecha: si dos filas
 * comparten el instante de creación, el orden entre tandas puede bailar
 * y una fila se contaría dos veces o ninguna.
 */

const TANDA = 1000;

/** Lo mínimo de un query builder que hace falta aquí. Se escribe a mano
 *  porque los genéricos de supabase-js encadenados hacen que TypeScript
 *  se rinda con «type instantiation is excessively deep». */
export interface Consulta {
  eq: (columna: string, valor: unknown) => Consulta;
  gte: (columna: string, valor: unknown) => Consulta;
  in: (columna: string, valores: readonly unknown[]) => Consulta;
  order: (columna: string, opciones: { ascending: boolean }) => Consulta;
  range: (desde: number, hasta: number) => Promise<{ data: unknown[] | null; error: unknown }>;
}

/**
 * Todas las filas de `tabla`, sin tope.
 *
 * @param afinar filtros que aplicar (`q => q.eq('status','aprobado')`)
 */
export async function leerTodo<T>(
  db: SupabaseClient,
  tabla: string,
  columnas: string,
  afinar?: (q: Consulta) => Consulta
): Promise<T[]> {
  const suelto = db as unknown as { from: (t: string) => { select: (c: string) => Consulta } };
  const todo: T[] = [];
  for (let desde = 0; ; desde += TANDA) {
    const base = suelto.from(tabla).select(columnas);
    const filtrada = afinar ? afinar(base) : base;
    const { data, error } = await filtrada
      .order('id', { ascending: true })
      .range(desde, desde + TANDA - 1);
    if (error) throw error;
    const filas = (data ?? []) as T[];
    todo.push(...filas);
    if (filas.length < TANDA) return todo;
  }
}
