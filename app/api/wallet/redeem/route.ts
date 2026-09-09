import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { BLOCKED_MESSAGE, isBlocked } from '@/lib/supabase/blocked';
import { TICKET_PRICE_USD } from '@/lib/payments/constants';

interface RedeemBody {
  tickets?: number;
  all?: boolean;
}

// Canjear saldo de premios por tickets (1 ticket = $2.00). El RPC
// redeem_tickets es atómico y valida el saldo en la base de datos.
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

    const body: RedeemBody = await req.json();
    let qty: number;

    if (body.all) {
      // "Todo a tickets": el máximo que alcanza con el saldo actual
      const { data: player } = await supabase
        .from('players')
        .select('balance')
        .eq('id', user.id)
        .single();
      qty = Math.floor(Number(player?.balance ?? 0) / TICKET_PRICE_USD);
      if (qty < 1) {
        return NextResponse.json(
          { error: `Necesitas al menos $${TICKET_PRICE_USD.toFixed(2)} de saldo para canjear un ticket.` },
          { status: 400 }
        );
      }
    } else {
      qty = Math.trunc(Number(body.tickets));
      if (!Number.isFinite(qty) || qty < 1) {
        return NextResponse.json({ error: 'Cantidad inválida' }, { status: 400 });
      }
    }

    const { data, error } = await supabase.rpc('redeem_tickets', { p_qty: qty });
    if (error) {
      return NextResponse.json(
        { error: error.message || 'No se pudo canjear' },
        { status: 400 }
      );
    }

    const result = data as { balance: number; tickets: number };
    return NextResponse.json({
      redeemed: qty,
      balance: Number(result.balance),
      tickets: Number(result.tickets),
    });
  } catch {
    return NextResponse.json({ error: 'Error del servidor' }, { status: 500 });
  }
}
