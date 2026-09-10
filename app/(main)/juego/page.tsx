'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import GameCanvas from '@/components/game/GameCanvas';
import Hud from '@/components/game/Hud';
import { usePlayer } from '@/components/providers/PlayerProvider';
import { onGameStart, setGameActive } from '@/lib/game/startSignal';
import { TOTAL_BAGS } from '@/lib/game/constants';
import type { ResultadoEntrega } from '@/lib/three/game';
import type { DepositBagResponse, StartRunResponse } from '@/types/game';

type Estado = 'idle' | 'cargando' | 'jugando' | 'fin';
type Punto = { x: number; y: number };

/** Lo que devuelven /api/session y el 409 de /api/buy-ticket al reanudar. */
type Reanudable = StartRunResponse & {
  bags_deposited?: number[];
  total_credited?: number;
  /** Valor de las bolsas YA cobradas, en orden de entrega. */
  bag_montos?: number[];
};

// ── Las monedas, con los números de La Llave ────────────────────────────────
// Al vaciar CADA bolsa: un puñado de monedas salta de la carretilla, se queda
// un momento arriba y cae. Es festejo: el saldo no se mueve. Son las monedas de
// las llaves 1-4 de La Llave.
const SALTO_MONEDAS = 9;
const SALTO_MS = 1150;
// Al vaciar la ÚLTIMA: las monedas suben de la carretilla al saldo y cada
// llegada suma su parte, hasta el total exacto con la última. Es el cobro al
// abrirse la puerta en La Llave, sin el cartel del tesoro.
const VUELO_MONEDAS = 10;
const VUELO_ESCALON_MS = 140;
const VUELO_VIAJE_MS = 750;
// Lo que se deja ver el estallido de la última bolsa antes de que despeguen.
const ESPERA_VUELO_MS = 650;

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
 *   · Cada bolsa vaciada → su valor queda sobre la carretilla, saltan
 *     cartones y monedas, y el saldo NO se mueve.
 *   · La última → las monedas vuelan al saldo y lo suben; luego la calle se
 *     apaga y la barra reaparece para la siguiente.
 */
export default function JuegoPage() {
  const router = useRouter();
  const { player, refresh, updateBalance } = usePlayer();
  const reducirMovimiento = useReducedMotion();
  const [estado, setEstado] = useState<Estado>('idle');
  const [seed, setSeed] = useState<number | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [yaEntregadas, setYaEntregadas] = useState<number[]>([]);
  // Valor de cada bolsa cobrada, en orden de entrega: el marcador lo pone
  // debajo de su casilla.
  const [montos, setMontos] = useState<number[]>([]);
  const [entregadas, setEntregadas] = useState(0);
  const [cargandoBolsa, setCargandoBolsa] = useState(false);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [avisoBolsa, setAvisoBolsa] = useState<{ id: number; monto: number } | null>(null);
  const [salto, setSalto] = useState<({ id: number } & Punto) | null>(null);
  const [vuelo, setVuelo] = useState<({ id: number; dx: number; dy: number } & Punto) | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [pulso, setPulso] = useState(0);
  const [ganaste, setGanaste] = useState<number | null>(null);

  // Lo que leen los callbacks del motor sin tener que volver a crearlos.
  const acreditadoAlEmpezar = useRef(0);
  const totalAcreditado = useRef(0);
  const premio = useRef<number | null>(null);
  const saldoActual = useRef(0);
  const silencio = useRef(false);
  const secuencia = useRef(0);
  const audio = useRef<AudioContext | null>(null);

  useEffect(() => {
    saldoActual.current = Number(player?.balance ?? 0);
  }, [player?.balance]);
  useEffect(() => {
    silencio.current = muted;
  }, [muted]);
  useEffect(() => {
    return () => {
      audio.current?.close().catch(() => {});
    };
  }, []);

  const reanudar = useCallback(
    (id: string, worldSeed: number, previas: number[], acreditado: number, montos: number[]) => {
      setSessionId(id);
      setSeed(worldSeed);
      setYaEntregadas(previas);
      setMontos(montos);
      setEntregadas(previas.length);
      // Lo ya cobrado en esa partida YA ESTÁ en el saldo que se ve: se cobró
      // antes de cerrar la app. Al final solo suben las monedas de lo que falta;
      // contarlo otra vez enseñaría un saldo mayor que el real.
      acreditadoAlEmpezar.current = acreditado;
      totalAcreditado.current = acreditado;
      premio.current = null;
      setGanaste(null);
      setError(null);
      setEstado('jugando');
      guardarCalle(worldSeed);
    },
    []
  );

  // Al entrar: si quedó una partida a medias se REANUDA sola y encendida,
  // como en La Llave —ese ticket ya está pagado—. /api/session solo mira, no
  // cobra nada. Si no, se monta la calle apagada.
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
          Number(run.total_credited ?? 0),
          run.bag_montos ?? []
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
    setGanaste(null);
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
        Number(data.total_credited ?? 0),
        data.bag_montos ?? []
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

    acreditadoAlEmpezar.current = 0;
    totalAcreditado.current = 0;
    premio.current = null;
    setEntregadas(0);
    setYaEntregadas([]);
    setMontos([]);
    setSessionId(data.session_id);
    setSeed(data.world_seed);
    setEstado('jugando');
    guardarCalle(data.world_seed);
  }, [router, refresh, reanudar]);

  // El tintineo de las monedas, con la receta de La Llave: un seno corto que
  // sube de tono con cada llegada. Respeta el botón de silencio.
  const tono = useCallback((frecuencia: number, duracion: number, volumen: number) => {
    if (silencio.current) return;
    try {
      const Ctx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      audio.current ??= new Ctx();
      const ctx = audio.current;
      const osc = ctx.createOscillator();
      const vol = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(frecuencia, ctx.currentTime);
      vol.gain.setValueAtTime(volumen, ctx.currentTime);
      vol.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duracion);
      osc.connect(vol);
      vol.connect(ctx.destination);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + duracion);
    } catch {
      /* sin audio: las monedas vuelan igual */
    }
  }, []);

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
        totalAcreditado.current = Number(d.total_credited ?? totalAcreditado.current);
        if (d.finished && d.payout !== undefined) premio.current = d.payout;
        return { monto: d.monto, finished: d.finished };
      } catch {
        return { monto: 0, finished: false, error: 'Sin conexión' };
      }
    },
    [sessionId]
  );

  // Cada bolsa vaciada: su valor sale debajo de su casilla del marcador, salta
  // un puñado de monedas y un aviso dice cuánto dio. El saldo
  // NO se mueve, igual que con las llaves 1-4 de La Llave.
  const onCredit = useCallback(
    (...args: [number, number, Punto]) => {
      const [monto, total, origen] = args;
      secuencia.current += 1;
      const id = secuencia.current;
      setSalto({ id, ...origen });
      setTimeout(() => setSalto((s) => (s && s.id === id ? null : s)), SALTO_MS + 250);
      setAvisoBolsa({ id, monto });
      setTimeout(() => setAvisoBolsa((a) => (a && a.id === id ? null : a)), 2600);
      // `total` es cuántas van entregadas: esta bolsa es la casilla total - 1.
      setMontos((m) => {
        const n = [...m];
        n[total - 1] = monto;
        return n;
      });
      tono(1046, 0.12, 0.35);
      setTimeout(() => tono(1568, 0.18, 0.3), 110);
    },
    [tono]
  );

  // El cobro: las monedas suben de la carretilla al saldo y CADA llegada suma
  // su parte, con un tintineo que sube de tono, hasta el total exacto.
  const lanzarVuelo = useCallback(
    (origen: Punto, total: number, alTerminar: () => void) => {
      const destino = document.querySelector('[data-destino-monedas]')?.getBoundingClientRect();
      const finX = destino ? destino.left + destino.width / 2 : origen.x;
      const finY = destino ? destino.top + destino.height / 2 : 80;
      const base = saldoActual.current;
      secuencia.current += 1;
      setVuelo({ id: secuencia.current, x: origen.x, y: origen.y, dx: finX - origen.x, dy: finY - origen.y });
      tono(1046, 0.12, 0.35);
      for (let i = 0; i < VUELO_MONEDAS; i++) {
        setTimeout(() => {
          tono(880 + i * 55, 0.09, 0.22);
          // La última moneda cierra el total exacto, sin restos de redondeo.
          const parte = i === VUELO_MONEDAS - 1 ? total : (total * (i + 1)) / VUELO_MONEDAS;
          updateBalance(Math.round((base + parte) * 100) / 100);
          setSubiendo(true);
          setPulso((p) => p + 1);
        }, VUELO_ESCALON_MS * i + VUELO_VIAJE_MS);
      }
      setTimeout(() => {
        setVuelo(null);
        setSubiendo(false);
        alTerminar();
      }, VUELO_ESCALON_MS * VUELO_MONEDAS + VUELO_VIAJE_MS + 500);
    },
    [tono, updateBalance]
  );

  const onState = useCallback((s: { carrying: boolean; deposited: number }) => {
    setCargandoBolsa(s.carrying);
    setEntregadas(s.deposited);
  }, []);

  const onFinished = useCallback(
    (origen: Punto) => {
      // Lo que suben las monedas es lo cobrado desde que se abrió ESTA pantalla:
      // si la partida se reanudó, lo de antes ya estaba en el saldo.
      const total = Math.max(
        0,
        Math.round((totalAcreditado.current - acreditadoAlEmpezar.current) * 100) / 100
      );
      const ganado = premio.current ?? totalAcreditado.current;
      setTimeout(() => {
        lanzarVuelo(origen, total, () => {
          setGanaste(ganado);
          setTimeout(() => setGanaste(null), 4500);
          setEstado('fin');
          // El servidor ya acreditó todo y gastó el ticket: se vuelve a pedir
          // el perfil para que la billetera y la barra de abajo digan la verdad.
          refresh();
        });
      }, ESPERA_VUELO_MS);
    },
    [lanzarVuelo, refresh]
  );

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
          saldo={Number(player?.balance ?? 0)}
          subiendo={subiendo}
          pulso={pulso}
          bolsasEntregadas={entregadas}
          totalBolsas={TOTAL_BAGS}
          montos={montos}
          cargando={cargandoBolsa}
          muted={muted}
          onToggleMute={() => setMuted((m) => !m)}
          onSalir={() => router.push('/billetera')}
        />
      )}

      <AnimatePresence>
        {avisoBolsa && estado === 'jugando' && (
          <motion.div
            key={avisoBolsa.id}
            className="juego-aviso-oro"
            initial={{ opacity: 0, y: -10, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
          >
            💰 Esta bolsa te hizo ganar <strong>+${avisoBolsa.monto.toFixed(2)}</strong>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {ganaste !== null && (
          <motion.div
            key="ganaste"
            className="juego-aviso-oro juego-ganaste"
            initial={{ opacity: 0, y: -12, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.35, ease: 'easeOut' }}
          >
            🏆 ¡Ganaste <strong>${ganaste.toFixed(2)}</strong>! Ya está en tu saldo
          </motion.div>
        )}
      </AnimatePresence>

      {/* Monedas que SALTAN de la carretilla y caen: pop rápido, se quedan un
          momento arriba y caen. Mismos fotogramas que las llaves de La Llave. */}
      <AnimatePresence>
        {salto && !reducirMovimiento && (
          <div className="monedas-capa" key={salto.id} style={{ left: salto.x, top: salto.y }} aria-hidden>
            {Array.from({ length: SALTO_MONEDAS }).map((_, i) => {
              const ang = -Math.PI / 2 + (i - (SALTO_MONEDAS - 1) / 2) * 0.34;
              const dist = 62 + ((i * 29) % 46);
              const bx = Math.cos(ang) * dist;
              const pico = Math.sin(ang) * dist; // negativo: sube
              const giro = (i % 2 === 0 ? 1 : -1) * (110 + ((i * 37) % 140));
              return (
                <motion.span
                  key={i}
                  className="moneda moneda-salto"
                  initial={{ opacity: 0, x: 0, y: 0, scale: 0.3, rotate: 0 }}
                  animate={{
                    opacity: [0, 1, 1, 0],
                    x: [0, bx * 0.55, bx * 0.85, bx],
                    y: [0, pico, pico + 14, pico + 150],
                    scale: [0.3, 1.2, 1.1, 0.9],
                    rotate: [0, giro * 0.3, giro * 0.75, giro],
                  }}
                  transition={{
                    duration: SALTO_MS / 1000,
                    delay: (i % 3) * 0.04,
                    ease: 'easeOut',
                    times: [0, 0.18, 0.72, 1],
                  }}
                >
                  🪙
                </motion.span>
              );
            })}
          </div>
        )}
      </AnimatePresence>

      {/* El cobro: monedas que suben de la carretilla al saldo. */}
      <AnimatePresence>
        {vuelo && !reducirMovimiento && (
          <div className="monedas-capa" key={vuelo.id} style={{ left: vuelo.x, top: vuelo.y }} aria-hidden>
            {Array.from({ length: VUELO_MONEDAS }).map((_, i) => {
              const abre = ((i * 47) % 90) - 45;
              return (
                <motion.span
                  key={i}
                  className="moneda moneda-vuelo"
                  initial={{ opacity: 0, x: abre, y: 0, scale: 0.4, rotate: 0 }}
                  animate={{
                    opacity: [0, 1, 1, 1, 0],
                    x: [abre, abre * 0.5, vuelo.dx],
                    y: [0, -70 - ((i * 37) % 45), vuelo.dy],
                    scale: [0.4, 1.15, 0.6],
                    rotate: (i % 2 === 0 ? 1 : -1) * (120 + ((i * 53) % 120)),
                  }}
                  exit={{ opacity: 0 }}
                  transition={{
                    duration: VUELO_VIAJE_MS / 1000,
                    delay: (i * VUELO_ESCALON_MS) / 1000,
                    ease: 'easeIn',
                  }}
                >
                  🪙
                </motion.span>
              );
            })}
          </div>
        )}
      </AnimatePresence>

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
