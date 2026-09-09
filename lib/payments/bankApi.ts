// Conexión con la Bank Automation API (valida pagos por Pago Móvil).
// Solo servidor: usa BANK_API_URL, BANK_API_TOKEN y BANK_API_ACCOUNT_NAME.
//
// La API tiene DOS puertas muy distintas:
//
//   GET /transaction           → estado de cuenta YA GUARDADO. Gratis,
//                                instantáneo, NO toca el banco.
//   GET /transaction/validate  → busca una referencia y, si no la
//                                encuentra, ENTRA AL BANCO a scrapear.
//                                El banco solo aguanta ~1 por minuto.
//
// Hasta el 10/08/2026 preguntábamos por /validate una vez por pago y
// por reintento: el banco respondía 429 y nadie validaba. Ahora se lee
// la cola guardada (barata) y solo se da UN latido al banco por pasada
// del cron para que la cola llegue fresca.
//
// La API es MULTICUENTA: sirve también a otra app con otra cuenta. Por
// eso cada movimiento se comprueba contra la cuenta esperada antes de
// tocarlo (ver esCuentaNuestra) — jamás se reclama un pago ajeno.

import { cleanEnv } from '@/lib/supabase/env';
import { BANK_ACCOUNT_NAME_ESPERADO, BANK_CUENTA_ESPERADA, diaCaracas } from './constants';

const TIMEOUT_LECTURA_MS = 15_000;
// El scrapeo abre sesión en el banco: tarda entre 20 y 60 segundos.
const TIMEOUT_SCRAPEO_MS = 90_000;

/** Un movimiento del estado de cuenta tal como lo devuelve la API */
export interface Movimiento {
  id: number;
  /** Cuenta del banco enmascarada, p. ej. 0102***7113 */
  cuenta: string;
  /** Etiqueta interna de la cuenta en la API */
  accountName: string;
  fecha: string;
  referencia: string;
  descripcion: string;
  tipo: string;
  monto: number;
  saldo?: number;
  scrapedAt?: string;
  /** true = ya reclamado; jamás se vuelve a tocar */
  used: boolean;
}

function getConfig() {
  const url = cleanEnv(process.env.BANK_API_URL);
  const token = cleanEnv(process.env.BANK_API_TOKEN);
  const accountName = cleanEnv(process.env.BANK_API_ACCOUNT_NAME);
  if (!url || !token || !accountName) return null;
  // Sin saber QUÉ cuenta es la nuestra, esCuentaNuestra no puede decir que
  // no a nada, y el cerrojo doble se quedaría abierto de par en par: la API
  // sirve también a La Llave Correcta y le reclamaríamos sus pagos. Así que
  // faltando eso, la API cuenta como no configurada y todo se aprueba a mano.
  if (!BANK_ACCOUNT_NAME_ESPERADO || !BANK_CUENTA_ESPERADA) return null;
  return { url: url.replace(/\/$/, ''), token, accountName };
}

export function isBankApiConfigured(): boolean {
  return getConfig() !== null;
}

/** Nombre de cuenta configurado (para avisar si no es el esperado) */
export function cuentaConfigurada(): string | null {
  return getConfig()?.accountName ?? null;
}

/**
 * CERROJO DOBLE. Un movimiento solo se puede tocar si viene de NUESTRA
 * cuenta, comprobado por partida doble: la etiqueta de la API y el
 * número de cuenta del banco. Si alguien se equivoca configurando
 * BANK_API_ACCOUNT_NAME, esto impide que le reclamemos pagos a la otra
 * app (fue justo lo que pasó del 10/08 al 14/08).
 */
export function esCuentaNuestra(mov: Movimiento): boolean {
  return (
    mov.accountName === BANK_ACCOUNT_NAME_ESPERADO &&
    mov.cuenta === BANK_CUENTA_ESPERADA
  );
}

async function llamar(path: string, timeoutMs: number) {
  const config = getConfig();
  if (!config) return { ok: false as const, status: 0, detalle: 'API no configurada' };
  try {
    const res = await fetch(`${config.url}${path}`, {
      headers: { Authorization: `Bearer ${config.token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    return {
      ok: false as const,
      status: 0,
      detalle: err instanceof Error ? err.message : 'error de red',
    };
  }
}

/**
 * Estado de cuenta guardado, del más reciente al más antiguo. NO toca
 * el banco: se puede llamar cuantas veces haga falta.
 */
export async function leerEstadoDeCuenta(limite = 200): Promise<Movimiento[]> {
  const config = getConfig();
  if (!config) return [];
  const qs = new URLSearchParams({
    account_name: config.accountName,
    limit: String(limite),
  });
  const r = await llamar(`/transaction?${qs}`, TIMEOUT_LECTURA_MS);
  if (!r.ok || !Array.isArray(r.data)) return [];
  // Se descarta aquí mismo cualquier cosa que no sea de nuestra cuenta
  return (r.data as Movimiento[]).filter(esCuentaNuestra);
}

/**
 * Movimientos GUARDADOS cuya referencia termina en esta cola, de
 * NUESTRA cuenta, SIN límite de fecha. Sirve para saber si un pago
 * EXISTE aunque caiga fuera de la ventana de emparejamiento (p. ej. el
 * jugador pagó hace días y registró la compra hoy, o quedó fuera de los
 * 200 más recientes). El parámetro `referencia` de la API empareja por
 * sufijo. Lectura filtrada: gratis, NO entra al banco.
 */
export async function buscarPorReferencia(cola: string): Promise<Movimiento[]> {
  const config = getConfig();
  if (!config) return [];
  const qs = new URLSearchParams({
    account_name: config.accountName,
    referencia: cola,
    limit: '20',
  });
  const r = await llamar(`/transaction?${qs}`, TIMEOUT_LECTURA_MS);
  if (!r.ok || !Array.isArray(r.data)) return [];
  return (r.data as Movimiento[]).filter(esCuentaNuestra);
}

/**
 * Cómo terminó el latido (va al diario del cron, tabla cron_pasadas).
 *
 * `scrapeada` y `encontrada` son OPUESTOS y por eso se guardan aparte:
 * solo la primera significa que se entró al banco.
 */
// OJO: el código HTTP de /transaction/validate NO dice si entró al
// banco. Con una referencia imposible —comprobado que ningún
// movimiento termina en ella— contesta unas veces 404 y otras 200.
// Quien decide entre 'scrapeada' y 'encontrada' es clasificarLatido,
// por lo que tardó la llamada. Aquí solo se traduce el HTTP.
export type Latido =
  /** ENTRÓ al banco: abrió sesión y bajó el estado de cuenta. Es el
   *  resultado NORMAL, porque se pregunta a propósito por una
   *  referencia que no puede existir. */
  | 'scrapeada'
  /** Contestó de su propia tabla, sin asomarse al banco. La cola sigue
   *  igual de vieja. */
  | 'encontrada'
  /** 429: el banco está en enfriamiento (no es «no llegó el pago») */
  | 'enfriamiento'
  | 'error'
  | 'sin_config'
  /** No se mandó: todas las pendientes ya estaban en la cola */
  | 'no_hizo_falta';

/**
 * LATIDO: una sola entrada al banco por pasada. Se pregunta por una
 * referencia con set_used=false (no reclama nada); el FALLO es lo que
 * obliga a la API a bajar el estado de cuenta fresco.
 *
 * IMPORTANTE: el estado de cuenta NO se actualiza solo. La API no
 * tiene reloj propio ni una puerta de «refresca»: solo entra al banco
 * cuando alguien llama a /transaction/validate, y SOLO si no encuentra
 * la referencia en su propia tabla. Medido el 16/08/2026:
 *
 *   referencia que ya tenía  → HTTP 200 en  0,4 s · cola intacta
 *   referencia inexistente   → HTTP 404 en 19,5 s · cola 94 → 95
 *
 * Por eso quien llama debe mandar una referencia IMPOSIBLE (ver
 * referenciaImposible en conciliar.ts): así el fallo está garantizado y
 * con él la descarga. Preguntar por una referencia real se arriesga a
 * que la API la tenga y conteste de memoria, gastando la pasada sin
 * refrescar nada — el fallo que dejó la cola congelada 109 minutos con
 * ocho compras esperando.
 */
export async function refrescarEstadoDeCuenta(referencia: string, fechaISO: string): Promise<Latido> {
  const config = getConfig();
  if (!config) return 'sin_config';
  const qs = new URLSearchParams({
    account_name: config.accountName,
    reference: referencia,
    date: diaCaracas(fechaISO), // día del banco (hora de Venezuela)
    set_used: 'false',
    get_used: 'false',
  });
  const r = await llamar(`/transaction/validate?${qs}`, TIMEOUT_SCRAPEO_MS);
  if (r.status === 429) return 'enfriamiento';
  if (r.status === 404) return 'scrapeada';
  if (r.status === 200) return 'encontrada';
  return 'error';
}

/**
 * Reclama el movimiento (set_used=true) para que su referencia no se
 * pueda volver a usar. Se llama SOLO cuando el emparejamiento ya pasó
 * todas las reglas. Si falla, la compra se queda pendiente y se
 * reintenta en la siguiente pasada.
 *
 * Se intenta con el día de Caracas y, si no cuadra, con el día UTC:
 * un pago de las 9 de la noche cae en dos días distintos según cómo
 * cuente la API, y equivocarse dejaba la compra atascada.
 */
export async function reclamarMovimiento(mov: Movimiento): Promise<boolean> {
  const config = getConfig();
  if (!config || !esCuentaNuestra(mov)) return false;
  const dias = [...new Set([diaCaracas(mov.fecha), mov.fecha.slice(0, 10)])];
  for (const date of dias) {
    const qs = new URLSearchParams({
      account_name: config.accountName,
      reference: mov.referencia,
      date,
      set_used: 'true',
      get_used: 'false',
      monto: mov.monto.toFixed(2),
    });
    const r = await llamar(`/transaction/validate?${qs}`, TIMEOUT_SCRAPEO_MS);
    if (r.ok) return true;
  }
  return false;
}
