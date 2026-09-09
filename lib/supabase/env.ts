/** Limpia una variable de entorno: Vercel a veces guarda comillas o saltos. */
export function cleanEnv(v: string | undefined): string {
  return (v ?? '').trim().replace(/^["']|["']$/g, '');
}

export const SUPABASE_URL = cleanEnv(process.env.NEXT_PUBLIC_SUPABASE_URL);
export const SUPABASE_ANON = cleanEnv(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

/** ¿Hay proyecto de Supabase configurado? La app arranca aunque no lo esté
 *  —para no romper el build ni un despliegue a medio configurar—, pero sin
 *  esto no hay sesión, ni compras, ni partidas: solo pantallas que avisan. */
export function isSupabaseConfigured(): boolean {
  return SUPABASE_URL.length > 0 && SUPABASE_ANON.length > 0;
}
