import type { SupabaseClient } from '@supabase/supabase-js';

export const BLOCKED_MESSAGE =
  'Tu cuenta está bloqueada. Escríbenos por el chat de atención al cliente.';

// Mensaje que ve el usuario bloqueado al intentar INICIAR SESIÓN.
// Distinto de BLOCKED_MESSAGE (ese sale cuando ya está dentro y hace
// una acción de dinero): en el login le decimos, sin rodeos, por qué
// no puede entrar.
export const SUSPENDED_LOGIN_MESSAGE =
  'CUENTA SUSPENDIDA: Esta cuenta fue bloqueada porque se detectaron movimientos inusuales que parecen ser un posible fraude.';

// ¿Está bloqueado el jugador? Tolerante a que la migración 006 no
// haya corrido aún (si la columna no existe, nadie está bloqueado).
export async function isBlocked(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('players')
      .select('blocked')
      .eq('id', userId)
      .single();
    if (error) return false;
    return (data as { blocked?: boolean } | null)?.blocked === true;
  } catch {
    return false;
  }
}
