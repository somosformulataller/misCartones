import type { createAdminClient } from '@/lib/supabase/admin';

type Admin = ReturnType<typeof createAdminClient>;

// Mapa id → correo. La tabla `players` no guarda el correo: vive en el
// registro de acceso (auth), y para el panel hay que juntarlos.
//
// HAY QUE PAGINAR, y esto es la razón: `listUsers` devuelve como mucho
// una página, de la cuenta más nueva a la más vieja. Pidiendo UNA sola
// página de 1000, el 25/08/2026 —con 1081 cuentas— las 81 personas más
// ANTIGUAS se quedaban sin correo. Consecuencias que se vieron en el
// panel:
//   · buscar por su correo no encontraba nada (parecía que la cuenta
//     no existía, cuando estaba ahí)
//   · su correo salía como «—» en la lista, en su ficha y en el chat
// Y empeoraba solo: cada registro nuevo empujaba a otra cuenta vieja
// fuera de la lista.
const POR_PAGINA = 1000;
/** Tope de seguridad: 50 páginas = 50.000 cuentas. Es para que un fallo
 *  de la API no deje esto girando sin fin, no un límite real. */
const MAX_PAGINAS = 50;

/** Un mapa completo y si se pudo traer entero (para no cachear a medias) */
export async function cargarCorreos(admin: Admin): Promise<{
  map: Map<string, string>;
  completo: boolean;
}> {
  const map = new Map<string, string>();
  let completo = true;
  try {
    for (let page = 1; page <= MAX_PAGINAS; page++) {
      const { data } = await admin.auth.admin.listUsers({ page, perPage: POR_PAGINA });
      const users = data?.users ?? [];
      for (const u of users) {
        if (u.email) map.set(u.id, u.email);
      }
      if (users.length < POR_PAGINA) break;
      if (page === MAX_PAGINAS) completo = false;
    }
  } catch {
    // Si una página falla, lo traído sirve igual; solo no se da por
    // bueno, para que el siguiente intento lo reintente.
    completo = false;
  }
  return { map, completo };
}

// Listar todos los usuarios de auth es la consulta más pesada del
// panel, y este refresca cada 30 s: se guarda 60 s en memoria. Los
// correos casi nunca cambian y uno nuevo tarda ≤1 min en aparecer.
let cache: { map: Map<string, string>; at: number } | null = null;

export async function cargarCorreosCacheado(admin: Admin): Promise<Map<string, string>> {
  if (cache && Date.now() - cache.at < 60_000) return cache.map;
  const { map, completo } = await cargarCorreos(admin);
  // Solo se cachea un mapa COMPLETO: uno a medias dejaría a esas
  // personas sin correo durante todo el minuto siguiente.
  if (map.size > 0 && completo) cache = { map, at: Date.now() };
  return map;
}

/** Se llama al cambiar el correo de alguien desde el panel, para que la
 *  lista enseñe el nuevo ya y no dentro de un minuto. */
export function olvidarCorreos() {
  cache = null;
}
