import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient, isAdminClientConfigured } from '@/lib/supabase/admin';
import { avatarPublicUrl } from '@/lib/profile/avatar';

const MAX_SIZE = 5 * 1024 * 1024; // 5 MB (el cliente ya la reduce a ~512px)

// Foto de perfil del jugador: se guarda como `<id>.jpg` en el bucket
// PÚBLICO avatars (upsert: subir de nuevo la reemplaza). La sube el
// servidor con la clave de servicio — el nombre del archivo es SIEMPRE
// el id del propio usuario, nadie puede pisar la foto de otro.
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

    if (!isAdminClientConfigured()) {
      return NextResponse.json({ error: 'No configurado' }, { status: 503 });
    }

    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Falta la imagen' }, { status: 400 });
    }
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: 'La imagen supera los 5 MB.' }, { status: 400 });
    }
    if (!file.type.startsWith('image/')) {
      return NextResponse.json({ error: 'Solo se permiten imágenes.' }, { status: 400 });
    }

    const admin = createAdminClient();
    const { error } = await admin.storage
      .from('avatars')
      .upload(`${user.id}.jpg`, Buffer.from(await file.arrayBuffer()), {
        contentType: file.type,
        upsert: true,
        cacheControl: '60', // para que el cambio de foto se vea pronto
      });
    if (error) {
      console.error('avatar upload error:', error);
      return NextResponse.json({ error: 'No se pudo subir la imagen' }, { status: 500 });
    }

    const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
    return NextResponse.json({
      ok: true,
      // v=ahora rompe la caché del navegador tras actualizarla
      url: `${avatarPublicUrl(base, user.id)}?v=${Date.now()}`,
    });
  } catch {
    return NextResponse.json({ error: 'Error del servidor' }, { status: 500 });
  }
}
