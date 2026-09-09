import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const CLIENT_EVENTS = new Set(['login', 'app_open', 'page_view']);

interface TrackBody {
  type: string;
  path?: string;
}

// Registro de interacción (analítica del admin). El cliente solo
// puede registrar sus propios eventos de navegación; los eventos de
// juego los escribe el servidor. Nunca falla hacia el usuario.
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    // La analítica nunca falla hacia el usuario: sin base, no se apunta nada.
    if (!supabase) return NextResponse.json({ ok: false });
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ ok: false });

    const body: TrackBody = await req.json();
    if (!CLIENT_EVENTS.has(body.type)) return NextResponse.json({ ok: false });

    await supabase.from('app_events').insert({
      player_id: user.id,
      event_type: body.type,
      path: body.path ? String(body.path).slice(0, 120) : null,
    });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false });
  }
}
