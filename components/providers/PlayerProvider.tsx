'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { isGameActive } from '@/lib/game/startSignal';
import { Player } from '@/types/game';

interface PlayerContextValue {
  player: Player | null;
  /** true solo durante la primera carga del perfil */
  isLoading: boolean;
  isAdmin: boolean;
  /** admin O atención al cliente: puede entrar al panel */
  isStaff: boolean;
  refresh: () => Promise<void>;
  updateBalance: (newBalance: number) => void;
  /** Actualización optimista parcial (saldo, tickets, …) */
  updatePlayer: (patch: Partial<Player>) => void;
  signOut: () => Promise<void>;
  /** Expulsa al instante a una cuenta suspendida: cierra sesión y la
      manda al login con el aviso de CUENTA SUSPENDIDA. */
  expelBlocked: () => Promise<void>;
}

const PlayerContext = createContext<PlayerContextValue | null>(null);

// Registro de interacción para la analítica del admin (fire-and-forget)
function track(type: 'login' | 'app_open' | 'page_view', path?: string) {
  try {
    fetch('/api/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, path }),
      keepalive: true,
    }).catch(() => {});
  } catch {}
}

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const [player, setPlayer] = useState<Player | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();
  const supabaseRef = useRef(createClient());
  // Secuencia de refrescos: solo la respuesta MÁS RECIENTE aplica.
  // Sin esto, un refresco viejo (p. ej. el de "sin sesión" de la
  // pantalla de login) podía llegar tarde y pisar con null el perfil
  // recién cargado tras iniciar sesión.
  const reqSeq = useRef(0);

  // Aplica el perfil del servidor SIN pisar el saldo mostrado mientras se
  // juega. Durante una partida el servidor YA acreditó lo que soltó cada
  // bolsa, pero el contador de la escena las revela una a una con su
  // animación. Sin esto, cualquier recarga a mitad de partida —Supabase
  // reemite SIGNED_IN al volver a la pestaña, por ejemplo— haría saltar el
  // saldo de golpe al total y se perdería el único momento del juego que
  // vale la pena mirar. El resto de campos (tickets, etc.) sí se actualizan.
  const aplicarPerfil = useCallback((next: Player | null) => {
    setPlayer((prev) =>
      next && prev && isGameActive() ? { ...next, balance: prev.balance } : next
    );
  }, []);

  const refresh = useCallback(async () => {
    const seq = ++reqSeq.current;
    // Marcar la carga TAMBIÉN en los refrescos: sin esto había un
    // instante con player=null e isLoading=false y las pantallas
    // creían que no había sesión.
    setIsLoading(true);
    try {
      const res = await fetch('/api/player', { cache: 'no-store' });
      const data = await res.json();
      if (seq !== reqSeq.current) return; // llegó tarde: descartar

      if (!data.player) {
        // El navegador dice que HAY sesión pero el servidor aún no la
        // vio (cookies recién escritas): reintentar una vez.
        const { data: s } = (await supabaseRef.current?.auth.getSession()) ?? { data: { session: null } };
        if (s.session) {
          await new Promise((r) => setTimeout(r, 600));
          if (seq !== reqSeq.current) return;
          const res2 = await fetch('/api/player', { cache: 'no-store' });
          const data2 = await res2.json();
          if (seq !== reqSeq.current) return;
          aplicarPerfil(data2.player ?? null);
          return;
        }
      }
      aplicarPerfil(data.player ?? null);
    } catch {
      if (seq === reqSeq.current) setPlayer(null);
    } finally {
      if (seq === reqSeq.current) setIsLoading(false);
    }
  }, [aplicarPerfil]);

  // Expulsión de una cuenta suspendida: cierra sesión y va al login con
  // el aviso. Se usa tanto al detectar `blocked` en el perfil como cuando
  // un endpoint del juego responde 403 con `blocked: true`.
  const expelBlocked = useCallback(async () => {
    await supabaseRef.current?.auth.signOut();
    setPlayer(null);
    router.push('/auth/login?suspendida=1');
    router.refresh();
  }, [router]);

  useEffect(() => {
    // Sin Supabase no hay sesión que sincronizar: se deja de cargar y punto.
    if (!supabaseRef.current) {
      setIsLoading(false);
      return;
    }
    // Carga inicial (INITIAL_SESSION) + sincronización con el estado
    // de auth, sin recargar la página (navegación SPA).
    const { data: sub } = supabaseRef.current.auth.onAuthStateChange((event, session) => {
      if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'USER_UPDATED') {
        refresh();
      }
      if (event === 'SIGNED_IN') track('login');
      if (event === 'INITIAL_SESSION' && session) track('app_open');
      if (event === 'SIGNED_OUT') setPlayer(null);
    });
    return () => sub.subscription.unsubscribe();
  }, [refresh]);

  // Flujo del jugador en la app: una vista por cambio de pantalla
  const playerId = player?.id ?? null;
  useEffect(() => {
    if (playerId && pathname) track('page_view', pathname);
  }, [playerId, pathname]);

  // Suspensión en caliente: si el perfil cargado ya viene (o pasa a)
  // bloqueado, expulsar en el acto sin esperar a que intente jugar.
  // No es estado derivado: es echar a alguien de la app. Reacciona a un dato
  // que acaba de llegar del servidor, y lo que hace de verdad es cerrar la
  // sesión y navegar al login.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (player?.blocked === true) expelBlocked();
  }, [player?.blocked, expelBlocked]);

  // Latido: aunque el jugador esté quieto en la pantalla, cada 60 s se
  // comprueba si lo acaban de bloquear y, si es así, se le expulsa. Con
  // la pestaña OCULTA no late (una pestaña en segundo plano no juega ni
  // toca saldo); al VOLVER a ella se comprueba en el acto, así que un
  // bloqueado no puede seguir jugando. Solo corre con sesión iniciada;
  // no toca el estado salvo para expulsar.
  useEffect(() => {
    if (!playerId) return;
    const comprobar = async () => {
      try {
        const res = await fetch('/api/player', { cache: 'no-store' });
        const data = await res.json();
        if (data.player?.blocked === true) expelBlocked();
      } catch {
        /* un latido perdido no pasa nada: se reintenta al siguiente */
      }
    };
    const id = setInterval(() => {
      if (document.hidden) return;
      comprobar();
    }, 60000);
    const onVisible = () => {
      if (!document.hidden) comprobar();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [playerId, expelBlocked]);

  const updateBalance = useCallback((newBalance: number) => {
    setPlayer((prev) => (prev ? { ...prev, balance: newBalance } : prev));
  }, []);

  const updatePlayer = useCallback((patch: Partial<Player>) => {
    setPlayer((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  const signOut = useCallback(async () => {
    await supabaseRef.current?.auth.signOut();
    setPlayer(null);
    router.push('/');
    router.refresh();
  }, [router]);

  return (
    <PlayerContext.Provider
      value={{
        player,
        isLoading,
        isAdmin: player?.role === 'admin',
        isStaff: player?.role === 'admin' || player?.role === 'support',
        refresh,
        updateBalance,
        updatePlayer,
        signOut,
        expelBlocked,
      }}
    >
      {children}
    </PlayerContext.Provider>
  );
}

export function usePlayer(): PlayerContextValue {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error('usePlayer debe usarse dentro de <PlayerProvider>');
  return ctx;
}
