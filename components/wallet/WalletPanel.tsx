'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { usePlayer } from '@/components/providers/PlayerProvider';
import { useInvite } from '@/components/referrals/InviteModalProvider';
import BuyTicketsModal from '@/components/payments/BuyTicketsModal';
import {
  MIN_WITHDRAWAL_USD,
  PURCHASE_STATUS_LABEL,
  TICKET_PRICE_USD,
  VE_BANKS,
  WITHDRAWAL_STATUS_LABEL,
} from '@/lib/payments/constants';
import { TicketPurchase, Withdrawal, Player } from '@/types/game';
import { HORAS_FRENO_RETIRO, retiroFrenado, retiroLibreDesde } from '@/lib/auth/recuperar';
import type { ResumenReferidos } from '@/lib/referrals/ganado';
import { RETIRO_NIVELES, retirosPermitidos } from '@/lib/wallet/limiteRetiros';

const fmt = (n: number) => `$${Number(n).toFixed(2)}`;
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString('es', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

// "Mi Billetera": tickets, saldo de premios (retirable), canje de
// saldo a tickets, retiro por Pago Móvil, datos de cobro e historiales.
// Se usa en la página /billetera Y dentro del modal del header.
export default function WalletPanel() {
  const { player: ctxPlayer, refresh } = usePlayer();
  const { triggerInvite } = useInvite();
  const [player, setPlayer] = useState<Player | null>(null);
  const [purchases, setPurchases] = useState<TicketPurchase[]>([]);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [buyOpen, setBuyOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Canje saldo → tickets
  const [redeemQty, setRedeemQty] = useState(1);
  const [redeeming, setRedeeming] = useState(false);

  // Retiro
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawModal, setWithdrawModal] = useState(false);
  // ¿El retiro recién solicitado es el PRIMERO del jugador? Se fija al
  // solicitarlo (mirando que no tuviera retiros previos) y decide si al
  // cerrar el modal se le invita a referir. Sin esto, a un jugador
  // veterano le salía "¡Felicidades por tu primer retiro!" en cualquier
  // retiro hecho tras el despliegue.
  const [primerRetiro, setPrimerRetiro] = useState(false);
  // Límite de retiros diarios: partidas jugadas hoy y retiros ya hechos
  const [partidasHoy, setPartidasHoy] = useState(0);
  const [retirosHoy, setRetirosHoy] = useState(0);

  // Datos de cobro
  const [payoutForm, setPayoutForm] = useState({ name: '', bank: '', cedula: '', phone: '' });
  const [savingPayout, setSavingPayout] = useState(false);
  // Cédula del REGISTRO: si existe, el campo queda bloqueado (la
  // identidad no se cambia después de registrarse)
  const [registeredCedula, setRegisteredCedula] = useState<string | null>(null);

  const [checking, setChecking] = useState(false);
  // Cuánto ha ganado invitando (aparte de lo que gana jugando)
  const [referidos, setReferidos] = useState<ResumenReferidos>({
    total: 0,
    cobros: 0,
  });

  const loadWallet = useCallback(async () => {
    try {
      const res = await fetch('/api/wallet', { cache: 'no-store' });
      const data = await res.json();
      if (res.ok) {
        setPlayer(data.player);
        setPurchases(data.purchases ?? []);
        setWithdrawals(data.withdrawals ?? []);
        setPartidasHoy(data.partidasHoy ?? 0);
        setRetirosHoy(data.retirosHoy ?? 0);
        if (data.referidos) setReferidos(data.referidos);
        if (data.player) {
          const fromRegistration = data.player.cedula ?? null;
          setRegisteredCedula(fromRegistration);
          setPayoutForm({
            name: data.player.payout_name ?? '',
            bank: data.player.payout_bank ?? '',
            // La cédula del registro manda; el campo editable solo
            // aplica a cuentas viejas registradas sin cédula
            cedula: fromRegistration || (data.player.payout_cedula ?? ''),
            phone: data.player.payout_phone ?? '',
          });
        }
      }
    } catch {}
  }, []);

  useEffect(() => {
    // La carga es asíncrona: el setState ocurre tras el fetch, no en
    // el cuerpo del efecto (falso positivo del compilador).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadWallet();
  }, [loadWallet]);

  const pendingPurchases = purchases.filter(
    (p) => p.status === 'pendiente' || p.status === 'validando'
  );

  // Mientras haya pagos en revisión, reintentar solo cada 60 s
  const hasPending = pendingPurchases.length > 0;
  useEffect(() => {
    if (!hasPending) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch('/api/purchases/recheck', { method: 'POST' });
        const data = await res.json();
        if ((data.approved ?? 0) > 0) {
          refresh();
          setNotice('✅ ¡Tu pago fue aprobado! Ya tienes tus tickets listos.');
        }
        loadWallet();
      } catch {}
    }, 60_000);
    return () => clearInterval(interval);
  }, [hasPending, loadWallet, refresh]);

  const handleRecheck = async () => {
    setChecking(true);
    try {
      const res = await fetch('/api/purchases/recheck', { method: 'POST' });
      const data = await res.json();
      if ((data.approved ?? 0) > 0) {
        refresh();
        setNotice('✅ ¡Tu pago fue aprobado! Ya tienes tus tickets listos.');
      }
      await loadWallet();
    } catch {
    } finally {
      setChecking(false);
    }
  };

  const balance = Number(player?.balance ?? ctxPlayer?.balance ?? 0);
  const tickets = Number(player?.tickets ?? ctxPlayer?.tickets ?? 0);
  const maxRedeem = Math.floor(balance / TICKET_PRICE_USD);
  const clampedQty = Math.min(Math.max(1, redeemQty), Math.max(1, maxRedeem));
  const pendingWithdrawal = withdrawals.find((w) => w.status === 'pendiente') ?? null;
  // Límite de retiros diarios: según las partidas de hoy, cuántos retiros
  // desbloqueó y cuántos le quedan. El nivel alcanzado coincide con el
  // número de retiros permitidos (1, 2 o 3).
  const retirosMax = retirosPermitidos(partidasHoy);
  const nivelActual = retirosMax;
  const limiteAlcanzado = retirosHoy >= retirosMax;
  // Sin datos de Pago Móvil GUARDADOS no se puede retirar (el equipo
  // no tendría a dónde pagar) — se mira lo guardado, no el formulario
  // Recuperó su contraseña hace menos de 24 h: los retiros esperan
  // (migración 023; el servidor lo rechaza igual, esto es para que lo
  // sepa antes de intentarlo)
  const retiroEnPausa = retiroFrenado(player?.password_reset_at);

  const hasPayoutData = Boolean(
    player &&
      (player.payout_name ?? '').trim() &&
      (player.payout_bank ?? '').trim() &&
      String(player.cedula ?? player.payout_cedula ?? '').trim() &&
      (player.payout_phone ?? '').trim()
  );

  // Quien llega con ?retirar=1 viene de pulsar "💸 Retirar" en otro
  // sitio (hoy, el modal del premio de referido). Ya dijo lo que
  // quiere: se le deja delante, no se le manda a buscarlo. Si le
  // faltan los datos de Pago Móvil, lo que se le pone delante es el
  // formulario — que es justo el momento en que sí hacen falta.
  const seccionRetiro = useRef<HTMLElement | null>(null);
  const seccionDatos = useRef<HTMLElement | null>(null);
  const yaLlevado = useRef(false);
  useEffect(() => {
    if (yaLlevado.current || !player) return;
    // Se lee de window y no con useSearchParams a propósito: este panel
    // vive también en una página estática, y useSearchParams la
    // obligaría a renderizarse en cada visita.
    if (!new URLSearchParams(window.location.search).has('retirar')) return;
    yaLlevado.current = true;
    const ir = () => {
      const destino = hasPayoutData ? seccionRetiro.current : seccionDatos.current;
      destino?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    ir();
    // Y otra vez cuando la página termine de acomodarse: las tarjetas
    // de arriba siguen creciendo un instante después (los pagos en
    // revisión, la tasa del día), y eso empuja el destino hacia abajo
    // dejando al jugador mirando otra sección. Pasó en producción, no
    // en local, que es donde estas cosas se ven.
    const t = setTimeout(ir, 700);
    return () => clearTimeout(t);
  }, [player, hasPayoutData]);

  const handleRedeem = async (all: boolean) => {
    setRedeeming(true);
    setError(null);
    try {
      const res = await fetch('/api/wallet/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(all ? { all: true } : { tickets: clampedQty }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'No se pudo canjear');
        return;
      }
      setNotice(`🎫 ¡Listo! Canjeaste ${data.redeemed} ticket(s).`);
      setRedeemQty(1);
      refresh();
      await loadWallet();
    } catch {
      setError('Error de conexión');
    } finally {
      setRedeeming(false);
    }
  };

  const handleWithdraw = async () => {
    const amount = Number(withdrawAmount);
    setError(null);
    if (!Number.isFinite(amount) || amount < MIN_WITHDRAWAL_USD) {
      setError(`El monto mínimo de retiro es $${MIN_WITHDRAWAL_USD.toFixed(2)}`);
      return;
    }
    if (amount > balance) {
      setError('El monto sobrepasa el saldo de tu billetera.');
      return;
    }
    setWithdrawing(true);
    try {
      const res = await fetch('/api/wallet/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'No se pudo solicitar el retiro');
        return;
      }
      // Antes de recargar la lista: si no tenía retiros previos, este es
      // su primer retiro (la lista trae los 15 más recientes; 0 = ninguno).
      setPrimerRetiro(withdrawals.length === 0);
      setWithdrawAmount('');
      setWithdrawModal(true);
      refresh();
      await loadWallet();
    } catch {
      setError('Error de conexión');
    } finally {
      setWithdrawing(false);
    }
  };

  // Al cerrar el modal de "retiro solicitado" se invita a referir, pero
  // SOLO si de verdad fue su primer retiro (además triggerInvite ya evita
  // repetir con su propia guarda). Se hace al cerrar para no montar un
  // modal encima de otro.
  const cerrarRetiroModal = () => {
    setWithdrawModal(false);
    if (primerRetiro) triggerInvite('firstwithdraw');
  };

  const handleSavePayout = async () => {
    setSavingPayout(true);
    setError(null);
    try {
      const res = await fetch('/api/wallet/payout-info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payoutForm),
      });
      if (res.ok) setNotice('✅ Datos guardados correctamente.');
      else setError('No se pudieron guardar los datos');
    } catch {
      setError('Error de conexión');
    } finally {
      setSavingPayout(false);
    }
  };

  return (
    <div className="wallet-main">
      <motion.h1
        className="wallet-title"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
      >
        👛 Mi Billetera
      </motion.h1>

      {notice && (
        <div className="wallet-notice" onClick={() => setNotice(null)}>
          {notice}
        </div>
      )}
      {error && (
        <div className="auth-error" onClick={() => setError(null)}>
          ⚠️ {error}
        </div>
      )}

      <div className="wallet-grid">
        {/* ── Tickets ── */}
        <section className="wallet-card">
          <h2 className="wallet-card-title">🎫 Tickets Disponibles</h2>
          <p className="wallet-big">{tickets}</p>
          <p className="wallet-sub">
            Valor: {fmt(tickets * TICKET_PRICE_USD)}
          </p>
          {hasPending && (
            <div className="wallet-pending">
              ⏳ Tienes {pendingPurchases.length} pago{pendingPurchases.length > 1 ? 's' : ''} en
              revisión. Se acreditarán solos apenas el banco confirme.
              <button className="btn-mini" onClick={handleRecheck} disabled={checking}>
                {checking ? 'Verificando…' : 'Verificar ahora'}
              </button>
            </div>
          )}
          <button
            className="btn-primary"
            onClick={() => setBuyOpen(true)}
            disabled={hasPending}
          >
            Comprar más tickets
          </button>
          {hasPending && (
            <p className="wallet-sub">
              Tienes una compra en proceso de verificación: podrás comprar más tickets cuando
              se confirme.
            </p>
          )}
        </section>

        {/* ── Premios / Retiro ── */}
        <section className="wallet-card" ref={seccionRetiro}>
          <h2 className="wallet-card-title">🏆 Premios Ganados</h2>
          <p className="wallet-big">{fmt(balance)}</p>
          <p className="wallet-sub">
            Saldo retirable: se acumula con cada partida ganada
            {referidos.total > 0 ? ' y con cada amigo que invitas' : ''}.
          </p>

          {/* De dónde ha salido su dinero. Son totales de TODA su
              historia, no un trozo del saldo de ahora: el saldo es un
              solo bolsillo y decir "de estos $8, $3 son de referidos"
              obligaría a inventar qué dólar se gasta primero.
              Solo aparece si de verdad ha invitado a alguien. */}
          {referidos.total > 0 && (
            <div className="wallet-origen">
              <p className="wallet-origen-titulo">Todo lo que has ganado, por dónde entró</p>
              <div className="wallet-origen-fila">
                <span>🗝️ Jugando</span>
                <strong>{fmt(Number(player?.total_won ?? 0))}</strong>
              </div>
              <div className="wallet-origen-fila">
                <span>🤝 Por tus referidos</span>
                <strong>{fmt(referidos.total)}</strong>
              </div>
            </div>
          )}

          <div className="wallet-inner">
            <p className="wallet-inner-title">💸 Retirar dinero</p>

            {/* Límite de retiros diarios: barra de niveles según las
                partidas de hoy + registro del día. Se reinicia cada
                medianoche (hora de Caracas). */}
            <div className="retiro-niveles">
              <div className="rn-bar">
                {RETIRO_NIVELES.map((n) => {
                  const estado =
                    n.nivel < nivelActual ? 'done' : n.nivel === nivelActual ? 'curr' : 'lock';
                  return (
                    <div key={n.nivel} className={`rn-step rn-${n.nivel} rn-${estado}`}>
                      <span className="rn-badge">
                        {estado === 'lock' ? '🔒' : estado === 'done' ? '✓' : n.nivel}
                      </span>
                      <span className="rn-nivel">Nivel {n.nivel}</span>
                      <span className="rn-partidas">{n.partidasLabel}</span>
                      <span className="rn-desbloquea">
                        Desbloquea: {n.retiros} {n.retiros === 1 ? 'retiro' : 'retiros'}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="rn-registro">
                <p className="rn-registro-title">Registro de hoy</p>
                <div className="rn-registro-cards">
                  <div className="rn-card">
                    Hoy has hecho <strong>{partidasHoy}</strong>{' '}
                    {partidasHoy === 1 ? 'partida' : 'partidas'}.
                  </div>
                  <div className="rn-card">
                    Has realizado <strong>{retirosHoy}</strong> de <strong>{retirosMax}</strong>{' '}
                    {retirosMax === 1 ? 'retiro' : 'retiros'} de hoy.
                  </div>
                </div>
              </div>
            </div>

            {/* El freno de la recuperación va PRIMERO: si está activo,
                no tiene sentido enseñarle el campo del monto para que
                se lo rechace el servidor. */}
            {retiroEnPausa ? (
              <p className="wallet-hold">
                🔐 Puedes retirar {HORAS_FRENO_RETIRO} horas después de haber recuperado tu
                cuenta. Mientras tanto puedes jugar y comprar tickets con normalidad. Podrás
                pedir tu retiro a partir de las{' '}
                <strong>{fmtDate(retiroLibreDesde(player!.password_reset_at!).toISOString())}</strong>.
              </p>
            ) : pendingWithdrawal ? (
              <p className="wallet-pending">
                Retiro solicitado — {fmt(Number(pendingWithdrawal.amount_usd))} · en proceso.
                Podrás solicitar otro cuando sea pagado.
              </p>
            ) : !hasPayoutData ? (
              <p className="wallet-sub">
                ⚠️ Para retirar, primero guarda tus datos de Pago Móvil más abajo, en «💳 Datos
                para recibir tus premios».
              </p>
            ) : balance < MIN_WITHDRAWAL_USD ? (
              <p className="wallet-sub">
                No tienes saldo disponible para retirar. ¡Gana partidas para acumular premios!
              </p>
            ) : limiteAlcanzado ? (
              <p className="wallet-hold">
                🔒 Alcanzaste tu límite de retiros de hoy (
                {retirosMax === 1 ? '1 retiro' : `${retirosMax} retiros`}).{' '}
                {retirosMax < 3
                  ? 'Juega más partidas hoy para desbloquear más.'
                  : 'El límite se reinicia cada noche: vuelve mañana.'}
              </p>
            ) : (
              <div className="wallet-row">
                <input
                  className="ref-input wallet-amount-input"
                  type="number"
                  min={MIN_WITHDRAWAL_USD}
                  max={balance}
                  step="0.01"
                  placeholder={`Monto ($${MIN_WITHDRAWAL_USD.toFixed(2)} mín.)`}
                  value={withdrawAmount}
                  onChange={(e) => setWithdrawAmount(e.target.value)}
                />
                <button className="btn-primary" onClick={handleWithdraw} disabled={withdrawing}>
                  {withdrawing ? 'Enviando…' : 'Retirar'}
                </button>
              </div>
            )}
          </div>
        </section>

        {/* ── Canjear saldo por tickets ── */}
        <section className="wallet-card">
          <h2 className="wallet-card-title">🎟️ Canjear saldo por tickets</h2>
          {maxRedeem < 1 ? (
            <p className="wallet-sub">
              Aún no tienes saldo para canjear (1 ticket = {fmt(TICKET_PRICE_USD)}). ¡Gana
              partidas para ganar premios! 🏆
            </p>
          ) : (
            <>
              <p className="wallet-sub">
                1 ticket = {fmt(TICKET_PRICE_USD)}. Tienes {fmt(balance)} (hasta {maxRedeem}{' '}
                ticket{maxRedeem > 1 ? 's' : ''}).
              </p>
              <div className="qty-row">
                <button
                  className="qty-btn"
                  onClick={() => setRedeemQty((q) => Math.max(1, q - 1))}
                >
                  −
                </button>
                <div className="qty-value">
                  <span className="qty-number">{clampedQty}</span>
                  <span className="qty-label">ticket{clampedQty > 1 ? 's' : ''}</span>
                </div>
                <button
                  className="qty-btn"
                  onClick={() => setRedeemQty((q) => Math.min(maxRedeem, q + 1))}
                >
                  +
                </button>
              </div>
              {/* Vista previa en tiempo real del canje */}
              <p className="redeem-preview">
                Canjeas {fmt(clampedQty * TICKET_PRICE_USD)} → te quedarían{' '}
                <strong>{fmt(balance - clampedQty * TICKET_PRICE_USD)}</strong> de saldo y{' '}
                <strong>
                  {tickets + clampedQty} ticket{tickets + clampedQty > 1 ? 's' : ''}
                </strong>
              </p>
              <div className="wallet-row">
                <button
                  className="btn-primary"
                  onClick={() => handleRedeem(false)}
                  disabled={redeeming}
                >
                  {redeeming ? 'Canjeando…' : `Canjear ${clampedQty}`}
                </button>
                <button
                  className="btn-secondary"
                  onClick={() => handleRedeem(true)}
                  disabled={redeeming}
                >
                  Todo a tickets ({maxRedeem})
                </button>
              </div>
            </>
          )}
        </section>

        {/* ── Datos de cobro ── */}
        <section className="wallet-card" ref={seccionDatos}>
          <h2 className="wallet-card-title">🏦 Datos para recibir tus premios</h2>
          <p className="wallet-sub">
            Si retiras, te pagamos por Pago Móvil a estos datos. Complétalos para que podamos
            pagarte sin demoras.
          </p>
          <div className="payout-form">
            <input
              className="ref-input"
              placeholder="Nombre completo"
              value={payoutForm.name}
              onChange={(e) => setPayoutForm((f) => ({ ...f, name: e.target.value }))}
            />
            <select
              className="ref-input"
              value={payoutForm.bank}
              onChange={(e) => setPayoutForm((f) => ({ ...f, bank: e.target.value }))}
            >
              <option value="">Selecciona tu banco</option>
              {VE_BANKS.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
            {/* La cédula de cobro es la del registro: se muestra
                bloqueada (y el servidor la reescribe con la del
                registro aunque el navegador mande otra) */}
            <div className={registeredCedula ? 'ref-locked' : undefined}>
              <input
                className={`ref-input ${registeredCedula ? 'ref-input-locked' : ''}`}
                placeholder="Cédula (Ej: V-12345678)"
                value={payoutForm.cedula}
                onChange={(e) => setPayoutForm((f) => ({ ...f, cedula: e.target.value }))}
                readOnly={!!registeredCedula}
                aria-readonly={!!registeredCedula}
                tabIndex={registeredCedula ? -1 : undefined}
                title={
                  registeredCedula
                    ? 'La cédula es la de tu registro y no se puede cambiar'
                    : undefined
                }
              />
              {registeredCedula && <span className="ref-locked-icon">🔒</span>}
            </div>
            {registeredCedula && (
              <p className="ref-hint">
                🔒 Tu cédula viene de tu registro y no se puede editar. Si hay un
                error, escríbenos por el chat de atención.
              </p>
            )}
            <input
              className="ref-input"
              placeholder="Teléfono (Ej: 04121234567)"
              value={payoutForm.phone}
              onChange={(e) => setPayoutForm((f) => ({ ...f, phone: e.target.value }))}
            />
            <button className="btn-primary" onClick={handleSavePayout} disabled={savingPayout}>
              {savingPayout ? 'Guardando…' : 'Guardar datos de pago'}
            </button>
          </div>
        </section>
      </div>

      {/* ── Historial de compras ── */}
      <section className="wallet-history">
        <h2 className="wallet-card-title">🧾 Historial de Compras</h2>
        {purchases.length === 0 ? (
          <p className="wallet-sub">No tienes compras registradas aún.</p>
        ) : (
          <ul className="history-list">
            {purchases.map((p) => (
              <li key={p.id} className="history-item">
                <div className="history-line">
                  <span className={`status-badge status-${p.status}`}>
                    {PURCHASE_STATUS_LABEL[p.status]}
                  </span>
                  <strong>+{p.quantity} Ticket{p.quantity > 1 ? 's' : ''}</strong>
                  <span>{fmt(Number(p.amount_usd))}</span>
                  <span className="history-date">{fmtDate(p.created_at)}</span>
                </div>
                <div className="history-sub">
                  Ref: {p.reference}
                  {p.status === 'rechazado' && p.status_note ? ` · Nota: ${p.status_note}` : ''}
                  {(p.status === 'pendiente' || p.status === 'validando') && (
                    <>
                      {' '}
                      · ⏳ En revisión: te sumaremos los tickets cuando el banco confirme tu pago
                      (suele tardar 1–2 minutos).
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Historial de retiros ── */}
      <section className="wallet-history">
        <h2 className="wallet-card-title">💸 Historial de Retiros</h2>
        {withdrawals.length === 0 ? (
          <p className="wallet-sub">Aún no has solicitado retiros.</p>
        ) : (
          <ul className="history-list">
            {withdrawals.map((w) => (
              <li key={w.id} className="history-item">
                <div className="history-line">
                  <span className={`status-badge status-${w.status === 'pagado' ? 'aprobado' : w.status === 'cancelado' ? 'rechazado' : 'pendiente'}`}>
                    {WITHDRAWAL_STATUS_LABEL[w.status]}
                  </span>
                  <strong>{fmt(Number(w.amount_usd))}</strong>
                  <span className="history-date">{fmtDate(w.created_at)}</span>
                </div>
                {w.reference && <div className="history-sub">Ref. del pago: {w.reference}</div>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <BuyTicketsModal
        open={buyOpen}
        onClose={() => {
          setBuyOpen(false);
          loadWallet();
        }}
        onApproved={loadWallet}
      />

      {/* Confirmación de retiro */}
      {withdrawModal && (
        <div className="modal-overlay" onClick={cerrarRetiroModal}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-icon">💸</div>
            <h2 className="modal-title">Retiro solicitado</h2>
            <p className="modal-subtitle">
              Su retiro se hará efectivo en un plazo de 15 a 30 minutos.
            </p>
            <button className="btn-primary" onClick={cerrarRetiroModal}>
              Entendido
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
