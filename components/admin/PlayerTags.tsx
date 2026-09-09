'use client';

import { useCallback, useEffect, useState } from 'react';
import { PlayerTag, PlayerTagColor } from '@/types/game';

interface PlayerTagsProps {
  playerId: string;
  /** Compacto: chips pequeños en una sola línea */
  compact?: boolean;
  /** Se llama tras crear, editar o borrar (para refrescar la lista) */
  onChanged?: () => void;
}

const COLORS: { key: PlayerTagColor; label: string }[] = [
  { key: 'neutral', label: 'Gris' },
  { key: 'gold', label: 'Dorado' },
  { key: 'green', label: 'Verde' },
  { key: 'red', label: 'Rojo' },
  { key: 'blue', label: 'Azul' },
];

// Etiquetas y notas internas del equipo sobre un jugador
// ("testimonio pedido", "prefiere Pago Móvil", "pago corto sin cobrar"…).
// Son PRIVADAS: el jugador nunca las ve. Salen en su ficha, se abra
// desde donde se abra (Usuarios, Transacciones, Interacciones…).
export default function PlayerTags({ playerId, compact, onChanged }: PlayerTagsProps) {
  const [tags, setTags] = useState<PlayerTag[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [warning, setWarning] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  // null = editor cerrado · 'new' = etiqueta nueva · id = editando esa
  const [editing, setEditing] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [note, setNote] = useState('');
  const [color, setColor] = useState<PlayerTagColor>('neutral');

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/tags?player_id=${playerId}`, { cache: 'no-store' });
      const data = await res.json();
      if (res.ok) {
        setTags(data.tags ?? []);
        setSuggestions(data.suggestions ?? []);
        setWarning(data.warning ?? null);
      }
    } catch {
    } finally {
      setLoaded(true);
    }
  }, [playerId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga asíncrona
    load();
  }, [load]);

  const closeEditor = () => {
    setEditing(null);
    setLabel('');
    setNote('');
    setColor('neutral');
    setNotice(null);
  };

  const openNew = (preset?: string) => {
    setEditing('new');
    setLabel(preset ?? '');
    setNote('');
    setColor('neutral');
    setNotice(null);
  };

  const openEdit = (t: PlayerTag) => {
    setEditing(t.id);
    setLabel(t.label);
    setNote(t.note ?? '');
    setColor(t.color);
    setNotice(null);
  };

  const send = async (body: Record<string, unknown>) => {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch('/api/admin/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setNotice(data.error || 'No se pudo guardar');
        return false;
      }
      await load();
      onChanged?.();
      return true;
    } catch {
      setNotice('Error de conexión');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    const value = label.trim();
    if (!value) {
      setNotice('Escribe la etiqueta');
      return;
    }
    const ok =
      editing === 'new'
        ? await send({ action: 'add', player_id: playerId, label: value, note, color })
        : await send({ action: 'update', id: editing, label: value, note, color });
    if (ok) closeEditor();
  };

  const remove = async (t: PlayerTag) => {
    if (!confirm(`¿Eliminar la etiqueta "${t.label}"?`)) return;
    const ok = await send({ action: 'delete', id: t.id });
    if (ok && editing === t.id) closeEditor();
  };

  if (!loaded && tags.length === 0) return null;

  return (
    <div className={`ptags ${compact ? 'ptags-compact' : ''}`}>
      <div className="ptags-row">
        {!compact && <span className="ptags-title">🏷️ Etiquetas y notas</span>}
        {tags.map((t) => (
          <button
            key={t.id}
            className={`ptag ptag-${t.color} ${editing === t.id ? 'ptag-open' : ''}`}
            title={t.note || 'Sin nota'}
            onClick={() => (editing === t.id ? closeEditor() : openEdit(t))}
          >
            {t.label}
            {t.note ? ' 📝' : ''}
          </button>
        ))}
        <button className="ptag ptag-add" onClick={() => (editing === 'new' ? closeEditor() : openNew())}>
          {editing === 'new' ? '✕' : '＋ Etiqueta'}
        </button>
      </div>

      {/* Nota completa de cada etiqueta, para leerla sin abrir el editor */}
      {!compact && tags.some((t) => t.note) && editing === null && (
        <ul className="ptags-notes">
          {tags
            .filter((t) => t.note)
            .map((t) => (
              <li key={t.id}>
                <strong>{t.label}:</strong> {t.note}
              </li>
            ))}
        </ul>
      )}

      {warning && <p className="ptags-warning">{warning}</p>}

      {editing !== null && (
        <div className="ptags-editor">
          <input
            className="chat-input"
            value={label}
            maxLength={40}
            placeholder="Etiqueta (ej. testimonio pedido)"
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save();
              if (e.key === 'Escape') closeEditor();
            }}
            autoFocus
          />
          <textarea
            className="ptags-note-input"
            value={note}
            maxLength={500}
            rows={2}
            placeholder="Nota (opcional): detalles para el equipo…"
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="ptags-colors">
            {COLORS.map((c) => (
              <button
                key={c.key}
                className={`ptag-dot ptag-${c.key} ${color === c.key ? 'ptag-dot-on' : ''}`}
                title={c.label}
                aria-label={c.label}
                onClick={() => setColor(c.key)}
              />
            ))}
          </div>

          {editing === 'new' && suggestions.length > 0 && (
            <div className="ptags-suggest">
              <span className="admin-hint">Usadas antes:</span>
              {suggestions.map((s) => (
                <button key={s} className="ptag ptag-neutral" onClick={() => setLabel(s)}>
                  {s}
                </button>
              ))}
            </div>
          )}

          {notice && <p className="ptags-warning">{notice}</p>}

          <div className="ptags-actions">
            <button className="btn-mini btn-mini-active" disabled={busy} onClick={save}>
              {editing === 'new' ? 'Agregar' : 'Guardar'}
            </button>
            <button className="btn-mini" disabled={busy} onClick={closeEditor}>
              Cancelar
            </button>
            {editing !== 'new' && (
              <button
                className="btn-mini btn-danger"
                disabled={busy}
                onClick={() => {
                  const t = tags.find((x) => x.id === editing);
                  if (t) remove(t);
                }}
              >
                🗑 Eliminar
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
