import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { hasArea, isStaffRole, PanelArea, StaffRole } from '@/lib/admin/areas';

export interface StaffContext {
  userId: string;
  role: StaffRole;
  panelAreas: string[] | null;
  /** true solo para el rol admin (support nunca) */
  isFullAdmin: boolean;
}

interface GuardResult {
  staff: StaffContext | null;
  error: NextResponse | null;
}

// Guard común de las APIs del panel: exige sesión de staff (admin o
// atención al cliente) y, si se indica, que su lista de áreas incluya
// al menos una de las pedidas. El rol y las áreas viven en players y
// solo se editan con la clave del servidor (área Equipo).
//
// El rol se lee con la SESIÓN del que pide, no con la clave del
// servidor: así una fila de players que RLS no le deja ver tampoco le
// abre el panel. Es la puerta; lo de dentro ya lee con la clave del
// servidor porque tiene que sumar sobre todos los jugadores.
export async function requireStaff(area?: PanelArea | PanelArea[]): Promise<GuardResult> {
  const supabase = await createClient();
  if (!supabase) {
    return {
      staff: null,
      error: NextResponse.json(
        { error: 'El sistema no está configurado todavía.', code: 'SIN_CONFIGURAR' },
        { status: 503 }
      ),
    };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { staff: null, error: NextResponse.json({ error: 'No autenticado' }, { status: 401 }) };
  }

  const { data: me } = await supabase
    .from('players')
    .select('role, panel_areas')
    .eq('id', user.id)
    .maybeSingle();

  if (!isStaffRole(me?.role)) {
    return { staff: null, error: NextResponse.json({ error: 'Acceso denegado' }, { status: 403 }) };
  }

  const panelAreas = (me?.panel_areas as string[] | null) ?? null;
  if (area && !hasArea(me?.role, panelAreas, area)) {
    return {
      staff: null,
      error: NextResponse.json({ error: 'No tienes acceso a esta área del panel' }, { status: 403 }),
    };
  }

  return {
    staff: {
      userId: user.id,
      role: me!.role as StaffRole,
      panelAreas,
      isFullAdmin: me!.role === 'admin',
    },
    error: null,
  };
}
