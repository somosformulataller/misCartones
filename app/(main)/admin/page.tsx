'use client';

import { Fragment, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { usePlayer } from '@/components/providers/PlayerProvider';
import {
  AdminPurchaseRow,
  AdminReferralOverview,
  AdminReferralStats,
  AdminStatsResponse,
  AdminUserRow,
  AdminWithdrawalRow,
  AppEventRow,
  AudienceCounts,
  CajaResumen,
  BlockedReference,
  DayAudience,
  InteractionRow,
  PresenceIds,
  InteractionSummary,
  RetentionPlayer,
  RetentionResponse,
  SaludValidacion,
  TopEntry,
} from '@/types/game';
import {
  BANK_VALIDATION_ENABLED,
  PURCHASE_STATUS_LABEL,
  referenceTail,
  TICKET_PRICE_USD,
} from '@/lib/payments/constants';
import { allowedAreas, PANEL_AREAS } from '@/lib/admin/areas';
import { digitosDeBusqueda } from '@/lib/admin/busqueda';
import AdminNav, { AdminSection } from '@/components/admin/AdminNav';
import PlayerDetailModal from '@/components/admin/PlayerDetailModal';
import { OrdenToggle, ordenar, useOrden } from '@/components/admin/OrdenLista';

// Por qué una compra o un retiro pueden salir sin firma: la validación
// automática no tiene a quién nombrar, y una cuenta del equipo borrada
// deja su id en NULL. El nombre en texto de la bitácora cubre el
// segundo caso; el primero es correcto tal cual.
const FIRMA_DESDE =
  'Ahí no hubo nadie del equipo: lo resolvió sola la validación automática contra el banco.';
import ProofModal from '@/components/admin/ProofModal';
import StaffPanel from '@/components/admin/StaffPanel';

/** Semáforo del diario del cron. La conciliación corre cada minuto:
 *  pasar de 5 minutos sin una sola revisión ya es raro, y 15 es un
 *  parón — en el juego hermano hubo uno de diez horas sin refrescar el
 *  banco, con los jugadores esperando sus tickets. */
const nivelSalud = (s: SaludValidacion): 'ok' | 'ojo' | 'mal' => {
  const m = s.minutos ?? 999;
  if (m >= 15) return 'mal';
  if (m >= 5 || (s.hueco_min ?? 0) >= 15) return 'ojo';
  return 'ok';
};

const fmt = (n: number) => `$${Number(n).toFixed(2)}`;
// Cuántas filas se ven de una en las tablas de Transacciones (compras y
// retiros). El resto se recorre con el paginador: así una lista larga de
// aprobadas no empuja la sección de Retiros hacia abajo.
const TX_POR_PAGINA = 5;
const MESES_CORTOS = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
const fmtBs = (n: number) => `Bs. ${Number(n).toFixed(2)}`;
const fmtDate = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString('es', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';

// "12/08/2026" — para el día elegido en el calendario del panel
const fmtDay = (ymd: string) => ymd.split('-').reverse().join('/');
// "12/08" — fechas en corto, para las listas de días jugados
const fmtDayShort = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;
const fmtPct = (x: number) => `${(x * 100).toFixed(1).replace('.', ',')}%`;

// Cómo reparte sus días un jugador (Métrica histórica)
const PATTERN_TAG: Record<RetentionPlayer['pattern'], { label: string; cls: string }> = {
  unico: { label: '1 solo día', cls: '' },
  seguidos: { label: '🔥 Días seguidos', cls: 'ret-tag-seguidos' },
  saltos: { label: '↔️ Con saltos', cls: 'ret-tag-saltos' },
};

// "hace 3 min" — para la última consulta al banco de cada compra
const fmtAgo = (iso: string) => {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (mins < 1) return 'hace un momento';
  if (mins < 60) return `hace ${mins} min`;
  return `hace ${Math.floor(mins / 60)} h`;
};

const EVENT_LABEL: Record<AppEventRow['event_type'], string> = {
  login: '🔐 Inició sesión',
  app_open: '📲 Abrió la app',
  page_view: '🧭 Visitó',
  game_start: '🎟️ Empezó partida',
  game_win: '🏆 Ganó partida',
  game_lose: '💀 Perdió partida',
};

type Section = AdminSection;

// Período de los tops/contadores de Interacción
type InterRange = 'hoy' | '7d' | '30d' | 'todo';
const INTER_RANGE_LABEL: Record<InterRange, string> = {
  hoy: '📅 Hoy',
  '7d': '🗓️ Últimos 7 días',
  '30d': '🗓️ Últimos 30 días',
  todo: '∞ Desde el inicio',
};

// ── Filtro por período del Resumen (día de Venezuela, UTC-4) ──
type StatsRange = 'hoy' | 'ayer' | '7d' | '30d';

const RANGE_LABEL: Record<StatsRange, string> = {
  hoy: '📅 Hoy',
  ayer: '↩️ Ayer',
  '7d': '🗓️ Últimos 7 días',
  '30d': '🗓️ Últimos 30 días',
};

const CARACAS_OFFSET_MS = 4 * 3_600_000;

/** Epoch (ms) de la medianoche de hace `daysAgo` días en Venezuela */
function caracasDayStart(daysAgo: number): number {
  const shifted = new Date(Date.now() - CARACAS_OFFSET_MS);
  return (
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate() - daysAgo) +
    CARACAS_OFFSET_MS
  );
}

function rangeBounds(range: StatsRange): { from: number; to: number } {
  switch (range) {
    case 'hoy':
      return { from: caracasDayStart(0), to: Infinity };
    case 'ayer':
      return { from: caracasDayStart(1), to: caracasDayStart(0) };
    case '7d':
      return { from: caracasDayStart(6), to: Infinity };
    case '30d':
      return { from: caracasDayStart(29), to: Infinity };
  }
}

// Tarjeta de estadística con ícono ℹ️: al tocarlo explica qué mide
// el bloque en relación con la lógica RTP/RNG del juego.
function StatCard({
  value,
  label,
  help,
}: {
  value: string | number;
  label: string;
  help: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="stat-card">
      <button
        className="stat-info"
        onClick={() => setShow((v) => !v)}
        aria-label={`Qué significa ${label}`}
        title={help}
      >
        ℹ️
      </button>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
      {show && <p className="stat-help">{help}</p>}
    </div>
  );
}

// Ranking corto (top 5) para la sección Interacciones
function TopList({
  title,
  entries,
  render,
}: {
  title: string;
  entries: TopEntry[];
  render: (value: number) => string;
}) {
  return (
    <div className="top-card">
      <p className="top-title">{title}</p>
      {entries.length === 0 ? (
        <p className="top-empty">Sin datos todavía</p>
      ) : (
        <ol className="top-list">
          {entries.map((e) => (
            <li key={e.id}>
              <span className="top-name">{e.username || e.id.slice(0, 8)}</span>
              <span className="top-value">{render(Number(e.value))}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// % de cambio de esta semana respecto a la anterior, con flecha y color
function DeltaSemana({ cur, prev }: { cur: number; prev: number }) {
  if (prev <= 0) {
    return cur > 0 ? <span className="ref-delta ref-delta-up">▲ nuevo</span> : null;
  }
  const pct = Math.round(((cur - prev) / prev) * 100);
  const up = pct >= 0;
  return (
    <span className={`ref-delta ${up ? 'ref-delta-up' : 'ref-delta-down'}`}>
      {up ? '▲' : '▼'} {Math.abs(pct)}%
    </span>
  );
}

// Tablero superior de la pestaña Referidos: tarjetas de hoy, filas de la
// semana con su % y la gráfica de afiliados por día (últimos 7 días).
function ReferidosTablero({ stats }: { stats: AdminReferralStats }) {
  const max = Math.max(1, ...stats.chart.map((c) => c.afiliados));
  return (
    <>
      <div className="ref-kpis">
        <div className="ref-kpi">
          <div className="ref-kpi-label">🧑‍🤝‍🧑 Afiliados hoy</div>
          <div className="ref-kpi-num">{stats.afiliados.hoy}</div>
          <div className="ref-kpi-sub">ayer {stats.afiliados.ayer}</div>
        </div>
        <div className="ref-kpi">
          <div className="ref-kpi-label">📣 Recomendaron hoy</div>
          <div className="ref-kpi-num">{stats.recomendando.hoy}</div>
          <div className="ref-kpi-sub">ayer {stats.recomendando.ayer}</div>
        </div>
        <div className="ref-kpi">
          <div className="ref-kpi-label">🎰 De hoy, ya jugaron</div>
          <div className="ref-kpi-num">
            {stats.jugaron_hoy.activos} <span className="ref-kpi-de">de {stats.jugaron_hoy.total}</span>
          </div>
          <div className="ref-kpi-sub">
            ayer {stats.jugaron_ayer.activos} de {stats.jugaron_ayer.total}
          </div>
        </div>
        <div className="ref-kpi">
          <div className="ref-kpi-label">⏳ Premio sin cobrar</div>
          <div className="ref-kpi-num">${stats.premio.usd.toFixed(2)}</div>
          <div className="ref-kpi-sub">
            {stats.premio.personas} {stats.premio.personas === 1 ? 'persona' : 'personas'}
          </div>
        </div>
      </div>

      <div className="ref-weekrows">
        <div className="ref-weekrow">
          <span>🧑‍🤝‍🧑 Afiliados esta semana</span>
          <span className="ref-weekrow-r">
            <strong>{stats.afiliados.semana}</strong>
            <DeltaSemana cur={stats.afiliados.semana} prev={stats.afiliados.semana_prev} />
          </span>
        </div>
        <div className="ref-weekrow">
          <span>📣 Personas recomendando</span>
          <span className="ref-weekrow-r">
            <strong>{stats.recomendando.semana}</strong>
            <DeltaSemana cur={stats.recomendando.semana} prev={stats.recomendando.semana_prev} />
          </span>
        </div>
      </div>

      <p className="admin-hint ref-mini">
        Afiliados — últimos 7 días: <strong>{stats.afiliados.dias7}</strong> · últimos 30 días:{' '}
        <strong>{stats.afiliados.mes}</strong>. Recomendando — 7 días:{' '}
        <strong>{stats.recomendando.dias7}</strong> · 30 días:{' '}
        <strong>{stats.recomendando.mes}</strong>.
      </p>

      {stats.chart.length > 0 && (
        <div className="ref-chart-card">
          <p className="ref-chart-title">📊 Afiliados por día (últimos 7 días)</p>
          <div className="ref-chart">
            {stats.chart.map((c) => (
              <div className="ref-bar-col" key={c.dia}>
                <span className="ref-bar-val">{c.afiliados}</span>
                <div
                  className="ref-bar"
                  style={{ height: `${Math.round((c.afiliados / max) * 100)}%` }}
                />
                <span className="ref-bar-day">{c.dia}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

// Paginador de las tablas de Transacciones. La lista ya está en
// memoria (las 100 recientes, o el histórico si se abrió "Todas"): se
// corta en el cliente para no hacer scroll sin fin. No aparece si todo
// entra en una sola página.
function TxPager({
  page,
  count,
  onPage,
}: {
  page: number;
  count: number;
  onPage: (p: number) => void;
}) {
  const paginas = Math.ceil(count / TX_POR_PAGINA);
  if (paginas <= 1) return null;
  const p = Math.min(page, paginas - 1);
  const desde = p * TX_POR_PAGINA + 1;
  const hasta = Math.min((p + 1) * TX_POR_PAGINA, count);
  return (
    <div className="tx-pager">
      <button className="btn-mini" disabled={p === 0} onClick={() => onPage(p - 1)}>
        ‹ Anteriores
      </button>
      <span className="admin-hint tx-pager-info">
        {desde}–{hasta} de {count} · pág. {p + 1}/{paginas}
      </span>
      <button className="btn-mini" disabled={p + 1 >= paginas} onClick={() => onPage(p + 1)}>
        Siguientes ›
      </button>
    </div>
  );
}

// El panel lee la sección de la URL (?s=...), así que va envuelto en
// <Suspense>: es lo que pide useSearchParams en una página que Next
// prerenderiza (el contenido real se pinta ya en el navegador).
export default function AdminPage() {
  return (
    <Suspense fallback={null}>
      <AdminPanel />
    </Suspense>
  );
}

function AdminPanel() {
  const { player, isLoading, isAdmin, isStaff } = usePlayer();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [section, setSection] = useState<Section>('resumen');
  const [data, setData] = useState<AdminStatsResponse | null>(null);
  const [purchases, setPurchases] = useState<AdminPurchaseRow[]>([]);
  const [withdrawals, setWithdrawals] = useState<AdminWithdrawalRow[]>([]);
  // Tasa BCV del día (llega con /api/admin/payments; null si dolarapi falló)
  const [dayRate, setDayRate] = useState<{ rate: number; fetchedAt: string } | null>(null);
  // Diario del cron de pagos: null si todavía no ha corrido ninguna vez
  const [salud, setSalud] = useState<SaludValidacion | null>(null);
  // Referencias que no se pueden volver a usar (null = no se pudieron
  // leer: el bloque no se enseña y nada más se rompe)
  const [bloqueadas, setBloqueadas] = useState<BlockedReference[] | null>(null);
  // Orden de cada cola (se recuerda por navegador; ver OrdenLista)
  const [ordenCompras, setOrdenCompras] = useOrden('compras');
  const [ordenRetiros, setOrdenRetiros] = useOrden('retiros');
  // Página visible de cada tabla de Transacciones (5 por página)
  const [pageCompras, setPageCompras] = useState(0);
  const [pageRetiros, setPageRetiros] = useState(0);
  // Referencia suelta que se va a invalidar a mano
  const [refBloquear, setRefBloquear] = useState('');
  const [interaction, setInteraction] = useState<InteractionRow[]>([]);
  const [interSummary, setInterSummary] = useState<InteractionSummary | null>(null);
  // Audiencia (registrados/activos): llega con usuarios o interacción
  const [audience, setAudience] = useState<AudienceCounts | null>(null);
  const [interRange, setInterRange] = useState<InterRange>('todo');
  // Día del calendario (YYYY-MM-DD): manda sobre el rango elegido
  const [pickDate, setPickDate] = useState('');
  const [dayAudience, setDayAudience] = useState<DayAudience | null>(null);
  // Estado actual: quién juega AHORA y quién ha comprado tickets
  const [presence, setPresence] = useState<PresenceIds | null>(null);
  // Con día elegido, la lista de usuarios puede acotarse más
  const [userDayFilter, setUserDayFilter] = useState<
    'todos' | 'registrados' | 'activos' | 'recargaron'
  >('todos');
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [userSearch, setUserSearch] = useState('');
  // Descarga del .txt con todos los correos (se genera en vivo)
  const [descargandoEmails, setDescargandoEmails] = useState(false);
  const descargarEmails = async () => {
    if (descargandoEmails) return;
    setDescargandoEmails(true);
    try {
      const res = await fetch('/api/admin/emails-export');
      if (!res.ok) {
        let msg = 'No se pudo generar la lista de correos.';
        try {
          const j = await res.json();
          if (j?.error) msg = j.error;
        } catch {}
        alert(msg);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      // El nombre (con la fecha de Caracas) lo pone el servidor en la
      // cabecera; al bajar un blob el navegador no la lee, así que la
      // reusamos aquí.
      const cd = res.headers.get('Content-Disposition') || '';
      const m = cd.match(/filename="?([^"]+)"?/);
      a.download = m ? m[1] : `emails-${new Date().toISOString().slice(0, 10)}.txt`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      alert('No se pudo generar la lista de correos.');
    } finally {
      setDescargandoEmails(false);
    }
  };
  // Resultados que el servidor encontró FUERA de los 300 cargados
  const [hallados, setHallados] = useState<AdminUserRow[]>([]);
  const [buscandoUsuarios, setBuscandoUsuarios] = useState(false);
  // Métrica histórica de recurrencia (se pide solo al abrir su pestaña)
  const [retention, setRetention] = useState<RetentionResponse | null>(null);
  const [retSearch, setRetSearch] = useState('');
  const [txSearch, setTxSearch] = useState('');
  // Transacciones que el servidor encontró fuera de las 100 cargadas
  const [txHallados, setTxHallados] = useState<{
    purchases: AdminPurchaseRow[];
    withdrawals: AdminWithdrawalRow[];
  }>({ purchases: [], withdrawals: [] });
  const [buscandoTx, setBuscandoTx] = useState(false);
  // La lista COMPLETA (más allá de las 100 recientes). Se pide solo al
  // abrir "Todas": ahí es donde se busca una transacción vieja, o la
  // compra que hay detrás de una referencia bloqueada.
  const [txTodas, setTxTodas] = useState<{
    purchases: AdminPurchaseRow[];
    withdrawals: AdminWithdrawalRow[];
  }>({ purchases: [], withdrawals: [] });
  const [cargandoTodas, setCargandoTodas] = useState(false);
  // Caja de los últimos 30 días (se pide al abrir su pestaña)
  const [caja, setCaja] = useState<CajaResumen | null>(null);
  const [cargandoCaja, setCargandoCaja] = useState(false);
  // Referidos: estadísticas del programa de afiliados (se pide al abrir
  // su pestaña). refAbierto = qué referidor tiene la lista desplegada.
  const [referral, setReferral] = useState<AdminReferralOverview | null>(null);
  const [cargandoReferral, setCargandoReferral] = useState(false);
  const [refSearch, setRefSearch] = useState('');
  const [refAbierto, setRefAbierto] = useState<string | null>(null);
  const [statsRange, setStatsRange] = useState<StatsRange>('hoy');
  const [flowPlayer, setFlowPlayer] = useState<string | null>(null);
  const [flowEvents, setFlowEvents] = useState<AppEventRow[]>([]);
  // 'bloqueadas' no filtra compras: enseña la lista negra de
  // referencias en el sitio de la tabla (es parte del mismo trabajo:
  // decidir qué pagos valen y cuáles no)
  const [purchaseFilter, setPurchaseFilter] = useState<
    'pendientes' | 'banco' | 'aprobadas' | 'rechazadas' | 'bloqueadas' | 'todas'
  >('pendientes');
  const [withdrawalFilter, setWithdrawalFilter] = useState<
    'pendientes' | 'pagados' | 'cancelados' | 'todos'
  >('pendientes');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [openDetail, setOpenDetail] = useState<{
    key: string;
    playerId: string;
    username: string | null;
  } | null>(null);

  // Áreas del panel visibles para este miembro del staff (un admin
  // sin restricciones ve todo; atención al cliente, solo lo asignado)
  const allowed = useMemo(
    () => allowedAreas(player?.role, player?.panel_areas),
    [player]
  );

  // Solo staff: los demás vuelven al inicio (la API y RLS también protegen)
  useEffect(() => {
    if (!isLoading && !isStaff) router.replace(player ? '/juego' : '/auth/login');
  }, [isLoading, isStaff, player, router]);

  // Sección desde la URL (/admin?s=usuarios): así el menú del header y
  // el del chat pueden entrar directos a una pestaña. Se sigue leyendo
  // DESPUÉS de la carga inicial porque estando ya en /admin la página
  // no se vuelve a montar: sin esto, tocar «📅 Métrica histórica» en el
  // header cambiaría la dirección y no la pestaña.
  // Las secciones válidas salen de PANEL_AREAS, no de una lista escrita
  // a mano: en el juego hermano esa lista se quedó sin 'caja' al añadir
  // la pestaña, y el enlace del header cambiaba la dirección sin
  // cambiar de pestaña.
  const urlSection = searchParams.get('s');
  useEffect(() => {
    const secciones = PANEL_AREAS.map((a) => a.key);
    if (urlSection && (secciones as string[]).includes(urlSection)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sincronización con la URL
      setSection(urlSection as Section);
    }
  }, [urlSection]);

  // Si la sección actual no está permitida para esta cuenta, saltar
  // a la primera que sí lo esté (p. ej. atención sin Resumen).
  useEffect(() => {
    if (!player || allowed.length === 0) return;
    if (!allowed.includes(section)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- corrección única de la sección
      setSection(allowed[0] as Section);
    }
  }, [player, allowed, section, router]);

  const selectSection = (s: Section) => {
    setSection(s);
    window.history.replaceState(null, '', `/admin?s=${s}`);
  };

  // Un 401 suelto no es "sesión perdida": suele ser el token de
  // Supabase renovándose justo en ese tick (expira cada hora). Se
  // reintenta UNA vez en corto antes de mostrar el error.
  const retried401 = useRef(false);

  // Solo se piden las áreas permitidas (las demás responderían 403).
  // Cada endpoint se procesa APENAS responde — sin esperar al resto:
  // antes un solo endpoint lento (p. ej. la tasa BCV atascada en
  // /api/admin/payments) congelaba el panel entero varios segundos.
  const loadAll = useCallback(async () => {
    if (allowed.length === 0) return;
    const can = (a: string) => allowed.includes(a as (typeof allowed)[number]);
    const tasks: Promise<void>[] = [];

    if (can('resumen') || can('partidas')) {
      tasks.push(
        (async () => {
          const statsRes = await fetch('/api/admin/stats', { cache: 'no-store' });
          const stats = await statsRes.json();
          if (!statsRes.ok) {
            if (statsRes.status === 401 && !retried401.current) {
              retried401.current = true;
              setTimeout(() => loadAll(), 1500);
            } else {
              setError(stats.error || 'Error al cargar estadísticas');
            }
          } else {
            retried401.current = false;
            setData(stats);
            setError(null);
          }
        })().catch(() => setError('Error de conexión'))
      );
    } else {
      setError(null);
    }

    if (can('transacciones')) {
      tasks.push(
        (async () => {
          const res = await fetch('/api/admin/payments', { cache: 'no-store' });
          if (!res.ok) return;
          const payments = await res.json();
          setPurchases(payments.purchases ?? []);
          setWithdrawals(payments.withdrawals ?? []);
          setDayRate(payments.exchange_rate ?? null);
          setSalud(payments.salud ?? null);
          setBloqueadas(payments.bloqueadas ?? null);
        })().catch(() => {})
      );
    }

    if (can('interacciones')) {
      tasks.push(
        (async () => {
          const res = await fetch(
            `/api/admin/interaction?range=${interRange}${pickDate ? `&date=${pickDate}` : ''}`,
            { cache: 'no-store' }
          );
          if (!res.ok) return;
          const inter = await res.json();
          setInteraction(inter.players ?? []);
          setInterSummary(inter.summary ?? null);
          if (inter.summary?.audience) setAudience(inter.summary.audience);
          if (inter.summary?.day_audience) setDayAudience(inter.summary.day_audience);
          if (inter.presence) setPresence(inter.presence);
        })().catch(() => {})
      );
    }

    if (can('usuarios')) {
      tasks.push(
        (async () => {
          const res = await fetch(`/api/admin/users${pickDate ? `?date=${pickDate}` : ''}`, {
            cache: 'no-store',
          });
          if (!res.ok) return;
          const usersData = await res.json();
          setUsers(usersData.users ?? []);
          if (usersData.audience) setAudience(usersData.audience);
          if (usersData.day_audience) setDayAudience(usersData.day_audience);
          if (usersData.presence) setPresence(usersData.presence);
        })().catch(() => {})
      );
    }

    await Promise.allSettled(tasks);
  }, [allowed, interRange, pickDate]);

  useEffect(() => {
    if (!isStaff) return;
    // La carga es asíncrona: el setState ocurre tras el fetch, no en el
    // cuerpo del efecto.
    loadAll();
    const interval = setInterval(loadAll, 30_000); // refresco en vivo
    return () => clearInterval(interval);
  }, [isStaff, loadAll]);

  // Al cambiar de filtro o de búsqueda, las tablas vuelven a la página 1:
  // si no, quedarían mostrando una página que ya no existe en la lista
  // nueva. Se hace AQUÍ, en el manejador, y no en un efecto: es la
  // consecuencia inmediata del clic, no una sincronización con nada de
  // fuera, y por un efecto la tabla se pintaba dos veces —una en la
  // página vieja y otra en la 1.
  const elegirFiltroCompras = (filtro: typeof purchaseFilter) => {
    setPurchaseFilter(filtro);
    setPageCompras(0);
  };
  const elegirFiltroRetiros = (filtro: typeof withdrawalFilter) => {
    setWithdrawalFilter(filtro);
    setPageRetiros(0);
  };
  const buscarTx = (texto: string) => {
    setTxSearch(texto);
    setPageCompras(0);
    setPageRetiros(0);
  };

  // La métrica histórica recorre TODAS las partidas de la app, así que
  // no entra en el refresco de 30 s del resto del panel: se pide al
  // abrir su pestaña y se refresca cada 2 minutos mientras esté a la
  // vista (es histórica, no cambia de un segundo a otro).
  useEffect(() => {
    if (!isStaff || section !== 'metricas' || !allowed.includes('metricas')) return;
    const load = async () => {
      try {
        const res = await fetch('/api/admin/retention', { cache: 'no-store' });
        const json = await res.json();
        if (res.ok) setRetention(json);
        else setError(json.error || 'No se pudo cargar la métrica histórica');
      } catch {}
    };
    load();
    const t = setInterval(load, 120_000);
    return () => clearInterval(t);
  }, [isStaff, section, allowed]);

  // Buscar transacciones en TODO el histórico, no solo en las 100 que
  // trae la lista: una referencia de hace semanas no aparecía y parecía
  // que el pago no existía nunca. Lo hallado se guarda aparte y solo se
  // junta mientras dura la búsqueda, para no descuadrar los contadores.
  useEffect(() => {
    const termino = txSearch.trim();
    if (!isStaff || !allowed.includes('transacciones') || termino.length < 3) {
      // Con menos de 3 letras no hay búsqueda que valga: se tiran los
      // resultados de la anterior en el acto, para que la tabla no siga
      // enseñando lo que se encontró de algo que ya no se está buscando.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTxHallados({ purchases: [], withdrawals: [] });
      setBuscandoTx(false);
      return;
    }
    let cancelado = false;
    // «Buscando…» se enciende YA, antes del medio segundo de espera: si no,
    // escribir parece que no hace nada.
    setBuscandoTx(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/admin/payments?q=${encodeURIComponent(termino)}`, {
          cache: 'no-store',
        });
        const json = await res.json();
        if (!cancelado && res.ok) {
          setTxHallados({
            purchases: json.purchases ?? [],
            withdrawals: json.withdrawals ?? [],
          });
        }
      } catch {
        /* la lista local sigue funcionando */
      } finally {
        if (!cancelado) setBuscandoTx(false);
      }
    }, 500);
    return () => {
      cancelado = true;
      clearTimeout(t);
    };
  }, [txSearch, isStaff, allowed]);

  // La caja de 30 días se pide al abrir su pestaña y se refresca cada
  // vez que se vuelve a ella: es un resumen para mirar, no un tablero
  // que haya que vigilar segundo a segundo.
  useEffect(() => {
    if (!isStaff || !allowed.includes('caja') || section !== 'caja') return;
    let cancelado = false;
    // Indicador de carga al abrir la pestaña, antes de pedir nada.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCargandoCaja(true);
    (async () => {
      try {
        const res = await fetch('/api/admin/caja', { cache: 'no-store' });
        const json = await res.json();
        if (!cancelado && res.ok) setCaja(json);
      } catch {
        /* se queda con lo que hubiera */
      } finally {
        if (!cancelado) setCargandoCaja(false);
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [section, isStaff, allowed]);

  // Referidos: se pide al abrir su pestaña y se refresca cada 2 minutos
  // mientras esté a la vista (la actividad de los referidos —partidas,
  // compras— no cambia de un segundo a otro). Lo calcula todo el RPC.
  useEffect(() => {
    if (!isStaff || !allowed.includes('referidos') || section !== 'referidos') return;
    let cancelado = false;
    // Encender el indicador de carga al abrir la pestaña: es el efecto quien
    // sabe que la petición va a empezar, no ningún manejador de evento.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCargandoReferral(true);
    const load = async () => {
      try {
        const res = await fetch('/api/admin/referrals', { cache: 'no-store' });
        const json = await res.json();
        if (cancelado) return;
        if (res.ok) setReferral(json);
        else setError(json.error || 'No se pudo cargar Referidos');
      } catch {
        /* se queda con lo que hubiera */
      } finally {
        if (!cancelado) setCargandoReferral(false);
      }
    };
    load();
    const t = setInterval(load, 120_000);
    return () => {
      cancelado = true;
      clearInterval(t);
    };
  }, [section, isStaff, allowed]);

  // "Todas" (compras o retiros) trae la lista entera una vez. No se
  // refresca sola cada 30 s: para eso están las otras pestañas.
  const quiereTodas = purchaseFilter === 'todas' || withdrawalFilter === 'todos';
  useEffect(() => {
    if (!isStaff || !allowed.includes('transacciones') || !quiereTodas) return;
    if (txTodas.purchases.length || txTodas.withdrawals.length) return;
    let cancelado = false;
    // La lista completa tarda, y el contador tiene que decir «…» desde ya.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCargandoTodas(true);
    (async () => {
      try {
        const res = await fetch('/api/admin/payments?todas=1', { cache: 'no-store' });
        const json = await res.json();
        if (!cancelado && res.ok) {
          setTxTodas({ purchases: json.purchases ?? [], withdrawals: json.withdrawals ?? [] });
        }
      } catch {
        /* se queda con las 100 recientes */
      } finally {
        if (!cancelado) setCargandoTodas(false);
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [quiereTodas, isStaff, allowed, txTodas.purchases.length, txTodas.withdrawals.length]);

  // Buscar usuarios en TODA la tabla, no solo en los 300 que trae la
  // lista. Sin esto, buscar la cédula de alguien registrado hace unas
  // semanas no devolvía nada y parecía que la cuenta no existía.
  // Se espera medio segundo desde la última tecla para no lanzar una
  // consulta por letra.
  useEffect(() => {
    const termino = userSearch.trim();
    if (!isStaff || !allowed.includes('usuarios') || termino.length < 3) {
      // Igual que el buscador de transacciones: los resultados de la
      // búsqueda anterior se tiran en el acto.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHallados([]);
      setBuscandoUsuarios(false);
      return;
    }
    let cancelado = false;
    setBuscandoUsuarios(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/admin/users?q=${encodeURIComponent(termino)}`, {
          cache: 'no-store',
        });
        const json = await res.json();
        if (!cancelado && res.ok) setHallados(json.users ?? []);
      } catch {
        /* la lista local sigue funcionando */
      } finally {
        if (!cancelado) setBuscandoUsuarios(false);
      }
    }, 500);
    return () => {
      cancelado = true;
      clearTimeout(t);
    };
  }, [userSearch, isStaff, allowed]);

  const doAction = async (body: Record<string, string | number | boolean>) => {
    setBusy(true);
    try {
      const res = await fetch('/api/admin/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) alert(json.error || 'No se pudo completar la acción');
      // El rechazo salió bien pero el bloqueo no (migración 019 sin
      // correr, o referencia demasiado corta). Hay que decirlo: si no,
      // quien lo marcó se queda creyendo que esa referencia ya no vale.
      else if (json.bloqueada === false) {
        alert(
          'La compra se rechazó, pero la referencia NO se pudo bloquear.\n\n' +
            'Avisa al equipo técnico: puede seguir usándose.'
        );
      }
      await loadAll();
    } catch {
      alert('Error de conexión');
    } finally {
      setBusy(false);
    }
  };

  const approvePurchase = (p: AdminPurchaseRow) => {
    if (!confirm(`¿Aprobar ${p.quantity} ticket(s) de ${p.username || p.player_id.slice(0, 8)}?`))
      return;
    doAction({ action: 'approve_purchase', id: p.id });
  };

  const rejectPurchase = (p: AdminPurchaseRow) => {
    const note = prompt(
      `Motivo del rechazo del pago con referencia ${p.reference}:` +
        (p.status === 'aprobado' ? '\n(Se le descontarán los tickets acreditados.)' : '')
    );
    if (!note?.trim()) return;
    // Rechazar NO bloquea la referencia: casi todos los rechazos son
    // errores honestos (un dígito mal copiado) y bloquear esos dejaría
    // al jugador sin poder registrar el pago que sí hizo. Para el
    // fraude está el botón «Invalidar referencia», que hace las dos
    // cosas a la vez.
    doAction({ action: 'reject_purchase', id: p.id, note: note.trim() });
  };

  // Invalidar desde una compra = RECHAZARLA y bloquear su referencia, en
  // un solo paso. En el juego hermano eran dos botones que se pisaban y
  // había que saberse la diferencia. Si la compra ya estaba rechazada,
  // solo queda bloquear el número.
  const invalidarCompra = (p: AdminPurchaseRow) => {
    const quien = p.username || p.player_id.slice(0, 8);
    const queHace =
      p.status === 'rechazado'
        ? 'La compra ya está rechazada: solo se bloquea el número.'
        : p.status === 'aprobado'
        ? 'La compra APROBADA se rechaza (se le descuentan los tickets acreditados) y el número queda bloqueado.'
        : 'La compra se rechaza y el número queda bloqueado.';
    const note = prompt(
      `¿Por qué se invalida la referencia ${p.reference} de ${quien}?\n\n` +
        `${queHace} Nadie —ni este jugador ni ningún otro— podrá volver a registrar una compra con esa referencia.\n\n` +
        'Escribe el motivo: es lo que leerá el equipo dentro de un mes.'
    );
    if (!note?.trim()) return;
    if (p.status === 'rechazado') {
      doAction({ action: 'block_reference', id: p.reference, note: note.trim() });
    } else {
      doAction({ action: 'reject_purchase', id: p.id, note: note.trim(), block: true });
    }
  };

  const unblockReference = (ref: string) => {
    if (!confirm(`¿Desbloquear la referencia ${ref}?\n\nVolverá a poder usarse en una compra.`)) {
      return;
    }
    doAction({ action: 'unblock_reference', id: ref });
  };

  // Invalidar una referencia ESCRITA A MANO: la que nunca llegó a
  // registrarse en ninguna compra (pago incompleto que se completó con
  // otra). No usa doAction porque hay que leer la respuesta: si ese
  // número resulta estar en una compra viva, se avisa — para esas está
  // el botón de la propia compra, que además la rechaza.
  const invalidarSuelta = async (ref: string) => {
    const limpia = ref.trim();
    if (!limpia) return;
    const note = prompt(
      `¿Por qué se invalida la referencia ${limpia}?\n\n` +
        'Nadie podrá registrar una compra con ella. Esto NO toca ninguna compra existente.\n\n' +
        'Escribe el motivo: es lo que leerá el equipo dentro de un mes ' +
        '(por ejemplo: «pago incompleto, mandó la diferencia con otra referencia»).'
    );
    if (!note?.trim()) return;
    setBusy(true);
    try {
      const res = await fetch('/api/admin/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'block_reference', id: limpia, note: note.trim() }),
      });
      const json = await res.json();
      if (!res.ok) {
        alert(json.error || 'No se pudo invalidar esa referencia');
      } else {
        setRefBloquear('');
        if (json.usada_en) {
          const quien = json.usada_en.username ? ` de ${json.usada_en.username}` : '';
          alert(
            `Referencia …${json.cola} invalidada.\n\n` +
              `OJO: hay una compra ${json.usada_en.status}${quien} con ese número, y esto NO la ` +
              'rechaza. Para rechazar y bloquear a la vez, usa «Invalidar referencia» en esa compra.'
          );
        } else {
          alert(`Referencia …${json.cola} invalidada: ya no se puede registrar ninguna compra con ella.`);
        }
      }
      await loadAll();
    } catch {
      alert('Error de conexión');
    } finally {
      setBusy(false);
    }
  };

  // Corregir la cantidad de tickets: cuando el pago real no cuadra
  // con lo que el jugador solicitó (el monto esperado se recalcula).
  const editQuantity = (p: AdminPurchaseRow) => {
    const input = prompt(
      `Cantidad de tickets a aprobar para ${p.username || p.player_id.slice(0, 8)}\n` +
        `(solicitó ${p.quantity} 🎟️ = ${fmt(Number(p.amount_usd))}). El monto esperado se recalcula:`,
      String(p.quantity)
    );
    if (input === null) return;
    const qty = Number(input.trim());
    if (!Number.isInteger(qty) || qty < 1 || qty > 50) {
      alert('Cantidad inválida (1 a 50).');
      return;
    }
    if (qty === p.quantity) return;
    doAction({ action: 'edit_purchase', id: p.id, quantity: String(qty) });
  };

  // Corregir la referencia: cuando el jugador la escribió mal. Tras
  // el cambio, el banco la verifica de nuevo enseguida.
  const editReference = (p: AdminPurchaseRow) => {
    const input = prompt(
      'Nuevo número de referencia del pago (se volverá a verificar con el banco):',
      p.reference
    );
    if (!input?.trim() || input.trim() === p.reference) return;
    doAction({ action: 'edit_purchase', id: p.id, reference: input.trim() });
  };

  const payWithdrawal = (w: AdminWithdrawalRow) => {
    const bsHint = dayRate
      ? ` (≈ ${fmtBs(Number(w.amount_usd) * dayRate.rate)} a la tasa del día)`
      : '';
    const reference = prompt(
      `Retiro de ${fmt(Number(w.amount_usd))}${bsHint} a ${w.username || 'jugador'}.\n` +
        'Escribe el número de referencia del Pago Móvil que hiciste:'
    );
    if (!reference?.trim()) return;
    doAction({ action: 'pay_withdrawal', id: w.id, reference: reference.trim() });
  };

  const cancelWithdrawal = (w: AdminWithdrawalRow) => {
    if (
      !confirm(
        `¿Cancelar el retiro de ${fmt(Number(w.amount_usd))}? El monto vuelve a la billetera del jugador.`
      )
    )
      return;
    doAction({ action: 'cancel_withdrawal', id: w.id });
  };

  const toggleFlow = async (id: string) => {
    if (flowPlayer === id) {
      setFlowPlayer(null);
      setFlowEvents([]);
      return;
    }
    setFlowPlayer(id);
    setFlowEvents([]);
    try {
      const res = await fetch(`/api/admin/interaction?player=${id}`, { cache: 'no-store' });
      const json = await res.json();
      if (res.ok) setFlowEvents(json.events ?? []);
    } catch {}
  };

  // El comprobante se abre en un modal encima del panel (la URL firmada
  // la pide ese modal al abrirse: firmarlas todas en cada carga
  // saturaba el storage).
  const [proof, setProof] = useState<{ id: string; reference: string | null } | null>(null);

  const copyPayoutData = (w: AdminWithdrawalRow) => {
    // El monto de pago se copia junto con los datos: en bolívares (lo que
    // de verdad se paga por Pago Móvil, a la tasa del día) y, si aún no
    // cargó la tasa, al menos en dólares para no quedar sin monto.
    const monto = dayRate
      ? `Monto: ${fmtBs(Number(w.amount_usd) * dayRate.rate)}`
      : `Monto: ${fmt(Number(w.amount_usd))}`;
    const text = `Nombre: ${w.payout_name ?? '—'}\nBanco: ${w.payout_bank ?? '—'}\nCédula: ${w.payout_cedula ?? '—'}\nTeléfono: ${w.payout_phone ?? '—'}\n${monto}`;
    navigator.clipboard?.writeText(text).catch(() => {});
  };

  if (!isStaff || !player) return null;

  // Tocar el nombre del jugador abre su ficha en un MODAL (antes se
  // desplegaba bajo la fila y empujaba toda la tabla). La clave sigue
  // siendo única por fila para saber cuál está abierta.
  const playerBtn = (key: string, playerId: string, username: string | null) => {
    const isOpen = openDetail?.key === key;
    return (
      <button
        className={`pchip ${isOpen ? 'pchip-open' : ''}`}
        onClick={() => setOpenDetail(isOpen ? null : { key, playerId, username })}
        aria-haspopup="dialog"
      >
        {username || playerId.slice(0, 8)} <span className="pchip-caret">👁</span>
      </button>
    );
  };

  const stats = data?.stats;

  // ── Audiencia: registrados y activos (Usuarios e Interacción) ──
  // Tabla compacta + calendario para consultar un día concreto.
  const clearDay = () => {
    setPickDate('');
    setDayAudience(null);
    setUserDayFilter('todos');
  };
  // Etiqueta del período activo en Interacción (día del calendario o rango)
  const interPeriodLabel = pickDate ? `📆 ${fmtDay(pickDate)}` : INTER_RANGE_LABEL[interRange];
  const audienceBlock = (
    <div className="admin-aud">
      <div className="admin-aud-head">
        <h3 className="admin-sub-title">👥 Audiencia</h3>
        <label className="admin-cal-label">
          📆 Ver un día:
          <input
            type="date"
            className="admin-cal-input"
            value={pickDate}
            onChange={(e) => (e.target.value ? setPickDate(e.target.value) : clearDay())}
          />
        </label>
        {pickDate && (
          <button className="btn-mini" onClick={clearDay}>
            ✕ Quitar día
          </button>
        )}
      </div>
      {pickDate && dayAudience && (
        <p className="admin-day-result">
          📆 El {fmtDay(dayAudience.date)}: <strong>{dayAudience.registered}</strong>{' '}
          registrado{dayAudience.registered === 1 ? '' : 's'} ·{' '}
          <strong>{dayAudience.active}</strong> activo{dayAudience.active === 1 ? '' : 's'} ·{' '}
          <strong>{dayAudience.recharged ?? 0}</strong> recargaron
        </p>
      )}
      {audience && (
        <div className="admin-table-wrap">
          <table className="admin-table admin-aud-table">
            <thead>
              <tr>
                <th></th>
                <th>Hoy</th>
                <th>7 días</th>
                <th>30 días</th>
                <th>Año</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>👥 Registrados</td>
                <td>{audience.registered.hoy}</td>
                <td>{audience.registered.semana}</td>
                <td>{audience.registered.mes}</td>
                <td>{audience.registered.anio}</td>
                <td>{audience.registered.total}</td>
              </tr>
              <tr>
                <td>🟢 Activos</td>
                <td>{audience.active.hoy}</td>
                <td>{audience.active.semana}</td>
                <td>{audience.active.mes}</td>
                <td>{audience.active.anio}</td>
                <td>—</td>
              </tr>
              {audience.recharged && (
                <tr>
                  <td>💳 Recargaron</td>
                  <td>{audience.recharged.hoy}</td>
                  <td>{audience.recharged.semana}</td>
                  <td>{audience.recharged.mes}</td>
                  <td>{audience.recharged.anio}</td>
                  <td>—</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <p className="admin-hint">
        Activo = jugó al menos una partida o compró tickets (aprobados) en la ventana — solo
        navegar por la app NO cuenta. Recargaron = hicieron al menos una recarga aprobada.
        Todas las ventanas usan el día de Venezuela.
      </p>
    </div>
  );

  // ── Métricas del período elegido (Resumen): recargas y retiros ──
  const { from, to } = rangeBounds(statsRange);
  const inRange = (iso: string | null | undefined, fallback: string) => {
    const t = new Date(iso ?? fallback).getTime();
    return t >= from && t < to;
  };
  const periodPurchases = (data?.finance?.purchases ?? []).filter((p) =>
    inRange(p.validated_at, p.created_at)
  );
  const periodWithdrawals = (data?.finance?.withdrawals ?? []).filter((w) =>
    inRange(w.paid_at, w.created_at)
  );
  const periodCollected = periodPurchases.reduce((s, p) => s + Number(p.amount_usd), 0);
  const periodWithdrawn = periodWithdrawals.reduce((s, w) => s + Number(w.amount_usd), 0);

  // ── Buscador de Transacciones: referencia (completa o últimos
  // dígitos), nombre, teléfono o cédula ──
  const tq = txSearch.trim().toLowerCase().replace(/\s/g, '');
  const matchesTx = (row: {
    reference?: string | null;
    username: string | null;
    whatsapp?: string | null;
    cedula?: string | null;
    payout_phone?: string | null;
    payout_cedula?: string | null;
  }) => {
    if (!tq) return true;
    const haystacks = [
      row.reference,
      row.username,
      row.whatsapp,
      row.cedula,
      row.payout_phone,
      row.payout_cedula,
    ];
    return haystacks.some((h) => h?.toLowerCase().replace(/\s/g, '').includes(tq));
  };
  // Con búsqueda activa se suman las que el servidor encontró en el
  // resto del histórico; sin búsqueda, la lista es la de siempre.
  // Se añade lo que trajo la búsqueda (si hay búsqueda) y lo que trajo
  // "Todas" (si esa pestaña está abierta). Sin ninguna de las dos, la
  // lista es la de siempre: las 100 recientes.
  const sumar = <T extends { id: string }>(base: T[], ...extras: T[][]) => {
    const vistos = new Set(base.map((b) => b.id));
    const fuera: T[] = [];
    for (const lista of extras) {
      for (const e of lista) {
        if (vistos.has(e.id)) continue;
        vistos.add(e.id);
        fuera.push(e);
      }
    }
    return fuera.length ? [...base, ...fuera] : base;
  };
  const searchedPurchases = sumar(
    purchases,
    tq ? txHallados.purchases : [],
    quiereTodas ? txTodas.purchases : []
  ).filter(matchesTx);
  const searchedWithdrawals = sumar(
    withdrawals,
    tq ? txHallados.withdrawals : [],
    quiereTodas ? txTodas.withdrawals : []
  ).filter(matchesTx);

  // Cada compra vive en SU filtro. Las no resueltas se separan en dos:
  // las que el banco sigue verificando solo (🏦 En proceso) y las que
  // esperan una decisión del equipo (🕒 Pendientes: referencias
  // repetidas, montos que no cuadran, etc.).
  const inBankQueue = (p: AdminPurchaseRow) =>
    p.bank_state === 'esperando_banco' || p.bank_state === 'consultando';
  const unresolvedPurchases = searchedPurchases.filter(
    (p) => p.status === 'pendiente' || p.status === 'validando'
  );
  const purchaseBuckets = {
    pendientes: unresolvedPurchases.filter((p) => !inBankQueue(p)),
    banco: unresolvedPurchases.filter(inBankQueue),
    aprobadas: searchedPurchases.filter((p) => p.status === 'aprobado'),
    rechazadas: searchedPurchases.filter((p) => p.status === 'rechazado'),
    todas: searchedPurchases,
  } as const;
  // El orden lo manda quien mira (por defecto, el que más lleva
  // esperando arriba). Se aplica DESPUÉS de filtrar, sobre lo que se va
  // a pintar: el servidor sigue trayendo las 100 más recientes.
  // Buscando se enseña TODO lo que casa, sin importar la pestaña: si
  // alguien pega una referencia y la compra resulta estar aprobada
  // mientras la pestaña abierta es "Pendientes", la tabla salía vacía y
  // parecía que ese pago no existía.
  const filtroCompras = tq ? 'todas' : purchaseFilter;
  const visiblePurchases =
    filtroCompras === 'bloqueadas'
      ? []
      : ordenar(purchaseBuckets[filtroCompras], ordenCompras, (p) => p.created_at);
  const pendingWithdrawals = searchedWithdrawals.filter((w) => w.status === 'pendiente');
  const otherWithdrawals = searchedWithdrawals.filter((w) => w.status !== 'pendiente');
  const withdrawalBuckets = {
    pendientes: pendingWithdrawals,
    pagados: searchedWithdrawals.filter((w) => w.status === 'pagado'),
    cancelados: searchedWithdrawals.filter((w) => w.status === 'cancelado'),
    todos: [...pendingWithdrawals, ...otherWithdrawals],
  } as const;
  // Las colas de 6 dígitos ya invalidadas: para que el botón de cada
  // compra diga si esa referencia sigue sirviendo o no
  const refsInvalidadas = new Set((bloqueadas ?? []).map((b) => b.reference_norm));

  const visibleWithdrawals = ordenar(
    withdrawalBuckets[tq ? 'todos' : withdrawalFilter],
    ordenRetiros,
    (w) => w.created_at
  );

  // Solo se pinta una página (5 filas); el resto va con el paginador.
  // La página se acota por si la lista encogió (p. ej. tras aprobar).
  const compraPage = Math.min(
    pageCompras,
    Math.max(0, Math.ceil(visiblePurchases.length / TX_POR_PAGINA) - 1)
  );
  const pagedPurchases = visiblePurchases.slice(
    compraPage * TX_POR_PAGINA,
    (compraPage + 1) * TX_POR_PAGINA
  );
  const retiroPage = Math.min(
    pageRetiros,
    Math.max(0, Math.ceil(visibleWithdrawals.length / TX_POR_PAGINA) - 1)
  );
  const pagedWithdrawals = visibleWithdrawals.slice(
    retiroPage * TX_POR_PAGINA,
    (retiroPage + 1) * TX_POR_PAGINA
  );

  const q = userSearch.trim().toLowerCase();
  // Dígitos sueltos: la cédula se escribe de mil formas ("V-6.436.499",
  // "6436499") pero se guarda limpia. Con 4 dígitos o más se compara
  // también así, para que dé igual cómo la teclee quien busca.
  // Solo se buscan dígitos sueltos si lo escrito ES un número: si no,
  // un correo como elena.1973saa@ traía a todos los que tuvieran 1973
  // en la cédula (ver lib/admin/busqueda).
  const qDigitos = digitosDeBusqueda(userSearch);
  const soloDigitos = (v: string | null | undefined) => (v ?? '').replace(/\D/g, '');
  const coincide = (u: (typeof users)[number]) =>
    u.username?.toLowerCase().includes(q) ||
    u.email?.toLowerCase().includes(q) ||
    u.payout_name?.toLowerCase().includes(q) ||
    u.first_name?.toLowerCase().includes(q) ||
    u.last_name?.toLowerCase().includes(q) ||
    `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim().toLowerCase().includes(q) ||
    u.whatsapp?.toLowerCase().replace(/\s/g, '').includes(q.replace(/\s/g, '')) ||
    u.cedula?.toLowerCase().replace(/\s/g, '').includes(q.replace(/\s/g, '')) ||
    u.payout_cedula?.toLowerCase().replace(/\s/g, '').includes(q.replace(/\s/g, '')) ||
    (qDigitos !== null &&
      (soloDigitos(u.cedula).includes(qDigitos) ||
        soloDigitos(u.payout_cedula).includes(qDigitos) ||
        soloDigitos(u.whatsapp).includes(qDigitos) ||
        soloDigitos(u.payout_phone).includes(qDigitos)));

  // La lista cargada son los 300 más recientes; `hallados` trae lo que
  // el servidor encontró en el resto de la tabla. Se juntan SOLO
  // mientras hay búsqueda, para no descuadrar los contadores del día.
  const searchedUsers = q
    ? [...users, ...hallados.filter((h) => !users.some((u) => u.id === h.id))].filter(coincide)
    : users;
  // Con un día elegido en el calendario, la lista muestra solo a
  // quienes estuvieron activos ese día o se registraron ese día, y
  // los botones Todos / Registrados / Activos acotan aún más.
  const dayActiveSet =
    pickDate && dayAudience?.date === pickDate
      ? new Set(dayAudience.active_ids ?? [])
      : null;
  const dayRechargedSet =
    pickDate && dayAudience?.date === pickDate
      ? new Set(dayAudience.recharged_ids ?? [])
      : null;
  const registeredOn = (iso: string, ymd: string) =>
    new Date(new Date(iso).getTime() - CARACAS_OFFSET_MS).toISOString().slice(0, 10) === ymd;
  const dayRegistered = dayActiveSet
    ? searchedUsers.filter((u) => registeredOn(u.created_at, pickDate))
    : [];
  const dayActive = dayActiveSet ? searchedUsers.filter((u) => dayActiveSet.has(u.id)) : [];
  const dayRecharged = dayRechargedSet
    ? searchedUsers.filter((u) => dayRechargedSet.has(u.id))
    : [];
  const dayAll = dayActiveSet
    ? searchedUsers.filter((u) => dayActiveSet.has(u.id) || registeredOn(u.created_at, pickDate))
    : [];
  const visibleUsers = !dayActiveSet
    ? searchedUsers
    : userDayFilter === 'registrados'
    ? dayRegistered
    : userDayFilter === 'activos'
    ? dayActive
    : userDayFilter === 'recargaron'
    ? dayRecharged
    : dayAll;

  // El mismo filtro Todos / Registrados / Activos aplica al Detalle
  // por jugador de Interacción (el servidor ya trae activos ∪
  // registrados del período)
  const interRegistered = dayActiveSet
    ? interaction.filter((p) => registeredOn(p.created_at, pickDate))
    : [];
  const interActive = dayActiveSet ? interaction.filter((p) => dayActiveSet.has(p.id)) : [];
  const interRecharged = dayRechargedSet
    ? interaction.filter((p) => dayRechargedSet.has(p.id))
    : [];
  const visibleInteraction = !dayActiveSet
    ? interaction
    : userDayFilter === 'registrados'
    ? interRegistered
    : userDayFilter === 'activos'
    ? interActive
    : userDayFilter === 'recargaron'
    ? interRecharged
    : interaction;

  // ── Métrica histórica: buscador de la lista de jugadores ──
  const rq = retSearch.trim().toLowerCase();
  const retPlayers = (retention?.players ?? []).filter(
    (p) => !rq || (p.username ?? '').toLowerCase().includes(rq) || p.id.startsWith(rq)
  );

  // ── Etiquetas de estado del jugador ──
  // 🎮 partida en curso AHORA · 🎰 ya jugó (en el día elegido, o
  // alguna vez sin día) · 💳 compró tickets (ídem)
  const playingSet = new Set(presence?.playing_ids ?? []);
  const purchasedEverSet = new Set(presence?.purchased_ids ?? []);
  const dayPlayedSet =
    pickDate && dayAudience?.date === pickDate ? new Set(dayAudience.played_ids ?? []) : null;
  const playerTags = (id: string, playedEver: boolean) => {
    const playing = playingSet.has(id);
    const played = dayPlayedSet ? dayPlayedSet.has(id) : playedEver;
    const bought = dayRechargedSet ? dayRechargedSet.has(id) : purchasedEverSet.has(id);
    if (!playing && !played && !bought) return null;
    return (
      <div className="ptags">
        {playing && <span className="ptag ptag-playing">🎮 Jugando una partida ahora</span>}
        {!playing && played && <span className="ptag">🎰 Ya jugó, no está jugando ahora</span>}
        {bought && <span className="ptag ptag-buy">💳 Ha comprado tickets</span>}
      </div>
    );
  };

  // Botonera del filtro por día (aparece solo con un día elegido)
  const dayFilterRow = (counts: {
    todos: number;
    registrados: number;
    activos: number;
    recargaron: number;
  }) =>
    pickDate ? (
      <div className="admin-filter-row">
        <button
          className={`btn-mini ${userDayFilter === 'todos' ? 'btn-mini-active' : ''}`}
          onClick={() => setUserDayFilter('todos')}
        >
          Todos ({counts.todos})
        </button>
        <button
          className={`btn-mini ${userDayFilter === 'registrados' ? 'btn-mini-active' : ''}`}
          onClick={() => setUserDayFilter('registrados')}
        >
          👥 Registrados ese día ({counts.registrados})
        </button>
        <button
          className={`btn-mini ${userDayFilter === 'activos' ? 'btn-mini-active' : ''}`}
          onClick={() => setUserDayFilter('activos')}
        >
          🟢 Activos ese día ({counts.activos})
        </button>
        <button
          className={`btn-mini ${userDayFilter === 'recargaron' ? 'btn-mini-active' : ''}`}
          onClick={() => setUserDayFilter('recargaron')}
        >
          💳 Recargaron ese día ({counts.recargaron})
        </button>
      </div>
    ) : null;

  return (
    <main className="admin-main">
      <h1 className="admin-title">👑 Panel de Administración</h1>
      <p className="admin-subtitle">Se actualiza cada 30s · toca el nombre de un jugador en cualquier tabla para ver sus acciones</p>

      {error && <div className="auth-error">⚠️ {error}</div>}

      <div className="admin-shell">
        <AdminNav
          active={section}
          onSelect={selectSection}
          allowed={allowed}
          badges={{
            transacciones:
              purchases.filter((p) => p.status === 'pendiente' || p.status === 'validando')
                .length + withdrawals.filter((w) => w.status === 'pendiente').length,
          }}
        />

        <div className="admin-content">
          {/* ── RESUMEN ── */}
          {section === 'resumen' && (
            <>
              {/* Métricas del período: recargas, retiros y ganancia neta */}
              <div className="admin-filter-row">
                {(Object.keys(RANGE_LABEL) as StatsRange[]).map((r) => (
                  <button
                    key={r}
                    className={`btn-mini ${statsRange === r ? 'btn-mini-active' : ''}`}
                    onClick={() => setStatsRange(r)}
                  >
                    {RANGE_LABEL[r]}
                  </button>
                ))}
              </div>
              <div className="admin-stats-grid">
                <StatCard
                  value={data?.finance ? periodPurchases.length : '—'}
                  label="Cantidad de recargas"
                  help="Compras de tickets APROBADAS en el período elegido (pagos reales por Pago Móvil, automáticos o aprobados a mano)."
                />
                <StatCard
                  value={data?.finance ? fmt(periodCollected) : '—'}
                  label="💵 Total recargado"
                  help="Dinero real que entró en el período: la suma de las compras de tickets aprobadas."
                />
                <StatCard
                  value={data?.finance ? periodWithdrawals.length : '—'}
                  label="Cantidad de retiros"
                  help="Retiros PAGADOS a los jugadores en el período elegido."
                />
                <StatCard
                  value={data?.finance ? fmt(periodWithdrawn) : '—'}
                  label="💸 Total retirado"
                  help="Dinero real que salió en el período: la suma de los retiros ya pagados."
                />
                <StatCard
                  value={data?.finance ? fmt(periodCollected - periodWithdrawn) : '—'}
                  label="Ganancia neta"
                  help="Recargado menos retirado en el período: el flujo de caja real. No incluye lo que los jugadores aún tienen en sus billeteras (eso se debe)."
                />
              </div>

              <div className="admin-stats-grid">
                <StatCard
                  value={stats ? stats.total_players : '—'}
                  label="Jugadores"
                  help="Cuentas registradas en la app (incluye al administrador, que no juega)."
                />
                <StatCard
                  value={stats ? stats.total_tickets : '—'}
                  label="Partidas jugadas"
                  help="Partidas terminadas. Cada partida consume 1 ticket de $2.00 y su resultado lo sella el RNG del servidor ANTES de empezar: lo que se recoge en pantalla no cambia el premio."
                />
                <StatCard
                  value={stats ? fmt(stats.total_wagered) : '—'}
                  label="Total apostado"
                  help="Todo lo apostado por los jugadores: $2.00 por cada partida jugada. Es la base sobre la que se calcula el RTP."
                />
                <StatCard
                  value={stats ? fmt(stats.total_paid) : '—'}
                  label="Total en premios"
                  help="Suma de los premios que el RNG ha otorgado, acreditados al saldo de los jugadores."
                />
                <StatCard
                  value={
                    stats
                      ? stats.rtp_real !== null
                        ? `${(stats.rtp_real * 100).toFixed(1)}%`
                        : 'N/A'
                      : '—'
                  }
                  label="RTP real"
                  help="Porcentaje de lo apostado que se ha pagado en premios HASTA AHORA. El RTP teórico es 98%: con pocas partidas fluctúa mucho (puede superar 100%); con volumen converge al 98%."
                />
                <StatCard
                  value={stats ? fmt(stats.house_profit) : '—'}
                  label="Ganancia del juego"
                  help="Apostado menos premios: la ganancia de la LÓGICA del juego. A largo plazo tiende al 2% de lo apostado (≈$0.04 por partida); en rachas cortas puede ser negativa."
                />
              </div>
              <p className="admin-hint">
                📐 RTP teórico: <strong>98%</strong> — la casa retiene un <strong>2%</strong> de lo
                apostado (premio esperado $1.96 por ticket de $2.00 ≈ $0.04 de ganancia por
                partida en promedio). Toca el ℹ️ de cada bloque para ver qué mide.
              </p>

              <div className="admin-stats-grid">
                <StatCard
                  value={stats ? fmt(stats.total_collected) : '—'}
                  label="💵 Recaudado (compras)"
                  help="Dinero REAL que entró: compras de tickets aprobadas por Pago Móvil. (Los tickets recargados a mano por el admin no suman aquí.)"
                />
                <StatCard
                  value={stats ? fmt(stats.total_withdrawn) : '—'}
                  label="💸 Retiros pagados"
                  help="Dinero real que ya salió: retiros pagados a los jugadores por Pago Móvil."
                />
                <StatCard
                  value={stats ? fmt(stats.pending_withdrawals) : '—'}
                  label="⏳ Retiros por pagar"
                  help="Monto que los jugadores solicitaron retirar y aún no has pagado (ya está descontado de sus billeteras)."
                />
                <StatCard
                  value={stats ? fmt(stats.balance_owed) : '—'}
                  label="👛 Saldo en billeteras"
                  help="Premios acumulados que los jugadores todavía no canjean ni retiran: es dinero que se les debe."
                />
                <StatCard
                  value={stats ? stats.tickets_circulating : '—'}
                  label="🎟️ Tickets sin jugar"
                  help="Tickets comprados o recargados que aún no se han usado. Cada uno equivale a una partida de $2.00 pendiente de jugarse."
                />
                <StatCard
                  value={stats ? stats.active_sessions : '—'}
                  label="Partidas activas"
                  help="Partidas a medias en este momento: el jugador puede salir y continuarlas cuando vuelva."
                />
              </div>
            </>
          )}

          {/* ── USUARIOS ── */}
          {section === 'usuarios' && (
            <section className="admin-section">
              <h2 className="admin-section-title">👥 Usuarios</h2>
              <div className="emails-export-row">
                <button
                  type="button"
                  className="btn-secondary emails-export-btn"
                  onClick={descargarEmails}
                  disabled={descargandoEmails}
                >
                  {descargandoEmails ? 'Preparando…' : '⬇️ Descargar correos (.txt)'}
                </button>
                <span className="admin-hint">
                  Todos los correos, uno por línea. Se genera al día cada vez que lo bajas.
                </span>
              </div>
              {audienceBlock}
              <h3 className="admin-sub-title">
                📋 Lista de usuarios
                {pickDate ? ` · 📆 ${fmtDay(pickDate)}` : ''}
              </h3>
              {dayFilterRow({
                todos: dayAll.length,
                registrados: dayRegistered.length,
                activos: dayActive.length,
                recargaron: dayRecharged.length,
              })}
              <input
                className="chat-input users-search"
                placeholder="Buscar por nombre, correo, teléfono o cédula (busca en todos)…"
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
              />
              {userSearch.trim().length >= 3 && (
                <p className="admin-hint">
                  {buscandoUsuarios
                    ? 'Buscando en todos los usuarios…'
                    : `${searchedUsers.length} ${searchedUsers.length === 1 ? 'coincidencia' : 'coincidencias'} en toda la base`}
                </p>
              )}
              {userSearch.trim().length > 0 && userSearch.trim().length < 3 && (
                <p className="admin-hint">Escribe 3 letras o más para buscar en todos los usuarios.</p>
              )}
              <div className="admin-table-wrap">
                <table className="admin-table tx-table">
                  <thead>
                    <tr>
                      <th>Usuario</th>
                      <th>Billetera</th>
                      <th>Juego</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleUsers.map((u) => {
                      const houseTake = Number(u.total_wagered) - Number(u.total_won);
                      return (
                        <Fragment key={u.id}>
                          <tr>
                            <td>
                              {u.role === 'admin' ? (
                                <>👑 {u.username || u.id.slice(0, 8)}</>
                              ) : (
                                <>
                                  {playerBtn(u.id, u.id, u.username)}
                                  {u.blocked && <span className="badge-blocked">Bloqueado</span>}
                                  {playerTags(u.id, Number(u.total_wagered) > 0)}
                                </>
                              )}
                              <div className="admin-subtext">{u.email ?? '—'}</div>
                              <div className="admin-subtext">
                                Registro: {fmtDate(u.created_at)}
                              </div>
                            </td>
                            <td>
                              <div>Saldo: {fmt(u.balance)}</div>
                              <div>Tickets: {u.tickets} 🎟️</div>
                            </td>
                            <td>
                              <div>Apostado: {fmt(u.total_wagered)}</div>
                              <div>Ganado: {fmt(u.total_won)}</div>
                              <div className={houseTake >= 0 ? 'admin-win' : 'admin-lose'}>
                                Nuestra: {houseTake >= 0 ? '+' : '−'}
                                {fmt(Math.abs(houseTake))}
                              </div>
                            </td>
                          </tr>
                        </Fragment>
                      );
                    })}
                    {visibleUsers.length === 0 && (
                      <tr>
                        <td colSpan={3}>
                          {pickDate
                            ? 'Nadie estuvo activo ni se registró ese día.'
                            : q
                            ? 'Sin resultados.'
                            : 'Sin usuarios todavía'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* ── TRANSACCIONES ── */}
          {section === 'transacciones' && (
            <>
              {dayRate && (
                <div className="admin-rate-banner">
                  <div className="admin-rate-label">💱 Tasa BCV del día</div>
                  <div className="admin-rate-value">
                    {fmtBs(dayRate.rate)} <span>por $1</span>
                  </div>
                  <div className="admin-rate-sub">
                    1 🎟️ = {fmt(TICKET_PRICE_USD)} ={' '}
                    <strong>{fmtBs(TICKET_PRICE_USD * dayRate.rate)}</strong> · actualizada{' '}
                    {fmtDate(dayRate.fetchedAt)}
                  </div>
                </div>
              )}
              {BANK_VALIDATION_ENABLED && salud && (
                <div className={`admin-rate-banner salud-${nivelSalud(salud)}`}>
                  <div className="admin-rate-label">🫀 Validación automática</div>
                  <div className="admin-rate-value">
                    {salud.minutos === null
                      ? 'sin datos'
                      : salud.minutos < 1
                      ? 'revisando ahora mismo'
                      : `última revisión hace ${salud.minutos} min`}
                  </div>
                  <div className="admin-rate-sub">
                    {salud.cola_minutos !== null && (
                      <>último pago registrado por el banco hace {salud.cola_minutos} min · </>
                    )}
                    {salud.pasadas} revisiones
                    {salud.ventana_min !== null && ` en ${Math.round(salud.ventana_min / 60)} h`}
                    {salud.entradas > 0 && <> · {salud.entradas} entradas al banco</>}
                    {salud.hueco_min !== null && salud.hueco_min >= 5 && (
                      <>
                        {' '}
                        · mayor parón: <strong>{salud.hueco_min} min</strong> desde{' '}
                        {fmtDate(salud.hueco_desde)}
                      </>
                    )}
                    {/* El enfriamiento es lo normal: el banco admite un
                        scrapeo cada ~3 min por cuenta y el cron lo pide
                        cada minuto. Se enseña sin alarma. Los errores
                        de verdad, aparte y en negrita. */}
                    {salud.enfriamientos > 0 && (
                      <> · {salud.enfriamientos} veces el banco pidió esperar</>
                    )}
                    {salud.latido_error > 0 && (
                      <>
                        {' '}
                        · <strong>{salud.latido_error} fallos al consultar</strong>
                      </>
                    )}
                  </div>
                </div>
              )}
              <section className="admin-section">
                <h2 className="admin-section-title">🎫 Compras de tickets</h2>
                <input
                  className="chat-input users-search"
                  placeholder="Buscar por referencia, nombre, teléfono o cédula (busca en todo el histórico)…"
                  value={txSearch}
                  onChange={(e) => buscarTx(e.target.value)}
                />
                {txSearch.trim().length >= 3 && (
                  <p className="admin-hint">
                    {buscandoTx
                      ? 'Buscando en todo el histórico…'
                      : `${searchedPurchases.length} compra(s) y ${searchedWithdrawals.length} retiro(s) en todo el histórico`}
                  </p>
                )}
                {txSearch.trim().length > 0 && txSearch.trim().length < 3 && (
                  <p className="admin-hint">Escribe 3 caracteres o más para buscar en todo el histórico.</p>
                )}
                <div className="admin-filter-row">
                  <button
                    className={`btn-mini ${purchaseFilter === 'pendientes' ? 'btn-mini-active' : ''}`}
                    onClick={() => elegirFiltroCompras('pendientes')}
                  >
                    🕒 Pendientes ({purchaseBuckets.pendientes.length})
                  </button>
                  {BANK_VALIDATION_ENABLED && (
                    <button
                      className={`btn-mini ${purchaseFilter === 'banco' ? 'btn-mini-active' : ''}`}
                      onClick={() => elegirFiltroCompras('banco')}
                    >
                      🏦 En proceso (banco) ({purchaseBuckets.banco.length})
                    </button>
                  )}
                  <button
                    className={`btn-mini ${purchaseFilter === 'aprobadas' ? 'btn-mini-active' : ''}`}
                    onClick={() => elegirFiltroCompras('aprobadas')}
                  >
                    ✅ Aprobadas ({purchaseBuckets.aprobadas.length})
                  </button>
                  <button
                    className={`btn-mini ${purchaseFilter === 'rechazadas' ? 'btn-mini-active' : ''}`}
                    onClick={() => elegirFiltroCompras('rechazadas')}
                  >
                    ❌ Rechazadas ({purchaseBuckets.rechazadas.length})
                  </button>
                  {/* La lista negra, como un filtro más: decidir qué
                      pagos valen es el mismo trabajo */}
                  {bloqueadas && (
                    <button
                      className={`btn-mini ${purchaseFilter === 'bloqueadas' ? 'btn-mini-active' : ''}`}
                      onClick={() => elegirFiltroCompras('bloqueadas')}
                    >
                      🚫 Bloqueadas ({bloqueadas.length})
                    </button>
                  )}
                  <button
                    className={`btn-mini ${purchaseFilter === 'todas' ? 'btn-mini-active' : ''}`}
                    onClick={() => elegirFiltroCompras('todas')}
                  >
                    Todas ({cargandoTodas ? '…' : searchedPurchases.length})
                  </button>
                  <OrdenToggle orden={ordenCompras} onChange={setOrdenCompras} />
                  <span className="admin-hint">
                    {BANK_VALIDATION_ENABLED
                      ? '🏦 En proceso: el banco las sigue verificando solo y las aprueba al confirmar el pago. 🕒 Pendientes: esperan una decisión del equipo. La validación automática nunca rechaza: rechazar es siempre decisión tuya.'
                      : '✋ Validación automática APAGADA: verifica cada pago en el banco y apruébalo o recházalo a mano. Los jugadores solo ven que su pago "está en proceso de verificación" (no saben que es manual).'}
                  </span>
                </div>
                {purchaseFilter === 'bloqueadas' && bloqueadas ? (
                  <>
                    <p className="admin-hint">
                      Nadie puede registrar una compra con estos números. Se bloquean con el
                      botón <strong>🚫 Invalidar referencia</strong> de una compra (que además la
                      rechaza), o escribiendo aquí abajo una referencia que nunca llegó a
                      subirse (un pago incompleto que luego se completó con otra). Si una se
                      invalidó por error, desbloquéala: volverá a poder usarse.
                    </p>
                    <div className="admin-block-form">
                      <input
                        className="chat-input"
                        placeholder="Referencia a invalidar (los últimos 6 dígitos bastan)"
                        value={refBloquear}
                        onChange={(e) => setRefBloquear(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') invalidarSuelta(refBloquear);
                        }}
                      />
                      <button
                        className="btn-mini btn-danger"
                        disabled={busy || refBloquear.trim().length < 6}
                        onClick={() => invalidarSuelta(refBloquear)}
                      >
                        🚫 Invalidar
                      </button>
                    </div>
                    <div className="admin-table-wrap">
                      <table className="admin-table">
                        <thead>
                          <tr>
                            <th>Referencia</th>
                            <th>Motivo</th>
                            <th>Desde</th>
                            <th>Quién</th>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {bloqueadas.map((b) => (
                            <tr key={b.reference_norm}>
                              <td>
                                <code>…{b.reference_norm}</code>
                              </td>
                              <td>{b.motivo}</td>
                              <td>{fmtDate(b.created_at)}</td>
                              <td>{b.bloqueada_por ?? '—'}</td>
                              <td>
                                <button
                                  className="btn-mini"
                                  disabled={busy}
                                  onClick={() => unblockReference(b.reference_norm)}
                                >
                                  Desbloquear
                                </button>
                              </td>
                            </tr>
                          ))}
                          {bloqueadas.length === 0 && (
                            <tr>
                              <td colSpan={5}>Ninguna referencia invalidada todavía</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : (
                <div className="admin-table-wrap">
                  <table className="admin-table tx-table">
                    <thead>
                      <tr>
                        <th>Compra</th>
                        <th>Estado</th>
                        <th>Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagedPurchases.map((p) => (
                        <Fragment key={p.id}>
                        <tr>
                          <td>
                            {playerBtn(p.id, p.player_id, p.username)}
                            <div className="admin-subtext">{fmtDate(p.created_at)}</div>
                            <div className="tx-amount">
                              {fmt(Number(p.amount_usd))}
                              {p.amount_ves !== null
                                ? ` · ${fmtBs(Number(p.amount_ves))}`
                                : dayRate
                                ? ` · ≈ ${fmtBs(Number(p.amount_usd) * dayRate.rate)}`
                                : ''}{' '}
                              · {p.quantity} 🎟️
                            </div>
                            <div className="tx-ref">
                              🧾 Ref: <strong>{p.reference}</strong>{' '}
                              <button
                                className="btn-mini"
                                title="Copiar referencia"
                                onClick={() =>
                                  navigator.clipboard?.writeText(p.reference).catch(() => {})
                                }
                              >
                                📋
                              </button>
                              {/* Que se vea aquí, y no solo en la
                                  pestaña Bloqueadas: quien mira la
                                  lista tiene que saber que esa
                                  referencia ya no sirve. */}
                              {refsInvalidadas.has(referenceTail(p.reference)) && (
                                <span className="tx-bloqueada" title="Referencia invalidada: ya no sirve para registrar compras">
                                  🚫 bloqueada
                                </span>
                              )}
                            </div>
                            {p.exchange_rate_used != null && (
                              <div className="admin-subtext">
                                tasa de la compra: {fmtBs(Number(p.exchange_rate_used))}/$
                              </div>
                            )}
                            {p.has_proof && (
                              <div>
                                <button
                                  className="proof-link"
                                  onClick={() => setProof({ id: p.id, reference: p.reference })}
                                >
                                  📎 Ver comprobante
                                </button>
                              </div>
                            )}
                          </td>
                          <td>
                            <span className={`status-badge status-${p.status}`}>
                              {PURCHASE_STATUS_LABEL[p.status]}
                            </span>
                            <div className="admin-subtext">
                              {p.origin === 'auto'
                                ? '🤖 Origen: automático'
                                : p.origin === 'manual'
                                ? '👤 Origen: manual'
                                : ''}
                            </div>
                            {p.bank_state === 'esperando_banco' && (
                              <div className="admin-note bank-note">
                                🏦 Esperando validación del banco — próximo intento en ≤
                                {p.eta_minutes ?? 5} min
                                {p.queue_position && p.queue_position > 1
                                  ? ` (puesto ${p.queue_position} en la cola)`
                                  : ''}
                                {p.check_count
                                  ? ` · consultado ${p.check_count} ${p.check_count === 1 ? 'vez' : 'veces'}`
                                  : ''}
                                {p.last_checked_at ? ` · última ${fmtAgo(p.last_checked_at)}` : ''}
                              </div>
                            )}
                            {p.bank_state === 'consultando' && (
                              <div className="admin-note bank-note">
                                🏦 Consultando al banco en este momento…
                              </div>
                            )}
                            {BANK_VALIDATION_ENABLED && p.bank_state === 'revision_manual' && (
                              <div className="admin-note">👤 Requiere revisión manual del equipo</div>
                            )}
                            {p.status_note && (
                              <div
                                className={`admin-note ${
                                  p.status_note.startsWith('⚠') ? 'admin-note-warn' : ''
                                }`}
                              >
                                {p.status_note}
                              </div>
                            )}
                            {/* Igual que en los retiros. Las que resolvió
                                sola la validación automática no llevan
                                firma con razón: ahí no hubo nadie. */}
                            {(p.status === 'aprobado' || p.status === 'rechazado') &&
                              !(p.status === 'aprobado' && p.origin === 'auto') && (
                                <div className="admin-subtext">
                                  👤 {p.status === 'rechazado' ? 'Rechazada' : 'Aprobada'} por{' '}
                                  {p.handled_by_name ? (
                                    <strong>{p.handled_by_name}</strong>
                                  ) : (
                                    <em title={FIRMA_DESDE}>sin registrar</em>
                                  )}
                                </div>
                              )}
                          </td>
                          {/* El flex va en un div INTERIOR: puesto en el
                              propio <td>, la celda deja de estirarse con
                              la fila y su borde queda flotando a media
                              altura */}
                          <td className="admin-cell-actions">
                            <div className="admin-actions">
                              {p.status !== 'aprobado' && (
                                <button className="btn-mini btn-ok" onClick={() => approvePurchase(p)} disabled={busy}>
                                  ✓ Aprobar
                                </button>
                              )}
                              {(p.status === 'pendiente' || p.status === 'validando') && (
                                <>
                                  <button className="btn-mini" onClick={() => editQuantity(p)} disabled={busy}>
                                    🎟️ Cantidad
                                  </button>
                                  <button className="btn-mini" onClick={() => editReference(p)} disabled={busy}>
                                    ✏️ Referencia
                                  </button>
                                </>
                              )}
                              {p.status !== 'rechazado' && (
                                <button className="btn-mini btn-danger" onClick={() => rejectPurchase(p)} disabled={busy}>
                                  ✕ Rechazar
                                </button>
                              )}
                              {/* Invalidar = RECHAZAR la compra y
                                  bloquear su referencia, de una vez.
                                  Si ya está invalidada, el botón lo
                                  dice y sirve para volver a permitirla. */}
                              {refsInvalidadas.has(referenceTail(p.reference)) ? (
                                <button
                                  className="btn-mini"
                                  disabled={busy}
                                  title="Esta referencia ya no sirve para registrar compras. Tócalo para volver a permitirla."
                                  onClick={() => unblockReference(referenceTail(p.reference))}
                                >
                                  🚫 Invalidada
                                </button>
                              ) : (
                                <button
                                  className="btn-mini btn-danger"
                                  disabled={busy}
                                  title="Rechaza la compra Y bloquea la referencia: nadie podrá volver a registrar una compra con ese número"
                                  onClick={() => invalidarCompra(p)}
                                >
                                  🚫 Invalidar referencia
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                        </Fragment>
                      ))}
                      {visiblePurchases.length === 0 && (
                        <tr>
                          <td colSpan={3}>
                            {tq
                              ? 'Sin resultados para esa búsqueda.'
                              : purchaseFilter === 'todas'
                              ? 'Sin compras todavía'
                              : purchaseFilter === 'banco'
                              ? 'Ninguna compra en proceso de validación del banco'
                              : `Sin compras ${purchaseFilter}`}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                )}
                {purchaseFilter !== 'bloqueadas' && (
                  <TxPager
                    page={compraPage}
                    count={visiblePurchases.length}
                    onPage={setPageCompras}
                  />
                )}
              </section>

              <section className="admin-section">
                <h2 className="admin-section-title">💸 Retiros</h2>
                <p className="admin-hint">
                  Paga por Pago Móvil a los datos del jugador y luego marca el retiro como pagado.
                  Debajo del estado queda <strong>quién lo pagó o lo rechazó</strong>.
                </p>
                <div className="admin-filter-row">
                  <button
                    className={`btn-mini ${withdrawalFilter === 'pendientes' ? 'btn-mini-active' : ''}`}
                    onClick={() => elegirFiltroRetiros('pendientes')}
                  >
                    🕒 Pendientes ({withdrawalBuckets.pendientes.length})
                  </button>
                  <button
                    className={`btn-mini ${withdrawalFilter === 'pagados' ? 'btn-mini-active' : ''}`}
                    onClick={() => elegirFiltroRetiros('pagados')}
                  >
                    ✅ Pagados ({withdrawalBuckets.pagados.length})
                  </button>
                  <button
                    className={`btn-mini ${withdrawalFilter === 'cancelados' ? 'btn-mini-active' : ''}`}
                    onClick={() => elegirFiltroRetiros('cancelados')}
                  >
                    ❌ Rechazados ({withdrawalBuckets.cancelados.length})
                  </button>
                  <button
                    className={`btn-mini ${withdrawalFilter === 'todos' ? 'btn-mini-active' : ''}`}
                    onClick={() => elegirFiltroRetiros('todos')}
                  >
                    Todos ({cargandoTodas ? '…' : searchedWithdrawals.length})
                  </button>
                  <OrdenToggle orden={ordenRetiros} onChange={setOrdenRetiros} />
                </div>
                <div className="admin-table-wrap">
                  <table className="admin-table tx-table">
                    <thead>
                      <tr>
                        <th>Retiro</th>
                        <th>Pago Móvil y estado</th>
                        <th>Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagedWithdrawals.map((w) => (
                        <Fragment key={w.id}>
                        <tr>
                          <td>
                            {playerBtn(w.id, w.player_id, w.username)}
                            <div className="admin-subtext">{fmtDate(w.created_at)}</div>
                            <div className="tx-amount">
                              {fmt(Number(w.amount_usd))}
                              {dayRate
                                ? ` · ≈ ${fmtBs(Number(w.amount_usd) * dayRate.rate)}`
                                : ''}
                            </div>
                          </td>
                          <td>
                            <span
                              className={`status-badge status-${
                                w.status === 'pagado'
                                  ? 'aprobado'
                                  : w.status === 'cancelado'
                                  ? 'rechazado'
                                  : 'pendiente'
                              }`}
                            >
                              {w.status === 'pendiente' ? 'Quiere retirar' : w.status === 'pagado' ? 'Pagado' : 'Rechazado'}
                            </span>
                            {w.payout_name || w.payout_phone ? (
                              <div className="admin-note">
                                {w.payout_name ?? '—'} · {w.payout_bank ?? '—'} ·{' '}
                                {w.payout_cedula ?? '—'} · {w.payout_phone ?? '—'}{' '}
                                <button className="btn-mini" onClick={() => copyPayoutData(w)}>
                                  📋 Copiar
                                </button>
                              </div>
                            ) : (
                              <div className="admin-note">
                                <em>Sin datos de Pago Móvil cargados</em>
                              </div>
                            )}
                            {w.reference && <div className="admin-note">Ref: {w.reference}</div>}
                            {/* La línea sale SIEMPRE en los ya resueltos,
                                aunque no se sepa quién fue: sin ella, un
                                retiro viejo parece uno al que le falta el
                                dato y no se distingue de un fallo. */}
                            {w.status !== 'pendiente' && (
                              <div className="admin-subtext">
                                👤 {w.status === 'cancelado' ? 'Rechazado' : 'Pagado'} por{' '}
                                {w.handled_by_name ? (
                                  <strong>{w.handled_by_name}</strong>
                                ) : (
                                  <em title={FIRMA_DESDE}>sin registrar</em>
                                )}
                              </div>
                            )}
                          </td>
                          <td className="admin-cell-actions">
                            <div className="admin-actions">
                              {w.status === 'pendiente' && (
                                <>
                                  <button className="btn-mini btn-ok" onClick={() => payWithdrawal(w)} disabled={busy}>
                                    ✓ Pagar {fmt(Number(w.amount_usd))}
                                  </button>
                                  <button className="btn-mini btn-danger" onClick={() => cancelWithdrawal(w)} disabled={busy}>
                                    ✕ Cancelar
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                        </Fragment>
                      ))}
                      {visibleWithdrawals.length === 0 && (
                        <tr>
                          <td colSpan={3}>
                            {tq
                              ? 'Sin resultados para esa búsqueda.'
                              : `Sin retiros ${
                                  withdrawalFilter === 'todos'
                                    ? 'todavía'
                                    : withdrawalFilter === 'cancelados'
                                    ? 'rechazados'
                                    : withdrawalFilter
                                }`}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <TxPager
                  page={retiroPage}
                  count={visibleWithdrawals.length}
                  onPage={setPageRetiros}
                />
              </section>
            </>
          )}

          {/* ── INTERACCIONES ── */}
          {section === 'interacciones' && (
            <section className="admin-section">
              <h2 className="admin-section-title">📊 Interacción de los jugadores</h2>

              {audienceBlock}

              {/* ── Actividad del período elegido ── */}
              <h3 className="admin-sub-title">🎯 Actividad · {interPeriodLabel}</h3>
              <div className="admin-filter-row">
                {(Object.keys(INTER_RANGE_LABEL) as InterRange[]).map((r) => (
                  <button
                    key={r}
                    className={`btn-mini ${!pickDate && interRange === r ? 'btn-mini-active' : ''}`}
                    onClick={() => {
                      clearDay();
                      setInterRange(r);
                    }}
                  >
                    {INTER_RANGE_LABEL[r]}
                  </button>
                ))}
              </div>
              <p className="admin-hint">
                Los contadores y los tops corresponden al período elegido (o al día del
                calendario de arriba). «Más saldo» siempre muestra el saldo actual.
              </p>

              {interSummary && (
                <>
                  <div className="admin-stats-grid">
                    <StatCard
                      value={interSummary.total_games}
                      label="Partidas"
                      help="Partidas terminadas por todos los jugadores en el período elegido."
                    />
                    <StatCard
                      value={interSummary.players_played}
                      label="Usuarios que jugaron"
                      help="Jugadores distintos que terminaron al menos una partida en el período elegido."
                    />
                    <StatCard
                      value={interSummary.manual_recharges}
                      label="Recargas manuales"
                      help="Compras de tickets aprobadas A MANO por el equipo del panel en el período elegido."
                    />
                    <StatCard
                      value={interSummary.auto_recharges}
                      label="Recargas automáticas"
                      help="Compras aprobadas por la validación automática contra la API del banco en el período elegido."
                    />
                  </div>

                  <div className="top-grid">
                    <TopList
                      title="💰 Más saldo (actual)"
                      entries={interSummary.top_balance}
                      render={(v) => fmt(v)}
                    />
                    <TopList
                      title="🎰 Más jugadas"
                      entries={interSummary.top_games}
                      render={(v) => `${v} partida${v === 1 ? '' : 's'}`}
                    />
                    <TopList
                      title="🎫 Más recargas"
                      entries={interSummary.top_purchases}
                      render={(v) => `${v} recarga${v === 1 ? '' : 's'}`}
                    />
                    <TopList
                      title="💸 Más retiros"
                      entries={interSummary.top_withdrawals}
                      render={(v) => `${v} retiro${v === 1 ? '' : 's'}`}
                    />
                  </div>
                </>
              )}

              {/* ── Detalle por jugador ── */}
              <h3 className="admin-sub-title">🧭 Detalle por jugador · {interPeriodLabel}</h3>
              {dayFilterRow({
                todos: interaction.length,
                registrados: interRegistered.length,
                activos: interActive.length,
                recargaron: interRecharged.length,
              })}
              <p className="admin-hint">
                Se listan los jugadores del período elegido (sus números son totales
                históricos). Toca la flecha para ver el flujo del jugador en la app; toca su
                nombre para las acciones.
              </p>
              <div className="admin-table-wrap">
                <table className="admin-table tx-table">
                  <thead>
                    <tr>
                      <th>Jugador</th>
                      <th>Partidas</th>
                      <th>Dinero</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleInteraction.map((p) => (
                      <Fragment key={p.id}>
                        <tr>
                          <td>
                            <button
                              className="btn-mini"
                              onClick={() => toggleFlow(p.id)}
                              aria-label="Ver flujo"
                            >
                              {flowPlayer === p.id ? '▼' : '▶'}
                            </button>{' '}
                            {playerBtn(`i-${p.id}`, p.id, p.username)}
                            {playerTags(p.id, p.games > 0)}
                            <div className="admin-subtext">
                              🕐 Última actividad: {fmtDate(p.last_seen)}
                            </div>
                            <div className="admin-subtext">
                              Sesiones: {p.logins + p.app_opens} · Vistas: {p.page_views}
                            </div>
                          </td>
                          <td>
                            {p.games} en total
                            <div className="admin-subtext">
                              <span className="admin-win">✓ {p.wins} ganadas</span> ·{' '}
                              <span className="admin-lose">✗ {p.losses} perdidas</span>
                            </div>
                          </td>
                          <td>
                            <div>Gastado: {fmt(Number(p.total_wagered))}</div>
                            <div>Ganado: {fmt(Number(p.total_won))}</div>
                          </td>
                        </tr>
                        {flowPlayer === p.id && (
                          <tr>
                            <td colSpan={3}>
                              {flowEvents.length === 0 ? (
                                <em>Sin eventos registrados todavía</em>
                              ) : (
                                <ul className="flow-list">
                                  {flowEvents.map((e) => (
                                    <li key={e.id}>
                                      <span className="flow-date">{fmtDate(e.created_at)}</span>{' '}
                                      {EVENT_LABEL[e.event_type]}
                                      {e.path ? ` ${e.path}` : ''}
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                    {visibleInteraction.length === 0 && (
                      <tr>
                        <td colSpan={3}>
                          {pickDate || interRange !== 'todo'
                            ? 'Nadie coincide con este período y filtro'
                            : 'Sin datos de interacción todavía'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* ── MÉTRICA HISTÓRICA (recurrencia + RTP por jugador) ── */}
          {/* ── CAJA: 30 días, uno por renglón ── */}
          {section === 'caja' && (
            <section className="admin-section">
              <h2 className="admin-section-title">💵 Resumen de 30 días</h2>
              <p className="admin-hint">
                Lo que entró, lo que salió y lo que quedó, día por día (días de Venezuela).
                Entra una <strong>recarga el día que se aprueba</strong>; sale un{' '}
                <strong>retiro el día que se paga</strong>. Lo pedido y aún sin pagar se
                cuenta aparte: todavía no ha salido de la cuenta.
              </p>

              {cargandoCaja && !caja ? (
                <p className="admin-hint">Calculando…</p>
              ) : !caja ? (
                <p className="admin-hint">No se pudo cargar el resumen.</p>
              ) : (
                <>
                  {/* Los 30 días de un vistazo */}
                  <div className={`caja-total ${caja.total.ganancia >= 0 ? 'caja-pos' : 'caja-neg'}`}>
                    <div className="caja-total-item">
                      <span>Depósitos</span>
                      <strong>{fmt(caja.total.depositos)}</strong>
                    </div>
                    <div className="caja-total-item">
                      <span>Retiros</span>
                      <strong>{fmt(caja.total.retiros)}</strong>
                    </div>
                    <div className="caja-total-item">
                      <span>Nos quedó</span>
                      <strong className={caja.total.ganancia >= 0 ? 'admin-win' : 'admin-lose'}>
                        {caja.total.ganancia >= 0 ? '▲ ' : '▼ '}
                        {fmt(Math.abs(caja.total.ganancia))}
                      </strong>
                    </div>
                    <div className="caja-total-item">
                      <span>% sobre lo que entró</span>
                      <strong className={caja.total.ganancia >= 0 ? 'admin-win' : 'admin-lose'}>
                        {caja.total.porcentaje === null
                          ? '—'
                          : `${caja.total.porcentaje > 0 ? '+' : ''}${caja.total.porcentaje.toFixed(2)}%`}
                      </strong>
                    </div>
                  </div>

                  {caja.total.nPendientes > 0 && (
                    <p className="admin-hint caja-pendiente">
                      🕒 Hay <strong>{fmt(caja.total.pendiente)}</strong> en{' '}
                      {caja.total.nPendientes} retiro{caja.total.nPendientes === 1 ? '' : 's'} pedido
                      {caja.total.nPendientes === 1 ? '' : 's'} y aún sin pagar. No están
                      descontados arriba.
                    </p>
                  )}

                  <ul className="caja-lista">
                    {caja.dias.map((d) => {
                      const positivo = d.ganancia >= 0;
                      const vacio = d.nDepositos === 0 && d.nRetiros === 0;
                      const [, mes, dia] = d.dia.split('-');
                      return (
                        <li
                          key={d.dia}
                          className={`caja-dia ${vacio ? 'caja-vacio' : positivo ? 'caja-pos' : 'caja-neg'}`}
                        >
                          <div className="caja-fecha">
                            <strong>{dia}</strong>
                            <span>{MESES_CORTOS[Number(mes) - 1]}</span>
                          </div>
                          <div className="caja-campo">
                            <span>💵 Depósitos</span>
                            <strong>{fmt(d.depositos)}</strong>
                            {d.nDepositos > 0 && <em>{d.nDepositos} recargas</em>}
                          </div>
                          <div className="caja-campo">
                            <span>💸 Retiros</span>
                            <strong>{fmt(d.retiros)}</strong>
                            {d.nRetiros > 0 && <em>{d.nRetiros} pagados</em>}
                          </div>
                          {/* El porcentaje va pegado a la ganancia: son
                              la misma cifra contada de dos formas, y
                              separarlos partía el renglón en el móvil */}
                          <div className="caja-campo caja-campo-ganancia">
                            <span>📊 Nos quedó</span>
                            <strong className={positivo ? 'admin-win' : 'admin-lose'}>
                              {vacio ? '—' : `${positivo ? '▲ ' : '▼ '}${fmt(Math.abs(d.ganancia))}`}
                              {d.porcentaje !== null && (
                                <em className="caja-pct">
                                  {d.porcentaje > 0 ? '+' : ''}
                                  {d.porcentaje.toFixed(2)}%
                                </em>
                              )}
                            </strong>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </section>
          )}

          {section === 'metricas' && (
            <section className="admin-section">
              <h2 className="admin-section-title">📅 Métrica histórica</h2>
              <p className="admin-hint">
                Toda la historia de la app, sin filtros de período. Cuenta los{' '}
                <strong>días distintos</strong> en que cada jugador jugó al menos una partida
                (días de Venezuela). Las cuentas del equipo no entran en la métrica.
              </p>

              {!retention ? (
                <p className="admin-hint">⏳ Calculando la historia completa…</p>
              ) : (
                <>
                  <div className="admin-stats-grid">
                    <StatCard
                      value={retention.totals.players_played}
                      label="Jugadores con al menos 1 partida"
                      help="Base de esta métrica: todos los que alguna vez terminaron una partida. Los porcentajes del desglose se calculan sobre este número."
                    />
                    <StatCard
                      value={retention.totals.never_played}
                      label="Registrados que nunca jugaron"
                      help="Cuentas creadas que no han terminado ni una partida. No entran en el desglose por días."
                    />
                    <StatCard
                      value={retention.totals.one_day}
                      label="Jugaron un solo día"
                      help="Vinieron un único día y no volvieron ningún otro (aunque ese día jugaran varias partidas)."
                    />
                    <StatCard
                      value={retention.totals.one_game}
                      label="Jugaron una sola vez"
                      help="Jugaron UNA partida en toda su vida en la app. Es el grupo que se probó el juego y lo dejó."
                    />
                    <StatCard
                      value={retention.totals.abandoned}
                      label="Abandonaron"
                      help={`Jugaron un solo día y llevan ${retention.totals.abandon_after_days} días o más sin volver. Los de un solo día que jugaron ayer u hoy todavía pueden volver, por eso no cuentan aquí.`}
                    />
                    <StatCard
                      value={retention.totals.avg_days.toFixed(1).replace('.', ',')}
                      label="Días por jugador (promedio)"
                      help="Media de días distintos jugados entre quienes jugaron al menos una partida. Sube cuando la gente vuelve."
                    />
                  </div>

                  {/* ── Desglose por segmento de días jugados ── */}
                  <h3 className="admin-sub-title">📊 Desglose por segmento de días jugados</h3>
                  <div className="admin-table-wrap">
                    <table className="admin-table">
                      <thead>
                        <tr>
                          <th>Rango de días</th>
                          <th>Cantidad de jugadores</th>
                          <th>Porcentaje del total</th>
                          <th>Cómo juegan</th>
                        </tr>
                      </thead>
                      <tbody>
                        {retention.buckets.map((b) => (
                          <tr key={b.days}>
                            <td>
                              {b.is_plus ? `${b.days} o más días` : `${b.days} día${b.days === 1 ? '' : 's'}`}
                            </td>
                            <td>{b.players}</td>
                            <td>{fmtPct(b.pct)}</td>
                            <td>
                              {b.days === 1 ? (
                                <span className="admin-subtext">— (un solo día)</span>
                              ) : b.players === 0 ? (
                                <span className="admin-subtext">—</span>
                              ) : (
                                <>
                                  🔥 {b.consecutive} seguido{b.consecutive === 1 ? '' : 's'} ·{' '}
                                  ↔️ {b.intermittent} con saltos
                                </>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="admin-hint">
                    <strong>🔥 Seguidos</strong> = jugó días consecutivos, sin saltarse ninguno
                    (por ejemplo 12, 13 y 14). <strong>↔️ Con saltos</strong> = dejó pasar al
                    menos un día y volvió (por ejemplo 12, 14 y 17: juega un día sí y otro no, o
                    desaparece y regresa). En total: <strong>{retention.totals.consecutive}</strong>{' '}
                    juegan seguido y <strong>{retention.totals.intermittent}</strong> con saltos.
                  </p>

                  {/* ── Fechas: qué días hubo actividad ── */}
                  <h3 className="admin-sub-title">🗓️ Días con actividad</h3>
                  <div className="admin-table-wrap ret-scroll">
                    <table className="admin-table">
                      <thead>
                        <tr>
                          <th>Fecha</th>
                          <th>Jugadores</th>
                          <th>Partidas</th>
                        </tr>
                      </thead>
                      <tbody>
                        {retention.calendar.map((d) => (
                          <tr key={d.date}>
                            <td>{fmtDay(d.date)}</td>
                            <td>{d.players}</td>
                            <td>{d.games}</td>
                          </tr>
                        ))}
                        {retention.calendar.length === 0 && (
                          <tr>
                            <td colSpan={3}>Sin partidas todavía</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* ── Cada jugador: sus días, su recurrencia y su RTP ── */}
                  <h3 className="admin-sub-title">🧑‍💻 Recurrencia y RTP por jugador</h3>
                  <input
                    className="chat-input users-search"
                    placeholder="Buscar jugador por nombre…"
                    value={retSearch}
                    onChange={(e) => setRetSearch(e.target.value)}
                  />
                  <p className="admin-hint">
                    <strong>RTP</strong> = premios ganados ÷ apostado (cada partida son{' '}
                    {fmt(TICKET_PRICE_USD)}). Por encima del 100% ese jugador va ganándonos;
                    por debajo, la casa gana. <strong>Recargó / retiró</strong> es dinero real
                    por Pago Móvil. Ordenados por días jugados.
                  </p>
                  <div className="admin-table-wrap">
                    <table className="admin-table tx-table">
                      <thead>
                        <tr>
                          <th>Jugador</th>
                          <th>Días que jugó</th>
                          <th>Partidas y RTP</th>
                          <th>Dinero real</th>
                        </tr>
                      </thead>
                      <tbody>
                        {retPlayers.map((p) => {
                          const houseTake = p.wagered - p.won;
                          const tag = PATTERN_TAG[p.pattern];
                          return (
                            <tr key={p.id}>
                              <td>
                                {playerBtn(`r-${p.id}`, p.id, p.username)}
                                <div className="ptags">
                                  <span className={`ptag ${tag.cls}`}>{tag.label}</span>
                                  {p.abandoned && (
                                    <span className="ptag ret-tag-abandono">🚪 Abandonó</span>
                                  )}
                                </div>
                                <div className="admin-subtext">
                                  {p.days_since_last === 0
                                    ? 'Jugó hoy'
                                    : p.days_since_last === 1
                                    ? 'Última vez ayer'
                                    : `Última vez hace ${p.days_since_last} días`}
                                </div>
                              </td>
                              <td>
                                <strong>
                                  {p.days_count} día{p.days_count === 1 ? '' : 's'}
                                </strong>
                                <div className="ret-chips">
                                  {p.days.map((d) => (
                                    <span key={d} className="ret-chip" title={fmtDay(d)}>
                                      {fmtDayShort(d)}
                                    </span>
                                  ))}
                                </div>
                                {p.days_count > 1 && (
                                  <div className="admin-subtext">
                                    Del {fmtDay(p.first_day)} al {fmtDay(p.last_day)} · racha
                                    máxima {p.max_streak} día{p.max_streak === 1 ? '' : 's'}
                                    {p.skipped_days > 0
                                      ? ` · dejó pasar ${p.skipped_days} día${p.skipped_days === 1 ? '' : 's'}`
                                      : ' · sin saltarse ninguno'}
                                  </div>
                                )}
                              </td>
                              <td>
                                {p.games} partida{p.games === 1 ? '' : 's'}
                                <div className="admin-subtext">
                                  Apostado: {fmt(p.wagered)} · Ganado: {fmt(p.won)}
                                </div>
                                <div className={p.rtp !== null && p.rtp > 1 ? 'admin-lose' : 'admin-win'}>
                                  RTP: {p.rtp === null ? '—' : fmtPct(p.rtp)}
                                </div>
                                <div
                                  className={`admin-subtext ${houseTake >= 0 ? 'admin-win' : 'admin-lose'}`}
                                >
                                  Nuestra: {houseTake >= 0 ? '+' : '−'}
                                  {fmt(Math.abs(houseTake))}
                                </div>
                              </td>
                              <td>
                                <div>Recargó: {fmt(p.recharged)}</div>
                                <div>Retiró: {fmt(p.withdrawn)}</div>
                                <div className="admin-subtext">
                                  Saldo: {fmt(p.balance)} · {p.tickets} 🎟️ sin jugar
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                        {retPlayers.length === 0 && (
                          <tr>
                            <td colSpan={4}>
                              {rq ? 'Sin resultados.' : 'Todavía nadie ha jugado una partida.'}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </section>
          )}

          {/* ── REFERIDOS ── */}
          {section === 'referidos' && (
            <section className="admin-section">
              <h2 className="admin-section-title">🤝 Referidos</h2>
              <p className="admin-hint">
                Programa de afiliados: quién ha traído gente con su enlace y qué hacen esos
                referidos. Se actualiza cada 2 minutos. Toca un referidor para ver su lista, o el
                nombre de un referido para abrir su ficha.
              </p>

              {referral?.stats && <ReferidosTablero stats={referral.stats} />}

              <h3 className="admin-sub-title">📈 Totales del programa</h3>
              <div className="admin-stats-grid">
                <StatCard
                  value={referral?.summary?.referrers ?? '—'}
                  label="🔗 Usuarios que usan el enlace"
                  help="Cuántos jugadores han traído gente con su enlace de afiliado (consiguieron al menos un registro). Cuáles son: en la tabla de abajo. No se puede saber quién solo compartió el enlace sin que nadie se registrara."
                />
                <StatCard
                  value={referral?.summary?.referred ?? '—'}
                  label="🧑‍🤝‍🧑 Afiliados registrados"
                  help="Total de cuentas que se registraron (se afiliaron) usando el enlace de otro jugador."
                />
                <StatCard
                  value={referral?.summary?.active ?? '—'}
                  label="✅ Referidos activos"
                  help="Referidos que YA compraron al menos un ticket Y jugaron al menos una partida. Es la métrica que de verdad importa: no solo se registraron, están jugando de verdad."
                />
                <StatCard
                  value={referral?.summary?.playing ?? '—'}
                  label="🎰 Ya jugaron"
                  help="De los referidos, cuántos han jugado al menos una partida (aunque no hayan comprado)."
                />
                <StatCard
                  value={referral?.summary?.buyers ?? '—'}
                  label="💳 Ya compraron"
                  help="De los referidos, cuántos han comprado al menos un ticket con un pago aprobado (aunque todavía no jueguen)."
                />
                <StatCard
                  value={referral?.summary ? fmt(referral.summary.paid_out) : '—'}
                  label="💸 Pagado a referidores"
                  help="Dinero ya abonado al saldo de los referidores por sus referidos ($1 por cada 10 partidas, tope $3 por referido)."
                />
                <StatCard
                  value={referral?.summary ? fmt(referral.summary.pending) : '—'}
                  label="⏳ Pendiente por cobrar"
                  help="Dinero que los referidores ya se ganaron por las partidas de sus referidos pero todavía no han cobrado."
                />
              </div>

              {cargandoReferral && !referral && (
                <p className="admin-hint">Cargando estadísticas de referidos…</p>
              )}

              {referral && referral.referrers.length === 0 && (
                <p className="admin-empty">Todavía nadie ha traído referidos con su enlace.</p>
              )}

              {referral && referral.referrers.length > 0 && (
                <>
                  <input
                    className="chat-input users-search"
                    placeholder="🔎 Buscar referidor por nombre…"
                    value={refSearch}
                    onChange={(e) => setRefSearch(e.target.value)}
                  />
                  <div className="admin-table-wrap">
                    <table className="admin-table">
                      <thead>
                        <tr>
                          <th>Referidor</th>
                          <th>Referidos</th>
                          <th>Activos</th>
                          <th>Juegan</th>
                          <th>Compraron</th>
                          <th>Partidas</th>
                          <th>Cobrado</th>
                          <th>Pendiente</th>
                        </tr>
                      </thead>
                      <tbody>
                        {referral.referrers
                          .filter(
                            (r) =>
                              !refSearch.trim() ||
                              r.nombre.toLowerCase().includes(refSearch.trim().toLowerCase())
                          )
                          .map((r) => {
                            const abierto = refAbierto === r.id;
                            return (
                              <Fragment key={r.id}>
                                <tr>
                                  <td>
                                    <button
                                      className="ref-toggle"
                                      onClick={() => setRefAbierto(abierto ? null : r.id)}
                                      aria-expanded={abierto}
                                    >
                                      <span className="ref-caret">{abierto ? '▾' : '▸'}</span>{' '}
                                      {r.nombre}
                                    </button>
                                  </td>
                                  <td>{r.referidos}</td>
                                  <td className={r.activos > 0 ? 'admin-win' : ''}>
                                    <strong>{r.activos}</strong>
                                  </td>
                                  <td>{r.jugando}</td>
                                  <td>{r.compraron}</td>
                                  <td>{r.partidas_total}</td>
                                  <td>{fmt(r.cobrado)}</td>
                                  <td className={r.pendiente > 0 ? 'admin-win' : ''}>
                                    {r.pendiente > 0 ? fmt(r.pendiente) : '—'}
                                  </td>
                                </tr>
                                {abierto && (
                                  <tr className="ref-detalle-row">
                                    <td colSpan={8}>
                                      <div className="admin-table-wrap">
                                        <table className="admin-table admin-subtable">
                                          <thead>
                                            <tr>
                                              <th>Referido</th>
                                              <th>Registrado</th>
                                              <th>Partidas</th>
                                              <th>Saldo</th>
                                              <th>Tickets</th>
                                              <th>Estado</th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {r.lista.map((x) => (
                                              <tr key={x.id}>
                                                <td>{playerBtn(`ref-${x.id}`, x.id, x.nombre)}</td>
                                                <td>{fmtDate(x.created_at)}</td>
                                                <td>{x.partidas}</td>
                                                <td>{fmt(x.balance)}</td>
                                                <td>{x.tickets} 🎟️</td>
                                                <td>
                                                  <div className="ptags">
                                                    {x.activo && (
                                                      <span className="ptag ptag-playing">
                                                        ✅ Activo
                                                      </span>
                                                    )}
                                                    {x.partidas > 0 && (
                                                      <span className="ptag">🎰 Juega</span>
                                                    )}
                                                    {x.compro && (
                                                      <span className="ptag ptag-buy">
                                                        💳 Compró
                                                      </span>
                                                    )}
                                                    {x.blocked && (
                                                      <span className="ptag">🚫 Bloqueado</span>
                                                    )}
                                                    {x.partidas === 0 && !x.compro && (
                                                      <span className="admin-subtext">
                                                        Sin actividad
                                                      </span>
                                                    )}
                                                  </div>
                                                </td>
                                              </tr>
                                            ))}
                                          </tbody>
                                        </table>
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </Fragment>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </section>
          )}

          {/* ── PARTIDAS ── */}
          {section === 'partidas' && (
            <section className="admin-section">
              <h2 className="admin-section-title">🎰 Últimas partidas</h2>
              <div className="admin-table-wrap">
                <table className="admin-table tx-table">
                  <thead>
                    <tr>
                      <th>Jugador</th>
                      <th>Bolsas</th>
                      <th>Premio</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.recent_games ?? []).map((g) => {
                      // Cada partida cuesta 1 ticket ($2.00): lo que no se
                      // paga en premio queda para la casa (y al revés).
                      const houseTake = 2 - Number(g.payout);
                      return (
                        <Fragment key={g.id}>
                          <tr>
                            <td>
                              {playerBtn(g.id, g.player_id, g.username ?? null)}
                              <div className="admin-subtext">{fmtDate(g.created_at)}</div>
                            </td>
                            <td>{g.bags_count} 💰</td>
                            <td>
                              <div className={Number(g.payout) > 0 ? 'admin-win' : 'admin-lose'}>
                                {fmt(Number(g.payout))}
                              </div>
                              <div
                                className={`admin-subtext ${houseTake >= 0 ? 'admin-win' : 'admin-lose'}`}
                              >
                                Nuestra: {houseTake >= 0 ? '+' : '−'}
                                {fmt(Math.abs(houseTake))}
                              </div>
                            </td>
                          </tr>
                        </Fragment>
                      );
                    })}
                    {data && data.recent_games.length === 0 && (
                      <tr>
                        <td colSpan={3}>Sin partidas todavía</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* ── EQUIPO (solo rol admin) ── */}
          {section === 'equipo' && isAdmin && <StaffPanel myId={player.id} />}
        </div>
      </div>

      {/* Ficha del jugador: una sola para TODAS las tablas del panel */}
      <PlayerDetailModal
        playerId={openDetail?.playerId ?? null}
        username={openDetail?.username}
        onClose={() => setOpenDetail(null)}
        onChanged={loadAll}
        onDeleted={() => {
          setOpenDetail(null);
          loadAll();
        }}
      />

      {/* Comprobante del pago, en grande */}
      <ProofModal
        purchaseId={proof?.id ?? null}
        reference={proof?.reference}
        onClose={() => setProof(null)}
      />
    </main>
  );
}
