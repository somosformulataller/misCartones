import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, isAdminClientConfigured } from '@/lib/supabase/admin';
import { requireStaff } from '@/lib/admin/guard';
import { loadSuggestions, MAX_LABEL, MAX_NOTE, TAG_COLORS } from '@/lib/admin/tags';
import { PlayerTag, PlayerTagColor } from '@/types/game';

// Etiquetas y notas internas sobre un jugador (migración 004).
// Las escribe cualquier miembro del staff: son anotaciones de
// atención al cliente ("testimonio pedido", "cliente fastidioso"…),
// NO tocan dinero ni la cuenta, y el jugador nunca las ve.
//
// GET  ?player_id= → { tags, suggestions }
// POST { action: 'add' | 'update' | 'delete', … }

const MISSING_TABLE =
  'Faltan las etiquetas en la base de datos. Corre la migración 004_cuentas_y_dinero.sql en Supabase.';

function isMissingTable(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  return error.code === '42P01' || /player_tags/i.test(error.message ?? '');
}

export async function GET(req: NextRequest) {
  try {
    const { error } = await requireStaff();
    if (error) return error;
    if (!isAdminClientConfigured()) {
      return NextResponse.json({ error: 'Falta SUPABASE_SECRET_KEY en el servidor' }, { status: 503 });
    }
    const playerId = req.nextUrl.searchParams.get('player_id');
    if (!playerId) return NextResponse.json({ error: 'Falta el jugador' }, { status: 400 });

    const admin = createAdminClient();
    const { data, error: tagsError } = await admin
      .from('player_tags')
      .select('*')
      .eq('player_id', playerId)
      .order('created_at', { ascending: true });
    if (tagsError) {
      // Sin la tabla, la ficha sigue abriendo: solo avisa
      if (isMissingTable(tagsError)) {
        return NextResponse.json({ tags: [], suggestions: [], warning: MISSING_TABLE });
      }
      return NextResponse.json({ error: 'No se pudieron cargar las etiquetas' }, { status: 500 });
    }
    const tags = (data ?? []) as PlayerTag[];
    const suggestions = await loadSuggestions(
      admin,
      tags.map((t) => t.label)
    );
    return NextResponse.json({ tags, suggestions });
  } catch {
    return NextResponse.json({ error: 'Error del servidor' }, { status: 500 });
  }
}

interface TagBody {
  action: 'add' | 'update' | 'delete';
  id?: string;
  player_id?: string;
  label?: string;
  note?: string | null;
  color?: PlayerTagColor;
}

function cleanColor(color: unknown): PlayerTagColor {
  return TAG_COLORS.includes(color as PlayerTagColor) ? (color as PlayerTagColor) : 'neutral';
}

export async function POST(req: NextRequest) {
  try {
    const { staff, error } = await requireStaff();
    if (error) return error;
    if (!isAdminClientConfigured()) {
      return NextResponse.json({ error: 'Falta SUPABASE_SECRET_KEY en el servidor' }, { status: 503 });
    }
    const admin = createAdminClient();
    const body: TagBody = await req.json();

    if (body.action === 'add') {
      const label = body.label?.trim().slice(0, MAX_LABEL);
      if (!body.player_id) return NextResponse.json({ error: 'Falta el jugador' }, { status: 400 });
      if (!label) return NextResponse.json({ error: 'Escribe la etiqueta' }, { status: 400 });

      const { data, error: insertError } = await admin
        .from('player_tags')
        .insert({
          player_id: body.player_id,
          label,
          note: body.note?.trim().slice(0, MAX_NOTE) || null,
          color: cleanColor(body.color),
          created_by: staff?.userId ?? null,
        })
        .select('*')
        .single();

      if (insertError) {
        if (isMissingTable(insertError)) {
          return NextResponse.json({ error: MISSING_TABLE }, { status: 503 });
        }
        // Índice único (player_id, lower(label))
        if (insertError.code === '23505') {
          return NextResponse.json({ error: 'Ese usuario ya tiene esa etiqueta' }, { status: 400 });
        }
        return NextResponse.json({ error: 'No se pudo guardar la etiqueta' }, { status: 500 });
      }
      return NextResponse.json({ tag: data });
    }

    if (body.action === 'update') {
      if (!body.id) return NextResponse.json({ error: 'Falta la etiqueta' }, { status: 400 });
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (body.label !== undefined) {
        const label = body.label.trim().slice(0, MAX_LABEL);
        if (!label) return NextResponse.json({ error: 'Escribe la etiqueta' }, { status: 400 });
        patch.label = label;
      }
      if (body.note !== undefined) {
        patch.note = body.note?.trim().slice(0, MAX_NOTE) || null;
      }
      if (body.color !== undefined) patch.color = cleanColor(body.color);

      const { data, error: upError } = await admin
        .from('player_tags')
        .update(patch)
        .eq('id', body.id)
        .select('*')
        .single();
      if (upError) {
        if (isMissingTable(upError)) {
          return NextResponse.json({ error: MISSING_TABLE }, { status: 503 });
        }
        if (upError.code === '23505') {
          return NextResponse.json({ error: 'Ese usuario ya tiene esa etiqueta' }, { status: 400 });
        }
        return NextResponse.json({ error: 'No se pudo actualizar la etiqueta' }, { status: 500 });
      }
      return NextResponse.json({ tag: data });
    }

    if (body.action === 'delete') {
      if (!body.id) return NextResponse.json({ error: 'Falta la etiqueta' }, { status: 400 });
      const { error: delError } = await admin.from('player_tags').delete().eq('id', body.id);
      if (delError) {
        if (isMissingTable(delError)) {
          return NextResponse.json({ error: MISSING_TABLE }, { status: 503 });
        }
        return NextResponse.json({ error: 'No se pudo eliminar la etiqueta' }, { status: 500 });
      }
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'Acción inválida' }, { status: 400 });
  } catch {
    return NextResponse.json({ error: 'Error del servidor' }, { status: 500 });
  }
}
