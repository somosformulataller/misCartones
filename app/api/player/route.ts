import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET() {
  try {
    const supabase = await createClient();
    // Sin Supabase no hay jugador que devolver. Un 503 aquí pintaría toda la
    // app como rota; quien decide y avisa es la pantalla que pida jugar.
    if (!supabase) return NextResponse.json({ player: null });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ player: null });

    const { data: player } = await supabase
      .from('players')
      .select('*')
      .eq('id', user.id)
      .single();

    return NextResponse.json({ player });
  } catch {
    return NextResponse.json({ player: null });
  }
}
