import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient, isAdminClientConfigured } from '@/lib/supabase/admin';
import { isStaffRole } from '@/lib/admin/areas';

// Devuelve un enlace TEMPORAL firmado (1 hora) para ver un adjunto
// del chat. El bucket es privado: cada jugador solo accede a los
// archivos de su carpeta; el admin, a todos.
export async function GET(req: NextRequest) {
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

    if (!isAdminClientConfigured()) {
      return NextResponse.json({ error: 'El chat no está configurado' }, { status: 503 });
    }

    const path = req.nextUrl.searchParams.get('path') ?? '';
    if (!path || path.includes('..')) {
      return NextResponse.json({ error: 'Ruta inválida' }, { status: 400 });
    }

    // Los adjuntos de OTRA carpeta solo los ve el equipo. Atención al
    // cliente también: es quien atiende el chat, y pedirle que responda
    // sin poder abrir la foto que le acaban de mandar no tiene sentido.
    // Antes exigía rol 'admin' y a support le salía «adjunto no
    // disponible» en cada imagen.
    if (!path.startsWith(`${user.id}/`)) {
      const { data: me } = await supabase
        .from('players')
        .select('role')
        .eq('id', user.id)
        .single();
      if (!isStaffRole(me?.role)) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
      }
    }

    const admin = createAdminClient();
    const { data, error } = await admin.storage
      .from('chat-attachments')
      .createSignedUrl(path, 3600);
    if (error || !data?.signedUrl) {
      return NextResponse.json({ error: 'Adjunto no encontrado' }, { status: 404 });
    }

    return NextResponse.json({ url: data.signedUrl });
  } catch {
    return NextResponse.json({ error: 'Error del servidor' }, { status: 500 });
  }
}
