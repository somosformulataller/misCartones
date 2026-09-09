import { NextResponse } from 'next/server';
import { createAdminClient, isAdminClientConfigured } from '@/lib/supabase/admin';
import { requireStaff } from '@/lib/admin/guard';

// Conteo de lo que está por atender, para la insignia roja del menú del
// panel y del header: compras y retiros esperando una decisión.
//
// Ligero a propósito — dos conteos con `head: true`, sin traer filas —
// porque lo consulta todo el equipo cada pocos segundos. Si algo falla
// devuelve cero: una insignia de menos molesta mucho menos que un header
// roto.
export async function GET() {
  try {
    const { error } = await requireStaff();
    if (error) return error;

    if (!isAdminClientConfigured()) {
      return NextResponse.json({ tx: 0 });
    }
    const admin = createAdminClient();

    const [compras, retiros] = await Promise.all([
      admin
        .from('ticket_purchases')
        .select('id', { count: 'exact', head: true })
        .in('status', ['pendiente', 'validando']),
      admin
        .from('withdrawals')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pendiente'),
    ]);

    return NextResponse.json({ tx: (compras.count ?? 0) + (retiros.count ?? 0) });
  } catch {
    return NextResponse.json({ tx: 0 });
  }
}
