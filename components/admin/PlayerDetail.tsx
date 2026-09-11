'use client';

import Link from 'next/link';

import { useEffect, useState } from 'react';
import {
  AdminUserRow,
  PlayerHistory,
  PlayerHistoryAdjustment,
  PlayerHistoryGame,
  PlayerHistoryRecarga,
  PlayerHistoryRedemption,
  TicketPurchase,
  Withdrawal,
} from '@/types/game';
import { PURCHASE_STATUS_LABEL, VE_BANKS } from '@/lib/payments/constants';
import { normalizarBanco } from '@/lib/payments/bancos';
import PlayerAvatar from '@/components/profile/PlayerAvatar';
import PlayerTags from '@/components/admin/PlayerTags';
import ProofModal from '@/components/admin/ProofModal';

interface PlayerDetailProps {
  playerId: string;
  username?: string | null;
  /** Se llama tras una acción que cambió datos (tickets, bloqueo) */
  onChanged?: () => void;
  /** Se llama cuando la cuenta fue eliminada (para cerrar el detalle) */
  onDeleted?: () => void;
}

type HistoryTab =
  | 'partidas'
  | 'recargas'
  | 'retiros'
  | 'canjes'
  | 'ajustes'
  | 'referidos'
  | 'origenes';

/** Cómo se nombra cada tipo de ancla al enseñarla */
const ANCLA_LABEL: Record<string, string> = {
  cuenta4: 'cuenta',
  tel4: 'teléfono',
  cedula: 'cédula',
  nombre: 'nombre',
};

/** Cómo se nombra a quien hizo un ajuste, si su cuenta ya no existe */
const ROL_STAFF: Record<string, string> = {
  admin: 'Administrador',
  support: 'Atención al cliente',
};

// Filas por página en el historial (tiene que coincidir con el backend:
// /api/admin/users?...&tab=&page=N).
const HISTORIAL_POR_PAGINA = 50;

// Estado de paginación de UNA pestaña del historial.
interface PaginaTab {
  rows: unknown[];
  total: number;
  page: number;
  loading: boolean;
}

const fmt = (n: number) => `$${Number(n).toFixed(2)}`;
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString('es', { day: '2-digit', month: 'short', year: 'numeric' });
const fmtDateTime = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString('es', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';

/** Los campos que el panel deja corregir, en el orden del formulario */
const CAMPOS = [
  'first_name',
  'last_name',
  'cedula',
  'whatsapp',
  'email',
  'payout_name',
  'payout_bank',
  'payout_cedula',
  'payout_phone',
] as const;
type CampoEditable = (typeof CAMPOS)[number];

const FORM_VACIO = Object.fromEntries(CAMPOS.map((c) => [c, ''])) as Record<CampoEditable, string>;

/** Cómo se nombra cada campo al confirmar el cambio */
const ETIQUETA_CAMPO: Record<CampoEditable, string> = {
  first_name: 'Nombre',
  last_name: 'Apellido',
  cedula: 'Cédula',
  whatsapp: 'WhatsApp',
  email: 'Correo',
  payout_name: 'Titular de la cuenta',
  payout_bank: 'Banco para cobrar',
  payout_cedula: 'Cédula para cobrar',
  payout_phone: 'Teléfono Pago Móvil',
};

/** Una recarga pagada: cuántos tickets, cuánto costó, su referencia y
 *  —si el pago llegó corto— cuánto faltó y si ya se le cobró. */
function MovimientoCompra({
  p,
  onProof,
}: {
  p: TicketPurchase;
  onProof: (v: { id: string; reference: string | null }) => void;
}) {
  return (
    <div className="phistory-row">
      <span className="phistory-date">{fmtDateTime(p.created_at)}</span>
      <span>
        {p.quantity} 🎟️ · {fmt(Number(p.amount_usd))} · Ref {p.reference}
        {/* La captura del pago sigue disponible después de aprobar */}
        {p.has_proof && (
          <>
            {' · '}
            <button className="proof-link" onClick={() => onProof({ id: p.id, reference: p.reference })}>
              📎 Ver comprobante
            </button>
          </>
        )}
      </span>
      <strong>
        <span className={`status-badge status-${p.status}`}>
          {PURCHASE_STATUS_LABEL[p.status] ?? p.status}
        </span>
        {p.origin ? (p.origin === 'auto' ? ' · Auto' : ' · Manual') : ''}
      </strong>
      {p.falta != null && (
        <span className={`comp-chip ${p.falta_cobrada ? 'comp-chip-ok' : 'comp-chip-debe'}`}>
          {p.falta_cobrada ? '✅' : '⚠️'} pagó {fmt(p.falta)} de menos
          {p.falta_cobrada ? ' · ya cobrado de su saldo' : ' · SIN cobrar'}
        </span>
      )}
    </div>
  );
}

// Paginador del historial de partidas: anterior / siguiente + qué
// tramo se está viendo. Solo aparece cuando hay más de una página.
function Paginador({
  pagina,
  total,
  cargando,
  onIr,
}: {
  pagina: number;
  total: number;
  cargando: boolean;
  onIr: (p: number) => void;
}) {
  const paginas = Math.ceil(total / HISTORIAL_POR_PAGINA);
  const desde = pagina * HISTORIAL_POR_PAGINA + 1;
  const hasta = Math.min((pagina + 1) * HISTORIAL_POR_PAGINA, total);
  return (
    <div className="phistory-pager">
      <button
        className="btn-mini"
        disabled={pagina === 0 || cargando}
        onClick={() => onIr(pagina - 1)}
      >
        ‹ Anteriores
      </button>
      <span className="phistory-pager-info">
        {cargando ? 'Cargando…' : `${desde}–${hasta} de ${total} · pág. ${pagina + 1}/${paginas}`}
      </span>
      <button
        className="btn-mini"
        disabled={pagina + 1 >= paginas || cargando}
        onClick={() => onIr(pagina + 1)}
      >
        Siguientes ›
      </button>
    </div>
  );
}

const WITHDRAWAL_LABEL: Record<string, string> = {
  pendiente: '🕒 Pendiente',
  pagado: '✅ Pagado',
  cancelado: '↩️ Cancelado',
};

// Contenido de la ficha del jugador: sus datos, el HISTORIAL completo
// (jugadas, recargas con su comprobante, retiros, canjes, ajustes a
// mano, referidos y orígenes de pago) y las acciones. Se muestra dentro
// de PlayerDetailModal, y es la MISMA ficha se abra desde la tabla que
// se abra: quien atiende no tiene que aprenderse dos pantallas.
export default function PlayerDetail({
  playerId,
  username,
  onChanged,
  onDeleted,
}: PlayerDetailProps) {
  const [info, setInfo] = useState<AdminUserRow | null>(null);
  const [history, setHistory] = useState<PlayerHistory | null>(null);
  const [tab, setTab] = useState<HistoryTab>('partidas');
  const [busy, setBusy] = useState(false);
  // Cada pestaña del historial se pagina por su cuenta: la ficha puede
  // tener miles de partidas, recargas o canjes y no se cargan todas de
  // golpe. Aquí vive, por pestaña, la página visible, cuántas filas hay
  // en total, en qué página vamos y si está cargando.
  const [paginado, setPaginado] = useState<Record<string, PaginaTab>>({});
  // La ficha vive dentro de un modal (PlayerDetailModal): no necesita
  // acomodar la vista como cuando se desplegaba bajo la fila.

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/admin/users?id=${playerId}&full=1`, { cache: 'no-store' });
        const data = await res.json();
        if (alive && res.ok) {
          setInfo(data.user ?? null);
          setHistory(data.history ?? null);
        }
      } catch {}
    })();
    return () => {
      alive = false;
    };
  }, [playerId]);

  // Cuando llega (o se recarga) el historial, cada pestaña arranca con
  // su primera página y su total, ya incluidos en la respuesta.
  useEffect(() => {
    if (!history) {
      // El paginado es un espejo del historial que acaba de llegar del
      // servidor: si el historial se va, sus páginas se van con él, o la
      // ficha seguiría paginando filas de otro jugador.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPaginado({});
      return;
    }
    const p = (rows: unknown[], total: number): PaginaTab => ({ rows, total, page: 0, loading: false });
    setPaginado({
      partidas: p(history.games, history.games_total),
      recargas: p(history.recargas, history.recargas_total),
      retiros: p(history.withdrawals, history.withdrawals_total),
      canjes: p(history.redemptions, history.redemptions_total),
      ajustes: p(history.adjustments, history.adjustments_total),
      origenes: p(history.origenes, history.origenes_total),
    });
  }, [history]);

  // Cambiar de página de una pestaña: trae solo esa página, sin recargar
  // toda la ficha.
  const irAPagina = async (tabKey: HistoryTab, page: number) => {
    const st = paginado[tabKey];
    if (!st) return;
    const ultima = Math.ceil(st.total / HISTORIAL_POR_PAGINA) - 1;
    if (page < 0 || page > ultima || st.loading) return;
    setPaginado((prev) => ({ ...prev, [tabKey]: { ...prev[tabKey], loading: true } }));
    try {
      const res = await fetch(`/api/admin/users?id=${playerId}&tab=${tabKey}&page=${page}`, {
        cache: 'no-store',
      });
      const data = await res.json();
      setPaginado((prev) => ({
        ...prev,
        [tabKey]: res.ok
          ? { rows: data.rows ?? [], total: data.total ?? prev[tabKey].total, page, loading: false }
          : { ...prev[tabKey], loading: false },
      }));
    } catch {
      setPaginado((prev) => ({ ...prev, [tabKey]: { ...prev[tabKey], loading: false } }));
    }
  };

  // Tras un ajuste manual: el movimiento acaba de nacer y tiene que
  // aparecer en su pestaña sin que haya que cerrar y reabrir la ficha.
  const recargarHistorial = async () => {
    try {
      const res = await fetch(`/api/admin/users?id=${playerId}&full=1`, { cache: 'no-store' });
      const data = await res.json();
      if (res.ok) setHistory(data.history ?? null);
    } catch {}
  };

  const name = info?.username || username || playerId.slice(0, 8);

  // Comprobante de una recarga: se abre en su propio modal encima de
  // la ficha (la URL firmada la pide ese modal al abrirse).
  const [proof, setProof] = useState<{ id: string; reference: string | null } | null>(null);

  const action = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ player_id: playerId, ...body }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'No se pudo completar la acción');
        return null;
      }
      return data;
    } catch {
      alert('Error de conexión');
      return null;
    } finally {
      setBusy(false);
    }
  };

  // ── Corregir los datos del jugador ──
  // El formulario guarda TEXTO, no null: así el campo vacío y el campo
  // sin tocar se ven igual en pantalla. Al enviar se traduce a null.
  const [editando, setEditando] = useState(false);
  const [form, setForm] = useState<Record<CampoEditable, string>>(FORM_VACIO);

  const abrirEdicion = () => {
    if (!info) return;
    setForm({
      first_name: info.first_name ?? '',
      last_name: info.last_name ?? '',
      cedula: info.cedula ?? '',
      whatsapp: info.whatsapp ?? '',
      email: info.email ?? '',
      payout_name: info.payout_name ?? '',
      payout_bank: info.payout_bank ?? '',
      payout_cedula: info.payout_cedula ?? '',
      payout_phone: info.payout_phone ?? '',
    });
    setEditando(true);
  };

  const cambiar =
    (campo: CampoEditable) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((prev) => ({ ...prev, [campo]: e.target.value }));

  const guardarPerfil = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!info) return;

    // Solo viajan los campos que de verdad cambiaron: si el servidor
    // recibiera todos, cualquier limpieza suya (quitar guiones del
    // teléfono, por ejemplo) entraría en la bitácora como un cambio
    // que nadie hizo.
    const perfil: Record<string, string | null> = {};
    for (const campo of CAMPOS) {
      const antes = (info[campo] ?? '') as string;
      if (form[campo].trim() !== String(antes).trim()) {
        perfil[campo] = form[campo].trim() || null;
      }
    }
    if (!Object.keys(perfil).length) {
      setEditando(false);
      return;
    }

    // Los datos de cobro mueven dinero: se confirma enseñando qué
    // cambia, no un "¿seguro?" a ciegas.
    const resumen = Object.entries(perfil)
      .map(([c, v]) => `  · ${ETIQUETA_CAMPO[c as CampoEditable]}: ${(info[c as CampoEditable] as string) || '(vacío)'} → ${v ?? '(vacío)'}`)
      .join('\n');
    if (!confirm(`Vas a cambiar estos datos de ${name}:\n\n${resumen}\n\n¿Confirmas?`)) return;

    const data = await action({ action: 'update_profile', perfil });
    if (!data) return;
    setEditando(false);
    // Se relee la ficha: el servidor pudo normalizar (quitar el +58,
    // recomponer el nombre visible) y hay que enseñar lo que quedó.
    try {
      const res = await fetch(`/api/admin/users?id=${playerId}`, { cache: 'no-store' });
      const json = await res.json();
      if (res.ok && json.user) setInfo(json.user);
    } catch {}
    onChanged?.();
  };

  // El motivo NO es obligatorio, pero se pregunta siempre: es lo único
  // que meses después explica por qué aparecieron esos tickets. Queda
  // firmado con el nombre de quien ajusta.
  const pedirMotivo = (que: string) =>
    prompt(`¿Por qué ${que}?\n(queda registrado en la ficha con tu nombre)`) ?? '';

  const adjustTickets = async (sign: 1 | -1) => {
    const raw = prompt(
      `¿Cuántos tickets quieres ${sign === 1 ? 'RECARGAR a' : 'RESTAR a'} ${name}?`
    );
    if (!raw) return;
    const qty = Math.trunc(Number(raw));
    if (!Number.isFinite(qty) || qty <= 0) {
      alert('Escribe una cantidad válida');
      return;
    }
    const motivo = pedirMotivo(
      `le ${sign === 1 ? 'das' : 'quitas'} ${qty} ticket${qty === 1 ? '' : 's'} a ${name}`
    );
    const data = await action({ action: 'add_tickets', delta: qty * sign, motivo });
    if (data) {
      setInfo((prev) => (prev ? { ...prev, tickets: data.tickets } : prev));
      await recargarHistorial();
      onChanged?.();
    }
  };

  // Ajuste del saldo en dólares (acepta centavos): para pagos que no
  // cuadran exactos con el precio del ticket (ej. sobran $0.50).
  const adjustBalance = async (sign: 1 | -1) => {
    const raw = prompt(
      `¿Cuántos dólares quieres ${sign === 1 ? 'SUMAR al' : 'RESTAR del'} saldo de ${name}?\n` +
        '(acepta centavos, ej. 0.50)'
    );
    if (!raw) return;
    const amount = Number(raw.trim().replace(',', '.').replace('$', ''));
    if (!Number.isFinite(amount) || amount <= 0) {
      alert('Escribe un monto válido (ej. 0.50)');
      return;
    }
    const motivo = pedirMotivo(
      `le ${sign === 1 ? 'sumas' : 'restas'} ${fmt(amount)} de saldo a ${name}`
    );
    const data = await action({ action: 'add_balance', delta: amount * sign, motivo });
    if (data) {
      setInfo((prev) => (prev ? { ...prev, balance: data.balance } : prev));
      await recargarHistorial();
      onChanged?.();
    }
  };

  const toggleBlock = async () => {
    if (!info) return;
    const blocking = !info.blocked;
    if (
      !confirm(
        blocking
          ? `¿Bloquear a ${name}? No podrá entrar, jugar, comprar, canjear ni retirar.`
          : `¿Desbloquear a ${name}?`
      )
    )
      return;
    const data = await action({ action: blocking ? 'block' : 'unblock' });
    if (data) {
      setInfo((prev) => (prev ? { ...prev, blocked: data.blocked } : prev));
      onChanged?.();
    }
  };

  /** Pasa la cuenta de ESTE pago a ser la habitual del jugador.
   *  Aprobar un pago no lo hace solo, a propósito: cambiar la cuenta de
   *  referencia es una decisión, no un efecto secundario. */
  const fijarOrigen = async (p: TicketPurchase) => {
    const desde = [p.ocr_bank, p.ocr_origin].filter(Boolean).join(' · ');
    if (
      !confirm(
        `¿Fijar esta cuenta como la habitual de ${name}?\n\n${desde}\n\n` +
          'A partir de ahora sus pagos desde aquí pasarán solos, y los de cualquier otro banco irán a revisión.'
      )
    )
      return;
    const data = await action({ action: 'fijar_origen', purchase_id: p.id });
    if (data) await recargarHistorial();
  };

  const removeUser = async () => {
    if (
      !confirm(
        `⚠️ ¿ELIMINAR la cuenta de ${name}?\n\nSe borra TODO: su acceso, saldo, tickets, historial, compras y retiros. Esta acción no se puede deshacer.`
      )
    )
      return;
    if (!confirm(`Última confirmación: eliminar definitivamente a ${name}.`)) return;
    const data = await action({ action: 'delete' });
    if (data) onDeleted?.();
  };

  if (!info)
    return (
      <div className="pdetail pdetail-loading">
        Cargando datos de {name}…
      </div>
    );

  const houseTake = Number(info.total_wagered) - Number(info.total_won);
  const compensacion = history?.compensacion ?? null;
  const referidos = history?.referidos ?? null;
  const cobrosReferidos = history?.cobros_referidos ?? [];
  // Su cuenta bancaria habitual (la lista de pagos con origen va abajo,
  // paginada como las demás pestañas).
  const huella = history?.origen ?? null;
  // Sumatoria de lo dado y quitado a mano (viene del servidor, sobre
  // TODOS los ajustes, no solo la página visible).
  const totales =
    history?.ajustes_totales ?? {
      ticketsDados: 0,
      ticketsQuitados: 0,
      saldoDado: 0,
      saldoQuitado: 0,
    };

  // Cada pestaña lee su página del estado paginado (rows tipados según
  // la pestaña).
  const VACIA: PaginaTab = { rows: [], total: 0, page: 0, loading: false };
  const pPartidas = paginado.partidas ?? VACIA;
  const pRecargas = paginado.recargas ?? VACIA;
  const pRetiros = paginado.retiros ?? VACIA;
  const pCanjes = paginado.canjes ?? VACIA;
  const pAjustes = paginado.ajustes ?? VACIA;
  const pOrigenes = paginado.origenes ?? VACIA;

  const partidas = pPartidas.rows as PlayerHistoryGame[];
  const movimientosTickets = pRecargas.rows as PlayerHistoryRecarga[];
  const withdrawals = pRetiros.rows as Withdrawal[];
  const redemptions = pCanjes.rows as PlayerHistoryRedemption[];
  const adjustments = pAjustes.rows as PlayerHistoryAdjustment[];
  const conOrigen = pOrigenes.rows as TicketPurchase[];

  const TABS: { key: HistoryTab; label: string; count: number }[] = [
    { key: 'partidas', label: '🗝️ Jugadas', count: pPartidas.total },
    { key: 'recargas', label: '🎫 Recargas', count: pRecargas.total },
    { key: 'retiros', label: '💸 Retiros', count: pRetiros.total },
    { key: 'canjes', label: '🔄 Canjes', count: pCanjes.total },
    { key: 'ajustes', label: '⚖️ Ajustes a mano', count: pAjustes.total },
    { key: 'referidos', label: '🤝 Referidos', count: cobrosReferidos.length },
    { key: 'origenes', label: '🏦 Orígenes', count: pOrigenes.total },
  ];

  return (
    <div className="pdetail">
      <div className="pdetail-head">
        <PlayerAvatar playerId={playerId} name={name} size={48} />
        <strong className="pdetail-head-name">{name}</strong>
      </div>

      {/* Etiquetas y notas internas del equipo sobre este jugador */}
      <PlayerTags playerId={playerId} onChanged={onChanged} />

      <div className="pdetail-grid">
        <div className="pdetail-item">
          <span>Correo</span>
          <strong>{info.email ?? '—'}</strong>
        </div>
        <div className="pdetail-item">
          <span>WhatsApp</span>
          <strong>{info.whatsapp ?? '—'}</strong>
        </div>
        <div className="pdetail-item">
          <span>Cédula</span>
          <strong>{info.cedula ?? '—'}</strong>
        </div>
        <div className="pdetail-item">
          <span>Estado</span>
          <strong>
            {info.blocked ? <span className="badge-blocked">Bloqueado</span> : 'Activo'}
          </strong>
        </div>
        <div className="pdetail-item">
          <span>Saldo</span>
          <strong>{fmt(info.balance)}</strong>
        </div>
        <div className="pdetail-item">
          <span>Tickets</span>
          <strong>🎟️ {info.tickets}</strong>
        </div>
        <div className="pdetail-item">
          <span>Apostado</span>
          <strong>{fmt(info.total_wagered)}</strong>
        </div>
        <div className="pdetail-item">
          <span>Premios ganados</span>
          <strong>{fmt(info.total_won)}</strong>
        </div>
        {/* Su saldo mezcla lo que gana jugando con lo que gana
            invitando. Aquí se separa: son totales de toda su historia,
            no un trozo del saldo de hoy. */}
        {referidos && referidos.total > 0 && (
          <div className="pdetail-item">
            <span>Ganado por referidos</span>
            <strong className="admin-win">
              {fmt(referidos.total)}
              <em className="pdetail-nota">
                {' '}
                · {referidos.cobros} amigo{referidos.cobros === 1 ? '' : 's'}
              </em>
            </strong>
          </div>
        )}
        <div className="pdetail-item">
          <span>Ganancia nuestra</span>
          <strong className={houseTake >= 0 ? 'admin-win' : 'admin-lose'}>
            {houseTake >= 0 ? '+' : '−'}
            {fmt(Math.abs(houseTake))}
          </strong>
        </div>
        <div className="pdetail-item">
          <span>Registro</span>
          <strong>{fmtDate(info.created_at)}</strong>
        </div>
      </div>

      {/* ── ¿Se le cobró lo que faltó en sus pagos? ──
          Se deduce sola del cuadre del saldo (lib/admin/compensacion),
          no de que alguien lo anotara. Va aquí arriba a propósito: la
          ficha se abre justo antes de pagarle un retiro, y esta es la
          línea que decide si se le puede pagar entero. */}
      {compensacion && compensacion.faltante > 0 && (
        <div className={`comp-aviso ${compensacion.pendiente > 0 ? 'comp-debe' : 'comp-ok'}`}>
          <p className="comp-titulo">
            {compensacion.pendiente > 0
              ? `⚠️ Le falta pagar ${fmt(compensacion.pendiente)}`
              : '✅ Sus pagos cortos ya están cobrados'}
          </p>
          <p className="comp-cuentas">
            Pagó {fmt(compensacion.faltante)} de menos en {compensacion.cortas.length}{' '}
            recarga{compensacion.cortas.length === 1 ? '' : 's'} · se le descontó del saldo{' '}
            {fmt(Math.min(compensacion.descontado, compensacion.faltante))}
            {compensacion.pendiente > 0
              ? ` · quedan ${fmt(compensacion.pendiente)} por cobrarle`
              : ' · no queda nada pendiente'}
          </p>
          {compensacion.ajustes > 0 && (
            <p className="comp-pistas">
              {compensacion.ajustes} descuento{compensacion.ajustes === 1 ? '' : 's'} de saldo
              anotado{compensacion.ajustes === 1 ? '' : 's'} en su ficha
            </p>
          )}
        </div>
      )}

      {/* ── Corregir los datos del jugador ──
          Cerrado por defecto: la ficha se abre sobre todo para MIRAR,
          y un formulario siempre visible invita a tocar sin querer
          campos con los que se le paga a alguien. */}
      {!editando ? (
        <button className="btn-mini pdetail-editar" onClick={abrirEdicion} disabled={busy}>
          ✏️ Corregir datos
        </button>
      ) : (
        <form className="pedit" onSubmit={guardarPerfil}>
          <p className="pedit-aviso">
            Corrige lo que el jugador escribió mal. Los <strong>datos para cobrar</strong> son a
            donde se le pagan sus premios: revísalos dos veces. Todo cambio queda registrado con
            tu nombre y el valor anterior.
          </p>

          <div className="pedit-grid">
            <label>
              Nombre
              <input value={form.first_name} onChange={cambiar('first_name')} maxLength={40} />
            </label>
            <label>
              Apellido
              <input value={form.last_name} onChange={cambiar('last_name')} maxLength={40} />
            </label>
            <label>
              Cédula
              <input value={form.cedula} onChange={cambiar('cedula')} inputMode="numeric" placeholder="28730098" />
            </label>
            <label>
              WhatsApp
              <input value={form.whatsapp} onChange={cambiar('whatsapp')} inputMode="tel" placeholder="04121234567" />
            </label>
            <label className="pedit-ancho">
              Correo <span className="pedit-nota">— con esto inicia sesión</span>
              <input value={form.email} onChange={cambiar('email')} type="email" placeholder="jugador@correo.com" />
            </label>
          </div>

          <p className="pedit-titulo">💸 Datos para cobrar sus premios</p>
          <div className="pedit-grid">
            <label>
              Titular de la cuenta
              <input value={form.payout_name} onChange={cambiar('payout_name')} maxLength={40} />
            </label>
            <label>
              Banco
              <select value={form.payout_bank} onChange={cambiar('payout_bank')}>
                <option value="">— sin banco —</option>
                {VE_BANKS.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Cédula del titular
              <input value={form.payout_cedula} onChange={cambiar('payout_cedula')} inputMode="numeric" />
            </label>
            <label>
              Teléfono Pago Móvil
              <input value={form.payout_phone} onChange={cambiar('payout_phone')} inputMode="tel" />
            </label>
          </div>

          <div className="pedit-acciones">
            <button type="submit" className="btn-mini btn-ok" disabled={busy}>
              ✓ Guardar cambios
            </button>
            <button type="button" className="btn-mini" onClick={() => setEditando(false)} disabled={busy}>
              Cancelar
            </button>
          </div>
        </form>
      )}

      {/* ── Historial del jugador ── */}
      {history && (
        <div className="phistory">
          <div className="phistory-tabs">
            {TABS.map((t) => (
              <button
                key={t.key}
                className={`btn-mini ${tab === t.key ? 'btn-mini-active' : ''}`}
                onClick={() => setTab(t.key)}
              >
                {t.label} ({t.count})
              </button>
            ))}
          </div>

          <div className="phistory-list">
            {tab === 'partidas' &&
              (pPartidas.total === 0 ? (
                <p className="phistory-empty">Sin jugadas todavía</p>
              ) : (
                <>
                  {pPartidas.total > HISTORIAL_POR_PAGINA && (
                    <Paginador
                      pagina={pPartidas.page}
                      total={pPartidas.total}
                      cargando={pPartidas.loading}
                      onIr={(p) => irAPagina('partidas', p)}
                    />
                  )}
                  {partidas.map((g) => (
                    <div key={g.id} className="phistory-row">
                      <span className="phistory-date">{fmtDateTime(g.created_at)}</span>
                      <span>
                        💰 {g.bags_count} bolsa{g.bags_count === 1 ? '' : 's'}
                      </span>
                      <strong className={Number(g.payout) > 0 ? 'admin-win' : 'admin-lose'}>
                        Premio {fmt(Number(g.payout))}
                      </strong>
                    </div>
                  ))}
                </>
              ))}

            {tab === 'recargas' &&
              (pRecargas.total === 0 ? (
                <p className="phistory-empty">Sin recargas todavía</p>
              ) : (
                <>
                  {pRecargas.total > HISTORIAL_POR_PAGINA && (
                    <Paginador
                      pagina={pRecargas.page}
                      total={pRecargas.total}
                      cargando={pRecargas.loading}
                      onIr={(p) => irAPagina('recargas', p)}
                    />
                  )}
                  {movimientosTickets.map((m) =>
                  m.tipo === 'mano' ? (
                    // Tickets que puso o quitó el equipo: no hubo pago
                    <div key={`a${m.a.id}`} className="phistory-row phistory-mano">
                      <span className="phistory-date">{fmtDateTime(m.a.created_at)}</span>
                      <strong className={m.a.delta > 0 ? 'admin-win' : 'admin-lose'}>
                        {m.a.delta > 0 ? '＋' : '−'}
                        {Math.abs(m.a.delta)} 🎟️
                      </strong>
                      <span className="phistory-quien">
                        sin pago · por {m.a.made_by_name ?? ROL_STAFF[m.a.made_by_role ?? ''] ?? 'el equipo'}
                        {m.a.made_by_name && m.a.made_by_role ? (
                          <em> ({ROL_STAFF[m.a.made_by_role] ?? m.a.made_by_role})</em>
                        ) : null}
                      </span>
                      <strong>
                        <span className="status-badge status-mano">A MANO</span>
                      </strong>
                      {m.a.motivo && <span className="phistory-motivo">«{m.a.motivo}»</span>}
                    </div>
                  ) : (
                    <MovimientoCompra key={m.p.id} p={m.p} onProof={setProof} />
                  )
                  )}
                </>
              ))}

            {tab === 'referidos' &&
              (cobrosReferidos.length === 0 ? (
                <p className="phistory-empty">No ha cobrado ningún premio de referido</p>
              ) : (
                <>
                  <div className="phistory-row phistory-total">
                    <span>Ganado invitando</span>
                    <strong className="admin-win">{fmt(referidos?.total ?? 0)}</strong>
                  </div>
                  {cobrosReferidos.map((c) => (
                    <div key={c.id} className="phistory-row">
                      <span className="phistory-date">{fmtDateTime(c.created_at)}</span>
                      <strong className="admin-win">＋{fmt(c.amount_usd)}</strong>
                      <span>
                        por <strong>{c.nombre ?? 'un amigo'}</strong>
                        <span className="phistory-quien"> · {c.partidas} partidas</span>
                      </span>
                      <strong>💰 A su saldo</strong>
                    </div>
                  ))}
                </>
              ))}

            {tab === 'retiros' &&
              (pRetiros.total === 0 ? (
                <p className="phistory-empty">Sin retiros todavía</p>
              ) : (
                <>
                  {pRetiros.total > HISTORIAL_POR_PAGINA && (
                    <Paginador
                      pagina={pRetiros.page}
                      total={pRetiros.total}
                      cargando={pRetiros.loading}
                      onIr={(p) => irAPagina('retiros', p)}
                    />
                  )}
                  {withdrawals.map((w) => (
                    <div key={w.id} className="phistory-row">
                      <span className="phistory-date">{fmtDateTime(w.created_at)}</span>
                      <span>
                        {fmt(Number(w.amount_usd))}
                        {w.reference ? ` · Ref ${w.reference}` : ''}
                      </span>
                      <strong>{WITHDRAWAL_LABEL[w.status] ?? w.status}</strong>
                    </div>
                  ))}
                </>
              ))}

            {tab === 'canjes' &&
              (pCanjes.total === 0 ? (
                <p className="phistory-empty">Sin canjes todavía</p>
              ) : (
                <>
                  {pCanjes.total > HISTORIAL_POR_PAGINA && (
                    <Paginador
                      pagina={pCanjes.page}
                      total={pCanjes.total}
                      cargando={pCanjes.loading}
                      onIr={(p) => irAPagina('canjes', p)}
                    />
                  )}
                  {redemptions.map((r) => (
                    <div key={r.id} className="phistory-row">
                      <span className="phistory-date">{fmtDateTime(r.created_at)}</span>
                      <span>
                        {fmt(Number(r.amount_usd))} de saldo → {r.quantity} 🎟️
                      </span>
                      <strong>✅ Canjeado</strong>
                    </div>
                  ))}
                </>
              ))}

            {/* Tickets y saldo que el equipo puso o quitó a mano: no
                son compras, ni canjes, ni premios, y sin esta pestaña
                aparecen en la cuenta sin que nada los explique. */}
            {tab === 'ajustes' &&
              (pAjustes.total === 0 ? (
                <p className="phistory-empty">
                  A esta cuenta no se le ha dado ni quitado nada a mano
                </p>
              ) : (
                <>
                  <div className="phistory-row phistory-total">
                    <span>Total ajustado a mano</span>
                    {(totales.ticketsDados > 0 || totales.ticketsQuitados > 0) && (
                      <span>
                        🎟️{' '}
                        {totales.ticketsDados > 0 && (
                          <strong className="admin-win">+{totales.ticketsDados}</strong>
                        )}
                        {totales.ticketsDados > 0 && totales.ticketsQuitados > 0 && ' · '}
                        {totales.ticketsQuitados > 0 && (
                          <strong className="admin-lose">−{totales.ticketsQuitados}</strong>
                        )}
                      </span>
                    )}
                    {(totales.saldoDado > 0 || totales.saldoQuitado > 0) && (
                      <span>
                        💵{' '}
                        {totales.saldoDado > 0 && (
                          <strong className="admin-win">+{fmt(totales.saldoDado)}</strong>
                        )}
                        {totales.saldoDado > 0 && totales.saldoQuitado > 0 && ' · '}
                        {totales.saldoQuitado > 0 && (
                          <strong className="admin-lose">−{fmt(totales.saldoQuitado)}</strong>
                        )}
                      </span>
                    )}
                  </div>
                  {pAjustes.total > HISTORIAL_POR_PAGINA && (
                    <Paginador
                      pagina={pAjustes.page}
                      total={pAjustes.total}
                      cargando={pAjustes.loading}
                      onIr={(p) => irAPagina('ajustes', p)}
                    />
                  )}
                  {adjustments.map((a) => {
                    const dio = Number(a.delta) > 0;
                    const cuanto =
                      a.tipo === 'tickets'
                        ? `${Math.abs(Number(a.delta))} 🎟️`
                        : fmt(Math.abs(Number(a.delta)));
                    return (
                      <div key={a.id} className="phistory-row">
                        <span className="phistory-date">{fmtDateTime(a.created_at)}</span>
                        <strong className={dio ? 'admin-win' : 'admin-lose'}>
                          {dio ? '＋' : '−'}
                          {cuanto}
                        </strong>
                        <span className="phistory-quien">
                          por {a.made_by_name ?? ROL_STAFF[a.made_by_role ?? ''] ?? 'el equipo'}
                          {a.made_by_name && a.made_by_role ? (
                            <em> ({ROL_STAFF[a.made_by_role] ?? a.made_by_role})</em>
                          ) : null}
                        </span>
                        {a.motivo && <span className="phistory-motivo">«{a.motivo}»</span>}
                      </div>
                    );
                  })}
                </>
              ))}

            {/* Desde dónde paga. La idea es que sea siempre el mismo
                sitio: si cambia, el pago va a revisión y se decide
                aquí. */}
            {tab === 'origenes' && (
              <>
                <div className="origen-huella">
                  {huella ? (
                    <>
                      <div className="origen-huella-cab">
                        <span>Su cuenta habitual</span>
                        <strong>
                          {huella.banco ?? 'banco desconocido'}
                          {huella.ancla
                            ? ` · ${ANCLA_LABEL[huella.ancla_tipo ?? ''] ?? ''} …${huella.ancla}`
                            : ''}
                        </strong>
                      </div>
                      <p className="origen-huella-pie">
                        {huella.fijado_por_nombre
                          ? `Fijada por ${huella.fijado_por_nombre}`
                          : 'Fijada sola con su primer pago'}{' '}
                        · {fmtDateTime(huella.fijado_at)}
                        {huella.muestra ? ` · el recibo decía «${huella.muestra}»` : ''}
                      </p>
                    </>
                  ) : (
                    <p className="phistory-empty">
                      Todavía no tiene una cuenta fijada: la fijará su primer pago del que se
                      pueda leer el origen.
                    </p>
                  )}
                </div>

                {pOrigenes.total > HISTORIAL_POR_PAGINA && (
                  <Paginador
                    pagina={pOrigenes.page}
                    total={pOrigenes.total}
                    cargando={pOrigenes.loading}
                    onIr={(p) => irAPagina('origenes', p)}
                  />
                )}
                {pOrigenes.total === 0 ? (
                  <p className="phistory-empty">
                    De ninguna de sus recargas se pudo leer desde dónde se pagó. Los pagos
                    anteriores al OCR no traen ese dato.
                  </p>
                ) : (
                  conOrigen.map((p) => {
                    // ¿Este pago vino del sitio de siempre?
                    const digs = String(p.ocr_origin ?? '').replace(/\D/g, '');
                    // Estado del pago frente a la huella:
                    //   'ok'      → coincide la cuenta exacta
                    //   'otro'    → cuenta/banco distinto al fijado
                    //   'banco'   → la huella es solo-banco (sembrada del
                    //               histórico, sin cuenta aún) y el banco
                    //               coincide: es su banco, aún sin afinar
                    //   'sincomp' → no hay con qué comparar (foto ilegible)
                    //   'primera' → todavía no tiene huella
                    const bancoPago =
                      normalizarBanco(p.ocr_bank) ?? normalizarBanco(p.ocr_origin_bank);
                    let estado: 'ok' | 'otro' | 'banco' | 'sincomp' | 'primera';
                    if (!huella) {
                      estado = 'primera';
                    } else if (huella.ancla) {
                      const suyo =
                        huella.ancla_tipo === 'nombre'
                          ? String(p.ocr_origin ?? '').toUpperCase().includes(huella.ancla)
                          : digs.endsWith(huella.ancla);
                      estado = suyo ? 'ok' : 'otro';
                    } else if (bancoPago && huella.banco && bancoPago !== huella.banco) {
                      estado = 'otro';
                    } else if (bancoPago && huella.banco && bancoPago === huella.banco) {
                      estado = 'banco';
                    } else {
                      estado = 'sincomp';
                    }
                    // El botón «fijar esta» solo tiene sentido cuando el
                    // pago NO es claramente el suyo.
                    const ofrecerFijar = estado === 'otro' || estado === 'banco';
                    return (
                      <div key={p.id} className="phistory-row">
                        <span className="phistory-date">{fmtDateTime(p.created_at)}</span>
                        <span>
                          {p.ocr_bank ?? p.ocr_origin_bank ?? '—'} · {p.ocr_origin}
                          {p.ocr_is_ubii ? ' · Ubii' : ''}
                          {p.ocr_origin_cedula ? ` · CI ${p.ocr_origin_cedula}` : ''}
                        </span>
                        <strong>
                          {estado === 'ok' && <span className="origen-ok">✓ la suya</span>}
                          {estado === 'banco' && (
                            <span className="origen-ok">✓ su banco ({huella?.banco})</span>
                          )}
                          {estado === 'otro' && <span className="origen-otro">⚠ otra cuenta</span>}
                          {estado === 'sincomp' && (
                            <span className="origen-ok">— sin comparar</span>
                          )}
                          {estado === 'primera' && <span className="origen-ok">— primera</span>}
                        </strong>
                        {ofrecerFijar && (
                          <button
                            className="btn-mini"
                            disabled={busy}
                            onClick={() => fijarOrigen(p)}
                          >
                            📌 Fijar esta como la suya
                          </button>
                        )}
                      </div>
                    );
                  })
                )}
              </>
            )}
          </div>
        </div>
      )}

      <div className="pdetail-actions">
        <button className="btn-mini" disabled={busy} onClick={() => adjustTickets(1)}>
          ＋ Tickets
        </button>
        <button className="btn-mini" disabled={busy} onClick={() => adjustTickets(-1)}>
          − Tickets
        </button>
        <button className="btn-mini" disabled={busy} onClick={() => adjustBalance(1)}>
          ＋ Saldo
        </button>
        <button className="btn-mini" disabled={busy} onClick={() => adjustBalance(-1)}>
          − Saldo
        </button>
        {/* Abre SU conversación (la crea si no existe, sin mandar nada). */}
        <Link className="btn-mini" href={`/admin/chat?player=${playerId}`}>
          💬 Chat
        </Link>
        <button className="btn-mini" disabled={busy} onClick={toggleBlock}>
          {info.blocked ? '✓ Desbloquear' : '🚫 Bloquear'}
        </button>
        <button className="btn-mini btn-danger" disabled={busy} onClick={removeUser}>
          🗑 Eliminar
        </button>
      </div>

      <ProofModal
        purchaseId={proof?.id ?? null}
        reference={proof?.reference}
        onClose={() => setProof(null)}
      />
    </div>
  );
}
