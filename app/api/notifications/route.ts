import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient, isAdminClientConfigured } from '@/lib/supabase/admin';
import { NOTA_DUPLICADO_JUGADOR, esRechazoPorDuplicado } from '@/lib/payments/constants';

interface NotificationItem {
  id: string;
  icon: string;
  text: string;
  at: string;
}

type NameRel = { username: string | null } | null;

// ── Campana del ADMINISTRADOR: TODO lo que pasa en la app ──
// mensajes del chat, compras (pendientes/aprobadas/rechazadas),
// retiros solicitados/pagados y jugadores nuevos.
async function adminFeed(): Promise<NotificationItem[]> {
  const admin = createAdminClient();
  const [msgsRes, purchasesRes, withdrawalsRes, playersRes] = await Promise.all([
    admin
      .from('chat_messages')
      .select('id, body, attachment_name, created_at, chat_conversations(players(username))')
      .eq('sender', 'player')
      .order('created_at', { ascending: false })
      .limit(15),
    admin
      .from('ticket_purchases')
      // `players!player_id`: desde la migración 022 la tabla apunta a
      // players DOS veces (el comprador y quien la atendió), y sin decir
      // por cuál se une, PostgREST responde 300 y la campana se queda
      // muda.
      .select(
        'id, quantity, reference, status, origin, created_at, validated_at, players!player_id(username)'
      )
      .order('created_at', { ascending: false })
      .limit(15),
    admin
      .from('withdrawals')
      .select('id, amount_usd, status, created_at, paid_at, players!player_id(username)')
      .order('created_at', { ascending: false })
      .limit(10),
    admin
      .from('players')
      .select('id, username, created_at, role')
      .neq('role', 'admin')
      .order('created_at', { ascending: false })
      .limit(8),
  ]);

  const items: NotificationItem[] = [];
  const nameOf = (rel: NameRel) => rel?.username || 'jugador';

  for (const m of msgsRes.data ?? []) {
    const conv = (m as unknown as { chat_conversations?: { players: NameRel } | null })
      .chat_conversations;
    const body = m.body?.trim();
    items.push({
      id: `m-${m.id}`,
      icon: '💬',
      text: `${nameOf(conv?.players ?? null)} escribió en el chat: ${
        body ? `«${body.slice(0, 70)}${body.length > 70 ? '…' : ''}»` : `📎 ${m.attachment_name ?? 'Adjunto'}`
      }`,
      at: m.created_at,
    });
  }

  for (const p of purchasesRes.data ?? []) {
    const name = nameOf((p as unknown as { players?: NameRel }).players ?? null);
    const qty = `${p.quantity} 🎟️`;
    if (p.status === 'aprobado') {
      items.push({
        id: `p-${p.id}`,
        icon: '✅',
        text: `Compra aprobada${p.origin === 'auto' ? ' (automática)' : ''}: ${name} · ${qty} · Ref ${p.reference}`,
        at: p.validated_at ?? p.created_at,
      });
    } else if (p.status === 'rechazado') {
      items.push({
        id: `p-${p.id}`,
        icon: '❌',
        text: `Compra rechazada: ${name} · Ref ${p.reference}`,
        at: p.validated_at ?? p.created_at,
      });
    } else {
      items.push({
        id: `p-${p.id}`,
        icon: '🕒',
        text: `Compra PENDIENTE por revisar: ${name} · ${qty} · Ref ${p.reference}`,
        at: p.created_at,
      });
    }
  }

  for (const w of withdrawalsRes.data ?? []) {
    const name = nameOf((w as unknown as { players?: NameRel }).players ?? null);
    const amount = `$${Number(w.amount_usd).toFixed(2)}`;
    if (w.status === 'pagado') {
      items.push({
        id: `w-${w.id}`,
        icon: '💸',
        text: `Retiro pagado a ${name}: ${amount}`,
        at: w.paid_at ?? w.created_at,
      });
    } else if (w.status === 'cancelado') {
      items.push({
        id: `w-${w.id}`,
        icon: '↩️',
        text: `Retiro de ${name} cancelado (${amount} devueltos a su saldo)`,
        at: w.created_at,
      });
    } else {
      items.push({
        id: `w-${w.id}`,
        icon: '⏳',
        text: `${name} solicitó RETIRAR ${amount} — pendiente de pagar`,
        at: w.created_at,
      });
    }
  }

  for (const p of playersRes.data ?? []) {
    items.push({
      id: `u-${p.id}`,
      icon: '🆕',
      text: `Nuevo jugador registrado: ${p.username || p.id.slice(0, 8)}`,
      at: p.created_at,
    });
  }

  items.sort((a, b) => (a.at < b.at ? 1 : -1));
  return items.slice(0, 25);
}

// Notificaciones derivadas del estado real (sin tabla extra).
// Jugador: sus compras y retiros. Admin: TODO (chat, compras,
// retiros y registros de toda la app).
export async function GET() {
  try {
    const supabase = await createClient();
    if (!supabase) return NextResponse.json({ notifications: [] });
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ notifications: [] });

    // Nota: la campanita YA NO dispara validaciones. Cada usuario
    // conectado lanzaba una consulta al banco cada 60 s y entre todos
    // lo saturaban (429 en bucle). De eso se encarga ahora el cron de
    // conciliación, una vez por minuto para todas las compras.

    // password_reset_at llega con la migración 023. Si aún no está, se
    // repite la consulta sin ella: sin este respaldo, el error tumbaba
    // la fila entera y hasta el administrador se quedaba viendo la
    // campana de un jugador cualquiera.
    const conMarca = await supabase
      .from('players')
      .select('role, password_reset_at')
      .eq('id', user.id)
      .single();
    const me = (
      conMarca.error
        ? (await supabase.from('players').select('role').eq('id', user.id).single()).data
        : conMarca.data
    ) as { role: string | null; password_reset_at?: string | null } | null;

    if (me?.role === 'admin' && isAdminClientConfigured()) {
      return NextResponse.json({ notifications: await adminFeed() });
    }

    const [purchasesRes, withdrawalsRes] = await Promise.all([
      supabase
        .from('ticket_purchases')
        .select('id, quantity, reference, status, status_note, created_at, validated_at')
        .eq('player_id', user.id)
        .order('created_at', { ascending: false })
        .limit(15),
      supabase
        .from('withdrawals')
        .select('id, amount_usd, status, reference, created_at, paid_at')
        .eq('player_id', user.id)
        .order('created_at', { ascending: false })
        .limit(10),
    ]);

    const items: NotificationItem[] = [];

    for (const p of purchasesRes.data ?? []) {
      const refTail = `Ref: ${p.reference}`;
      if (p.status === 'aprobado') {
        items.push({
          id: `p-${p.id}`,
          icon: '✅',
          text: `Pago aprobado: se sumaron ${p.quantity} ticket${p.quantity > 1 ? 's' : ''} a tu cuenta (${refTail}).`,
          at: p.validated_at ?? p.created_at,
        });
      } else if (p.status === 'rechazado' && esRechazoPorDuplicado(p.status_note)) {
        items.push({
          id: `p-${p.id}`,
          icon: '❌',
          text: `Pago rechazado (${refTail}): ${NOTA_DUPLICADO_JUGADOR}`,
          at: p.validated_at ?? p.created_at,
        });
      }
      // El resto NO genera aviso: una compra pendiente, o rechazada
      // por cualquier otro motivo, la resuelve el equipo por dentro
      // (decisión del 15/08). El jugador ve el estado en su billetera;
      // los porqués se los cuenta una persona, no la campanita.
    }

    for (const w of withdrawalsRes.data ?? []) {
      const amount = `$${Number(w.amount_usd).toFixed(2)}`;
      if (w.status === 'pagado') {
        items.push({
          id: `w-${w.id}`,
          icon: '💸',
          text: `¡Retiro pagado! Te enviamos ${amount} por Pago Móvil${w.reference ? ` (Ref: ${w.reference})` : ''}.`,
          at: w.paid_at ?? w.created_at,
        });
      } else if (w.status === 'cancelado') {
        items.push({
          id: `w-${w.id}`,
          icon: '↩️',
          text: `Retiro cancelado: ${amount} volvieron a tu saldo.`,
          at: w.created_at,
        });
      } else {
        items.push({
          id: `w-${w.id}`,
          icon: '⏳',
          text: `Retiro solicitado: ${amount} en proceso (se paga en 15–30 minutos).`,
          at: w.created_at,
        });
      }
    }

    // Aviso de seguridad: se recuperó la contraseña de esta cuenta.
    // Es el aviso que hace que robar una cuenta con la cédula y el
    // teléfono no pase desapercibido — al dueño se le cierra la sesión
    // y, al volver a entrar, se encuentra esto. Se enseña una semana.
    if (me?.password_reset_at) {
      const cuando = new Date(me.password_reset_at as string);
      if (Date.now() - cuando.getTime() < 7 * 86_400_000) {
        items.push({
          id: `sec-${cuando.getTime()}`,
          icon: '🔐',
          text:
            'Se cambió la contraseña de tu cuenta usando "¿Olvidaste tu contraseña?". ' +
            'Si no fuiste tú, escríbenos AHORA por el chat. Por seguridad, los retiros ' +
            'quedan en pausa durante 24 horas.',
          at: me.password_reset_at as string,
        });
      }
    }

    items.sort((a, b) => (a.at < b.at ? 1 : -1));

    return NextResponse.json({ notifications: items.slice(0, 20) });
  } catch {
    return NextResponse.json({ notifications: [] });
  }
}
