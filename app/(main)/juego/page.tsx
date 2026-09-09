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
    <main className="pantalla-juego mc-escena relative w-full overflow-hidden">
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
        <div className="mc-lobby">
          <div className="mc-lobby-texto">
            <h1 className="mc-lobby-titulo">Recoge las 5 bolsas</h1>
            <p className="mc-lobby-ayuda">
              Mantén el dedo en la pantalla y el ciudadano caminará hacia ahí. Agarra una bolsa
              y llévala a la carretilla para vaciarla.
            </p>
          </div>
          {error && <p className="mc-aviso mc-aviso-malo">{error}</p>}
          {player && (
            <p className="mc-lobby-tickets">
              Tienes {player.tickets ?? 0} ticket{(player.tickets ?? 0) === 1 ? '' : 's'}
            </p>
          )}
          <button
            onClick={empezar}
            disabled={estado === 'cargando' || isLoading}
            className="mc-boton mc-boton-grande"
          >
            {estado === 'cargando' ? 'Preparando…' : 'JUGAR'}
          </button>
        </div>
      )}

      {estado === 'fin' && (
        <div className="mc-lobby">
          <div className="mc-premio">
            <p className="mc-premio-rotulo">Carretilla llena</p>
            <p className="mc-premio-cifra">${(premio ?? saldo).toFixed(2)}</p>
          </div>
          <div className="mc-lobby-botones">
            <button onClick={empezar} className="mc-boton">
              Otra vez
            </button>
            <button onClick={() => router.push('/billetera')} className="btn-secondary">
              Mi billetera
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
