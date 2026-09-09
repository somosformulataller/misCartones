import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { BLOCKED_MESSAGE, isBlocked } from '@/lib/supabase/blocked';
import { MIN_WITHDRAWAL_USD } from '@/lib/payments/constants';
import { createAdminClient, isAdminClientConfigured } from '@/lib/supabase/admin';
import { avisarSiRetiroRaro } from '@/lib/security/alertaRetiro';
import { rateLimited } from '@/lib/security/rateLimit';
import { inicioDiaCaracasISO, retirosPermitidos } from '@/lib/wallet/limiteRetiros';

interface WithdrawBody {
  amount: number;
}

// Solicitar retiro del saldo de premios. El RPC request_withdrawal
// es atómico: descuenta el saldo, valida que no haya otro retiro en
// proceso y crea la solicitud (el admin la paga por Pago Móvil).
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    if (!supabase) {
      return NextResponse.json(
        { error: 'El sistema no está configurado todavía.', code: 'SIN_CONFIGURAR' },
        { status: 503 }
      );
    }
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

    if (await isBlocked(supabase, user.id)) {
      return NextResponse.json({ error: BLOCKED_MESSAGE }, { status: 403 });
    }

    // Freno de ritmo por jugador: el RPC ya impide tener dos retiros
    // pendientes, pero esto corta el machaqueo de solicitudes (crear,
    // cancelar, crear…). 10/hora es de sobra para cualquiera honesto.
    if (isAdminClientConfigured()) {
      const frenado = await rateLimited(
        createAdminClient(),
        'withdraw',
        user.id,
        10,
        3_600_000
      );
      if (frenado) {
        return NextResponse.json(
          { error: 'Demasiadas solicitudes de retiro seguidas. Espera un momento.' },
          { status: 429 }
        );
      }
    }

    const body: WithdrawBody = await req.json();
    const amount = Math.round(Number(body.amount) * 100) / 100;

    if (!Number.isFinite(amount) || amount < MIN_WITHDRAWAL_USD) {
      return NextResponse.json(
        { error: `El monto mínimo de retiro es $${MIN_WITHDRAWAL_USD.toFixed(2)}` },
        { status: 400 }
      );
    }

    // Sin datos de Pago Móvil guardados no hay retiro: el equipo no
    // tendría a dónde enviar el pago.
    const { data: payout } = await supabase
      .from('players')
      .select('payout_name, payout_bank, payout_cedula, payout_phone, cedula')
      .eq('id', user.id)
      .single();
    const hasPayout =
      Boolean(payout?.payout_name?.trim()) &&
      Boolean(payout?.payout_bank?.trim()) &&
      Boolean(String(payout?.payout_cedula ?? payout?.cedula ?? '').trim()) &&
      Boolean(payout?.payout_phone?.trim());
    if (!hasPayout) {
      return NextResponse.json(
        {
          error:
            'Antes de retirar, guarda tus datos de Pago Móvil en «Datos para recibir tus premios».',
        },
        { status: 400 }
      );
    }

    // Límite de retiros diarios según las partidas jugadas hoy (Caracas).
    // El RPC ya impide dos retiros PENDIENTES a la vez (serializa las
    // solicitudes), así que contar aquí es seguro: no puede haber dos
    // creaciones simultáneas que se salten el tope.
    const inicioDia = inicioDiaCaracasISO();
    const [partidasRes, retirosRes] = await Promise.all([
      supabase
        .from('game_history')
        .select('id', { count: 'exact', head: true })
        .eq('player_id', user.id)
        .gte('created_at', inicioDia),
      supabase
        .from('withdrawals')
        .select('id', { count: 'exact', head: true })
        .eq('player_id', user.id)
        .in('status', ['pendiente', 'pagado'])
        .gte('created_at', inicioDia),
    ]);
    const permitidos = retirosPermitidos(partidasRes.count ?? 0);
    if ((retirosRes.count ?? 0) >= permitidos) {
      const extra =
        permitidos < 3 ? ' Juega más partidas hoy para desbloquear más retiros.' : '';
      return NextResponse.json(
        {
          error: `Alcanzaste tu límite de retiros de hoy (${permitidos}).${extra} Vuelve mañana.`,
          limite_retiros: true,
        },
        { status: 400 }
      );
    }

    const { data, error } = await supabase.rpc('request_withdrawal', { p_amount: amount });
    if (error) {
      return NextResponse.json(
        { error: error.message || 'No se pudo solicitar el retiro' },
        { status: 400 }
      );
    }

    const result = data as { id: string; balance: number };

    // Aviso al equipo si el retiro se sale del patrón (monto alto, cobra
    // mucho más de lo depositado, muchos retiros en un día). NO bloquea:
    // el retiro ya está creado y esto solo deja una nota interna.
    if (isAdminClientConfigured()) {
      await avisarSiRetiroRaro(createAdminClient(), user.id, amount);
    }

    return NextResponse.json({
      withdrawal_id: result.id,
      balance: Number(result.balance),
    });
  } catch {
    return NextResponse.json({ error: 'Error del servidor' }, { status: 500 });
  }
}
