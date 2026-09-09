import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, isAdminClientConfigured } from '@/lib/supabase/admin';
import { esLaDuena, faltaAlgo, limpiarCorreo, NO_CUADRA } from '@/lib/auth/recuperar';
import {
  apuntarIntento,
  buscarPorCorreo,
  crearPermiso,
  estaFrenado,
  ipDe,
} from '@/lib/auth/recuperarServidor';

// Paso 1 de recuperar la contraseña: «¿eres tú?».
//
// Recibe correo, cédula y teléfono. Si los tres cuadran con la cuenta,
// devuelve un permiso de un solo uso para poner la contraseña nueva
// (paso 2). No manda ningún correo: todo pasa en la misma pantalla.
//
// Regla que gobierna todas las respuestas de aquí: **fuera de la
// respuesta buena, todas dicen exactamente lo mismo**. No se distingue
// entre «ese correo no existe», «la cédula no es esa», «esa cuenta es
// del equipo» ni «esa cuenta está bloqueada». Contarlo convertiría una
// adivinanza de tres datos a la vez en tres adivinanzas por separado, y
// de paso confirmaría qué correos tienen cuenta aquí.
//
// Que la respuesta sea siempre igual no significa que no se sepa qué
// pasó: cada intento, con su motivo real, queda en la bitácora
// (migración 023) y se puede mirar desde la base.
export async function POST(req: NextRequest) {
  try {
    if (!isAdminClientConfigured()) {
      return NextResponse.json(
        { error: 'La recuperación no está disponible ahora mismo. Escríbenos y te ayudamos.' },
        { status: 503 }
      );
    }
    const admin = createAdminClient();
    const ip = ipDe(req);

    const body = await req.json().catch(() => ({}));
    const entrada = {
      correo: String(body.correo ?? ''),
      cedula: String(body.cedula ?? ''),
      telefono: String(body.telefono ?? ''),
    };
    const correo = limpiarCorreo(entrada.correo);

    // Un formulario a medias no gasta intentos ni ensucia la bitácora:
    // no es alguien probando, es alguien que aún no ha terminado.
    if (faltaAlgo(entrada)) {
      return NextResponse.json(
        { error: 'Escribe tu correo, tu cédula y tu teléfono para continuar.' },
        { status: 400 }
      );
    }

    if (await estaFrenado(admin, correo, ip)) {
      await apuntarIntento(admin, { email: correo, ip, resultado: 'frenado' });
      return NextResponse.json(
        {
          error:
            'Demasiados intentos. Espera una hora y vuelve a probar, o escríbenos por WhatsApp y te ayudamos.',
        },
        { status: 429 }
      );
    }

    const cuenta = await buscarPorCorreo(admin, correo);
    if (!cuenta) {
      await apuntarIntento(admin, { email: correo, ip, resultado: 'sin_cuenta' });
      return NextResponse.json({ error: NO_CUADRA }, { status: 401 });
    }

    const { data: jugador } = await admin
      .from('players')
      .select('id, username, role, blocked, cedula, whatsapp, payout_cedula, payout_phone')
      .eq('id', cuenta.id)
      .maybeSingle();

    if (!jugador) {
      await apuntarIntento(admin, { email: correo, ip, resultado: 'sin_cuenta' });
      return NextResponse.json({ error: NO_CUADRA }, { status: 401 });
    }

    // Las cuentas del equipo NO se recuperan por aquí: son las que
    // pueden aprobar pagos y tocar saldos, y tres datos que van
    // impresos en un comprobante no bastan para eso. Se les cambia a
    // mano desde Supabase.
    if (jugador.role === 'admin' || jugador.role === 'support') {
      await apuntarIntento(admin, { email: correo, playerId: jugador.id, ip, resultado: 'staff' });
      return NextResponse.json({ error: NO_CUADRA }, { status: 401 });
    }

    if (jugador.blocked) {
      await apuntarIntento(admin, { email: correo, playerId: jugador.id, ip, resultado: 'bloqueado' });
      return NextResponse.json({ error: NO_CUADRA }, { status: 401 });
    }

    if (!esLaDuena(entrada, jugador)) {
      await apuntarIntento(admin, { email: correo, playerId: jugador.id, ip, resultado: 'no_coincide' });
      return NextResponse.json({ error: NO_CUADRA }, { status: 401 });
    }

    const permiso = await crearPermiso(admin, jugador.id, ip);
    if (!permiso) {
      return NextResponse.json(
        { error: 'No se pudo continuar. Vuelve a intentarlo en un momento.' },
        { status: 500 }
      );
    }
    await apuntarIntento(admin, { email: correo, playerId: jugador.id, ip, resultado: 'verificado' });

    return NextResponse.json({ ok: true, permiso, nombre: jugador.username ?? null });
  } catch {
    return NextResponse.json({ error: 'Error del servidor' }, { status: 500 });
  }
}
