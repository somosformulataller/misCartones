'use client';

import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import PlayerDetail from './PlayerDetail';

interface PlayerDetailModalProps {
  /** null = cerrado */
  playerId: string | null;
  username?: string | null;
  onClose: () => void;
  /** Tras una acción que cambió datos (tickets, saldo, bloqueo) */
  onChanged?: () => void;
  /** La cuenta fue eliminada: el modal se cierra solo */
  onDeleted?: () => void;
}

// Ficha del jugador en MODAL (antes se desplegaba tipo acordeón bajo
// su fila, lo que empujaba la tabla y en móvil dejaba la información a
// media pantalla). Se cierra con la ✕, con Escape o tocando fuera.
// En escritorio y tablet es una tarjeta centrada; en móvil ocupa casi
// toda la pantalla y hace scroll por dentro.
export default function PlayerDetailModal({
  playerId,
  username,
  onClose,
  onChanged,
  onDeleted,
}: PlayerDetailModalProps) {
  // Escape cierra · el fondo no se desplaza mientras está abierto
  useEffect(() => {
    if (!playerId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const previo = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previo;
    };
  }, [playerId, onClose]);

  return (
    <AnimatePresence>
      {playerId && (
        <motion.div
          className="modal-overlay pdetail-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={onClose}
        >
          <motion.div
            className="modal-card pdetail-modal"
            role="dialog"
            aria-modal="true"
            aria-label={`Ficha de ${username || 'jugador'}`}
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            onClick={(e) => e.stopPropagation()}
          >
            <button className="pdetail-modal-close" onClick={onClose} aria-label="Cerrar ficha">
              ✕
            </button>
            <PlayerDetail
              playerId={playerId}
              username={username}
              onChanged={onChanged}
              onDeleted={onDeleted}
            />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
