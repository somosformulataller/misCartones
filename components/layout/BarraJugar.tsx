'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { usePlayer } from '@/components/providers/PlayerProvider';
import BuyTicketsModal from '@/components/payments/BuyTicketsModal';
import { TICKET_PRICE_USD } from '@/lib/payments/constants';
import { requestGameStart, useGameActive } from '@/lib/game/startSignal';
import { referralLink } from '@/lib/referrals/constants';
import { compartirInvitacion } from '@/lib/referrals/compartir';

/**
 * La barra amarilla de abajo. Enseña UN solo botón, y cuál es depende de en
 * qué punto está el jugador:
 *
 *   1. Con tickets              → «Iniciar juego»
 *   2. Sin tickets, saldo ≥ $2  → «Cambiar $2 por 1 ticket y volver a jugar»
 *   3. Sin tickets ni saldo     → «Comprar 1 ticket por $2»
 *
 * Uno solo, no tres. La versión con los tres botones a la vez obligaba a
 * leer y decidir; con uno, el juego ya decidió cuál es el siguiente paso
 * posible y el jugador solo lo da. Los otros dos caminos siguen estando en
 * el menú para quien los busque.
 */
export default function BarraJugar() {
  const { player, updatePlayer, refresh } = usePlayer();
  const [busy, setBusy] = useState(false);
  const [buyOpen, setBuyOpen] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  // true entre «pedí arrancar» y «la partida ya anda»: sin esto el botón se
  // queda visible durante la navegación a /juego y se puede pulsar dos veces.
  // Se apaga sola con su propio temporizador; no hace falta un efecto que la
  // limpie al empezar la partida, porque `enPartida` ya tapa el botón.
  const [arrancando, setArrancando] = useState(false);
  const [refLink, setRefLink] = useState('');
  const [compartiendo, setCompartiendo] = useState(false);
  const enPartida = useGameActive();
  const pathname = usePathname();
  const router = useRouter();

  // El enlace de invitación se trae POR ADELANTADO, no al pulsar. El
  // navigator.share del móvil solo se abre dentro del gesto del toque: si
  // hubiera que esperar un fetch en medio, el sistema lo bloquea por
  // considerarlo una ventana que se abre sola.
  const playerId = player?.id;
  useEffect(() => {
    if (!playerId) return;
    let vivo = true;
    (async () => {
      try {
        const res = await fetch('/api/referrals', { cache: 'no-store' });
        const d = await res.json();
        if (vivo && res.ok && d?.codigo) {
          setRefLink(referralLink(d.codigo, window.location.origin));
        }
      } catch {
        /* sin enlace comparte igual, con texto genérico */
      }
    })();
    return () => {
      vivo = false;
    };
  }, [playerId]);

  if (!player) return null;

  const tickets = player.tickets ?? 0;
  const saldo = Number(player.balance ?? 0);
  const precio = TICKET_PRICE_USD;

  const mostrarAviso = (msg: string) => {
    setAviso(msg);
    setTimeout(() => setAviso(null), 4000);
  };

  // Arrancar: la pantalla del juego escucha la señal. Si no estamos en
  // /juego, primero se navega y la señal se consume al montar. El
  // temporizador es la red de seguridad: si por lo que sea la partida no
  // llega a arrancar, el botón vuelve solo en vez de quedarse muerto.
  const jugar = () => {
    setArrancando(true);
    setTimeout(() => setArrancando(false), 6000);
    requestGameStart();
    if (pathname !== '/juego') router.push('/juego');
  };

  // Cambia $2 de saldo por un ticket y arranca de una vez: son dos pasos que
  // el jugador nunca quiere dar por separado.
  const cambiarYJugar = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/wallet/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickets: 1 }),
      });
      const data = await res.json();
      if (!res.ok) {
        mostrarAviso(`⚠️ ${data.error || 'No se pudo hacer el cambio'}`);
        return;
      }
      updatePlayer({
        ...(typeof data.balance === 'number' ? { balance: data.balance } : {}),
        ...(typeof data.tickets === 'number' ? { tickets: data.tickets } : {}),
      });
      refresh();
      jugar();
    } catch {
      mostrarAviso('⚠️ Error de conexión');
    } finally {
      setBusy(false);
    }
  };

  const recomendar = async () => {
    if (compartiendo) return;
    setCompartiendo(true);
    try {
      await compartirInvitacion(refLink);
    } finally {
      setCompartiendo(false);
    }
  };

  // En el panel no pinta nada: quien está ahí está trabajando, no jugando, y
  // un "compra 1 ticket por $2" fijo al pie de una tabla de retiros por pagar
  // solo estorba y tapa filas.
  if (pathname.startsWith('/admin')) return null;

  const ocultarBoton = arrancando || enPartida;
  const mostrarBarra = !ocultarBoton || Boolean(aviso);
  if (!mostrarBarra && !buyOpen) return null;

  // El modal va FUERA de .play-bar a propósito: el backdrop-filter de la
  // barra la convierte en contenedor de los position:fixed que hay dentro, y
  // el modal quedaba encerrado en los 90 píxeles de la barra en vez de cubrir
  // la pantalla.
  return (
    <>
      {mostrarBarra && (
        // En /juego la barra flota SOBRE la calle en vez de ser una franja de
        // piedra debajo: los botones amarillos quedan dentro de la escena.
        <div className={`play-bar${pathname === '/juego' ? ' play-bar--escena' : ''}`}>
          <div className="play-bar-row">
            {!ocultarBoton &&
              (tickets > 0 ? (
                <button className="play-bar-btn" onClick={jugar} disabled={busy}>
                  ♻️ Iniciar juego
                  {/* El precio, a la vista: empezar gasta un ticket */}
                  <span className="play-bar-cost">− 1 🎟️</span>
                </button>
              ) : saldo >= precio ? (
                <button className="play-bar-btn" onClick={cambiarYJugar} disabled={busy}>
                  {busy ? 'Cambiando…' : `🎟️ Cambiar $${precio.toFixed(0)} y volver a jugar`}
                </button>
              ) : (
                <button className="play-bar-btn" onClick={() => setBuyOpen(true)} disabled={busy}>
                  🎟️ Comprar 1 ticket por ${precio.toFixed(0)}
                </button>
              ))}
            {aviso && <span className="play-bar-flash">{aviso}</span>}
          </div>

          {!ocultarBoton && (
            <button
              className="play-bar-recomendar"
              onClick={recomendar}
              type="button"
              disabled={compartiendo}
            >
              {compartiendo ? 'Preparando…' : 'recomendar juego y ganar $3'}
            </button>
          )}
        </div>
      )}

      <BuyTicketsModal open={buyOpen} onClose={() => setBuyOpen(false)} />
    </>
  );
}
