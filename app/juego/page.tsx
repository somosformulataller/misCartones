'use client';

import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import GameCanvas from '@/components/game/GameCanvas';
import Hud from '@/components/game/Hud';
import { createDemoRun } from '@/lib/game/demo';
import { TOTAL_BAGS } from '@/lib/game/constants';
import type { ResultadoEntrega } from '@/lib/three/game';
import type { DepositBagResponse, StartRunResponse } from '@/types/game';

type Estado = 'idle' | 'cargando' | 'jugando' | 'fin';

export default function JuegoPage() {
  const router = useRouter();
  const [estado, setEstado] = useState<Estado>('idle');
  const [seed, setSeed] = useState<number | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [yaEntregadas, setYaEntregadas] = useState<number[]>([]);
  const [demo, setDemo] = useState(false);
  const [saldo, setSaldo] = useState(0);
  const [entregadas, setEntregadas] = useState(0);
  const [cargandoBolsa, setCargandoBolsa] = useState(false);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [premio, setPremio] = useState<number | null>(null);

  // La partida demo vive en una ref: no se re-crea con cada render.
  const demoRun = useRef<ReturnType<typeof createDemoRun> | null>(null);

  const empezar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    setSaldo(0);
    setEntregadas(0);
    setPremio(null);
    setCargandoBolsa(false);
    demoRun.current = null;

    let data: StartRunResponse | null = null;
    let status = 0;
    try {
      const res = await fetch('/api/buy-ticket', { method: 'POST' });
      status = res.status;
      data = (await res.json()) as StartRunResponse;
    } catch {
      // Sin red: se cae a demo igual, para no dejar la pantalla en blanco.
    }

    // Partida activa que se reanuda (no se cobra otro ticket).
    if (status === 409 && data?.session_id) {
      setDemo(false);
      setSessionId(data.session_id);
      setSeed(data.world_seed);
      const previas = (data as unknown as { bags_deposited?: number[] }).bags_deposited ?? [];
      setYaEntregadas(previas);
      setEntregadas(previas.length);
      setEstado('jugando');
      return;
    }

    // Todavía no hay Supabase conectado: partida LOCAL con el mismo RNG y el
    // mismo reparto que usa el servidor. Ver lib/game/demo.ts.
    if (!data || status === 503 || data.code === 'SIN_CONFIGURAR' || status === 0) {
      const run = createDemoRun();
      demoRun.current = run;
      setDemo(true);
      setSessionId(run.sessionId);
      setSeed(run.seed);
      setYaEntregadas([]);
      setEstado('jugando');
      return;
    }

    if (status !== 200 || !data.session_id) {
      setError(data.error ?? 'No se pudo empezar la partida.');
      setEstado('idle');
      return;
    }

    setDemo(false);
    setSessionId(data.session_id);
    setSeed(data.world_seed);
    setYaEntregadas([]);
    setEstado('jugando');
  }, []);

  const onDeposit = useCallback(
    async (bagId: number): Promise<ResultadoEntrega> => {
      if (demoRun.current) return demoRun.current.deposit();
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
    if (demoRun.current) setPremio(demoRun.current.payout);
    // Se deja ver el clímax antes de sacar el cartel.
    setTimeout(() => setEstado('fin'), 2600);
  }, []);

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
            demo={demo}
            onToggleMute={() => setMuted((m) => !m)}
            onSalir={() => router.push('/')}
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
          <button
            onClick={empezar}
            disabled={estado === 'cargando'}
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
            {demo && (
              <p className="mx-auto mt-3 max-w-xs text-sm font-medium text-emerald-900/60">
                Partida demo: el reparto y el RTP son los de producción, pero no hay dinero real.
              </p>
            )}
          </div>
          <div className="flex gap-3">
            <button
              onClick={empezar}
              className="rounded-3xl border-b-4 border-amber-600 bg-amber-400 px-9 py-3.5 font-black text-emerald-950 shadow-lg shadow-emerald-900/20 transition active:translate-y-1 active:border-b-0"
            >
              Otra vez
            </button>
            <button
              onClick={() => router.push('/')}
              className="rounded-3xl border-2 border-emerald-800/25 bg-white/60 px-9 py-3.5 font-bold text-emerald-900 transition active:scale-95"
            >
              Salir
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
