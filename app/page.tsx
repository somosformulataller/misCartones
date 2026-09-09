import Link from 'next/link';

/**
 * La portada. Solo la ve quien NO ha entrado: el proxy manda al juego a
 * quien ya tiene sesión antes de que esto llegue a pintarse. Por eso es un
 * componente de servidor sin estado — no hay nada que decidir aquí.
 *
 * Ya no dice en qué estado está el sistema. Antes ponía «Supabase:
 * conectado», que a un jugador no le dice nada y a nosotros nos dejó
 * anunciar que el juego estaba listo cuando todavía no había por dónde
 * entrar. Lo que hay que saber está donde se decide: la billetera dice el
 * saldo, la pantalla de compra dice si el pago se validó.
 */
export default function Portada() {
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
          <div className="text-7xl drop-shadow-sm">♻️</div>
          <h1 className="mt-4 text-5xl font-black tracking-tight text-emerald-950 drop-shadow-sm">
            Mis Cartones
          </h1>
          <p className="mx-auto mt-3 max-w-xs text-[15px] font-medium leading-relaxed text-emerald-900/80">
            Recoge las cinco bolsas repartidas por la calle y llévalas a tu carretilla.
            Cada bolsa que vacías revienta en cartones.
          </p>
        </div>

        <Link
          href="/auth/login"
          className="rounded-3xl border-b-4 border-amber-600 bg-amber-400 px-14 py-4 text-xl font-black tracking-wide text-emerald-950 shadow-xl shadow-emerald-900/20 transition active:translate-y-1 active:border-b-0"
        >
          ENTRAR A JUGAR
        </Link>

        <p className="text-xs font-semibold text-emerald-900/60">
          Un ticket cuesta $2 y se paga por Pago Móvil.
        </p>
      </div>
    </main>
  );
}
