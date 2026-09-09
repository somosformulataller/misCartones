import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Mis referidos: código propio, si tengo un retiro en proceso, y la
// lista con el progreso de cada uno. Todo sale del RPC my_referrals
// (SECURITY DEFINER): contar las partidas de otro jugador no se puede
// hacer con la sesión del que pregunta.
export async function GET() {
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

    const { data, error } = await supabase.rpc('my_referrals');
    if (error) {
      return NextResponse.json({ error: 'No se pudo cargar tus referidos' }, { status: 400 });
    }
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: 'Error del servidor' }, { status: 500 });
  }
}
