import type { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

type Admin = ReturnType<typeof createAdminClient>;

/** IP del cliente (Vercel la pone en x-forwarded-for). */
export function ipDe(req: NextRequest): string {
  const cab = req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? '';
  return cab.split(',')[0]?.trim().slice(0, 64) || 'desconocida';
}

/**
 * Límite de tasa genérico respaldado por la BD (tabla rate_limit_hits,
 * migración 026). Cuenta cuántos golpes hubo en la ventana para
 * (bucket, actor); si llegó al límite devuelve true (frenar). Si no,
 * apunta este golpe y devuelve false (dejar pasar).
 *
 * FALLA ABIERTO: si la tabla no existe todavía o la consulta falla, no
 * frena a nadie — un problema de infraestructura no puede dejar a la
 * gente sin poder registrarse o retirar. La defensa de fondo sigue
 * estando en las otras validaciones.
 *
 * @param actor  IP (registro) o id del jugador (retiro).
 * @param limit  golpes permitidos dentro de la ventana.
 * @param windowMs  tamaño de la ventana en milisegundos.
 */
export async function rateLimited(
  admin: Admin,
  bucket: string,
  actor: string,
  limit: number,
  windowMs: number
): Promise<boolean> {
  const desde = new Date(Date.now() - windowMs).toISOString();
  try {
    const { count } = await admin
      .from('rate_limit_hits')
      .select('id', { count: 'exact', head: true })
      .eq('bucket', bucket)
      .eq('actor', actor)
      .gte('created_at', desde);
    if ((count ?? 0) >= limit) return true;
    await admin.from('rate_limit_hits').insert({ bucket, actor });
    return false;
  } catch {
    return false; // falla abierto
  }
}
