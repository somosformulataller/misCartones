// Foto de perfil: vive en el bucket PÚBLICO `avatars` como `<id>.jpg`
// (sin columna en la BD — la URL se deriva del id del jugador).

/** URL pública del avatar de un jugador */
export function avatarPublicUrl(base: string, playerId: string) {
  return `${base}/storage/v1/object/public/avatars/${playerId}.jpg`;
}

/** URL del avatar desde el navegador (usa la URL pública de Supabase) */
export function avatarUrlFor(playerId: string) {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  return avatarPublicUrl(base, playerId);
}
