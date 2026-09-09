import Link from 'next/link';
import { isSupabaseConfigured } from '@/lib/supabase/env';

export default function Lobby() {
  const conectado = isSupabaseConfigured();

  return (
    <main className="relative min-h-[100dvh] overflow-hidden">
      {/* Sol y nubes: el mismo mediodía que hay dentro del juego, para que
          entrar a jugar no cambie de mundo. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-amber-200/70 blur-2xl"
      />
      <div aria-hidden className="pointer-events-none absolute left-6 top-16 opacity-80">
        <div className="h-10 w-28 rounded-full bg-white/90" />
        <div className="-mt-7 ml-8 h-14 w-20 rounded-full bg-white/90" />
      </div>
      <div aria-hidden className="pointer-events-none absolute right-10 top-40 opacity-70">
        <div className="h-8 w-24 rounded-full bg-white/85" />
        <div className="-mt-6 ml-6 h-11 w-16 rounded-full bg-white/85" />
      </div>

      <div className="relative mx-auto flex min-h-[100dvh] max-w-md flex-col items-center justify-center gap-7 px-6 text-center">
        <div>
          <div className="text-7xl drop-shadow-sm">🌻</div>
          <h1 className="mt-4 text-5xl font-black tracking-tight text-emerald-950 drop-shadow-sm">
            Mis Cartones
          </h1>
          <p className="mx-auto mt-3 max-w-xs text-[15px] font-medium leading-relaxed text-emerald-900/80">
            Recoge las cinco bolsas repartidas por el terreno y llévalas a tu carretilla.
            Cada bolsa que vacías revienta en cartones.
          </p>
        </div>

        <Link
          href="/juego"
          className="rounded-3xl border-b-4 border-amber-600 bg-amber-400 px-14 py-4 text-xl font-black tracking-wide text-emerald-950 shadow-xl shadow-emerald-900/20 transition active:translate-y-1 active:border-b-0"
        >
          JUGAR
        </Link>

        <div className="w-full rounded-2xl border border-white/60 bg-white/55 px-4 py-3 text-left text-xs leading-relaxed text-emerald-950/75 shadow-sm backdrop-blur">
          <p className="font-black uppercase tracking-wider text-emerald-900">Estado</p>
          <p className="mt-1">
            Supabase:{' '}
            {conectado ? (
              <span className="font-bold text-emerald-700">conectado</span>
            ) : (
              <span className="font-bold text-amber-700">sin configurar</span>
            )}
          </p>
          {/* Estar conectado a la base de datos NO significa que ya se juegue
              por dinero: falta la puerta de entrada. Decir solo "conectado"
              daba a entender lo contrario. */}
          <p className="mt-1">
            Partidas:{' '}
            <span className="font-bold text-amber-700">
              modo demo — falta el registro de jugadores
            </span>
          </p>
          <p className="mt-1">
            Fase 1: prototipo jugable. El arte son formas dibujadas por código; lo que se
            está afinando es cómo se <b>siente</b> caminar, agarrar y vaciar.
          </p>
        </div>
      </div>
    </main>
  );
}
