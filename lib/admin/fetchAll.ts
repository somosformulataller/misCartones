// PostgREST NUNCA devuelve más de 1000 filas por petición: el tope lo
// pone el servidor (db-max-rows), así que un `.limit(50000)` se
// atiende igual con 1000 y el resto se pierde EN SILENCIO. Con 1.689
// partidas en la base, cualquier conteo hecho sobre game_history de
// una sola tacada ya venía corto.
//
// Este ayudante pide la tabla por páginas hasta que se acaba.
// IMPORTANTE: la consulta debe llevar un `.order(...)` estable (por
// ejemplo created_at o id); sin orden, Postgres puede devolver las
// filas en distinto orden en cada página y saldrían repetidas o
// faltarían.

const PAGE_SIZE = 1000;
/** Techo de seguridad: 300.000 filas (300 páginas) por consulta */
const MAX_ROWS = 300_000;

export async function fetchAllRows<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error || !data) break;
    out.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  return out;
}
