// Lista negra de referencias (migración 019).
//
// Una referencia que se usó para intentar colar un pago que no existe
// no debería servir nunca más. El candado de «una compra pendiente por
// persona» (app/api/purchases/route.ts) frena a quien prueba diez
// seguidas; éste frena a quien vuelve mañana con la misma, y también a
// otro jugador que la copie.
//
// Se guarda y se compara por la COLA DE 6 DÍGITOS, la forma canónica
// con la que empareja el banco: si no, «124754» y «6124754» pasarían
// por distintas siendo el mismo pago.
//
// Bloquear es SIEMPRE decisión de una persona desde el panel. Nada
// aquí se dispara solo: la mayoría de los rechazos son errores
// honestos —un dígito mal copiado— y bloquear esos dejaría al jugador
// sin poder registrar el pago que sí hizo.

import { createAdminClient } from '@/lib/supabase/admin';
import { BlockedReference } from '@/types/game';
import { REFERENCE_TAIL, referenceTail } from './constants';

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Lo que ve el jugador. NO dice «esta referencia está bloqueada»: a
 * quien lo intenta no se le explica cómo funciona la defensa, y a quien
 * llegó aquí por error se le da una salida real.
 */
export const BLOCKED_REFERENCE_MSG =
  'Ese número de referencia no se puede usar para registrar una compra. ' +
  'Si crees que es un error, escríbenos por el chat y lo revisamos.';

/**
 * ¿Está esta referencia en la lista negra?
 *
 * Ante CUALQUIER problema —tabla sin crear, base caída— devuelve
 * `false`, o sea deja pasar la compra. Es a propósito: esta es una
 * defensa secundaria (siguen en pie la detección de repetidas, el
 * emparejamiento contra el banco y el candado de una compra a la vez),
 * y un fallo de base de datos no puede impedirle comprar a quien pagó
 * de verdad.
 */
export async function isReferenceBlocked(admin: Admin, reference: string): Promise<boolean> {
  const cola = referenceTail(reference);
  if (cola.length < REFERENCE_TAIL) return false;
  try {
    const { data, error } = await admin
      .from('blocked_references')
      .select('reference_norm')
      .eq('reference_norm', cola)
      .limit(1);
    if (error) return false;
    return (data?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

/**
 * Mete una referencia en la lista negra. Devuelve false si no se pudo
 * (tabla sin crear, referencia demasiado corta): quien llama ya hizo lo
 * importante —rechazar la compra— y solo tiene que avisar de que el
 * bloqueo no cuajó.
 *
 * Si ya estaba, se deja la anotación original: interesa saber cuándo
 * apareció por primera vez, no la última.
 */
export async function blockReference(
  admin: Admin,
  datos: { reference: string; motivo: string; purchaseId?: string | null; by?: string | null }
): Promise<boolean> {
  const cola = referenceTail(datos.reference);
  if (cola.length < REFERENCE_TAIL) return false;
  try {
    const { error } = await admin.from('blocked_references').upsert(
      {
        reference_norm: cola,
        motivo: datos.motivo.slice(0, 500),
        purchase_id: datos.purchaseId ?? null,
        created_by: datos.by ?? null,
      },
      { onConflict: 'reference_norm', ignoreDuplicates: true }
    );
    return !error;
  } catch {
    return false;
  }
}

/** Saca una referencia de la lista negra (el panel se equivocó) */
export async function unblockReference(admin: Admin, reference: string): Promise<boolean> {
  const cola = referenceTail(reference);
  if (cola.length < REFERENCE_TAIL) return false;
  try {
    const { error } = await admin
      .from('blocked_references')
      .delete()
      .eq('reference_norm', cola);
    return !error;
  } catch {
    return false;
  }
}

/**
 * La lista para el panel, de la más reciente a la más antigua.
 * Devuelve `null` si la tabla todavía no existe: el panel no enseña el
 * bloque y nada se rompe (igual que saludValidacion con la 018).
 */
export async function listBlockedReferences(
  admin: Admin,
  limite = 100
): Promise<BlockedReference[] | null> {
  try {
    const { data, error } = await admin
      .from('blocked_references')
      .select('reference_norm, motivo, created_at, created_by')
      .order('created_at', { ascending: false })
      .limit(limite);
    if (error) return null;
    return (data ?? []) as BlockedReference[];
  } catch {
    return null;
  }
}
