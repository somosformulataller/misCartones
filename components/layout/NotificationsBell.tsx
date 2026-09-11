'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { createClient } from '@/lib/supabase/client';
import { usePlayer } from '@/components/providers/PlayerProvider';

interface NotificationItem {
  id: string;
  icon: string;
  text: string;
  at: string;
}

function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'ahora';
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  return `hace ${Math.floor(s / 86400)} d`;
}

// Campanita del header. Jugador: estado de sus compras y retiros.
// Admin: TODO lo de la app (chat, compras, retiros, registros) con
// refresco más frecuente y tiempo real para el chat. El contador
// marca las no leídas (última lectura guardada en el equipo).
export default function NotificationsBell() {
  const { player, isStaff: isAdmin } = usePlayer();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [open, setOpen] = useState(false);
  const [lastSeen, setLastSeen] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const seenKey = player ? `mc_notif_seen_${player.id}` : null;

  // Última lectura persistida (por jugador, en este dispositivo)
  useEffect(() => {
    if (!seenKey) return;
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLastSeen(localStorage.getItem(seenKey));
    } catch {}
  }, [seenKey]);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications', { cache: 'no-store' });
      const data = await res.json();
      setItems(data.notifications ?? []);
    } catch {}
  }, []);

  // Cargar al entrar y refrescar solo (admin más seguido). Con la
  // pestaña OCULTA no consulta; al volver a ella recarga al instante.
  useEffect(() => {
    if (!player) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    const interval = setInterval(() => {
      if (document.hidden) return;
      load();
    }, isAdmin ? 20_000 : 120_000);
    const onVisible = () => {
      if (!document.hidden) load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [player, isAdmin, load]);

  // Admin: los mensajes del chat encienden la campana AL INSTANTE
  // (Supabase Realtime sobre chat_messages, migración 007)
  useEffect(() => {
    if (!player || !isAdmin) return;
    const supabase = createClient();
    if (!supabase) return;
    const channel = supabase
      .channel('bell-rt-admin')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages' },
        () => load()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [player, isAdmin, load]);

  // Cerrar al tocar fuera o con Escape
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!player) return null;

  const unread = items.filter((n) => !lastSeen || n.at > lastSeen).length;

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) {
      // Abrir la campanita marca todo como leído
      const now = new Date().toISOString();
      setLastSeen(now);
      if (seenKey) {
        try {
          localStorage.setItem(seenKey, now);
        } catch {}
      }
      load();
    }
  };

  return (
    <div className="menu-wrap bell-wrap" ref={wrapRef}>
      <button
        className="bell-btn"
        onClick={toggle}
        aria-label={`Notificaciones${unread > 0 ? ` (${unread} sin leer)` : ''}`}
        aria-expanded={open}
      >
        🔔
        {unread > 0 && <span className="bell-badge">{unread > 9 ? '9+' : unread}</span>}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            className="menu-list notif-list"
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
          >
            <p className="notif-title">🔔 Notificaciones</p>
            {items.length === 0 ? (
              <p className="notif-empty">
                {isAdmin
                  ? 'Sin novedades todavía. Aquí verás mensajes del chat, compras, retiros y registros nuevos.'
                  : 'Sin notificaciones todavía. Aquí verás el estado de tus compras de tickets y retiros.'}
              </p>
            ) : (
              items.map((n) => (
                <div key={n.id} className="notif-item">
                  <span className="notif-icon">{n.icon}</span>
                  <div className="notif-body">
                    <p className="notif-text">{n.text}</p>
                    <span className="notif-time">{timeAgo(n.at)}</span>
                  </div>
                </div>
              ))
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
