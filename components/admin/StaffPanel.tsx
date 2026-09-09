'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { StaffRow } from '@/types/game';
import { PANEL_AREAS, PanelArea } from '@/lib/admin/areas';

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString('es', { day: '2-digit', month: 'short', year: 'numeric' });

// Áreas que se pueden asignar a una cuenta de atención al cliente. Se
// dejan fuera las tres que nunca ve (Equipo, y Resumen y Métrica
// histórica, que son los números del negocio): ofrecerlas en las
// casillas solo servía para marcar algo que luego el servidor ignora.
// Por defecto una cuenta nueva de atención las trae TODAS marcadas: es
// gente que necesita el panel para trabajar, y dejarse una sin marcar
// se traducía en un trozo del panel cerrado sin explicación.
const ASSIGNABLE = PANEL_AREAS.filter(
  (a) => a.key !== 'equipo' && a.key !== 'resumen' && a.key !== 'metricas'
);
const AREAS_POR_DEFECTO = ASSIGNABLE.map((a) => a.key);

// Gestión del equipo del panel (solo rol admin): crear cuentas de
// administrador o de atención al cliente y asignarles qué áreas del
// panel pueden ver.
export default function StaffPanel({ myId }: { myId: string }) {
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  // Formulario de alta
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [role, setRole] = useState<'support' | 'admin'>('support');
  const [areas, setAreas] = useState<PanelArea[]>(AREAS_POR_DEFECTO);

  // Edición de áreas de una cuenta existente
  const [editing, setEditing] = useState<string | null>(null);
  const [editAreas, setEditAreas] = useState<PanelArea[]>([]);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/staff', { cache: 'no-store' });
      const data = await res.json();
      if (res.ok) setStaff(data.staff ?? []);
    } catch {}
  }, []);

  useEffect(() => {
    // Carga asíncrona: el setState ocurre tras el fetch
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const toggleArea = (list: PanelArea[], set: (v: PanelArea[]) => void, area: PanelArea) => {
    set(list.includes(area) ? list.filter((a) => a !== area) : [...list, area]);
  };

  const post = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const res = await fetch('/api/admin/staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'No se pudo completar la acción');
        return false;
      }
      return true;
    } catch {
      setError('Error de conexión');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const createAccount = async () => {
    if (role === 'support' && areas.length === 0) {
      setError('Asigna al menos un área a la cuenta de atención');
      return;
    }
    const done = await post({
      action: 'create',
      email,
      password,
      username,
      role,
      // Un admin sin restricciones ve todo el panel
      areas: role === 'admin' ? undefined : areas,
    });
    if (done) {
      setOk(`Cuenta creada: ${email} (guarda la contraseña, no se vuelve a mostrar)`);
      setEmail('');
      setPassword('');
      setUsername('');
      await load();
    }
  };

  const startEdit = (s: StaffRow) => {
    setEditing(s.id);
    setEditAreas(
      (s.panel_areas as PanelArea[] | null) ??
        (s.role === 'admin' ? ASSIGNABLE.map((a) => a.key) : AREAS_POR_DEFECTO)
    );
  };

  const saveEdit = async (s: StaffRow) => {
    if (s.role === 'support' && editAreas.length === 0) {
      setError('Una cuenta de atención necesita al menos un área');
      return;
    }
    // Un admin con TODAS las áreas marcadas queda sin restricciones
    // (panel_areas NULL): conserva también el acceso a Equipo.
    const unrestricted = s.role === 'admin' && editAreas.length === ASSIGNABLE.length;
    const done = await post({
      action: 'update',
      player_id: s.id,
      role: s.role,
      areas: unrestricted ? undefined : editAreas,
    });
    if (done) {
      setEditing(null);
      setOk('Áreas actualizadas');
      await load();
    }
  };

  const removeAccount = async (s: StaffRow) => {
    if (!confirm(`¿Eliminar la cuenta del panel de ${s.username || s.email || s.id.slice(0, 8)}?`))
      return;
    const done = await post({ action: 'delete', player_id: s.id });
    if (done) {
      setOk('Cuenta eliminada');
      await load();
    }
  };

  const areaLabel = (key: string) =>
    PANEL_AREAS.find((a) => a.key === key)?.label ?? key;

  return (
    <section className="admin-section">
      <h2 className="admin-section-title">🛡️ Equipo del panel</h2>
      <p className="admin-hint">
        Crea cuentas de <strong>atención al cliente</strong> (solo ven las áreas que les asignes)
        o de <strong>administrador</strong> (ven todo el panel). Estas cuentas no juegan.
      </p>

      {error && <div className="auth-error">⚠️ {error}</div>}
      {ok && <div className="staff-ok">✅ {ok}</div>}

      {/* ── Alta de cuenta ── */}
      <div className="staff-form">
        <div className="staff-form-grid">
          <input
            className="chat-input"
            placeholder="Correo de acceso"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="off"
          />
          <input
            className="chat-input"
            placeholder="Contraseña (mín. 8 caracteres)"
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="off"
          />
          <input
            className="chat-input"
            placeholder="Nombre visible (ej. Atención 1)"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <select
            className="chat-input"
            value={role}
            onChange={(e) => setRole(e.target.value as 'support' | 'admin')}
          >
            <option value="support">🎧 Atención al cliente</option>
            <option value="admin">👑 Administrador</option>
          </select>
        </div>

        {role === 'support' ? (
          <div className="staff-areas">
            <p className="staff-areas-title">Áreas que puede ver:</p>
            <div className="staff-areas-grid">
              {ASSIGNABLE.map((a) => (
                <label key={a.key} className="staff-area-check">
                  <input
                    type="checkbox"
                    checked={areas.includes(a.key)}
                    onChange={() => toggleArea(areas, setAreas, a.key)}
                  />
                  {a.label}
                </label>
              ))}
            </div>
          </div>
        ) : (
          <p className="admin-hint">Un administrador ve todas las áreas, incluida esta (Equipo).</p>
        )}

        <button
          className="btn-primary staff-create"
          onClick={createAccount}
          disabled={busy || !email || password.length < 8 || !username}
        >
          ＋ Crear cuenta
        </button>
      </div>

      {/* ── Cuentas existentes ── */}
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Cuenta</th>
              <th>Correo</th>
              <th>Rol</th>
              <th>Áreas</th>
              <th>Creada</th>
              <th className="admin-th-actions">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {staff.map((s) => (
              <Fragment key={s.id}>
                <tr>
                  <td>
                    {s.role === 'admin' ? '👑' : '🎧'} {s.username || s.id.slice(0, 8)}
                    {s.id === myId ? ' (tú)' : ''}
                  </td>
                  <td>{s.email ?? '—'}</td>
                  <td>{s.role === 'admin' ? 'Administrador' : 'Atención al cliente'}</td>
                  <td>
                    {s.role === 'admin' && !s.panel_areas
                      ? 'Todas'
                      : (s.panel_areas ?? []).map(areaLabel).join(' · ') || '—'}
                  </td>
                  <td>{fmtDate(s.created_at)}</td>
                  <td className="admin-actions">
                    {s.id !== myId && (
                      <>
                        <button
                          className="btn-mini"
                          disabled={busy}
                          onClick={() => (editing === s.id ? setEditing(null) : startEdit(s))}
                        >
                          ✏️ Áreas
                        </button>
                        <button
                          className="btn-mini btn-danger"
                          disabled={busy}
                          onClick={() => removeAccount(s)}
                        >
                          🗑 Eliminar
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              </Fragment>
            ))}
            {staff.length === 0 && (
              <tr>
                <td colSpan={6}>Cargando equipo…</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Edición de áreas FUERA de la tabla (que scrollea horizontal
          en móvil y cortaba los checkboxes): panel a ancho completo
          debajo, con sus botones de guardar/cancelar. */}
      {editing &&
        (() => {
          const s = staff.find((x) => x.id === editing);
          if (!s) return null;
          return (
            <div className="pdetail-wrap">
              <div className="pdetail">
                <p className="staff-areas-title">
                  Áreas que puede ver {s.username || s.id.slice(0, 8)}:
                </p>
                <div className="staff-areas-grid">
                  {ASSIGNABLE.map((a) => (
                    <label key={a.key} className="staff-area-check">
                      <input
                        type="checkbox"
                        checked={editAreas.includes(a.key)}
                        onChange={() => toggleArea(editAreas, setEditAreas, a.key)}
                      />
                      {a.label}
                    </label>
                  ))}
                </div>
                <div className="pdetail-actions">
                  <button className="btn-mini btn-ok" disabled={busy} onClick={() => saveEdit(s)}>
                    ✓ Guardar
                  </button>
                  <button className="btn-mini" disabled={busy} onClick={() => setEditing(null)}>
                    Cancelar
                  </button>
                </div>
              </div>
            </div>
          );
        })()}
    </section>
  );
}
