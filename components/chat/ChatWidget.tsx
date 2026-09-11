'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AnimatePresence, motion } from 'framer-motion';
import { createClient } from '@/lib/supabase/client';
import { usePlayer } from '@/components/providers/PlayerProvider';
import { ChatMessage, ChatQuickQuestion } from '@/types/chat';
import ChatAttachment from './ChatAttachment';
import { prepararImagen } from '@/lib/images/preparar';
import AudioRecorder from './AudioRecorder';
import ChatComposerInput from './ChatComposerInput';
import LinkedText from './LinkedText';

const MAX_SIZE = 5 * 1024 * 1024;

// Chat de atención al cliente (lado JUGADOR): botón 💬 Soporte con
// contador de no leídos, en la esquina inferior derecha del header
// (junto a la campanita). El panel se abre debajo, como desplegable.
// Aparece en TODAS las pantallas (incluido el juego, con la calle apagada
// o encendida), solo con sesión iniciada. Sin mensajes automáticos. Se
// actualiza por tiempo real y, de respaldo, por sondeo (10 s abierto /
// 60 s cerrado). Al equipo el mismo 💬 le lleva al chat del panel, con
// sus mensajes sin leer (`staffUnread`, que cuenta el header).
export default function ChatWidget({ staffUnread = 0 }: { staffUnread?: number }) {
  const { player, isStaff: isAdmin } = usePlayer();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [quick, setQuick] = useState<ChatQuickQuestion[]>([]);
  const [unread, setUnread] = useState(0);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const openRef = useRef(false);

  // El sondeo lee el estado abierto/cerrado desde una ref para
  // descartar respuestas que llegan tras cambiar de estado
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  const load = useCallback(async (markRead: boolean) => {
    try {
      const res = await fetch(`/api/chat${markRead ? '?read=1' : ''}`, { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      if (markRead !== openRef.current) return; // cambió de estado mientras cargaba
      setMessages(data.messages ?? []);
      setQuick(data.quickQuestions ?? []);
      setUnread(markRead ? 0 : (data.unread ?? 0));
    } catch {}
  }, []);

  // Sondeo de RESPALDO: cerrado revisa cada 60 s; abierto cada 10 s.
  // Con la pestaña OCULTA no consulta (una PWA/pestaña en segundo plano
  // gastaba requests para nada); al volver a la pestaña recarga al
  // instante. Realtime sigue trayendo los mensajes al momento mientras
  // la miras, así que no se pierde nada.
  useEffect(() => {
    if (!player || isAdmin) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga asíncrona inicial
    load(open);
    const interval = setInterval(() => {
      if (document.hidden) return;
      load(openRef.current);
    }, open ? 10_000 : 60_000);
    const onVisible = () => {
      if (!document.hidden) load(openRef.current);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [player, isAdmin, open, load]);

  // TIEMPO REAL: cuando soporte escribe, el mensaje (y la burbuja
  // con el contador) llegan al instante. RLS filtra: el jugador solo
  // recibe eventos de SU conversación. Requiere la migración 007.
  const playerId = player?.id ?? null;
  useEffect(() => {
    if (!playerId || isAdmin) return;
    const supabase = createClient();
    if (!supabase) return;
    const channel = supabase
      .channel(`chat-rt-${playerId}`)
      // '*': además del mensaje nuevo, las correcciones y los
      // borrados que haga soporte se reflejan al instante
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'chat_messages' },
        () => load(openRef.current)
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [playerId, isAdmin, load]);

  // Autoscroll al final cuando llegan mensajes
  const msgCount = messages.length;
  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [open, msgCount]);

  if (!player) return null;
  if (isAdmin) {
    return (
      <div className="chat-wrap">
        <Link
          href="/admin/chat"
          className="chat-fab"
          aria-label={`Chat de atención${staffUnread > 0 ? ` (${staffUnread} sin leer)` : ''}`}
        >
          💬<span className="chat-fab-label">Chat</span>
          {staffUnread > 0 && (
            <span className="chat-fab-badge">{staffUnread > 9 ? '9+' : staffUnread}</span>
          )}
        </Link>
      </div>
    );
  }

  const send = async (body: {
    text?: string;
    attachment?: { path: string; name: string; type: string };
  }) => {
    setSending(true);
    setNotice(null);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setNotice(data.error ?? 'No se pudo enviar el mensaje');
        return false;
      }
      if (data.message) setMessages((prev) => [...prev, data.message]);
      return true;
    } catch {
      setNotice('No se pudo enviar el mensaje');
      return false;
    } finally {
      setSending(false);
    }
  };

  const sendText = async (raw: string) => {
    const value = raw.trim();
    if (!value || sending) return;
    const ok = await send({ text: value });
    if (ok) setText('');
  };

  const sendFile = async (original: File) => {
    setNotice(null);
    setUploading(true);
    try {
      // Los iPhone mandan HEIC y ningún navegador de escritorio sabe
      // dibujarlo: se pasa a JPEG aquí, en el teléfono que sí sabe
      // leerlo. De paso encoge las fotos grandes.
      const file = await prepararImagen(original);
      if (file.size > MAX_SIZE) {
        setNotice('El archivo supera los 5 MB.');
        return;
      }
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/chat/upload', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) {
        setNotice(data.error ?? 'No se pudo subir el archivo');
        return;
      }
      await send({ attachment: { path: data.path, name: data.name, type: data.type } });
    } catch {
      setNotice('No se pudo subir el archivo');
    } finally {
      setUploading(false);
    }
  };

  const toggle = () => {
    const next = !open;
    openRef.current = next;
    setOpen(next);
    if (next) {
      setUnread(0);
      load(true);
    }
  };

  return (
    <div className="chat-wrap">
      <button
        className="chat-fab"
        onClick={toggle}
        aria-label={`Soporte${unread > 0 ? ` (${unread} sin leer)` : ''}`}
        aria-expanded={open}
      >
        💬<span className="chat-fab-label">Soporte</span>
        {!open && unread > 0 && (
          <span className="chat-fab-badge">{unread > 9 ? '9+' : unread}</span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            className="chat-panel"
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
          >
            <div className="chat-head">
              <div>
                <p className="chat-title">Atención al cliente</p>
                <p className="chat-subtitle">Escríbenos tu duda 👋</p>
              </div>
              <button className="chat-close" onClick={() => setOpen(false)} aria-label="Cerrar chat">
                ✕
              </button>
            </div>

            <div className="chat-msgs">
              {messages.length === 0 && (
                <p className="chat-empty">
                  ¡Hola! ¿En qué te ayudamos? Puedes tocar una pregunta rápida o escribirnos.
                </p>
              )}
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`chat-msg ${m.sender === 'player' ? 'chat-msg-own' : 'chat-msg-support'}`}
                >
                  {m.attachment_path && (
                    <ChatAttachment
                      path={m.attachment_path}
                      name={m.attachment_name}
                      type={m.attachment_type}
                    />
                  )}
                  {m.body && (
                    <p className="chat-msg-text">
                      <LinkedText text={m.body} />
                    </p>
                  )}
                  {m.edited_at && <span className="chat-msg-time">editado</span>}
                </div>
              ))}
              {messages.length === 0 && quick.length > 0 && (
                <div className="chat-quick">
                  {quick.map((q) => (
                    <button
                      key={q.id}
                      className="chat-quick-btn"
                      onClick={() => sendText(q.question)}
                      disabled={sending}
                    >
                      {q.question}
                    </button>
                  ))}
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            {notice && <p className="chat-notice">{notice}</p>}

            <div className="chat-composer">
              <input
                ref={fileRef}
                type="file"
                accept="image/*,application/pdf"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) sendFile(f);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                className="chat-icon-btn"
                onClick={() => fileRef.current?.click()}
                disabled={uploading || sending}
                aria-label="Adjuntar imagen o PDF"
              >
                {uploading ? '…' : '📎'}
              </button>
              <AudioRecorder disabled={uploading || sending} onRecorded={sendFile} onError={setNotice} />
              <ChatComposerInput
                value={text}
                onChange={setText}
                onSend={() => sendText(text)}
                placeholder="Escribe tu mensaje…"
              />
              <button
                type="button"
                className="chat-icon-btn chat-icon-send"
                onClick={() => sendText(text)}
                disabled={!text.trim() || sending}
                aria-label="Enviar"
              >
                ➤
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
