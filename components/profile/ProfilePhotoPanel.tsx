'use client';

import { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { usePlayer } from '@/components/providers/PlayerProvider';
import { avatarUrlFor } from '@/lib/profile/avatar';

// Reduce la foto a un cuadrado de 512 px (JPEG) antes de subirla:
// recorte centrado y peso final de ~50-150 KB, suba lo que suba el
// jugador (fotos de cámara de varios MB incluidas).
async function toSquareJpeg(file: File, size = 512): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('No se pudo leer la imagen'));
      i.src = url;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const sx = (img.naturalWidth - side) / 2;
    const sy = (img.naturalHeight - side) / 2;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = Math.min(size, side);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No se pudo procesar la imagen');
    ctx.drawImage(img, sx, sy, side, side, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('No se pudo procesar la imagen'))),
        'image/jpeg',
        0.85
      )
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Página Foto de perfil: muestra la foto actual (o la inicial del
// nombre si no hay) y permite colocarla o cambiarla.
export default function ProfilePhotoPanel() {
  const { player } = usePlayer();
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [broken, setBroken] = useState(false);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ ok: boolean; msg: string } | null>(null);

  if (!player) return null;
  const src = preview ?? avatarUrlFor(player.id);
  const initial = (player.username || 'J').charAt(0).toUpperCase();
  const hasPhoto = !broken || preview !== null;

  const onPick = async (f: File | null) => {
    if (!f) return;
    if (!f.type.startsWith('image/')) {
      setFlash({ ok: false, msg: 'El archivo debe ser una imagen' });
      return;
    }
    setBusy(true);
    setFlash(null);
    try {
      const blob = await toSquareJpeg(f);
      const form = new FormData();
      form.append('file', new File([blob], 'avatar.jpg', { type: 'image/jpeg' }));
      const res = await fetch('/api/profile/photo', { method: 'POST', body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'No se pudo subir la foto');
      setPreview(json.url); // con ?v= para romper la caché
      setBroken(false);
      setFlash({ ok: true, msg: '✅ ¡Foto de perfil actualizada!' });
    } catch (e) {
      setFlash({ ok: false, msg: e instanceof Error ? e.message : 'No se pudo subir la foto' });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="profile-main">
      <motion.h1 className="wallet-title" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        🖼️ Foto de perfil
      </motion.h1>
      <motion.div
        className="profile-card"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="profile-avatar">
          {!broken ? (
            // eslint-disable-next-line @next/next/no-img-element -- storage externo, sin optimizador
            <img src={src} alt="Tu foto de perfil" onError={() => setBroken(true)} />
          ) : (
            <span className="profile-avatar-letter">{initial}</span>
          )}
        </div>
        <p className="profile-name">{player.username || 'Jugador'}</p>
        <p className="admin-hint">
          Tu foto se ve en un círculo: se recorta al centro y se reduce sola. Máximo 5 MB.
        </p>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => onPick(e.target.files?.[0] ?? null)}
        />
        <button
          className="btn-mini btn-gold"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          {busy ? 'Subiendo…' : hasPhoto ? '📷 Cambiar foto' : '📷 Colocar foto'}
        </button>
        {flash && <p className={flash.ok ? 'profile-ok' : 'buy-error'}>{flash.msg}</p>}
      </motion.div>
    </div>
  );
}
