import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, isAdminClientConfigured } from '@/lib/supabase/admin';
import { requireStaff } from '@/lib/admin/guard';
import { loadProofIds } from '@/lib/admin/proofs';
import { tryAutoValidatePurchase } from '@/lib/payments/validatePurchase';
import { ReclamoManual, reclamarPagoManual, saludValidacion } from '@/lib/payments/conciliar';
import { blockReference, listBlockedReferences, unblockReference } from '@/lib/payments/blocklist';
import { loadNamesFor, nombreDe } from '@/lib/admin/staffNames';
import { fetchExchangeRateSafe } from '@/lib/payments/exchangeRate';
import {
  BANK_SHADOW_MODE,
  BANK_VALIDATION_ENABLED,
  DUPLICATE_MARKER,
  esRevisionSoloManual,
  MAX_TICKETS_PER_PURCHASE,
  notaDuplicado,
  REFERENCE_TAIL,
  referenceTail,
  TICKET_PRICE_USD,
} from '@/lib/payments/constants';

/** Deja constancia de la edición SIN pisar lo que la validación
 *  acabe de averiguar del pago (que es lo que se lee al aprobar).
 *  Si la compra ya se aprobó sola, no se toca nada. */
async function anotarTraza(
  admin: ReturnType<typeof createAdminClient>,
  id: string,
  traza: string
) {
  try {
    const { data } = await admin
      .from('ticket_purchases')
      .select('status, status_note')
      .eq('id', id)
      .single();
    if (!data || (data.status !== 'pendiente' && data.status !== 'validando')) return;
    const nota = data.status_note ?? '';
    if (nota.includes(traza)) return;
    await admin
      .from('ticket_purchases')
      .update({ status_note: nota ? `${nota} ${traza}` : traza })
      .eq('id', id);
  } catch {}
}

// Aprobar a mano espera como mucho esto a que el banco marque el pago
// como usado. Si tarda más se aprueba igual: el equipo no se queda
// mirando un botón por culpa del banco.
const RECLAMO_TIMEOUT_MS = 8_000;

/** Corta la espera sin cancelar el trabajo (si termina después, el
 *  reclamo igual queda hecho en el banco). null = se agotó el tiempo. */
function conCorte<T>(promesa: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([promesa, new Promise<null>((r) => setTimeout(() => r(null), ms))]);
}

// Qué se anota cuando el pago NO se pudo marcar como usado. Con
// 'reclamado' y 'apagado' no se escribe nada: el primero es lo normal
// y el segundo es que la integración con el banco está apagada.
const TRAZA_RECLAMO: Record<string, string> = {
  sin_candidato: '🏦 El pago no aparece libre en el estado de cuenta: no se pudo marcar como usado.',
  ambiguo: '🏦 Hay varios pagos sin usar con esa referencia: no se marcó ninguno.',
  fallo: '🏦 El banco no aceptó marcar el pago como usado.',
  error: '🏦 No se pudo consultar el banco para marcar el pago como usado.',
  corte: '🏦 El banco tardó demasiado en marcar el pago como usado.',
};

/** Constancia del reclamo en la compra ya aprobada. Se AÑADE a la nota
 *  que hubiera (las de anomalía sobreviven a aprobar, migración 017) */
async function anotarReclamo(
  admin: ReturnType<typeof createAdminClient>,
  id: string,
  estado: string
) {
  const traza = TRAZA_RECLAMO[estado];
  if (!traza) return;
  try {
    const { data } = await admin
      .from('ticket_purchases')
      .select('status_note')
      .eq('id', id)
      .single();
    const nota = data?.status_note ?? '';
    if (nota.includes(traza)) return;
    await admin
      .from('ticket_purchases')
      .update({ status_note: nota ? `${nota} ${traza}` : traza })
      .eq('id', id);
  } catch {}
}

// El cron externo concilia CADA MINUTO y resuelve todas las
// pendientes de la pasada (una sola entrada al banco, ver
// lib/payments/conciliar.ts): con eso se estima cuánto falta para que
// el banco vuelva a mirar cada compra.
const CRON_INTERVAL_MIN = 1;
const CHECKS_PER_PASS = 60;

/** ¿Esta compra la reintenta sola la validación automática? */
function isAutoRetryable(p: { status: string; status_note: string | null }): boolean {
  // Con la validación apagada —o en modo sombra, que mira pero no
  // aprueba— nada es automático: todas las no resueltas son de
  // revisión manual (sin cola ni ETA del banco). Enseñar una cola que
  // no acredita haría esperar al equipo en balde.
  if (!BANK_VALIDATION_ENABLED || BANK_SHADOW_MODE) return false;
  if (p.status !== 'pendiente' && p.status !== 'validando') return false;
  // Repetida u origen distinto: son de decisión HUMANA. La conciliación
  // ya las salta para no acreditarlas sola (mismo criterio,
  // `esRevisionSoloManual`); aquí las sacamos también de la cola del
  // banco para que caigan en «Pendientes» y no en «En proceso (banco)»
  // con un «esperando validación» que nunca va a llegar.
  if (esRevisionSoloManual(p.status_note)) return false;
  if (p.status_note?.includes('administrador')) return false;
  return true;
}

// Transacciones (staff con área 'transacciones'): compras de tickets
// y retiros con los datos del jugador. Lecturas con la clave de
// servidor (igual que stats: no depende de que las políticas RLS de
// admin estén bien en la BD).
export async function GET(req: NextRequest) {
  try {
    const { error } = await requireStaff('transacciones');
    if (error) return error;

    // ?proof=<id de compra> → firma el comprobante de ESA compra al
    // momento (2 llamadas al storage). Firmarlos todos en cada carga
    // (~90 carpetas × list+sign en paralelo) saturaba las conexiones:
    // el endpoint tardaba ~10 s y a veces las firmas fallaban en bloque.
    // ?todas=1 → la lista COMPLETA, no las 100 más recientes. Lo pide
    // la pestaña "Todas" cuando alguien la abre, no el refresco de cada
    // 30 s: traer miles de filas cuatro veces por minuto para enseñar
    // las pendientes no tiene sentido.
    const TOPE_NORMAL = 100;
    const TOPE_TODAS = 5000;
    const cuantas = req.nextUrl.searchParams.get('todas') === '1' ? TOPE_TODAS : TOPE_NORMAL;

    const proofId = req.nextUrl.searchParams.get('proof');
    if (proofId) {
      if (!isAdminClientConfigured()) {
        return NextResponse.json({ error: 'Falta SUPABASE_SECRET_KEY' }, { status: 503 });
      }
      const storage = createAdminClient().storage.from('payment-proofs');
      const { data: files } = await storage.list(proofId, { limit: 1 });
      const file = files?.[0];
      if (!file) return NextResponse.json({ error: 'Sin comprobante' }, { status: 404 });
      const { data: signed } = await storage.createSignedUrl(`${proofId}/${file.name}`, 60 * 60);
      if (!signed?.signedUrl) {
        return NextResponse.json({ error: 'No se pudo firmar el comprobante' }, { status: 500 });
      }
      // El nombre sirve para saber la extensión al descargarlo
      return NextResponse.json({ url: signed.signedUrl, name: file.name });
    }

    if (!isAdminClientConfigured()) {
      return NextResponse.json(
        { error: 'Falta SUPABASE_SECRET_KEY en el servidor' },
        { status: 503 }
      );
    }
    const db = createAdminClient();

    // `players!player_id` y no `players` a secas: las dos tablas apuntan
    // a players DOS veces —el jugador y quien atendió—, y sin decir por
    // cuál se une, PostgREST responde 300 (PGRST201) y la sección
    // Transacciones se queda VACÍA. En el juego hermano pasó en
    // producción, minutos después de añadir la firma.
    const purchaseCols =
      'id, player_id, quantity, amount_usd, amount_ves, exchange_rate_used, reference, status, origin, status_note, created_at, validated_at, last_checked_at, check_count, handled_by, players!player_id(username, whatsapp, cedula, payout_cedula, payout_phone)';
    const fetchPurchases = () =>
      db
        .from('ticket_purchases')
        .select(purchaseCols)
        .order('created_at', { ascending: false })
        .limit(cuantas);

    const withdrawalCols =
      'id, player_id, amount_usd, status, source, reference, admin_note, created_at, paid_at, handled_by, players!player_id(username, whatsapp, cedula, payout_name, payout_bank, payout_cedula, payout_phone)';
    const fetchWithdrawals = () =>
      db
        .from('withdrawals')
        .select(withdrawalCols)
        .order('created_at', { ascending: false })
        .limit(cuantas);

    // La lista de carpetas de comprobantes no depende de las compras:
    // va en paralelo con las consultas a la base de datos.
    const foldersPromise = loadProofIds().catch(() => null);

    // Tasa BCV del día (caché en memoria de 1 h con respaldo a la
    // última conocida): si dolarapi falla llega null y no se muestra.
    const [purchasesRes, withdrawalsRes, exchangeRate] = await Promise.all([
      fetchPurchases(),
      fetchWithdrawals(),
      fetchExchangeRateSafe(),
    ]);

    type PlayerRel = {
      username: string | null;
      whatsapp?: string | null;
      cedula?: string | null;
      payout_name?: string | null;
      payout_bank?: string | null;
      payout_cedula?: string | null;
      payout_phone?: string | null;
    } | null;

    type RawPurchase = {
      id: string;
      status: string;
      status_note: string | null;
      created_at: string;
      last_checked_at?: string | null;
      check_count?: number | null;
      handled_by?: string | null;
      players: PlayerRel;
      [key: string]: unknown;
    };
    type RawWithdrawal = {
      id: string;
      handled_by?: string | null;
      players: PlayerRel;
      [key: string]: unknown;
    };

    const rawPurchases = (purchasesRes.data ?? []) as unknown as RawPurchase[];
    const rawWithdrawals = (withdrawalsRes.data ?? []) as unknown as RawWithdrawal[];

    // ── Búsqueda en TODO el histórico ──
    // Las dos listas de arriba son las 100 más recientes. Buscar una
    // referencia de hace semanas no encontraba nada y parecía que el
    // pago no existía. Con término de búsqueda se consultan las tablas
    // enteras (por referencia, y por el nombre/cédula/teléfono del
    // jugador) y lo hallado se suma a lo ya cargado.
    const termino = req.nextUrl.searchParams.get('q')?.trim() ?? '';
    if (termino) {
      // Las comas y paréntesis rompen el filtro `or` de PostgREST
      const limpio = termino.replace(/[,()*\\%]/g, ' ').trim();
      const digitos = termino.replace(/\D/g, '');

      const orJugador: string[] = [];
      const camposJugador = [
        'username', 'first_name', 'last_name', 'payout_name',
        'cedula', 'payout_cedula', 'whatsapp', 'payout_phone',
      ];
      if (limpio) for (const c of camposJugador) orJugador.push(`${c}.ilike.*${limpio}*`);
      if (digitos && digitos !== limpio) {
        for (const c of ['cedula', 'payout_cedula', 'whatsapp', 'payout_phone']) {
          orJugador.push(`${c}.ilike.*${digitos}*`);
        }
      }
      const { data: jugadores } = orJugador.length
        ? await db.from('players').select('id').or(orJugador.join(',')).limit(150)
        : { data: [] as { id: string }[] };
      const idsJugador = (jugadores ?? []).map((j) => j.id);

      // El constructor de consultas de Supabase lleva unos genéricos
      // tan pesados que encadenarlos dinámicamente hace explotar al
      // compilador ("type instantiation is excessively deep"). Esta
      // vista mínima describe justo lo que se usa aquí.
      interface Consulta {
        or: (filtro: string) => Consulta;
        in: (col: string, valores: string[]) => Consulta;
        order: (col: string, opts: { ascending: boolean }) => Consulta;
        limit: (n: number) => Promise<{ data: unknown[] | null; error: unknown }>;
      }
      const dbSuelto = db as unknown as {
        from: (tabla: string) => { select: (cols: string) => Consulta };
      };

      const buscarEn = async (
        tabla: 'ticket_purchases' | 'withdrawals',
        cols: string,
        filtro: { tipo: 'or'; valor: string } | { tipo: 'in'; valor: string[] }
      ): Promise<unknown[]> => {
        const base = dbSuelto.from(tabla).select(cols);
        const conFiltro =
          filtro.tipo === 'or' ? base.or(filtro.valor) : base.in('player_id', filtro.valor);
        const { data } = await conFiltro.order('created_at', { ascending: false }).limit(60);
        return data ?? [];
      };

      const porReferencia = limpio
        ? await buscarEn('ticket_purchases', purchaseCols, {
            tipo: 'or',
            valor: `reference.ilike.*${limpio}*`,
          })
        : [];
      const comprasJugador = idsJugador.length
        ? await buscarEn('ticket_purchases', purchaseCols, { tipo: 'in', valor: idsJugador })
        : [];
      const retirosRef = limpio
        ? await buscarEn('withdrawals', withdrawalCols, {
            tipo: 'or',
            valor: `reference.ilike.*${limpio}*`,
          })
        : [];
      const retirosJugador = idsJugador.length
        ? await buscarEn('withdrawals', withdrawalCols, { tipo: 'in', valor: idsJugador })
        : [];

      const sumar = <T extends { id: string }>(base: T[], extra: unknown[]) => {
        const vistos = new Set(base.map((r) => r.id));
        for (const fila of extra as T[]) {
          if (fila && !vistos.has(fila.id)) {
            vistos.add(fila.id);
            base.push(fila);
          }
        }
      };
      sumar(rawPurchases, [...porReferencia, ...comprasJugador]);
      sumar(rawWithdrawals, [...retirosRef, ...retirosJugador]);
    }

    // Semáforo de la validación automática (diario del cron). Si algo
    // falla llega null y el bloque no se enseña.
    const salud = await saludValidacion(db);

    // Lista negra de referencias. null = no se pudo leer: el panel no
    // enseña el bloque y nada se rompe.
    const bloqueadas = await listBlockedReferences(db);

    // Nombre de quien atendió cada cosa. Una sola consulta para las tres
    // listas; si un id ya no tiene cuenta, el mapa no lo trae y el panel
    // enseña «—» en vez de romperse.
    const firmas = await loadNamesFor(db, [
      ...rawPurchases.map((p) => p.handled_by),
      ...rawWithdrawals.map((w) => w.handled_by),
      ...(bloqueadas ?? []).map((b) => b.created_by),
    ]);

    // Cola de validación automática: las pendientes que el banco va a
    // reintentar, en orden de llegada. El puesto en la cola da el
    // tiempo máximo estimado hasta el próximo intento.
    const queue = rawPurchases
      .filter(isAutoRetryable)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    const queuePos = new Map(queue.map((p, i) => [p.id, i]));

    const purchases = rawPurchases.map((row) => {
      const { players, ...rest } = row;
      const pos = queuePos.get(row.id);
      const unresolved = row.status === 'pendiente' || row.status === 'validando';
      const bankState = !unresolved
        ? null
        : pos === undefined
        ? ('revision_manual' as const)
        : row.status === 'validando'
        ? ('consultando' as const)
        : ('esperando_banco' as const);
      return {
        ...rest,
        username: players?.username ?? null,
        whatsapp: players?.whatsapp ?? players?.payout_phone ?? null,
        cedula: players?.cedula ?? players?.payout_cedula ?? null,
        has_proof: false,
        handled_by_name: nombreDe(firmas, row.handled_by),
        bank_state: bankState,
        queue_position: pos === undefined ? null : pos + 1,
        eta_minutes:
          pos === undefined ? null : (Math.floor(pos / CHECKS_PER_PASS) + 1) * CRON_INTERVAL_MIN,
      };
    });

    // Comprobantes adjuntos (opcionales): el bucket guarda una carpeta
    // por compra. Aquí solo se marca CUÁLES tienen comprobante (una
    // llamada); la URL firmada se pide al tocar «Ver comprobante»
    // (?proof=<id>), nunca en masa.
    if (foldersPromise) {
      try {
        const withProof = await foldersPromise;
        if (withProof) for (const p of purchases) p.has_proof = withProof.has(p.id);
      } catch {}
    }

    const withdrawals = rawWithdrawals.map((row) => {
      const { players, ...rest } = row;
      return {
        ...rest,
        handled_by_name: nombreDe(firmas, row.handled_by),
        username: players?.username ?? null,
        whatsapp: players?.whatsapp ?? players?.payout_phone ?? null,
        cedula: players?.cedula ?? players?.payout_cedula ?? null,
        payout_name: players?.payout_name ?? null,
        payout_bank: players?.payout_bank ?? null,
        payout_cedula: players?.payout_cedula ?? null,
        payout_phone: players?.payout_phone ?? null,
      };
    });

    return NextResponse.json({
      purchases,
      withdrawals,
      exchange_rate: exchangeRate,
      salud,
      bloqueadas: bloqueadas?.map((b) => ({
        ...b,
        bloqueada_por: nombreDe(firmas, b.created_by),
      })),
    });
  } catch {
    return NextResponse.json({ error: 'Error del servidor' }, { status: 500 });
  }
}

interface ActionBody {
  action:
    | 'approve_purchase'
    | 'reject_purchase'
    | 'pay_withdrawal'
    | 'cancel_withdrawal'
    | 'edit_purchase'
    | 'block_reference'
    | 'unblock_reference';
  /** id de la transacción; en block/unblock_reference, la referencia */
  id: string;
  note?: string;
  reference?: string;
  quantity?: number | string;
  /** Al rechazar: además, que esa referencia no sirva nunca más */
  block?: boolean;
  /** En block_reference: desde qué compra se pulsó (para no avisar de
   *  que la referencia «ya está usada» señalando esa misma compra) */
  purchase_id?: string;
}

/** Deja firmada la acción: quién del equipo la hizo.
 *  Va DESPUÉS de la RPC y nunca la condiciona — el dinero ya se movió;
 *  si esto falla, lo único que se pierde es el nombre y el panel enseña
 *  «—». Ninguna firma vale un pago a medias. */
async function firmar(
  admin: ReturnType<typeof createAdminClient>,
  tabla: 'ticket_purchases' | 'withdrawals',
  id: string,
  staffId: string | null
) {
  if (!staffId) return;
  try {
    await admin.from(tabla).update({ handled_by: staffId }).eq('id', id);
  } catch {}
}

// Acciones del admin sobre transacciones. Los RPCs son atómicos:
// aprobar suma tickets, rechazar los descuenta si ya estaban dados,
// cancelar un retiro devuelve el monto a la billetera.
export async function POST(req: NextRequest) {
  try {
    const { staff, error } = await requireStaff('transacciones');
    if (error) return error;
    const staffId = staff?.userId ?? null;

    if (!isAdminClientConfigured()) {
      return NextResponse.json(
        { error: 'Falta SUPABASE_SECRET_KEY en el servidor' },
        { status: 503 }
      );
    }

    const body: ActionBody = await req.json();
    const id = String(body.id ?? '');
    if (!id) return NextResponse.json({ error: 'Falta el id' }, { status: 400 });

    const admin = createAdminClient();

    if (body.action === 'approve_purchase') {
      // Igual que la automática: primero se marca el pago como usado en
      // el banco y después se acredita. Así ese mismo pago no puede
      // acreditar una segunda compra, y el estado de cuenta sigue
      // diciendo la verdad sobre qué dinero ya se hizo tickets.
      // Si no se puede, se aprueba IGUAL (manda el equipo) y se anota.
      const { data: compra } = await admin
        .from('ticket_purchases')
        .select('id, reference, amount_ves, exchange_rate_used, created_at, status')
        .eq('id', id)
        .single();

      let reclamo: ReclamoManual | null = null;
      let corte = false;
      if (compra && compra.status !== 'aprobado') {
        reclamo = await conCorte(reclamarPagoManual(compra), RECLAMO_TIMEOUT_MS);
        corte = reclamo === null;
      }

      const { data, error: rpcError } = await admin.rpc('approve_purchase', {
        p_purchase: id,
        p_origin: 'manual',
        // El movimiento reclamado queda guardado en la compra: es el
        // recibo de contra qué pago se acreditó.
        p_bank:
          reclamo?.estado === 'reclamado'
            ? (reclamo.movimiento as unknown as Record<string, unknown>)
            : null,
        p_note: body.note?.trim() || null,
      });
      if (rpcError) return NextResponse.json({ error: rpcError.message }, { status: 400 });

      await firmar(admin, 'ticket_purchases', id, staffId);
      if (corte || reclamo) await anotarReclamo(admin, id, corte ? 'corte' : reclamo!.estado);

      return NextResponse.json({
        ok: true,
        result: data,
        reclamo: corte ? 'corte' : (reclamo?.estado ?? null),
      });
    }

    if (body.action === 'reject_purchase') {
      const note = body.note?.trim();
      if (!note) {
        return NextResponse.json({ error: 'Indica el motivo del rechazo' }, { status: 400 });
      }
      const { error: rpcError } = await admin.rpc('reject_purchase', {
        p_purchase: id,
        p_note: note,
      });
      if (rpcError) return NextResponse.json({ error: rpcError.message }, { status: 400 });

      await firmar(admin, 'ticket_purchases', id, staffId);

      // Y si además fue un intento de estafa, que esa referencia no
      // sirva nunca más. Va DESPUÉS del rechazo y no lo condiciona: si
      // la lista negra falla, la compra ya quedó rechazada igual.
      let bloqueada: boolean | null = null;
      if (body.block) {
        const { data: compra } = await admin
          .from('ticket_purchases')
          .select('reference')
          .eq('id', id)
          .single();
        bloqueada = compra?.reference
          ? await blockReference(admin, {
              reference: compra.reference,
              motivo: note,
              purchaseId: id,
              by: staffId,
            })
          : false;
      }
      return NextResponse.json({ ok: true, bloqueada });
    }

    // Invalidar una referencia ESCRITA A MANO, sin rechazar ninguna
    // compra. El caso que lo pide: alguien paga de menos, luego manda
    // la diferencia con otra referencia, y la primera —que nunca llegó
    // a registrarse— hay que dejarla inservible para que no la suba
    // mañana como si fuera un pago nuevo.
    //
    // Antes esto solo se podía hacer al rechazar una compra, así que
    // una referencia que no estaba en ninguna compra no había forma de
    // bloquearla. El id es la referencia.
    if (body.action === 'block_reference') {
      const motivo = body.note?.trim();
      if (!motivo) {
        return NextResponse.json(
          { error: 'Escribe por qué se invalida: es lo que se lee dentro de un mes' },
          { status: 400 }
        );
      }
      const cola = referenceTail(id);
      if (cola.length < REFERENCE_TAIL) {
        return NextResponse.json(
          { error: `La referencia debe tener al menos ${REFERENCE_TAIL} dígitos` },
          { status: 400 }
        );
      }

      // ¿Esa referencia está en alguna compra? No impide bloquearla —
      // el equipo sabrá— pero se devuelve para avisar en pantalla: una
      // cosa es invalidar un número suelto y otra descubrir que ese
      // pago ya acreditó tickets.
      //
      // `purchase_id` llega cuando se invalida desde el botón de una
      // compra: sirve para saber si lo encontrado es esa misma compra
      // (y entonces el aviso sobra) o es OTRA que ya usó el número.
      const { data: usada } = await admin
        .from('ticket_purchases')
        .select('id, status, created_at, players!player_id(username)')
        .or(`reference_norm.eq.${cola},reference.like.*${cola}`)
        .neq('status', 'rechazado')
        .order('created_at', { ascending: false })
        .limit(1);
      const enUso = usada?.[0] as
        | { id: string; status: string; players?: { username: string | null } | null }
        | undefined;

      const ok = await blockReference(admin, { reference: id, motivo, by: staffId });
      if (!ok) {
        return NextResponse.json(
          { error: 'No se pudo invalidar esa referencia' },
          { status: 400 }
        );
      }
      return NextResponse.json({
        ok: true,
        cola,
        usada_en: enUso
          ? {
              status: enUso.status,
              username: enUso.players?.username ?? null,
              misma: enUso.id === body.purchase_id,
            }
          : null,
      });
    }

    // Sacar una referencia de la lista negra: el id es la referencia
    if (body.action === 'unblock_reference') {
      const ok = await unblockReference(admin, id);
      if (!ok) {
        return NextResponse.json(
          { error: 'No se pudo desbloquear esa referencia' },
          { status: 400 }
        );
      }
      return NextResponse.json({ ok: true });
    }

    // Corregir una compra pendiente: la cantidad de tickets (si el
    // pago no cuadra con lo solicitado) o la referencia (si el
    // jugador la escribió mal). Tras el arreglo se reintenta la
    // validación automática de inmediato.
    if (body.action === 'edit_purchase') {
      const { data: purchase } = await admin
        .from('ticket_purchases')
        .select('id, status, quantity, reference, status_note, exchange_rate_used')
        .eq('id', id)
        .single();
      if (!purchase) {
        return NextResponse.json({ error: 'Compra no encontrada' }, { status: 404 });
      }
      if (purchase.status === 'aprobado') {
        return NextResponse.json(
          {
            error:
              'La compra ya está aprobada: para corregirla, recházala (se descuentan los tickets) y apruébala de nuevo con los datos correctos.',
          },
          { status: 400 }
        );
      }
      if (purchase.status === 'rechazado') {
        return NextResponse.json(
          { error: 'La compra está rechazada: el jugador debe registrar el pago de nuevo.' },
          { status: 400 }
        );
      }

      const updates: Record<string, unknown> = {};
      const changed: string[] = [];

      if (body.quantity !== undefined) {
        const qty = Math.trunc(Number(body.quantity));
        if (!Number.isFinite(qty) || qty < 1 || qty > MAX_TICKETS_PER_PURCHASE) {
          return NextResponse.json(
            { error: `Cantidad inválida (1 a ${MAX_TICKETS_PER_PURCHASE})` },
            { status: 400 }
          );
        }
        if (qty !== purchase.quantity) {
          const amountUsd = Math.round(qty * TICKET_PRICE_USD * 100) / 100;
          const rate = purchase.exchange_rate_used;
          updates.quantity = qty;
          updates.amount_usd = amountUsd;
          updates.amount_ves = rate ? Math.round(amountUsd * Number(rate) * 100) / 100 : null;
          changed.push(`cantidad ajustada a ${qty} ticket(s)`);
        }
      }

      // Referencia repetida tras la corrección: se AVISA, no se
      // bloquea. Dos bancos distintos pueden repetir número, y un 409
      // dejaría al equipo encerrado (corrige al número bueno y el
      // sistema se lo rechaza, sin más salida). Se acepta el cambio y
      // la compra queda marcada para revisión 100% manual, igual que
      // cuando el jugador registra una repetida.
      let dupNote: string | null = null;
      if (body.reference !== undefined) {
        const reference = String(body.reference).trim();
        if (reference.length < 4 || reference.length > 40) {
          return NextResponse.json({ error: 'Escribe una referencia válida' }, { status: 400 });
        }
        if (reference !== purchase.reference) {
          // Por la COLA de 6 dígitos, que es como empareja el banco y
          // como se guarda reference_norm. Comparar el texto entero
          // contra esa cola solo acertaría si el operador escribiera
          // justo 6 dígitos.
          const norm = referenceTail(reference);
          const { data: dups } = await admin
            .from('ticket_purchases')
            .select('id, status, created_at')
            .or(`reference_norm.eq.${norm},reference.like.*${norm}`)
            .neq('status', 'rechazado')
            .neq('id', id)
            .limit(5);
          if ((dups?.length ?? 0) > 0) dupNote = notaDuplicado(dups!);
          updates.reference = reference;
          changed.push('referencia corregida');
        }
      }

      if (changed.length === 0) {
        return NextResponse.json({ ok: true, result: { status: purchase.status } });
      }

      // Si la referencia sigue siendo la repetida, la nota-marcador se
      // conserva (mantiene la compra en revisión 100% manual). Si la
      // referencia CAMBIA, manda lo que diga la comprobación de arriba:
      // o la nueva nota de repetida, o la traza de la edición.
      const seguiaRepetida =
        updates.reference === undefined && purchase.status_note?.startsWith(DUPLICATE_MARKER);
      const traza = `✏️ Editada por el equipo: ${changed.join(' y ')}.`;
      // Revisión SOLO manual: repetida (antes o ahora). La validación
      // automática no la mira, para no reclamar el pago de otra compra.
      const soloManual = seguiaRepetida || dupNote !== null;
      if (!seguiaRepetida) {
        updates.status_note = dupNote ?? traza;
      }
      updates.status = 'pendiente';

      const { error: updateError } = await admin
        .from('ticket_purchases')
        .update(updates)
        .eq('id', id);
      if (updateError) {
        const msg = updateError.code === '23505'
          ? 'Esa referencia ya está usada en otra compra.'
          : updateError.message;
        return NextResponse.json({ error: msg }, { status: 400 });
      }

      if (soloManual) return NextResponse.json({ ok: true, result: { status: 'pendiente' } });

      const result = await tryAutoValidatePurchase(id);
      // La revalidación reescribe la nota con lo que ve del pago
      // («Faltan Bs. 771,29…»), que es lo que hay que leer antes de
      // aprobar. Se le vuelve a pegar la traza de la edición: antes la
      // traza pisaba el aviso del monto y la compra acababa aprobada
      // sin rastro de que el pago venía corto.
      await anotarTraza(admin, id, traza);
      return NextResponse.json({ ok: true, result });
    }

    if (body.action === 'pay_withdrawal') {
      const reference = body.reference?.trim();
      if (!reference) {
        return NextResponse.json(
          { error: 'Escribe la referencia del Pago Móvil que hiciste' },
          { status: 400 }
        );
      }
      const { error: rpcError } = await admin.rpc('pay_withdrawal', {
        p_withdrawal: id,
        p_reference: reference,
        p_note: body.note?.trim() || null,
      });
      if (rpcError) return NextResponse.json({ error: rpcError.message }, { status: 400 });
      await firmar(admin, 'withdrawals', id, staffId);
      return NextResponse.json({ ok: true });
    }

    if (body.action === 'cancel_withdrawal') {
      const { error: rpcError } = await admin.rpc('cancel_withdrawal', { p_withdrawal: id });
      if (rpcError) return NextResponse.json({ error: rpcError.message }, { status: 400 });
      await firmar(admin, 'withdrawals', id, staffId);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'Acción inválida' }, { status: 400 });
  } catch {
    return NextResponse.json({ error: 'Error del servidor' }, { status: 500 });
  }
}
