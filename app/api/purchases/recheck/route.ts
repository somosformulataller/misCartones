import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// "¿Ya me lo aprobaron?" — la app del jugador pregunta esto mientras
// ve un pago en revisión.
//
// YA NO TOCA EL BANCO. Antes cada jugador mirando su pantalla disparaba
// una consulta al banco cada 60 s: entre eso, la campanita y el cron
// eran ~75 consultas en media hora, el banco respondía 429 y nadie
// validaba. Ahora la conciliación la hace el cron (una entrada al banco
// por minuto, todas las compras de una pasada) y esto solo LEE nuestra
// base de datos: se puede preguntar tan seguido como haga falta.
export async function POST() {
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

    const { data: recientes } = await supabase
      .from('ticket_purchases')
      .select('id, status, status_note')
      .eq('player_id', user.id)
      .order('created_at', { ascending: false })
      .limit(5);

    const results = (recientes ?? []).map((p) => ({
      id: p.id,
      status: p.status,
      tickets: null,
    }));

    return NextResponse.json({
      results,
      approved: results.filter((r) => r.status === 'aprobado').length,
    });
  } catch {
    return NextResponse.json({ error: 'Error del servidor' }, { status: 500 });
  }
}
