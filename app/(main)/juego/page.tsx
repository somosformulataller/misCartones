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

/** Lo que devuelven /api/session y el 409 de /api/buy-ticket al reanudar. */
type Reanudable = StartRunResponse & {
  bags_deposited?: number[];
  total_credited?: number;
};

/**
 * La calle que se ve APAGADA cuando no hay partida que reanudar: la de la
 * última partida jugada en este teléfono, o una fija la primera vez. Es solo
 * escaparate —con la calle apagada no se puede caminar ni entregar nada— y al
 * empezar el servidor manda la calle de verdad.
 */
const CALLE_ESCAPARATE = 20260910;
const CLAVE_ULTIMA_CALLE = 'mc-ultima-calle';

function calleGuardada(): number {
  try {
    const n = Number(localStorage.getItem(CLAVE_ULTIMA_CALLE));
    return Number.isFinite(n) && n > 0 ? n : CALLE_ESCAPARATE;
  } catch {
    return CALLE_ESCAPARATE;
  }
}

function guardarCalle(seed: number) {
  try {
    localStorage.setItem(CLAVE_ULTIMA_CALLE, String(seed));
  } catch {
    /* sin almacenamiento: la próxima vez sale la calle fija */
  }
}

/**
 * La pantalla de juego es UNA sola escena, como en La Llave: la calle está
 * siempre montada y lo único que cambia es si tiene la luz encendida.
 *
 *   · Sin partida → calle apagada, y la barra amarilla del layout ofrece lo
 *     que se puede hacer: iniciar, cambiar $2 de saldo o comprar un ticket.
 *   · Al pulsarla → se encienden las luces y la barra se va.
 *   · Al terminar → la calle se queda con la carretilla llena y el premio
 *     encima, se vuelve a apagar y la barra reaparece para la siguiente.
 *
 * Antes había una pantalla aparte, solo con los botones, y el juego no se
 * veía hasta haber pulsado.
 */
export default function JuegoPage() {
  const router = useRouter();
  const { player, refresh } = usePlayer();
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

  const reanudar = useCallback(
    (id: string, worldSeed: number, previas: number[], acreditado: number) => {
      setSessionId(id);
      setSeed(worldSeed);
      setYaEntregadas(previas);
      setEntregadas(previas.length);
      // Lo ya ganado en esa partida. Sin esto «Recogido» arrancaba en $0.00
      // con bolsas ya entregadas y cobradas, y en un juego de dinero eso se
      // lee como «me quitaron lo que llevaba».
      setSaldo(acreditado);
      setPremio(null);
      setError(null);
      setEstado('jugando');
      guardarCalle(worldSeed);
    },
    []
  );

  // Al entrar: si quedó una partida a medias se REANUDA sola y encendida,
  // como en La Llave —ese ticket ya está pagado—. /api/session solo mira, no
  // cobra nada. Si no hay partida, se monta la calle apagada.
  useEffect(() => {
    let vivo = true;
    (async () => {
      let run: Reanudable | null = null;
      try {
        const res = await fetch('/api/session', { cache: 'no-store' });
        const d = await res.json();
        run = d?.run ?? null;
      } catch {
        /* sin conexión: se enseña la calle apagada y el aviso sale al jugar */
      }
      if (!vivo) return;
      if (run?.session_id) {
        reanudar(
          run.session_id,
          run.world_seed,
          run.bags_deposited ?? [],
          Number(run.total_credited ?? 0)
        );
        return;
      }
      setSeed((s) => s ?? calleGuardada());
    })();
    return () => {
      vivo = false;
    };
  }, [reanudar]);

  const empezar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    setPremio(null);
    setCargandoBolsa(false);

    let data: Reanudable | null = null;
    let status = 0;
    try {
      const res = await fetch('/api/buy-ticket', { method: 'POST' });
      status = res.status;
      data = (await res.json()) as Reanudable;
    } catch {
      // Se cae abajo, al aviso de sin conexión.
    }

    // Partida activa que se reanuda (no se cobra otro ticket).
    if (status === 409 && data?.session_id) {
      reanudar(
        data.session_id,
        data.world_seed,
        data.bags_deposited ?? [],
        Number(data.total_credited ?? 0)
      );
      return;
    }

    // Sin sesión → a iniciarla.
    if (status === 401 || data?.code === 'SIN_SESION') {
      router.push('/auth/login');
      return;
    }

    // Aquí el juego se PARA y lo dice. Arrancar una partida local de mentira
    // para no dejar la pantalla quieta es lo peor que puede pasar en un juego
    // de dinero: se juega creyendo que se juega por dinero, se gana, y no hay
    // premio que cobrar. Mejor un aviso feo.
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

    // Sin tickets: el perfil que tenía la barra estaba viejo. Se refresca y
    // el botón amarillo cambia solo a «Cambiar $2» o a «Comprar», que es lo
    // que el jugador puede hacer de verdad.
    if (data.code === 'NO_TICKETS') {
      refresh();
      setError(data.error ?? 'No tienes tickets.');
      setEstado('idle');
      return;
    }

    if (status !== 200 || !data.session_id) {
      setError(data.error ?? 'No se pudo empezar la partida.');
      setEstado('idle');
      return;
    }

    setSaldo(0);
    setEntregadas(0);
    setYaEntregadas([]);
    setSessionId(data.session_id);
    setSeed(data.world_seed);
    setEstado('jugando');
    guardarCalle(data.world_seed);
  }, [router, refresh, reanudar]);

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
    // Se deja ver el clímax con la luz encendida antes de apagar la calle y
    // sacar el premio.
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

  // Y se le cuenta a la barra si hay partida en curso, para que esconda sus
  // botones mientras la calle está encendida.
  useEffect(() => {
    setGameActive(estado === 'jugando');
    return () => setGameActive(false);
  }, [estado]);

  const tickets = player?.tickets ?? 0;

  return (
    <main className="pantalla-juego mc-escena relative w-full overflow-hidden">
      {/* El `key` remonta el motor con cada partida. La calle puede ser la
          MISMA (la del escaparate es la última jugada), y sin remontar el
          motor no se enteraría de qué bolsas ya están entregadas. */}
      {seed !== null && (
        <GameCanvas
          key={sessionId ?? 'escaparate'}
          seed={seed}
          alreadyDeposited={yaEntregadas}
          muted={muted}
          encendida={estado === 'jugando'}
          callbacks={{ onDeposit, onCredit, onState, onFinished, onError: setError }}
        />
      )}

      {estado === 'jugando' && (
        <Hud
          saldo={saldo}
          bolsasEntregadas={entregadas}
          totalBolsas={TOTAL_BAGS}
          cargando={cargandoBolsa}
          muted={muted}
          onToggleMute={() => setMuted((m) => !m)}
          onSalir={() => router.push('/billetera')}
        />
      )}

      {estado === 'fin' && (
        <div className="mc-fin">
          <div className="mc-premio">
            <p className="mc-premio-rotulo">Carretilla llena</p>
            <p className="mc-premio-cifra">${(premio ?? saldo).toFixed(2)}</p>
            <p className="mc-fin-nota">Ya está en tu saldo</p>
          </div>
        </div>
      )}

      {(estado === 'idle' || estado === 'cargando') && (
        <div className="juego-apagado">
          <div className="juego-apagado-cartel">
            <p className="juego-apagado-titulo">Recoge las 5 bolsas</p>
            <p className="juego-apagado-texto">
              Mantén el dedo en la pantalla para caminar y lleva cada bolsa a la carretilla.
            </p>
          </div>
          {error && <p className="mc-aviso mc-aviso-malo">{error}</p>}
        </div>
      )}

      {/* La flecha que señala la barra. Va aparte del cartel porque vive
          pegada a la barra, abajo, y no arriba con las instrucciones. */}
      {(estado === 'idle' || estado === 'cargando' || estado === 'fin') && (
        <p className="juego-apagado-pista">
          {estado === 'cargando'
            ? 'Encendiendo la calle…'
            : tickets < 1
              ? 'Consigue un ticket para jugar 👇'
              : 'Toca el botón amarillo para jugar 👇'}
        </p>
      )}
    </main>
  );
}
