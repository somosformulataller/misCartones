import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { checkProofFile } from '@/lib/payments/proof';
import {
  isOcrConfigured,
  leerComprobanteCacheado,
  OCR_ERROR_MSG,
  OCR_ILEGIBLE_MSG,
} from '@/lib/payments/ocr';
import { BLOCKED_MESSAGE, isBlocked } from '@/lib/supabase/blocked';

// Lee la captura del pago EN CUANTO el jugador la adjunta, antes de
// enviar la compra. Así el análisis (2,6 s de mediana) corre mientras
// sigue mirando la pantalla, y llega al botón con la referencia ya
// puesta.
//
// Lo importante es que si la foto no se lee se entera AQUÍ, sin haber
// mandado nada: solo tiene que elegir otra imagen. Si esto se hiciera
// al enviar, tendría que empezar la compra de cero.
//
// NO crea ninguna compra ni toca la validación. La referencia que se
// devuelve es para enseñársela; el servidor la vuelve a leer por su
// cuenta al registrar la compra (de la caché, sin pagar otra vez).
//
// La clave del servicio se queda en el servidor: el navegador nunca la
// ve. Y hace falta sesión iniciada porque cada lectura cuesta dinero.
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

    if (!isOcrConfigured()) {
      // Sin clave no se puede leer nada. Se responde `error` (no
      // `ilegible`): la foto del jugador no tiene la culpa.
      return NextResponse.json({ estado: 'error', error: OCR_ERROR_MSG });
    }

    if (await isBlocked(supabase, user.id)) {
      return NextResponse.json({ error: BLOCKED_MESSAGE }, { status: 403 });
    }

    const form = await req.formData();
    const file = form.get('file');
    const proofError = checkProofFile(file);
    if (proofError) return NextResponse.json({ error: proofError }, { status: 400 });

    const imagen = file as File;
    const bytes = await imagen.arrayBuffer();
    const r = await leerComprobanteCacheado(user.id, bytes, imagen.name);

    if (r.estado === 'ilegible') {
      return NextResponse.json({ estado: 'ilegible', error: OCR_ILEGIBLE_MSG });
    }
    if (r.estado === 'error') {
      return NextResponse.json({ estado: 'error', error: OCR_ERROR_MSG });
    }

    // Solo lo que hace falta para la pantalla. El origen y la cédula NO
    // viajan al navegador: son para el panel y la regla de origen, y no
    // pintan nada en la pantalla del jugador.
    return NextResponse.json({
      estado: 'leido',
      reference: r.datos.reference,
      full_reference: r.datos.full_reference,
      amount: r.datos.amount,
      bank: r.datos.bank,
    });
  } catch (err) {
    console.error('purchases/ocr POST error:', err);
    return NextResponse.json({ estado: 'error', error: OCR_ERROR_MSG });
  }
}
