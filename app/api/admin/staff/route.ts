import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, isAdminClientConfigured } from '@/lib/supabase/admin';
import { requireStaff } from '@/lib/admin/guard';
import { PANEL_AREAS } from '@/lib/admin/areas';

// Equipo del panel (solo rol admin con el área 'equipo'):
// GET  → lista de cuentas admin/support con sus áreas
// POST → crear cuenta, actualizar áreas/rol o eliminarla

const VALID_AREAS = new Set(PANEL_AREAS.map((a) => a.key));

/** Lo que ve una cuenta de atención a la que no se le marcó nada.
 *  `allowedAreas` recorta después lo que support nunca puede ver. */
const SOPORTE_POR_DEFECTO = PANEL_AREAS.map((a) => a.key).filter((a) => a !== 'equipo');

function cleanAreas(input: unknown): string[] | null {
  if (!Array.isArray(input)) return null;
  const areas = input
    .map((a) => String(a).trim().toLowerCase())
    .filter((a) => VALID_AREAS.has(a as (typeof PANEL_AREAS)[number]['key']));
  return areas.length > 0 ? [...new Set(areas)] : null;
}

export async function GET() {
  try {
    const { error } = await requireStaff('equipo');
    if (error) return error;
    if (!isAdminClientConfigured()) {
      return NextResponse.json({ error: 'Falta SUPABASE_SECRET_KEY en el servidor' }, { status: 503 });
    }
    const admin = createAdminClient();

    const { data: rows } = await admin
      .from('players')
      .select('id, username, role, panel_areas, created_at')
      .in('role', ['admin', 'support'])
      .order('created_at', { ascending: true });

    const staff = await Promise.all(
      (rows ?? []).map(async (r) => {
        let email: string | null = null;
        try {
          const { data: u } = await admin.auth.admin.getUserById(r.id);
          email = u?.user?.email ?? null;
        } catch {}
        return { ...r, email };
      })
    );

    return NextResponse.json({ staff });
  } catch {
    return NextResponse.json({ error: 'Error del servidor' }, { status: 500 });
  }
}

interface StaffBody {
  action: 'create' | 'update' | 'delete';
  // create
  email?: string;
  password?: string;
  username?: string;
  // create / update
  role?: 'admin' | 'support';
  areas?: string[];
  // update / delete
  player_id?: string;
}

export async function POST(req: NextRequest) {
  try {
    const { staff: me, error } = await requireStaff('equipo');
    if (error) return error;
    if (!isAdminClientConfigured()) {
      return NextResponse.json({ error: 'Falta SUPABASE_SECRET_KEY en el servidor' }, { status: 503 });
    }

    const body: StaffBody = await req.json();
    const admin = createAdminClient();

    if (body.action === 'create') {
      const email = body.email?.trim().toLowerCase();
      const password = body.password ?? '';
      const username = body.username?.trim();
      const role = body.role === 'admin' ? 'admin' : 'support';
      const areas = cleanAreas(body.areas);

      if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
        return NextResponse.json({ error: 'Escribe un correo válido' }, { status: 400 });
      }
      if (password.length < 8) {
        return NextResponse.json(
          { error: 'La contraseña debe tener al menos 8 caracteres' },
          { status: 400 }
        );
      }
      if (!username) {
        return NextResponse.json({ error: 'Escribe un nombre para la cuenta' }, { status: 400 });
      }
      if (role === 'support' && !areas) {
        return NextResponse.json(
          { error: 'Asigna al menos un área del panel a la cuenta de atención' },
          { status: 400 }
        );
      }

      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { first_name: username },
      });
      if (createError || !created?.user) {
        const msg = createError?.message?.includes('already')
          ? 'Ya existe una cuenta con ese correo'
          : 'No se pudo crear la cuenta';
        return NextResponse.json({ error: msg }, { status: 400 });
      }

      // El trigger de alta ya creó la fila en players: se le asigna
      // el rol y sus áreas (para un admin, NULL = todas). Una cuenta de
      // atención sin áreas marcadas se queda con TODO lo que puede ver:
      // que se le olvide una casilla no debe cerrarle media herramienta
      // de trabajo sin explicación.
      const { error: upError } = await admin
        .from('players')
        .update({ username, role, panel_areas: role === 'admin' ? areas : areas ?? SOPORTE_POR_DEFECTO })
        .eq('id', created.user.id);
      if (upError) {
        await admin.auth.admin.deleteUser(created.user.id).catch(() => {});
        return NextResponse.json(
          { error: 'No se pudo asignar el rol. ¿Ya corriste la migración 004_cuentas_y_dinero.sql?' },
          { status: 400 }
        );
      }
      return NextResponse.json({ ok: true, id: created.user.id });
    }

    // update / delete requieren un objetivo que sea del equipo y
    // distinto de uno mismo (nadie se recorta ni se borra solo).
    const targetId = body.player_id;
    if (!targetId) return NextResponse.json({ error: 'Falta la cuenta' }, { status: 400 });
    if (targetId === me!.userId) {
      return NextResponse.json(
        { error: 'No puedes modificar tu propia cuenta desde aquí' },
        { status: 400 }
      );
    }
    const { data: target } = await admin
      .from('players')
      .select('id, role')
      .eq('id', targetId)
      .maybeSingle();
    if (!target || (target.role !== 'admin' && target.role !== 'support')) {
      return NextResponse.json({ error: 'Cuenta del equipo no encontrada' }, { status: 404 });
    }

    if (body.action === 'update') {
      const role = body.role === 'admin' ? 'admin' : body.role === 'support' ? 'support' : null;
      const areas = cleanAreas(body.areas);
      const patch: Record<string, unknown> = {};
      if (role) patch.role = role;
      // Un admin con areas=null ve todo; support siempre lleva lista
      patch.panel_areas =
        (role ?? target.role) === 'support' ? areas ?? SOPORTE_POR_DEFECTO : areas;
      const { error: upError } = await admin.from('players').update(patch).eq('id', targetId);
      if (upError) return NextResponse.json({ error: 'No se pudo actualizar' }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    if (body.action === 'delete') {
      const { error: delError } = await admin.auth.admin.deleteUser(targetId);
      if (delError) return NextResponse.json({ error: 'No se pudo eliminar la cuenta' }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'Acción inválida' }, { status: 400 });
  } catch {
    return NextResponse.json({ error: 'Error del servidor' }, { status: 500 });
  }
}
