import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { SUPABASE_URL, SUPABASE_ANON, isSupabaseConfigured } from '@/lib/supabase/env';

// En Next.js 16 `middleware.ts` se llama `proxy.ts` y la función exportada se
// llama `proxy`. El runtime es siempre nodejs y no se puede configurar.
export async function proxy(request: NextRequest) {
  // Sin Supabase configurado no hay sesión que refrescar ni ruta que
  // proteger: la app funciona en modo demo y esto se queda a un lado.
  if (!isSupabaseConfigured()) return NextResponse.next({ request });

  let response = NextResponse.next({ request });

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  // IMPORTANTE: no meter lógica entre createServerClient y getUser.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.json|sw.js|icons|.*\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
