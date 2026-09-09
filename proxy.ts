import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { SUPABASE_URL, SUPABASE_ANON, isSupabaseConfigured } from '@/lib/supabase/env';

// En Next.js 16 `middleware.ts` se llama `proxy.ts` y la función exportada se
// llama `proxy`. El runtime es siempre nodejs y no se puede configurar.
export async function proxy(request: NextRequest) {
  // Sin Supabase configurado no hay sesión que refrescar ni ruta que
  // proteger: cada pantalla avisa por su cuenta y esto se queda a un lado.
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

  // IMPORTANTE: no meter lógica entre createServerClient y getUser. Cualquier
  // cosa en medio y las cookies refrescadas no llegan a la respuesta: la
  // sesión se cae sola cada media hora sin que nada dé error.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Las pantallas de dinero se cierran AQUÍ, no dentro de cada una. Sin
  // sesión, /billetera cargaba entera y salía con todo a cero — parecía que
  // el jugador había perdido su saldo, cuando lo que pasaba es que no había
  // entrado. Un redirect dice la verdad; una pantalla vacía miente.
  const ruta = request.nextUrl.pathname;
  // /admin va en la lista, pero aquí solo se comprueba que HAYA sesión: quién
  // es del equipo lo decide `requireStaff` en cada ruta de /api/admin, contra
  // la base. El proxy no lee roles a propósito — si lo hiciera, el permiso
  // viviría en dos sitios y tarde o temprano dirían cosas distintas.
  const PRIVADAS = ['/juego', '/billetera', '/comprar', '/referidos', '/perfil', '/admin'];
  if (!user && PRIVADAS.some((p) => ruta === p || ruta.startsWith(p + '/'))) {
    const destino = request.nextUrl.clone();
    destino.pathname = '/auth/login';
    // De dónde venía, para devolverlo ahí después de entrar.
    destino.searchParams.set('volver', ruta);
    return NextResponse.redirect(destino);
  }

  // Y al revés: quien ya tiene sesión no tiene nada que hacer en el login.
  if (user && (ruta === '/auth/login' || ruta === '/')) {
    const destino = request.nextUrl.clone();
    destino.pathname = '/juego';
    destino.search = '';
    return NextResponse.redirect(destino);
  }

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.json|sw.js|icons|.*\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
