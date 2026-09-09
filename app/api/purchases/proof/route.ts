import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient, isAdminClientConfigured } from '@/lib/supabase/admin';
import { checkProofFile, uploadProof } from '@/lib/payments/proof';

// Añadir (o reemplazar) el comprobante de una compra que YA existe.
// El comprobante obligatorio de una compra nueva viaja con ella en
// POST /api/purchases; esto queda para reintentos sobre una compra ya
// registrada. El archivo va al bucket PRIVADO payment-proofs y el
// admin lo abre desde el panel con una URL firmada.
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
      return NextResponse.json({ error: 'No configurado' }, { status: 503 });
    }

    const form = await req.formData();
    const file = form.get('file');
    const purchaseId = String(form.get('purchase_id') ?? '');
    if (!purchaseId) {
      return NextResponse.json({ error: 'Faltan datos' }, { status: 400 });
    }
    const proofError = checkProofFile(file);
    if (proofError) {
      return NextResponse.json({ error: proofError }, { status: 400 });
    }

    // La compra debe existir y ser del propio jugador (lectura con RLS)
    const { data: purchase } = await supabase
      .from('ticket_purchases')
      .select('id, player_id')
      .eq('id', purchaseId)
      .eq('player_id', user.id)
      .single();
    if (!purchase) {
      return NextResponse.json({ error: 'Compra no encontrada' }, { status: 404 });
    }

    const uploaded = await uploadProof(createAdminClient(), purchaseId, file as File);
    if (!uploaded.ok) {
      return NextResponse.json({ error: 'No se pudo subir la imagen' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, path: uploaded.path });
  } catch {
    return NextResponse.json({ error: 'Error del servidor' }, { status: 500 });
  }
}
