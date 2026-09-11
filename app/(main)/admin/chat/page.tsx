'use client';

import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { usePlayer } from '@/components/providers/PlayerProvider';
import {
  AdminChatListItem,
  ChatConversationStatus,
  ChatMessage,
  ChatQuickQuestion,
  ChatQuickReply,
  PlayerTag,
} from '@/types/chat';
import ChatAttachment from '@/components/chat/ChatAttachment';
import { prepararImagen } from '@/lib/images/preparar';
import AudioRecorder from '@/components/chat/AudioRecorder';
import ChatComposerInput from '@/components/chat/ChatComposerInput';
import LinkedText from '@/components/chat/LinkedText';
import AdminNav from '@/components/admin/AdminNav';
import PlayerDetailModal from '@/components/admin/PlayerDetailModal';
import PlayerTags from '@/components/admin/PlayerTags';
import PlayerAvatar from '@/components/profile/PlayerAvatar';
import { OrdenToggle, ordenar, useOrden } from '@/components/admin/OrdenLista';

const MAX_SIZE = 5 * 1024 * 1024;

const STATUS_LABEL: Record<ChatConversationStatus, string> = {
  pendiente: 'Pendiente',
  prioridad: 'Prioridad',
  resuelto: 'Resuelto',
};

interface ThreadInfo {
  id: string;
  player_id: string;
  status: ChatConversationStatus;
  username: string | null;
  email: string | null;
  tickets: number;
  tags?: PlayerTag[];
}

interface SearchResult {
  id: string;
  username: string | null;
  email: string | null;
}

const fmtDateTime = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString('es-VE', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });

// Día de un mensaje, para el separador de fechas del hilo. Sin esto,
// en un chat que dura varios días solo se veía la hora y no se sabía a
// qué día correspondía cada mensaje (ni la conversación).
const claveDia = (d: Date) => d.toLocaleDateString('es-VE');
const fmtDia = (iso: string) => {
  const d = new Date(iso);
  const hoy = new Date();
  const ayer = new Date(hoy);
  ayer.setDate(hoy.getDate() - 1);
  if (claveDia(d) === claveDia(hoy)) return 'Hoy';
  if (claveDia(d) === claveDia(ayer)) return 'Ayer';
  // "jueves, 13 de agosto de 2026" → solo la inicial en mayúscula
  // (capitalize del CSS pondría "13 De Agosto De", raro en español).
  const texto = d.toLocaleDateString('es-VE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  return texto.charAt(0).toUpperCase() + texto.slice(1);
};

// Iconos de moderación en trazo: a diferencia de los emoji, toman el
// color del botón (el de eliminar tiene que verse ROJO).
const IconPencil = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
);
const IconTrash = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 6h18" />
    <path d="M8 6V4h8v2" />
    <path d="M6 6l1 14h10l1-14" />
    <path d="M10 11v6M14 11v6" />
  </svg>
);

// Chat de atención al cliente (lado ADMIN): lista de conversaciones
// con etiquetas y no leídos, hilo con respuesta (texto/adjunto/nota de
// voz), buscador para iniciar chats y gestión de preguntas rápidas.
export default function AdminChatPage() {
  const { player, isLoading, isStaff: isAdmin } = usePlayer();
  const router = useRouter();

  const [tab, setTab] = useState<'convos' | 'questions'>('convos');
  const [conversations, setConversations] = useState<AdminChatListItem[]>([]);
  const [questions, setQuestions] = useState<ChatQuickQuestion[]>([]);
  const [filter, setFilter] = useState<'todos' | ChatConversationStatus>('todos');
  const [ordenChats, setOrdenChats] = useOrden('chats');
  const [selected, setSelected] = useState<string | null>(null);
  const [thread, setThread] = useState<ThreadInfo | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // Ficha del jugador en modal. Se abre desde el encabezado del hilo
  // y también desde el 👁 de cada conversación de la lista: en el
  // teléfono el hilo tapa la lista, así que ver los datos de alguien
  // no debería obligar a entrar en su chat.
  const [detail, setDetail] = useState<{ playerId: string; username: string | null } | null>(null);
  // Mensaje que se está corrigiendo dentro del hilo
  const [editingMsg, setEditingMsg] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);

  const [newQuestion, setNewQuestion] = useState('');

  // ── Respuestas rápidas del staff (⚡) ──
  const [replies, setReplies] = useState<ChatQuickReply[]>([]);
  const [qrOpen, setQrOpen] = useState(false);
  const [qrEditId, setQrEditId] = useState<string | null>(null);
  const [qrShortcut, setQrShortcut] = useState('');
  const [qrTitle, setQrTitle] = useState('');
  const [qrBody, setQrBody] = useState('');
  const [qrSaving, setQrSaving] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<string | null>(null);

  // El sondeo lee el hilo seleccionado desde una ref para descartar
  // respuestas que llegan después de cambiar de conversación
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  useEffect(() => {
    if (!isLoading && !isAdmin) router.replace(player ? '/juego' : '/auth/login');
  }, [isLoading, isAdmin, player, router]);

  const loadList = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/chat', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      setConversations(data.conversations ?? []);
      setQuestions(data.questions ?? []);
      setReplies(data.replies ?? []);
    } catch {}
  }, []);

  const loadThread = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/admin/chat?conversation=${id}`, { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      if (selectedRef.current !== id) return; // cambió de hilo mientras cargaba
      setThread(data.conversation ?? null);
      setMessages(data.messages ?? []);
    } catch {}
  }, []);

  // Sondeo de respaldo: lista + hilo abierto cada 10 s
  useEffect(() => {
    if (!isAdmin) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga asíncrona
    loadList();
    const interval = setInterval(() => {
      loadList();
      if (selectedRef.current) loadThread(selectedRef.current);
    }, 10_000);
    return () => clearInterval(interval);
  }, [isAdmin, loadList, loadThread]);

  // TIEMPO REAL: cualquier mensaje nuevo refresca la lista y el hilo
  // abierto al instante (RLS: el admin recibe todos). Migración 007.
  useEffect(() => {
    if (!isAdmin) return;
    const supabase = createClient();
    if (!supabase) return;
    const channel = supabase
      .channel('chat-rt-admin')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages' },
        () => {
          loadList();
          if (selectedRef.current) loadThread(selectedRef.current);
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [isAdmin, loadList, loadThread]);

  // En móvil el hilo se ancla justo debajo del encabezado del sitio
  // (que es sticky y puede crecer a dos filas): se mide de verdad en
  // vez de dar por hecho un alto fijo.
  useEffect(() => {
    const header = document.querySelector('header');
    if (!header) return;
    // ResizeObserver y no 'resize' a secas: el encabezado también
    // cambia de alto solo (pasa a dos filas, le entra la campanita con
    // los avisos…) y si el hilo se quedara más arriba, el "← Volver"
    // acabaría debajo del encabezado y no se podría tocar.
    const medir = () =>
      document.documentElement.style.setProperty(
        '--achat-top',
        `${Math.round(header.getBoundingClientRect().height)}px`
      );
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(header);
    return () => ro.disconnect();
  }, []);

  const msgCount = messages.length;
  useEffect(() => {
    // Al contenedor, no scrollIntoView: así el último mensaje queda
    // pegado abajo del todo y no medio tapado por el borde.
    const cont = bottomRef.current?.parentElement;
    if (cont) cont.scrollTop = cont.scrollHeight;
  }, [selected, msgCount]);

  // Buscador de jugadores (desde 2 letras)
  useEffect(() => {
    if (!searchOpen) return;
    const q = search.trim();
    if (q.length < 2) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- limpieza síncrona del estado del buscador
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/admin/chat?q=${encodeURIComponent(q)}`, {
          cache: 'no-store',
        });
        const data = await res.json();
        if (res.ok) setResults(data.results ?? []);
      } catch {
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [search, searchOpen]);

  // Llegada desde el menú de un jugador (/admin/chat?player=ID):
  // crea o abre su conversación directamente.
  useEffect(() => {
    if (!isAdmin) return;
    const pid = new URLSearchParams(window.location.search).get('player');
    if (!pid) return;
    window.history.replaceState(null, '', '/admin/chat');
    (async () => {
      try {
        const res = await fetch('/api/admin/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'start', player_id: pid }),
        });
        const data = await res.json();
        if (res.ok && data.conversation_id) {
          selectedRef.current = data.conversation_id;
          setSelected(data.conversation_id);
          setThread(null);
          setMessages([]);
          loadThread(data.conversation_id);
          loadList();
        }
      } catch {}
    })();
  }, [isAdmin, loadThread, loadList]);

  if (!isAdmin) return null;

  const openConversation = (id: string) => {
    selectedRef.current = id;
    setSelected(id);
    setThread(null);
    setMessages([]);
    setNotice(null);
    setDetail(null);
    setEditingMsg(null);
    loadThread(id);
    // Abrirla la marca como leída también en la lista
    setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, unread: 0 } : c)));
  };

  const action = async (body: Record<string, unknown>) => {
    const res = await fetch('/api/admin/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo completar la acción');
    return data;
  };

  const send = async (payload: {
    text?: string;
    attachment?: { path: string; name: string; type: string };
  }) => {
    if (!selected) return false;
    setSending(true);
    setNotice(null);
    try {
      const data = await action({ action: 'send', conversation_id: selected, ...payload });
      // El nombre lo resuelve el servidor al leer el hilo; para el
      // mensaje recién enviado se pone aquí, si no aparecería sin
      // firma hasta recargar.
      if (data.message) {
        const propio = { ...data.message, sender_name: player?.username ?? null };
        setMessages((prev) => [...prev, propio]);
      }
      loadList();
      return true;
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'No se pudo enviar');
      return false;
    } finally {
      setSending(false);
    }
  };

  const sendText = async () => {
    let value = text.trim();
    // Atajo de respuesta rápida: si el mensaje es SOLO "/41", se envía el
    // cuerpo de la respuesta con ese atajo (si existe).
    const atajo = value.match(/^\/(\d{1,5})$/);
    if (atajo) {
      const r = replies.find((x) => x.shortcut === Number(atajo[1]));
      if (!r) {
        setNotice(`No hay respuesta rápida con el atajo /${atajo[1]}`);
        return;
      }
      value = r.body;
    }
    if (!value || sending) return;
    const ok = await send({ text: value });
    if (ok) setText('');
  };

  // ── Respuestas rápidas: guardar/editar, borrar, usar ──
  const clearReplyForm = () => {
    setQrEditId(null);
    setQrShortcut('');
    setQrTitle('');
    setQrBody('');
  };

  const saveReply = async () => {
    const shortcut = Number(qrShortcut.trim());
    const bodyText = qrBody.trim();
    if (!Number.isInteger(shortcut) || shortcut < 1 || shortcut > 99999) {
      setNotice('El atajo debe ser un número (1 a 99999)');
      return;
    }
    if (!bodyText) {
      setNotice('Escribe la respuesta');
      return;
    }
    setQrSaving(true);
    setNotice(null);
    try {
      await action({
        action: 'reply_save',
        id: qrEditId ?? undefined,
        shortcut,
        title: qrTitle.trim() || undefined,
        body: bodyText,
      });
      clearReplyForm();
      loadList();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'No se pudo guardar la respuesta');
    } finally {
      setQrSaving(false);
    }
  };

  const editReply = (r: ChatQuickReply) => {
    setQrEditId(r.id);
    setQrShortcut(String(r.shortcut));
    setQrTitle(r.title ?? '');
    setQrBody(r.body);
  };

  const deleteReply = async (r: ChatQuickReply) => {
    if (!confirm(`¿Eliminar la respuesta rápida /${r.shortcut}?`)) return;
    try {
      await action({ action: 'reply_delete', id: r.id });
      if (qrEditId === r.id) clearReplyForm();
      loadList();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'No se pudo eliminar');
    }
  };

  // "Usar": vuelca la respuesta en el compositor para poder ajustarla
  // (nombre, monto…) antes de enviar. No la manda sola.
  const usarRespuesta = (r: ChatQuickReply) => {
    setText(r.body);
    setQrOpen(false);
    setNotice(null);
    setTimeout(() => {
      const el = document.querySelector<HTMLTextAreaElement>('.chat-input-area');
      el?.focus();
    }, 0);
  };

  const sendFile = async (original: File) => {
    if (!thread) return;
    setNotice(null);
    setUploading(true);
    try {
      // Igual que del lado del jugador: HEIC a JPEG y fotos grandes
      // encogidas, para que lo que se manda se pueda ver.
      const file = await prepararImagen(original);
      if (file.size > MAX_SIZE) {
        setNotice('El archivo supera los 5 MB.');
        return;
      }
      const form = new FormData();
      form.append('file', file);
      form.append('player_id', thread.player_id); // carpeta del jugador dueño del chat
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

  // ── Moderación del hilo ──
  // Corregir un mensaje ya enviado (solo los de soporte: reescribir
  // lo que dijo el jugador falsearía la conversación).
  const saveEdit = async () => {
    const value = editText.trim();
    if (!value || !editingMsg) return;
    setSending(true);
    setNotice(null);
    try {
      const data = await action({ action: 'edit_message', message_id: editingMsg, text: value });
      if (data.message) {
        setMessages((prev) => prev.map((m) => (m.id === data.message.id ? data.message : m)));
      }
      setEditingMsg(null);
      setEditText('');
      loadList();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'No se pudo editar el mensaje');
    } finally {
      setSending(false);
    }
  };

  const deleteMessage = async (m: ChatMessage) => {
    if (!confirm('¿Eliminar este mensaje? También desaparece del chat del jugador.')) return;
    setNotice(null);
    try {
      await action({ action: 'delete_message', message_id: m.id });
      setMessages((prev) => prev.filter((x) => x.id !== m.id));
      if (editingMsg === m.id) setEditingMsg(null);
      loadList();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'No se pudo eliminar el mensaje');
    }
  };

  // Eliminar el chat completo (mensajes y adjuntos, para ambos lados)
  const deleteConversation = async () => {
    if (!selected || !thread) return;
    const who = thread.username || thread.email || thread.player_id.slice(0, 8);
    if (
      !confirm(
        `⚠️ ¿Eliminar la conversación con ${who}?\n\nSe borran TODOS los mensajes y adjuntos, también del lado del jugador. No se puede deshacer.`
      )
    )
      return;
    if (!confirm(`Última confirmación: eliminar el chat de ${who}.`)) return;
    setNotice(null);
    try {
      await action({ action: 'delete_conversation', conversation_id: selected });
      setSelected(null);
      selectedRef.current = null;
      setThread(null);
      setMessages([]);
      setDetail(null);
      loadList();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'No se pudo eliminar la conversación');
    }
  };

  const setStatus = async (status: ChatConversationStatus) => {
    if (!selected) return;
    try {
      await action({ action: 'set_status', conversation_id: selected, status });
      setThread((prev) => (prev ? { ...prev, status } : prev));
      loadList();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'No se pudo cambiar la etiqueta');
    }
  };

  const startChat = async (r: SearchResult) => {
    try {
      const data = await action({ action: 'start', player_id: r.id });
      setSearchOpen(false);
      setSearch('');
      setResults([]);
      await loadList();
      if (data.conversation_id) openConversation(data.conversation_id);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'No se pudo crear la conversación');
    }
  };

  const addQuestion = async () => {
    const q = newQuestion.trim();
    if (!q) return;
    try {
      await action({ action: 'question_add', question: q });
      setNewQuestion('');
      loadList();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'No se pudo agregar');
    }
  };

  // Por defecto, el chat que lleva más tiempo sin respuesta arriba
  const visible = ordenar(
    filter === 'todos' ? conversations : conversations.filter((c) => c.status === filter),
    ordenChats,
    (c) => c.last_message_at
  );

  return (
    <main className={`admin-main ${tab === 'convos' && selected ? 'achat-open' : ''}`}>
      <h1 className="admin-title">💬 Chat de atención al cliente</h1>
      <p className="admin-subtitle">Conversaciones uno a uno con los jugadores</p>

      <div className="admin-shell">
        <AdminNav
          active="chat"
          badges={{ chat: conversations.reduce((s, c) => s + (c.unread ?? 0), 0) }}
        />

        <div className="admin-content">
      <div className="admin-filter-row">
        <button
          className={`btn-mini ${tab === 'convos' ? 'btn-mini-active' : ''}`}
          onClick={() => setTab('convos')}
        >
          Conversaciones
        </button>
        <button
          className={`btn-mini ${tab === 'questions' ? 'btn-mini-active' : ''}`}
          onClick={() => setTab('questions')}
        >
          Preguntas rápidas
        </button>
      </div>

      {tab === 'questions' ? (
        <section className="admin-section">
          <div className="achat-qq-add">
            <input
              className="chat-input"
              value={newQuestion}
              maxLength={200}
              placeholder="Nueva pregunta rápida…"
              onChange={(e) => setNewQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addQuestion();
              }}
            />
            <button className="btn-mini btn-mini-active" onClick={addQuestion}>
              + Agregar
            </button>
          </div>
          {questions.length === 0 ? (
            <p className="admin-hint">No hay preguntas rápidas.</p>
          ) : (
            <ul className="achat-qq-list">
              {questions.map((q) => (
                <li key={q.id} className="achat-qq-item">
                  <span className={q.active ? '' : 'achat-qq-off'}>{q.question}</span>
                  <span className="admin-actions">
                    <button
                      className="btn-mini"
                      onClick={async () => {
                        try {
                          await action({
                            action: 'question_toggle',
                            id: q.id,
                            active: !q.active,
                          });
                          loadList();
                        } catch {}
                      }}
                    >
                      {q.active ? 'Activa' : 'Inactiva'}
                    </button>
                    <button
                      className="btn-mini"
                      onClick={async () => {
                        if (!confirm('¿Eliminar esta pregunta rápida?')) return;
                        try {
                          await action({ action: 'question_delete', id: q.id });
                          loadList();
                        } catch {}
                      }}
                    >
                      🗑
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <div className={`achat-layout ${selected ? 'achat-has-sel' : ''}`}>
          {/* ── Lista de conversaciones ── */}
          <div className="achat-list">
            <div className="achat-list-tools">
              <div className="admin-filter-row">
                {(['todos', 'pendiente', 'prioridad', 'resuelto'] as const).map((f) => (
                  <button
                    key={f}
                    className={`btn-mini ${filter === f ? 'btn-mini-active' : ''}`}
                    onClick={() => setFilter(f)}
                  >
                    {f === 'todos' ? 'Todos' : STATUS_LABEL[f]}
                  </button>
                ))}
                <OrdenToggle orden={ordenChats} onChange={setOrdenChats} />
              </div>
              <button
                className="btn-mini"
                onClick={() => {
                  setSearchOpen((v) => !v);
                  setSearch('');
                  setResults([]);
                }}
              >
                {searchOpen ? '✕ Cerrar' : '＋ Nuevo chat'}
              </button>
            </div>

            {searchOpen && (
              <div className="achat-search">
                <input
                  className="chat-input"
                  value={search}
                  placeholder="Buscar usuario por nombre, correo o cédula…"
                  onChange={(e) => setSearch(e.target.value)}
                  autoFocus
                />
                <div className="achat-search-results">
                  {search.trim().length < 2 ? (
                    <p className="admin-hint">Escribe al menos 2 letras.</p>
                  ) : searching ? (
                    <p className="admin-hint">Buscando…</p>
                  ) : results.length === 0 ? (
                    <p className="admin-hint">Sin resultados.</p>
                  ) : (
                    results.map((r) => (
                      <button key={r.id} className="achat-result" onClick={() => startChat(r)}>
                        <PlayerAvatar playerId={r.id} name={r.username || r.email} size={24} />
                        <strong>{r.username || r.id.slice(0, 8)}</strong>
                        {r.email && <span>{r.email}</span>}
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}

            {visible.length === 0 ? (
              <p className="admin-hint">
                {conversations.length === 0
                  ? 'Aún no hay conversaciones.'
                  : 'No hay chats con esta etiqueta.'}
              </p>
            ) : (
              visible.map((c) => (
                /* El 👁 va FUERA del botón de la conversación (un botón
                   dentro de otro no es válido) y abre la ficha sin
                   entrar al chat */
                <div
                  key={c.id}
                  className={`achat-conv-row ${selected === c.id ? 'achat-conv-row-sel' : ''}`}
                >
                <button
                  className={`achat-conv ${selected === c.id ? 'achat-conv-sel' : ''}`}
                  onClick={() => openConversation(c.id)}
                >
                  <span className="achat-conv-top">
                    <PlayerAvatar
                      playerId={c.player_id}
                      name={c.username || c.email}
                      size={28}
                    />
                    <strong className="achat-conv-name">
                      {c.username || c.email || c.player_id.slice(0, 8)}
                    </strong>
                    <span className={`achat-pill achat-pill-${c.status}`}>
                      {STATUS_LABEL[c.status]}
                    </span>
                    {c.unread > 0 && (
                      <span className="chat-fab-badge achat-unread">
                        {c.unread > 9 ? '9+' : c.unread}
                      </span>
                    )}
                  </span>
                  {c.tags?.length > 0 && (
                    <span className="achat-conv-tags">
                      {c.tags.slice(0, 3).map((t) => (
                        <span key={t.id} className={`ptag ptag-${t.color}`} title={t.note || ''}>
                          {t.label}
                        </span>
                      ))}
                      {c.tags.length > 3 && (
                        <span className="ptag ptag-neutral">+{c.tags.length - 3}</span>
                      )}
                    </span>
                  )}
                  <span className="achat-conv-preview">{c.preview}</span>
                  <span className="achat-conv-date">{fmtDateTime(c.last_message_at)}</span>
                </button>
                  <button
                    className="achat-conv-eye"
                    onClick={() => setDetail({ playerId: c.player_id, username: c.username })}
                    aria-haspopup="dialog"
                    aria-label={`Ver datos de ${c.username || c.email || 'este jugador'}`}
                    title="Ver datos del jugador"
                  >
                    👁
                  </button>
                </div>
              ))
            )}
          </div>

          {/* ── Hilo ── */}
          <div className="achat-thread">
            {!selected ? (
              <p className="admin-hint achat-thread-empty">
                Selecciona una conversación para ver los mensajes.
              </p>
            ) : (
              <>
                <div className="achat-thread-head">
                  <button
                    className="btn-mini achat-back"
                    onClick={() => {
                      setSelected(null);
                      setThread(null);
                    }}
                  >
                    ← Volver
                  </button>
                  <div className="achat-thread-who">
                    {thread && (
                      <PlayerAvatar
                        playerId={thread.player_id}
                        name={thread.username || thread.email}
                        size={32}
                      />
                    )}
                    {thread ? (
                      <button
                        className={`pchip ${detail ? 'pchip-open' : ''}`}
                        onClick={() =>
                          setDetail(
                            detail
                              ? null
                              : { playerId: thread.player_id, username: thread.username }
                          )
                        }
                        aria-haspopup="dialog"
                      >
                        {thread.username || thread.player_id.slice(0, 8)}{' '}
                        <span className="pchip-caret">👁</span>
                      </button>
                    ) : (
                      <strong>…</strong>
                    )}
                    {thread?.email && <span>{thread.email}</span>}
                    <span>🎟️ {thread?.tickets ?? 0}</span>
                  </div>
                  <div className="achat-thread-tools">
                    <span className="admin-hint">Estado:</span>
                    {(['pendiente', 'prioridad', 'resuelto'] as const).map((s) => (
                      <button
                        key={s}
                        className={`btn-mini ${thread?.status === s ? 'btn-mini-active' : ''}`}
                        onClick={() => setStatus(s)}
                      >
                        {STATUS_LABEL[s]}
                      </button>
                    ))}
                    <button className="btn-mini btn-danger" onClick={deleteConversation}>
                      🗑 Eliminar chat
                    </button>
                  </div>
                </div>

                {/* Etiquetas internas del jugador, a mano mientras se
                    responde (el jugador nunca las ve) */}
                {thread && (
                  <div className="achat-tags">
                    <PlayerTags playerId={thread.player_id} compact onChanged={loadList} />
                  </div>
                )}

                <div className="chat-msgs achat-msgs">
                  {messages.map((m, i) => {
                    // Separador de fecha antes del primer mensaje de cada
                    // día: así se ve de qué día es cada tramo (jugador y
                    // equipo por igual) y a qué día corresponde el chat.
                    const prev = messages[i - 1];
                    const nuevoDia =
                      !prev || claveDia(new Date(prev.created_at)) !== claveDia(new Date(m.created_at));
                    return (
                    <Fragment key={m.id}>
                    {nuevoDia && (
                      <div className="achat-day-sep">
                        <span>{fmtDia(m.created_at)}</span>
                      </div>
                    )}
                    <div
                      className={`chat-msg ${m.sender === 'support' ? 'chat-msg-own' : 'chat-msg-support'}`}
                    >
                      {editingMsg === m.id ? (
                        <>
                          <textarea
                            className="achat-edit-input"
                            value={editText}
                            maxLength={2000}
                            rows={3}
                            autoFocus
                            onChange={(e) => setEditText(e.target.value)}
                            onKeyDown={(e) => {
                              // Enter baja de línea (igual que al escribir):
                              // se guarda con el botón o con Ctrl+Enter
                              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                                e.preventDefault();
                                saveEdit();
                              }
                              if (e.key === 'Escape') setEditingMsg(null);
                            }}
                          />
                          <span className="achat-msg-tools">
                            <button
                              className="btn-mini btn-mini-active"
                              disabled={!editText.trim() || sending}
                              onClick={saveEdit}
                            >
                              Guardar
                            </button>
                            <button className="btn-mini" onClick={() => setEditingMsg(null)}>
                              Cancelar
                            </button>
                          </span>
                        </>
                      ) : (
                        <>
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
                          <span className="chat-msg-foot">
                            <span className="achat-msg-tools">
                              {/* Solo se editan los mensajes de soporte:
                                  los del jugador únicamente se eliminan */}
                              {m.sender === 'support' && m.body && (
                                <button
                                  className="achat-msg-btn"
                                  title="Editar mensaje"
                                  aria-label="Editar mensaje"
                                  onClick={() => {
                                    setEditingMsg(m.id);
                                    setEditText(m.body ?? '');
                                  }}
                                >
                                  <IconPencil />
                                </button>
                              )}
                              <button
                                className="achat-msg-btn achat-msg-btn-danger"
                                title="Eliminar mensaje"
                                aria-label="Eliminar mensaje"
                                onClick={() => deleteMessage(m)}
                              >
                                <IconTrash />
                              </button>
                            </span>
                            <span className="chat-msg-time">
                              {/* Quién del equipo respondió: con varias
                                  personas atendiendo hay que poder ver
                                  de un vistazo quién dijo qué */}
                              {m.sender === 'support' && m.sender_name
                                ? `${m.sender_name} · `
                                : ''}
                              {fmtTime(m.created_at)}
                              {m.edited_at ? ' · editado' : ''}
                            </span>
                          </span>
                        </>
                      )}
                    </div>
                    </Fragment>
                    );
                  })}
                  <div ref={bottomRef} />
                </div>

                {notice && <p className="chat-notice">{notice}</p>}

                <div className="qr-composer-wrap">
                {qrOpen && (
                  <div className="qr-panel">
                    <div className="qr-panel-head">
                      <span>⚡ Respuestas rápidas</span>
                      <button
                        className="qr-close"
                        onClick={() => setQrOpen(false)}
                        aria-label="Cerrar respuestas rápidas"
                      >
                        ✕
                      </button>
                    </div>
                    <div className="qr-list">
                      {replies.length === 0 ? (
                        <p className="admin-hint">
                          No hay respuestas rápidas todavía. Crea una abajo 👇
                        </p>
                      ) : (
                        replies.map((r) => (
                          <div key={r.id} className="qr-card">
                            <div className="qr-card-info">
                              <div className="qr-card-top">
                                <span className="qr-tag">/{r.shortcut}</span>
                                {r.title && <span className="qr-card-title">{r.title}</span>}
                              </div>
                              <p className="qr-card-body">{r.body}</p>
                            </div>
                            <div className="qr-card-actions">
                              <button
                                className="btn-mini btn-mini-active"
                                onClick={() => usarRespuesta(r)}
                              >
                                Usar
                              </button>
                              <button
                                className="btn-mini qr-icon"
                                onClick={() => editReply(r)}
                                aria-label="Editar respuesta"
                              >
                                <IconPencil />
                              </button>
                              <button
                                className="btn-mini qr-icon qr-icon-danger"
                                onClick={() => deleteReply(r)}
                                aria-label="Eliminar respuesta"
                              >
                                <IconTrash />
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                    <div className="qr-form">
                      <p className="qr-form-title">
                        {qrEditId ? 'Editar respuesta' : 'Nueva respuesta'}
                      </p>
                      <div className="qr-form-row">
                        <label className="qr-field qr-field-short">
                          <span>Atajo</span>
                          <input
                            className="chat-input"
                            inputMode="numeric"
                            value={qrShortcut}
                            onChange={(e) =>
                              setQrShortcut(e.target.value.replace(/[^0-9]/g, '').slice(0, 5))
                            }
                            placeholder="41"
                          />
                        </label>
                        <label className="qr-field">
                          <span>Título (opcional)</span>
                          <input
                            className="chat-input"
                            value={qrTitle}
                            maxLength={60}
                            onChange={(e) => setQrTitle(e.target.value)}
                            placeholder="Cómo jugar"
                          />
                        </label>
                      </div>
                      <label className="qr-field">
                        <span>Respuesta</span>
                        <textarea
                          className="chat-input qr-textarea"
                          value={qrBody}
                          maxLength={2000}
                          onChange={(e) => setQrBody(e.target.value)}
                          placeholder="Texto… puedes incluir links (se hacen clickeables)"
                        />
                      </label>
                      <div className="qr-form-actions">
                        <button
                          className="btn-mini btn-mini-active"
                          onClick={saveReply}
                          disabled={qrSaving}
                        >
                          {qrSaving ? 'Guardando…' : 'Guardar'}
                        </button>
                        <button
                          className="btn-mini"
                          onClick={clearReplyForm}
                          disabled={qrSaving}
                        >
                          Limpiar
                        </button>
                      </div>
                    </div>
                  </div>
                )}
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
                  <AudioRecorder
                    disabled={uploading || sending}
                    onRecorded={sendFile}
                    onError={setNotice}
                  />
                  <button
                    type="button"
                    className={`chat-icon-btn ${qrOpen ? 'chat-icon-on' : ''}`}
                    onClick={() => setQrOpen((v) => !v)}
                    aria-label="Respuestas rápidas"
                    aria-expanded={qrOpen}
                  >
                    ⚡
                  </button>
                  <ChatComposerInput
                    value={text}
                    onChange={setText}
                    onSend={sendText}
                    placeholder="Escribe tu respuesta… (Ctrl+Enter envía)"
                    // Un atajo solo (p. ej. "/41") se envía con Enter a
                    // secas: en desktop no hace falta Ctrl+Enter ni el botón.
                    sendOnEnterWhen={(v) => /^\/\d{1,5}$/.test(v.trim())}
                  />
                  <button
                    type="button"
                    className="btn-mini btn-mini-active"
                    onClick={sendText}
                    disabled={!text.trim() || sending}
                  >
                    Enviar
                  </button>
                </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
        </div>
      </div>

      {/* Ficha del jugador: una sola para la lista y para el hilo (antes
          se desplegaba dentro del hilo y tapaba los mensajes) */}
      <PlayerDetailModal
        playerId={detail?.playerId ?? null}
        username={detail?.username}
        onClose={() => setDetail(null)}
        onChanged={() => {
          if (thread) loadThread(thread.id);
          loadList();
        }}
        onDeleted={() => {
          setDetail(null);
          setSelected(null);
          setThread(null);
          loadList();
        }}
      />
    </main>
  );
}
