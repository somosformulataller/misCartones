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
