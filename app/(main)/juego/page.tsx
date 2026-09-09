'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import GameCanvas from '@/components/game/GameCanvas';
import Hud from '@/components/game/Hud';
import { usePlayer } from '@/components/providers/PlayerProvider';
import { onGameStart, setGameActive } from '@/lib/game/startSignal';
import { TOTAL_BAGS } from '@/lib/game/constants';
import type { ResultadoEntrega } from '@/lib/three/game';
import type { DepositBagResponse, StartRunResponse } from '@/types/game';

type Estado = 'idle' | 'cargando' | 'jugando' | 'fin';

export default function JuegoPage() {
  const router = useRouter();
  const { player, isLoading, refresh } = usePlayer();
  const [estado, setEstado] = useState<Estado>('idle');
  const [seed, setSeed] = useState<number | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [yaEntregadas, setYaEntregadas] = useState<number[]>([]);
  const [saldo, setSaldo] = useState(0);
  const [entregadas, setEntregadas] = useState(0);
  const [cargandoBolsa, setCargandoBolsa] = useState(false);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [premio, setPremio] = useState<number | null>(null);

  const empezar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    setSaldo(0);
    setEntregadas(0);
    setPremio(null);
    setCargandoBolsa(false);

    let data: StartRunResponse | null = null;
    let status = 0;
    try {
      const res = await fetch('/api/buy-ticket', { method: 'POST' });
      status = res.status;
      data = (await res.json()) as StartRunResponse;
    } catch {
      // Se cae abajo, al aviso de sin conexión.
    }

    // Partida activa que se reanuda (no se cobra otro ticket).
    if (status === 409 && data?.session_id) {
      setSessionId(data.session_id);
      setSeed(data.world_seed);
      const previas = (data as unknown as { bags_deposited?: number[] }).bags_deposited ?? [];
      setYaEntregadas(previas);
      setEntregadas(previas.length);
      setEstado('jugando');
      return;
    }

    // Sin sesión → a iniciarla.
    if (status === 401 || data?.code === 'SIN_SESION') {
      router.push('/auth/login');
      return;
    }

    // Aquí el juego se PARA y lo dice. Antes arrancaba una partida local de
    // mentira para no dejar la pantalla en blanco; en un juego de dinero eso
    // es lo peor que puede pasar: el jugador gasta su rato creyendo que juega
    // por dinero, gana, y no hay premio que cobrar. Mejor un aviso feo.
    if (!data || status === 0) {
      setError('Sin conexión. Revisa tu internet e inténtalo otra vez.');
      setEstado('idle');
      return;
    }
    if (status === 503 || data.code === 'SIN_CONFIGURAR') {
      setError('El juego no está disponible en este momento. Inténtalo en unos minutos.');
      setEstado('idle');
      return;
    }

    if (status !== 200 || !data.session_id) {
      setError(data.error ?? 'No se pudo empezar la partida.');
      setEstado('idle');
      return;
    }

    setSessionId(data.session_id);
    setSeed(data.world_seed);
    setYaEntregadas([]);
    setEstado('jugando');
  }, [router]);

  const onDeposit = useCallback(
    async (bagId: number): Promise<ResultadoEntrega> => {
      if (!sessionId) return { monto: 0, finished: false, error: 'Partida no iniciada' };
      try {
        const res = await fetch('/api/deposit-bag', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ session_id: sessionId, bag_id: bagId }),
        });
        const d = (await res.json()) as DepositBagResponse;
        if (!res.ok) return { monto: 0, finished: false, error: d.error ?? 'Error del servidor' };
        if (d.finished && d.payout !== undefined) setPremio(d.payout);
        return { monto: d.monto, finished: d.finished };
      } catch {
        return { monto: 0, finished: false, error: 'Sin conexión' };
      }
    },
    [sessionId]
  );

  const onCredit = useCallback((monto: number) => {
    setSaldo((s) => Math.round((s + monto) * 100) / 100);
  }, []);

  const onState = useCallback((s: { carrying: boolean; deposited: number }) => {
    setCargandoBolsa(s.carrying);
    setEntregadas(s.deposited);
  }, []);

  const onFinished = useCallback(() => {
    // Se deja ver el clímax antes de sacar el cartel.
    setTimeout(() => setEstado('fin'), 2600);
    // El servidor ya acreditó el premio y gastó el ticket: se vuelve a pedir
    // el perfil para que la billetera y la barra de abajo digan la verdad.
    refresh();
  }, [refresh]);

  // La barra amarilla del layout pide arrancar desde cualquier pantalla.
  // Solo se hace caso estando quieto: si ya hay partida, un segundo toque no
  // puede cobrar otro ticket.
  useEffect(() => {
    return onGameStart(() => {
      setEstado((prev) => {
        if (prev === 'jugando' || prev === 'cargando') return prev;
        empezar();
        return prev;
      });
    });
  }, [empezar]);

  // Y se le cuenta a la barra si hay partida en curso, para que esconda su
  // botón mientras se juega.
  useEffect(() => {
    setGameActive(estado === 'jugando');
    return () => setGameActive(false);
  }, [estado]);

  return (
    <main className="pantalla-juego relative w-full overflow-hidden bg-[#4fc3f7]">
      {estado === 'jugando' && seed !== null && (
        <>
          <GameCanvas
            seed={seed}
            alreadyDeposited={yaEntregadas}
            muted={muted}
            callbacks={{ onDeposit, onCredit, onState, onFinished, onError: setError }}
          />
          <Hud
            saldo={saldo}
            bolsasEntregadas={entregadas}
            totalBolsas={TOTAL_BAGS}
            cargando={cargandoBolsa}
            muted={muted}
            onToggleMute={() => setMuted((m) => !m)}
            onSalir={() => router.push('/billetera')}
          />
        </>
      )}

      {(estado === 'idle' || estado === 'cargando') && (
        <div className="flex h-full flex-col items-center justify-center gap-6 bg-gradient-to-b from-sky-400 via-lime-200 to-lime-500 px-6 text-center">
          <div>
            <div className="text-6xl drop-shadow-sm">🌾</div>
            <h1 className="mt-4 text-4xl font-black tracking-tight text-emerald-950 drop-shadow-sm">
              Recoge las 5 bolsas
            </h1>
            <p className="mx-auto mt-3 max-w-sm font-medium leading-relaxed text-emerald-900/80">
              Mantén el dedo en la pantalla y el ciudadano caminará hacia ahí. Agarra una bolsa
              y llévala a la carretilla para vaciarla.
            </p>
          </div>
          {error && (
            <p className="rounded-xl border border-red-500/30 bg-red-100/90 px-4 py-2 text-sm font-semibold text-red-800">
              {error}
            </p>
          )}
          {player && (
            <p className="text-sm font-bold text-emerald-900/70">
              Tienes {player.tickets ?? 0} ticket{(player.tickets ?? 0) === 1 ? '' : 's'}
            </p>
          )}
          <button
            onClick={empezar}
            disabled={estado === 'cargando' || isLoading}
            className="rounded-3xl border-b-4 border-amber-600 bg-amber-400 px-12 py-4 text-xl font-black tracking-wide text-emerald-950 shadow-xl shadow-emerald-900/20 transition active:translate-y-1 active:border-b-0 disabled:opacity-60"
          >
            {estado === 'cargando' ? 'Preparando…' : 'JUGAR'}
          </button>
        </div>
      )}

      {estado === 'fin' && (
        <div className="flex h-full flex-col items-center justify-center gap-6 bg-gradient-to-b from-sky-400 via-lime-200 to-lime-500 px-6 text-center">
          <div>
            <div className="text-6xl drop-shadow-sm">🎉</div>
            <p className="mt-4 text-xs font-black uppercase tracking-[0.25em] text-emerald-800">
              Carretilla llena
            </p>
            <p className="font-mono text-7xl font-black tabular-nums text-emerald-950 drop-shadow-sm">
              ${(premio ?? saldo).toFixed(2)}
            </p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={empezar}
              className="rounded-3xl border-b-4 border-amber-600 bg-amber-400 px-9 py-3.5 font-black text-emerald-950 shadow-lg shadow-emerald-900/20 transition active:translate-y-1 active:border-b-0"
            >
              Otra vez
            </button>
            <button
              onClick={() => router.push('/billetera')}
              className="rounded-3xl border-2 border-emerald-800/25 bg-white/60 px-9 py-3.5 font-bold text-emerald-900 transition active:scale-95"
            >
              Mi billetera
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
