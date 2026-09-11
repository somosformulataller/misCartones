import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient, isAdminClientConfigured } from '@/lib/supabase/admin';
import { ChatMessage } from '@/types/chat';

// Chat del JUGADOR: su única conversación con soporte.
// GET  → conversación + mensajes + preguntas rápidas + no leídos.
//        Con ?read=1 marca como leído (al abrir el panel).
// POST → envía un mensaje como 'player' (texto y/o adjunto ya subido).
// Las escrituras van por el cliente admin: el remitente no se puede
// falsificar y el cliente no tiene permisos de escritura en las tablas.

export async function GET(req: NextRequest) {
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

    const [convRes, questionsRes] = await Promise.all([
      supabase.from('chat_conversations').select('*').eq('player_id', user.id).maybeSingle(),
      supabase
        .from('chat_quick_questions')
        .select('id, question, active, position')
        .eq('active', true)
        .order('position', { ascending: true }),
    ]);

    const conversation = convRes.data ?? null;
    let messages: ChatMessage[] = [];
    let unread = 0;

    if (conversation) {
      const { data } = await supabase
        .from('chat_messages')
        .select('*')
        .eq('conversation_id', conversation.id)
        .order('created_at', { ascending: true })
        .limit(300);
      messages = (data ?? []) as ChatMessage[];

      const readAt = conversation.player_read_at;
      unread = messages.filter(
        (m) => m.sender === 'support' && (!readAt || m.created_at > readAt)
      ).length;

      // Abrir el chat pone el contador en cero
      if (req.nextUrl.searchParams.get('read') === '1' && unread > 0 && isAdminClientConfigured()) {
        await createAdminClient()
          .from('chat_conversations')
          .update({ player_read_at: new Date().toISOString() })
          .eq('id', conversation.id);
      }
    }

    return NextResponse.json({
      conversation,
      messages,
      quickQuestions: questionsRes.data ?? [],
      unread,
    });
  } catch {
    return NextResponse.json({ error: 'Error del servidor' }, { status: 500 });
  }
}

interface SendBody {
  text?: string;
  attachment?: { path: string; name: string; type: string };
}

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

    const body: SendBody = await req.json();
    const text = body.text?.trim().slice(0, 2000) || null;
    const attachment = body.attachment ?? null;
    if (!text && !attachment) {
      return NextResponse.json({ error: 'Escribe un mensaje' }, { status: 400 });
    }
    // Los adjuntos viven en la carpeta del jugador dueño del chat
    if (attachment && !attachment.path.startsWith(`${user.id}/`)) {
      return NextResponse.json({ error: 'Adjunto inválido' }, { status: 400 });
    }

    const admin = createAdminClient();

    // Conversación única del jugador (se crea con el primer mensaje)
    let { data: conversation } = await admin
      .from('chat_conversations')
      .select('*')
      .eq('player_id', user.id)
      .maybeSingle();

    if (!conversation) {
      const { data: created, error: convError } = await admin
        .from('chat_conversations')
        .upsert({ player_id: user.id }, { onConflict: 'player_id' })
        .select('*')
        .single();
      if (convError || !created) {
        return NextResponse.json({ error: 'No se pudo abrir la conversación' }, { status: 500 });
      }
      conversation = created;
    }

    const { data: message, error: msgError } = await admin
      .from('chat_messages')
      .insert({
        conversation_id: conversation.id,
        sender: 'player',
        body: text,
        attachment_path: attachment?.path ?? null,
        attachment_name: attachment?.name ?? null,
        attachment_type: attachment?.type ?? null,
      })
      .select('*')
      .single();
    if (msgError || !message) {
      return NextResponse.json({ error: 'No se pudo enviar el mensaje' }, { status: 500 });
    }

    // Si estaba "resuelto", un mensaje nuevo del jugador lo reabre
    const now = new Date().toISOString();
    await admin
      .from('chat_conversations')
      .update({
        last_message_at: now,
        player_read_at: now,
        ...(conversation.status === 'resuelto' ? { status: 'pendiente' } : {}),
      })
      .eq('id', conversation.id);

    return NextResponse.json({ message });
  } catch {
    return NextResponse.json({ error: 'Error del servidor' }, { status: 500 });
  }
}
