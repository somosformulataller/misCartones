import { createHash } from 'node:crypto';
import { cleanEnv } from '@/lib/supabase/env';
import { BANK_CUENTA_ESPERADA, PAYMENT_DESTINATION, REFERENCE_TAIL } from './constants';
import { normalizarBanco } from './bancos';

/** Deja el banco en su nombre canónico para que lo guardado y lo
 *  mostrado sea uno solo («BDV», no «BDV»/«Banco de Venezuela»/«BANCO
 *  VZLA»…). Si no se reconoce, se conserva el texto crudo en vez de
 *  perderlo. El original siempre queda en `raw` (→ ocr_raw). */
const normBanco = (v: string | null) => (v ? (normalizarBanco(v) ?? v) : null);

// Lee el comprobante de pago con el servicio de OCR y devuelve lo que
// vio. NO valida nada ni acredita nada: quien dice que un pago existe
// sigue siendo la cola del banco. Aquí solo se ahorra que el jugador
// teclee la referencia (un dígito mal es la causa nº 1 de «pagué y no
// se refleja») y se apunta el ORIGEN del pago para la fase 2.
//
// La clave del servicio vive SOLO en el servidor: este módulo no se
// importa nunca desde el navegador.

const OCR_URL = process.env.PAYMENT_OCR_URL ?? 'https://payment-ocr-service-production.up.railway.app';
const OCR_KEY = process.env.PAYMENT_OCR_API_KEY ?? '';

/** Medido el 25/08/2026 sobre 52 comprobantes reales: mediana 2,6 s,
 *  peor caso 11 s. 15 s deja margen de sobra para un arranque en frío
 *  del servicio sin dejar al jugador esperando de más. */
const TIMEOUT_MS = 15_000;

/** Lo que el servicio contesta. Todo opcional a propósito: la respuesta
 *  varía según el banco y no se puede dar nada por hecho. */
interface RespuestaOcr {
  legible?: boolean;
  reference?: string | null;
  full_reference?: string | null;
  amount?: number | null;
  currency?: string | null;
  date?: string | null;
  bank?: string | null;
  origin?: string | null;
  origin_type?: string | null;
  origin_bank?: string | null;
  origin_cedula?: string | null;
  is_ubii?: boolean | null;
  confidence?: number | null;
}

export interface DatosOcr {
  reference: string;
  full_reference: string | null;
  amount: number | null;
  bank: string | null;
  origin: string | null;
  origin_type: string | null;
  origin_bank: string | null;
  origin_cedula: string | null;
  is_ubii: boolean;
  confidence: number | null;
  raw: RespuestaOcr;
}

export type ResultadoOcr =
  /** Se leyó y la referencia tiene forma de referencia */
  | { estado: 'leido'; datos: DatosOcr }
  /** La foto no se puede leer: que suba otra */
  | { estado: 'ilegible' }
  /** El servicio no contestó, o no está configurado: que reintente */
  | { estado: 'error' };

export const OCR_ILEGIBLE_MSG =
  'No pudimos leer tu comprobante, adjunta uno más legible.';
export const OCR_ERROR_MSG =
  'No pudimos procesar el comprobante en este momento. Inténtalo de nuevo en un momento.';

export const isOcrConfigured = () => OCR_KEY.length > 0;

const soloDigitos = (v: unknown) => String(v ?? '').replace(/\D/g, '');

/** El nombre del titular de NUESTRA cuenta receptora. Va por variable de
 *  entorno a propósito: es el nombre real de una persona y el repo puede
 *  ser público, así que no se hardcodea. Si no está configurada, el
 *  filtro por nombre no actúa (los otros tres —teléfono, cédula, cuenta—
 *  siguen). En Vercel: PAYMENT_DESTINATION_NOMBRE. */
const NUESTRO_TITULAR = cleanEnv(process.env.PAYMENT_DESTINATION_NOMBRE);

/** Normaliza un nombre para comparar: mayúsculas, sin tildes, sin signos
 *  y con los espacios colapsados. Así «Raymar  Venezuela» y
 *  «RAYMAR VENEZUELA» son el mismo nombre. */
const normNombre = (v: unknown) =>
  String(v ?? '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const NUESTRO_TITULAR_NORM = normNombre(NUESTRO_TITULAR);

/**
 * ¿Este dato es NUESTRO, no del que paga?
 *
 * Medido el 25/08/2026 con una captura de cada banco: el servicio
 * devuelve NUESTRA cédula (18033691) como `origin_cedula` en 4 de 9
 * bancos, porque BDV rotula ese campo «Identificación», y BDT y Banco
 * del Tesoro «Número de identificación» — y en los tres es la del
 * BENEFICIARIO. Banesco lo dice sin ambigüedad: «IDENTIFICACIÓN
 * RECEPTOR».
 *
 * Peor todavía: en BDT y Banco del Tesoro, cuyos recibos no muestran
 * NADA del ordenante, devuelve nuestro propio teléfono de destino como
 * si fuera el origen. Guardar eso sería sembrar la huella del jugador
 * con nuestros datos, y a partir de ahí CUALQUIERA pagando desde esos
 * bancos «coincidiría»: la regla antifraude quedaría del revés,
 * aprobando justo al impostor.
 *
 * Por eso, antes de guardar nada, todo lo que se parezca a nuestros
 * datos de destino se tira. Un hueco honesto vale mucho más que un
 * dato inventado. Se cubren las cuatro caras de nuestra identidad de
 * destino: teléfono, cédula, número de cuenta y nombre del titular.
 */
export function esNuestro(valor: unknown): boolean {
  const d = soloDigitos(valor);
  if (d) {
    const tel = soloDigitos(PAYMENT_DESTINATION.telefono);
    const ci = soloDigitos(PAYMENT_DESTINATION.cedula);
    const cta = soloDigitos(BANK_CUENTA_ESPERADA); // «0102***7113» → «01027113»
    // El teléfono se compara por los últimos 10 dígitos: unos recibos lo
    // escriben «0422-0166113» y otros «(0422) 016-61-13».
    if (tel && d.endsWith(tel.slice(-10))) return true;
    if (ci && (d === ci || d.endsWith(ci))) return true;
    // La cuenta: nuestra receptora es BDV (prefijo 0102) y termina en
    // 7113. Se exigen las DOS puntas —prefijo Y cola— para no descartar
    // por azar la cuenta de un pagador que casualmente acabe en esos 4
    // dígitos. (BANK_CUENTA_ESPERADA viene enmascarada; solo esas 8
    // cifras son fiables.)
    if (cta.length >= 8) {
      const pref = cta.slice(0, 4);
      const cola = cta.slice(-4);
      if (d.length >= 8 && d.startsWith(pref) && d.endsWith(cola)) return true;
    }
  }
  // El nombre del titular (solo si está configurado): si el texto de
  // origen ES o CONTIENE nuestro nombre de titular, es un dato de
  // destino que el OCR coló como si fuera del ordenante.
  if (NUESTRO_TITULAR_NORM) {
    const n = normNombre(valor);
    if (n && (n === NUESTRO_TITULAR_NORM || n.includes(NUESTRO_TITULAR_NORM))) return true;
  }
  return false;
}

/** Deja fuera lo que en realidad son nuestros datos de destino */
function limpiarOrigen(r: RespuestaOcr) {
  const origen = typeof r.origin === 'string' && r.origin.trim() ? r.origin.trim() : null;
  const cedula =
    typeof r.origin_cedula === 'string' && r.origin_cedula.trim() ? r.origin_cedula.trim() : null;
  const bancoOrigen =
    typeof r.origin_bank === 'string' && r.origin_bank.trim() ? r.origin_bank.trim() : null;
  return {
    origin: origen && !esNuestro(origen) ? origen : null,
    // El tipo sin el valor no dice nada
    origin_type:
      origen && !esNuestro(origen) && typeof r.origin_type === 'string' ? r.origin_type : null,
    origin_cedula: cedula && !esNuestro(cedula) ? cedula : null,
    origin_bank: normBanco(bancoOrigen),
  };
}

/** Una referencia solo vale si son exactamente los dígitos que el banco
 *  empareja. El servicio ya lo comprueba antes de decir `legible`, pero
 *  se vuelve a mirar aquí: si algún día su respuesta cambia de forma,
 *  una referencia deforme NO puede colarse en el camino del dinero. */
const referenciaValida = (v: string) => new RegExp(`^\\d{${REFERENCE_TAIL}}$`).test(v);

/**
 * Manda la imagen al servicio y traduce su respuesta a uno de los tres
 * estados. Nunca lanza: el peor caso es `error`, y entonces el jugador
 * reintenta. Ninguna compra se crea a partir de aquí.
 */
export async function leerComprobante(bytes: ArrayBuffer, nombre: string): Promise<ResultadoOcr> {
  if (!isOcrConfigured()) {
    console.error('[ocr] falta PAYMENT_OCR_API_KEY');
    return { estado: 'error' };
  }

  let res: Response;
  try {
    const fd = new FormData();
    fd.append('file', new Blob([bytes]), nombre || 'comprobante.jpg');
    res = await fetch(`${OCR_URL}/v1/extract?template=ve_pago_movil&refDigits=${REFERENCE_TAIL}`, {
      method: 'POST',
      headers: { 'x-api-key': OCR_KEY },
      body: fd,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    // Timeout, red, servicio caído. Transitorio: que reintente.
    console.error('[ocr] no se pudo llegar al servicio:', (e as Error)?.name);
    return { estado: 'error' };
  }

  // 422 = leyó la imagen pero no distingue la referencia
  if (res.status === 422) return { estado: 'ilegible' };
  if (!res.ok) {
    console.error('[ocr] respuesta HTTP', res.status);
    return { estado: 'error' };
  }

  let r: RespuestaOcr;
  try {
    r = (await res.json()) as RespuestaOcr;
  } catch {
    console.error('[ocr] respuesta que no es JSON');
    return { estado: 'error' };
  }

  const reference = typeof r.reference === 'string' ? r.reference.trim() : '';
  if (r.legible !== true || !referenciaValida(reference)) {
    // Se distingue en el log «el servicio dijo que no» de «dijo que sí
    // pero la referencia no tenía forma», que son problemas distintos.
    console.warn(
      '[ocr] ilegible ·',
      r.legible !== true ? 'lo dice el servicio' : 'la referencia no tiene forma',
      '· dígitos:',
      reference.length
    );
    return { estado: 'ilegible' };
  }

  const limpio = limpiarOrigen(r);
  return {
    estado: 'leido',
    datos: {
      reference,
      full_reference: typeof r.full_reference === 'string' ? r.full_reference : null,
      amount: typeof r.amount === 'number' && Number.isFinite(r.amount) ? r.amount : null,
      bank: normBanco(typeof r.bank === 'string' && r.bank.trim() ? r.bank.trim() : null),
      ...limpio,
      is_ubii: r.is_ubii === true,
      confidence:
        typeof r.confidence === 'number' && Number.isFinite(r.confidence) ? r.confidence : null,
      raw: r,
    },
  };
}

// ── Caché por imagen ─────────────────────────────────────────────
// La misma foto se analiza dos veces: una al adjuntarla (para poder
// enseñar la referencia y avisar si no se lee) y otra al enviar la
// compra, porque el servidor NO puede fiarse de una referencia que
// venga del navegador. Cada llamada cuesta dinero, así que la segunda
// se sirve de aquí.
//
// Es memoria del proceso: en Vercel puede tocar otra instancia y
// fallar el acierto. No importa — entonces se vuelve a analizar y el
// resultado es el mismo. La caché ahorra dinero, no corrige nada.
const CACHE_MS = 10 * 60 * 1000;
const cache = new Map<string, { r: ResultadoOcr; t: number }>();

/** Huella de la imagen. Va con el id del jugador para que nadie pueda
 *  aprovechar el análisis de la foto de otro. */
export const huellaImagen = (jugador: string, bytes: ArrayBuffer) =>
  `${jugador}:${createHash('sha256').update(Buffer.from(bytes)).digest('hex')}`;

function limpiarCaducados(ahora: number) {
  for (const [k, v] of cache) if (ahora - v.t > CACHE_MS) cache.delete(k);
}

/** Analiza, o devuelve lo ya analizado para esa misma imagen. Los
 *  errores no se cachean: son transitorios y el reintento debe volver
 *  a preguntar de verdad. */
export async function leerComprobanteCacheado(
  jugador: string,
  bytes: ArrayBuffer,
  nombre: string
): Promise<ResultadoOcr> {
  const ahora = Date.now();
  limpiarCaducados(ahora);
  const clave = huellaImagen(jugador, bytes);

  const guardado = cache.get(clave);
  if (guardado) return guardado.r;

  const r = await leerComprobante(bytes, nombre);
  if (r.estado !== 'error') cache.set(clave, { r, t: ahora });
  return r;
}
