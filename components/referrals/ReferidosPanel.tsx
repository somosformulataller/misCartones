'use client';

import { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import { usePlayer } from '@/components/providers/PlayerProvider';
import {
  REFERRAL_GAMES_REQUIRED,
  REFERRAL_REWARD_USD,
  REFERRAL_TRAMO_GAMES,
  REFERRAL_TRAMO_USD,
  montoGanadoReferido,
  referralLink,
} from '@/lib/referrals/constants';


const fechaCorta = (iso: string) =>
  new Date(iso).toLocaleString('es', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

interface Referido {
  id: string;
  nombre: string;
  partidas: number;
  /** Cuánto ya se cobró por este referido (0 a 3, en tramos de $1) */
  cobrado_usd: number;
  cobrado_at: string | null;
}

interface Datos {
  codigo: string | null;
  referidos: Referido[];
}

export default function ReferidosPanel() {
  const { player, refresh } = usePlayer();
  const [datos, setDatos] = useState<Datos | null>(null);
  const [cargando, setCargando] = useState(true);
  const [copiado, setCopiado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cobrando, setCobrando] = useState<string | null>(null);
  // El aviso de que ya cobró. `temporal` = se va solo a los pocos
  // segundos: es una confirmación, no algo que haya que atender.
  const [aviso, setAviso] = useState<{ texto: string; temporal: boolean } | null>(null);

  /** Lo que tarda en irse el aviso: suficiente para leerlo sin que se
   *  quede ahí estorbando. */
  const DURACION_AVISO = 6000;
  useEffect(() => {
    if (!aviso?.temporal) return;
    const t = setTimeout(() => setAviso(null), DURACION_AVISO);
    return () => clearTimeout(t);
  }, [aviso]);

  const cargar = useCallback(async () => {
    try {
      const res = await fetch('/api/referrals', { cache: 'no-store' });
      const d = await res.json();
      if (res.ok) setDatos(d);
    } catch {
      /* si falla, se queda el estado anterior */
    } finally {
      setCargando(false);
    }
  }, []);

  // Carga inicial: pide los referidos al servidor al montar. El setState
  // ocurre dentro del await, no en el cuerpo del efecto.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    cargar();
  }, [cargar]);

  const link = datos?.codigo ? referralLink(datos.codigo, window.location.origin) : '';

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      setError('No se pudo copiar. Selecciona el link y cópialo a mano.');
    }
  };

  const compartir = async () => {
    const texto = `¡Juega conmigo en Mis Cartones! Regístrate con mi link: ${link}`;
    // El menú de compartir del teléfono; en escritorio no existe y se
    // cae al portapapeles.
    if (navigator.share) {
      try {
        await navigator.share({ text: texto, url: link });
        return;
      } catch {
        return; // el usuario canceló: no es un error
      }
    }
    copiar();
  };

  // Cobrar suma al saldo lo que se haya liberado en tramos ($1 por cada
  // 10 partidas del referido) y todavía no se haya cobrado. No pide datos
  // de Pago Móvil: para recibir saldo no hace falta cuenta de banco.
  const cobrar = async (r: Referido) => {
    setError(null);
    setAviso(null);
    setCobrando(r.id);
    try {
      const res = await fetch('/api/referrals/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ referred_id: r.id }),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(d.error || 'No se pudo cobrar el premio');
        return;
      }
      const monto = Number(d.amount ?? 0);
      if (d.destino === 'retiro') {
        // Red de seguridad por si algún día el RPC volviera a crear un
        // retiro: ese aviso NO se va solo, porque cambia lo que la
        // persona tiene que esperar.
        setAviso({
          texto: `¡Listo! Pediste el pago de $${monto.toFixed(2)} por ${r.nombre}. El equipo te lo envía por Pago Móvil.`,
          temporal: false,
        });
      } else {
        setAviso({
          texto: `✅ Ya están sumados $${monto.toFixed(2)} a tu saldo`,
          temporal: true,
        });
      }
      await cargar();
      refresh();
    } catch {
      setError('Error de conexión. Intenta de nuevo.');
    } finally {
      setCobrando(null);
    }
  };

  const lista = datos?.referidos ?? [];
  const total = lista.length;
  // Lo que puede cobrar YA por un referido: lo que sus partidas han
  // liberado en tramos, menos lo que ya cobró.
  const porCobrarDe = (r: Referido) =>
    Math.max(0, montoGanadoReferido(r.partidas) - (r.cobrado_usd ?? 0));
  // Cuántos amigos ya llegaron a las 30 partidas (premio completo)
  const completados = lista.filter((r) => r.partidas >= REFERRAL_GAMES_REQUIRED).length;
  // Dinero disponible para cobrar ahora mismo, sumando todos
  const porCobrar = lista.reduce((s, r) => s + porCobrarDe(r), 0);
  // Lo que ya se llevó gracias a sus referidos, en total
  const ganado = lista.reduce((s, r) => s + (r.cobrado_usd ?? 0), 0);
  const amigosConCobro = lista.filter((r) => (r.cobrado_usd ?? 0) > 0).length;

  if (!player) return null;

  return (
    <div className="wallet-main">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="wallet-title">🤝 Referidos</h1>
      </motion.div>

      {/* Volver al juego */}
      <Link href="/juego" className="afi-volver">
        ← Volver al juego
      </Link>

      {/* ── Comparte y gana ──
          En La Llave Correcta aquí va un VIDEO promocional que el jugador
          manda a su estado de WhatsApp, y es lo que más referidos trae: un
          enlace pelado en un chat no se abre, un video sí. Mis Cartones aún
          no tiene el suyo, y poner el del otro juego confundiría a quien lo
          reciba. Mientras tanto, el enlace solo. */}
      <section className="wallet-card afi-video-card">
        <h2 className="wallet-card-title">🤝 Comparte y gana</h2>
        <p className="wallet-sub afi-video-texto">
          Manda tu enlace por WhatsApp. Quien se registre con él queda como tu
          referido, y cobras según lo que juegue.
        </p>
        <button className="btn-primary" onClick={compartir} type="button" disabled={!link}>
          🔗 Compartir mi link de referido
        </button>
      </section>

      <p className="wallet-sub afi-lema">
        Comparte tu link y gana <strong>${REFERRAL_TRAMO_USD}</strong> por cada{' '}
        <strong>{REFERRAL_TRAMO_GAMES} partidas</strong> que juegue tu amigo, hasta{' '}
        <strong>${REFERRAL_REWARD_USD}</strong> por cada uno.
      </p>

      {/* Se cobra y se sigue aquí: el aviso confirma y se retira solo.
          Qué hacer con el dinero lo decide después, sin que la app le
          empuje a ningún sitio. */}
      <AnimatePresence>
        {aviso && (
          <motion.div
            key={aviso.texto}
            className={`wallet-notice ${aviso.temporal ? 'afi-aviso-ok' : ''}`}
            role="status"
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            // El aviso temporal va fijo con transform: si framer le
            // anima `y` con su propio transform, pisa el centrado.
            style={aviso.temporal ? { translateX: '-50%', left: '50%' } : undefined}
          >
            {aviso.texto}
          </motion.div>
        )}
      </AnimatePresence>
      {error && <div className="auth-error">⚠️ {error}</div>}

      {/* ── Tu link ── */}
      <section className="wallet-card">
        <h2 className="wallet-card-title">🔗 Tu link de invitación</h2>
        {cargando ? (
          <p className="wallet-sub">Cargando…</p>
        ) : (
          <>
            <div className="afi-link-row">
              <input className="ref-input afi-link" value={link} readOnly onFocus={(e) => e.target.select()} />
              <button className="btn-secondary afi-copiar" onClick={copiar} type="button">
                {copiado ? '✅' : '📋'}
              </button>
            </div>
            <button className="btn-primary" onClick={compartir} type="button">
              📤 Compartir mi link
            </button>
            {datos?.codigo && (
              <p className="wallet-sub afi-codigo">
                Tu código: <strong>{datos.codigo}</strong>
              </p>
            )}
          </>
        )}
      </section>

      {/* ── Resumen ── */}
      <div className="afi-stats">
        <div className="afi-stat">
          <span className="afi-stat-n">{total}</span>
          <span className="afi-stat-l">Referidos</span>
        </div>
        <div className="afi-stat">
          <span className="afi-stat-n">{completados}</span>
          <span className="afi-stat-l">Completaron</span>
        </div>
        <div className="afi-stat afi-stat-oro">
          <span className="afi-stat-n">${porCobrar}</span>
          <span className="afi-stat-l">Por cobrar</span>
        </div>
        <div className="afi-stat afi-stat-oro">
          <span className="afi-stat-n">${ganado}</span>
          <span className="afi-stat-l">Ya ganado</span>
        </div>
      </div>

      {ganado > 0 && (
        <p className="wallet-sub afi-ganado">
          🤝 Llevas <strong>${ganado}</strong> ganados gracias a tus referidos
          {amigosConCobro > 1 ? ` (${amigosConCobro} amigos)` : ''}. Ese dinero está en tu saldo,
          junto a lo que ganas jugando.
        </p>
      )}

      {/* ── Lista ── */}
      <section className="wallet-card">
        <h2 className="wallet-card-title">👥 Mis referidos ({total})</h2>
        {cargando ? (
          <p className="wallet-sub">Cargando…</p>
        ) : total === 0 ? (
          <p className="wallet-sub">
            Todavía no tienes referidos. Comparte tu link con tus amigos: por cada{' '}
            {REFERRAL_TRAMO_GAMES} partidas que juegue uno cobras ${REFERRAL_TRAMO_USD} (hasta $
            {REFERRAL_REWARD_USD} a las {REFERRAL_GAMES_REQUIRED}).
          </p>
        ) : (
          <ul className="history-list">
            {lista.map((r) => {
              const cobrado = r.cobrado_usd ?? 0;
              const disponible = porCobrarDe(r);
              const completo = cobrado >= REFERRAL_REWARD_USD;
              const pct = Math.min(100, Math.round((r.partidas / REFERRAL_GAMES_REQUIRED) * 100));
              // Partidas para el próximo tramo de $1 (mientras no esté al tope)
              const faltanTramo = REFERRAL_TRAMO_GAMES - (r.partidas % REFERRAL_TRAMO_GAMES);
              return (
                <li key={r.id} className="history-item afi-item">
                  <div className="history-line">
                    <strong>{r.nombre}</strong>
                    <span className="history-date">
                      {Math.min(r.partidas, REFERRAL_GAMES_REQUIRED)}/{REFERRAL_GAMES_REQUIRED} partidas
                    </span>
                  </div>
                  <div className="afi-barra" aria-hidden>
                    <div
                      className={`afi-barra-fill ${completo ? 'afi-barra-listo' : ''}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  {cobrado > 0 && !completo && (
                    <p className="history-sub">
                      Llevas ${cobrado} de ${REFERRAL_REWARD_USD} cobrados por {r.nombre}.
                    </p>
                  )}
                  {disponible > 0 ? (
                    <button
                      className="btn-primary afi-cobrar"
                      onClick={() => cobrar(r)}
                      disabled={cobrando === r.id}
                      type="button"
                    >
                      {cobrando === r.id ? 'Cobrando…' : `💰 Cobrar $${disponible}`}
                    </button>
                  ) : completo ? (
                    <p className="history-sub">✅ Premio completo cobrado (${REFERRAL_REWARD_USD})</p>
                  ) : (
                    <p className="history-sub">
                      Le faltan {faltanTramo} partida{faltanTramo === 1 ? '' : 's'} para tu próximo $
                      {REFERRAL_TRAMO_USD}.
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ── Historial de lo ganado invitando ──
          Cada amigo que ya le dio algún premio, con cuánto lleva cobrado
          de él y cuándo fue el último cobro. El dinero se mezcla con el
          del juego en cuanto entra al saldo, así que esta lista es el
          único sitio donde queda el detalle. */}
      {amigosConCobro > 0 && (
        <section className="wallet-card">
          <h2 className="wallet-card-title">🤝 Lo que has ganado invitando</h2>
          <ul className="history-list">
            {lista
              .filter((r) => (r.cobrado_usd ?? 0) > 0)
              .sort((a, b) => +new Date(b.cobrado_at ?? 0) - +new Date(a.cobrado_at ?? 0))
              .map((r) => (
                <li key={r.id} className="history-item">
                  <div className="history-line">
                    <strong>{r.nombre}</strong>
                    <span className="afi-premio">+${(r.cobrado_usd ?? 0).toFixed(2)}</span>
                  </div>
                  <p className="history-sub">
                    {r.cobrado_at ? fechaCorta(r.cobrado_at) : 'cobrado'} · a tu saldo
                  </p>
                </li>
              ))}
          </ul>
          <p className="wallet-sub afi-total-linea">
            Total: <strong>${ganado}.00</strong> en {amigosConCobro} amigo
            {amigosConCobro === 1 ? '' : 's'}
          </p>
        </section>
      )}

      {/* ── Cómo funciona ── */}
      <section className="wallet-card">
        <h2 className="wallet-card-title">💡 ¿Cómo funciona?</h2>
        <ol className="afi-pasos">
          <li>Comparte tu link con tus amigos.</li>
          <li>
            Por cada {REFERRAL_TRAMO_GAMES} partidas que juegue tu amigo se te habilita $
            {REFERRAL_TRAMO_USD} ({REFERRAL_TRAMO_GAMES}→${REFERRAL_TRAMO_USD}, 20→$
            {REFERRAL_TRAMO_USD}, {REFERRAL_GAMES_REQUIRED}→${REFERRAL_TRAMO_USD}).
          </li>
          <li>
            Cobras cada tramo con un botón y se suma a tu saldo al instante: hasta $
            {REFERRAL_REWARD_USD} por cada amigo, para retirarlos o jugar con ellos.
          </li>
        </ol>
      </section>
    </div>
  );
}
