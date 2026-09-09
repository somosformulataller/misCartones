'use client';

import { useState } from 'react';
import { avatarUrlFor } from '@/lib/profile/avatar';

// Círculo con la foto de perfil del jugador; si no tiene foto (o la
// carga falla) muestra la inicial de su nombre. Se usa en el chat del
// panel y en la ficha del jugador.
export default function PlayerAvatar({
  playerId,
  name,
  size = 32,
}: {
  playerId: string;
  name?: string | null;
  size?: number;
}) {
  // Derivado por jugador: si cambia el id, se reintenta la foto
  const [brokenFor, setBrokenFor] = useState<string | null>(null);
  const broken = brokenFor === playerId;
  return (
    <span
      className="pavatar"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.45) }}
      aria-hidden
    >
      {!broken ? (
        // eslint-disable-next-line @next/next/no-img-element -- storage externo, sin optimizador
        <img src={avatarUrlFor(playerId)} alt="" onError={() => setBrokenFor(playerId)} />
      ) : (
        (name || 'J').charAt(0).toUpperCase()
      )}
    </span>
  );
}
