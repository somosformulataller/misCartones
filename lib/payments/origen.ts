import type { DatosOcr } from './ocr';
import { BANCOS, normalizarBanco } from './bancos';

// ¿Desde dónde paga cada jugador? La idea es que siempre sea el mismo
// sitio. Si cambia, el pago NO se rechaza: pasa a revisión manual y lo
// mira una persona desde el panel. Así se cierra la puerta a las
// estafas triangulares (usar el juego para mover dinero entre cuentas
// ajenas) sin castigar a quien tuvo un problema con su banco.
//
// Esto NO valida el pago ni acredita nada. Solo decide si la compra
// nace 'pendiente'. La validación contra el banco sigue igual.

const soloDigitos = (v: unknown) => String(v ?? '').replace(/\D/g, '');

/** Qué dato del comprobante identifica al que paga. Cada banco enseña
 *  uno distinto, así que hay varios tipos. */
export type TipoAncla = 'cedula' | 'cuenta4' | 'tel4' | 'nombre';

export interface Huella {
  banco: string | null;
  ancla_tipo: TipoAncla | null;
  ancla: string | null;
  /** El texto original, para enseñárselo a quien revisa */
  muestra: string | null;
}

/**
 * De lo que leyó el OCR saca (banco, ancla). El ancla son los ÚLTIMOS
 * 4 DÍGITOS, nunca el texto entero: el mismo banco escribe
 * «Cta. Ahorro BNC: ***6666» una vez y «Cta. Ahorro ***6666» la
 * siguiente. Lo único estable entre lecturas son los dígitos finales,
 * y además toleran que a veces venga enmascarado y a veces completo
 * («0104 **** 2931» y «0104-0019-86-0190162931» comparten 2931).
 */
export function huellaDe(d: DatosOcr): Huella {
  const dig = soloDigitos(d.origin);
  const tipo = d.origin_type;

  // ── Banco, por orden de fiabilidad ──
  let banco: string | null = null;
  // 1) El prefijo de la cuenta es un código oficial: manda.
  if (tipo === 'account' && dig.length >= 8 && BANCOS[dig.slice(0, 4)]) {
    banco = BANCOS[dig.slice(0, 4)];
  }
  // 2) El banco emisor cuando el recibo lo dice explícitamente.
  if (!banco) banco = normalizarBanco(d.origin_bank);
  // 3) La marca del comprobante. Cuidado: a veces es el banco de
  //    DESTINO (en Banco del Tesoro devuelve «Banco de Venezuela»).
  //    Se acepta igual porque el error es CONSISTENTE para ese banco:
  //    el mismo jugador pagando desde el mismo sitio da siempre el
  //    mismo valor, así que no genera falsos positivos.
  if (!banco) banco = normalizarBanco(d.bank);

  // ── Ancla ──
  let ancla_tipo: TipoAncla | null = null;
  let ancla: string | null = null;
  if (d.is_ubii && d.origin_cedula) {
    // Ubii «presta» el pago móvil: la cuenta de origen cambia en cada
    // pago del mismo jugador, así que la cédula del ordenante es lo
    // único estable. Es también el único recibo donde el OCR devuelve
    // la cédula del que paga y no la del que cobra.
    ancla_tipo = 'cedula';
    ancla = soloDigitos(d.origin_cedula);
  } else if ((tipo === 'account' || tipo === 'phone') && dig.length >= 4) {
    ancla_tipo = tipo === 'account' ? 'cuenta4' : 'tel4';
    ancla = dig.slice(-4);
  } else if (tipo === 'name' && d.origin) {
    // BBVA Provincial no enseña ni cuenta ni teléfono: solo el nombre.
    ancla_tipo = 'nombre';
    ancla = d.origin.toUpperCase().replace(/\s+/g, ' ').trim();
  }

  return { banco, ancla_tipo, ancla, muestra: d.origin };
}

export type Veredicto =
  /** Paga desde donde siempre (o es su primer pago) */
  | { ok: true }
  /** Hay motivo para que lo mire una persona */
  | {
      ok: false;
      motivo: 'banco_distinto' | 'cuenta_distinta' | 'ubii_ajeno' | 'tel_ajeno';
      detalle: string;
    };

/**
 * ¿Este pago viene del sitio de siempre?
 *
 * Es PERMISIVO a propósito: solo manda a revisión cuando hay pruebas
 * de que el origen cambió. Ante la duda deja pasar, porque el falso
 * positivo (revisión manual + jugador confundido) es peor que el falso
 * negativo: la cola del banco sigue siendo quien decide si el dinero
 * existe, y sin pago real no se acredita nada.
 */
export function comparar(
  huella: Huella,
  actual: Huella,
  opciones: { esUbii: boolean; cedulaJugador: string | null }
): Veredicto {
  // Ubii: el origen baila entre pagos, así que se juzga por la cédula.
  if (opciones.esUbii) {
    const suya = soloDigitos(opciones.cedulaJugador);
    const delPago = actual.ancla_tipo === 'cedula' ? actual.ancla : null;
    if (suya && delPago && delPago.endsWith(suya.slice(-7))) return { ok: true };
    return {
      ok: false,
      motivo: 'ubii_ajeno',
      detalle: delPago
        ? `Pago por Ubii a nombre de la cédula ${delPago}, que no es la registrada por el jugador.`
        : 'Pago por Ubii sin cédula legible del ordenante.',
    };
  }

  // Sin nada que comparar de este lado: no se castiga a nadie por una
  // foto que el OCR no supo leer (BDT y Banco del Tesoro ni siquiera
  // muestran al que paga).
  if (!actual.ancla && !actual.banco) return { ok: true };

  // Mismo tipo de dato en los dos lados: se comparan los dígitos.
  if (huella.ancla && actual.ancla && huella.ancla_tipo === actual.ancla_tipo) {
    if (huella.ancla === actual.ancla) return { ok: true };
    const cambioBanco = huella.banco && actual.banco && huella.banco !== actual.banco;
    return {
      ok: false,
      motivo: cambioBanco ? 'banco_distinto' : 'cuenta_distinta',
      detalle: cambioBanco
        ? `Pagó desde ${actual.banco} (…${actual.ancla}); siempre paga desde ${huella.banco} (…${huella.ancla}).`
        : `Pagó desde una cuenta distinta (…${actual.ancla}); la suya termina en …${huella.ancla}.`,
    };
  }

  // Tipos distintos o falta un ancla: queda el banco.
  if (huella.banco && actual.banco && huella.banco !== actual.banco) {
    return {
      ok: false,
      motivo: 'banco_distinto',
      detalle: `Pagó desde ${actual.banco}; siempre paga desde ${huella.banco}.`,
    };
  }

  return { ok: true };
}

/**
 * Solo para el PRIMER pago de un jugador, cuando todavía no hay huella
 * con qué comparar la consistencia. Aprovecha que SÍ tenemos sus datos
 * de registro: el comprobante debe venir de algo suyo. Pero el ÚNICO
 * dato de identidad fiable en los recibos venezolanos es la cédula del
 * ordenante, y solo Ubii la muestra:
 *
 *   · Ubii → la cédula del pagador (el único recibo que la trae) contra
 *            la cédula registrada.
 *
 * El teléfono NO se cruza (desactivado el 26/08/2026): en la práctica el
 * recibo casi siempre lo trae ENMASCARADO («04**-***8197») o es en
 * realidad una CUENTA con el código del banco delante («0102****2944»),
 * y además el WhatsApp registrado no siempre es la línea desde la que se
 * paga. Cruzarlo mandaba a revisión pagos legítimos (atención al cliente
 * confirmó varios casos ese día). La CONSISTENCIA del origen se sigue
 * exigiendo a partir del 2.º pago (`comparar`), y la referencia repetida
 * se detecta aparte, así que no se pierde la protección real.
 *
 * Si no es Ubii, o el jugador no tiene cédula registrada, o el recibo no
 * trae cédula legible, devuelve ok: no se castiga a nadie por lo que no
 * se puede leer ni por lo que no hay con qué cruzar de forma fiable.
 */
export function identidadPrimerPago(
  actual: Huella,
  datos: { esUbii: boolean; origin_cedula: string | null; origin: string | null },
  registro: { cedula: string | null; telefonos: (string | null | undefined)[] }
): Veredicto {
  // Ubii: el recibo trae la cédula del que paga. Tiene que ser la suya.
  if (datos.esUbii) {
    const suya = soloDigitos(registro.cedula);
    const delPago = soloDigitos(datos.origin_cedula);
    if (!suya || !delPago) return { ok: true };
    if (delPago.endsWith(suya.slice(-7))) return { ok: true };
    return {
      ok: false,
      motivo: 'ubii_ajeno',
      detalle: `Primer pago por Ubii a nombre de la cédula ${delPago}, que no es la registrada por el jugador.`,
    };
  }

  // Cualquier otro banco: sin un dato de pagador fiable, nada que cruzar.
  // El primer pago siembra la huella y desde el 2.º manda `comparar`.
  return { ok: true };
}

/** Cómo se le cuenta al equipo en el panel */
export const MOTIVO_TEXTO: Record<string, string> = {
  banco_distinto: '🏦 Pagó desde otro banco',
  cuenta_distinta: '🏦 Pagó desde otra cuenta',
  ubii_ajeno: '🏦 Pago por Ubii de un tercero',
  tel_ajeno: '📱 Pagó desde un teléfono que no es el suyo',
};

/** El mensaje que el equipo le manda por el chat de un clic cuando
 *  salta la regla. Es la respuesta más frecuente, así que conviene que
 *  sea siempre la misma y esté bien escrita. */
export const AVISO_ORIGEN_CHAT =
  'Hola 👋 Vimos que tu último pago lo hiciste desde un banco distinto al que usas normalmente, ' +
  'así que lo pusimos en revisión. Por seguridad, los pagos deben hacerse siempre desde la misma ' +
  'cuenta bancaria que usaste la primera vez. Si esa cuenta es tuya también, escríbenos por aquí y ' +
  'lo revisamos. Igualmente es importante que sus próximas recargas las haga siempre desde una misma cuenta 🙌';

/** Lo que ve el JUGADOR. No se le dan detalles del origen: es una
 *  conversación de atención al cliente, no un aviso automático (misma
 *  política que el resto de notas internas, ver constants.ts). */
export const ORIGEN_MSG_JUGADOR =
  'Tu pago está en revisión. Recuerda que debes pagar siempre desde la misma cuenta bancaria que usaste la primera vez.';
