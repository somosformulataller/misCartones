// Conciliación de pagos contra el estado de cuenta del banco
// (nuevoPlanValidacionPagos.md, secciones 3 y 4).
//
// Una sola pasada, una sola entrada al banco:
//   1. LATIDO   — un /transaction/validate sin reclamar, que obliga a
//                 la API a bajar el estado de cuenta fresco.
//   2. LEER     — el estado de cuenta guardado (gratis).
//   3. EMPAREJAR— todas las compras pendientes contra esa lista.
//   4. RECLAMAR y APROBAR las que pasan TODAS las reglas.
//
// Antes se preguntaba al banco pago por pago y por cada reintento del
// jugador: 429 en bucle y esperas de más de una hora. Ahora da igual
// que haya 1 o 40 pendientes: el banco recibe una visita por pasada.

import { createAdminClient, isAdminClientConfigured } from '@/lib/supabase/admin';
import { SaludValidacion } from '@/types/game';
import {
  buscarPorReferencia,
  esCuentaNuestra,
  isBankApiConfigured,
  Latido,
  leerEstadoDeCuenta,
  Movimiento,
  reclamarMovimiento,
  refrescarEstadoDeCuenta,
} from './bankApi';
import {
  BANK_SHADOW_MODE,
  BANK_VALIDATION_ENABLED,
  diaCaracas,
  esRevisionSoloManual,
  MATCH_WINDOW_AFTER_MS,
  MATCH_WINDOW_BEFORE_MS,
  REFERENCE_TAIL,
  amountTolerance,
  referenceTail,
} from './constants';

/** Compra pendiente, lo mínimo que hace falta para emparejar */
export interface CompraPendiente {
  id: string;
  reference: string;
  amount_ves: number | null;
  created_at: string;
  status_note?: string | null;
  /** Tasa BCV con la que se calculó el precio (para explicar cuánto
   *  falta en bolívares Y en dólares cuando el monto no cuadra) */
  exchange_rate_used?: number | null;
}

const bs = (n: number) =>
  `Bs. ${n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Con cuál de las compras pendientes se manda el latido: la primera
 * que NO esté ya en el estado de cuenta. Preguntar por una que la API
 * ya tiene guardada devuelve 200 en 0,4 s sin entrar al banco, y la
 * pasada se gasta sin traer nada (medido el 16/08/2026).
 *
 * Las de referencia demasiado corta no sirven de latido: no se puede
 * garantizar el fallo con tres dígitos, y de todas formas esas compras
 * son de revisión manual.
 *
 * `undefined` = no hace falta latido: todos los pagos pendientes ya
 * están en la cola, así que no hay nada nuevo que traer del banco.
 * Puro, sin red: por eso se puede probar solo.
 */
export function elegirLatido(
  pendientes: CompraPendiente[],
  movimientos: Movimiento[]
): CompraPendiente | undefined {
  return pendientes.find((compra) => {
    const cola = referenceTail(compra.reference);
    if (cola.length < REFERENCE_TAIL) return false;
    return !movimientos.some((m) => String(m.referencia).endsWith(cola));
  });
}

/**
 * Una cola de 6 dígitos que NINGÚN movimiento de la cola tiene, para
 * usarla como latido. La API solo entra al banco cuando NO encuentra
 * la referencia que se le pide: con una que no puede existir, el fallo
 * —y por tanto la descarga del estado de cuenta— está garantizado.
 *
 * Es la manera de pedirle «bájate el estado de cuenta» a una API que no
 * tiene esa puerta. Medido el 16/08/2026: referencia 100000, HTTP 404
 * en 19,5 s, la cola pasó de 94 a 95 movimientos con un pago que
 * acababa de entrar. Con set_used=false no se reclama nada.
 *
 * Antes se mandaba la referencia REAL de una compra pendiente, y si la
 * API ya la tenía guardada respondía de su tabla en 0,4 s sin asomarse
 * al banco: así se congeló la cola 109 minutos ese mismo día.
 *
 * Puro, sin red: por eso se puede probar solo.
 */
export function referenciaImposible(movimientos: Movimiento[]): string {
  const usadas = new Set(movimientos.map((m) => referenceTail(String(m.referencia))));
  for (let n = 100000; n <= 999999; n++) {
    const cola = String(n);
    if (!usadas.has(cola)) return cola;
  }
  return '100000'; // inalcanzable: harían falta 900.000 movimientos
}

/**
 * A partir de aquí, la llamada al banco tardó demasiado como para
 * haberse contestado de memoria: hubo sesión en el banco de verdad.
 * Medido el 16/08/2026 — respuesta de su propia tabla: 0,4 s;
 * respuestas con scrapeo: 18,0 · 18,4 · 19,5 · 26,7 · 32,8 · 61,5 s.
 * El hueco entre los dos mundos es enorme, así que 5 s no se presta a
 * discusión.
 */
const ENTRADA_MIN_MS = 5_000;

/**
 * Si el latido ENTRÓ al banco o le contestaron de memoria.
 *
 * No se puede deducir del código HTTP. Con una referencia imposible —
 * comprobado que ningún movimiento termina en ella — la API devuelve
 * unas veces 404 y otras 200, por algo que no controlamos ni nos
 * incumbe. Lo que no engaña es el reloj: abrir sesión en el banco no
 * baja de 18 s y contestar de su tabla no pasa de medio segundo.
 *
 * Importa porque es la cifra que mira el panel para avisar de que la
 * cola se congeló, y el 16/08/2026 el panel dijo «0 entradas» un día
 * en el que hubo cuatro.
 *
 * Puro: por eso se puede probar solo.
 */
export function clasificarLatido(latido: Latido, ms: number): Latido {
  if (latido !== 'scrapeada' && latido !== 'encontrada') return latido;
  return ms >= ENTRADA_MIN_MS ? 'scrapeada' : 'encontrada';
}

/** Cuánto atrás se mira para saber qué pagos ya se gastaron. Un
 *  movimiento solo puede pagar compras de las 24 h siguientes, así que
 *  con tres días sobra y la consulta sigue siendo de dos dígitos. */
const CONSUMIDOS_WINDOW_MS = 72 * 60 * 60 * 1000;

/**
 * REGISTRO DE CASA: los movimientos que YA pagaron una compra nuestra,
 * según nuestra propia base.
 *
 * Hasta el 16/08/2026 el único sitio donde constaba «este pago ya se
 * gastó» era la marca `used` del banco, y las aprobaciones manuales no
 * la ponían: 26 de 68 movimientos aparecían libres teniendo su dinero
 * ya convertido en tickets, y la automática los podía volver a tomar
 * durante 24 h. Ahora la app lo sabe por sí sola, sin depender de que
 * el banco esté marcado.
 *
 * Ante cualquier fallo devuelve vacío: se pierde esta defensa, pero
 * siguen en pie la marca del banco y el resto de reglas.
 */
export async function movimientosConsumidos(
  admin: ReturnType<typeof createAdminClient>
): Promise<Set<number>> {
  const ids = new Set<number>();
  try {
    const { data } = await admin
      .from('ticket_purchases')
      .select('bank_response')
      .eq('status', 'aprobado')
      .not('bank_response', 'is', null)
      .gte('created_at', new Date(Date.now() - CONSUMIDOS_WINDOW_MS).toISOString())
      .limit(500);
    for (const fila of data ?? []) {
      const id = (fila.bank_response as { id?: unknown } | null)?.id;
      if (typeof id === 'number') ids.add(id);
    }
  } catch {}
  return ids;
}

/**
 * Explica una diferencia de monto en plata contante: cuántos bolívares
 * faltan (o sobran), cuánto es eso en dólares a la tasa del día, y qué
 * se pagó frente a qué se pedía. Sin esto la nota decía "el monto no
 * coincide" y no había forma de saber si faltaban 2 bolívares o 800.
 */
function explicarMonto(pagado: number, esperado: number, tasa?: number | null): string {
  const dif = Math.abs(pagado - esperado);
  const enDolares =
    tasa && tasa > 0
      ? ` (${(dif / tasa).toLocaleString('es-VE', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })} $ a la tasa de hoy, ${bs(tasa)}/$)`
      : '';
  const verbo = pagado < esperado ? 'Faltan' : 'Sobran';
  return `${verbo} ${bs(dif)}${enDolares}. Pagó ${bs(pagado)} y la compra era de ${bs(esperado)}.`;
}

export type ResultadoEmparejamiento =
  | { estado: 'ok'; movimiento: Movimiento }
  | { estado: 'sin_referencia' }
  | { estado: 'no_encontrado' }
  /** El pago está en el estado de cuenta pero ya figura usado (reclamado
   *  por otra compra, por la otra app, o un reclamo nuestro que no llegó
   *  a acreditar). El banco jamás lo va a soltar: revisión manual. */
  | { estado: 'pago_usado'; movimiento: Movimiento; detalle: string }
  | { estado: 'sin_tasa'; movimiento: Movimiento }
  | { estado: 'monto_no_cuadra'; movimiento: Movimiento; detalle: string }
  | { estado: 'monto_de_mas'; movimiento: Movimiento; detalle: string }
  | { estado: 'ambiguo'; detalle: string };

const soloDigitos = (v: string) => String(v ?? '').replace(/\D/g, '');

/**
 * Las reglas, todas juntas y sin efectos secundarios (por eso se puede
 * probar sola). `yaTomados` son los movimientos que ya pagaron una
 * compra —otra de esta misma pasada, o una aprobada antes según el
 * registro de casa (ver movimientosConsumidos)—: un movimiento paga
 * UNA sola compra.
 */
export function emparejar(
  compra: CompraPendiente,
  movimientos: Movimiento[],
  yaTomados: Set<number> = new Set()
): ResultadoEmparejamiento {
  const digitos = soloDigitos(compra.reference);
  if (digitos.length < REFERENCE_TAIL) return { estado: 'sin_referencia' };
  const cola = digitos.slice(-REFERENCE_TAIL);
  const tCompra = Date.parse(compra.created_at);

  const conEsaCola = movimientos.filter((m) => {
    if (!esCuentaNuestra(m)) return false;            // 1 y 2: cerrojo doble
    if (m.tipo !== 'CREDITO') return false;            // 4: solo entradas
    if (!String(m.referencia).endsWith(cola)) return false; // 6: cola de 6
    const t = Date.parse(m.fecha);                     // 7: ventana de tiempo
    if (!Number.isFinite(t)) return false;
    return t >= tCompra - MATCH_WINDOW_BEFORE_MS && t <= tCompra + MATCH_WINDOW_AFTER_MS;
  });

  const candidatos = conEsaCola.filter(
    (m) => !m.used && !yaTomados.has(m.id) // 3 y 8: libre, y uno por compra
  );

  if (!candidatos.length) {
    // «No encontrado» y «encontrado pero gastado» son cosas MUY
    // distintas. Si el pago está en el estado de cuenta pero ya figura
    // usado, esperar al banco es esperar en balde: el cron jamás lo va
    // a poder tomar. Que pase YA a revisión manual, no en dos horas.
    if (conEsaCola.length) {
      const m = conEsaCola[0];
      return {
        estado: 'pago_usado',
        movimiento: m,
        detalle: `El pago de ${bs(m.monto)} (ref ${m.referencia}) ya figura usado en el banco: pudo reclamarlo otra compra o quedar reclamado sin acreditar.`,
      };
    }
    return { estado: 'no_encontrado' };
  }

  // Sin tasa BCV al comprar no hay monto que comparar: lo ve el equipo
  if (compra.amount_ves === null) return { estado: 'sin_tasa', movimiento: candidatos[0] };

  const esperado = Number(compra.amount_ves);
  const tolerancia = amountTolerance(esperado);
  // 5: el monto cuadra por arriba Y por abajo. La tolerancia cubre al
  // que redondea al transferir (1.542,14 → 1.542 ó 1.543). Pagar de
  // MÁS tampoco se aprueba solo: si mandó para 3 tickets y registró 1,
  // acreditarle 1 y quemarle el pago es peor que mandarlo a revisión.
  const buenos = candidatos.filter((m) => Math.abs(m.monto - esperado) <= tolerancia);

  if (!buenos.length) {
    // Se elige el movimiento MÁS PARECIDO al esperado: si el jugador
    // hizo varios pagos con la misma cola, la nota debe hablar del que
    // más se acerca, no del primero que apareció.
    const m = candidatos.reduce((a, b2) =>
      Math.abs(b2.monto - esperado) < Math.abs(a.monto - esperado) ? b2 : a
    );
    const detalle = explicarMonto(m.monto, esperado, compra.exchange_rate_used);
    return m.monto > esperado
      ? { estado: 'monto_de_mas', movimiento: m, detalle }
      : { estado: 'monto_no_cuadra', movimiento: m, detalle };
  }
  // 6 (final): si dos movimientos comparten cola Y monto, no se aprueba
  // ninguno — que lo mire el equipo antes que acreditar el equivocado.
  if (buenos.length > 1) {
    return { estado: 'ambiguo', detalle: `${buenos.length} movimientos comparten esa referencia y monto` };
  }
  return { estado: 'ok', movimiento: buenos[0] };
}

/**
 * Cuánto se espera a que el banco refleje un pago antes de mandarlo a
 * revisión manual (al filtro «Pendientes» del panel). El banco suele
 * tardar 1–2 minutos; pasado este rato lo más probable es que el pago
 * no exista (referencia mal copiada, transferencia que no se completó,
 * o pagó desde otro banco). Dejarlo «esperando al banco» es dejar al
 * jugador colgado sin que nadie lo mire: mejor que atención al cliente
 * lo vea y decida cuanto antes. El cron NO deja de intentar por esto:
 * si el banco termina reflejando el pago, se acredita solo igual (solo
 * cambia dónde lo ve el equipo mientras tanto).
 *
 * 31/08/2026: subido de 5 a 10 min. BDV tuvo varios baches en los que
 * el estado de cuenta se congelaba 15–20 min y pagos legítimos entraban
 * a los 6–9 min; con el límite en 5 se mandaban a manual pagos que iban
 * a acreditarse solos. 10 min cubre esos baches sin dejar al jugador
 * colgado demasiado.
 */
const MINUTOS_ANTES_DE_MANUAL = 10;

/** La nota que manda la compra al filtro de revisión manual del equipo.
 *  El panel decide el filtro mirando si la nota habla de un
 *  «administrador» (ver isAutoRetryable en app/api/admin/payments). */
const NOTA_NO_APARECE =
  'No encontramos tu pago en el banco. Un administrador lo revisará.';

// Caso «el pago SÍ existe pero cae fuera de la ventana de 24h»: el
// jugador pagó hace días y registró la compra hoy (o la referencia
// coincide por casualidad con un pago viejo). La validación no lo puede
// tomar sola —por eso mismo existe la ventana—, pero SÍ deja escrito
// que el pago aparece y por qué no se acreditó, para que atención al
// cliente no lea «sin rastro» cuando el dinero está. Lleva
// «administrador» a propósito: es lo que lo manda al filtro manual del
// panel (isAutoRetryable). El MARCA_ sirve para no volver a consultar la
// API en cada pasada una vez anotada.
const NOTA_FUERA_VENTANA = 'Un administrador debe revisar este pago.';
const MARCA_FUERA_VENTANA = 'Pago fuera de ventana:';

// Lo que ve el jugador según cómo terminó su compra
const NOTAS: Record<string, string> = {
  no_encontrado: 'El banco aún no refleja el pago (suele tardar 1–2 minutos).',
  pago_usado: 'Tu pago necesita una comprobación extra. Un administrador lo revisará.',
  sin_referencia: 'La referencia no tiene suficientes dígitos. Un administrador la revisará.',
  sin_tasa: 'No había tasa BCV al registrar la compra. Un administrador la revisará.',
  monto_no_cuadra: 'Tu pago no cubre el total de la compra. Un administrador lo revisará.',
  monto_de_mas: 'Pagaste más de lo que costaban esos tickets. Un administrador lo revisará.',
  ambiguo: 'Tu pago necesita una comprobación extra. Un administrador lo revisará.',
  no_reclamado: 'El banco está tardando en responder — seguimos verificando tu pago.',
};

/**
 * Busca en TODO el histórico del banco un pago con la misma cola de
 * referencia que la compra pero FUERA de la ventana de emparejamiento
 * (más de 24 h antes, o más de 2 h después). Es el caso del jugador que
 * pagó hace días y registró la compra hoy: el emparejador no lo ve
 * (filtra por fecha, y además el pago viejo suele quedar fuera de los
 * 200 movimientos recientes). Devuelve el movimiento para poder
 * explicarlo, o null si no hay ninguno. No entra al banco (lectura
 * filtrada).
 */
async function movimientoFueraDeVentana(compra: CompraPendiente): Promise<Movimiento | null> {
  const cola = soloDigitos(compra.reference).slice(-REFERENCE_TAIL);
  if (cola.length < REFERENCE_TAIL) return null;
  const tCompra = Date.parse(compra.created_at);
  const movs = await buscarPorReferencia(cola);
  return (
    movs.find((m) => {
      if (m.tipo !== 'CREDITO') return false;
      if (!String(m.referencia).endsWith(cola)) return false;
      const t = Date.parse(m.fecha);
      if (!Number.isFinite(t)) return false;
      // fuera de la ventana por CUALQUIER lado
      return t < tCompra - MATCH_WINDOW_BEFORE_MS || t > tCompra + MATCH_WINDOW_AFTER_MS;
    }) ?? null
  );
}

export interface InformeConciliacion {
  ok: boolean;
  motivo?: string;
  sombra?: boolean;
  /** Cómo fue la entrada al banco: ok / enfriamiento (429) / error */
  latido?: Latido;
  /** Movimientos de NUESTRA cuenta leídos del estado de cuenta */
  movimientos?: number;
  /** Momento del scrapeo más reciente: si se queda atrás, la cola está
   *  congelada y no hay nada que emparejar. */
  cola_al_dia?: string | null;
  pendientes?: number;
  aprobadas?: number;
  detalle?: { compra: string; referencia: string; estado: string; movimiento?: string; nota?: string }[];
}

/**
 * La pasada completa. La llama el cron cada minuto (y se puede llamar
 * a mano para ver el informe). Nunca lanza: ante cualquier problema
 * deja las compras pendientes, que es el estado seguro.
 */
export async function conciliarPendientes(): Promise<InformeConciliacion> {
  const t0 = Date.now();
  const informe = await pasada();
  await anotarPasada(informe, Date.now() - t0);
  return informe;
}

/** Cuánto se guarda el diario de pasadas */
const RETENCION_PASADAS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Deja constancia de la pasada, haya habido trabajo o no.
 *
 * Es lo único que permite saber después si el cron llamó. El endpoint
 * responde 200 al instante y trabaja luego, así que el historial de
 * cron-job.org solo dice «la llamada llegó»; y las notas de trámite de
 * las compras se borran al aprobar. El 15/08/2026 hubo diez horas sin
 * refrescar el banco y no quedó un solo rastro con el que cerrarlo.
 *
 * Nunca estorba: si falla al escribir, la conciliación sigue.
 */
async function anotarPasada(informe: InformeConciliacion, ms: number) {
  if (!isAdminClientConfigured()) return;
  try {
    const admin = createAdminClient();
    await admin.from('cron_pasadas').insert({
      ok: informe.ok,
      motivo: informe.motivo ?? null,
      latido: informe.latido ?? null,
      movimientos: informe.movimientos ?? null,
      cola_al_dia: informe.cola_al_dia ?? null,
      pendientes: informe.pendientes ?? null,
      aprobadas: informe.aprobadas ?? null,
      ms,
    });
    // Purga UNA vez por hora (minuto 7), no en cada pasada
    if (new Date().getUTCMinutes() === 7) {
      await admin
        .from('cron_pasadas')
        .delete()
        .lt('created_at', new Date(Date.now() - RETENCION_PASADAS_MS).toISOString());
    }
  } catch {}
}

/** Cuántas pasadas se miran para el semáforo del panel (~3 horas) */
const PASADAS_PARA_SALUD = 180;

/**
 * Resumen del diario para el panel. Devuelve null si la tabla todavía
 * no existe (migración 018 sin correr): el panel simplemente no
 * enseña el bloque, nada se rompe.
 */
export async function saludValidacion(
  admin: ReturnType<typeof createAdminClient>
): Promise<SaludValidacion | null> {
  try {
    const { data, error } = await admin
      .from('cron_pasadas')
      .select('created_at, latido, cola_al_dia, aprobadas')
      .order('created_at', { ascending: false })
      .limit(PASADAS_PARA_SALUD);
    if (error || !data?.length) return null;

    const min = (desde: string) => Math.round((Date.now() - Date.parse(desde)) / 60_000);
    // Vienen de la más nueva a la más vieja: el hueco es el salto
    // entre cada una y la anterior en el tiempo.
    let hueco = 0;
    let huecoDesde: string | null = null;
    for (let i = 0; i < data.length - 1; i++) {
      const salto = (Date.parse(data[i].created_at) - Date.parse(data[i + 1].created_at)) / 60_000;
      if (salto > hueco) {
        hueco = salto;
        huecoDesde = data[i + 1].created_at;
      }
    }

    return {
      ultima: data[0].created_at,
      minutos: min(data[0].created_at),
      cola_al_dia: data[0].cola_al_dia ?? null,
      cola_minutos: data[0].cola_al_dia ? min(data[0].cola_al_dia) : null,
      hueco_min: huecoDesde ? Math.round(hueco) : null,
      hueco_desde: huecoDesde,
      pasadas: data.length,
      ventana_min: min(data[data.length - 1].created_at),
      // El 429 NO se cuenta como fallo: es el enfriamiento normal de la
      // API (~3 min por cuenta). Mezclarlos ponía feo el panel justo
      // cuando el sistema trabajaba bien.
      latido_error: data.filter((p) => p.latido === 'error').length,
      enfriamientos: data.filter((p) => p.latido === 'enfriamiento').length,
      // Pasadas en las que se ENTRÓ al banco de verdad (ver
      // clasificarLatido: se distingue por lo que tardó, no por el
      // código HTTP). Es la cifra que separa «miramos y no había nada
      // nuevo» de «ni nos asomamos», que es lo que pasó el 16/08/2026.
      entradas: data.filter((p) => p.latido === 'scrapeada').length,
      aprobadas: data.reduce((s, p) => s + (p.aprobadas ?? 0), 0),
    };
  } catch {
    return null;
  }
}

async function pasada(): Promise<InformeConciliacion> {
  if (!BANK_VALIDATION_ENABLED) return { ok: false, motivo: 'validación automática apagada' };
  if (!isBankApiConfigured()) return { ok: false, motivo: 'Bank API no configurada' };

  const admin = createAdminClient();

  // Compras a resolver. Las de revisión 100% manual (referencia
  // repetida o marcadas para el admin) ni se miran.
  const { data: crudas } = await admin
    .from('ticket_purchases')
    .select('id, reference, amount_ves, exchange_rate_used, created_at, status_note')
    .in('status', ['pendiente', 'validando'])
    .gte('created_at', new Date(Date.now() - MATCH_WINDOW_BEFORE_MS).toISOString())
    .order('created_at', { ascending: true })
    .limit(60);

  // Fuera las que solo puede resolver una persona: referencia repetida
  // (aprobarla reclamaría el pago de otra compra) y origen distinto (el
  // pago es real y el banco lo confirmaría, y por eso mismo hay que
  // pararlo: si se acredita solo, la regla contra triangulaciones no
  // sirve de nada).
  const pendientes = ((crudas ?? []) as CompraPendiente[]).filter(
    (p) => !esRevisionSoloManual(p.status_note)
  );
  if (!pendientes.length) return { ok: true, movimientos: 0, pendientes: 0, aprobadas: 0 };

  // 1. Leer la cola guardada (gratis) — ya viene filtrada a nuestra cuenta
  let movimientos = await leerEstadoDeCuenta(200);

  // 2. Latido: UNA entrada al banco por pasada, y con la referencia
  //    ADECUADA. La API solo entra al banco si NO tiene la referencia
  //    guardada; si la tiene, responde de su tabla en 0,4 s y la cola
  //    se queda igual de vieja.
  //
  //    Hasta el 16/08/2026 se preguntaba por la compra pendiente más
  //    antigua, que es justo la más probable de estar ya guardada (las
  //    que llevan ahí clavadas son las de revisión manual, cuyo pago el
  //    banco ya reportó). Resultado medido ese día: 26 minutos de cola
  //    congelada con cuatro compras esperando, dos de ellas con el pago
  //    ya hecho. Se acreditaron solas en cuanto entró un latido de
  //    verdad.
  //
  //    CUÁNDO se manda: cuando hay alguna compra pendiente que no está
  //    en la cola, o sea cuando de verdad falta algo por traer. Si
  //    todas están ya en la cola no se manda nada.
  //
  //    CON QUÉ se manda: con una referencia IMPOSIBLE, no con la de la
  //    compra. Da igual cuál sea la pendiente: lo que necesitamos es
  //    que la API falle, porque el fallo es lo que la obliga a bajar el
  //    estado de cuenta. Preguntando por una referencia real se corre
  //    el riesgo de que la tenga guardada y conteste de memoria; con
  //    una que no puede existir, la descarga está garantizada y la
  //    respuesta es siempre 404 (ver referenciaImposible).
  const desconocida = elegirLatido(pendientes, movimientos);

  let latido: Latido = 'no_hizo_falta';
  if (desconocida) {
    const t0 = Date.now();
    latido = clasificarLatido(
      await refrescarEstadoDeCuenta(referenciaImposible(movimientos), desconocida.created_at),
      Date.now() - t0
    );
    // 3. Releer: el latido acaba de traer lo que hubiera de nuevo
    movimientos = await leerEstadoDeCuenta(200);
  }

  // 3 y 4. Emparejar y resolver. Se arranca con los pagos que ya
  //    acreditaron una compra nuestra: aunque el banco los siga dando
  //    por libres (aprobación a mano que no pudo marcarlos), aquí no
  //    se vuelven a tomar.
  const yaTomados = await movimientosConsumidos(admin);
  const detalle: NonNullable<InformeConciliacion['detalle']> = [];
  let aprobadas = 0;

  for (const compra of pendientes) {
    const r = emparejar(compra, movimientos, yaTomados);
    const fila = {
      compra: compra.id,
      referencia: compra.reference,
      estado: r.estado,
      movimiento: 'movimiento' in r ? `${r.movimiento.referencia} · Bs.${r.movimiento.monto}` : undefined,
    };

    if (r.estado !== 'ok') {
      // NUNCA se rechaza sola: queda pendiente con su motivo. En modo
      // sombra no se toca ni la nota — es de solo lectura.
      // Si el reclamo quedó hecho y solo faltó acreditar, esa nota es
      // más precisa que la genérica de «pago usado»: se conserva.
      const yaExplicada =
        r.estado === 'pago_usado' && compra.status_note?.includes('terminará de acreditarlo');

      // El pago no aparece y ya se esperó bastante: el banco casi nunca
      // tarda tanto, así que lo probable es que ese pago no exista
      // (referencia mal copiada, transferencia sin completar, otro
      // banco). Que salte a revisión manual en vez de seguir esperando
      // en silencio hasta 24 h.
      const esperandoDeMas =
        r.estado === 'no_encontrado' &&
        Date.now() - Date.parse(compra.created_at) > MINUTOS_ANTES_DE_MANUAL * 60_000;

      // Ya anotada como «fuera de ventana»: no se vuelve a consultar la
      // API ni se reescribe. Se queda en el filtro manual del panel.
      const yaFueraDeVentana = compra.status_note?.includes(MARCA_FUERA_VENTANA) ?? false;

      if (!BANK_SHADOW_MODE && !yaExplicada && !yaFueraDeVentana) {
        let nota = esperandoDeMas
          ? NOTA_NO_APARECE
          : (NOTAS[r.estado] ?? NOTAS.no_encontrado);
        let interna = esperandoDeMas
          ? `Sin rastro en el banco tras ${MINUTOS_ANTES_DE_MANUAL} min: ningún movimiento con esa referencia. Pedir el comprobante antes de acreditar.`
          : 'detalle' in r
            ? r.detalle
            : undefined;

        // ¿El pago EXISTE pero cae fuera de la ventana de 24 h? (el
        // jugador pagó hace días y registró la compra hoy). Se comprueba
        // solo cuando ya se esperó bastante; una vez anotada, el
        // MARCA_FUERA_VENTANA evita repetir la consulta en cada pasada.
        if (esperandoDeMas) {
          const viejo = await movimientoFueraDeVentana(compra);
          if (viejo) {
            nota = NOTA_FUERA_VENTANA;
            interna = `${MARCA_FUERA_VENTANA} hay un pago con esa referencia (${bs(viejo.monto)}, del ${diaCaracas(viejo.fecha)}${viejo.used ? ', ya usado' : ''}), fuera de la ventana de 24 h respecto a la compra. Puede ser un pago registrado tarde o una coincidencia de referencia: verificar el comprobante antes de acreditar.`;
          }
        }
        await anotarPendiente(admin, compra, nota, interna);
      }
      detalle.push(esperandoDeMas ? { ...fila, estado: 'no_aparece_revision_manual' } : fila);
      continue;
    }

    yaTomados.add(r.movimiento.id);

    if (BANK_SHADOW_MODE) {
      detalle.push({ ...fila, nota: 'MODO SOMBRA: se habría aprobado' });
      aprobadas++;
      continue;
    }

    // Reclamar primero: si el reclamo falla, no se acredita nada y se
    // reintenta en la siguiente pasada.
    const reclamado = await reclamarMovimiento(r.movimiento);
    if (!reclamado) {
      await anotarPendiente(admin, compra, NOTAS.no_reclamado);
      detalle.push({ ...fila, estado: 'no_reclamado' });
      continue;
    }

    const { error } = await admin.rpc('approve_purchase', {
      p_purchase: compra.id,
      p_origin: 'auto',
      p_bank: r.movimiento as unknown as Record<string, unknown>,
      p_note: null,
    });
    if (error) {
      // El movimiento quedó reclamado pero la compra no se acreditó:
      // que salte a la vista para que el equipo la apruebe a mano.
      console.error('approve_purchase falló tras reclamar', compra.id, error);
      await anotarPendiente(
        admin,
        compra,
        'Tu pago fue verificado; un administrador terminará de acreditarlo.',
        `Pago encontrado en el banco (ref ${r.movimiento.referencia}); falló la acreditación automática.`
      );
      detalle.push({ ...fila, estado: 'reclamado_sin_acreditar' });
      continue;
    }

    aprobadas++;
    detalle.push({ ...fila, nota: 'aprobada' });
  }

  return {
    ok: true,
    sombra: BANK_SHADOW_MODE || undefined,
    latido,
    cola_al_dia: movimientos.map((m) => m.scrapedAt ?? '').sort().at(-1) || null,
    movimientos: movimientos.length,
    pendientes: pendientes.length,
    aprobadas,
    detalle,
  };
}

async function anotarPendiente(
  admin: ReturnType<typeof createAdminClient>,
  compra: CompraPendiente,
  nota: string,
  detalle?: string
) {
  const texto = detalle ? `${nota} ${detalle}` : nota;
  if (compra.status_note === texto) return; // no reescribir lo mismo
  // SOLO si sigue sin resolver. Sin este cerrojo, una pasada lenta que
  // leyó la compra como pendiente podía pisarla DESPUÉS de que otra
  // pasada (o el panel) la aprobara, devolviéndola a pendiente con el
  // ticket ya acreditado — y al aprobarla de nuevo se pagaba doble
  // (pasó el 18/08/2026 con dos pasadas solapadas del cron).
  await admin
    .from('ticket_purchases')
    .update({ status: 'pendiente', status_note: texto })
    .eq('id', compra.id)
    .in('status', ['pendiente', 'validando']);
}

/**
 * Elige qué movimiento del estado de cuenta paga una compra que el
 * equipo aprueba A MANO, para poder reclamarlo. Puro, sin red.
 *
 * A diferencia de `emparejar`, aquí NO se exige que el monto cuadre:
 * si el equipo aprueba un pago corto (pagó Bs. 2.313 por una compra de
 * Bs. 3.084,29) ese movimiento igual se gastó y hay que marcarlo. La
 * identidad del pago es la cola de 6 dígitos; el monto solo sirve para
 * desempatar cuando hay varios candidatos.
 */
export function elegirParaReclamo(
  compra: CompraPendiente,
  movimientos: Movimiento[],
  consumidos: Set<number> = new Set()
): { estado: 'uno'; movimiento: Movimiento } | { estado: 'ninguno' } | { estado: 'varios'; cuantos: number } {
  const digitos = soloDigitos(compra.reference);
  if (digitos.length < REFERENCE_TAIL) return { estado: 'ninguno' };
  const cola = digitos.slice(-REFERENCE_TAIL);
  const tCompra = Date.parse(compra.created_at);

  let candidatos = movimientos.filter((m) => {
    if (!esCuentaNuestra(m)) return false;
    if (m.used) return false;
    if (consumidos.has(m.id)) return false; // ya pagó otra compra nuestra
    if (m.tipo !== 'CREDITO') return false;
    if (!String(m.referencia).endsWith(cola)) return false;
    const t = Date.parse(m.fecha);
    if (!Number.isFinite(t)) return false;
    return t >= tCompra - MATCH_WINDOW_BEFORE_MS && t <= tCompra + MATCH_WINDOW_AFTER_MS;
  });

  if (!candidatos.length) return { estado: 'ninguno' };
  // Varios con la misma cola: si solo uno cuadra en monto, ese es.
  if (candidatos.length > 1 && compra.amount_ves !== null) {
    const esperado = Number(compra.amount_ves);
    const tol = amountTolerance(esperado);
    const exactos = candidatos.filter((m) => Math.abs(m.monto - esperado) <= tol);
    if (exactos.length === 1) candidatos = exactos;
  }
  if (candidatos.length > 1) return { estado: 'varios', cuantos: candidatos.length };
  return { estado: 'uno', movimiento: candidatos[0] };
}

/** Cómo terminó el reclamo de una aprobación hecha a mano */
export type ReclamoManual =
  | { estado: 'reclamado'; movimiento: Movimiento }
  | { estado: 'sin_candidato' }
  | { estado: 'ambiguo'; cuantos: number }
  | { estado: 'fallo'; movimiento: Movimiento }
  | { estado: 'error' }
  | { estado: 'apagado' };

/**
 * Marca en el banco (set_used=true) el pago que acredita una compra
 * aprobada A MANO desde el panel.
 *
 * La automática siempre lo hace —reclama primero y acredita después—,
 * pero el panel no lo hacía: cada aprobación manual dejaba el pago
 * marcado como libre. Dos consecuencias medidas el 16/08/2026 (26 de
 * 68 movimientos sin reclamar): durante 24 h la automática podía
 * volver a tomar ese mismo pago para otra compra, y el estado de
 * cuenta dejaba de servir para cuadrar qué dinero ya se hizo tickets.
 *
 * Nunca bloquea al equipo: si no se puede reclamar, quien llama
 * aprueba igual y deja constancia.
 */
export async function reclamarPagoManual(compra: CompraPendiente): Promise<ReclamoManual> {
  // Con la validación apagada o en sombra no se le escribe al banco.
  if (!BANK_VALIDATION_ENABLED || BANK_SHADOW_MODE || !isBankApiConfigured()) {
    return { estado: 'apagado' };
  }
  try {
    const admin = createAdminClient();
    const elegido = elegirParaReclamo(
      compra,
      await leerEstadoDeCuenta(200),
      await movimientosConsumidos(admin)
    );
    if (elegido.estado === 'ninguno') return { estado: 'sin_candidato' };
    if (elegido.estado === 'varios') return { estado: 'ambiguo', cuantos: elegido.cuantos };
    return (await reclamarMovimiento(elegido.movimiento))
      ? { estado: 'reclamado', movimiento: elegido.movimiento }
      : { estado: 'fallo', movimiento: elegido.movimiento };
  } catch {
    return { estado: 'error' };
  }
}

/**
 * Intento para UNA compra recién registrada: mira la cola que ya está
 * guardada, sin latido ni entrada al banco. Si el movimiento ya llegó,
 * el jugador tiene sus tickets al instante; si no, el cron lo resuelve.
 */
export async function conciliarUna(compra: CompraPendiente): Promise<boolean> {
  if (!BANK_VALIDATION_ENABLED || BANK_SHADOW_MODE || !isBankApiConfigured()) return false;
  try {
    const admin = createAdminClient();
    const movimientos = await leerEstadoDeCuenta(100);
    // Mismo cerrojo que en la pasada del cron: un pago que ya acreditó
    // una compra nuestra no se vuelve a tomar, lo diga o no el banco.
    const r = emparejar(compra, movimientos, await movimientosConsumidos(admin));
    if (r.estado !== 'ok') return false;
    if (!(await reclamarMovimiento(r.movimiento))) return false;
    const { error } = await admin.rpc('approve_purchase', {
      p_purchase: compra.id,
      p_origin: 'auto',
      p_bank: r.movimiento as unknown as Record<string, unknown>,
      p_note: null,
    });
    return !error;
  } catch {
    return false;
  }
}
