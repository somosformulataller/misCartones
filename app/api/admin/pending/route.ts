import { NextResponse } from 'next/server';
import { createAdminClient, isAdminClientConfigured } from '@/lib/supabase/admin';
import { requireStaff } from '@/lib/admin/guard';

// Conteos de pendientes para las insignias rojas (header y menú del
// panel): pagos/retiros por atender y mensajes de chat sin leer.
// Ligero a propósito: se consulta desde el header de todo el staff.
export async function GET() {
  try {
    const { error } = await requireStaff();
    if (error) return error;

    if (!isAdminClientConfigured()) {
      return NextResponse.json({ tx: 0, chat: 0 });
    }
    const admin = createAdminClient();

    const [purchasesRes, withdrawalsRes, convsRes] = await Promise.all([
      admin
        .from('ticket_purchases')
        .select('id', { count: 'exact', head: true })
        .in('status', ['pendiente', 'validando']),
      admin
        .from('withdrawals')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pendiente'),
      admin
        .from('chat_conversations')
        .select('id, admin_read_at')
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .limit(100),
    ]);

    // Mensajes de jugadores posteriores a la última lectura del equipo
    // (misma regla que la lista de conversaciones del chat del panel)
    let chat = 0;
    const convs = convsRes.data ?? [];
    if (convs.length > 0) {
      const readAt = new Map(convs.map((c) => [c.id, c.admin_read_at as string | null]));
      const { data: msgs } = await admin
        .from('chat_messages')
        .select('conversation_id, created_at')
        .eq('sender', 'player')
        .in(
          'conversation_id',
          convs.map((c) => c.id)
        )
        .order('created_at', { ascending: false })
        .limit(600);
      for (const m of msgs ?? []) {
        const seen = readAt.get(m.conversation_id);
        if (!seen || m.created_at > seen) chat++;
      }
    }

    return NextResponse.json({
      tx: (purchasesRes.count ?? 0) + (withdrawalsRes.count ?? 0),
      chat,
    });
  } catch {
    return NextResponse.json({ tx: 0, chat: 0 });
  }
}
