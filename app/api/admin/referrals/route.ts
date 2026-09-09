import { NextResponse } from 'next/server';
import { createAdminClient, isAdminClientConfigured } from '@/lib/supabase/admin';
import { requireStaff } from '@/lib/admin/guard';

// Estadísticas de referidos para el panel (área 'referidos').
//
// Todo el cálculo pesado (partidas por referido, ganado y pendiente por
// referidor) lo hace el RPC admin_referral_overview de la migración 005
// en la base: aquí solo se comprueba que quien pide es staff con acceso
// al área y se llama al RPC con la clave de servicio.
export async function GET() {
  try {
    const { error } = await requireStaff('referidos');
    if (error) return error;

    if (!isAdminClientConfigured()) {
      return NextResponse.json(
        { error: 'Falta SUPABASE_SECRET_KEY en el servidor' },
        { status: 503 }
      );
    }

    const admin = createAdminClient();
    const { data, error: rpcError } = await admin.rpc('admin_referral_overview');
    if (rpcError) {
      return NextResponse.json(
        { error: 'No se pudo cargar Referidos. ¿Ya corriste la migración 005_panel_admin.sql?' },
        { status: 400 }
      );
    }

    return NextResponse.json(data ?? { summary: null, referrers: [] });
  } catch {
    return NextResponse.json({ error: 'Error del servidor' }, { status: 500 });
  }
}
