import { NextResponse } from 'next/server';
import { createAdminClient, isAdminClientConfigured } from '@/lib/supabase/admin';
import { requireStaff } from '@/lib/admin/guard';
import { cargarCorreos } from '@/lib/admin/emails';
import { diaCaracas } from '@/lib/payments/constants';

// Nunca estático ni cacheado: cada descarga refleja la base al instante,
// así la lista sale "al día" siempre que alguien la baje.
export const dynamic = 'force-dynamic';

/**
 * Descarga en .txt de TODOS los correos de los usuarios, uno por línea y
 * sin nada más (ni nombres, ni ids). Se arma en vivo desde el registro de
 * acceso (auth), que es donde vive el correo —la tabla players no lo
 * guarda—, por lo que siempre está actualizada al momento de bajarla.
 */
export async function GET() {
  try {
    const { error } = await requireStaff('usuarios');
    if (error) return error;
    if (!isAdminClientConfigured()) {
      return NextResponse.json({ error: 'Falta SUPABASE_SECRET_KEY en el servidor' }, { status: 503 });
    }
    const admin = createAdminClient();

    const { map, completo } = await cargarCorreos(admin);
    if (!completo) {
      // No entregar una lista a medias: una lista de correos incompleta es
      // peor que ninguna. Que reintente.
      return NextResponse.json(
        { error: 'No se pudo traer la lista completa de correos. Intenta de nuevo en un momento.' },
        { status: 503 },
      );
    }

    // Solo el correo, uno por línea. Dedupe sin distinguir mayúsculas (por
    // si dos cuentas comparten correo) y orden alfabético para que sea
    // estable y fácil de revisar.
    const vistos = new Set<string>();
    const correos: string[] = [];
    for (const e of map.values()) {
      const limpio = e.trim();
      if (!limpio) continue;
      const clave = limpio.toLowerCase();
      if (vistos.has(clave)) continue;
      vistos.add(clave);
      correos.push(limpio);
    }
    correos.sort((a, b) => a.localeCompare(b));

    // Salto final para que la última línea también termine en \n.
    const cuerpo = correos.length ? correos.join('\n') + '\n' : '';
    const nombre = `emails-${diaCaracas(Date.now())}.txt`;

    return new NextResponse(cuerpo, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="${nombre}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch {
    return NextResponse.json({ error: 'Error del servidor' }, { status: 500 });
  }
}
