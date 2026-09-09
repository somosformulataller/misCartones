import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, isAdminClientConfigured } from '@/lib/supabase/admin';
import { revisarClaveNueva } from '@/lib/auth/recuperar';
import { apuntarIntento, gastarPermiso, ipDe } from '@/lib/auth/recuperarServidor';

// Paso 2 de recuperar la contraseña: ponerla.
//
// Solo se llega aquí con el permiso que entregó el paso 1, y ese
// permiso se gasta en el acto: vale una vez y caduca a los 10 minutos.
//
// El cambio lo hace el SERVIDOR con la clave de servicio. Es la única
// forma de cambiarle la contraseña a alguien que, por definición, no
// puede iniciar sesión. Efecto de regalo, comprobado contra el
// Supabase de producción: al cambiarla, las sesiones que hubiera
// abiertas dejan de renovarse — si alguien le había robado la cuenta,
// se queda fuera solo.
export async function POST(req: NextRequest) {
  try {
    if (!isAdminClientConfigured()) {
      return NextResponse.json(
        { error: 'La recuperación no está disponible ahora mismo. Escríbenos y te ayudamos.' },
        { status: 503 }
      );
    }
    const admin = createAdminClient();
    const body = await req.json().catch(() => ({}));
    const clave = String(body.clave ?? '');
    const repetida = String(body.repetida ?? '');

    // Primero la contraseña, y solo después se gasta el permiso: si la
    // escribió mal o no coinciden, no puede perder el permiso por eso y
    // tener que empezar de cero.
    const revision = revisarClaveNueva(clave, repetida);
    if (!revision.ok) {
      return NextResponse.json({ error: revision.error }, { status: 400 });
    }

    const permiso = await gastarPermiso(admin, String(body.permiso ?? ''));
    if (!permiso) {
      return NextResponse.json(
        {
          error:
            'Este enlace ya se usó o pasaron más de 10 minutos. Vuelve a empezar con tus datos.',
        },
        { status: 401 }
      );
    }

    const { error } = await admin.auth.admin.updateUserById(permiso.playerId, { password: clave });
    if (error) {
      const msg = /password/i.test(error.message)
        ? 'Esa contraseña no es válida. Prueba con otra.'
        : 'No se pudo cambiar la contraseña. Vuelve a intentarlo.';
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    // La marca del freno de retiros (migración 023). Va DESPUÉS del
    // cambio y no lo condiciona: si esto fallara, la persona ya tiene
    // su contraseña nueva y lo que se pierde es el freno — se avisa por
    // la bitácora, no se le deja tirada en mitad del proceso.
    const ahora = new Date().toISOString();
    await admin.from('players').update({ password_reset_at: ahora }).eq('id', permiso.playerId);

    const { data: jugador } = await admin
      .from('players')
      .select('username')
      .eq('id', permiso.playerId)
      .maybeSingle();

    await apuntarIntento(admin, {
      email: String(body.correo ?? '').toLowerCase().slice(0, 200),
      playerId: permiso.playerId,
      ip: ipDe(req),
      resultado: 'cambiada',
    });

    return NextResponse.json({ ok: true, nombre: jugador?.username ?? null });
  } catch {
    return NextResponse.json({ error: 'Error del servidor' }, { status: 500 });
  }
}
