import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient, isAdminClientConfigured } from '@/lib/supabase/admin';
import { isStaffRole } from '@/lib/admin/areas';

const MAX_SIZE = 5 * 1024 * 1024; // 5 MB

// Tipos permitidos: imágenes, PDF y notas de voz (audio)
function isAllowedType(type: string): boolean {
  return (
    type.startsWith('image/') || type === 'application/pdf' || type.startsWith('audio/')
  );
}

/**
 * Qué es el archivo. Algunos teléfonos mandan la foto SIN tipo (pasa
 * con los HEIC de iPhone): entonces manda la extensión, porque
 * rechazar la foto de una cédula con «solo se permiten imágenes» es
 * exactamente el error que no hay forma de entender desde el otro lado.
 */
function tipoDe(file: File): string {
  if (file.type) return file.type;
  const n = file.name.toLowerCase();
  if (/\.(heic|heif)$/.test(n)) return 'image/heic';
  if (/\.(jpe?g)$/.test(n)) return 'image/jpeg';
  if (/\.png$/.test(n)) return 'image/png';
  if (/\.webp$/.test(n)) return 'image/webp';
  if (/\.pdf$/.test(n)) return 'application/pdf';
  return '';
}

// Sube un adjunto del chat al bucket PRIVADO chat-attachments.
// Los archivos viven en la carpeta del JUGADOR dueño de la
// conversación (también los que envía soporte, para que el jugador
// pueda verlos). El admin indica esa carpeta con player_id.
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
      return NextResponse.json({ error: 'El chat no está configurado' }, { status: 503 });
    }

    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Falta el archivo' }, { status: 400 });
    }
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: 'El archivo supera los 5 MB.' }, { status: 400 });
    }
    const tipo = tipoDe(file);
    if (!isAllowedType(tipo)) {
      return NextResponse.json({ error: 'Solo se permiten imágenes o PDF.' }, { status: 400 });
    }

    // Carpeta destino: la propia, salvo que un admin apunte a un jugador
    let folder = user.id;
    const targetPlayer = form.get('player_id');
    if (typeof targetPlayer === 'string' && targetPlayer && targetPlayer !== user.id) {
      const { data: me } = await supabase
        .from('players')
        .select('role')
        .eq('id', user.id)
        .single();
      // Todo el equipo, no solo admin: en La Llave atención al cliente podía
      // ver los adjuntos de un chat pero no mandar uno (403).
      if (!isStaffRole(me?.role)) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
      }
      folder = targetPlayer;
    }

    const safeName = (file.name || 'archivo')
      .replace(/[^\w.\-]+/g, '_')
      .slice(-80);
    const path = `${folder}/${crypto.randomUUID()}_${safeName}`;

    const admin = createAdminClient();
    const { error } = await admin.storage
      .from('chat-attachments')
      .upload(path, Buffer.from(await file.arrayBuffer()), {
        contentType: tipo,
        upsert: false,
      });
    if (error) {
      return NextResponse.json({ error: 'No se pudo subir el archivo' }, { status: 500 });
    }

    return NextResponse.json({
      path,
      name: file.name || safeName,
      type: tipo,
    });
  } catch {
    return NextResponse.json({ error: 'Error del servidor' }, { status: 500 });
  }
}
