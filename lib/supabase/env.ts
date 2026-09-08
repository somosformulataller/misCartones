/** Limpia una variable de entorno: Vercel a veces guarda comillas o saltos. */
export function cleanEnv(v: string | undefined): string {
  return (v ?? '').trim().replace(/^["']|["']$/g, '');
}

export const SUPABASE_URL = cleanEnv(process.env.NEXT_PUBLIC_SUPABASE_URL);
export const SUPABASE_ANON = cleanEnv(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

/** ¿Hay proyecto de Supabase configurado? Mientras no lo haya, la app
 *  arranca igual y el juego corre en MODO DEMO (partida local, sin dinero).
 *  Es a propósito: se puede desarrollar el juego entero sin base de datos. */
export function isSupabaseConfigured(): boolean {
  return SUPABASE_URL.length > 0 && SUPABASE_ANON.length > 0;
}
