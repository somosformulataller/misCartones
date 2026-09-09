import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, isAdminClientConfigured } from '@/lib/supabase/admin';
import { requireStaff } from '@/lib/admin/guard';
import { loadProofIds } from '@/lib/admin/proofs';
import { loadAudience, loadDayAudience, loadPresence } from '@/lib/admin/audience';
import {
  diferencias,
  nombreVisible,
  PerfilEditable,
  revisarPerfil,
} from '@/lib/admin/playerProfile';
import { revisarCompensacion } from '@/lib/admin/compensacion';
import { digitosDeBusqueda } from '@/lib/admin/busqueda';
import { resumenReferidos } from '@/lib/referrals/ganado';
import { huellaDe } from '@/lib/payments/origen';
import { cargarCorreosCacheado, olvidarCorreos } from '@/lib/admin/emails';

interface PlayerRow {
  id: string;
  username: string | null;
  role: string | null;
  balance: number;
  tickets: number;
  total_wagered: number;
  total_won: number;
  payout_cedula: string | null;
  created_at: string;
  blocked?: boolean;
  whatsapp?: string | null;
  cedula?: string | null;
  panel_areas?: string[] | null;
  first_name?: string | null;
  last_name?: string | null;
  payout_name?: string | null;
  payout_bank?: string | null;
  payout_phone?: string | null;
}

// El mapa id → correo vive en lib/admin/emails.ts (lo comparten esta
// ruta y la del chat). Paginar es obligatorio: ver el porqué allí.
const loadEmailMap = cargarCorreosCacheado;

function toUserRow(p: PlayerRow, email: string | null) {
  return {
    id: p.id,
    username: p.username,
    email,
    role: p.role,
    blocked: p.blocked === true,
    balance: Number(p.balance),
    tickets: Number(p.tickets ?? 0),
    total_wagered: Number(p.total_wagered),
    total_won: Number(p.total_won),
    created_at: p.created_at,
    whatsapp: p.whatsapp ?? null,
    // OJO: la cédula de registro y la de cobro son campos DISTINTOS y
    // aquí van separados a propósito. Antes esto era
    // `p.cedula ?? p.payout_cedula`, y con el formulario de edición ese
    // atajo escribiría la de cobro encima de la de registro sin que
    // nadie se entere. Quien busque por cédula mira las dos (ver el
    // filtro de la lista).
    cedula: p.cedula ?? null,
    panel_areas: p.panel_areas ?? null,
    first_name: p.first_name ?? null,
    last_name: p.last_name ?? null,
    payout_name: p.payout_name ?? null,
    payout_bank: p.payout_bank ?? null,
    payout_cedula: p.payout_cedula ?? null,
    payout_phone: p.payout_phone ?? null,
  };
}

// Cuántas filas se traen por página en cada pestaña del historial. Un
// jugador activo puede tener miles de partidas, recargas o canjes:
// traerlas todas de golpe cargaba lento la ficha y alargaba el modal
// sin fin, así que cada pestaña se pide de a una página y el resto se
// recorre con los controles de paginación.
const HISTORIAL_POR_PAGINA = 50;

type Admin = ReturnType<typeof createAdminClient>;
type Pagina<T> = { rows: T[]; total: number };

// Columnas de una recarga (compra). Los campos ocr_*
// sostienen la regla de origen: sin verlos, quien revisa no puede
// juzgar si un cambio de banco tiene sentido.
const SELECT_COMPRA =
  'id, quantity, amount_usd, amount_ves, reference, status, origin, status_note, created_at, validated_at, ocr_origin, ocr_origin_type, ocr_bank, ocr_origin_bank, ocr_origin_cedula, ocr_is_ubii';

/** [desde, hasta] para .range() a partir del número de página */
function rangoPagina(page: number): [number, number] {
  const desde = Math.max(0, page) * HISTORIAL_POR_PAGINA;
  return [desde, desde + HISTORIAL_POR_PAGINA - 1];
}

// A cada compra se le pega si tiene comprobante y, si el pago llegó
// corto, cuánto faltó y si ya se cobró (para no ir a buscarlo a otra
// pestaña).
function enriquecerCompra(
  p: Record<string, unknown> & { id: string },
  proofIds: Set<string> | null,
  cortas: Map<string, { falta: number; cobrado: boolean }>
) {
  const corta = cortas.get(p.id);
  return {
    ...p,
    has_proof: proofIds ? proofIds.has(p.id) : false,
    falta: corta?.falta ?? null,
    falta_cobrada: corta ? corta.cobrado : null,
  };
}

// Con `count: 'exact'` la misma consulta devuelve la página Y cuántas
// filas hay en total, sin una segunda vuelta.
async function loadGamesPage(admin: Admin, id: string, page: number): Promise<Pagina<unknown>> {
  const [f, t] = rangoPagina(page);
  const { data, count } = await admin
    .from('game_history')
    .select('id, payout, bags_count, created_at', { count: 'exact' })
    .eq('player_id', id)
    .order('created_at', { ascending: false })
    .range(f, t);
  return { rows: data ?? [], total: count ?? 0 };
}

async function loadRetirosPage(admin: Admin, id: string, page: number): Promise<Pagina<unknown>> {
  const [f, t] = rangoPagina(page);
  const { data, count } = await admin
    .from('withdrawals')
    .select('id, amount_usd, status, reference, admin_note, created_at, paid_at', { count: 'exact' })
    .eq('player_id', id)
    .order('created_at', { ascending: false })
    .range(f, t);
  return { rows: data ?? [], total: count ?? 0 };
}

async function loadCanjesPage(admin: Admin, id: string, page: number): Promise<Pagina<unknown>> {
  const [f, t] = rangoPagina(page);
  const { data, count } = await admin
    .from('ticket_redemptions')
    .select('id, quantity, amount_usd, created_at', { count: 'exact' })
    .eq('player_id', id)
    .order('created_at', { ascending: false })
    .range(f, t);
  return { rows: data ?? [], total: count ?? 0 };
}

function numerizarAjuste(a: Record<string, unknown>) {
  return { ...a, delta: Number(a.delta), antes: Number(a.antes), despues: Number(a.despues) };
}

async function loadAjustesPage(admin: Admin, id: string, page: number): Promise<Pagina<unknown>> {
  const [f, t] = rangoPagina(page);
  const { data, count } = await admin
    .from('manual_adjustments')
    .select('id, tipo, delta, antes, despues, motivo, made_by_name, made_by_role, created_at', { count: 'exact' })
    .eq('player_id', id)
    .order('created_at', { ascending: false })
    .range(f, t);
  return { rows: (data ?? []).map(numerizarAjuste), total: count ?? 0 };
}

// Orígenes: las recargas de las que se pudo leer desde dónde se pagó
// (ocr_origin no nulo). No usa comprobante ni pago corto, así que no
// necesita el enriquecido de las recargas.
async function loadOrigenesPage(admin: Admin, id: string, page: number): Promise<Pagina<unknown>> {
  const [f, t] = rangoPagina(page);
  const { data, count } = await admin
    .from('ticket_purchases')
    .select(SELECT_COMPRA, { count: 'exact' })
    .eq('player_id', id)
    .not('ocr_origin', 'is', null)
    .order('created_at', { ascending: false })
    .range(f, t);
  return { rows: data ?? [], total: count ?? 0 };
}

// Recargas: MEZCLA de compras y tickets que el equipo puso o quitó a
// mano, ordenadas por fecha (un ajuste de tickets es una entrada/salida
// de tickets, igual que una compra). Para paginar la mezcla sin repetir
// ni saltarse filas se traen las (page+1)·N más nuevas de cada fuente,
// se juntan, se ordenan y se corta la página pedida: cualquier fila del
// tramo superior está garantizada dentro de ese lote de cada tabla.
async function loadRecargasPage(
  admin: Admin,
  id: string,
  page: number,
  helpers?: { proofIds: Set<string> | null; cortas: Map<string, { falta: number; cobrado: boolean }> }
): Promise<Pagina<unknown>> {
  const proofIds = helpers ? helpers.proofIds : await loadProofIds().catch(() => null);
  const cortas =
    helpers?.cortas ??
    new Map(
      ((await revisarCompensacion(admin, id).catch(() => null))?.cortas ?? []).map((c) => [
        c.id,
        { falta: c.falta, cobrado: c.cobrado },
      ])
    );
  const hasta = (Math.max(0, page) + 1) * HISTORIAL_POR_PAGINA - 1;
  const [comprasRes, manosRes, cCompras, cManos] = await Promise.all([
    admin
      .from('ticket_purchases')
      .select(SELECT_COMPRA)
      .eq('player_id', id)
      .order('created_at', { ascending: false })
      .range(0, hasta),
    admin
      .from('manual_adjustments')
      .select('id, tipo, delta, antes, despues, motivo, made_by_name, made_by_role, created_at')
      .eq('player_id', id)
      .eq('tipo', 'tickets')
      .order('created_at', { ascending: false })
      .range(0, hasta),
    admin.from('ticket_purchases').select('id', { count: 'exact', head: true }).eq('player_id', id),
    admin
      .from('manual_adjustments')
      .select('id', { count: 'exact', head: true })
      .eq('player_id', id)
      .eq('tipo', 'tickets'),
  ]);
  const compras = (comprasRes.data ?? []).map((p) => ({
    tipo: 'compra' as const,
    fecha: p.created_at as string,
    p: enriquecerCompra(p as { id: string }, proofIds, cortas),
  }));
  const manos = (manosRes.data ?? []).map((a) => ({
    tipo: 'mano' as const,
    fecha: a.created_at as string,
    a: numerizarAjuste(a),
  }));
  const merged = [...compras, ...manos].sort((x, y) => +new Date(y.fecha) - +new Date(x.fecha));
  const [f, t] = rangoPagina(page);
  return { rows: merged.slice(f, t + 1), total: (cCompras.count ?? 0) + (cManos.count ?? 0) };
}

// Suma de TODO lo que se le dio y se le quitó a mano (sobre todos los
// ajustes, no solo la página visible): "neto 0" puede ser "nunca se
// tocó" o "se le dieron 10 y se le quitaron 10", y no son lo mismo.
async function totalesAjustes(admin: Admin, id: string) {
  const { data } = await admin
    .from('manual_adjustments')
    .select('tipo, delta')
    .eq('player_id', id)
    .limit(5000);
  const filas = (data ?? []) as { tipo: string; delta: number }[];
  const sumar = (tipo: string, signo: 1 | -1) =>
    filas
      .filter((a) => a.tipo === tipo && Math.sign(Number(a.delta)) === signo)
      .reduce((total, a) => total + Math.abs(Number(a.delta)), 0);
  return {
    ticketsDados: sumar('tickets', 1),
    ticketsQuitados: sumar('tickets', -1),
    saldoDado: sumar('saldo', 1),
    saldoQuitado: sumar('saldo', -1),
  };
}

// Qué pestañas del historial se pueden paginar sueltas (GET ?id&tab&page)
const LOADERS_PESTANA: Record<string, (a: Admin, id: string, page: number) => Promise<Pagina<unknown>>> = {
  partidas: loadGamesPage,
  recargas: (a, id, page) => loadRecargasPage(a, id, page),
  retiros: loadRetirosPage,
  canjes: loadCanjesPage,
  ajustes: loadAjustesPage,
  origenes: loadOrigenesPage,
};

// Historial completo del jugador: partidas, recargas, retiros, canjes y
// ajustes manuales. Si alguna consulta falla, esa lista llega vacía sin
// romper el resto de la ficha: se abre para atender a alguien, y media
// ficha sirve más que una pantalla en blanco.
async function loadHistory(admin: ReturnType<typeof createAdminClient>, id: string) {
  // Todo lo que se puede pedir de una vez se pide de una vez. Antes la
  // compensación, la huella y el listado de comprobantes se esperaban
  // EN FILA detrás del historial, y como cada uno es lento (la
  // compensación lanza 7 consultas más y el listado recorre TODO el
  // bucket), la ficha tardaba la SUMA de todos. Aquí van en el mismo
  // Promise.all: la ficha tarda lo que el más lento, no lo que todos.
  const hastaP0 = HISTORIAL_POR_PAGINA - 1;
  const [
    gamesPage,
    retirosPage,
    canjesPage,
    ajustesPage,
    origenesPage,
    ajustesTot,
    comprasRes,
    manosRes,
    cComprasRes,
    cManosRes,
    referidosRes,
    compensacion,
    origen,
    withProof,
  ] = await Promise.all([
    loadGamesPage(admin, id, 0),
    loadRetirosPage(admin, id, 0),
    loadCanjesPage(admin, id, 0),
    loadAjustesPage(admin, id, 0),
    loadOrigenesPage(admin, id, 0),
    totalesAjustes(admin, id),
    // Compras y tickets a mano de la primera página de RECARGAS. Se
    // mezclan aquí mismo (con el enriquecido ya cargado abajo) para no
    // gastar una segunda vuelta de red.
    admin
      .from('ticket_purchases')
      .select(SELECT_COMPRA)
      .eq('player_id', id)
      .order('created_at', { ascending: false })
      .range(0, hastaP0),
    admin
      .from('manual_adjustments')
      .select('id, tipo, delta, antes, despues, motivo, made_by_name, made_by_role, created_at')
      .eq('player_id', id)
      .eq('tipo', 'tickets')
      .order('created_at', { ascending: false })
      .range(0, hastaP0),
    admin.from('ticket_purchases').select('id', { count: 'exact', head: true }).eq('player_id', id),
    admin
      .from('manual_adjustments')
      .select('id', { count: 'exact', head: true })
      .eq('player_id', id)
      .eq('tipo', 'tickets'),
    // Lo que ha ganado invitando: entra al mismo saldo que los premios
    // del juego, y desde la ficha hay que poder distinguirlo.
    admin
      .from('referral_claims')
      .select('id, amount_usd, created_at, partidas, referred_id')
      .eq('referrer_id', id)
      .order('created_at', { ascending: false })
      .limit(500),
    // ¿Se le cobró lo que faltó en sus pagos cortos? Es la consulta más
    // pesada de la ficha; si falla, la ficha se enseña igual sin ella.
    revisarCompensacion(admin, id).catch(() => null),
    // Su cuenta bancaria habitual. Si no se puede leer, la ficha se
    // enseña igual sin esa parte.
    admin
      .from('player_payment_origins')
      .select('banco, ancla_tipo, ancla, muestra, fijado_at, fijado_por_nombre, motivo')
      .eq('player_id', id)
      .maybeSingle()
      .then((r) => r.data ?? null, () => null),
    // Qué recargas tienen captura del pago (listado cacheado 60 s), para
    // volver a verla desde la ficha. Si el storage falla, sin capturas.
    loadProofIds().catch(() => null),
  ]);

  // Nombre de cada amigo cobrado, para que el historial no sea una
  // lista de identificadores
  const cobros = (referidosRes.data ?? []) as {
    id: string; amount_usd: number;
    created_at: string; partidas: number; referred_id: string;
  }[];
  const nombres = new Map<string, string | null>();
  if (cobros.length) {
    const { data } = await admin
      .from('players')
      .select('id, username')
      .in('id', [...new Set(cobros.map((c) => c.referred_id))]);
    for (const p of data ?? []) nombres.set(p.id, p.username);
  }

  // Primera página de RECARGAS: compras (con comprobante y pago corto) y
  // tickets a mano, mezcladas por fecha (misma lógica que loadRecargasPage,
  // pero con el enriquecido ya traído arriba).
  const cortasMap = new Map(
    (compensacion?.cortas ?? []).map((c) => [c.id, { falta: c.falta, cobrado: c.cobrado }])
  );
  const recargas = [
    ...(comprasRes.data ?? []).map((p) => ({
      tipo: 'compra' as const,
      fecha: p.created_at as string,
      p: enriquecerCompra(p as { id: string }, withProof, cortasMap),
    })),
    ...(manosRes.data ?? []).map((a) => ({
      tipo: 'mano' as const,
      fecha: a.created_at as string,
      a: numerizarAjuste(a),
    })),
  ].sort((x, y) => +new Date(y.fecha) - +new Date(x.fecha));

  return {
    games: gamesPage.rows,
    games_total: gamesPage.total,
    recargas,
    recargas_total: (cComprasRes.count ?? 0) + (cManosRes.count ?? 0),
    withdrawals: retirosPage.rows,
    withdrawals_total: retirosPage.total,
    redemptions: canjesPage.rows,
    redemptions_total: canjesPage.total,
    adjustments: ajustesPage.rows,
    adjustments_total: ajustesPage.total,
    ajustes_totales: ajustesTot,
    origenes: origenesPage.rows,
    origenes_total: origenesPage.total,
    compensacion,
    origen,
    referidos: resumenReferidos(referidosRes.data),
    cobros_referidos: cobros.map((c) => ({
      id: c.id,
      nombre: nombres.get(c.referred_id) ?? null,
      amount_usd: Number(c.amount_usd),
      created_at: c.created_at,
      partidas: Number(c.partidas),
    })),
  };
}

// Gestión de usuarios (STAFF).
// GET ?id=          → ficha de un usuario (cualquier área del panel)
// GET ?id=&full=1   → ficha + historial (partidas, recargas, retiros, canjes)
// GET               → lista completa (requiere el área 'usuarios')
export async function GET(req: NextRequest) {
  try {
    const params = req.nextUrl.searchParams;
    const id = params.get('id');

    // La ficha individual se abre desde cualquier tabla del panel
    // (transacciones, partidas…): basta con ser staff.
    const { error } = id
      ? await requireStaff()
      : await requireStaff('usuarios');
    if (error) return error;

    if (!isAdminClientConfigured()) {
      return NextResponse.json({ error: 'Falta SUPABASE_SECRET_KEY en el servidor' }, { status: 503 });
    }
    const admin = createAdminClient();

    if (id) {
      // Una página suelta de una pestaña del historial para su paginador.
      // No recarga toda la ficha: solo trae la página pedida y el total.
      const tabParam = params.get('tab');
      if (tabParam && LOADERS_PESTANA[tabParam]) {
        const page = Math.max(0, Number(params.get('page')) || 0);
        const pagina = await LOADERS_PESTANA[tabParam](admin, id, page);
        return NextResponse.json(pagina);
      }

      const full = params.get('full') === '1';
      // La fila del jugador, su correo (vive en auth) y el historial no
      // dependen unos de otros: van los tres a la vez. Así el correo y
      // el historial —lo más lento— se cargan mientras se lee la fila,
      // no después. El historial se pide desde ya: en el peor caso (una
      // cuenta que ya no existe) se descarta, y eso casi nunca pasa.
      const [{ data }, email, history] = await Promise.all([
        admin.from('players').select('*').eq('id', id).maybeSingle(),
        admin.auth.admin
          .getUserById(id)
          .then((u) => u?.data?.user?.email ?? null, () => null),
        full ? loadHistory(admin, id) : Promise.resolve(undefined),
      ]);
      if (!data) return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 });
      return NextResponse.json({
        user: toUserRow(data as PlayerRow, email),
        history,
      });
    }

    const dateParam = params.get('date');
    const [playersRes, emails, audience, dayAudience, presence] = await Promise.all([
      admin.from('players').select('*').order('created_at', { ascending: false }).limit(300),
      loadEmailMap(admin),
      loadAudience(admin),
      dateParam ? loadDayAudience(admin, dateParam) : Promise.resolve(null),
      loadPresence(admin),
    ]);
    let rows = (playersRes.data ?? []).map((p) =>
      toUserRow(p as PlayerRow, emails.get(p.id) ?? null)
    );

    // ── Búsqueda ──
    // La lista trae solo los 300 registros más recientes (cargarlos
    // todos haría la pantalla lentísima). Eso hacía que buscar una
    // cédula de alguien registrado hace unas semanas no encontrara
    // NADA y pareciera que el usuario no existía. Así que cuando hay
    // término de búsqueda se consulta la tabla ENTERA y lo encontrado
    // se suma a lo que ya estaba cargado.
    const termino = params.get('q')?.trim() ?? '';
    if (termino) {
      const q = termino.toLowerCase();
      // Las comas y los paréntesis son separadores en el filtro `or`
      // de PostgREST: si llegan crudos, rompen la consulta.
      const limpio = termino.replace(/[,()*\\%]/g, ' ').trim();
      // Los dígitos solo se persiguen si lo escrito ES un número: si no,
      // buscar un correo con año dentro devuelve media base (ver
      // lib/admin/busqueda).
      const digitos = digitosDeBusqueda(termino);

      const trozos: string[] = [];
      const campos = [
        'username', 'first_name', 'last_name', 'payout_name',
        'cedula', 'payout_cedula', 'whatsapp', 'payout_phone',
      ];
      if (limpio) for (const c of campos) trozos.push(`${c}.ilike.*${limpio}*`);
      if (digitos && digitos !== limpio) {
        for (const c of ['cedula', 'payout_cedula', 'whatsapp', 'payout_phone']) {
          trozos.push(`${c}.ilike.*${digitos}*`);
        }
      }

      const encontrados: PlayerRow[] = [];
      if (trozos.length) {
        const { data } = await admin.from('players').select('*').or(trozos.join(',')).limit(120);
        encontrados.push(...((data ?? []) as PlayerRow[]));
      }
      // El correo no está en `players`, vive en el registro de acceso
      const idsPorCorreo = [...emails.entries()]
        .filter(([, correo]) => correo.toLowerCase().includes(q))
        .map(([id]) => id)
        .slice(0, 120);
      if (idsPorCorreo.length) {
        const { data } = await admin.from('players').select('*').in('id', idsPorCorreo);
        encontrados.push(...((data ?? []) as PlayerRow[]));
      }

      const yaEstan = new Set(rows.map((r) => r.id));
      for (const p of encontrados) {
        if (yaEstan.has(p.id)) continue;
        yaEstan.add(p.id);
        rows.push(toUserRow(p, emails.get(p.id) ?? null));
      }

      const soloDigitos = (v: string | null | undefined) => (v ?? '').replace(/\D/g, '');
      rows = rows.filter(
        (r) =>
          r.username?.toLowerCase().includes(q) ||
          r.email?.toLowerCase().includes(q) ||
          r.payout_name?.toLowerCase().includes(q) ||
          r.first_name?.toLowerCase().includes(q) ||
          r.last_name?.toLowerCase().includes(q) ||
          // "nombre apellido" escrito de corrido
          `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim().toLowerCase().includes(q) ||
          r.cedula?.toLowerCase().includes(q) ||
          r.payout_cedula?.toLowerCase().includes(q) ||
          r.whatsapp?.toLowerCase().includes(q) ||
          r.payout_phone?.toLowerCase().includes(q) ||
          (digitos !== null &&
            (soloDigitos(r.cedula).includes(digitos) ||
              soloDigitos(r.payout_cedula).includes(digitos) ||
              soloDigitos(r.whatsapp).includes(digitos) ||
              soloDigitos(r.payout_phone).includes(digitos)))
      );
    }

    return NextResponse.json({ users: rows, audience, day_audience: dayAudience, presence });
  } catch {
    return NextResponse.json({ error: 'Error del servidor' }, { status: 500 });
  }
}

interface ActionBody {
  action:
    | 'block'
    | 'unblock'
    | 'delete'
    | 'add_tickets'
    | 'add_balance'
    | 'update_profile'
    | 'fijar_origen';
  player_id: string;
  /** Para add_tickets / add_balance: positivo suma, negativo resta */
  delta?: number;
  /** Para add_tickets / add_balance: por qué se hizo (queda en la bitácora) */
  motivo?: string;
  /** Para update_profile: solo los campos que se quieren cambiar */
  perfil?: PerfilEditable;
  /** Para fijar_origen: de qué recarga sacar la cuenta que pasa a ser la suya */
  purchase_id?: string;
}

// Todo lo que tiene que ver con la cuenta de un JUGADOR lo puede hacer
// también atención al cliente: son ellos los que atienden a alguien
// cuando el banco no reporta su pago, o cuando escribió mal la cédula
// con la que se le paga. Obligarles a buscar a un administrador para
// cada cosa solo hace esperar al jugador.
//
// Lo que sigue cerrado no es una acción sino un LÍMITE: abajo se
// rechaza cualquier cuenta que no sea `role = 'player'`, así que nadie
// del equipo puede bloquear, borrar ni editar a otro del equipo — ni a
// un administrador. Y el área `equipo`, la única que reparte permisos,
// sigue vetada a support en lib/admin/areas.ts.
//
// Cada ajuste de tickets o de saldo queda firmado con su nombre en
// manual_adjustments, y cada campo corregido en player_data_changes,
// con el valor anterior.
export async function POST(req: NextRequest) {
  try {
    const { staff, error } = await requireStaff();
    if (error) return error;
    if (!isAdminClientConfigured()) {
      return NextResponse.json({ error: 'Falta SUPABASE_SECRET_KEY en el servidor' }, { status: 503 });
    }

    const body: ActionBody = await req.json();
    if (!body.player_id) return NextResponse.json({ error: 'Falta el jugador' }, { status: 400 });

    const admin = createAdminClient();
    const { data: target } = await admin
      .from('players')
      .select('id, username, role, tickets, balance')
      .eq('id', body.player_id)
      .maybeSingle();
    if (!target) return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 });
    if (target.role !== 'player') {
      return NextResponse.json(
        { error: 'Las cuentas del equipo se gestionan desde la sección Equipo' },
        { status: 400 }
      );
    }

    // ── Fijar la cuenta desde la que este jugador paga ──
    //
    // Aprobar un pago suelto NO mueve la huella a propósito: si la
    // moviera, cada cambio de banco quedaría bendecido y la regla se
    // vaciaría de sentido. Cambiarla es un acto consciente, y por eso
    // queda firmado con el nombre de quien lo hizo.
    if (body.action === 'fijar_origen') {
      if (!body.purchase_id) {
        return NextResponse.json({ error: 'Falta la recarga' }, { status: 400 });
      }
      const { data: compra } = await admin
        .from('ticket_purchases')
        .select('id, player_id, ocr_origin, ocr_origin_type, ocr_bank, ocr_origin_bank, ocr_origin_cedula, ocr_is_ubii')
        .eq('id', body.purchase_id)
        .eq('player_id', body.player_id)
        .maybeSingle();
      if (!compra) return NextResponse.json({ error: 'Recarga no encontrada' }, { status: 404 });
      if (!compra.ocr_origin) {
        return NextResponse.json(
          { error: 'De esa recarga no se pudo leer desde dónde se pagó.' },
          { status: 400 }
        );
      }
      const h = huellaDe({
        reference: '',
        full_reference: null,
        amount: null,
        bank: compra.ocr_bank,
        origin: compra.ocr_origin,
        origin_type: compra.ocr_origin_type,
        origin_bank: compra.ocr_origin_bank,
        origin_cedula: compra.ocr_origin_cedula,
        is_ubii: compra.ocr_is_ubii === true,
        confidence: null,
        raw: {},
      });
      const { data: quien } = await admin
        .from('players')
        .select('username')
        .eq('id', staff!.userId)
        .maybeSingle();
      const { error: eFijar } = await admin.from('player_payment_origins').upsert(
        {
          player_id: body.player_id,
          banco: h.banco,
          ancla_tipo: h.ancla_tipo,
          ancla: h.ancla,
          muestra: h.muestra,
          fijado_at: new Date().toISOString(),
          fijado_by: staff!.userId,
          fijado_por_nombre: quien?.username ?? null,
          motivo: body.motivo?.trim().slice(0, 200) || 'Fijada a mano desde el panel',
        },
        { onConflict: 'player_id' }
      );
      if (eFijar) {
        return NextResponse.json(
          { error: 'No se pudo fijar la cuenta habitual de este jugador' },
          { status: 400 }
        );
      }
      return NextResponse.json({ ok: true, origen: h });
    }

    if (body.action === 'block' || body.action === 'unblock') {
      const { error: upError } = await admin
        .from('players')
        .update({ blocked: body.action === 'block' })
        .eq('id', body.player_id);
      if (upError) {
        return NextResponse.json(
          { error: 'No se pudo actualizar el estado de la cuenta' },
          { status: 400 }
        );
      }
      return NextResponse.json({ ok: true, blocked: body.action === 'block' });
    }

    // Eliminar la cuenta completa: borra el usuario de auth y TODO
    // cae en cascada (players → partidas, compras, retiros, eventos,
    // chat y sus mensajes).
    if (body.action === 'delete') {
      const { error: delError } = await admin.auth.admin.deleteUser(body.player_id);
      if (delError) {
        return NextResponse.json({ error: 'No se pudo eliminar la cuenta' }, { status: 500 });
      }
      return NextResponse.json({ ok: true });
    }

    if (body.action === 'add_tickets') {
      const delta = Math.trunc(Number(body.delta));
      if (!Number.isFinite(delta) || delta === 0 || Math.abs(delta) > 500) {
        return NextResponse.json({ error: 'Cantidad inválida (entre -500 y 500)' }, { status: 400 });
      }
      const antes = Number(target.tickets ?? 0);
      const tickets = Math.max(0, antes + delta);
      const { error: upError } = await admin
        .from('players')
        .update({ tickets })
        .eq('id', body.player_id);
      if (upError) return NextResponse.json({ error: 'No se pudo actualizar' }, { status: 500 });
      await anotarAjuste(admin, body.player_id, 'tickets', delta, antes, tickets, body.motivo, staff!);
      return NextResponse.json({ ok: true, tickets });
    }

    // Ajuste manual del saldo en dólares (con centavos): para casos
    // como un pago que no cuadra exacto con el precio del ticket
    // (ej. recargó $6.50 → 3 tickets y $0.50 al saldo).
    if (body.action === 'add_balance') {
      const delta = Math.round(Number(body.delta) * 100) / 100;
      if (!Number.isFinite(delta) || delta === 0 || Math.abs(delta) > 500) {
        return NextResponse.json({ error: 'Monto inválido (entre -$500 y $500)' }, { status: 400 });
      }
      const antes = Number(target.balance ?? 0);
      const balance = Math.max(0, Math.round((antes + delta) * 100) / 100);
      const { error: upError } = await admin
        .from('players')
        .update({ balance })
        .eq('id', body.player_id);
      if (upError) return NextResponse.json({ error: 'No se pudo actualizar' }, { status: 500 });
      await anotarAjuste(admin, body.player_id, 'saldo', delta, antes, balance, body.motivo, staff!);
      return NextResponse.json({ ok: true, balance });
    }

    // Corregir los datos del jugador. Es la acción más delicada del
    // panel: entre lo que se puede tocar están la cédula y el teléfono
    // a los que se le PAGA. Por eso todo cambio queda en la bitácora
    // con el valor anterior y quién lo hizo.
    if (body.action === 'update_profile') {
      const revision = revisarPerfil(body.perfil ?? {});
      if (!revision.ok) return NextResponse.json({ error: revision.error }, { status: 400 });
      const datos = revision.datos;

      const { data: actual } = await admin
        .from('players')
        .select('username, first_name, last_name, cedula, whatsapp, payout_name, payout_bank, payout_cedula, payout_phone')
        .eq('id', body.player_id)
        .single();
      if (!actual) return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 });

      // El correo vive en auth, no en players: va aparte
      const { email, ...enPlayers } = datos;
      let correoActual: string | null = null;
      try {
        const { data: u } = await admin.auth.admin.getUserById(body.player_id);
        correoActual = u?.user?.email ?? null;
      } catch {}

      const cambios = diferencias(enPlayers, actual as Record<string, unknown>);
      const cambiaCorreo = email !== undefined && email !== correoActual;
      if (!cambios.length && !cambiaCorreo) {
        return NextResponse.json({ ok: true, cambios: 0, sin_cambios: true });
      }

      // El nombre visible se mantiene al día con nombre + apellido
      const visible = nombreVisible(enPlayers, actual);
      const patch: Record<string, unknown> = Object.fromEntries(
        cambios.map((c) => [c.campo, c.despues])
      );
      if (visible !== null) {
        patch.username = visible;
        cambios.push({ campo: 'username', antes: actual.username ?? null, despues: visible });
      }

      if (Object.keys(patch).length) {
        const { error: upError } = await admin
          .from('players')
          .update(patch)
          .eq('id', body.player_id);
        if (upError) {
          // Índices únicos de players: una cédula una cuenta, un
          // WhatsApp una cuenta.
          if (upError.code === '23505') {
            const cual = /cedula/i.test(upError.message ?? '') ? 'Esa cédula' : 'Ese número de WhatsApp';
            return NextResponse.json(
              { error: `${cual} ya lo tiene otro jugador. Busca esa cuenta antes de seguir.` },
              { status: 409 }
            );
          }
          return NextResponse.json({ error: 'No se pudieron guardar los datos' }, { status: 500 });
        }
      }

      // El correo se cambia el último: si falla, lo de players ya
      // quedó guardado y se avisa de qué parte no se pudo.
      if (cambiaCorreo) {
        const { error: authError } = await admin.auth.admin.updateUserById(body.player_id, {
          email: email!,
          email_confirm: true, // el equipo lo cambia a mano: no hay que confirmarlo por correo
        });
        if (authError) {
          const repetido = /already|registered|exists/i.test(authError.message ?? '');
          await anotarCambios(admin, body.player_id, cambios, staff?.userId ?? null);
          return NextResponse.json(
            {
              error: repetido
                ? 'Ese correo ya lo usa otra cuenta. El resto de los datos sí se guardó.'
                : `No se pudo cambiar el correo (${authError.message}). El resto sí se guardó.`,
            },
            { status: 409 }
          );
        }
        cambios.push({ campo: 'email', antes: correoActual, despues: email! });
        olvidarCorreos(); // que la lista enseñe el correo nuevo ya
      }

      await anotarCambios(admin, body.player_id, cambios, staff?.userId ?? null);
      return NextResponse.json({ ok: true, cambios: cambios.length });
    }

    return NextResponse.json({ error: 'Acción inválida' }, { status: 400 });
  } catch {
    return NextResponse.json({ error: 'Error del servidor' }, { status: 500 });
  }
}

/**
 * Deja constancia de un ＋/− manual de tickets o de saldo, con quién lo
 * hizo y por qué. El nombre del que ajusta se
 * guarda también como TEXTO: si esa cuenta del equipo se elimina, la
 * referencia queda en NULL pero la bitácora tiene que seguir diciendo
 * quién fue.
 *
 * Nunca estorba: si esto falla, el ajuste ya se aplicó y se salta en
 * silencio. Una firma perdida es mucho menos grave que un ajuste que se
 * queda a medias.
 */
async function anotarAjuste(
  admin: ReturnType<typeof createAdminClient>,
  playerId: string,
  tipo: 'tickets' | 'saldo',
  delta: number,
  antes: number,
  despues: number,
  motivo: string | undefined,
  staff: { userId: string; role: string }
) {
  try {
    const { data: quien } = await admin
      .from('players')
      .select('username')
      .eq('id', staff.userId)
      .maybeSingle();
    await admin.from('manual_adjustments').insert({
      player_id: playerId,
      tipo,
      delta,
      antes,
      despues,
      motivo: motivo?.trim() ? motivo.trim().slice(0, 200) : null,
      made_by: staff.userId,
      made_by_name: quien?.username ?? null,
      made_by_role: staff.role,
    });
  } catch {}
}

/**
 * Deja constancia de cada campo cambiado, con su valor anterior. Nunca
 * estorba: si falla, la edición ya se guardó y esto se salta en
 * silencio.
 */
async function anotarCambios(
  admin: ReturnType<typeof createAdminClient>,
  playerId: string,
  cambios: { campo: string; antes: string | null; despues: string | null }[],
  by: string | null
) {
  if (!cambios.length) return;
  try {
    await admin.from('player_data_changes').insert(
      cambios.map((c) => ({
        player_id: playerId,
        campo: c.campo,
        antes: c.antes,
        despues: c.despues,
        changed_by: by,
      }))
    );
  } catch {}
}
