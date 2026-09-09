import type { SupabaseClient } from '@supabase/supabase-js';
import {
  MAX_PROOF_SIZE,
  PROOF_NOT_IMAGE_MSG,
  PROOF_REQUIRED_MSG,
  PROOF_TOO_BIG_MSG,
} from './constants';

// Comprobante de pago: la captura del Pago Móvil que el jugador
// adjunta al comprar tickets. Vive en el bucket PRIVADO payment-proofs,
// en una carpeta por compra, y el admin lo abre con una URL firmada.
// (Los textos y el tamaño máximo están en constants.ts porque el
// navegador también los usa.)
export const PROOF_BUCKET = 'payment-proofs';

/** Revisa el archivo ANTES de tocar la base: devuelve el motivo o null */
export function checkProofFile(file: unknown): string | null {
  if (!(file instanceof File) || file.size === 0) return PROOF_REQUIRED_MSG;
  if (file.size > MAX_PROOF_SIZE) return PROOF_TOO_BIG_MSG;
  if (!file.type.startsWith('image/')) return PROOF_NOT_IMAGE_MSG;
  return null;
}

/** Sube el comprobante a payment-proofs/<compra>/<archivo> */
export async function uploadProof(
  admin: SupabaseClient,
  purchaseId: string,
  file: File
): Promise<{ ok: boolean; path?: string }> {
  const safeName = (file.name || 'comprobante').replace(/[^\w.\-]+/g, '_').slice(-80);
  const path = `${purchaseId}/${crypto.randomUUID()}_${safeName}`;
  const { error } = await admin.storage
    .from(PROOF_BUCKET)
    .upload(path, Buffer.from(await file.arrayBuffer()), {
      contentType: file.type,
      upsert: false,
    });
  if (error) {
    console.error('proof upload error:', error);
    return { ok: false };
  }
  return { ok: true, path };
}
