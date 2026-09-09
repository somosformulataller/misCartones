import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { BLOCKED_MESSAGE, isBlocked } from '@/lib/supabase/blocked';
import { createAdminClient, isAdminClientConfigured } from '@/lib/supabase/admin';
import { rateLimited } from '@/lib/security/rateLimit';

interface ClaimBody {
  referred_id: string;
}

// Cobrar el premio por un referido que ya jugó las partidas. Desde la
// migración 029 los $3 se SUMAN AL SALDO: el jugador decide después si
// los retira o juega con ellos, en vez de quedarse esperando un pago.
//
// Todas las reglas de dinero las vuelve a comprobar el RPC
// claim_referral: esto es la puerta cómoda, no el candado.
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
      return NextResponse.json({ error: BLOCKED_MESSAGE, blocked: true }, { status: 403 });
    }

    if (isAdminClientConfigured()) {
      const frenado = await rateLimited(
        createAdminClient(),
        'claim_referral',
        user.id,
        20,
        3_600_000
      );
      if (frenado) {
        return NextResponse.json(
          { error: 'Demasiados intentos seguidos. Espera un momento.' },
          { status: 429 }
        );
      }
    }

    const body: ClaimBody = await req.json();
    const referred = String(body.referred_id ?? '').trim();
    if (!referred) {
      return NextResponse.json({ error: 'Falta el referido' }, { status: 400 });
    }

    const { data, error } = await supabase.rpc('claim_referral', { p_referred: referred });
    if (error) {
      return NextResponse.json(
        { error: error.message || 'No se pudo cobrar el premio' },
        { status: 400 }
      );
    }

    // El premio entra al SALDO, no como un retiro aparte. Así el jugador
    // decide después si lo saca o juega con él, en vez de quedarse esperando
    // un pago que tiene que hacer una persona a mano.
    const result = data as { amount: number; balance: number };
    return NextResponse.json({
      ok: true,
      amount: Number(result.amount),
      balance: Number(result.balance),
    });
  } catch {
    return NextResponse.json({ error: 'Error del servidor' }, { status: 500 });
  }
}
