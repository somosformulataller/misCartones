import { createAdminClient } from '@/lib/supabase/admin';

// Comprobantes de pago: el bucket guarda una CARPETA por compra
// (payment-proofs/<id de compra>/<archivo>). Para saber qué compras
// tienen captura basta con los nombres de las carpetas.
//
// Se pagina de 1000 en 1000: con un solo `list` de 200 (como estaba
// antes) los comprobantes empiezan a desaparecer del panel en cuanto
// el bucket pasa de esa cifra — y el orden es alfabético por UUID, así
// que los que se pierden son al azar, no los más viejos.
// El resultado se cachea 60 s: el panel refresca cada 30 s y esta
// lista casi no cambia.

const PAGE = 1000;
const MAX_FOLDERS = 50_000;
const TTL_MS = 60_000;

let cache: { ids: Set<string>; at: number } | null = null;

/** Ids de compra que tienen comprobante subido */
export async function loadProofIds(): Promise<Set<string>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.ids;
  const storage = createAdminClient().storage.from('payment-proofs');
  const ids = new Set<string>();
  try {
    for (let offset = 0; offset < MAX_FOLDERS; offset += PAGE) {
      const { data, error } = await storage.list('', { limit: PAGE, offset });
      if (error || !data || data.length === 0) break;
      for (const folder of data) ids.add(folder.name);
      if (data.length < PAGE) break;
    }
  } catch {
    // Si el storage falla, mejor la lista anterior que ninguna
    return cache?.ids ?? ids;
  }
  cache = { ids, at: Date.now() };
  return ids;
}
