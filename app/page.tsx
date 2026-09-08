import Link from 'next/link';
import { isSupabaseConfigured } from '@/lib/supabase/env';

export default function Lobby() {
  const conectado = isSupabaseConfigured();

  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-md flex-col items-center justify-center gap-8 px-6 text-center">
      <div>
        <div className="text-7xl">🚶‍♂️🗑️</div>
        <h1 className="mt-5 text-4xl font-black tracking-tight">Mis Cartones</h1>
        <p className="mt-3 text-white/60">
          Recoge las cinco bolsas de basura de la calle y llévalas a tu carretilla. Cada bolsa
          que vacías revienta en cartones.
        </p>
      </div>

      <Link
        href="/juego"
        className="rounded-2xl bg-amber-400 px-12 py-4 text-lg font-black text-[#14171a] shadow-lg shadow-amber-400/20 transition active:scale-95"
      >
        JUGAR
      </Link>

      <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-left text-xs leading-relaxed text-white/45">
        <p className="font-bold uppercase tracking-wider text-white/60">Estado</p>
        <p className="mt-1">
          Supabase:{' '}
          {conectado ? (
            <span className="text-emerald-300">conectado</span>
          ) : (
            <span className="text-amber-300">sin configurar — el juego corre en modo demo</span>
          )}
        </p>
        <p className="mt-1">
          Fase 1: prototipo jugable. El arte son formas: lo que se está afinando es cómo se
          SIENTE caminar, agarrar y vaciar.
        </p>
      </div>
    </main>
  );
}
