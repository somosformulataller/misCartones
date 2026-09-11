'use client';

import { useEffect, useState } from 'react';

interface ChatAttachmentProps {
  path: string;
  name: string | null;
  type: string | null;
}

// Muestra un adjunto del chat: imagen (miniatura que abre en grande),
// nota de voz (reproductor) o documento (enlace 📎). El archivo vive
// en un bucket privado, así que primero se pide un enlace firmado.
export default function ChatAttachment({ path, name, type }: ChatAttachmentProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  /** El archivo está, pero el navegador no sabe dibujarlo/reproducirlo */
  const [roto, setRoto] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/chat/attachment?path=${encodeURIComponent(path)}`);
        const data = await res.json();
        if (!alive) return;
        if (res.ok && data.url) setUrl(data.url);
        else setFailed(true);
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [path]);

  if (failed) return <span className="chat-attach-error">📎 Adjunto no disponible</span>;
  if (!url) return <span className="chat-attach-loading">📎 Cargando…</span>;

  if (type?.startsWith('image/')) {
    // Las imágenes que se suban de ahora en adelante llegan ya en JPEG
    // (lib/images/preparar). Pero las que YA están guardadas en HEIC no
    // se pueden convertir hacia atrás, y el navegador solo enseña el
    // icono de rota. Aquí se les da salida: se dice qué pasa y se deja
    // abrirlas, que en el teléfono o con el visor del sistema sí se ven.
    if (roto) {
      return (
        <a href={url} target="_blank" rel="noopener noreferrer" className="chat-attach-doc">
          🖼️ {name ?? 'Imagen'} — tócala para abrirla
          <span className="chat-attach-nota">
            Está en formato de iPhone (HEIC) y el navegador no la dibuja.
          </span>
        </a>
      );
    }
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="chat-attach-img-link">
        {/* eslint-disable-next-line @next/next/no-img-element -- enlace firmado temporal, no optimizable */}
        <img
          src={url}
          alt={name ?? 'Imagen'}
          className="chat-attach-img"
          onError={() => setRoto(true)}
        />
      </a>
    );
  }

  if (type?.startsWith('audio/')) {
    // Si el navegador no sabe reproducir ese códec, el reproductor sale
    // en blanco y no hay forma de escuchar la nota: mejor un enlace.
    if (roto) {
      return (
        <a href={url} target="_blank" rel="noopener noreferrer" className="chat-attach-doc">
          🎧 {name ?? 'Nota de voz'} — tócala para escucharla
        </a>
      );
    }
    return (
      <audio
        controls
        src={url}
        className="chat-attach-audio"
        preload="metadata"
        onError={() => setRoto(true)}
      />
    );
  }

  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="chat-attach-doc">
      📎 {name ?? 'Documento'}
    </a>
  );
}
