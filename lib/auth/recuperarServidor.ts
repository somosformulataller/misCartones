import { createHash, randomBytes } from 'node:crypto';
import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  LIMITE_POR_CORREO,
  LIMITE_POR_IP,
  MINUTOS_PERMISO,
} from '@/lib/auth/recuperar';

// La parte de la recuperación que sí toca la base: la bitácora, el
// freno por intentos y los permisos de un solo uso (migración 023).
//
// Todo lo de aquí corre SOLO en el servidor y con la clave de
// servicio: desde el navegador no se puede ni leer la bitácora ni
// fabricar un permiso.

type Admin = ReturnType<typeof createAdminClient>;

export type Resultado =
  | 'verificado'
  | 'no_coincide'
  | 'sin_cuenta'
  | 'staff'
  | 'bloqueado'
  | 'frenado'
  | 'cambiada';

/** De dónde viene la petición. Vercel la pone en x-forwarded-for. */
export function ipDe(req: NextRequest): string | null {
  const cabecera = req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip');
  // Puede venir «cliente, proxy1, proxy2»: la primera es la del cliente
  return cabecera?.split(',')[0]?.trim().slice(0, 64) || null;
}

/**
 * Deja constancia del intento. Nunca lanza: perder una línea de
 * bitácora no puede tumbar la recuperación de nadie — pero sí se
 * escribe ANTES de responder, para que un ataque no pueda evitarla
 * cortando la conexión a mitad.
 */
export async function apuntarIntento(
  admin: Admin,
  datos: { email: string; playerId?: string | null; ip?: string | null; resultado: Resultado }
): Promise<void> {
  try {
    await admin.from('password_reset_attempts').insert({
      email: datos.email.slice(0, 200),
      player_id: datos.playerId ?? null,
      ip: datos.ip ?? null,
      resultado: datos.resultado,
    });
  } catch {}
}

/**
 * ¿Se pasó de intentos en la última hora?
 *
 * Se cuenta por correo y por IP a la vez: lo primero frena a quien
 * prueba cédulas contra una misma víctima, lo segundo a quien barre
 * muchas cuentas desde el mismo sitio.
 *
 * Si la consulta falla se deja pasar. Es a propósito: un fallo de base
 * de datos no puede dejar a la gente sin poder recuperar su cuenta, y
 * detrás siguen estando los tres datos, que es la defensa de verdad.
 */
export async function estaFrenado(
  admin: Admin,
  email: string,
  ip: string | null
): Promise<boolean> {
  const desde = new Date(Date.now() - 3_600_000).toISOString();
  try {
    const porCorreo = await admin
      .from('password_reset_attempts')
      .select('id', { count: 'exact', head: true })
      .eq('email', email)
      .in('resultado', ['no_coincide', 'sin_cuenta', 'frenado'])
      .gte('created_at', desde);
    if ((porCorreo.count ?? 0) >= LIMITE_POR_CORREO) return true;

    if (ip) {
      const porIp = await admin
        .from('password_reset_attempts')
        .select('id', { count: 'exact', head: true })
        .eq('ip', ip)
        .in('resultado', ['no_coincide', 'sin_cuenta', 'frenado'])
        .gte('created_at', desde);
      if ((porIp.count ?? 0) >= LIMITE_POR_IP) return true;
    }
  } catch {
    return false;
  }
  return false;
}

const huella = (token: string) => createHash('sha256').update(token).digest('hex');

/**
 * Crea el permiso para poner la contraseña nueva. Devuelve el token en
 * claro (que solo viaja a quien acaba de demostrar quién es); en la
 * base queda únicamente su huella.
 */
export async function crearPermiso(
  admin: Admin,
  playerId: string,
  ip: string | null
): Promise<string | null> {
  const token = randomBytes(32).toString('base64url');
  const { error } = await admin.from('password_reset_grants').insert({
    token_hash: huella(token),
    player_id: playerId,
    expires_at: new Date(Date.now() + MINUTOS_PERMISO * 60_000).toISOString(),
    ip,
  });
  return error ? null : token;
}

/**
 * Gasta el permiso: comprueba que existe, que no ha caducado y que no
 * se usó ya, y lo marca en el acto. Devuelve de quién era.
 *
 * El marcado va con `is('used_at', null)` en el propio UPDATE: si dos
 * peticiones llegan a la vez con el mismo token, la base deja pasar a
 * una sola. Comprobar y marcar por separado dejaría un hueco por el que
 * el mismo permiso serviría dos veces.
 */
export async function gastarPermiso(
  admin: Admin,
  token: string
): Promise<{ playerId: string } | null> {
  if (!token || token.length < 20) return null;
  const { data, error } = await admin
    .from('password_reset_grants')
    .update({ used_at: new Date().toISOString() })
    .eq('token_hash', huella(token))
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .select('player_id')
    .maybeSingle();
  if (error || !data) return null;
  return { playerId: data.player_id as string };
}

/**
 * La cuenta de auth que tiene ese correo, o null.
 *
 * Se pagina de verdad en vez de pedir «las primeras 1.000»: hoy hay
 * 545 jugadores y cabrían, pero el día que pasen de mil, la versión
 * cómoda dejaría a los últimos sin poder recuperar su cuenta y nadie
 * entendería por qué.
 */
export async function buscarPorCorreo(
  admin: Admin,
  correo: string
): Promise<{ id: string } | null> {
  for (let pagina = 1; pagina <= 20; pagina++) {
    const { data, error } = await admin.auth.admin.listUsers({ page: pagina, perPage: 1000 });
    if (error) return null;
    const usuarios = data?.users ?? [];
    const encontrado = usuarios.find((u) => (u.email ?? '').toLowerCase() === correo);
    if (encontrado) return { id: encontrado.id };
    if (usuarios.length < 1000) return null;
  }
  return null;
}
