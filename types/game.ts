export type RunStatus = 'IDLE' | 'LOADING' | 'ACTIVE' | 'FINISHED';

export interface PayoutTier {
  payout: number;
  weight: number;
}

/** Lo que el servidor entrega al empezar una partida. NUNCA incluye
 *  `target_payout` ni el reparto: el cliente no puede saber cuánto vale
 *  cada bolsa antes de entregarla. */
export interface StartRunResponse {
  session_id: string;
  world_seed: number;
  bags_remaining: number;
  tickets?: number;
  /** true = no hay Supabase configurado y la partida corre en local */
  demo?: boolean;
  error?: string;
  code?: string;
}

/** Respuesta de vaciar una bolsa en la carretilla. */
export interface DepositBagResponse {
  monto: number;
  bags_remaining: number;
  total_credited: number;
  finished: boolean;
  /** Solo al terminar: el premio total de la partida */
  payout?: number;
  error?: string;
  race?: boolean;
}

// ════════════════════════════════════════════════════════════════════════════
// Cuentas, pagos y billetera.
//
// Portado de La Llave Correcta. Los tipos van tal cual porque el dominio es
// el MISMO: el mismo Pago Móvil, el mismo banco, las mismas reglas de
// conciliación. Lo único que cambia es qué se compra con el ticket.
// ════════════════════════════════════════════════════════════════════════════

export type PlayerRole = 'player' | 'admin' | 'support';

export interface Player {
  id: string;
  username: string | null;
  first_name?: string | null;
  last_name?: string | null;
  whatsapp?: string | null;
  balance: number;
  tickets: number;
  total_wagered: number;
  total_won: number;
  role?: PlayerRole;
  /** Suspendido por el equipo: no entra, no juega y no cobra. */
  blocked?: boolean;
  /** Cédula del REGISTRO: fija la identidad. Distinta de payout_cedula. */
  cedula?: string | null;
  payout_name?: string | null;
  payout_bank?: string | null;
  payout_cedula?: string | null;
  payout_phone?: string | null;
  /** Foto de perfil (bucket público) o null. */
  avatar_url?: string | null;
  /** Su código de invitación. */
  referral_code?: string | null;
  referred_by?: string | null;
  /** Cuándo recuperó la contraseña. Durante 24 h desde esa hora no
   *  puede retirar: es la ventana en la que una cuenta robada cobraría. */
  password_reset_at?: string | null;
  /** Qué áreas del panel ve esta cuenta del equipo. NULL en un admin =
   *  todas. En un jugador no significa nada. */
  panel_areas?: string[] | null;
  created_at: string;
}

export type PurchaseStatus = 'pendiente' | 'validando' | 'aprobado' | 'rechazado';
export type WithdrawalStatus = 'pendiente' | 'pagado' | 'cancelado';

export interface TicketPurchase {
  id: string;
  player_id: string;
  quantity: number;
  amount_usd: number;
  amount_ves: number | null;
  exchange_rate_used: number | null;
  reference: string;
  status: PurchaseStatus;
  origin: 'auto' | 'manual' | null;
  status_note: string | null;
  created_at: string;
  validated_at: string | null;
  last_checked_at?: string | null;
  check_count?: number | null;
  /** true si el jugador adjuntó la captura del pago. */
  has_proof?: boolean;
  /** Dólares que faltaron en el banco (null = llegó completo). */
  falta?: number | null;
  falta_cobrada?: boolean | null;
  /** De dónde vino el pago, leído del comprobante. Ya viene filtrado:
   *  nunca contiene NUESTROS datos de destino. */
  ocr_origin?: string | null;
  ocr_origin_type?: string | null;
  ocr_bank?: string | null;
  ocr_origin_bank?: string | null;
  /** Solo fiable en pagos Ubii; en el resto llega null a propósito. */
  ocr_origin_cedula?: string | null;
  ocr_is_ubii?: boolean | null;
}

/** La cuenta desde la que este jugador paga siempre. Se fija con su primer
 *  pago y solo la mueve el equipo a propósito. */
export interface PlayerOrigenHuella {
  banco: string | null;
  ancla_tipo: string | null;
  ancla: string | null;
  muestra: string | null;
  fijado_at: string;
  fijado_por_nombre: string | null;
  motivo: string | null;
}

export interface Withdrawal {
  id: string;
  player_id: string;
  amount_usd: number;
  status: WithdrawalStatus;
  /** 'saldo' = premios del juego; 'referido' = comisión de un invitado. */
  source?: 'saldo' | 'referido';
  reference: string | null;
  admin_note: string | null;
  created_at: string;
  paid_at: string | null;
}

export interface WalletResponse {
  player: Player | null;
  purchases: TicketPurchase[];
  withdrawals: Withdrawal[];
  error?: string;
}

/** Una referencia que no se puede volver a usar. */
export interface BlockedReference {
  /** Los últimos 6 dígitos, que es como empareja el banco. */
  reference_norm: string;
  motivo: string;
  created_at: string;
  created_by?: string | null;
  bloqueada_por?: string | null;
}

/** Semáforo de la validación automática: resumen del diario del cron. */
export interface SaludValidacion {
  ultima: string | null;
  minutos: number | null;
  cola_al_dia: string | null;
  cola_minutos: number | null;
  hueco_min: number | null;
  hueco_desde: string | null;
  pasadas: number;
  ventana_min: number | null;
  latido_error: number;
  enfriamientos: number;
  entradas: number;
  aprobadas: number;
}

// ════════════════════════════════════════════════════════════════════════════
// Panel de administración
//
// Todo lo de aquí abajo lo pinta /admin y lo sirven las rutas de
// /api/admin. Nada llega jamás al navegador de un jugador: cada ruta
// comprueba primero que quien pide es del equipo.
// ════════════════════════════════════════════════════════════════════════════

/** Etiqueta interna del equipo sobre un jugador. El jugador NUNCA la ve. */
export type PlayerTagColor = 'neutral' | 'gold' | 'green' | 'red' | 'blue';

export interface PlayerTag {
  id: string;
  player_id: string;
  label: string;
  note: string | null;
  color: PlayerTagColor;
  created_at: string;
  updated_at: string;
}

export interface InteractionRow {
  id: string;
  username: string | null;
  tickets: number;
  balance: number;
  total_wagered: number;
  total_won: number;
  logins: number;
  app_opens: number;
  page_views: number;
  games: number;
  wins: number;
  losses: number;
  last_seen: string | null;
  created_at: string;
}

/** En qué mano está una compra no resuelta (panel de Transacciones) */
export type PurchaseBankState = 'esperando_banco' | 'consultando' | 'revision_manual';

export interface AdminPurchaseRow extends TicketPurchase {
  username: string | null;
  whatsapp?: string | null;
  cedula?: string | null;
  /** null cuando la compra ya fue aprobada o rechazada */
  bank_state?: PurchaseBankState | null;
  /** Puesto en la cola de validación automática (1 = siguiente) */
  queue_position?: number | null;
  /** Minutos máximos estimados hasta el próximo intento del banco */
  eta_minutes?: number | null;
  /** Quién del equipo la aprobó o rechazó. null = la resolvió sola la
   *  validación automática: ahí no hubo nadie a quien nombrar. */
  handled_by?: string | null;
  handled_by_name?: string | null;
}

export interface AdminWithdrawalRow extends Withdrawal {
  username: string | null;
  payout_name: string | null;
  payout_bank: string | null;
  payout_cedula: string | null;
  payout_phone: string | null;
  whatsapp?: string | null;
  cedula?: string | null;
  handled_by?: string | null;
  handled_by_name?: string | null;
}

export interface AppEventRow {
  id: number;
  player_id: string;
  event_type: 'login' | 'app_open' | 'page_view' | 'game_start' | 'game_win' | 'game_lose';
  path: string | null;
  created_at: string;
}

export interface AdminStats {
  total_players: number;
  total_tickets: number;
  total_wagered: number;
  total_paid: number;
  rtp_real: number | null;
  active_sessions: number;
  total_collected: number;
  total_withdrawn: number;
  pending_withdrawals: number;
  balance_owed: number;
  tickets_circulating: number;
  house_profit: number;
}

/** Fila de la sección Usuarios (con correo y estado de bloqueo) */
export interface AdminUserRow {
  id: string;
  username: string | null;
  email: string | null;
  role: PlayerRole | null;
  blocked: boolean;
  balance: number;
  tickets: number;
  total_wagered: number;
  total_won: number;
  created_at: string;
  whatsapp?: string | null;
  /** Cédula de REGISTRO. Distinta de payout_cedula, que es a la que se
   *  le paga: se editan por separado desde la ficha. */
  cedula?: string | null;
  panel_areas?: string[] | null;
  first_name?: string | null;
  last_name?: string | null;
  payout_name?: string | null;
  payout_bank?: string | null;
  payout_cedula?: string | null;
  payout_phone?: string | null;
}

// ── Historial detallado de un jugador ──

export interface PlayerHistoryGame {
  id: string;
  payout: number;
  bags_count: number;
  created_at: string;
}

export interface PlayerHistoryRedemption {
  id: string;
  quantity: number;
  amount_usd: number;
  created_at: string;
}

/** Un ＋/− de tickets o de saldo hecho a mano por el equipo */
export interface PlayerHistoryAdjustment {
  id: number;
  tipo: 'tickets' | 'saldo';
  /** Positivo = se le dio; negativo = se le quitó */
  delta: number;
  antes: number;
  despues: number;
  motivo: string | null;
  made_by_name: string | null;
  made_by_role: string | null;
  created_at: string;
}

/** Cuadre de los pagos cortos: qué faltó y qué ya se cobró */
export interface PlayerCompensacion {
  faltante: number;
  descontado: number;
  pendiente: number;
  cortas: {
    id: string;
    reference: string | null;
    created_at: string;
    falta: number;
    cobrado: boolean;
  }[];
  ajustes: number;
}

/** Una fila de la pestaña Recargas: o una compra, o tickets que el
 *  equipo puso/quitó a mano. Ambas mezcladas por fecha. */
export type PlayerHistoryRecarga =
  | { tipo: 'compra'; fecha: string; p: TicketPurchase }
  | { tipo: 'mano'; fecha: string; a: PlayerHistoryAdjustment };

/** Suma de lo ajustado a mano (sobre TODOS los ajustes, no la página) */
export interface PlayerHistoryTotalesAjustes {
  ticketsDados: number;
  ticketsQuitados: number;
  saldoDado: number;
  saldoQuitado: number;
}

/** Un premio de referido cobrado. Aquí todos entran al saldo. */
export interface PlayerReferralClaim {
  id: string;
  nombre: string | null;
  amount_usd: number;
  created_at: string;
  partidas: number;
}

// Cada pestaña del historial llega paginada de a 50: se recibe la
// primera página y su total, y el paginador de la ficha pide el resto
// por /api/admin/users?id=&tab=&page=.
export interface PlayerHistory {
  games: PlayerHistoryGame[];
  games_total: number;
  /** Recargas (compras + tickets a mano) ya mezcladas por fecha */
  recargas: PlayerHistoryRecarga[];
  recargas_total: number;
  withdrawals: Withdrawal[];
  withdrawals_total: number;
  redemptions: PlayerHistoryRedemption[];
  redemptions_total: number;
  adjustments: PlayerHistoryAdjustment[];
  adjustments_total: number;
  ajustes_totales: PlayerHistoryTotalesAjustes;
  /** Recargas de las que se pudo leer el origen del pago (ocr_origin) */
  origenes: TicketPurchase[];
  origenes_total: number;
  compensacion: PlayerCompensacion | null;
  /** Lo ganado invitando, separado de lo ganado jugando */
  referidos: { total: number; cobros: number };
  cobros_referidos: PlayerReferralClaim[];
  /** Su cuenta bancaria habitual (null = todavía no tiene ninguna) */
  origen: PlayerOrigenHuella | null;
}

// ── Equipo del panel ──

export interface StaffRow {
  id: string;
  username: string | null;
  email: string | null;
  role: PlayerRole;
  panel_areas: string[] | null;
  created_at: string;
}

// ── Resumen de Interacciones ──

export interface TopEntry {
  id: string;
  username: string | null;
  value: number;
}

// Registrados y ACTIVOS por ventana de tiempo (día de Venezuela).
// Activo = jugó al menos una partida o hizo una recarga aprobada en la
// ventana. Navegar por la app NO cuenta: entrar y no hacer nada no es
// actividad, y contarlo infla el número justo donde más engaña.
export interface AudienceCounts {
  registered: { hoy: number; semana: number; mes: number; anio: number; total: number };
  active: { hoy: number; semana: number; mes: number; anio: number };
  recharged?: { hoy: number; semana: number; mes: number; anio: number };
}

/** Registrados, activos y recargadores de UN día del calendario. Los
 *  *_ids permiten filtrar las listas por ese mismo día. */
export interface DayAudience {
  date: string;
  registered: number;
  active: number;
  active_ids?: string[];
  recharged?: number;
  recharged_ids?: string[];
  played_ids?: string[];
}

/** Estado actual para las etiquetas del panel: quién está jugando AHORA
 *  y quién ha comprado tickets alguna vez. */
export interface PresenceIds {
  playing_ids: string[];
  purchased_ids: string[];
}

export interface InteractionSummary {
  top_balance: TopEntry[];
  top_games: TopEntry[];
  top_purchases: TopEntry[];
  top_withdrawals: TopEntry[];
  total_games: number;
  players_played: number;
  manual_recharges: number;
  auto_recharges: number;
  audience?: AudienceCounts | null;
  day_audience?: DayAudience | null;
}

export interface AdminHistoryRow {
  id: string;
  player_id: string;
  payout: number;
  bags_count: number;
  created_at: string;
  username?: string | null;
}

// Movimientos mínimos para calcular las métricas por período del
// Resumen (recargas y retiros por día, 7 días, 30 días) en el cliente
export interface FinancePurchaseLite {
  amount_usd: number;
  created_at: string;
  validated_at: string | null;
}

export interface FinanceWithdrawalLite {
  amount_usd: number;
  created_at: string;
  paid_at: string | null;
}

export interface AdminStatsResponse {
  stats: AdminStats | null;
  recent_games: AdminHistoryRow[];
  finance?: {
    purchases: FinancePurchaseLite[];
    withdrawals: FinanceWithdrawalLite[];
  };
  error?: string;
}

// ── Métrica histórica de recurrencia ──
// Cuántos DÍAS DISTINTOS ha jugado cada usuario desde que existe la app,
// cómo los reparte (seguidos o con saltos) y qué ha ganado en relación
// con lo que ha jugado. Sin filtros de período: es histórico.

export type PlayPattern = 'unico' | 'seguidos' | 'saltos';

export interface RetentionPlayer {
  id: string;
  username: string | null;
  /** Días (YYYY-MM-DD, hora de Venezuela) en que jugó, ascendente */
  days: string[];
  days_count: number;
  games: number;
  /** Partidas jugadas × $2 */
  wagered: number;
  won: number;
  /** won / wagered (null si no ha jugado) */
  rtp: number | null;
  pattern: PlayPattern;
  max_streak: number;
  skipped_days: number;
  first_day: string;
  last_day: string;
  days_since_last: number;
  /** Dinero real: recargas aprobadas y retiros pagados */
  recharged: number;
  withdrawn: number;
  balance: number;
  tickets: number;
  /** Jugó un solo día y no ha vuelto (ver totals.abandon_after_days) */
  abandoned: boolean;
}

export interface RetentionBucket {
  /** 1…10 días; el último tramo agrupa "10 o más" */
  days: number;
  is_plus: boolean;
  players: number;
  pct: number;
  consecutive: number;
  intermittent: number;
}

export interface RetentionCalendarDay {
  date: string;
  players: number;
  games: number;
}

export interface RetentionTotals {
  players_played: number;
  registered: number;
  never_played: number;
  one_day: number;
  one_game: number;
  abandoned: number;
  consecutive: number;
  intermittent: number;
  avg_days: number;
  total_games: number;
  wagered: number;
  won: number;
  rtp: number | null;
  abandon_after_days: number;
}

export interface RetentionResponse {
  buckets: RetentionBucket[];
  calendar: RetentionCalendarDay[];
  totals: RetentionTotals;
  players: RetentionPlayer[];
  error?: string;
}

// ── Referidos ──
// Quién ha traído gente con su enlace y qué hacen esos referidos. Lo
// arma entero el RPC admin_referral_overview (migración 005).

export interface AdminReferido {
  id: string;
  nombre: string;
  created_at: string;
  partidas: number;
  balance: number;
  tickets: number;
  /** Ya compró al menos un ticket con un pago aprobado */
  compro: boolean;
  /** Activo = compró al menos un ticket Y jugó al menos una partida */
  activo: boolean;
  blocked: boolean;
  /** A cuánto da derecho lo jugado ($1 por cada 10 partidas, tope $3) */
  ganado: number;
  /** Lo que el referidor ya cobró por este referido */
  cobrado: number;
}

export interface AdminReferrer {
  id: string;
  nombre: string;
  referidos: number;
  jugando: number;
  compraron: number;
  activos: number;
  partidas_total: number;
  cobrado: number;
  pendiente: number;
  lista: AdminReferido[];
}

export interface AdminReferralOverview {
  summary: {
    /** Referidores cuyo enlace consiguió al menos un registro */
    referrers: number;
    referred: number;
    playing: number;
    buyers: number;
    active: number;
    paid_out: number;
    pending: number;
    pending_personas: number;
    codes_total: number;
  } | null;
  stats?: AdminReferralStats;
  referrers: AdminReferrer[];
  error?: string;
}

/** Conteos por ventana de tiempo (día de Venezuela) */
export interface AdminReferralVentanas {
  hoy: number;
  ayer: number;
  /** Esta semana (desde el lunes) */
  semana: number;
  /** La semana anterior completa, para el % de cambio */
  semana_prev: number;
  dias7: number;
  mes: number;
}

export interface AdminReferralStats {
  afiliados: AdminReferralVentanas;
  /** Referidores distintos que trajeron ≥1 registro en cada ventana */
  recomendando: AdminReferralVentanas;
  jugaron_hoy: { total: number; activos: number };
  jugaron_ayer: { total: number; activos: number };
  premio: { usd: number; personas: number };
  chart: { dia: string; afiliados: number }[];
}

// ── Caja: cuánto entró, cuánto salió y qué quedó, día por día ──

export interface CajaDia {
  /** YYYY-MM-DD, día de Venezuela */
  dia: string;
  depositos: number;
  retiros: number;
  /** depositos − retiros */
  ganancia: number;
  /** ganancia sobre lo depositado, en % (null si no entró nada) */
  porcentaje: number | null;
  nDepositos: number;
  nRetiros: number;
}

export interface CajaResumen {
  /** Los 30 días, del más reciente al más antiguo */
  dias: CajaDia[];
  total: {
    depositos: number;
    retiros: number;
    ganancia: number;
    porcentaje: number | null;
    /** Retiros pedidos y aún sin pagar: comprometido, no gastado */
    pendiente: number;
    nPendientes: number;
  };
}
