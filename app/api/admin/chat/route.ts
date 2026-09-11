import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, isAdminClientConfigured } from '@/lib/supabase/admin';
import { AdminChatListItem, ChatConversationStatus, ChatMessage } from '@/types/chat';
import { requireStaff } from '@/lib/admin/guard';
import { loadTagsFor } from '@/lib/admin/tags';
import { loadNamesFor, nombreDe } from '@/lib/admin/staffNames';
import { cargarCorreosCacheado } from '@/lib/admin/emails';
import { digitosDeBusqueda } from '@/lib/admin/busqueda';

const STATUSES: ChatConversationStatus[] = ['pendiente', 'prioridad', 'resuelto'];

// El chat lo atiende cualquier miembro del staff con el área 'chat'
// (admins y atención al cliente).
async function requireAdmin() {
  return requireStaff('chat');
}

// El mapa id → correo vive en lib/admin/emails.ts (lo comparten esta
// ruta y la de usuarios). Antes aquí se pedía UNA sola página de 1000
// y las cuentas más antiguas salían sin correo en la lista del chat:
// justo las de la gente que lleva más tiempo escribiendo.
const loadEmailMap = cargarCorreosCacheado;

/** El avance del último mensaje. Cuando lo escribió el equipo se
 *  antepone QUIÉN: con varias personas atendiendo, «Tú:» era mentira
 *  la mitad de las veces. Sin firma (mensajes anteriores a la
 *  migración 022) se dice «Equipo». */
function preview(
  m: (Pick<ChatMessage, 'sender' | 'body' | 'attachment_path'> & { sender_name?: string | null })
    | undefined
): string {
  if (!m) return 'Conversación nueva';
  const text = m.body?.trim() || (m.attachment_path ? '📎 Adjunto' : '');
  return m.sender === 'support' ? `${m.sender_name || 'Equipo'}: ${text}` : text;
}

// Chat de atención al cliente (ADMIN).
// GET               → lista de conversaciones + preguntas rápidas
// GET ?conversation → hilo completo (y lo marca como leído)
// GET ?q=texto      → buscador de jugadores para iniciar un chat
export async function GET(req: NextRequest) {
  try {
    const { error } = await requireAdmin();
    if (error) return error;
    if (!isAdminClientConfigured()) {
      return NextResponse.json({ error: 'Falta SUPABASE_SECRET_KEY en el servidor' }, { status: 503 });
    }
    const admin = createAdminClient();
    const params = req.nextUrl.searchParams;

    // ── Buscador de jugadores (nombre, correo o cédula) ──
    // Se filtra en la BASE DE DATOS, no en memoria. Antes se traían 500
    // jugadores SIN orden y se filtraban en JS: con 1755 cuentas, las
    // ~1255 que quedaban fuera del lote no aparecían nunca, buscara uno
    // por nombre, correo o cédula (visto el 02/09 buscando a la cuenta de
    // prueba). Se persigue en toda la tabla, igual que el panel de usuarios.
    const q = params.get('q')?.trim();
    if (q !== null && q !== undefined) {
      if (q.length < 2) return NextResponse.json({ results: [] });
      const needle = q.toLowerCase();
      // Las comas y los paréntesis separan el filtro `or` de PostgREST:
      // crudos, rompen la consulta.
      const limpio = q.replace(/[,()*\\%]/g, ' ').trim();
      // Los dígitos solo se persiguen si lo escrito ES un número (si no,
      // un correo con año dentro devolvería media base).
      const digitos = digitosDeBusqueda(q);

      const trozos: string[] = [];
      const campos = ['username', 'first_name', 'last_name', 'payout_name', 'cedula', 'payout_cedula'];
      if (limpio) for (const c of campos) trozos.push(`${c}.ilike.*${limpio}*`);
      if (digitos && digitos !== limpio) {
        for (const c of ['cedula', 'payout_cedula', 'whatsapp', 'payout_phone']) {
          trozos.push(`${c}.ilike.*${digitos}*`);
        }
      }

      const emails = await loadEmailMap(admin);
      // El correo no está en `players`: vive en el registro de acceso.
      const idsPorCorreo = [...emails.entries()]
        .filter(([, correo]) => correo.toLowerCase().includes(needle))
        .map(([id]) => id)
        .slice(0, 50);

      const encontrados = new Map<string, { id: string; username: string | null }>();
      const sumar = (rows: { id: string; username: string | null }[] | null) => {
        for (const p of rows ?? []) encontrados.set(p.id, { id: p.id, username: p.username });
      };
      if (trozos.length) {
        const { data } = await admin
          .from('players')
          .select('id, username')
          .eq('role', 'player')
          .or(trozos.join(','))
          .limit(30);
        sumar(data);
      }
      if (idsPorCorreo.length) {
        const { data } = await admin
          .from('players')
          .select('id, username')
          .eq('role', 'player')
          .in('id', idsPorCorreo)
          .limit(30);
        sumar(data);
      }
      const results = [...encontrados.values()]
        .slice(0, 15)
        .map((p) => ({ id: p.id, username: p.username, email: emails.get(p.id) ?? null }));
      return NextResponse.json({ results });
    }

    // ── Hilo de una conversación ──
    const conversationId = params.get('conversation');
    if (conversationId) {
      const { data: conv } = await admin
        .from('chat_conversations')
        .select('*, players(username, tickets)')
        .eq('id', conversationId)
        .maybeSingle();
      if (!conv) return NextResponse.json({ error: 'Conversación no encontrada' }, { status: 404 });

      const [msgsRes, emails, tagsMap] = await Promise.all([
        admin
          .from('chat_messages')
          .select('*')
          .eq('conversation_id', conversationId)
          .order('created_at', { ascending: true })
          .limit(300),
        loadEmailMap(admin),
        loadTagsFor(admin, [conv.player_id]),
      ]);

      // Abrir el hilo lo marca como leído para el admin
      await admin
        .from('chat_conversations')
        .update({ admin_read_at: new Date().toISOString() })
        .eq('id', conversationId);

      // Quién del equipo escribió cada respuesta (migración 022). Los
      // mensajes anteriores a la migración no tienen firma y salen sin
      // nombre, como siempre salieron.
      const mensajes = (msgsRes.data ?? []) as (ChatMessage & { sender_id?: string | null })[];
      const nombres = await loadNamesFor(
        admin,
        mensajes.map((m) => m.sender_id)
      );

      const players = (conv as { players?: { username: string | null; tickets: number } | null })
        .players;
      return NextResponse.json({
        conversation: {
          id: conv.id,
          player_id: conv.player_id,
          status: conv.status,
          username: players?.username ?? null,
          email: emails.get(conv.player_id) ?? null,
          tickets: players?.tickets ?? 0,
          tags: tagsMap.get(conv.player_id) ?? [],
        },
        messages: mensajes.map((m) => ({
          ...m,
          sender_name: m.sender === 'support' ? nombreDe(nombres, m.sender_id) : null,
        })),
      });
    }

    // ── Lista de conversaciones + preguntas rápidas + respuestas rápidas ──
    // Si la tabla de respuestas rápidas aún no existe (migración 033 sin
    // correr), su consulta resuelve con error y data null: el chat sigue
    // funcionando, solo llega `replies: []`.
    const [convsRes, questionsRes, repliesRes, emails] = await Promise.all([
      admin
        .from('chat_conversations')
        .select('*, players(username, tickets)')
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .limit(100),
      admin
        .from('chat_quick_questions')
        .select('id, question, active, position')
        .order('position', { ascending: true }),
      admin
        .from('chat_quick_replies')
        .select('id, shortcut, title, body')
        .order('shortcut', { ascending: true }),
      loadEmailMap(admin),
    ]);

    const convs = convsRes.data ?? [];
    const ids = convs.map((c) => c.id);

    // Último mensaje y no leídos de cada conversación en una sola consulta
    type UltimoMsg = Pick<ChatMessage, 'sender' | 'body' | 'attachment_path'> & {
      sender_id?: string | null;
      sender_name?: string | null;
    };
    const lastByConv = new Map<string, UltimoMsg>();
    const unreadByConv = new Map<string, number>();
    if (ids.length > 0) {
      // sender_id llega con la migración 022; sin ella se lee igual,
      // solo que el avance no dirá quién contestó.
      const leer = (cols: string) =>
        admin
          .from('chat_messages')
          .select(cols)
          .in('conversation_id', ids)
          .order('created_at', { ascending: false })
          .limit(600);
      const conFirma = await leer(
        'conversation_id, sender, sender_id, body, attachment_path, created_at'
      );
      const res = conFirma.error
        ? await leer('conversation_id, sender, body, attachment_path, created_at')
        : conFirma;
      const msgs = (res.data ?? []) as unknown as (UltimoMsg & {
        conversation_id: string;
        created_at: string;
      })[];

      const readAt = new Map(convs.map((c) => [c.id, c.admin_read_at as string | null]));
      for (const m of msgs) {
        if (!lastByConv.has(m.conversation_id)) lastByConv.set(m.conversation_id, m);
        if (m.sender === 'player') {
          const seen = readAt.get(m.conversation_id);
          if (!seen || m.created_at > seen) {
            unreadByConv.set(m.conversation_id, (unreadByConv.get(m.conversation_id) ?? 0) + 1);
          }
        }
      }

      // Nombres de quienes escribieron esos últimos mensajes
      const nombres = await loadNamesFor(
        admin,
        [...lastByConv.values()].map((m) => m.sender_id)
      );
      for (const m of lastByConv.values()) m.sender_name = nombreDe(nombres, m.sender_id);
    }

    // Etiquetas internas de los jugadores con conversación abierta:
    // se ven en la propia lista, sin tener que entrar al chat
    const tagsMap = await loadTagsFor(admin, convs.map((c) => c.player_id));

    const conversations: AdminChatListItem[] = convs.map((c) => {
      const players = (c as { players?: { username: string | null; tickets: number } | null })
        .players;
      return {
        id: c.id,
        player_id: c.player_id,
        status: c.status,
        last_message_at: c.last_message_at,
        username: players?.username ?? null,
        email: emails.get(c.player_id) ?? null,
        tickets: players?.tickets ?? 0,
        unread: unreadByConv.get(c.id) ?? 0,
        preview: preview(lastByConv.get(c.id)),
        tags: tagsMap.get(c.player_id) ?? [],
      };
    });

    return NextResponse.json({
      conversations,
      questions: questionsRes.data ?? [],
      replies: repliesRes.data ?? [],
    });
  } catch {
    return NextResponse.json({ error: 'Error del servidor' }, { status: 500 });
  }
}

interface ActionBody {
  action:
    | 'send'
    | 'edit_message'
    | 'delete_message'
    | 'delete_conversation'
    | 'set_status'
    | 'mark_read'
    | 'start'
    | 'question_add'
    | 'question_toggle'
    | 'question_delete'
    | 'reply_save'
    | 'reply_delete';
  conversation_id?: string;
  message_id?: string;
  player_id?: string;
  text?: string;
  attachment?: { path: string; name: string; type: string };
  status?: ChatConversationStatus;
  id?: string;
  question?: string;
  active?: boolean;
  // Respuestas rápidas del staff (reply_save). `body` aquí es el CUERPO
  // de la respuesta, no el body del request.
  shortcut?: number;
  title?: string;
  body?: string;
}

export async function POST(req: NextRequest) {
  try {
    const { staff, error } = await requireAdmin();
    if (error) return error;
    if (!isAdminClientConfigured()) {
      return NextResponse.json({ error: 'Falta SUPABASE_SECRET_KEY en el servidor' }, { status: 503 });
    }
    const admin = createAdminClient();
    const body: ActionBody = await req.json();

    if (body.action === 'send') {
      const text = body.text?.trim().slice(0, 2000) || null;
      const attachment = body.attachment ?? null;
      if (!body.conversation_id) {
        return NextResponse.json({ error: 'Falta la conversación' }, { status: 400 });
      }
      if (!text && !attachment) {
        return NextResponse.json({ error: 'Escribe un mensaje' }, { status: 400 });
      }
      // sender_id (migración 022) deja firmado qué persona del equipo
      // respondió. Si la columna todavía no existe se manda el mensaje
      // igual, sin firma: nadie se queda sin poder contestar por una
      // migración pendiente.
      const fila = {
        conversation_id: body.conversation_id,
        sender: 'support',
        body: text,
        attachment_path: attachment?.path ?? null,
        attachment_name: attachment?.name ?? null,
        attachment_type: attachment?.type ?? null,
      };
      let { data: message, error: msgError } = await admin
        .from('chat_messages')
        .insert({ ...fila, sender_id: staff?.userId ?? null })
        .select('*')
        .single();
      if (msgError) {
        const reintento = await admin.from('chat_messages').insert(fila).select('*').single();
        message = reintento.data;
        msgError = reintento.error;
      }
      if (msgError || !message) {
        return NextResponse.json({ error: 'No se pudo enviar el mensaje' }, { status: 500 });
      }
      const now = new Date().toISOString();
      await admin
        .from('chat_conversations')
        .update({ last_message_at: now, admin_read_at: now })
        .eq('id', body.conversation_id);
      return NextResponse.json({ message });
    }

    // Corregir un mensaje YA ENVIADO. Solo los de soporte: reescribir
    // lo que dijo el jugador falsearía la conversación (y con ella
    // cualquier reclamo). Para eso está delete_message.
    if (body.action === 'edit_message') {
      const text = body.text?.trim().slice(0, 2000);
      if (!body.message_id) return NextResponse.json({ error: 'Falta el mensaje' }, { status: 400 });
      if (!text) return NextResponse.json({ error: 'El mensaje no puede quedar vacío' }, { status: 400 });

      const { data: target } = await admin
        .from('chat_messages')
        .select('id, sender, conversation_id')
        .eq('id', body.message_id)
        .maybeSingle();
      if (!target) return NextResponse.json({ error: 'Mensaje no encontrado' }, { status: 404 });
      if (target.sender !== 'support') {
        return NextResponse.json(
          { error: 'Solo puedes editar los mensajes de soporte. Los del jugador solo se eliminan.' },
          { status: 400 }
        );
      }

      // edited_at llega con la migración 014; sin ella se guarda el
      // texto igual, solo sin la marca de "editado"
      let { data: message, error: editError } = await admin
        .from('chat_messages')
        .update({ body: text, edited_at: new Date().toISOString() })
        .eq('id', body.message_id)
        .select('*')
        .single();
      if (editError) {
        const retry = await admin
          .from('chat_messages')
          .update({ body: text })
          .eq('id', body.message_id)
          .select('*')
          .single();
        message = retry.data;
        editError = retry.error;
      }
      if (editError || !message) {
        return NextResponse.json({ error: 'No se pudo editar el mensaje' }, { status: 500 });
      }
      return NextResponse.json({ message });
    }

    // Eliminar UN mensaje (de cualquiera de los dos lados): borra la
    // fila y su adjunto del bucket, y recalcula la fecha del último
    // mensaje para que la lista siga ordenada como corresponde.
    if (body.action === 'delete_message') {
      if (!body.message_id) return NextResponse.json({ error: 'Falta el mensaje' }, { status: 400 });

      const { data: target } = await admin
        .from('chat_messages')
        .select('id, conversation_id, attachment_path')
        .eq('id', body.message_id)
        .maybeSingle();
      if (!target) return NextResponse.json({ error: 'Mensaje no encontrado' }, { status: 404 });

      const { error: delError } = await admin
        .from('chat_messages')
        .delete()
        .eq('id', body.message_id);
      if (delError) {
        return NextResponse.json({ error: 'No se pudo eliminar el mensaje' }, { status: 500 });
      }
      if (target.attachment_path) {
        try {
          await admin.storage.from('chat-attachments').remove([target.attachment_path]);
        } catch {}
      }

      const { data: last } = await admin
        .from('chat_messages')
        .select('created_at')
        .eq('conversation_id', target.conversation_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      await admin
        .from('chat_conversations')
        .update({ last_message_at: last?.created_at ?? null })
        .eq('id', target.conversation_id);

      return NextResponse.json({ ok: true });
    }

    // Eliminar la CONVERSACIÓN completa (mensajes en cascada +
    // adjuntos). Es irreversible: solo el rol admin, no soporte.
    if (body.action === 'delete_conversation') {
      if (!body.conversation_id) {
        return NextResponse.json({ error: 'Falta la conversación' }, { status: 400 });
      }
      if (!staff?.isFullAdmin) {
        return NextResponse.json(
          { error: 'Solo un administrador puede eliminar una conversación completa' },
          { status: 403 }
        );
      }

      const { data: msgs } = await admin
        .from('chat_messages')
        .select('attachment_path')
        .eq('conversation_id', body.conversation_id)
        .not('attachment_path', 'is', null)
        .limit(500);
      const paths = (msgs ?? [])
        .map((m) => m.attachment_path as string)
        .filter(Boolean);
      if (paths.length > 0) {
        try {
          await admin.storage.from('chat-attachments').remove(paths);
        } catch {}
      }

      // chat_messages cae en cascada con la conversación (migración 005)
      const { error: delError } = await admin
        .from('chat_conversations')
        .delete()
        .eq('id', body.conversation_id);
      if (delError) {
        return NextResponse.json({ error: 'No se pudo eliminar la conversación' }, { status: 500 });
      }
      return NextResponse.json({ ok: true });
    }

    if (body.action === 'set_status') {
      if (!body.conversation_id || !body.status || !STATUSES.includes(body.status)) {
        return NextResponse.json({ error: 'Etiqueta inválida' }, { status: 400 });
      }
      await admin
        .from('chat_conversations')
        .update({ status: body.status })
        .eq('id', body.conversation_id);
      return NextResponse.json({ ok: true });
    }

    if (body.action === 'mark_read') {
      if (!body.conversation_id) {
        return NextResponse.json({ error: 'Falta la conversación' }, { status: 400 });
      }
      await admin
        .from('chat_conversations')
        .update({ admin_read_at: new Date().toISOString() })
        .eq('id', body.conversation_id);
      return NextResponse.json({ ok: true });
    }

    // Iniciar (o reabrir) una conversación con un jugador.
    // NO envía ningún mensaje: la campana del jugador se enciende
    // recién cuando el admin escribe el primero.
    if (body.action === 'start') {
      if (!body.player_id) {
        return NextResponse.json({ error: 'Falta el jugador' }, { status: 400 });
      }
      const { data: target } = await admin
        .from('players')
        .select('id, role')
        .eq('id', body.player_id)
        .maybeSingle();
      if (!target || target.role !== 'player') {
        return NextResponse.json({ error: 'Jugador no encontrado' }, { status: 404 });
      }
      const { data: conv, error: convError } = await admin
        .from('chat_conversations')
        .upsert({ player_id: body.player_id }, { onConflict: 'player_id' })
        .select('id')
        .single();
      if (convError || !conv) {
        return NextResponse.json({ error: 'No se pudo crear la conversación' }, { status: 500 });
      }
      return NextResponse.json({ conversation_id: conv.id });
    }

    if (body.action === 'question_add') {
      const question = body.question?.trim().slice(0, 200);
      if (!question) return NextResponse.json({ error: 'Escribe la pregunta' }, { status: 400 });
      const { data: maxRow } = await admin
        .from('chat_quick_questions')
        .select('position')
        .order('position', { ascending: false })
        .limit(1)
        .maybeSingle();
      const { error: qError } = await admin
        .from('chat_quick_questions')
        .insert({ question, position: (maxRow?.position ?? 0) + 1 });
      if (qError) return NextResponse.json({ error: 'No se pudo agregar' }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    if (body.action === 'question_toggle') {
      if (!body.id) return NextResponse.json({ error: 'Falta el id' }, { status: 400 });
      await admin
        .from('chat_quick_questions')
        .update({ active: body.active === true })
        .eq('id', body.id);
      return NextResponse.json({ ok: true });
    }

    if (body.action === 'question_delete') {
      if (!body.id) return NextResponse.json({ error: 'Falta el id' }, { status: 400 });
      await admin.from('chat_quick_questions').delete().eq('id', body.id);
      return NextResponse.json({ ok: true });
    }

    // Respuestas rápidas del staff: crear (sin id) o editar (con id). El
    // atajo es un número único; si choca con otro, el 23505 se traduce a
    // un aviso claro en vez de un 500 seco.
    if (body.action === 'reply_save') {
      const shortcut = Number(body.shortcut);
      const replyBody = body.body?.trim().slice(0, 2000);
      const title = body.title?.trim().slice(0, 60) || null;
      if (!Number.isInteger(shortcut) || shortcut < 1 || shortcut > 99999) {
        return NextResponse.json({ error: 'El atajo debe ser un número (1 a 99999)' }, { status: 400 });
      }
      if (!replyBody) {
        return NextResponse.json({ error: 'Escribe la respuesta' }, { status: 400 });
      }
      const fila = { shortcut, title, body: replyBody };
      const { error: saveError } = body.id
        ? await admin
            .from('chat_quick_replies')
            .update({ ...fila, updated_at: new Date().toISOString() })
            .eq('id', body.id)
        : await admin.from('chat_quick_replies').insert(fila);
      if (saveError) {
        if (saveError.code === '23505') {
          return NextResponse.json({ error: 'Ya existe una respuesta con ese atajo' }, { status: 409 });
        }
        return NextResponse.json({ error: 'No se pudo guardar la respuesta' }, { status: 500 });
      }
      return NextResponse.json({ ok: true });
    }

    if (body.action === 'reply_delete') {
      if (!body.id) return NextResponse.json({ error: 'Falta el id' }, { status: 400 });
      await admin.from('chat_quick_replies').delete().eq('id', body.id);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'Acción inválida' }, { status: 400 });
  } catch {
    return NextResponse.json({ error: 'Error del servidor' }, { status: 500 });
  }
}
