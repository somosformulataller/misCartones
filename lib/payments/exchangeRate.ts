// Tasa oficial BCV vía dolarapi.com (la web del BCV falla TLS desde
// servidores; dolarapi replica el mismo valor oficial).
//
// Caché EN MEMORIA de 1 h con respaldo: si dolarapi falla o tarda,
// se sirve la última tasa conocida (aunque esté vencida) y no se
// vuelve a intentar hasta pasado un enfriamiento — una API externa
// lenta NO puede volver lento el panel ni la compra del jugador.
// (Antes: timeout de 5 s + reintento en línea = hasta 10 s bloqueando
// /api/admin/payments y /api/purchases en cada llamada fallida.)

const DOLARAPI_URL = 'https://ve.dolarapi.com/v1/dolares/oficial';

const FRESH_MS = 60 * 60_000; // frescura normal de la tasa (1 h)
const FAIL_COOLDOWN_MS = 5 * 60_000; // espera tras un fallo (5 min)
const FETCH_TIMEOUT_MS = 3_000;

export interface ExchangeRate {
  rate: number;
  source: 'bcv';
  fetchedAt: string;
}

let cached: ExchangeRate | null = null;
let cachedAt = 0;
let failedAt = 0;

export async function fetchExchangeRate(): Promise<ExchangeRate> {
  const res = await fetch(DOLARAPI_URL, {
    cache: 'no-store', // la caché la maneja este módulo
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`dolarapi respondió ${res.status}`);
  const data = await res.json();
  const rate = Number(data?.promedio);
  if (!Number.isFinite(rate) || rate <= 0) throw new Error('Tasa inválida');
  return {
    rate,
    source: 'bcv',
    fetchedAt: data?.fechaActualizacion ?? new Date().toISOString(),
  };
}

export async function fetchExchangeRateSafe(): Promise<ExchangeRate | null> {
  const now = Date.now();
  if (cached && now - cachedAt < FRESH_MS) return cached;
  // Falló hace poco: no insistir todavía; va la última conocida (o null)
  if (failedAt && now - failedAt < FAIL_COOLDOWN_MS) return cached;
  try {
    cached = await fetchExchangeRate();
    cachedAt = now;
    failedAt = 0;
  } catch {
    failedAt = now;
  }
  return cached;
}
