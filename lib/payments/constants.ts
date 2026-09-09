import { TICKET_COST } from '@/lib/game/constants';
import { cleanEnv } from '@/lib/supabase/env';
import { PurchaseStatus, WithdrawalStatus } from '@/types/game';

// 1 ticket = 1 partida = TICKET_COST de la lógica RTP/RNG ($2.00).
export const TICKET_PRICE_USD = TICKET_COST;

export const MAX_TICKETS_PER_PURCHASE = 50;
export const MIN_WITHDRAWAL_USD = 1;

// Referencia del pago: mínimo 6 DÍGITOS (los últimos 6 del recibo).
// Con menos no se puede identificar el pago: cuatro cifras se repiten
// entre transferencias distintas y la conciliación se vuelve adivinar.
export const MIN_REFERENCE_DIGITS = 6;
export const MAX_REFERENCE_LENGTH = 40;
/** Dígitos útiles de una referencia (ignora espacios, guiones, letras) */
export const referenceDigits = (value: string) => value.replace(/\D/g, '').length;
export const isReferenceValid = (value: string) =>
  referenceDigits(value) >= MIN_REFERENCE_DIGITS && value.trim().length <= MAX_REFERENCE_LENGTH;

// Comprobante del pago: OBLIGATORIO. Sin la captura no hay forma de
// verificar el pago ni de aclarar una referencia repetida, así que la
// compra no se registra sin ella.
// Vercel corta las peticiones por encima de ~4,5 MB; el navegador
// además reduce la imagen antes de enviarla, así que en la práctica
// pesa unos cientos de KB.
export const MAX_PROOF_SIZE = 4 * 1024 * 1024;
export const PROOF_REQUIRED_MSG =
  'Adjunta la captura de tu pago: sin el comprobante no podemos verificarlo.';
export const PROOF_TOO_BIG_MSG =
  'La imagen pesa demasiado (máximo 4 MB). Manda una captura de pantalla en vez de la foto original.';
export const PROOF_NOT_IMAGE_MSG =
  'El comprobante debe ser una imagen (captura de pantalla o foto).';

// Interruptor de la validación automática contra la Bank API.
// Del 10/08 al 15/08/2026 estuvo en false (decisión del jefe: todo a
// mano) porque la validación anterior no funcionaba.
// Ponerlo en false devuelve el sistema al manual puro: ni una consulta.
export const BANK_VALIDATION_ENABLED = true;

// MODO SOMBRA: con la validación encendida, la conciliación hace todo
// el trabajo (lee el estado de cuenta, empareja, aplica las reglas)
// pero NO reclama ni aprueba nada: solo deja el informe de lo que
// habría hecho. Es el paso intermedio antes de soltarla de verdad.
//
// ENCENDIDA DE VERDAD el 15/08/2026 (sombra a false): la conciliación
// acredita sola las compras que pasan TODAS las reglas. Se soltó con
// 6 de 6 aciertos medidos y ningún fallo. Lo que NO casa se queda
// pendiente para el equipo: el sistema no rechaza nunca por su cuenta.
//
// Volver a poner true si hace falta mirar sin tocar: la conciliación
// sigue corriendo (y manteniendo fresco el estado de cuenta, que la
// API solo entra al banco cuando se le llama) pero no aprueba.
//
// Ver el informe: GET /api/cron/revalidate?key=CRON_SECRET&informe=1
export const BANK_SHADOW_MODE = false;

// ── Regla de origen: cada jugador paga siempre desde el mismo sitio ──
// Con esto encendido, un pago hecho desde otro banco (o desde otra
// cuenta del mismo banco) NO se rechaza: nace 'pendiente' y lo mira
// una persona desde el panel, que puede aprobarlo, rechazarlo o
// escribirle al jugador. Es lo que cierra la puerta a las estafas
// triangulares.
//
// Medido sobre TODO el histórico (1040 pagos, 373 jugadores) antes de
// encenderla: habría mandado a revisión 18 pagos (1,7%), de 10
// jugadores (2,7%). Poco más de una revisión al día.
//
// Apagarlo devuelve el sistema a como estaba: se sigue GUARDANDO de
// dónde vino cada pago (eso es de la fase 1 y no depende de esto),
// pero ninguna compra se detiene por el origen.
export const ORIGIN_RULE_ENABLED = process.env.ORIGIN_RULE_ENABLED !== 'false';

// ── Cuenta bancaria de la app (cerrojo doble) ──
// La Bank API es MULTICUENTA: también sirve a otra app con otra
// cuenta. Del 10/08 al 14/08 estuvimos apuntando por error a la cuenta
// de la otra app (se cambió el Pago Móvil y no el account_name), así
// que ahora todo movimiento se comprueba contra estas dos constantes
// antes de tocarlo. Si cambia la cuenta, se cambian las dos aquí Y la
// variable BANK_API_ACCOUNT_NAME (en .env.local y en Vercel).
// ⚠️ ESTAS DOS VAN EN EL ENTORNO, NO EN EL CÓDIGO, Y NO TIENEN VALOR POR
// DEFECTO. Es la diferencia más importante entre este juego y su hermano.
//
// La Bank API es MULTICUENTA y La Llave Correcta ya la usa. Reclamar un
// movimiento lo marca como usado (set_used=true) y se lo queda quien llegue
// primero: si los dos juegos apuntaran a la misma cuenta, un pago hecho para
// comprar tickets de La Llave se lo quedaría Mis Cartones y aquel jugador se
// quedaría sin sus tickets. No es un riesgo teórico — en La Llave, del 10 al
// 14 de agosto de 2026, se apuntó por error a la cuenta de otra app, y por
// eso existe este cerrojo doble.
//
// Sin las dos variables puestas, la validación automática NO se enciende
// (ver isBankApiConfigured): las compras quedan esperando aprobación a mano,
// que es el único modo seguro de fallar aquí.
export const BANK_ACCOUNT_NAME_ESPERADO = cleanEnv(process.env.BANK_ACCOUNT_NAME_ESPERADO);
export const BANK_CUENTA_ESPERADA = cleanEnv(process.env.BANK_CUENTA_ESPERADA);

// ── Reglas del emparejamiento ──
/** Dígitos finales de la referencia que se comparan. El banco guarda
 *  su propia referencia interna: solo la cola coincide con el recibo
 *  del jugador. */
export const REFERENCE_TAIL = 6;
/** Los últimos dígitos de una referencia, sin espacios ni guiones.
 *  Es la forma canónica: se usa para emparejar Y para detectar
 *  repetidas (si no, «124754» y «6124754» parecen distintas siendo el
 *  mismo pago — pasó el 15/08/2026 y las dos se aprobaron). */
export const referenceTail = (v: string) => String(v ?? '').replace(/\D/g, '').slice(-REFERENCE_TAIL);
/** Tolerancia del monto, en Bs, por arriba y por abajo. Cubre a quien
 *  redondea al transferir (debía 1.542,14 y manda 1.542 o 1.543). */
export const amountTolerance = (esperado: number) => Math.max(0.5, esperado * 0.005);

/** Día (AAAA-MM-DD) en hora de Venezuela. El banco lista sus
 *  movimientos en hora local: preguntarle por el día UTC pierde todos
 *  los pagos de la noche, porque a las 8 pm en Caracas ya es el día
 *  siguiente en UTC. */
export const diaCaracas = (fecha: string | number | Date) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Caracas',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(fecha));
/** El movimiento no puede ser más viejo que esto respecto a la compra
 *  (el jugador paga y después registra: 24 h cubre al que pagó anoche). */
export const MATCH_WINDOW_BEFORE_MS = 24 * 60 * 60 * 1000;
/** …ni posterior por más de esto (reloj del banco algo adelantado). */
export const MATCH_WINDOW_AFTER_MS = 2 * 60 * 60 * 1000;

// ── Lo único que se le cuenta al jugador sobre su pago ──
// Decisión del 15/08/2026: al jugador solo le llegan DOS mensajes —
// pago aprobado, o pago rechazado por estar duplicado. Todo lo demás
// (que falte o sobre dinero, referencias raras, que el banco no lo
// refleje todavía) se lleva DENTRO, desde el panel: son conversaciones
// de atención al cliente, no avisos automáticos.
//
// Por eso las notas internas NO viajan al navegador del jugador: se
// sustituyen por esto antes de responderle (ver /api/wallet,
// /api/purchases y /api/notifications).
export const esRechazoPorDuplicado = (nota?: string | null) =>
  !!nota && /duplicad|referencia repetida/i.test(nota);

export const NOTA_DUPLICADO_JUGADOR = 'Ese pago ya estaba registrado en otra compra.';

/** La nota de una compra tal como puede verla el jugador. null = no se
 *  le enseña nada (el equipo lo resuelve por dentro). */
export const notaParaJugador = (status: string, nota?: string | null): string | null =>
  status === 'rechazado' && esRechazoPorDuplicado(nota) ? NOTA_DUPLICADO_JUGADOR : null;

/** Deja una compra lista para responder al jugador, sin notas internas */
export function compraParaJugador<T extends { status: string; status_note?: string | null }>(
  compra: T
): T {
  return { ...compra, status_note: notaParaJugador(compra.status, compra.status_note) };
}

// Marca en status_note de las compras con referencia repetida:
// esas compras son SIEMPRE de revisión manual (la validación
// automática las salta para no reclamar el pago de otra compra).
export const DUPLICATE_MARKER = '⚠ Referencia repetida';

// Marca de las compras que llegaron desde un banco o una cuenta que no
// es la habitual del jugador (regla de origen, migración 031). Igual
// que la de repetida: empieza la nota a propósito, porque es lo que
// mira la conciliación para no aprobarlas sola.
export const ORIGEN_MARCADOR = '🏦 Origen distinto';

/**
 * Compras que la validación automática NO puede aprobar por su cuenta,
 * pase lo que pase en el banco: tiene que verlas una persona.
 *
 * Son dos casos y por motivos distintos:
 *  - Referencia repetida: aprobarla podría reclamar en el banco el
 *    pago que pertenece a OTRA compra.
 *  - Origen distinto: el pago existe y el banco lo confirmaría, pero
 *    justo por eso hay que pararlo — si la conciliación lo acredita
 *    sola, la regla contra las triangulaciones no sirve de nada.
 */
export const esRevisionSoloManual = (nota?: string | null) =>
  !!nota && (nota.startsWith(DUPLICATE_MARKER) || nota.startsWith(ORIGEN_MARCADOR));

/** Nota de anomalía para una compra cuya referencia ya usa otra.
 *  La escriben los DOS caminos por los que puede aparecer una
 *  repetida: al registrarla el jugador y al corregirla el equipo
 *  desde el panel. Empieza por DUPLICATE_MARKER a propósito: es lo
 *  que mira la conciliación para no tocarla nunca. */
export function notaDuplicado(otras: { status: string; created_at: string }[]): string {
  // La fecha, en hora de Venezuela: el servidor corre en UTC y un pago
  // de las 9 de la noche saldría fechado el día siguiente.
  const lista = otras
    .map(
      (d) =>
        `${d.status} · ${new Date(d.created_at).toLocaleDateString('es-VE', {
          timeZone: 'America/Caracas',
          day: '2-digit',
          month: 'short',
        })}`
    )
    .join(', ');
  return (
    `${DUPLICATE_MARKER}: ya aparece en ${otras.length} compra(s) más (${lista}). ` +
    'Si el pago vino de OTRO banco puede ser válida: verifícala contra el banco antes de aprobar.'
  );
}

// Datos de Pago Móvil a donde paga el jugador (se muestran en el
// modal de compra). Si cambian, se editan aquí.
export const PAYMENT_DESTINATION = {
  banco: 'Banco de Venezuela',
  telefono: '04220166113',
  cedula: '18033691',
  concepto: 'Mis Cartones',
} as const;

export const PURCHASE_STATUS_LABEL: Record<PurchaseStatus, string> = {
  pendiente: 'Pendiente',
  validando: 'Validando',
  aprobado: 'Aprobado',
  rechazado: 'Rechazado',
};

export const WITHDRAWAL_STATUS_LABEL: Record<WithdrawalStatus, string> = {
  pendiente: 'En proceso',
  pagado: 'Pagado',
  cancelado: 'Cancelado',
};

// Bancos para el formulario "Datos para recibir tus premios"
export const VE_BANKS = [
  'Banco de Venezuela',
  'Banesco',
  'Banco Mercantil',
  'BBVA Provincial',
  'Banco Nacional de Crédito (BNC)',
  'Banco del Tesoro',
  'Banco Bicentenario',
  'Bancamiga',
  'Banco Exterior',
  'Banco Fondo Común',
  'BanCaribe',
  'Banco Activo',
  'Banplus',
  'Mi Banco',
  'Banco Plaza',
  '100% Banco',
  'Bancrecer',
  'Banfanb',
  'Banco Caroní',
  'Banco Sofitasa',
  'Venezolano de Crédito',
] as const;
