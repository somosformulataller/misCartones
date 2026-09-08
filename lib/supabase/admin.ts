import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { cleanEnv, SUPABASE_URL } from './env';

// Cliente PRIVILEGIADO (service role): salta RLS. SOLO servidor — este módulo
// no se importa jamás desde el navegador. Todas las escrituras del juego pasan
// por aquí porque el navegador no puede tocar las tablas de dinero.
const SECRET = cleanEnv(process.env.SUPABASE_SECRET_KEY);

export function isAdminClientConfigured(): boolean {
  return SUPABASE_URL.length > 0 && SECRET.length > 0;
}

export function createAdminClient() {
  if (!isAdminClientConfigured()) {
    throw new Error('SUPABASE_SECRET_KEY no está configurada');
  }
  return createSupabaseClient(SUPABASE_URL, SECRET, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
