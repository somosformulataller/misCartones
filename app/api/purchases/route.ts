import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient, isAdminClientConfigured } from '@/lib/supabase/admin';
import { BLOCKED_MESSAGE, isBlocked } from '@/lib/supabase/blocked';
import { fetchExchangeRateSafe } from '@/lib/payments/exchangeRate';
import { tryAutoValidatePurchase } from '@/lib/payments/validatePurchase';
import { checkProofFile, uploadProof } from '@/lib/payments/proof';
import { BLOCKED_REFERENCE_MSG, isReferenceBlocked } from '@/lib/payments/blocklist';
import {
  notaDuplicado,
  MAX_TICKETS_PER_PURCHASE,
  TICKET_PRICE_USD,
  amountTolerance,
  compraParaJugador,
  referenceTail,
} from '@/lib/payments/constants';
import {
  isOcrConfigured,
  leerComprobanteCacheado,
  OCR_ERROR_MSG,
  OCR_ILEGIBLE_MSG,
  type DatosOcr,
} from '@/lib/payments/ocr';
import { ORIGEN_MARCADOR, ORIGIN_RULE_ENABLED } from '@/lib/payments/constants';
import {
  comparar,
  huellaDe,
  identidadPrimerPago,
  MOTIVO_TEXTO,
  ORIGEN_MSG_JUGADOR,
  type Huella,
} from '@/lib/payments/origen';

// Historial de compras del jugador (RLS: solo las suyas)
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

    const { data: purchases } = await supabase
      .from('ticket_purchases')
      .select(
        'id, player_id, quantity, amount_usd, amount_ves, exchange_rate_used, reference, status, origin, status_note, created_at, validated_at'
      )
      // Propietario explícito además de RLS (defensa en profundidad)
      .eq('player_id', user.id)
      .order('created_at', { ascending: false })
      .limit(25);

    // Sin notas internas: al jugador solo le llega la de duplicado
    return NextResponse.json({ purchases: (purchases ?? []).map(compraParaJugador) });
  } catch {
    return NextResponse.json({ error: 'Error del servidor' }, { status: 500 });
  }
}

// Registrar una solicitud de compra de tickets (Pago Móvil) y
// validarla automáticamente contra la API del banco. El monto se
// calcula SIEMPRE en el servidor (no se confía en el navegador).
//
// La petición llega como FormData porque el COMPROBANTE es obligatorio
// y viaja con ella: si la imagen no se puede guardar, la compra se
// borra y no queda registrada. Antes se subía aparte y "a ciegas", así
// que un fallo al subirla dejaba la compra sin nada que verificar.
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
      return NextResponse.json(
        { error: 'El sistema de pagos no está configurado todavía.' },
        { status: 503 }
      );
    }

    // Una versión vieja de la app (pestaña sin recargar desde antes del
    // 18/08/2026) manda JSON sin comprobante: se rechaza en vez de crear
    // una compra que nadie puede verificar.
    //
    // `stale` es la señal para que la app se actualice sola. El mensaje
    // de antes decía «si no ves el botón para adjuntarla, recarga»: a
    // quien le pasó esto SÍ veía el botón y SÍ había adjuntado su
    // captura —la app vieja la subía aparte—, así que leyó que no había
    // adjuntado algo que tenía delante. El problema nunca fue la
    // captura: era la versión.
    if (!(req.headers.get('content-type') ?? '').includes('multipart/form-data')) {
      return NextResponse.json(
        {
          error:
            'Tu app está desactualizada y por eso tu comprobante no llegó. Recárgala y vuelve a enviar el pago.',
          stale: true,
        },
        { status: 400 }
      );
    }

    const form = await req.formData();
    const quantity = Math.trunc(Number(form.get('quantity')));
    const file = form.get('file');

    if (!Number.isFinite(quantity) || quantity < 1 || quantity > MAX_TICKETS_PER_PURCHASE) {
      return NextResponse.json({ error: 'Cantidad inválida' }, { status: 400 });
    }
    // El comprobante se revisa ANTES de tocar la base
    const proofError = checkProofFile(file);
    if (proofError) {
      return NextResponse.json({ error: proofError }, { status: 400 });
    }

    // Jugador bloqueado: no puede comprar tickets
    if (await isBlocked(supabase, user.id)) {
      return NextResponse.json({ error: BLOCKED_MESSAGE }, { status: 403 });
    }

    // ── La referencia sale del comprobante, no del formulario ──
    //
    // El jugador ya no la escribe: la lee el OCR de la captura. Se
    // vuelve a leer AQUÍ aunque la pantalla ya la haya enseñado, porque
    // una referencia que venga del navegador no es de fiar — es el dato
    // con el que se reclama dinero en el banco. Sale de la caché (misma
    // imagen, mismo jugador), así que no se paga dos veces.
    //
    // Si no se puede leer NO se crea la compra: una compra sin
    // referencia no hay forma de cruzarla con el estado de cuenta y se
    // quedaría muerta esperando a que alguien la mire.
    if (!isOcrConfigured()) {
      return NextResponse.json({ error: OCR_ERROR_MSG }, { status: 503 });
    }
    const imagen = file as File;
    const lectura = await leerComprobanteCacheado(user.id, await imagen.arrayBuffer(), imagen.name);
    if (lectura.estado === 'ilegible') {
      return NextResponse.json({ error: OCR_ILEGIBLE_MSG, ilegible: true }, { status: 400 });
    }
    if (lectura.estado === 'error') {
      return NextResponse.json({ error: OCR_ERROR_MSG }, { status: 502 });
    }
    const ocr: DatosOcr = lectura.datos;
    const reference = ocr.reference;

    const rate = await fetchExchangeRateSafe();
    const amountUsd = Math.round(quantity * TICKET_PRICE_USD * 100) / 100;
    const amountVes = rate ? Math.round(amountUsd * rate.rate * 100) / 100 : null;

    const admin = createAdminClient();

    // Lista negra: una referencia que ya se usó para intentar colar un
    // pago inexistente no vale nunca más, ni de este jugador ni de
    // otro. Se compara por la cola de 6 dígitos (migración 019). El
    // candado de "una compra a la vez" que hay debajo frena a quien
    // prueba varias seguidas; éste frena a quien vuelve al día
    // siguiente con la misma.
    if (await isReferenceBlocked(admin, reference)) {
      return NextResponse.json({ error: BLOCKED_REFERENCE_MSG }, { status: 403 });
    }

    // Una compra a la vez: mientras el jugador tenga una en
    // verificación no puede registrar otra (primero se resuelve esa
    // desde el panel y después podrá volver a comprar).
    const { data: pendingOwn } = await admin
      .from('ticket_purchases')
      .select('id')
      .eq('player_id', user.id)
      .in('status', ['pendiente', 'validando'])
      .limit(1);
    if ((pendingOwn?.length ?? 0) > 0) {
      return NextResponse.json(
        {
          error:
            'Ya tienes una compra en proceso de verificación. Podrás comprar más tickets cuando se confirme.',
        },
        { status: 409 }
      );
    }

    // ¿Referencia repetida? Cada número es único por banco, pero
    // entre bancos distintos puede coincidir: la compra se registra
    // igual, queda pendiente con nota de anomalía para el admin, y
    // la validación automática no la toca (revisión 100% manual).
    //
    // Se compara por los ÚLTIMOS 6 DÍGITOS, que es como empareja el
    // banco. Comparando el texto tal cual, «124754» y «6124754» pasan
    // por distintas siendo el mismo pago: ocurrió el 15/08/2026 y las
    // dos compras se aprobaron. El `like` cubre las filas viejas por si
    // la migración 015 (reference_norm por la cola) no se ha corrido.
    const norm = referenceTail(reference);
    const { data: dups } = await admin
      .from('ticket_purchases')
      .select('id, status, created_at')
      .or(`reference_norm.eq.${norm},reference.like.*${norm}`)
      .neq('status', 'rechazado')
      .limit(5);

    const isDuplicate = (dups?.length ?? 0) > 0;
    const dupNote = isDuplicate ? notaDuplicado(dups!) : null;

    // ¿El comprobante dice menos de lo que cuesta la compra? Se sabe
    // AQUÍ, comparando lo que leyó el OCR con el precio del momento, en
    // vez de descubrirlo días después cuadrando cuentas a mano. No
    // bloquea nada: el pago existe, solo es insuficiente, y quien
    // decide qué hacer es el equipo.
    const faltanBs =
      amountVes !== null && ocr.amount !== null && ocr.amount < amountVes - amountTolerance(amountVes)
        ? Math.round((amountVes - ocr.amount) * 100) / 100
        : null;

    // ── ¿Paga desde donde siempre? ──
    //
    // Se decide AQUÍ, antes de crear la compra, para no tocar nada de
    // la validación: si el origen cambió, la compra nace 'pendiente' y
    // se responde sin llamar al banco — el mismo camino que ya usan las
    // referencias repetidas (más abajo).
    //
    // No se rechaza nunca por esto: lo mira una persona desde el panel,
    // que puede aprobarlo o recordarle al jugador que pague siempre
    // desde la misma cuenta.
    const actual = huellaDe(ocr);
    let origenNota: string | null = null;
    let huellaGuardada: Huella | null = null;

    if (ORIGIN_RULE_ENABLED) {
      const { data: fila } = await admin
        .from('player_payment_origins')
        .select('banco, ancla_tipo, ancla, muestra')
        .eq('player_id', user.id)
        .maybeSingle();

      // Sus datos de registro: la cédula sirve para el cruce de Ubii y
      // los teléfonos para el cruce de identidad del primer pago.
      const { data: yo } = await admin
        .from('players')
        .select('cedula, whatsapp, payout_phone')
        .eq('id', user.id)
        .single();
      const reg = yo as { cedula?: string; whatsapp?: string; payout_phone?: string } | null;
      const cedulaJugador = reg?.cedula ?? null;

      let v;
      if (fila) {
        // Ya paga desde un sitio conocido: se exige CONSISTENCIA (mismo
        // origen que la huella).
        huellaGuardada = fila as Huella;
        v = comparar(huellaGuardada, actual, { esUbii: ocr.is_ubii, cedulaJugador });
      } else {
        // Primer pago: no hay huella con qué comparar, pero SÍ tenemos sus
        // datos de registro. Se exige IDENTIDAD: el comprobante debe venir
        // de un dato suyo (su teléfono, o su cédula si es Ubii). Así el que
        // paga con los datos de otra persona cae a manual desde el primer
        // pago, en vez de sembrar la huella con datos de un tercero.
        v = identidadPrimerPago(
          actual,
          { esUbii: ocr.is_ubii, origin_cedula: ocr.origin_cedula, origin: ocr.origin },
          { cedula: cedulaJugador, telefonos: [reg?.whatsapp, reg?.payout_phone] }
        );
      }
      if (!v.ok) {
        origenNota = `${ORIGEN_MARCADOR} · ${MOTIVO_TEXTO[v.motivo]}. ${v.detalle}`;
      }
    }

    const { data: purchase, error: insertError } = await admin
      .from('ticket_purchases')
      .insert({
        player_id: user.id,
        quantity,
        amount_usd: amountUsd,
        amount_ves: amountVes,
        exchange_rate_used: rate?.rate ?? null,
        reference,
        // Lo que leyó el OCR, en columnas propias. NUNCA dentro de
        // bank_response: `approve_purchase` reescribe ese jsonb al
        // acreditar y se llevaría estos datos por delante.
        ocr_reference: ocr.reference,
        ocr_full_reference: ocr.full_reference,
        ocr_amount: ocr.amount,
        ocr_bank: ocr.bank,
        ocr_origin: ocr.origin,
        ocr_origin_type: ocr.origin_type,
        ocr_origin_bank: ocr.origin_bank,
        ocr_origin_cedula: ocr.origin_cedula,
        ocr_is_ubii: ocr.is_ubii,
        ocr_confidence: ocr.confidence,
        ocr_raw: ocr.raw,
        ocr_at: new Date().toISOString(),
        // Repetida, origen distinto, o las dos: en cualquier caso nace
        // pendiente y con las dos notas, que son cosas distintas y el
        // equipo necesita ver ambas.
        ...(dupNote || origenNota
          ? {
              status: 'pendiente',
              status_note: [dupNote, origenNota].filter(Boolean).join(' · '),
            }
          : {}),
      })
      .select('id')
      .single();

    if (insertError || !purchase) {
      if (insertError?.code === '23505') {
        // Índice único todavía activo (migración 004 sin correr)
        return NextResponse.json(
          { error: 'Ese número de referencia ya fue usado en otra compra.' },
          { status: 409 }
        );
      }
      console.error('purchase insert error:', insertError);
      return NextResponse.json({ error: 'No se pudo registrar la compra' }, { status: 500 });
    }

    // Sin comprobante guardado no hay compra: si la subida falla se
    // borra la fila recién creada (todavía no se validó ni se
    // acreditaron tickets) y el jugador puede reintentar.
    const uploaded = await uploadProof(admin, purchase.id, file as File);
    if (!uploaded.ok) {
      await admin.from('ticket_purchases').delete().eq('id', purchase.id);
      return NextResponse.json(
        { error: 'No se pudo guardar tu comprobante. Revisa tu conexión e inténtalo de nuevo.' },
        { status: 502 }
      );
    }

    // Primer pago del jugador con un origen legible: queda fijado como
    // «su» cuenta. A partir de aquí solo la mueve el equipo a propósito
    // desde el panel — aprobar un pago suelto NO la cambia, o la regla
    // se vaciaría de sentido (cada cambio de banco quedaría bendecido).
    //
    // Pero NO se siembra si ese primer pago no pasó el cruce de identidad
    // (`origenNota`): quedaría anclado a los datos de un tercero, y a
    // partir de ahí «lo suyo» sería la cuenta ajena. Si el equipo lo
    // aprueba desde el panel, lo fija a mano con «Fijar esta como la suya».
    if (ORIGIN_RULE_ENABLED && !huellaGuardada && !origenNota && (actual.ancla || actual.banco)) {
      const { error: eHuella } = await admin.from('player_payment_origins').insert({
        player_id: user.id,
        banco: actual.banco,
        ancla_tipo: actual.ancla_tipo,
        ancla: actual.ancla,
        muestra: actual.muestra,
        motivo: 'Primer pago del jugador',
      });
      // Que falle no puede tumbar una compra: se queda sin huella y la
      // fijará el siguiente pago.
      if (eHuella && eHuella.code !== '23505') {
        console.error('no se pudo fijar la huella de origen:', eHuella);
      }
    }

    // Huella «solo-banco» (sembrada del histórico sin cuenta, o de un
    // pago antiguo que no exponía al pagador): el primer pago legible
    // del MISMO banco la AFINA a la cuenta real. No cambia el banco ni
    // pisa un ancla ya puesta — solo rellena el dato que faltaba, así
    // que respeta la regla «aprobar un pago suelto no mueve la huella».
    // Con esto, el jugador viejo cuya huella quedó gruesa pasa a tener
    // su cuenta habitual fijada sola, sin intervención del equipo.
    if (
      ORIGIN_RULE_ENABLED &&
      huellaGuardada &&
      !huellaGuardada.ancla &&
      !origenNota &&
      actual.ancla &&
      (!huellaGuardada.banco || !actual.banco || huellaGuardada.banco === actual.banco)
    ) {
      const { error: eAfinar } = await admin
        .from('player_payment_origins')
        .update({
          banco: actual.banco ?? huellaGuardada.banco,
          ancla_tipo: actual.ancla_tipo,
          ancla: actual.ancla,
          muestra: actual.muestra,
          motivo: 'Afinada sola con un pago legible del mismo banco',
        })
        .eq('player_id', user.id);
      if (eAfinar) console.error('no se pudo afinar la huella de origen:', eAfinar);
    }

    // Origen distinto: se responde AQUÍ, sin llamar al banco. Mismo
    // camino que la referencia repetida.
    if (origenNota) {
      return NextResponse.json({
        purchase_id: purchase.id,
        status: 'pendiente',
        tickets: null,
        reason: ORIGEN_MSG_JUGADOR,
        amount_usd: amountUsd,
        amount_ves: amountVes,
        faltan_bs: faltanBs,
      });
    }

    if (isDuplicate) {
      return NextResponse.json({
        purchase_id: purchase.id,
        status: 'pendiente',
        tickets: null,
        duplicate: true,
        reason:
          'Ese número de referencia ya se usó en otra compra. Tu solicitud quedó en revisión: si pagaste desde un banco distinto, un administrador la verificará y aprobará.',
        amount_usd: amountUsd,
        amount_ves: amountVes,
        faltan_bs: faltanBs,
      });
    }

    const result = await tryAutoValidatePurchase(purchase.id);

    return NextResponse.json({
      purchase_id: purchase.id,
      status: result.status,
      tickets: result.tickets ?? null,
      reason: result.reason ?? null,
      amount_usd: amountUsd,
      amount_ves: amountVes,
      // Aviso, no rechazo: el pago llegó pero no cubre la compra.
      faltan_bs: faltanBs,
    });
  } catch (err) {
    console.error('purchases POST error:', err);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}
