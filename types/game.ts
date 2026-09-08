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
