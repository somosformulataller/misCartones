import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

interface PayoutInfoBody {
  name?: string;
  bank?: string;
  cedula?: string;
  phone?: string;
}

// Datos de Pago Móvil donde el jugador recibe sus premios/retiros
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

    const body: PayoutInfoBody = await req.json();
    const clamp = (v: unknown) => String(v ?? '').trim().slice(0, 80);

    // La cédula de cobro es SIEMPRE la del registro (identidad fija):
    // lo que mande el cliente solo cuenta para cuentas viejas creadas
    // antes de que el registro pidiera cédula.
    const { data: me } = await supabase
      .from('players')
      .select('cedula')
      .eq('id', user.id)
      .single();
    const cedula = me?.cedula?.trim() ? me.cedula.trim() : clamp(body.cedula);

    const { error } = await supabase.rpc('save_payout_info', {
      p_name: clamp(body.name),
      p_bank: clamp(body.bank),
      p_cedula: cedula,
      p_phone: clamp(body.phone),
    });

    if (error) {
      return NextResponse.json({ error: 'No se pudieron guardar los datos' }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Error del servidor' }, { status: 500 });
  }
}
