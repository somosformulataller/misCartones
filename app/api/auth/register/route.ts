import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, isAdminClientConfigured } from '@/lib/supabase/admin';
import { WHATSAPP_MSG, isWhatsappValid, normalizeWhatsapp } from '@/lib/auth/whatsapp';
import { ipDe, rateLimited } from '@/lib/security/rateLimit';

interface RegisterBody {
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  whatsapp: string;
  cedula: string;
  accepted: boolean;
  /** Código del afiliado que lo invitó (llega en el link ?ref=) */
  ref?: string;
}

// Registro SIN confirmación de email: el servidor crea la cuenta ya
// confirmada (email_confirm) y el cliente inicia sesión de inmediato.
// El trigger handle_new_user copia los datos al perfil del jugador.
export async function POST(req: NextRequest) {
  try {
    if (!isAdminClientConfigured()) {
      return NextResponse.json({ error: 'El registro no está configurado' }, { status: 503 });
    }

    const admin = createAdminClient();

    // Límite de tasa por IP: frena la creación masiva de cuentas. Es
    // generoso (12/hora) para no molestar a un cibercafé o una casa con
    // varias personas; solo corta la automatización. Falla abierto.
    const ip = ipDe(req);
    if (await rateLimited(admin, 'register', ip, 12, 3_600_000)) {
      return NextResponse.json(
        { error: 'Demasiados registros desde esta conexión. Espera un momento e inténtalo de nuevo.' },
        { status: 429 }
      );
    }

    const body: RegisterBody = await req.json();
    const email = String(body.email ?? '').trim().toLowerCase();
    const password = String(body.password ?? '');
    const firstName = String(body.first_name ?? '').trim();
    const lastName = String(body.last_name ?? '').trim();
    const whatsapp = String(body.whatsapp ?? '').trim();
    const cedula = String(body.cedula ?? '').trim();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'Escribe un correo válido' }, { status: 400 });
    }
    if (password.length < 6) {
      return NextResponse.json(
        { error: 'La contraseña debe tener al menos 6 caracteres.' },
        { status: 400 }
      );
    }
    if (!firstName || !lastName) {
      return NextResponse.json({ error: 'Escribe tu nombre y apellido' }, { status: 400 });
    }
    // El WhatsApp se guarda ya normalizado a sus 11 dígitos, así todas
    // las cuentas quedan con el mismo formato y el número sirve para
    // escribirle al jugador.
    const whatsappNorm = normalizeWhatsapp(whatsapp);
    if (!isWhatsappValid(whatsapp)) {
      return NextResponse.json({ error: WHATSAPP_MSG }, { status: 400 });
    }
    // La cédula se compara por sus dígitos: "V-12.345.678" y
    // "12345678" son la misma persona.
    const cedulaNorm = cedula.replace(/\D/g, '');
    if (cedula.length > 15 || cedulaNorm.length < 5) {
      return NextResponse.json({ error: 'Escribe una cédula válida' }, { status: 400 });
    }
    // Ninguna cédula empieza en cero: si lo permitiéramos, "05002573"
    // y "5002573" entrarían como dos personas distintas y se saltarían
    // el "una cédula, una cuenta".
    if (cedulaNorm.startsWith('0')) {
      return NextResponse.json(
        { error: 'La cédula no puede empezar con cero: escríbela sin el 0 de la izquierda.' },
        { status: 400 }
      );
    }
    if (body.accepted !== true) {
      return NextResponse.json(
        { error: 'Debes aceptar los términos y condiciones para registrarte.' },
        { status: 400 }
      );
    }

    // La cédula y el teléfono son ÚNICOS: una persona, una cuenta.
    // (La base también lo exige con índices únicos — migraciones 011
    // y 013 — por si dos registros llegan al mismo tiempo.) El
    // teléfono se compara por sus últimos 10 dígitos, así
    // "04121234567" y "+584121234567" cuentan como el mismo número.
    const phoneNorm = whatsappNorm.slice(-10);
    const { data: existing } = await admin
      .from('players')
      .select('cedula, whatsapp')
      .limit(10000);
    const cedulaTaken = (existing ?? []).some(
      (p) => (p.cedula ?? '').replace(/\D/g, '') === cedulaNorm
    );
    if (cedulaTaken) {
      return NextResponse.json(
        {
          error:
            'Ya existe un usuario registrado con esta cédula. Cada persona puede tener una sola cuenta; si es la tuya y no recuerdas el acceso, escríbenos por el chat de atención.',
        },
        { status: 409 }
      );
    }
    const phoneTaken = (existing ?? []).some((p) => {
      const digits = (p.whatsapp ?? '').replace(/\D/g, '');
      return digits !== '' && digits.slice(-10) === phoneNorm;
    });
    if (phoneTaken) {
      return NextResponse.json(
        {
          error:
            'Ya existe un usuario registrado con este número de teléfono. Cada persona puede tener una sola cuenta; si es la tuya y no recuerdas el acceso, escríbenos por el chat de atención.',
        },
        { status: 409 }
      );
    }
    const { error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // cuenta confirmada: entra sin revisar el correo
      user_metadata: {
        first_name: firstName,
        last_name: lastName,
        whatsapp: whatsappNorm,
        cedula,
        accepted_terms: 'true',
        // El trigger handle_new_user (migración 027) lo convierte en
        // referred_by. Si el código no existe, se ignora: nadie se
        // queda sin cuenta por un link mal copiado.
        ref: String(body.ref ?? '').trim().toUpperCase().slice(0, 12) || undefined,
      },
    });

    if (error) {
      const msg = error.message ?? '';
      if (msg.includes('already') || error.code === 'email_exists') {
        return NextResponse.json({ error: 'Este email ya está registrado.' }, { status: 409 });
      }
      // Carrera contra otro registro con la misma cédula o el mismo
      // teléfono: el índice único de la base rechaza el alta (el
      // trigger falla).
      if (msg.toLowerCase().includes('duplicate') || msg.toLowerCase().includes('unique')) {
        return NextResponse.json(
          { error: 'Ya existe un usuario registrado con esta cédula o este teléfono.' },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: 'No se pudo crear la cuenta' }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Error del servidor' }, { status: 500 });
  }
}
