import { createAdminClient } from '@/lib/supabase/admin';
import { isBankApiConfigured } from './bankApi';
import { conciliarUna } from './conciliar';
import {
  BANK_SHADOW_MODE,
  BANK_VALIDATION_ENABLED,
  DUPLICATE_MARKER,
  esRevisionSoloManual,
} from './constants';
import { ORIGEN_MSG_JUGADOR } from './origen';

export interface AutoValidateResult {
  status: 'aprobado' | 'pendiente';
  tickets?: number;
  reason?: string;
}

// Textos que ve el jugador cuando la compra queda en revisión
const PENDING_REASONS: Record<string, string> = {
  not_found: 'El banco aún no refleja el pago (suele tardar 1–2 minutos).',
  not_configured: 'La validación automática no está configurada. Un administrador la revisará.',
  manual:
    'Tu pago está en proceso de verificación. Apenas se confirme, tus tickets se acreditarán automáticamente y recibirás una notificación 🔔.',
};

// Intento para UNA compra, al registrarla o cuando el equipo pulsa
// «revalidar». El trabajo de fondo lo hace la conciliación del cron
// (lib/payments/conciliar.ts), que resuelve TODAS las pendientes de una
// pasada; aquí solo se mira la cola ya guardada, sin tocar el banco:
// si el movimiento ya llegó, el jugador tiene sus tickets al instante.
// El sistema NUNCA rechaza solo (regla de oro).
export async function tryAutoValidatePurchase(purchaseId: string): Promise<AutoValidateResult> {
  const admin = createAdminClient();

  const { data: purchase, error } = await admin
    .from('ticket_purchases')
    .select('id, player_id, status, reference, amount_ves, exchange_rate_used, created_at, status_note')
    .eq('id', purchaseId)
    .single();

  if (error || !purchase) return { status: 'pendiente', reason: 'Compra no encontrada' };
  if (purchase.status === 'aprobado') return { status: 'aprobado' };
  if (purchase.status === 'rechazado') return { status: 'pendiente', reason: 'Compra rechazada' };

  // Revisión SOLO manual. Se devuelve un texto limpio: la nota interna
  // lleva datos de OTRAS compras (o del origen del pago) y no puede
  // acabar en la pantalla del jugador.
  if (esRevisionSoloManual(purchase.status_note)) {
    return {
      status: 'pendiente',
      reason: purchase.status_note?.startsWith(DUPLICATE_MARKER)
        ? 'Ese número de referencia ya se usó en otra compra. Un administrador la revisará.'
        : ORIGEN_MSG_JUGADOR,
    };
  }

  // Validación automática apagada (o en modo sombra): la compra queda
  // pendiente para que el equipo la apruebe a mano — ni una consulta.
  if (!BANK_VALIDATION_ENABLED || BANK_SHADOW_MODE) {
    if (purchase.status_note !== PENDING_REASONS.manual) {
      await admin
        .from('ticket_purchases')
        .update({ status: 'pendiente', status_note: PENDING_REASONS.manual })
        .eq('id', purchaseId);
    }
    return { status: 'pendiente', reason: PENDING_REASONS.manual };
  }

  if (!isBankApiConfigured()) {
    await admin
      .from('ticket_purchases')
      .update({ status: 'pendiente', status_note: PENDING_REASONS.not_configured })
      .eq('id', purchaseId);
    return { status: 'pendiente', reason: PENDING_REASONS.not_configured };
  }

  // Bitácora de la consulta (panel: "verificado N veces, última hace X")
  try {
    const { data: prev } = await admin
      .from('ticket_purchases')
      .select('check_count')
      .eq('id', purchaseId)
      .single();
    await admin
      .from('ticket_purchases')
      .update({
        last_checked_at: new Date().toISOString(),
        check_count: ((prev as { check_count?: number } | null)?.check_count ?? 0) + 1,
      })
      .eq('id', purchaseId);
  } catch {}

  const aprobada = await conciliarUna({
    id: purchase.id,
    reference: purchase.reference,
    amount_ves: purchase.amount_ves === null ? null : Number(purchase.amount_ves),
    exchange_rate_used:
      purchase.exchange_rate_used === null ? null : Number(purchase.exchange_rate_used),
    created_at: purchase.created_at,
    status_note: purchase.status_note,
  });

  if (aprobada) {
    const { data } = await admin
      .from('players')
      .select('tickets')
      .eq('id', purchase.player_id)
      .single();
    return { status: 'aprobado', tickets: (data as { tickets?: number } | null)?.tickets };
  }

  if (purchase.status_note !== PENDING_REASONS.not_found) {
    await admin
      .from('ticket_purchases')
      .update({ status: 'pendiente', status_note: PENDING_REASONS.not_found })
      .eq('id', purchaseId);
  }
  return { status: 'pendiente', reason: PENDING_REASONS.not_found };
}
