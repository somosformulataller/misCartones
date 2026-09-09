'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { usePathname } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { usePlayer } from '@/components/providers/PlayerProvider';
import { referralLink } from '@/lib/referrals/constants';
import { compartirInvitacion } from '@/lib/referrals/compartir';

// El modal que invita a traer amigos. Sale en tres momentos, cada uno
// UNA sola vez: al registrarse (con saludo de bienvenida), tras la
// primera partida y tras el primer retiro. La lógica de "solo una vez"
// vive aquí (localStorage por momento), así que quien lo dispara solo
// tiene que llamar a triggerInvite() sin preocuparse de repetir.

type Momento = 'welcome' | 'firstgame' | 'firstwithdraw';

interface InviteContextValue {
  /** Muestra el modal para ese momento si no se ha mostrado ya. */
  triggerInvite: (m: Momento) => void;
}

const InviteContext = createContext<InviteContextValue | null>(null);

// Bandera que deja el registro justo antes de entrar al juego, para que
// el saludo de bienvenida salga en /juego (no en la pantalla de login).
export const WELCOME_PENDING_KEY = 'cartones_invite_welcome_pending';

const seenKey = (m: Momento) => `cartones_invite_seen_${m}`;

function yaVisto(m: Momento): boolean {
  try {
    return localStorage.getItem(seenKey(m)) === '1';
  } catch {
    return false;
  }
}
function marcarVisto(m: Momento) {
  try {
    localStorage.setItem(seenKey(m), '1');
  } catch {
    /* modo incógnito o storage bloqueado: se mostrará de nuevo, no pasa nada */
  }
}

// El texto de cada momento: título, párrafos y la etiqueta del botón que
// comparte el enlace de afiliado.
const CONTENIDO: Record<
  Momento,
  { icono: string; titulo: string; parrafos: string[]; boton: string }
> = {
  welcome: {
    icono: '🎉',
    titulo: 'Bienvenido...',
    parrafos: [
      'Recuerda que además de ganar dinero jugando…',
      'También puedes ganar hasta $3 por cada amigo que invites a jugar y se registre con tu enlace de afiliado.',
    ],
    boton: 'Compartir juego y ganar $3',
  },
  firstgame: {
    icono: '♻️',
    titulo: '¡Felicidades, ya hiciste tu primera jugada!',
    parrafos: [
      'Recuerda que si quieres ganar $3 por cada amigo que invites y se registre con tu enlace de afiliado, puedes recomendar el juego ahora mismo.',
    ],
    boton: 'Recomendar juego y ganar $3',
  },
  firstwithdraw: {
    icono: '💸',
    titulo: '¡Felicidades por tu primer retiro!',
    parrafos: [
      'En unos minutos estará disponible en tu banco.',
      'Recuerda que puedes ganar hasta $3 por cada amigo que invites a jugar y se registre con tu enlace de afiliado.',
    ],
    boton: 'Recomendar juego y ganar $3',
  },
};

export function InviteModalProvider({ children }: { children: React.ReactNode }) {
  const { player } = usePlayer();
  const pathname = usePathname();
  const [momento, setMomento] = useState<Momento | null>(null);
  const [link, setLink] = useState('');
  const [copiado, setCopiado] = useState(false);
  const [compartiendoVideo, setCompartiendoVideo] = useState(false);
  const buscandoRef = useRef(false);

  // Trae el código de referido (y arma el link) la primera vez que se
  // abre el modal. Se cachea: los siguientes momentos ya lo tienen.
  const cargarLink = useCallback(async () => {
    if (link || buscandoRef.current) return;
    buscandoRef.current = true;
    try {
      const res = await fetch('/api/referrals', { cache: 'no-store' });
      const d = await res.json();
      if (res.ok && d?.codigo) {
        setLink(referralLink(d.codigo, window.location.origin));
      }
    } catch {
      /* sin link el modal aún invita; muestra "preparando tu link…" */
    } finally {
      buscandoRef.current = false;
    }
  }, [link]);

  const triggerInvite = useCallback(
    (m: Momento) => {
      // Solo jugadores: al staff no se le invita a referir.
      if (!player || player.role === 'admin' || player.role === 'support') return;
      // El saludo de bienvenida ya lo controla su bandera de sesión
      // (se consume una vez); los otros dos, por localStorage.
      if (m !== 'welcome') {
        if (yaVisto(m)) return;
        marcarVisto(m);
      }
      setMomento(m);
      cargarLink();
    },
    [player, cargarLink]
  );

  // Momento 1 — recién registrado. El registro deja WELCOME_PENDING_KEY y
  // navega a /juego; aquí se consume al llegar a la pantalla de juego.
  useEffect(() => {
    if (!player || pathname !== '/juego') return;
    let pendiente = false;
    try {
      pendiente = sessionStorage.getItem(WELCOME_PENDING_KEY) === '1';
    } catch {
      /* sin sessionStorage no hay bienvenida, no es grave */
    }
    if (!pendiente) return;
    try {
      sessionStorage.removeItem(WELCOME_PENDING_KEY);
    } catch {}
    // Un respiro para que la pantalla de juego se asiente antes del
    // saludo (y así el modal no se abre en el mismo tick del efecto).
    const t = setTimeout(() => triggerInvite('welcome'), 500);
    return () => clearTimeout(t);
  }, [player, pathname, triggerInvite]);

  const cerrar = () => setMomento(null);

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      /* si no se puede copiar, el input queda seleccionable a mano */
    }
  };

  // El botón de cada mensaje manda el VIDEO promocional con el enlace de
  // afiliado de leyenda (en el móvil llega a WhatsApp como video + link;
  // en escritorio se descarga el video y el enlace queda a la vista abajo).
  const compartirVideo = async () => {
    setCompartiendoVideo(true);
    try {
      await compartirInvitacion(link);
    } finally {
      setCompartiendoVideo(false);
    }
  };

  const c = momento ? CONTENIDO[momento] : null;

  return (
    <InviteContext.Provider value={{ triggerInvite }}>
      {children}
      <AnimatePresence>
        {momento && c && (
          <motion.div
            className="modal-overlay"
            onClick={cerrar}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="modal-card invite-card"
              onClick={(e) => e.stopPropagation()}
              initial={{ opacity: 0, scale: 0.94, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: 12 }}
              role="dialog"
              aria-modal="true"
            >
              <button
                className="invite-cerrar"
                onClick={cerrar}
                type="button"
                aria-label="Cerrar"
              >
                ×
              </button>

              <div className="modal-icon">{c.icono}</div>
              <h2 className="modal-title">{c.titulo}</h2>

              {c.parrafos.map((p, i) => (
                <p className="modal-subtitle" key={i}>
                  {p}
                </p>
              ))}

              {link ? (
                <>
                  <button
                    className="btn-primary invite-compartir"
                    onClick={compartirVideo}
                    type="button"
                    disabled={compartiendoVideo}
                  >
                    {compartiendoVideo ? 'Preparando video…' : `📤 ${c.boton}`}
                  </button>
                  {/* Por si el compartir del sistema no está (escritorio):
                      el enlace a la vista para copiarlo a mano. */}
                  <div className="afi-link-row invite-link-row">
                    <input
                      className="ref-input afi-link"
                      value={link}
                      readOnly
                      onFocus={(e) => e.target.select()}
                    />
                    <button
                      className="btn-secondary afi-copiar"
                      onClick={copiar}
                      type="button"
                      aria-label="Copiar enlace"
                    >
                      {copiado ? '✅' : '📋'}
                    </button>
                  </div>
                </>
              ) : (
                <p className="wallet-sub">Preparando tu enlace…</p>
              )}

              <button className="invite-omitir" onClick={cerrar} type="button">
                Ahora no
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </InviteContext.Provider>
  );
}

export function useInvite(): InviteContextValue {
  const ctx = useContext(InviteContext);
  if (!ctx) throw new Error('useInvite debe usarse dentro de <InviteModalProvider>');
  return ctx;
}
