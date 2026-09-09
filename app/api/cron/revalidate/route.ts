import { NextRequest, NextResponse, after } from 'next/server';
import { cuentaConfigurada } from '@/lib/payments/bankApi';
import { conciliarPendientes } from '@/lib/payments/conciliar';
import {
  BANK_ACCOUNT_NAME_ESPERADO,
  BANK_SHADOW_MODE,
  BANK_VALIDATION_ENABLED,
} from '@/lib/payments/constants';

// Cron EXTERNO (cron-job.org): CADA MINUTO concilia las compras
// pendientes contra el estado de cuenta del banco. Una sola entrada al
// banco por pasada, resuelva 1 o 40 pagos (ver lib/payments/conciliar).
// Autenticación: header "Authorization: Bearer CRON_SECRET" o
// "?key=CRON_SECRET". La URL con el secreto está en credenciales.md.
//
// Con ?informe=1 responde ESPERANDO el resultado y lo devuelve: es la
// forma de leer el modo sombra ("esto habría aprobado"). Sin él
// responde al instante y trabaja después (after()), porque el latido
// al banco tarda hasta un minuto y cron-job.org corta a los 30 s.

// Cuánto puede durar la pasada antes de que la plataforma la corte.
//
// El trabajo de after() sigue vivo después de responder, pero dentro
// de ESTE presupuesto. Sin declararlo, el corte llegaba donde la
// plataforma quisiera, y una pasada medida el 16/08/2026 tardó 61 s
// (scrapeo de 90 s de tope + reclamo + acreditación).
//
// El momento peligroso es el hueco entre reclamar el movimiento en el
// banco (set_used=true) y acreditar los tickets: si el corte cae ahí,
// el pago queda quemado y el jugador sin tickets, y ninguna pasada
// futura lo recupera porque emparejar() descarta los `used`. Con 120 s
// hay sitio de sobra para las dos cosas.
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  // Fallar CERRADO: sin secreto configurado NO se autoriza a nadie. Con
  // `!secret || …` un despliegue al que le falte la variable dejaba que
  // cualquiera sin autenticar disparara la conciliación (aprobar
  // compras, acreditar tickets) y leyera la config del banco con
  // ?informe=1. Ausencia de secreto = puerta cerrada, no abierta.
  if (!secret) {
    return NextResponse.json({ error: 'Validación no configurada' }, { status: 503 });
  }
  const authorized =
    req.headers.get('authorization') === `Bearer ${secret}` ||
    req.nextUrl.searchParams.get('key') === secret;
  if (!authorized) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  if (req.nextUrl.searchParams.get('informe')) {
    const informe = await conciliarPendientes().catch((e) => ({
      ok: false,
      motivo: e instanceof Error ? e.message : 'error',
    }));
    // Diagnóstico de configuración: la cuenta que se está mirando y si
    // es la que debe ser. Sirve para comprobar que la variable de
    // Vercel quedó bien puesta sin tener que leer su valor.
    const cuenta = cuentaConfigurada();
    return NextResponse.json({
      encendida: BANK_VALIDATION_ENABLED,
      sombra: BANK_SHADOW_MODE,
      cuenta,
      cuenta_esperada: BANK_ACCOUNT_NAME_ESPERADO,
      cuenta_correcta: cuenta === BANK_ACCOUNT_NAME_ESPERADO,
      ...informe,
    });
  }

  after(() => conciliarPendientes().catch(() => {}));
  return NextResponse.json({ ok: true, scheduled: true, sombra: BANK_SHADOW_MODE });
}
